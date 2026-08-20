# ADR 0006 — Sessões opacas no banco em vez de JWT

- Status: aceito
- Data: 2026-08-20

## Contexto

O produto precisa de sessões revogáveis: logout, desativação de conta e troca de
senha têm que invalidar o acesso imediatamente.

## Decisão

Sessão opaca com estado no banco:

- Token de 32 bytes aleatórios (`base64url`), entregue apenas uma vez.
- Armazenamos **somente** `sha256(token)`. Um dump do banco não pode ser
  reproduzido como login.
- Cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção, `Path=/`.
- Validação a cada requisição: existe, não revogada, não expirada, usuário ativo.
- `lastUsedAt` é atualizado no máximo uma vez por hora, para não gastar uma
  escrita por requisição.
- O workspace ativo mora na sessão (`active_workspace_id`), e mesmo assim é
  revalidado contra `workspace_members` a cada uso (ver ADR 0002).

## Justificativa

Um JWT autocontido não pode ser revogado sem uma denylist — que é exatamente o
estado no banco que o JWT prometia evitar. Com uma consulta indexada por
`token_hash`, o custo é baixo e o comportamento é correto.

## Consequências

- Toda requisição autenticada faz uma leitura em `sessions`. `getCurrentSession`
  usa `React.cache` para não repetir isso entre componentes do mesmo render.
- Sessões expiradas são apagadas quando encontradas; ainda é necessário um job
  de limpeza para as de usuários que nunca voltam.
