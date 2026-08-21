# Sprint 4 — Motor de campanhas

Construção do núcleo de campanhas em massa: audiência, elegibilidade, ensaio,
máquina de estados, métricas. **Nenhuma mensagem é enviada neste sprint** — a
execução entra na Sprint 5.

## Estado da integração externa

**IMPLEMENTED_BUT_NOT_REAL_VALIDATED.** Nenhuma chamada à Meta acontece em
nenhum caminho deste sprint, por desenho. A integração das Sprints 2 e 3 segue
sem validação contra credenciais reais.

## O que ficou pronto

- `Campaign` e `CampaignRecipient` completos, com unique `(campaignId, contactId)`.
- Máquina de estados centralizada, com nove estados e tabela explícita de
  transições. Toda mudança é compare-and-set atômico.
- Construtor de audiência: listas, tags, cidade, estado, segmento, origem,
  status, consentimento, supressão e busca, combinados com E lógico.
- Estimativa por agregação — nunca carrega a base.
- Materialização em blocos de 500 por cursor, com elegibilidade avaliada em
  memória sobre contatos já carregados.
- Motor de elegibilidade em lote, com supressão vencendo tudo.
- Mapeamento de variáveis com política explícita para valor ausente.
- Ensaio (dry run) que roda tudo e não grava nada.
- Métricas por agregação com reconciliação idempotente.
- Wizard de 9 etapas, painel e detalhe com tabela de destinatários paginada.
- `CampaignExecutionService` como interface, recusando explicitamente.

## Bugs encontrados e corrigidos

| Bug | Como apareceu | Correção |
|---|---|---|
| UI habilitaria "preparar" numa campanha com falha que o serviço recusaria | Teste de consistência entre pré-condições e tabela de transições | `FAILED → PREPARING` passou a ser permitido |
| `cuidSchema` aceitava qualquer string, inclusive `../../etc/passwd` | Red team de filtros malformados | Regex alfanumérica; id malformado morre na borda |

Nenhum bug de concorrência foi encontrado nesta sprint — a lição da Sprint 3
(`createMany({skipDuplicates})` em vez de catch-P2002) foi aplicada desde o
primeiro commit, e os testes de 6, 20 e 50 chamadas simultâneas passaram na
primeira execução.

## Concorrência — resultados

| Cenário | Chamadas simultâneas | Resultado |
|---|---|---|
| `prepareCampaign` | 6, 20, 50 | Uma vence; cada contato aparece exatamente uma vez; a campanha nunca fica presa em `PREPARING` |
| `pauseCampaign` | 20 | Uma vence; estado final `PAUSED` |
| pause × resume disputando | 5 alternadas | Termina em `RUNNING` ou `PAUSED`, nunca corrompida |
| `cancelCampaign` | 20 | Uma vence; campanha não ressuscita |
| cancel durante prepare | 2 | Nunca fica em `PREPARING` |
| resume após cancel | 10 | Todas recusadas |
| `reconcileCampaignMetrics` | 20 | Todas convergem para o mesmo total |
| Mutação de destinatários + reconciliação | 15 | Contagem final exata |

## Escala

1.000 contatos materializados em blocos, com pelo menos 2 idas ao banco — nenhum
sinal de carregamento integral. A estimativa custa o mesmo para 10 ou 10.000
contatos, porque é `COUNT` agregado.

## Limitações conhecidas

1. **Não há execução de envio.** `startCampaign` marca `RUNNING` e nada mais. A
   UI diz isso na cara do operador.
2. **Não há scheduler.** `scheduledAt` é validado e gravado em UTC, mas nada
   dispara sozinho quando a hora chega.
3. **A reverificação antes do envio não existe ainda** — e é obrigatória na
   Sprint 5. O teste que documenta isso está em `campaign-redteam.test.ts`.
4. **`invalidPhone` na estimativa é aproximado**, extrapolado de uma amostra de
   500. O número exato sai da preparação. A tela diz isso.
5. **A materialização roda dentro da requisição.** Para 1.000 contatos é rápido;
   para 100.000 vai precisar da fila da Sprint 5.
6. **Não há edição de audiência depois de preparada** sem repreparar do zero.
7. **Sem paginação nos destinatários da API interna** além da tela: exportar a
   lista completa ainda não existe.
8. **`RecipientStatus.QUEUED`/`SENDING` existem no modelo mas nunca são
   atingidos** nesta sprint. Estão ali para a Sprint 5 não precisar migrar.
9. **Timezone é guardado como texto** e usado só para exibição. Não há
   conversão de horário local no servidor — o navegador manda ISO com offset.

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 825 testes, 48 arquivos, todos passando |
| `build` | sucesso |
| Smoke da campanha (navegador real) | 36/36 |

**REAL META VALIDATION: PENDING** — e irrelevante nesta sprint, já que nenhum
caminho aqui fala com a Meta.
