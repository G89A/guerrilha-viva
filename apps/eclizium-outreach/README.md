# ECLIZIUM Outreach

Plataforma multi-tenant de CRM, campanhas e mensageria WhatsApp Business.

**Estado atual: SPRINT 0 concluída.** Base de plataforma pronta — autenticação,
workspaces, schema completo, tratamento de erros, logging e testes. Contatos,
templates, campanhas, fila, inbox e analytics ainda **não** existem, e a
interface diz isso explicitamente em vez de simular.

Nenhuma integração externa está configurada. O canal WhatsApp reporta
`NOT_CONFIGURED` e a tela de integrações lista exatamente quais variáveis
faltam.

---

## Requisitos

- Node.js 20+ (desenvolvido em 22)
- PostgreSQL 14+ (desenvolvido em 16)

## Começando

```bash
cd apps/eclizium-outreach
npm install
cp .env.example .env          # preencha DATABASE_URL e AUTH_SECRET
npm run db:migrate            # aplica as migrations
npm run db:seed               # opcional: dois workspaces de exemplo
npm run dev
```

Gere o `AUTH_SECRET` com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

O seed cria dois tenants distintos, úteis para conferir o isolamento à mão:

| E-mail | Senha | Workspace |
|---|---|---|
| `owner@acme.test` | `eclizium-dev-2026` | `acme-outreach` |
| `owner@rival.test` | `eclizium-dev-2026` | `rival-comunicacao` |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | `prisma generate` + build de produção |
| `npm run lint` | ESLint (flat config, sem `any` implícito ou explícito) |
| `npm run typecheck` | `tsc --noEmit` em modo strict |
| `npm test` | Vitest: unitários + integração |
| `npm run verify` | lint → typecheck → test → build, em sequência |
| `npm run db:migrate` | cria/aplica migration em desenvolvimento |
| `npm run db:deploy` | aplica migrations pendentes (produção) |
| `npm run db:seed` | popula dados de desenvolvimento |

## Rodando os testes

Os testes de integração usam **um banco PostgreSQL real** e não são pulados
silenciosamente: um teste de tenancy que não roda é pior que um teste que falha.

```bash
createdb eclizium_test
# em .env:
# TEST_DATABASE_URL=postgresql://usuario:senha@127.0.0.1:5432/eclizium_test?schema=public
npm test
```

`tests/global-setup.ts` aplica as migrations no banco de teste antes da suíte.
`tests/setup.ts` aponta `DATABASE_URL` para `TEST_DATABASE_URL`, de modo que a
suíte nunca alcança o banco de desenvolvimento.

Destaques da suíte:

- `tests/integration/tenancy.test.ts` — red team de multi-tenancy: leitura,
  escrita e remoção entre workspaces, sessão apontando para workspace alheio,
  usuário sem associação, papel insuficiente.
- `tests/integration/constraints.test.ts` — red team de banco: telefone
  duplicado, chave de idempotência reusada, webhook redelivered, destinatário
  duplicado.
- `tests/integration/session.test.ts` — token nunca em texto claro, expiração,
  revogação, conta desativada.

## Variáveis de ambiente

Veja `.env.example`. As variáveis da Meta são **exclusivamente de servidor** e
nunca podem receber o prefixo `NEXT_PUBLIC_`:

```
META_ACCESS_TOKEN
META_PHONE_NUMBER_ID
META_WABA_ID
META_WEBHOOK_VERIFY_TOKEN
META_APP_SECRET
```

Enquanto qualquer uma faltar, o produto reporta `NOT_CONFIGURED` e recusa
qualquer operação que dependa do provider.

## Deploy na Vercel

Este produto vive em `apps/eclizium-outreach/` (ver `docs/adr/0001-app-placement.md`).
Configure o projeto Vercel com:

- **Root Directory:** `apps/eclizium-outreach`
- **Build Command:** `npm run build` (já roda `prisma generate`)
- Variáveis de ambiente conforme `.env.example`
- Migrations aplicadas com `npm run db:deploy` no pipeline de release —
  **nunca** `migrate dev` ou `migrate reset` contra produção

Se `DATABASE_URL` apontar para um pooler (PgBouncer, Neon), defina também
`DIRECT_DATABASE_URL` com a conexão direta, exigida pelas migrations.

## Documentação

- `docs/architecture.md` — camadas, fluxo de mutação, invariantes de segurança
- `docs/sprint-0-report.md` — relatório de encerramento da Sprint 0
- `docs/adr/` — decisões arquiteturais registradas

## Ainda não implementado

`/contacts`, `/templates`, `/campaigns`, `/inbox`, `/analytics` não existem. A
navegação lateral mostra essas seções desabilitadas, com a sprint responsável,
em vez de links que levariam a telas quebradas.
