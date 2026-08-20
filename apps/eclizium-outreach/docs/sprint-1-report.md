# Relatório — SPRINT 1

Data: 2026-08-20 · Branch: `claude/eclizium-outreach-setup-i1agy1`

## Escopo entregue

Núcleo de CRM e compliance: contatos, listas, tags, consentimentos, suppression
list, importação CSV, deduplicação, busca/filtros, autorização multi-tenant e
audit log. Nada de provider, template, campanha, fila, webhook ou inbox.

## Decisões tomadas

| # | Decisão | Registro |
|---|---|---|
| 8 | Identidade do contato é `(workspaceId, phoneE164)`; `libphonenumber-js` para normalizar | ADR 0008 |
| 9 | Foreign keys compostas nas tabelas de junção, para o banco recusar vínculo entre tenants | ADR 0009 |
| 10 | Supressão ancorada no telefone, sobrevive à remoção do contato | ADR 0010 |

## Ajustes no schema do Sprint 0

`ContactConsent` teve `grantedAt`→`capturedAt` e `evidence`→`proofReference`
para bater com a especificação. `ConsentStatus` perdeu `PENDING` (a
especificação define três estados) e `SuppressionReason` passou a
`OPT_OUT|BLOCKED|COMPLAINT|INVALID|MANUAL`. As duas migrations de estreitamento
fazem `CASE` no cast, então rodariam com dados existentes.

## Red team — o que foi atacado e o que foi encontrado

**Uma vulnerabilidade real encontrada e corrigida.**

`setConsent` fazia upsert pela unique key `(contactId, channel)` — que não
inclui workspace. Um chamador que passasse o `contactId` de outro tenant
atualizaria o consentimento alheio. Não era alcançável pela UI (as actions
chamam `getContactOrThrow` antes), mas o serviço era inseguro por conta própria,
e a Sprint 2 vai chamá-lo de outros lugares.

Corrigido em duas camadas: checagem de posse dentro de `setConsent`, e foreign
key composta `(workspace_id, contact_id)` em `contact_consents`, que faz o
PostgreSQL recusar a linha. Coberto por dois testes.

Também atacado, sem falha encontrada: leitura, edição, arquivamento, restauração,
tag, lista, consentimento e supressão de contato de outro workspace; filtro por
tag/lista alheia; busca pelos dados exatos da vítima; id inexistente vs. id de
outro tenant (mesma resposta); telefone malformado, longo demais e com injeção
SQL; CSV vazio, só cabeçalho, cabeçalhos duplicados, fórmula, acentuação,
separador dentro de aspas; duplo clique; criações, tags, listas, supressões e
importações concorrentes; suprimir duas vezes; arquivar já arquivado;
`unsuppress` sem motivo e sem papel ADMIN.

## Bugs encontrados e corrigidos durante o sprint

1. **Vulnerabilidade cross-tenant em `setConsent`** — descrita acima.
2. **`suppressContact` estourava ao suprimir duas vezes.** O código capturava a
   violação de unicidade *dentro* da transação; o PostgreSQL aborta a transação
   inteira nesse caso e a consulta seguinte falhava. Trocado por
   `findUnique` + `upsert`, sem exceção no caminho. (Mesma classe de bug que o
   retry de slug do Sprint 0.)
3. **Ordem de classificação no CSV.** Duplicidade no arquivo era avaliada antes
   da duplicidade no banco; agora a primeira ocorrência é comparada com o banco
   e as repetições subsequentes são marcadas como duplicadas do arquivo, para
   que o relatório não conte a mesma linha duas vezes.

## Verificação manual (navegador, build de produção)

37 checagens, todas passando: login → contatos → novo contato → normalização
E.164 → duplicado recusado → telefone inválido recusado no servidor com a
validação do HTML removida → edição → tag → lista → consentimento por canal →
supressão (revoga consentimento e aparece no histórico) → busca por nome, por
telefone local e por filtros na URL → wizard CSV completo (upload, preview,
mapeamento sugerido, validação, origem/consentimento, resultado com linhas
rejeitadas) → ação em lote → arquivamento → e, do outro workspace, ficha alheia
em 404 sem nenhum dado, busca sem linhas, edição bloqueada.

## Limitações conhecidas

| Limitação | Impacto | Contorno atual |
|---|---|---|
| Busca textual usa `ILIKE ... %termo%` | Varredura sequencial quando a base crescer | Filtros por status/cidade/origem/tag/lista usam índice; busca por telefone usa o índice de `phone_e164`. `pg_trgm` + GIN é o próximo passo |
| Paginação é offset + `count` | Páginas muito profundas ficam caras | Página fixa de 25; a UI mostra o total, que exige a contagem |
| CSV limitado a 2 MB e 5.000 linhas | Planilhas maiores precisam ser divididas | Limite explícito, com mensagem clara; importação assíncrona depende da fila (Sprint 5) |
| Preview do CSV roda no navegador | Um cliente adulterado pode mostrar números errados ao usuário | O servidor reparseia e revalida o arquivo inteiro antes de gravar; o preview não autoriza nada |
| Sem histórico persistido de importações | Não dá para reabrir o relatório de uma importação passada | Contagens ficam no audit log (`contact.import_started` / `contact.import_completed`); o relatório é exibido e exportável na hora |
| Sem tela de suppression list | Supressão órfã (contato apagado) fica invisível | Visível na ficha assim que o telefone reaparece; a regra continua valendo no banco |
| Sem tela de gestão de tags/listas | Tags e listas só nascem a partir da ficha do contato ou do lote | Criação inline por nome, com reaproveitamento |
| `notFound()` responde HTTP 200 | Cliente de API leria 200 numa ficha inexistente | A página renderiza o 404 e **nenhum dado** do contato; é limitação de streaming do Next, verificada no smoke test |
| Sem convite de membros | Papéis existem, mas só o OWNER é criado | Herdado do Sprint 0 |
| `ContactStatus.INVALID` existe mas nada o atribui | Estado disponível, ainda sem fluxo | Será usado quando o provider reportar número inválido (Sprint 3) |

## Definition of Done

O fluxo exigido é real de ponta a ponta: usuário autenticado → workspace →
criar contato → persistência → editar → normalizar telefone → detectar
duplicado → tags → listas → consentimento → supressão → busca/filtro →
importar CSV → auditar → isolamento entre workspaces. Verificado por 326 testes
automatizados e 37 checagens em navegador contra o build de produção.
