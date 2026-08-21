# ADR 0025 — O registro de auditoria vira prova, não arquivo morto

Status: aceito (Sprint 7)

## Contexto

`AuditLog` é escrito desde a Sprint 0, em toda ação que muda estado: login,
contato criado, consentimento alterado, campanha iniciada, webhook processado,
conversa atribuída. Até esta sprint **não havia como lê-lo pela aplicação**.

Registro que ninguém consulta não é auditoria. É custo de escrita.

## Decisão

**Só leitura.** Não existe função de editar ou apagar registro em lugar nenhum do
código. Um log que o próprio sistema altera não serve de prova — e a tentação de
"limpar registros antigos pela tela" é justamente o que o torna inútil.

**ADMIN para cima.** O log diz quem fez o quê. Isso não é informação de todo
mundo dentro do workspace, e a mesma regra vale para a exportação.

**Escopo de workspace no `WHERE`, sempre.** Vazar auditoria entre tenants é pior
que vazar um contato: entrega o comportamento interno de outra empresa.
Os próprios *filtros* também são escopados — a lista de ações, de recursos e de
autores sai de `groupBy` sobre o workspace, então nem os valores possíveis
denunciam a existência de atividade alheia.

**Paginação por cursor, com desempate por `id`.** Vários registros caem no mesmo
milissegundo; sem desempate, o cursor pula linhas — e um log com buraco não é
prova de nada.

**Os metadados já nascem sem segredo.** `writeAuditLog` nunca recebe token, app
secret ou conteúdo de mensagem: o que não pode ser guardado não é guardado. Nada
aqui tenta "limpar" na leitura, porque limpeza na leitura seria admitir que a
escrita está errada.

Na tela, o JSON é renderizado como **texto** dentro de `<pre>`. Parte dele veio
de campos que alguém digitou; tratá-lo como marcação seria XSS pela porta dos
fundos.

## Exportação

CSV, percorrido por cursor em blocos de 500 e limitado a 10.000 linhas. Auditoria
de workspace ativo tem dezenas de milhares de registros — carregar tudo de uma
vez derrubaria o processo.

As células passam por `escapeCsvCell`, que neutraliza fórmula: um nome de contato
como `=cmd|'/c calc'!A1` não vira execução ao abrir a planilha.

## Consequências

- A tabela cresce sem parar e não há política de retenção. É uma escolha
  consciente: descartar auditoria por idade é o tipo de decisão que se toma com o
  jurídico, não no código. Quando doer, particionar por mês é o próximo passo.
- Não há alerta sobre padrão suspeito. O registro está lá para ser consultado;
  detecção é outro produto.
