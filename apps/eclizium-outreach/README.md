# ECLIZIUM Outreach

Plataforma multi-tenant de CRM, campanhas e mensageria WhatsApp Business.

**Estado atual: SPRINT 8 concluída.** Plataforma, CRM e compliance, integração
WhatsApp Cloud API, motor de campanhas, fila e disparo em massa, Inbox de
atendimento, analytics e auditoria — e, nesta sprint, **proteção do número**:
descadastro automático, teto de frequência, horário silencioso e parada por
qualidade. Também há `docker compose up --build` para subir tudo com um comando.

`/analytics` ainda **não** existe, e a interface diz isso em vez de simular.

Nenhuma integração externa está configurada neste repositório. Sem credencial o
canal WhatsApp reporta `NOT_CONFIGURED`, a tela de integrações lista exatamente
quais variáveis faltam e a campanha recusa iniciar.

---

> **Quer colocar no ar e disparar de verdade?** Siga
> [`docs/colocar-no-ar.md`](docs/colocar-no-ar.md). O painel tem um cartão
> **Prontidão para disparo** que verifica, contra o banco e o ambiente, cada
> coisa que precisa estar de pé — e diz qual falta.

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
| `npm run worker` | worker de envio em processo contínuo (drena a fila de campanhas) |

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
- `tests/integration/job-queue.test.ts` — reserva com `SKIP LOCKED`, reserva
  expirada, backoff, carta morta, 10 workers disputando o mesmo lote.
- `tests/integration/campaign-execution.test.ts` — ciclo completo, reverificação
  de elegibilidade antes do envio, pausar e cancelar em pleno voo.
- `tests/integration/worker-concurrency.test.ts` — 2, 6 e 10 workers e 50 ciclos
  simultâneos: exatamente uma chamada por contato.
- `tests/integration/execution-redteam.test.ts` — job forjado de outro
  workspace, job duplicado com chave diferente, campanha ressuscitada, canal
  apagado no meio do ciclo.
- `tests/integration/webhook-queue.test.ts` — recepção enfileira sem aplicar,
  worker aplica, estados terminais não reprocessam, 6/20/50 entregas simultâneas.
- `tests/integration/inbox-collaboration.test.ts` — responsável, notas, respostas
  rápidas, paginação por cursor e contadores.
- `tests/integration/inbox-media.test.ts` — allowlist de tipo e de host, teto de
  tamanho, confirmação de leitura só depois do aceite da Meta.
- `tests/integration/inbox-redteam.test.ts` — job forjado, payload de evento
  adulterado para outro número, mime forjado, conteúdo hostil do WhatsApp.

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
WORKER_TOKEN                 (cron: segredo do POST /api/internal/worker/tick)
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

Para o envio funcionar em serverless, configure também um cron chamando
`POST /api/internal/worker/tick` com o `WORKER_TOKEN` no cabeçalho
`Authorization` — em `vercel.json`, por exemplo, um `crons` de um minuto. Sem
isso as campanhas enfileiram e ficam paradas: a fila é durável, então nada se
perde, mas nada sai.

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

## Webhooks

| Rota | O que faz |
|---|---|
| `GET /api/webhooks/meta/whatsapp` | Verificação por challenge exigida pela Meta |
| `POST /api/webhooks/meta/whatsapp` | Recepção de status de entrega e mensagens recebidas |

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
- **A rota só persiste e enfileira.** O efeito é aplicado pelo worker
  (ADR 0021), que pode retentar com backoff — dentro do handler não haveria
  segunda chance. A resposta traz `queued`, não `processed`.
- **O evento gravado basta sozinho** para ser reprocessado minutos depois.
  Eventos gravados antes da Sprint 6 continuam legíveis pelo formato antigo.
- Resposta livre só dentro da janela de 24 horas da Meta, calculada de
  `lastInboundAt` — nunca presumida aberta.

## Inbox

| Rota | O que faz |
|---|---|
| `/inbox` | Lista de conversas com filtros, contadores e paginação por cursor |
| `/inbox/[id]` | Conversa, ficha do contato, notas internas e resposta |
| `/settings/quick-replies` | Cadastro das respostas rápidas do workspace |
| `/api/inbox/media/[messageId]` | Serve mídia recebida, autenticado e sob demanda |

O que vale saber antes de mexer:

- **O webhook não aplica efeito dentro da requisição.** Ele valida, persiste e
  enfileira (ADR 0021); quem aplica é o worker. **Sem worker rodando, a Inbox não
  anda** — nada se perde, mas nada aparece. A tela de integrações mostra a fila.
- **Há um caminho de processamento só.** Reprocessar um evento pela tela
  reenfileira; não existe atalho síncrono que possa divergir do normal.
- **Mídia é buscada na hora e não é armazenada** (ADR 0022). Só imagem, vídeo,
  áudio e PDF são servidos, com `nosniff` — o mime vem do WhatsApp e é texto de
  terceiro.
- **Existem três conceitos de "lido"** e eles são diferentes de propósito: o
  contador do CRM, o status `READ` que a Meta manda sobre o que NÓS enviamos, e a
  confirmação que NÓS mandamos à Meta (ADR 0023). Abrir a conversa mexe só no
  primeiro.
- **Nota interna nunca sai.** Não existe caminho de nota para o provider, e há
  teste afirmando que criar nota não cria mensagem.
- **Resposta rápida preenche o campo, nunca envia.**
- **Todo conteúdo da conversa é texto não confiável.** É renderizado por
  interpolação do React; `dangerouslySetInnerHTML` não aparece nessa árvore e não
  deve ser introduzido.

## Campanhas

| Rota | O que faz |
|---|---|
| `/campaigns` | Painel com cartões por estado e tabela paginada |
| `/campaigns/new` | Wizard de 9 etapas — cria a campanha como rascunho |
| `/campaigns/[id]` | Detalhe, ações, métricas e destinatários |

Regras que valem a pena conhecer antes de mexer:

- **Iniciar enfileira de verdade.** `startCampaign` marca `RUNNING` e enfileira
  um job por destinatário elegível; quem envia é o worker, fora da requisição.
  A tela mostra a fila e o progresso reais, não uma barra decorativa.
- **Campanha exige template APROVADO pela Meta.** Free-form é só para a Inbox,
  dentro da janela de atendimento — nunca como atalho para campanha.
- **A audiência é congelada na preparação** (ADR 0017), não resolvida por
  consulta na hora do envio. Por isso o worker **reavalia a elegibilidade
  imediatamente antes de cada envio**: consentimento revogado, supressão nova ou
  contato arquivado depois de preparar bloqueiam o disparo.
- **Supressão vence tudo:** lista, tag, campanha anterior e até consentimento
  concedido.
- **`UNKNOWN` nunca vira `GRANTED`.** Telefone existente não é consentimento.
- **Toda transição de estado é compare-and-set atômico.** Preparar, pausar,
  retomar e cancelar sobrevivem a 50 chamadas simultâneas — há teste.
- **Métricas vêm de agregação** (ADR 0016); os contadores em `Campaign` são
  cache recalculado, nunca incrementado.
- Faltou valor para uma variável? O contato é bloqueado, a menos que exista um
  texto alternativo escrito explicitamente. Nada é inventado.

## Fila e envio

O disparo — e, desde a Sprint 6, o processamento de webhook — acontece fora da
requisição HTTP, numa fila durável em PostgreSQL (ADR 0018). Há dois jeitos de
rodar o worker, e os dois chamam a **mesma** função de ciclo:

```bash
npm run worker                     # processo contínuo (VM, contêiner)
```

```bash
# serverless (Vercel Cron): um POST por minuto
curl -X POST -H "Authorization: Bearer $WORKER_TOKEN" \
  https://SEU-DOMINIO/api/internal/worker/tick
```

Sem `WORKER_TOKEN` configurado o endpoint responde `503` e **não** executa nada:
não existe modo sem autenticação para uma rota que envia mensagem de verdade.

**O worker não é opcional.** Sem ele, campanhas ficam enfileiradas e a Inbox não
recebe mensagem nova — tudo continua durável, e nada aparece.

O que vale saber antes de mexer:

- **Reserva, não retirada.** O worker reserva o job por 60 s. Worker que morre
  não trava o envio: a reserva expira e outro worker assume.
  `FOR UPDATE SKIP LOCKED` garante que dois workers nunca peguem o mesmo job —
  há teste com 2, 6 e 10 workers simultâneos e com 50 ciclos concorrentes.
- **Idempotência determinística.** A chave do job é
  `campaign-send:<campaignId>:<recipientId>` e a gravação usa
  `ON CONFLICT DO NOTHING`. Retomar duas vezes não duplica envio; a unique de
  `Message` é a última barreira.
- **Retentar é decisão do provider, não do worker** (ADR 0019). Credencial
  inválida, payload inválido e permissão negada **não** retentam — vão direto
  para carta morta. Cinco tentativas com backoff exponencial e jitter.
- **Vazão por canal** (`messagesPerSecond`, `sendBurst`) num token bucket no
  banco, compartilhado entre processos (ADR 0020). Ficar sem token **não** é
  falha: o job volta para a fila sem gastar tentativa.
- **O controle de vazão e o jitter existem para respeitar o limite do provider e
  espalhar carga** — nunca para parecer humano, mascarar automação ou escapar de
  detecção. Está escrito nas ADRs porque é regra de produto.
- **Pausar apaga os jobs pendentes** e devolve os destinatários para `ELIGIBLE`,
  justamente para que retomar volte a funcionar. Marcar em vez de apagar deixava
  a chave de idempotência consumida — foi bug desta sprint, com teste agora.
- **Carta morta é visível.** Jobs `DEAD` aparecem como aviso na campanha. Nada
  é descartado em silêncio.

## Analytics e auditoria

| Rota | O que faz |
|---|---|
| `/analytics` | Relatórios do período: mensagens, falhas, atendimento, base e campanhas |
| `/analytics/audit` | Registro de auditoria — **ADMIN para cima** |
| `/api/analytics/export` | CSV de mensagens, audiência ou campanhas |
| `/api/analytics/audit/export` | CSV do registro de auditoria |

O que vale saber antes de mexer:

- **Tudo por agregação** (ADR 0024). Nenhuma consulta traz linha para contar em
  memória, e o desempenho por campanha é um `GROUP BY` só.
- **O fuso é escolhido por quem lê e aparece na tela.** Agrupar em UTC jogaria
  tudo que acontece depois das 21h no Brasil para o dia seguinte.
- **A conversão de fuso é em dois passos** — `(x AT TIME ZONE 'UTC') AT TIME ZONE $tz`.
  As colunas são `timestamp without time zone` em UTC, e um `AT TIME ZONE`
  sozinho INTERPRETA em vez de converter. Foi bug real, pego por teste.
- **Ausência de dado não é desempenho ruim.** Sem webhook não há confirmação de
  entrega: a tela mostra `—` e explica, em vez de 0%.
- **Estado que avança conta acumulado**: uma mensagem lida também foi entregue e
  enviada.
- **O audit log é só leitura** (ADR 0025). Não existe caminho para editar ou
  apagar registro — log que o sistema altera não serve de prova.
- **As cores dos gráficos foram validadas, não escolhidas a olho**: paleta
  conferida contra a superfície de cada modo, com contraste, separação para
  daltonismo e visão normal. Ver `docs/adr/0024`.

## Proteção do número

| Rota | O que faz |
|---|---|
| `/settings/protection` | Política de envio e saúde do número — **ADMIN para cima** |

O que derruba um número no WhatsApp **não é volume** — é gente apertando
"Bloquear" e "Denunciar". Os freios existem para reduzir essa chance:

- **Descadastro automático**: "PARAR", "SAIR", "CANCELAR" entram na supressão e
  revogam o consentimento. A comparação é com a mensagem inteira, nunca
  substring — "não quero parar de receber" não descadastra ninguém.
- **Teto de frequência** por contato, contando só campanha. Resposta manual da
  Inbox não conta: limitar atendimento seria impedir conversa.
- **Horário silencioso**: adia o envio, não descarta.
- **Parada por qualidade**: campanha bloqueada quando a Meta rebaixa o número.

**Este produto não implementa evasão de banimento** — atraso para parecer humano,
variação de texto, aquecimento ou rotação de número, cliente não oficial. Além de
proibido, não funciona: nenhum disfarce no envio muda o que quem recebe faz ao
receber algo que não pediu. Ver ADR 0026.

## Documentação

- `docs/colocar-no-ar.md` — **do zero ao primeiro disparo real**: banco, deploy,
  credenciais da Meta, webhook, worker e o que só você pode fazer
- `docs/architecture.md` — camadas, fluxo de mutação, invariantes de segurança
- `docs/sprint-0-report.md` — relatório de encerramento da Sprint 0
- `docs/sprint-1-report.md` — relatório da Sprint 1, com limitações conhecidas
- `docs/sprint-2-report.md` — relatório da Sprint 2, com limitações conhecidas
- `docs/sprint-3-report.md` — relatório da Sprint 3, com limitações conhecidas
- `docs/sprint-4-report.md` — relatório da Sprint 4, com limitações conhecidas
- `docs/sprint-5-report.md` — relatório da Sprint 5, com limitações conhecidas
- `docs/sprint-6-report.md` — relatório da Sprint 6, com limitações conhecidas
- `docs/sprint-7-report.md` — relatório da Sprint 7, com limitações conhecidas
- `docs/sprint-8-report.md` — relatório da Sprint 8, com limitações conhecidas
- `docs/adr/` — decisões arquiteturais registradas

## Ainda não implementado

Não existe **agendamento automático**: `scheduledAt` é validado e
gravado, mas ninguém inicia a campanha sozinho quando a hora chega — iniciar
continua sendo ato do operador.

A Inbox **não tem tempo real**: a tela não recebe mensagem nova sozinha, é
preciso recarregar ou navegar. Não há WebSocket nem SSE.

A integração com a Meta está **implementada mas não validada contra credenciais
reais**: toda a lógica é exercitada contra fixtures no formato documentado e
contra a rota HTTP real, mas nenhum webhook verdadeiro da Meta chegou a este
sistema e nenhum `wamid` aqui veio de um envio real.
