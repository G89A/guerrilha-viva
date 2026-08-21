# ADR 0015 — O que acontece quando um desconhecido escreve

Status: aceito (Sprint 3)

## Contexto

Uma mensagem chega de um número que não está no CRM. Descartar seria perder um
lead real. Criar o contato é o certo — mas com qual consentimento?

## Decisão

O contato é criado com o mínimo: `phoneE164`, o nome do perfil do WhatsApp e
`source = WHATSAPP_INBOUND`. O consentimento de WhatsApp nasce **`UNKNOWN`**,
com `source = INBOUND_MESSAGE`.

Alguém escrever para a sua empresa é permissão para **responder**, não permissão
para incluir a pessoa em campanha de marketing. São coisas diferentes, e o
produto não pode confundi-las por conveniência. Promover para `GRANTED` exige
ação explícita de um operador.

Consequência prática: o contato entra na Inbox e pode ser respondido dentro da
janela de 24 horas, mas o motor de elegibilidade (ADR do Sprint 2) continua
bloqueando campanha para ele até que alguém registre o consentimento.

Regras associadas:

- **Contato já existente** é reaproveitado, nunca duplicado, e seu consentimento
  atual não é alterado pela mensagem recebida.
- **Contato arquivado** que volta a escrever é reativado — ignorar seria perder
  uma conversa real. Contato marcado como `INVALID` não é mexido.
- **Supressão órfã** do mesmo número reencontra o novo registro, para que quem
  pediu opt-out continue suprimido mesmo tendo sido recriado.
- O nome de perfil é truncado em 120 caracteres e tratado como texto de
  terceiro: guardado como dado, exibido como texto, nunca como marcação.

## Consequências

- Nenhum caminho automático concede permissão de marketing.
- A Inbox mostra `Consentimento: Desconhecido` para esses contatos, o que é
  informação honesta para quem for responder.
