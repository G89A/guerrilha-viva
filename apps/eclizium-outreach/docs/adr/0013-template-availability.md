# ADR 0013 — Template que desaparece da Meta

Status: aceito (Sprint 2)

## Contexto

A sincronização traz os templates da WABA. Um template pode sumir da resposta —
apagado no Business Manager, movido, ou fora da página por erro nosso. Apagar o
registro local seria destrutivo: mensagens já enviadas apontam para ele.

## Decisão

Nada é apagado. `MessageTemplate.availability` vira `UNAVAILABLE` e
`unavailableSince` marca quando. Se o template reaparecer, volta a `AVAILABLE` e
`unavailableSince` é limpo.

`UNAVAILABLE` bloqueia envio (`TEMPLATE_UNAVAILABLE` na elegibilidade) e aparece
na UI como "Removido da Meta".

O status também é guardado duas vezes: `status` normalizado para a lógica, e
`providerStatus` com o texto exato da Meta. Um estado que a Meta introduza
amanhã cai em `UNKNOWN` — nunca em `APPROVED` — e continua legível no valor
bruto. Nada é marcado como aprovado localmente sem a Meta ter dito isso
(ver ADR 0005).

## Consequências

- O histórico de mensagens nunca fica com referência quebrada.
- Uma falha parcial de sincronização pode marcar templates como indisponíveis
  indevidamente; a sincronização seguinte os restaura, e o evento fica no log e
  no audit log com as contagens.
