# ADR 0012 — Abstração de provider, timeout e política de retry

Status: aceito (Sprint 2)

## Contexto

A aplicação precisa falar com a Cloud API oficial da Meta sem espalhar detalhes
de HTTP, versão de API e formato de erro pelo domínio — e sem que uma falha
externa vire stack trace na tela ou retry cego contra o provedor.

## Decisão

**Camadas.** `UI → Server Action → Service → MessagingProvider →
MetaWhatsAppProvider → MetaGraphClient → Graph API`. Nenhum componente React
fala com a Meta. O domínio depende da interface `MessagingProvider`, não da
Meta.

**URL centralizada.** `buildMetaGraphUrl(version, path, query)` é o único lugar
que conhece `graph.facebook.com`. A versão vem de
`MessagingChannel.graphApiVersion`, validada contra `vNN.N`.

**Timeout de 20 s** por requisição, via `AbortController`. A Cloud API responde
em centenas de milissegundos; 20 s cobre uma cauda ruim sem prender um handler
de Server Action a ponto de o usuário achar que travou. Sincronização paginada
aplica o teto por página, não pelo total.

**Erros classificados, não genéricos.** `classifyMetaFailure()` traduz status
HTTP + código da Meta em `ProviderErrorKind`. Cada tipo carrega `retryable`:

| Tipo | Retentável | Porquê |
|---|---|---|
| `AUTHENTICATION`, `PERMISSION`, `INVALID_REQUEST`, `NOT_FOUND` | não | repetir não conserta credencial nem payload; só gasta cota e piora a reputação do número |
| `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `NETWORK` | sim | condição transitória |
| `MALFORMED_RESPONSE`, `UNKNOWN` | não | não sabemos o que aconteceu; insistir às cegas é pior |

O Sprint 2 apenas *classifica*. Nenhum retry automático é executado aqui — isso
é do Sprint 5, junto com a fila.

**Texto de terceiro nunca vai cru para a tela.** A mensagem da Meta serve ao log
(com `fbtrace_id` e código). O que o usuário lê vem de
`providers/messaging/messages.ts`, um mapa único de frases acionáveis.

## Consequências

- Trocar de provider, ou acrescentar um segundo, não muda os serviços.
- Testes injetam um `fetchImpl` falso; o `fetch` global nunca é substituído, então
  nenhum mock pode escapar para produção.
- `MessagingProvider` é instanciado só em runtime: o build nunca acessa a Meta.
