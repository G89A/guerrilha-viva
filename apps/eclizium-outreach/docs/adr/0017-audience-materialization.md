# ADR 0017 — Audiência materializada, não consultada

Status: aceito (Sprint 4)

## Contexto

A audiência de uma campanha pode ser definida por filtros: lista, tag, cidade,
consentimento. A tentação é guardar só os filtros e resolver a consulta na hora
do envio.

O problema aparece quando a campanha demora. Entre o momento em que o operador
revisou "2.430 contatos, 2.121 elegíveis" e o fim do disparo, a base muda:
contatos entram, saem, são arquivados, revogam consentimento. Uma consulta
dinâmica faria a campanha atingir gente que o operador nunca viu no relatório —
e ninguém conseguiria responder depois quem exatamente estava dentro.

## Decisão

Ao preparar, a audiência é **congelada** em `CampaignRecipient`: uma linha por
contato, com a avaliação de elegibilidade e a prévia já resolvidas.

`Campaign.audienceFilters` guarda a definição usada, para exibir e repreparar —
mas quem está na campanha são as linhas materializadas, não a consulta.

A materialização percorre por **cursor, em blocos de 500**, com as relações
(consentimentos, supressões) carregadas junto. Isso permite avaliar
elegibilidade em memória: sem isso, dez mil contatos custariam dez mil
consultas. Não existe `findMany` sem `take` neste caminho.

A gravação usa `createMany({ skipDuplicates: true })` — `ON CONFLICT DO NOTHING`
— combinada com a unique `(campaignId, contactId)`. Preparações concorrentes não
duplicam ninguém, e a chave `idempotencyKey` determinística faz repreparar não
criar linha nova.

## A reverificação continua obrigatória

Materializar resolve "quem estava dentro", não "quem ainda pode receber". Entre
a preparação e o envio, um contato pode revogar consentimento, ser suprimido ou
ser arquivado.

Por isso a Sprint 5 **deve** reavaliar a elegibilidade imediatamente antes de
cada envio, e não confiar no `status` gravado aqui. Há teste documentando esse
comportamento: revogar consentimento depois da preparação NÃO altera o
destinatário já materializado — e é exatamente por isso que a segunda checagem
existe.

## Consequências

- A campanha é auditável: dá para responder quem estava dentro e por quê.
- Repreparar é seguro e barato.
- Custo: uma linha por contato por campanha. Para 10 mil contatos e 100
  campanhas, um milhão de linhas — normal para o volume, e indexado por
  `(campaignId, status)` e `(campaignId, eligibility)`.
