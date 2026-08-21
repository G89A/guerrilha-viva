# Sprint 7 — Analytics e auditoria

A última sprint do motor principal. `/analytics` sai do "desabilitado com o nome
da sprint" e vira relatório real; o registro de auditoria, escrito desde a
Sprint 0, finalmente pode ser lido.

## Estado da integração externa

**IMPLEMENTED_BUT_NOT_REAL_VALIDATED.** **REAL META VALIDATION: PENDING.**

Nenhum caminho desta sprint fala com a Meta — analytics lê o banco. A integração
das sprints anteriores continua sem validação contra credenciais reais.

Isso tem uma consequência direta no relatório e ela está tratada: **sem webhook
configurado não existe confirmação de entrega**, e a taxa fica em 0%. Apresentar
esse zero como desempenho seria mentir com número verdadeiro. Quando não há
evento no período, a tela mostra `—` e explica por quê.

## O que ficou pronto

### Analytics

- **Mensagens por dia** — enviadas, entregues e lidas, com camada de hover.
- **Totais e taxas** do período, com `—` no lugar de taxa quando falta o dado.
- **Motivos de falha** — top 10 por código e título. Sem o motivo, uma taxa de
  falha não aciona nada.
- **Atendimento** — recebidas, respostas manuais, mediana e p90 do tempo até a
  primeira resposta, e conversas **sem resposta**.
- **Base de contatos** — barras divergentes: entradas acima, saídas (revogação e
  supressão) abaixo.
- **Campanhas** — tabela com destinatários, envio, entrega, leitura e falhas,
  agregada numa consulta só.
- **Período** de 7/30/90 dias e **fuso escolhido por quem lê**, visível na tela.
- **Exportação CSV** de mensagens, audiência e campanhas.

### Auditoria

- `/analytics/audit`, **ADMIN para cima**, com filtros por ação, recurso e autor,
  paginação por cursor e detalhe dos metadados.
- Exportação CSV percorrida por cursor, limitada a 10.000 linhas.
- Somente leitura: não existe caminho para editar ou apagar registro (ADR 0025).

### Paleta de gráficos

Os gráficos são SVG escrito à mão — as formas aqui são simples e uma biblioteca
custaria mais bundle do que resolve. As cores **não foram escolhidas a olho**:
foram validadas com o script de seis checagens contra a superfície de cada modo.

| Modo | Pior par CVD | Pior par visão normal | Contraste |
|---|---|---|---|
| Claro (`#ffffff`) | ΔE 9.2 | ΔE 24.0 | aqua em 2.82:1 — **compensado com rótulo direto** |
| Escuro (`#16181d`) | ΔE 9.4 | ΔE 20.9 | os três acima de 3:1 |

O par divergente (azul ↔ vermelho) passa com ΔE 32.3 no claro e 29.0 no escuro.
Uma tentativa anterior usava vermelho e laranja lado a lado nas barras negativas:
**reprovou** (visão normal ΔE 7.1 — indistinguível até com visão plena), e o
formato foi trocado em vez de a cor ser forçada.

## Bugs encontrados e corrigidos

| Bug | Como apareceu | Correção |
|---|---|---|
| **`AT TIME ZONE` invertia a conversão** — relatório silenciosamente errado | Teste de fronteira de fuso: a mesma escrita caía no mesmo dia em UTC e em São Paulo | As colunas são `timestamp without time zone` em UTC; um `AT TIME ZONE` sozinho INTERPRETA em vez de converter. Agora são dois passos: `(x AT TIME ZONE 'UTC') AT TIME ZONE $tz` |
| Paleta com vermelho ao lado de laranja | Validador de paleta, antes de escrever o gráfico | Formato trocado: duas séries divergentes em vez de três empilhadas |
| Legenda dizia "último registro em" mostrando o fim do período | Revisão do próprio código | Frase removida — não era o que o número dizia |

O primeiro é o mais importante da sprint: passaria em revisão de código, passaria
em teste de contagem, e só apareceria como decisão errada tomada com número
errado, meses depois.

## Concorrência — resultados

| Cenário | Simultâneas | Resultado |
|---|---|---|
| Leituras do mesmo relatório | 6 | Todas devolvem o mesmo número |
| Leituras da agregação | 50 | Nenhuma falha, resultado estável |
| Escritas de auditoria | 20 | As 20 gravadas, sem colisão de id |

## Red team

15 cenários, entre eles:

- **fuso forjado** (`UTC'; DROP TABLE messages; --`) → cai no padrão e a tabela
  continua de pé;
- **período absurdo** (100.000 dias, negativo, texto) → cai no padrão em vez de
  varrer o banco;
- **workspace forjado** (`' OR 1=1 --`) → nenhum dado de ninguém;
- **auditoria de outro tenant** → nem os registros nem os *valores de filtro*
  vazam, então nem a existência de atividade alheia é denunciada;
- **`<script>` nos metadados** → guardado como texto, renderizado em `<pre>`;
- **fórmula de planilha** (`=cmd|'/c calc'!A1`, `+1234`, `@SUM`) → neutralizada
  na exportação;
- **nome com vírgula e aspas** → não quebra a linha do CSV.

## Verificação visual

O método de dataviz exige renderizar e olhar, e isso pegou um defeito que
nenhum teste automatizado pegaria: com as três séries terminando no mesmo valor
— o caso comum quando tudo está zerado —, os três rótulos de ponta eram escritos
por cima uns dos outros. Como o rótulo direto é justamente a compensação exigida
pelo contraste do slot 3 no modo claro, a sobreposição anulava a compensação.

Corrigido com afastamento mínimo e linha-guia até a ponta da série. O smoke roda
nos dois modos e confere que o escuro usa o degrau escuro da paleta (`#3987e5`),
não o claro invertido.

## Limitações conhecidas

1. **Sem dado de entrega sem webhook.** É limitação da integração, não do
   relatório — e a tela diz isso em vez de mostrar 0%.
2. **Sem cache.** Cada abertura reconsulta. Para o volume atual, meio segundo;
   cache traria a pergunta "esse número é de quando?".
3. **Sem retenção de auditoria.** A tabela cresce indefinidamente. Descartar por
   idade é decisão para tomar com o jurídico, não no código.
4. **Períodos fixos** (7/30/90). Não há intervalo personalizado.
5. **Quatro fusos na lista** (UTC, Brasília, Manaus, Lisboa). Outro fuso válido
   funciona pela URL, mas não está no seletor.
6. **A exportação de auditoria para em 10.000 linhas.** Acima disso é preciso
   estreitar o filtro.
7. **Sem comparação com período anterior.** "30% a mais que o mês passado" exige
   uma segunda consulta e uma decisão sobre o que fazer quando o período anterior
   está vazio — ficou de fora.
8. **Sem alerta.** O relatório é consultado; nada avisa sozinho.
9. **Os gráficos não têm modo textura** para daltonismo severo ou impressão. As
   paletas passam nas checagens de CVD e há rótulo direto, mas a textura, que o
   método prevê como canal extra, não foi implementada.

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 1072 testes, 62 arquivos, todos passando (51 novos nesta sprint) |
| `build` | sucesso |
| Validação de paleta (claro e escuro) | todas as checagens passam |
| Smoke de analytics e auditoria (navegador real, claro e escuro) | 18/18 |

**REAL META VALIDATION: PENDING.**
