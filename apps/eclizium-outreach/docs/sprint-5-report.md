# Sprint 5 — Fila, workers e execução de campanha

A campanha finalmente **envia**. Fila durável, reserva de job com recuperação de
worker morto, retentativa com backoff, controle de vazão por canal,
reverificação de elegibilidade imediatamente antes de cada envio e progresso
visível na tela.

## Estado da integração externa

**IMPLEMENTED_BUT_NOT_REAL_VALIDATED.**

O caminho de envio é real de ponta a ponta — job reservado, elegibilidade
reavaliada, token de vazão debitado, requisição HTTP montada e disparada, erro
classificado, `Message` gravada com a unique de idempotência. O que não
aconteceu foi a Meta do outro lado: não há credencial real neste ambiente, e
nenhum `wamid` aqui veio de uma entrega verdadeira.

**REAL META VALIDATION: PENDING.**

Nada é fabricado para compensar. Sem credencial, o canal reporta
`NOT_CONFIGURED` e a campanha recusa iniciar.

## O que ficou pronto

- **Fila `jobs` em PostgreSQL** com reserva por `FOR UPDATE SKIP LOCKED`, prazo
  de 60 s e reciclagem automática do job de um worker que morreu (ADR 0018).
- **Idempotência por chave determinística** (`campaign-send:<campaignId>:<recipientId>`),
  garantida por unique e `ON CONFLICT DO NOTHING`.
- **Worker de envio** que, para cada job, relê o destinatário, o contato, os
  consentimentos e as supressões e **reavalia a elegibilidade** antes de
  qualquer chamada externa.
- **Retentativa** com backoff exponencial e jitter completo, classificação vinda
  do provider e carta morta após 5 tentativas (ADR 0019).
- **Vazão por canal** com token bucket persistido, configurável por
  `messagesPerSecond` e `sendBurst` (ADR 0020).
- **Dois modos de execução**: `npm run worker` (processo contínuo) e
  `POST /api/internal/worker/tick` (cron serverless, protegido por
  `WORKER_TOKEN`). Ambos chamam exatamente a mesma função de ciclo.
- **Ciclo de vida completo**: iniciar enfileira, pausar remove os jobs
  pendentes, retomar reenfileira, cancelar encerra. A campanha se marca
  `COMPLETED` sozinha quando a fila dela drena.
- **Progresso na tela**: barra, contagem por estado da fila e aviso explícito
  quando há jobs em carta morta.

## A reverificação, que é o ponto da sprint

A audiência é congelada na preparação (ADR 0017). Entre preparar e enviar, a
base muda. Antes de cada envio o worker refaz a checagem completa e **bloqueia**
o destinatário se algo mudou:

| Mudou depois de preparar | O que acontece no envio |
|---|---|
| Consentimento revogado | bloqueado, motivo gravado, nenhuma chamada externa |
| Contato entrou na supressão | bloqueado — supressão vence tudo |
| Contato arquivado | bloqueado |
| Campanha pausada | job **removido** e destinatário devolvido para `ELIGIBLE` |
| Campanha cancelada | job encerrado, nada é enviado |
| Destinatário já enviado | ignorado, nunca reenviado |

Há teste para cada linha desta tabela.

## Bugs encontrados e corrigidos

| Bug | Como apareceu | Correção |
|---|---|---|
| **Campanha pausada não podia ser retomada nunca mais** | Teste de pausar e retomar no meio do disparo | Pausar *marcava* os jobs como terminais, deixando a chave de idempotência consumida: reenfileirar era ignorado em silêncio. Agora pausar **apaga** os jobs não terminais, e o worker apaga o job quando o motivo do descarte é reversível (`SKIPPED` ganhou `permanent: boolean`) |
| **`MALFORMED_RESPONSE` descartava envios reais na primeira tentativa** | Rodando o worker de verdade contra a rede: 30 jobs morreram porque o gateway devolveu HTML de erro | Corpo ilegível com status de **erro** = requisição não processada = retentável; com status de **sucesso** = pode ter sido enviada = não retentável, porque retentar mandaria duas vezes para uma pessoa real (ADR 0019) |

O primeiro é o tipo de bug que só aparece quando se testa o ciclo inteiro, e o
segundo só apareceu porque o worker rodou contra a rede real em vez de só contra
`fetch` de mentira. Os dois estão cobertos por teste agora.

## Concorrência — resultados

Requisito permanente desde a Sprint 4 (§2). Todos os cenários abaixo usam
chamadas genuinamente simultâneas via `Promise.all`.

| Cenário | Simultâneas | Resultado |
|---|---|---|
| Workers drenando a mesma campanha (20 contatos) | 2, 6, 10 | **Exatamente uma chamada por contato**; nenhum contato com duas mensagens; todos os destinatários em `SENT` |
| Ciclos de worker numa campanha pequena | 50 | Nenhuma duplicata; nenhum job preso em `LEASED` |
| Reserva de lote | 10 workers | Nenhuma sobreposição: nenhum job reservado por dois |
| Reserva expirada | worker "morto" + vivo | O job volta e é processado uma vez só |
| Débito de token no mesmo canal | 20 | O teto é respeitado — o excedente recebe `retryAfterMs`, não passa |
| Enfileirar durante a execução | concorrente | Nenhum segundo envio: a chave determinística barra |
| Processar o MESMO job duas vezes | 2 | Uma `Message` só — a unique é a última barreira |

## Red team

20 cenários hostis em `execution-redteam.test.ts`, entre eles:

- job forjado apontando para destinatário de **outro workspace** → nada é
  enviado;
- job duplicado com chave **diferente** para o mesmo destinatário → ainda assim
  uma mensagem só;
- campanha cancelada com job antigo na fila → recusa;
- campanha concluída → não é reaberta pelo worker;
- payload de job inválido → morre na primeira tentativa, sem gastar retry;
- destinatário ou canal apagado no meio do ciclo → o worker não cai;
- vazão com taxa zero, negativa ou `burst` menor que o custo → não trava nem
  libera tudo;
- balde de vazão de um workspace não afeta o de outro.

## Execução real observada

Com o worker rodando contra a rede (sem credencial válida da Meta, portanto sem
entrega):

```
POST /api/internal/worker/tick?batch=10   (Bearer WORKER_TOKEN)
{"leased":10,"sent":0,"skipped":0,"rateLimited":0,"failed":10,"dead":0,"durationMs":274}
```

Os 10 jobs foram para `FAILED` com `attempts: 1`, `runAt` no futuro e
`lastError: "A resposta da Meta veio em formato inesperado."` — texto nosso, não
texto cru do provider. Antes da correção desta sprint, iam direto para `DEAD`.

A tela da campanha, recarregada logo depois, mostrou **"Aguardando nova
tentativa: 10"**, "Desistidos" em zero, progresso em `0 de 30 (0%)` e nenhum
fragmento cru da Meta. O caminho inteiro — cron autenticado, reserva, envio,
classificação do erro, tela — foi percorrido de verdade.

Pausar em seguida removeu os 30 jobs e devolveu todos os destinatários para
`ELIGIBLE`: campanha pausada continua retomável.

## Limitações conhecidas

1. **Nenhuma mensagem chegou a um telefone real.** Todo o caminho foi
   exercitado; a entrega não.
2. **Não há scheduler.** `scheduledAt` é validado e gravado, mas ninguém inicia
   a campanha sozinho quando a hora chega. Iniciar continua sendo ato do
   operador.
3. **Sem `LISTEN/NOTIFY`**: o worker faz polling (100 ms ocupado, 2 s ocioso).
   Latência baixa o suficiente para campanha, não para tempo real.
4. **A reserva de 60 s é o piso da recuperação.** Um worker que morre segura o
   job por até um minuto. Reduzir aumentaria o risco de reprocessar job apenas
   lento; a proteção contra dano nesse caso é a unique de `Message`.
5. **Não há reprocessamento de carta morta pela tela.** Jobs `DEAD` são
   visíveis e contados, mas ressuscitá-los ainda é operação manual no banco.
6. **A vazão é por canal, não por workspace nem global.** Dois canais no mesmo
   workspace somam. Se a Meta impuser teto por WABA, falta um balde acima.
7. **Falha retentável devolve o destinatário para `ELIGIBLE`**, não para
   `QUEUED`. É deliberado — se o job se perder, retomar a campanha o recupera —
   mas a tela mostra "elegível" para quem está aguardando nova tentativa.
8. **A materialização da audiência ainda roda dentro da requisição.** Quem saiu
   da requisição foi o envio. Preparar 100 mil contatos continua sendo trabalho
   síncrono.
9. **Endpoint de cron sem rate limit próprio.** É protegido por segredo e
   idempotente; ciclos concorrentes são seguros (há teste com 50), mas nada
   impede alguém com o segredo de martelá-lo.

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 904 testes, 53 arquivos, todos passando (79 a mais que a Sprint 4; 77 deles em fila e execução)  |
| `build` | sucesso |
| Smoke do endpoint de worker (HTTP real) | 7/7 |
| Smoke da campanha, do rascunho à fila (navegador real) | 7/7 |
| Smoke do ciclo worker → tela (HTTP + navegador reais) | 7/7 |

**REAL META VALIDATION: PENDING** — o envio está implementado e exercitado, mas
não validado contra credenciais reais.
