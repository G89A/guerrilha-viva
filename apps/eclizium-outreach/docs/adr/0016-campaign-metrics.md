# ADR 0016 — De onde vêm as métricas de campanha

Status: aceito (Sprint 4)

## Contexto

Uma campanha precisa dizer quantos foram selecionados, quantos são elegíveis,
quantos já saíram, quantos falharam. Duas estratégias óbvias:

1. **Contadores incrementados** a cada mudança de destinatário.
2. **Agregação** sobre `campaign_recipients` quando alguém pergunta.

Contador incrementado é rápido de ler e frágil de manter: qualquer caminho que
esqueça de incrementar, ou que incremente duas vezes sob concorrência, produz um
número que ninguém consegue explicar depois. Com fila e workers na Sprint 5, a
quantidade de caminhos que mexem em destinatário só cresce.

## Decisão

**A agregação é a fonte da verdade.** `computeCampaignMetrics` faz um `groupBy`
por status — uma consulta, independente do tamanho da campanha.

Os contadores em `Campaign` (`totalRecipients`, `eligibleRecipients`,
`suppressedRecipients`, `invalidRecipients`) são **cache de exibição**, para que
a listagem não agregue N campanhas. Eles nunca são incrementados: são sempre
**recalculados** por `reconcileCampaignMetrics`, que escreve o valor apurado
agora.

Isso torna a reconciliação idempotente e segura sob concorrência — vinte
execuções simultâneas convergem para o mesmo número, porque cada uma escreve um
valor calculado, não um delta. Há teste para exatamente isso.

Quando reconciliar: ao fim da preparação e depois de cada ação de ciclo de vida.
Na Sprint 5, também ao fim de cada lote de envio.

## Consequências

- Um contador desatualizado é um incômodo visual, nunca uma inconsistência: a
  tela de detalhe usa a agregação direta.
- Divergência entre cache e verdade é detectável e corrigível com uma chamada.
- Taxas (`sendRate`, `deliveryRate`, …) são derivadas na leitura, com divisão
  por zero devolvendo 0 — nunca `NaN` nem `Infinity`.
- Custo: a listagem pode mostrar um número alguns segundos velho. Aceitável;
  o inverso — número errado que ninguém sabe explicar — não é.
