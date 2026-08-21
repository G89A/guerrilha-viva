# ECLIZIUM Outreach

Plataforma multi-tenant de CRM, campanhas e mensageria WhatsApp Business.

**Estado atual: SPRINT 1 concluída.** Base de plataforma (auth, workspaces,
schema, erros, logging, testes) mais o núcleo de CRM e compliance: contatos,
listas, tags, consentimentos, suppression list, importação CSV com wizard,
deduplicação por telefone, busca e filtros. Templates, campanhas, fila, inbox e
analytics ainda **não** existem, e a interface diz isso explicitamente em vez de
simular.

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
- `tests/integration/contacts-tenancy.test.ts` — red team do CRM: ler, editar,
  arquivar, taguear, listar, consentir e suprimir contato de outro workspace.
- `tests/integration/contacts-redteam.test.ts` — duplo clique, operações
  concorrentes, telefone malformado, injeção em campo de texto.
- `tests/integration/csv-import.test.ts` — duplicados no arquivo e no banco,
  telefone inválido, fórmula, acentuação, lotes.
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
META_GRAPH_API_VERSION
META_CREDENTIAL_KEY          (opcional — ver ADR 0011)
META_WEBHOOK_VERIFY_TOKEN    (webhook: challenge de verificação)
META_APP_SECRET              (webhook: validação de assinatura)
```

Enquanto qualquer uma faltar, o produto reporta `NOT_CONFIGURED` e recusa
qualquer operação que dependa do provider.

Permissões exigidas do token na Meta: `whatsapp_business_messaging` (enviar) e
`whatsapp_business_management` (ler e sincronizar templates).

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

## Contatos e compliance

| Rota | O que faz |
|---|---|
| `/contacts` | Listagem com busca, filtros na query string, paginação server-side e ações em lote |
| `/contacts/new` | Cadastro com normalização E.164 e consentimento inicial |
| `/contacts/[id]` | Ficha com dados, tags, listas, consentimentos por canal, supressão e histórico de auditoria |
| `/contacts/[id]/edit` | Edição com deduplicação por telefone |
| `/contacts/import` | Wizard CSV: upload → preview → mapeamento → validação → origem/consentimento → resultado |

Regras que valem a pena conhecer antes de mexer:

- Telefone é normalizado para E.164 **apenas** em `features/contacts/phone.ts`
  (ADR 0008). Não replique essa lógica.
- `(workspaceId, phoneE164)` é a identidade do contato. Duplicado devolve
  `CONFLICT` com mensagem de negócio, nunca erro do Prisma.
- Supressão é ancorada no telefone e sobrevive à remoção do contato (ADR 0010).
  `suppressContact` é o único caminho de entrada; `unsuppressContact` exige
  papel ADMIN e motivo.
- Consentimento nunca é presumido: o padrão é `UNKNOWN`, inclusive na
  importação.
- Contatos não são apagados pela operação normal — são arquivados.

## WhatsApp e templates

| Rota | O que faz |
|---|---|
| `/settings/integrations` | Configura a integração Meta, verifica a conexão de verdade e sincroniza templates |
| `/templates` | Lista os templates da WABA com busca e filtros por status, categoria e idioma |
| `/templates/[id]` | Detalhe, preview aproximado da mensagem e envio de UMA mensagem de teste |

Regras que valem a pena conhecer antes de mexer:

- **Só a Cloud API oficial da Meta.** Nada de automação de navegador, cliente
  emulado, QR code não oficial ou API não oficial — em lugar nenhum do projeto.
- Todo acesso à Meta passa por `MetaGraphClient`. `graph.facebook.com` aparece
  em um único arquivo, e a versão da Graph API vem da configuração do canal
  (ADR 0012).
- **Credencial presente não é integração funcionando.** Salvar a configuração
  deixa o canal em `NOT_CONFIGURED`; só `testChannelConnection`, que consulta
  número, WABA e permissão de templates, promove a `CONNECTED`.
- O access token nunca chega ao navegador. A UI vê apenas um fingerprint
  derivado de hash (ADR 0011).
- Nenhum envio acontece sem `evaluateContactEligibility` aprovar. Se o contato
  for inelegível, **zero requisições** são feitas à Meta.
- Um `wamid` nunca é fabricado: resposta sem id do provedor é falha, não
  sucesso. Enviado ≠ entregue — entrega só será confirmada por webhook na
  Sprint 3.
- Envio de teste é unitário e manual, com confirmação explícita, teto de taxa no
  servidor e chave de idempotência com unique no banco.
- Templates nunca são marcados como aprovados localmente (ADR 0005); os que
  somem da Meta viram `UNAVAILABLE` em vez de serem apagados (ADR 0013).

## Webhooks e Inbox

| Rota | O que faz |
|---|---|
| `GET /api/webhooks/meta/whatsapp` | Verificação por challenge exigida pela Meta |
| `POST /api/webhooks/meta/whatsapp` | Recepção de status de entrega e mensagens recebidas |
| `/inbox` | Lista de conversas com busca, filtros e não lidas |
| `/inbox/[id]` | Histórico, ficha do contato e resposta manual |

Regras que valem a pena conhecer antes de mexer:

- **Assinatura primeiro.** O corpo é lido cru (`request.text()`) antes de
  qualquer parse — reserializar mudaria os bytes e invalidaria o HMAC. Sem
  `META_APP_SECRET` configurado, o endpoint recusa: aceitar webhook não
  verificado permitiria injetar mensagens e status falsos.
- **O workspace vem do `phone_number_id`**, resolvido contra `MessagingChannel`.
  Nenhum identificador de workspace do payload é aceito.
- **Idempotência é por evento, não por entrega** (ADR 0014). Reentrega, replay e
  rajada concorrente produzem um efeito só.
- **Status só avança.** `READ` seguido de `DELIVERED` permanece `READ`.
- **Desconhecido que escreve vira contato com consentimento `UNKNOWN`**
  (ADR 0015). Responder é permitido; campanha não.
- **Conteúdo de mensagem é hostil por definição.** É renderizado como texto pelo
  React; `dangerouslySetInnerHTML` não existe nesta árvore e não deve entrar.
- Resposta livre só dentro da janela de 24 horas da Meta, calculada de
  `lastInboundAt` — nunca presumida aberta.

## Campanhas

| Rota | O que faz |
|---|---|
| `/campaigns` | Painel com cartões por estado e tabela paginada |
| `/campaigns/new` | Wizard de 9 etapas — cria a campanha como rascunho |
| `/campaigns/[id]` | Detalhe, ações, métricas e destinatários |

Regras que valem a pena conhecer antes de mexer:

- **Nada é enviado na Sprint 4.** `startCampaign` marca `RUNNING` e delega para
  `CampaignExecutionService`, que hoje recusa com `NOT_CONFIGURED`. A tela diz
  isso ao operador em vez de fingir que enfileirou.
- **Campanha exige template APROVADO pela Meta.** Free-form é só para a Inbox,
  dentro da janela de atendimento — nunca como atalho para campanha.
- **A audiência é congelada na preparação** (ADR 0017), não resolvida por
  consulta na hora do envio. Por isso a Sprint 5 tem de reavaliar a
  elegibilidade imediatamente antes de cada envio.
- **Supressão vence tudo:** lista, tag, campanha anterior e até consentimento
  concedido.
- **`UNKNOWN` nunca vira `GRANTED`.** Telefone existente não é consentimento.
- **Toda transição de estado é compare-and-set atômico.** Preparar, pausar,
  retomar e cancelar sobrevivem a 50 chamadas simultâneas — há teste.
- **Métricas vêm de agregação** (ADR 0016); os contadores em `Campaign` são
  cache recalculado, nunca incrementado.
- Faltou valor para uma variável? O contato é bloqueado, a menos que exista um
  texto alternativo escrito explicitamente. Nada é inventado.

## Documentação

- `docs/architecture.md` — camadas, fluxo de mutação, invariantes de segurança
- `docs/sprint-0-report.md` — relatório de encerramento da Sprint 0
- `docs/sprint-1-report.md` — relatório da Sprint 1, com limitações conhecidas
- `docs/sprint-2-report.md` — relatório da Sprint 2, com limitações conhecidas
- `docs/sprint-3-report.md` — relatório da Sprint 3, com limitações conhecidas
- `docs/sprint-4-report.md` — relatório da Sprint 4, com limitações conhecidas
- `docs/adr/` — decisões arquiteturais registradas

## Ainda não implementado

`/analytics` não existe. A navegação lateral mostra a seção desabilitada, com a
sprint responsável, em vez de um link que levaria a uma tela quebrada.

O **disparo de campanhas** também não: a Sprint 4 monta a audiência, avalia a
elegibilidade e prepara tudo, mas o envio em massa — fila, workers, retry,
vazão — é da Sprint 5.

A integração com a Meta está **implementada mas não validada contra credenciais
reais**: toda a lógica é exercitada contra fixtures no formato documentado e
contra a rota HTTP real, mas nenhum webhook verdadeiro da Meta chegou a este
sistema e nenhum `wamid` aqui veio de um envio real.
