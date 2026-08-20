# ADR 0005 — O provider é dono do estado do template

- Status: aceito (implementação na Sprint 2)
- Data: 2026-08-20

## Contexto

Um template do WhatsApp só pode ser enviado se a Meta o aprovou. A aprovação
acontece fora do produto e pode ser revogada a qualquer momento.

## Decisão

`message_templates.status` é **espelho**, nunca fonte da verdade:

1. `status` só é escrito a partir de uma resposta do provider. Nenhum fluxo de
   UI ou de domínio pode marcar `APPROVED` localmente.
2. O valor padrão é `UNKNOWN`, não `PENDING`. "Ainda não sincronizado" é
   diferente de "em análise" e a distinção precisa sobreviver no banco.
3. `synced_at` registra a última confirmação vinda do provider. Um template sem
   `synced_at` nunca é considerado enviável.
4. O envio revalida o status no momento do disparo; um template aprovado ontem
   pode estar pausado agora.

## Consequências

- A tela de templates mostra o estado do provider e a data da última
  sincronização, sem inferir nada.
- Se a sincronização falhar, a tela informa a falha em vez de exibir o último
  estado conhecido como se fosse atual.
