# ADR 0024 — Analytics por agregação, com o fuso explícito

Status: aceito (Sprint 7)

## Contexto

Relatório é a tela que mais tenta enganar quem a constrói. Duas armadilhas
específicas:

1. **Carregar para contar.** `findMany` e somar em memória funciona com mil
   linhas e derruba o processo com um milhão. O relatório que não escala é o
   relatório que ninguém abre no dia em que importa.
2. **Ignorar o fuso.** Agrupar por dia em UTC joga tudo que aconteceu depois das
   21h no Brasil para o dia seguinte. Ninguém confere um relatório duas vezes —
   o número errado vira decisão errada em silêncio.

## Decisão

**Tudo por agregação no banco.** `GROUP BY`, `COUNT(*) FILTER`, `date_trunc`.
Nenhuma consulta de analytics traz linha para contar em memória, e o desempenho
por campanha é um `GROUP BY` só, não uma leitura por campanha.

**O fuso é escolhido por quem lê, e aparece na tela.** Vem da URL, passa por
`isValidTimeZone` (que pergunta ao próprio ICU em vez de manter uma lista) e
entra no SQL como **parâmetro**, nunca interpolado.

**A conversão é em dois passos, e isso não é detalhe:**

```sql
date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE $tz)
```

As colunas são `timestamp without time zone` guardadas em UTC. Um `AT TIME ZONE`
sozinho **interpreta** o valor como sendo daquele fuso em vez de convertê-lo — o
oposto do pretendido. O primeiro passo diz "isto é UTC"; o segundo converte.

Esse erro estava na primeira versão deste código e produzia relatório
silenciosamente errado: com uma escrita, o dia de São Paulo saía igual ao de UTC.
Foi o teste de fronteira de fuso que pegou, não a revisão.

**O dia sem movimento entra com zero.** O eixo é preenchido em memória a partir
do próprio período. Omitir o dia vazio faria uma queda parecer buraco no gráfico.

**Estado que avança conta acumulado.** Uma mensagem `READ` também foi entregue e
enviada. Contar só o estado final subestimaria entrega e envio — e produziria a
leitura absurda de "10 enviadas, 3 entregues, 7 lidas".

## Ausência de dado não é desempenho ruim

`statusDataAvailable` existe por isso. Sem webhook configurado, nenhuma mensagem
recebe confirmação de entrega — e a taxa fica em 0%. Apresentar esse 0% como
desempenho seria mentir com número verdadeiro.

Quando não há evento de webhook no período, a tela mostra `—` no lugar das taxas
e explica por quê, com o caminho para configurar.

O mesmo vale para o tempo de resposta: sem amostra, `null` e "—". Nunca zero.

## Consequências

- As consultas custam o mesmo para 10 ou 10 milhões de mensagens: o trabalho é do
  índice, não do processo.
- Trocar o fuso reconsulta. É o preço de a fronteira do dia estar certa.
- Um índice novo pode ser necessário conforme o volume cresce — `messages` já tem
  `(workspaceId, status)`, e a série filtra por `workspace_id` e `created_at`.
- Não há cache. Relatório é lido poucas vezes por dia; cache traria a pergunta
  "esse número é de quando?", que é pior que meio segundo de espera.
