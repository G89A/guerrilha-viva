# ADR 0014 — Idempotência de webhook sem id de evento

Status: aceito (Sprint 3)

## Contexto

A Meta reentrega notificações: a mesma carga chega mais de uma vez em falha de
rede, timeout ou resposta lenta nossa. Sem defesa, uma reentrega criaria
mensagens duplicadas, incrementaria contadores duas vezes e reaplicaria efeitos.

O problema: o payload da Cloud API **não tem um id de evento**. `entry[].id` é o
id da WABA, igual em toda entrega. Não existe campo que identifique "esta
notificação específica".

## Decisão

A idempotência não é por entrega HTTP — é por **evento individual**, com chave
derivada dos campos que definem o fato:

| Evento | Chave | Por quê |
|---|---|---|
| Mensagem recebida | `msg:<wamid>` | o wamid identifica a mensagem, unicamente |
| Status de entrega | `status:<wamid>:<status>` | "esta mensagem chegou a este estado" é um fato só; o timestamp fica **de fora** de propósito, para que uma reentrega com timestamp diferente continue sendo a mesma coisa |
| Não suportado | `unknown:<sha256 do fragmento>` | conteúdo idêntico é a mesma ocorrência |

Cada evento vira UM `WebhookEvent`, e a unique `(provider, providerEventId)` faz
o trabalho. Não há leitura prévia para "checar se já existe" — isso seria uma
corrida entre duas entregas simultâneas. É o banco que decide quem chegou
primeiro; o perdedor é reconhecido como duplicado.

Uma entrega com três eventos gera três registros independentes: falha em um não
impede os outros, e cada um é reprocessável sozinho.

## Consequências

- Reentrega, replay e rajada concorrente produzem um único efeito. Coberto por
  teste com 20 entregas idênticas e por rajada de 8 simultâneas.
- O `payload` guardado é o fragmento do evento mais a metadata — self-contained
  para reprocessar. Cabeçalhos e assinatura nunca são persistidos.
- A defesa em profundidade continua nas constraints de destino:
  `Message(workspaceId, providerMessageId)` e `Conversation(channelId, contactId)`.
- Custo: o corpo HTTP bruto não é guardado como unidade. Para depurar uma
  entrega inteira é preciso juntar os eventos dela — aceitável em troca da
  granularidade de reprocessamento.

## Armadilha encontrada na implementação

O padrão "tenta criar, no `catch` do P2002 relê o vencedor" **não funciona
dentro de uma transação PostgreSQL**: a violação de unique aborta a transação
(`25P02`) e as consultas seguintes falham, inclusive a releitura. O `upsert` do
Prisma também levanta P2002 sob concorrência real.

A forma correta, usada aqui, é `createMany({ skipDuplicates: true })`, que emite
`INSERT … ON CONFLICT DO NOTHING`: nunca aborta, e o `count` retornado diz se a
linha nasceu agora — que é exatamente o sinal necessário para decidir se o
contador de não lidas avança.
