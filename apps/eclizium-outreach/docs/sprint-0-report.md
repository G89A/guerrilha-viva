# Relatório — SPRINT 0

Data: 2026-08-20 · Branch: `claude/eclizium-outreach-setup-i1agy1`

## Escopo entregue

Somente o previsto para a Sprint 0: scaffold, dependências, banco, autenticação,
workspace, layout, tratamento de erros, logging e testes base. Nada de contatos,
templates, campanhas, fila, inbox ou analytics.

## Decisões tomadas

| # | Decisão | Registro |
|---|---|---|
| 1 | Aplicação em `apps/eclizium-outreach/`, sem tocar no produto legado da raiz | ADR 0001 |
| 2 | Multi-tenancy por coluna, `workspaceId` sempre derivado no servidor | ADR 0002 |
| 3 | Senha com scrypt (`node:crypto`), sem dependência nativa | ADR 0003 |
| 4 | Rate limiter em memória, com limitação declarada; contador compartilhado fica para a Sprint 5 | ADR 0004 |
| 5 | Status de template pertence ao provider, nunca definido localmente | ADR 0005 |
| 6 | Sessão opaca no banco em vez de JWT, para permitir revogação | ADR 0006 |
| 7 | `snake_case` em tabelas e colunas, via `@map` | ADR 0007 |

## Banco

Uma migration: `20260820184350_0001_initial_schema` — 19 tabelas, 17 enums e 43 índices,
cobrindo o modelo completo do produto (contatos a webhooks). Apenas
`users`, `sessions`, `workspaces`, `workspace_members` e `audit_logs` têm
lógica de aplicação nesta sprint; as demais existem para que as próximas
sprints não precisem reescrever o schema.

Índices únicos exigidos pela especificação, todos presentes:

| Requisito | Constraint |
|---|---|
| `Contact.phone_e164` | `contacts_workspace_id_phone_e164_key` |
| `Message.provider_message_id` | `messages_workspace_id_provider_message_id_key` |
| `CampaignRecipient(campaign_id, contact_id)` | `campaign_recipients_campaign_id_contact_id_key` |
| `WebhookEvent.provider_event_id` | `webhook_events_provider_provider_event_id_key` |
| Idempotência de envio | `campaign_recipients_idempotency_key_key` |
| Supressão por telefone | `suppression_entries_workspace_id_phone_e164_key` |

## Red team — o que foi atacado

Testes automatizados (`tests/integration/`):

- ler, alterar e apagar contato de outro workspace → `0 linhas afetadas`
- sessão apontando para workspace alheio → guard ignora e serve o workspace correto
- usuário removido do workspace ativo → cai para outra associação
- usuário sem nenhuma associação → `FORBIDDEN`
- workspace inexistente vs. workspace alheio → mesma resposta, sem oráculo
- papel `VIEWER` em ação de `ADMIN` → `FORBIDDEN`
- telefone duplicado no mesmo workspace → recusado; em workspaces diferentes → aceito
- chave de idempotência reusada → recusada
- webhook redelivered → recusado
- token de sessão adulterado, expirado, revogado, de conta desativada → recusado
- e-mail desconhecido vs. senha errada → mesma mensagem e mesmo código
- falha de escrita do audit log → não derruba a operação que a originou

Verificação em navegador contra o build de produção (18 checagens, todas
passando): login com senha errada recusado; dashboard mostra apenas o próprio
workspace; seletor não lista workspace alheio; membros de outro tenant não
aparecem; cookie `httpOnly` + `SameSite=Lax` e opaco; cookie de sessão revogada
não pode ser reproduzido após logout; cadastro duplicado recusado; senha fraca
recusada no servidor mesmo removendo os atributos de validação do HTML.

Verificações manuais adicionais: nenhum segredo no bundle do cliente
(`grep` em `.next/static`); POST cross-origin para server action recusado;
cabeçalhos `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` presentes; `X-Powered-By` ausente.

## Correções feitas durante a sprint

1. **Retry de slug dentro de transação** — o PostgreSQL aborta a transação
   inteira na violação de unicidade, então a tentativa seguinte falhava com
   "current transaction is aborted". O retry foi movido para fora: uma
   transação por candidato a slug, com rollback limpo entre tentativas.
   Encontrado pelo teste "disambiguates colliding workspace slugs".
2. **Colunas `camelCase`** — trocadas por `snake_case` antes da primeira
   migration, para não exigir aspas duplas em todo SQL cru futuro (ADR 0007).

## Estado das integrações

`NOT_CONFIGURED`. Faltam, no ambiente do servidor: `META_ACCESS_TOKEN`,
`META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_WEBHOOK_VERIFY_TOKEN`,
`META_APP_SECRET`. A tela `/settings/integrations` lista exatamente essas
variáveis e nunca exibe valores. Nenhum caminho do código simula envio.

## Riscos conhecidos

| Risco | Impacto | Mitigação atual | Quando resolve |
|---|---|---|---|
| Rate limiter é por processo | Força bruta distribuída fica mais barata | Limite por e-mail+IP; escopo documentado no código | Sprint 5, com contador compartilhado |
| Sessões expiradas só são apagadas quando acessadas | Crescimento da tabela `sessions` | Índice em `expires_at` | Job de limpeza, Sprint 5 |
| Sem convite de membros | Workspace só cresce por seed | Proprietário criado junto com o workspace | Sprint futura |
| scrypt em vez de argon2id | KDF adequado, porém não o estado da arte | Parâmetros versionados no hash + `needsRehash()` | Quando houver build nativo confiável |
| Sem Row Level Security | Um `WHERE` esquecido vaza dados | `workspaceScope()` + suíte de tenancy | Melhoria futura |
| 14 tabelas ainda sem lógica | Schema pode precisar de ajuste ao ser usado | Migrations incrementais | Sprints 1–7 |

## Definition of Done — o que está fechado

`Auth` e `Workspace` têm UI, backend, banco, validação, autorização, tratamento
de erros, estado de carregamento, testes e documentação. É o único conjunto de
funcionalidades que esta sprint declara concluído.
