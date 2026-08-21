# ADR 0021 — Webhook recebe e enfileira; quem aplica é o worker

Status: aceito (Sprint 6)

## Contexto

Na Sprint 3 o webhook fazia tudo dentro da requisição: validava assinatura,
persistia o evento e aplicava o efeito. O relatório daquela sprint já registrava
as duas consequências: uma rajada da Meta ocupava o handler, e um evento que
falhava ficava marcado `FAILED` sem ninguém para tentar de novo.

A Sprint 5 trouxe fila durável, reserva com `SKIP LOCKED`, retentativa com
backoff e carta morta. O que faltava era usar.

## Decisão

A rota faz **RECEIVE → VALIDATE → PERSIST → ENQUEUE** e responde 200. O efeito é
aplicado pelo worker, chamando `processStoredEvent`.

**Um caminho de processamento só.** `processStoredEvent` é o único lugar que
aplica efeito de webhook. O reprocessamento manual pela tela **não** processa em
linha: ele reenfileira. Assim reprocessar se comporta igual ao processamento
normal, inclusive na retentativa e na carta morta — e não existe um segundo
caminho para divergir com o tempo.

**O evento gravado precisa bastar sozinho.** Antes, o payload guardava
`{ metadata, event }`: o fragmento cru. Isso deixava de fora o que o parser
derivava do contexto da entrega — o nome do perfil do contato, por exemplo, que
vem de `value.contacts` e não do fragmento da mensagem. Processar minutos depois
com esse payload perderia o nome.

Agora o payload é o evento **já tipado** (`v: 1`). Eventos gravados antes desta
sprint continuam legíveis: o codec reembrulha o fragmento antigo num envelope da
Meta e reaproveita o mesmo parser. Nenhum evento antigo vira inútil.

**Reivindicação atômica.** `claimEvent` é compare-and-set: só sai de `RECEIVED`,
`FAILED` ou `PROCESSING`. `PROCESSED` e `IGNORED` são terminais, e é isso que
impede um job reentregue — ou um reprocessamento manual disparado junto com o
worker — de aplicar o efeito duas vezes. `PROCESSING` é reivindicável de
propósito: worker que morre no meio deixa o evento nesse estado.

**Tenant revalidado no processamento.** O canal é resolvido de novo pelo
`phone_number_id` na hora de aplicar, e se o workspace resultante não bater com o
que foi gravado na recepção, o evento é ignorado. Um canal movido de tenant entre
receber e processar não faz o efeito cair no lugar errado.

**Prioridade.** Job de webhook nasce com prioridade acima do envio de campanha.
Uma mensagem recebida é alguém esperando resposta; um disparo de dez mil pode
esperar segundos. Sem isso, uma campanha grande empurraria a Inbox inteira para
o fim da fila.

## Consequências

- A Inbox tem latência de fila, não de requisição: com o worker rodando, a
  ordem de grandeza é a do ciclo (100 ms ocupado, 2 s ocioso).
- **Sem worker, nada é aplicado.** A recepção continua durável — nada se perde —
  mas a Inbox não anda. A tela de integrações mostra a fila justamente para que
  isso seja visível em vez de misterioso.
- Um job por evento faz a tabela `jobs` crescer junto com o tráfego de webhook.
  Por isso a poda de jobs `DONE` passou a existir (7 dias, em ciclo ocioso).
  Jobs `DEAD` **não** são podados: são os que alguém precisa ver.
- Falha de processamento agora retenta com backoff em vez de morrer marcada.
