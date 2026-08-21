# Sprint 3 — Webhooks e Inbox

Recepção de eventos da Meta WhatsApp Cloud API e a primeira versão real da
Inbox. Campanha, fila e disparo em massa continuam fora.

## Estado da integração externa

**IMPLEMENTED_BUT_NOT_REAL_VALIDATED.**

Toda a lógica está implementada e testada contra fixtures no formato documentado
pela Meta. Nenhum webhook real da Meta chegou a este sistema, e nenhum `wamid`
aqui veio de um envio verdadeiro. O que foi exercitado de ponta a ponta é a
**rota HTTP real** — com assinatura HMAC real, corpo real, banco real.

## O que ficou pronto

- `GET/POST /api/webhooks/meta/whatsapp` — verificação por challenge e recepção.
- Validação de assinatura `X-Hub-Signature-256` com HMAC-SHA256 e comparação em
  tempo constante. Sem app secret configurado, a aplicação **recusa** em vez de
  aceitar sem verificar.
- `MetaWebhookParser`: payload externo em eventos internos tipados
  (`MESSAGE_STATUS_CHANGED`, `INBOUND_MESSAGE`, `UNKNOWN_EVENT`).
- Idempotência por chave derivada, garantida por unique no banco (ADR 0014).
- Máquina de transição de status que só avança — webhook fora de ordem não
  regride nada.
- Mensagem recebida: contato mínimo, conversa e mensagem, com política de
  consentimento explícita (ADR 0015).
- Inbox em três painéis: lista, histórico e ficha do contato, com resposta
  manual dentro da janela de 24 horas.

## Bugs encontrados e corrigidos

| Bug | Como apareceu | Correção |
|---|---|---|
| Transação abortada em concorrência (`25P02`) | Red team: 6 mensagens simultâneas de contato novo gravaram só 1 | `createMany({skipDuplicates})` no lugar de create+catch e de `upsert`; ver ADR 0014 |
| Byte NUL derrubava o processamento inteiro | Red team: mensagem contendo `U+0000`, que o PostgreSQL recusa em `text` e `jsonb` | `stripNullBytes` no parser, aplicado também ao fragmento cru antes de persistir |
| Busca por texto retornava todas as conversas | Teste de busca por nome inexistente | `phoneE164 contains ''` casava com tudo; agora exige 3+ dígitos |
| Módulo `server-only` no bundle do cliente | Build falhou | Constantes compartilhadas extraídas para `reply-constants.ts` |
| `form action` engolia erros do servidor | Revisão do próprio código | Ações do cabeçalho viraram componente de cliente que mostra a recusa |

## Limitações conhecidas

1. **Nenhum webhook real da Meta foi recebido.** Formato exato dos payloads da
   sua WABA, comportamento sob reentrega real e latência real seguem não
   verificados.
2. **O processamento roda dentro da requisição.** A estrutura
   RECEIVE→VALIDATE→PERSIST→PROCESS existe para virar worker no Sprint 5, e o
   evento já é durável e reprocessável — mas hoje uma rajada grande ocupa o
   handler.
3. **Não há reprocessamento automático de eventos `FAILED`.** Eles ficam
   marcados e consultáveis; quem reprocessa é o Sprint 5.
4. **Mídia não é baixada.** Metadados são guardados e o estado fica
   `NOT_YET_FETCHED`. A Inbox mostra o anexo como referência, não o arquivo.
5. **Um app secret por deployment.** A assinatura precisa ser validada antes de
   saber o workspace, então vem do ambiente. Workspaces com apps Meta distintos
   exigiriam um webhook por app.
6. **A janela de 24 horas é calculada do nosso lado.** Se a Meta discordar do
   nosso cálculo, o envio falha e o erro aparece na conversa — preferível a
   presumir que está aberta.
7. **A lista da Inbox carrega 30 conversas** sem paginação, e o histórico 200
   mensagens. Suficiente para o volume atual; paginação fica para quando doer.
8. **Não confirmamos leitura à Meta.** Não marcamos mensagens como lidas no
   WhatsApp (`PUT /messages` com `status: read`); o contador de não lidas é só
   do CRM, e os dois conceitos são deliberadamente separados.

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 689 testes, 43 arquivos, todos passando |
| `build` | sucesso |
| Smoke do webhook (HTTP real, assinatura real) | 15/15 |
| Smoke da Inbox (navegador real) | 18/18 |

**REAL META WEBHOOK VALIDATION: PENDING**
