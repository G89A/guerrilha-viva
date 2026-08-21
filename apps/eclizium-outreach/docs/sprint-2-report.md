# Sprint 2 — Meta WhatsApp Cloud API

Fechamento da integração oficial com a WhatsApp Business Platform. Escopo:
configurar, verificar, sincronizar templates e enviar **uma** mensagem de teste.
Campanha, fila e webhook continuam fora.

## O que ficou pronto

- **Abstração de provider** (`MessagingProvider`) e implementação
  `MetaWhatsAppProvider`, sobre a Cloud API oficial. Nenhuma automação de
  navegador, cliente emulado ou API não oficial — verificado por varredura no
  repositório inteiro.
- **`MetaGraphClient`**: URL central, versão configurável por canal, bearer,
  timeout de 20 s, parsing e classificação de erro, log estruturado sem
  credencial.
- **Credenciais por workspace** com AES-256-GCM em repouso, ou variável de
  ambiente, à escolha do canal (ADR 0011).
- **Verificação real de conexão**: consulta número, WABA e permissão de
  templates. Só isso promove o canal a `CONNECTED`.
- **Sincronização de templates** com paginação por cursor, upsert idempotente e
  marcação de indisponibilidade (ADR 0013).
- **Motor de elegibilidade** — nenhum envio alcança a Meta sem passar por ele.
- **Envio de teste unitário** com preview, confirmação explícita, teto de taxa e
  idempotência garantida por unique no banco.
- **Telas**: `/settings/integrations`, `/templates`, `/templates/[id]`.

## Limitações conhecidas

Explícitas, não escondidas:

1. **Nenhum teste real ponta a ponta contra a Meta.** O ambiente não tem
   credenciais reais nem alcança `graph.facebook.com` (o proxy devolve resposta
   não-JSON, que o produto classifica corretamente como `MALFORMED_RESPONSE`).
   Tudo que depende da Meta responder de verdade — um `wamid` real, o formato
   exato de um template da sua WABA, o comportamento sob rate limit real —
   continua **não verificado em produção**.
2. **Rate limiting é por processo** (`InMemoryRateLimiter`). Em serverless, o
   teto efetivo é `limite × instâncias`. Um limitador compartilhado é da
   Sprint 5, onde a taxa de envio passa a ser correção, não só proteção.
3. **A idempotência do envio usa uma janela de 60 s** por
   `(canal, template, contato)`. Ela impede duplo clique e reenvio por refresh,
   não é a infraestrutura completa de `CampaignRecipient` da Sprint 5.
4. **Envio parcial em caso de timeout é ambíguo por natureza.** Se a Meta não
   responder, a mensagem fica `FAILED` com aviso de que o envio *pode* ter
   ocorrido. A reconciliação só é possível via webhook (Sprint 3).
5. **`sendText` existe no provider mas não tem UI.** Está implementado e testado
   porque a interface o prevê; nenhuma tela o aciona nesta sprint.
6. **Só um canal por workspace** (`unique(workspaceId, provider, channel)`).
   Vários números por workspace exigirá afrouxar essa constraint.
7. **A sincronização é síncrona dentro da Server Action.** Com poucas centenas
   de templates é adequado; volumes muito maiores pedem a fila da Sprint 5.
8. **`META_WEBHOOK_VERIFY_TOKEN` e `META_APP_SECRET` não são exercitados.**
   Existem na configuração e são reportados na tela, mas só passam a ter uso na
   Sprint 3.
9. **Rotacionar `AUTH_SECRET` invalida tokens cifrados** que dependiam da chave
   derivada. Quem precisar separar os ciclos deve definir `META_CREDENTIAL_KEY`.

## Bugs encontrados e corrigidos durante a sprint

| Bug | Como apareceu | Correção |
|---|---|---|
| Prisma gerou a migration fora de ordem: `message_templates.provider` era convertida antes de existir | `migrate deploy` falhou | Reordenado à mão; migration revisada antes de aplicar |
| Estreitamento de enum quebraria com dados existentes | Revisão da migration | `CASE` explícito mapeando `META_WHATSAPP→META` e `DISABLED→DISCONNECTED` |
| Idempotência do envio era `read-then-write`, sujeita a corrida | Teste de duplo clique concorrente | Coluna `idempotencyKey` + unique no banco; o teste agora exige exatamente 1 envio |
| Módulo `'use server'` exportava um enum (não-função) | Server Action retornava 500 | Export órfão removido; todos os módulos `'use server'` auditados |
| Texto de erro cru da Meta chegava à UI pelos detalhes dos checks | Red team (`429` mostrou "rate limited") | Mapa único em `providers/messaging/messages.ts`; nenhuma frase de terceiro na tela |
| Fingerprint do token expunha 4 caracteres do segredo | Varredura do HTML no smoke test | Fingerprint passou a ser derivado só de hash (`••••<hash>`) |

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 528 testes, 37 arquivos, todos passando |
| `build` | sucesso, sem acesso à Meta durante o build |
| Varredura de segredo no bundle | nenhum valor de segredo; só o *nome* da variável como rótulo de UI |
| Smoke test (25 checagens) | todas passando |
| Smoke test de envio (19 checagens) | todas passando |

**REAL META END-TO-END TEST: BLOCKED — CREDENTIALS REQUIRED**
