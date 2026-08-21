# ADR 0019 — Retentativa, backoff e carta morta

Status: aceito (Sprint 5)

## Contexto

Enviar mensagem falha por muitos motivos, e eles não são iguais. "A Meta caiu
por 30 segundos" pede outra tentativa. "O token está inválido" não: repetir só
queima cota, enche o log e não conserta nada.

Quem decide isso não pode ser o worker adivinhando pela mensagem de erro.

## Decisão

**A classificação vem do provider, não do worker.** `ProviderError.retryable` é
definido na camada de provider (Sprint 2, ADR 0012) e o worker apenas obedece:

| Erro | Retenta? | Por quê |
|---|---|---|
| `RATE_LIMITED` | sim | teto temporário |
| `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `NETWORK` | sim | a requisição não foi processada |
| `AUTHENTICATION`, `PERMISSION` | **não** | repetir não conserta credencial |
| `INVALID_REQUEST`, `NOT_FOUND` | **não** | o payload seguirá inválido |
| `UNKNOWN` | **não** | sem entender, não se insiste contra um número real |

Erro não retentável vai direto para `DEAD` — sem gastar as cinco tentativas.

**Backoff exponencial com jitter completo.** `base × 2^(n-1)`, base de 5 s, teto
de 30 min, sorteado dentro de `[0, exponencial]`. O jitter existe porque N jobs
que falharam juntos durante uma queda voltariam juntos e derrubariam o provider
de novo assim que ele levantasse. É espalhamento de carga.

Registrado explicitamente: **não** é para parecer humano, mascarar automação ou
escapar de detecção. Se alguém propuser atraso aleatório com essa intenção, a
resposta é não.

**Carta morta.** Cinco tentativas (`maxAttempts`) e o job vira `DEAD`: para de
ser reservado, guarda `lastError` e aparece na tela da campanha como aviso. Nada
é apagado silenciosamente — um envio que não aconteceu tem de ser visível.

## O caso que essa ADR existe para não esquecer

A Sprint 2 classificou `MALFORMED_RESPONSE` (resposta que não é JSON válido)
como **não retentável**. Fazia sentido para envio único e manual.

Sob fila, rodando o worker de verdade, 30 jobs morreram na primeira tentativa
porque o gateway devolveu uma página HTML de erro. O envio nunca chegou à Meta —
e foi descartado como se fosse defeito permanente.

Retentar cegamente também estava errado: se a resposta veio corrompida **depois**
de a Meta aceitar, retentar manda a mesma mensagem duas vezes para uma pessoa
real. A correção separa os dois casos pelo status HTTP:

- corpo ilegível com status de **erro** (502/503 HTML de gateway) → a requisição
  não foi processada → **retentável**;
- corpo ilegível com status de **sucesso** → pode ter sido enviada → **não
  retentável**, porque o risco é mandar duas vezes.

Duas linhas de código, e só apareceram porque o worker rodou contra a rede real.

## Consequências

- Um erro classificado errado no provider vira comportamento errado no worker.
  Em compensação, a regra fica em um lugar só, com teste.
- Falha longa do provider empurra o job para até 30 min à frente. Aceitável:
  campanha não é tempo real.
- `RATE_LIMITED` do nosso próprio limitador **não** é falha e não gasta
  tentativa — o job volta para `PENDING` com `runAt` no futuro (ADR 0020).
