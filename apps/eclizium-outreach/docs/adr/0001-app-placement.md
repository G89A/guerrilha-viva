# ADR 0001 — Onde o ECLIZIUM Outreach vive neste repositório

- Status: aceito
- Data: 2026-08-20

## Contexto

O repositório `guerrilha-viva` já continha uma aplicação em produção sem relação
com este produto: um site estático em `public/` mais funções serverless em
`api/`, publicadas na Vercel a partir da raiz do repositório.

O ECLIZIUM Outreach é um produto diferente: Next.js App Router, Prisma,
PostgreSQL, com o próprio `package.json`, build e migrations.

## Decisão

O novo produto fica em `apps/eclizium-outreach/`, com toolchain própria. Nada da
aplicação existente foi movido, renomeado ou removido.

Na Vercel, o projeto do ECLIZIUM Outreach deve usar **Root Directory =
`apps/eclizium-outreach`**. O projeto já existente continua publicando a raiz.

## Consequências

- A árvore interna (`src/app`, `src/features`, `src/lib`, …) é exatamente a
  descrita na especificação; apenas a raiz mudou.
- Dois projetos Vercel apontam para o mesmo repositório, com Root Directories
  diferentes.
- Se o produto legado for aposentado, mover esta aplicação para a raiz é uma
  operação de `git mv` mais um ajuste de Root Directory.

## Alternativa recusada

Instalar o Next.js na raiz do repositório substituiria `package.json`,
`vercel.json` e a rota `/api/chat` da aplicação existente, derrubando um deploy
em funcionamento sem autorização para isso.
