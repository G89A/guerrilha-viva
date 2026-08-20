# ADR 0010 — Supressão é ancorada no telefone, não no contato

- Status: aceito
- Data: 2026-08-20

## Contexto

Quem pede para não receber mensagens tem que parar de recebê-las — inclusive
depois de o registro ser apagado e a mesma planilha ser importada de novo.

## Decisão

`suppression_entries` é chaveada por `(workspace_id, channel, phone_e164)`.
`contact_id` existe, mas é um vínculo de conveniência para histórico e UI, e é
anulável.

Regras:

1. **`suppressContact` é o único caminho de entrada.** Ele valida a posse do
   contato, grava a entrada, revoga o consentimento do canal e registra o audit
   log — nessa ordem, em uma transação.
2. **Apagar o contato não apaga a supressão.** O `contact_id` vira `NULL`; o
   telefone permanece bloqueado.
3. **Recriar ou reimportar o telefone reconecta a supressão** ao novo contato,
   tanto em `createContact` quanto na importação de CSV.
4. **`unsuppressContact` é explícito, exige papel ADMIN e um motivo com
   conteúdo**, e é auditado. Editar um contato nunca remove supressão.
5. **Remover a supressão NÃO devolve o consentimento a `GRANTED`.** São coisas
   diferentes: desbloquear não é obter permissão de novo.

## Consequências

- A supressão é por canal: alguém pode sair do WhatsApp e continuar no e-mail.
- Uma supressão órfã (contato apagado) fica invisível na UI até o telefone
  reaparecer. É o comportamento correto, mas significa que não há hoje uma tela
  listando a suppression list inteira — está registrado nas limitações.
- `suppressContact` chamado duas vezes devolve `created: false` em vez de
  estourar: duplo clique e reprocessamento são seguros.
