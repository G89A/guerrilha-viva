# ADR 0002 — Modelo de multi-tenancy

- Status: aceito
- Data: 2026-08-20

## Contexto

Toda entidade de negócio pertence a uma empresa. Um vazamento entre tenants é a
falha mais cara que este produto pode ter.

## Decisão

**Tenancy por coluna, com o `workspaceId` sempre derivado no servidor.**

1. Toda tabela de negócio carrega `workspace_id` com FK `ON DELETE CASCADE`.
2. O workspace autorizado da requisição vem de `requireWorkspace()`
   (`src/lib/auth/guards.ts`), que lê `sessions.active_workspace_id` e o
   **revalida** contra `workspace_members` a cada chamada.
3. Nenhuma query de leitura ou escrita usa um `workspaceId` vindo do cliente.
   O único ponto onde um id externo é aceito é o seletor de workspace, e ali
   `assertWorkspaceMembership()` converte a alegação em autorização — ou recusa.
4. `workspaceScope(context)` é o filtro canônico; espalhe-o em todo `where`.
5. Acesso negado responde `FORBIDDEN`, nunca `NOT_FOUND`, para que a API não
   funcione como oráculo de existência de workspaces.

## Consequências

- Um `WHERE` esquecido é um vazamento. Os testes em
  `tests/integration/tenancy.test.ts` existem para pegar exatamente isso e
  devem crescer junto com cada nova entidade.
- Se a sessão apontar para um workspace do qual o usuário foi removido, o guard
  **não** serve aquele workspace: cai para outra associação válida ou recusa.

## Alternativas recusadas

- **Schema ou banco por tenant:** custo operacional e de migração
  desproporcional para o estágio atual.
- **Row Level Security do PostgreSQL:** defesa em profundidade desejável, mas
  exige `SET LOCAL` por requisição e um usuário de banco separado; fica
  registrado como melhoria futura, não como substituto do filtro de aplicação.
