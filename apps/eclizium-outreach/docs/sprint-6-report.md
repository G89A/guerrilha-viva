# Sprint 6 — Inbox

A Inbox da Sprint 3 era um leitor de conversas. Esta sprint transforma em
ferramenta de atendimento: responsável, notas internas, respostas rápidas,
paginação de verdade, mídia visível — e tira o processamento de webhook de dentro
da requisição, que era a maior dívida declarada da Sprint 3.

## Estado da integração externa

**IMPLEMENTED_BUT_NOT_REAL_VALIDATED.** **REAL META VALIDATION: PENDING.**

Duas capacidades novas falam com a Meta e nenhuma foi exercitada contra
credenciais reais: confirmação de leitura (`POST /messages` com `status: read`) e
download de mídia (`GET /{media-id}` e o binário na URL temporária). As duas
foram testadas contra o transporte injetado, no formato documentado. Nenhum
`wamid` aqui veio de entrega verdadeira, nenhum byte de mídia veio da Meta.

Sem credencial, cada uma recusa com motivo em vez de fingir.

## O que ficou pronto

### Webhook fora da requisição (dívidas 2 e 3 da Sprint 3)

- A rota faz RECEIVE → VALIDATE → PERSIST → ENQUEUE e responde 200. Quem aplica
  o efeito é o worker (ADR 0021).
- **Um caminho de processamento só**: `processStoredEvent`. O reprocessamento
  manual reenfileira em vez de processar em linha, então se comporta igual ao
  processamento normal — inclusive retentativa e carta morta.
- Reivindicação atômica do evento: `PROCESSED` e `IGNORED` são terminais, e é
  isso que impede efeito duplicado quando job e reprocessamento manual disputam.
- Payload do evento agora é o evento **tipado**, o bastante para reprocessar
  sozinho. Eventos gravados antes da sprint continuam legíveis pelo caminho
  antigo.
- Job de webhook tem prioridade acima do disparo de campanha: uma campanha de dez
  mil não empurra a Inbox para o fim da fila.
- Painel de eventos em Configurações → Integrações, com contadores, falhas
  recentes e botão de reprocessar.

### Inbox de atendimento

- **Paginação por cursor** nas conversas ("carregar mais") e no histórico
  ("mensagens anteriores"). A lista da Sprint 3 carregava 30 conversas e 200
  mensagens sem saída.
- **Responsável** pela conversa, com filtros "minhas" e "sem responsável", e
  contadores por aba.
- **Notas internas**, que nunca vão para o WhatsApp e são visualmente distintas
  do compositor (ADR 0023).
- **Respostas rápidas** por workspace, com tela própria em Configurações. Inserir
  preenche o campo; enviar continua sendo ato separado.
- **Mídia sob demanda** (ADR 0022): imagem, vídeo e áudio aparecem na conversa,
  buscados na Meta pelo servidor, com allowlist de tipo e de host. Nada é
  armazenado.
- **Confirmação de leitura** ao WhatsApp como ação explícita, separada do
  contador de não lidas do CRM.
- **Contagem regressiva** da janela de 24 horas quando faltam poucas horas.

## Bugs encontrados e corrigidos

| Bug | Como apareceu | Correção |
|---|---|---|
| **Allowlist de host de mídia não incluía `fbsbx.com`** — toda mídia falharia em produção | Teste de download em dois passos, com a URL que a Cloud API realmente devolve | Host acrescentado, com comentário explicando por que a lista não pode ser curta demais |
| **`requeueEvent` apagava e recriava o job** — corrida sob reprocessamento simultâneo, com `findUniqueOrThrow` estourando | Red team: 6 reprocessamentos concorrentes do mesmo evento | `resetJobForRetry` reativa o job em UMA instrução; o delete saiu do caminho |
| **Jobs concluídos cresciam sem teto** — agora há um job por evento de webhook | Assertiva de teste sobre a fila depois de drenar | Poda de jobs `DONE` com mais de 7 dias, em ciclo ocioso. `DEAD` nunca é podado |
| **Payload do evento perdia o nome do perfil** ao ser reprocessado | Teste de ida e volta do codec | Payload passou a guardar o evento tipado; formato antigo segue legível |
| **Filtros da lista não afetavam o painel lateral** | Revisão do próprio código: layout não recebe `searchParams` | A lista busca a página filtrada pelo servidor quando a URL diverge do que recebeu |

## Concorrência — resultados

Requisito permanente desde a Sprint 4 (§2).

| Cenário | Simultâneas | Resultado |
|---|---|---|
| Entregas da MESMA mensagem | 6, 20, 50 | Uma recepção vence; um evento, um job, uma mensagem, uma conversa |
| Mensagens distintas do MESMO contato novo | 6, 20 | Um contato, uma conversa, N mensagens |
| Workers disputando os mesmos eventos | 10 | Nenhum efeito duplicado; nada preso na fila |
| Processar o MESMO evento em paralelo | 6 | Exatamente um `PROCESSED`; os outros `DUPLICATE` |
| Reprocessamento manual do mesmo evento | 6 | Uma mensagem só (o bug acima) |
| Atribuição de responsável | 20 alternadas | Estado final coerente: ou tem dono e data, ou nenhum dos dois |
| Criação da mesma resposta rápida | 20 | Uma vence, pela unique do banco |
| Confirmação de leitura | 6 | Marca local converge para uma data |
| Notas na mesma conversa | 6 | As 6 gravadas |
| Carga de eventos num ciclo | 50 | Nenhum perdido, nenhum duplicado |

## Red team

15 cenários hostis em `inbox-redteam.test.ts`:

- atribuir conversa a usuário de **outro tenant** → recusado;
- nota, detalhe de conversa, mídia e respostas rápidas de outro workspace → nada
  vaza, e a mídia nem chega a chamar a Meta;
- **job forjado** apontando para evento de outro workspace → o efeito cai no
  tenant dono do canal, uma vez, e não no workspace do job;
- **payload de evento adulterado** para o número de outra empresa → ignorado, sem
  efeito em nenhum dos dois tenants;
- HTML e `<script>` vindos do WhatsApp → guardados como texto, renderizados como
  texto; `dangerouslySetInnerHTML` não existe nesta árvore;
- mime forjado para `text/html` → recusado com 415;
- busca com termo vazio ou dois dígitos → não devolve o mundo;
- 50 eventos numa carga → nenhum perdido.

## Caminho assíncrono observado de ponta a ponta

Contra a rota HTTP real, com assinatura HMAC real:

```
POST /api/webhooks/meta/whatsapp
{"received":1,"queued":1,"duplicate":0,"ignored":0,"failed":0}

POST /api/internal/worker/tick
{"leased":1,...,"webhooks":1,"durationMs":34}

POST /api/internal/worker/tick   (de novo)
{"leased":0,...}
```

A rota responde **enfileirado**, não "processado". A entrega repetida do mesmo
corpo devolve `duplicate: 1` sem criar segundo job. Assinatura inválida continua
recusada com 403. O worker aplica uma vez, e o ciclo seguinte não tem o que
fazer.

Na tela: nota interna gravada sem virar mensagem (3 mensagens antes, 3 depois),
responsável atribuído, resposta rápida cadastrada e painel de eventos do webhook
mostrando a fila.

## Limitações conhecidas

1. **Nenhuma credencial real.** Confirmação de leitura e download de mídia foram
   exercitados contra transporte injetado, nunca contra a Meta.
2. **Sem worker, a Inbox não anda.** A recepção é durável e nada se perde, mas o
   efeito só aparece quando o worker roda. A tela de integrações mostra a fila
   para que isso seja visível.
3. **Mídia não é armazenada.** Cada visualização busca de novo, e mídia antiga
   pode não existir mais na Meta — a tela mostra "indisponível".
4. **Sem tempo real.** A tela não recebe mensagem nova sozinha; é preciso
   recarregar ou navegar. Não há WebSocket nem SSE.
5. **Notas não são editáveis nem apagáveis** pela interface.
6. **Resposta rápida é texto puro**, sem variáveis.
7. **Fora da janela de 24 h não há envio de template pela Inbox** — a tela diz
   que isso hoje se faz por campanha.
8. **Um app secret por deployment** (herdado da Sprint 3): a assinatura é
   validada antes de saber o workspace.
9. **O painel de eventos lista as 20 falhas mais recentes**, sem paginação nem
   filtro por período.
10. **Reprocessar é um evento por vez.** Não há "reprocessar todos os falhos".

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 1005 testes, 58 arquivos, todos passando (101 novos nesta sprint) |
| `build` | sucesso |
| Smoke da Inbox e das respostas rápidas (navegador real) | 15/15 |
| Smoke do webhook assíncrono (HTTP + assinatura + worker reais) | 6/6 |

**REAL META VALIDATION: PENDING.**
