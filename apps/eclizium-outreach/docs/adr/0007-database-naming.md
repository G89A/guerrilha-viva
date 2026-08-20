# ADR 0007 — Convenção de nomes no banco

- Status: aceito
- Data: 2026-08-20

## Decisão

- Tabelas: `snake_case`, plural (`campaign_recipients`).
- Colunas: `snake_case` (`provider_message_id`).
- No código TypeScript, os campos permanecem `camelCase`; o mapeamento é feito
  com `@map` / `@@map` no Prisma.
- Enums em `SCREAMING_SNAKE_CASE`.

## Justificativa

SQL cru vai existir — analytics agregado, varreduras da fila, investigação em
produção. Colunas `camelCase` no PostgreSQL exigem aspas duplas em toda
referência (`"providerMessageId"`), e esquecer as aspas gera erro só em tempo de
execução. Padronizar em `snake_case` elimina essa classe inteira de erro.

## Consequências

- O `schema.prisma` é mais verboso por causa dos `@map`.
- Índices e constraints herdam nomes previsíveis
  (`messages_workspace_id_provider_message_id_key`), o que ajuda no diagnóstico
  de violações de unicidade.
