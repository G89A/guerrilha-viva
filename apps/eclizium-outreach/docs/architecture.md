# Arquitetura

## Camadas

```
app/            rotas, server actions, páginas         (entrada/saída HTTP)
components/     UI pura, sem acesso a banco            (apresentação)
features/       regras de negócio por domínio          (domínio)
lib/            auth, db, validação, segurança, log    (infraestrutura)
providers/      integrações externas (Sprint 2+)       (infraestrutura)
services/       orquestração entre domínios (Sprint 4+)
queues/         fila e worker (Sprint 5+)
```

Regra de dependência: `app` → `features` → `lib`. Nunca o contrário.
`components` não importa `features` nem `lib/db`; recebe dados por props.

## Fluxo de uma mutação

```
form (client)
  → server action                'use server'
    → assertSameOriginRequest()  CSRF em profundidade
    → requireWorkspace()         autenticação + tenant autorizado
    → parseOrThrow(schema)       validação server-side
    → feature service            regra de negócio
      → prisma                   sempre com workspaceScope()
    → writeAuditLog()            registro da ação sensível
  → ActionResult<T>              nunca lança através da fronteira RSC
```

`runAction` converte qualquer exceção em `ActionResult`: um `AppError` mantém
código e erros por campo; qualquer outro erro é registrado por inteiro no log e
devolvido ao cliente como `INTERNAL_ERROR` genérico.

## Segurança — invariantes

| Invariante | Onde é garantida |
|---|---|
| Segredos não chegam ao browser | `import 'server-only'` em `lib/env.ts`, `lib/db/client.ts`, serviços |
| `workspaceId` nunca vem do cliente | `requireWorkspace()`, `assertWorkspaceMembership()` |
| Toda entrada é validada no servidor | `parseOrThrow` + schemas Zod |
| Senha nunca em texto claro | `lib/auth/password.ts` (scrypt) |
| Token de sessão nunca em texto claro | `sha256` antes do `INSERT` |
| Segredo nunca vai para o log | `lib/logging/redact.ts` |
| Ação sensível deixa rastro | `writeAuditLog` |

## Estado das integrações

Nenhuma integração externa está configurada nesta fase. A UI reporta
`NOT_CONFIGURED` e lista as variáveis ausentes — não há caminho que simule
envio, entrega ou aprovação de template.
