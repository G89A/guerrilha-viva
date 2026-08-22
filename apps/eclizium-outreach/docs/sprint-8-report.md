# Sprint 8 — Proteção do número

O pedido foi "antiban". A palavra cobre duas coisas opostas, e esta sprint
implementa uma delas e recusa a outra explicitamente.

## O que foi recusado, e por quê

**Evasão de banimento não foi implementada**: atraso aleatório para parecer
humano, variação de texto para driblar antispam, aquecimento de número, rotação
de número após bloqueio, cliente não oficial, manipulação de impressão digital.

Dois motivos, e o segundo é o prático:

1. É proibido pelas regras deste produto e pela política da Meta.
2. **Não funciona.** O que rebaixa um número não é o envio parecer automático —
   pela Cloud API ele é automático por definição, e a Meta sabe. O que rebaixa é
   o comportamento de quem RECEBE: bloqueio e denúncia, medidos depois da
   mensagem chegar. Nenhum disfarce no envio muda o que a pessoa do outro lado
   faz ao receber algo que não pediu.

Rotação de número após bloqueio é o pior caso: é o padrão que a Meta trata como
evasão deliberada, e a punição sobe de número para conta inteira.

Registrado em ADR 0026, com os critérios que distinguem freio de disfarce no
próprio código — determinismo, visibilidade e o fato de todo freio só poder
REDUZIR envio.

## O que foi construído

### Descadastro automático (o maior ganho)

`SuppressionReason.OPT_OUT` existia desde a Sprint 1 e **nada o disparava**. Um
contato respondia "PARAR", continuava recebendo, e apertava "Bloquear" — que é
exatamente o que derruba o número.

Agora a resposta é verificada contra as palavras-chave do workspace e, quando é
pedido de saída, três coisas acontecem: entra na supressão (que vence tudo e é
chaveada por telefone, sobrevivendo a reimportação), o consentimento é revogado,
e fica registrado na auditoria com origem.

A comparação é com a **mensagem inteira**, nunca substring: "não quero parar de
receber" contém "parar" e é o oposto de um descadastro. Acento, caixa e
pontuação são ignorados; prefixo de cortesia ("por favor", "quero") é tolerado.

### Freios antes de cada envio

| Freio | Comportamento |
|---|---|
| Qualidade vermelha | **Bloqueia** — nada sai |
| Teto de frequência por contato | **Bloqueia** aquele contato nessa campanha |
| Horário silencioso | **Adia** — volta para a fila sem gastar tentativa |

A ordem importa: o que impede para sempre roda antes do que só adia. Adiar um
envio que seria bloqueado de qualquer jeito só gastaria fila.

O teto conta **só campanha**. Resposta manual da Inbox é conversa que o contato
começou; limitá-la seria impedir atendimento.

### Saúde do número

Leitura de `quality_rating` e `messaging_limit_tier` na Meta, gravada no canal e
exibida em `Configurações → Proteção do número` e na prontidão do painel.

Qualidade desconhecida vira `UNKNOWN`, **nunca verde**: presumir saúde a partir de
uma resposta que não entendemos é o tipo de otimismo que custa um número.

Mudança de qualidade vira registro de auditoria; consulta sem mudança, não —
consultar de hora em hora não pode virar ruído no registro.

### Subir com um comando

`Dockerfile` e `docker-compose.yml`: banco, migrations, seed, aplicação **e
worker**. O worker está no compose de propósito — sem ele, campanha enfileira e
nada sai.

## Verificação parcial do Docker

**A imagem não foi construída neste ambiente.** O proxy do sandbox bloqueia o
download de camadas do Docker Hub (403 em `production.cloudfront.docker.com`).

O que foi verificado:

- `docker compose config` valida o arquivo sem erro;
- `output: 'standalone'` produz `.next/standalone/server.js` na raiz — que é a
  premissa do `CMD` do Dockerfile, e o ponto que quebraria num monorepo;
- `public/` não existe neste projeto, e a linha que o copiava foi removida
  (copiar diretório inexistente falha o build).

O que **não** foi verificado: a construção da imagem de ponta a ponta e a subida
dos quatro serviços juntos. Se falhar na sua máquina, o erro provável está nas
camadas de sistema, não na aplicação.

## Bugs encontrados e corrigidos

| Bug | Como apareceu |
|---|---|
| **Descadastro nunca acontecia** — o motivo existia no modelo e nada o disparava | Auditoria de código no início da sprint |
| `Dockerfile` copiava `public/`, que não existe | Revisão antes de tentar construir |
| Teste de fronteira do horário silencioso com hora errada | O teste falhou e a leitura mostrou que a expectativa é que estava errada — 08:00 já é fora do silêncio quando o fim é 8 |

## Um efeito colateral que valeu a pena

Ligar o horário silencioso quebrou **17 testes de envio** — os que existiam
desde a Sprint 5. Não porque o freio estivesse errado: porque a suíte rodou às
01h50 de São Paulo, dentro da janela de silêncio, e os envios foram adiados como
deviam.

O defeito era da suíte, não do produto: um conjunto de testes cujo resultado
depende da hora em que roda passaria de dia e falharia de madrugada. A correção
foi tornar a política explícita nos testes de envio — o padrão do produto segue
21h–8h, e o comportamento do silêncio tem testes próprios que controlam o
relógio em vez de torcer por ele.

## Concorrência — resultados

| Cenário | Simultâneas | Resultado |
|---|---|---|
| Pedidos de descadastro do mesmo contato | 6 | Uma supressão só; as demais reconhecem que já existe |
| Gravações da política | 20 | Uma linha só, estado final válido |

## Limitações conhecidas

1. **A leitura de qualidade não foi validada contra a Meta real.** O campo está
   documentado, mas nada aqui viu uma resposta verdadeira. Valor desconhecido
   cai em `UNKNOWN`.
2. **A qualidade não é consultada sozinha.** É preciso clicar em "Consultar
   agora" ou chamar o serviço. Um job periódico seria o próximo passo.
3. **A Meta também envia mudança de qualidade por webhook** (`account_update`),
   e só assinamos `messages`. Assinar o outro campo daria aviso em tempo real.
4. **Não há reinscrição por palavra-chave.** Quem pediu para sair volta só por
   ação manual do operador — coerente com a regra de que consentimento não se
   presume.
5. **O teto de frequência é global do workspace**, não por campanha nem por
   segmento.
6. **Horário silencioso é um intervalo só**, igual todos os dias. Não há regra
   diferente para fim de semana.
7. **Não há detecção de bloqueio individual.** A Meta não informa quem bloqueou;
   só o efeito agregado na qualidade.
8. **A imagem Docker não foi construída aqui** (ver acima).

## Verificação

| Portão | Resultado |
|---|---|
| `lint` | limpo |
| `typecheck` | limpo |
| `test` | 1151 testes, 64 arquivos, todos passando (79 novos nesta sprint) |
| `build` | sucesso |
| Smoke da proteção (navegador real) | 14/14 |
| `docker compose config` | válido |
| Construção da imagem Docker | **não verificada** — proxy do sandbox bloqueia o Docker Hub |

**REAL META VALIDATION: PENDING.**
