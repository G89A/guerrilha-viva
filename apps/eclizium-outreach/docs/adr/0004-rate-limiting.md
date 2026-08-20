# ADR 0004 — Rate limiting: estado atual e limitação conhecida

- Status: aceito, com limitação explícita
- Data: 2026-08-20

## Contexto

Duas necessidades diferentes usam a palavra "rate limit":

1. **Segurança de autenticação** — encarecer força bruta em login e cadastro.
2. **Conformidade operacional com o provider** — respeitar os limites da Meta
   WhatsApp Cloud API no envio de campanhas (Sprint 5).

## Decisão

Na Sprint 0 existe apenas `InMemoryRateLimiter`
(`src/lib/security/rate-limit.ts`), uma janela fixa em memória de processo,
aplicada a login (10 tentativas / 15 min por e-mail+IP) e cadastro (5 / hora
por IP).

**Limitação conhecida e deliberada:** o contador é por processo. Em ambiente
serverless cada instância mantém a própria janela, então o teto efetivo é
`limite × instâncias`. Isso encarece um ataque, mas **não é** um rate limiter
distribuído.

## Consequências

- O caso 2 (limites do provider) **não pode** usar este limitador. A Sprint 5
  precisa de um contador compartilhado (PostgreSQL ou Redis) antes de qualquer
  disparo em volume.
- A limitação está documentada no código, no ponto de uso, para que ninguém a
  confunda com uma garantia.

## Restrição de escopo — não negociável

O rate limiter existe para segurança operacional e conformidade. Não será usado,
em nenhuma sprint, para simular comportamento humano, mascarar automação,
contornar antispam, evitar detecção ou rotacionar identidade após bloqueios.
