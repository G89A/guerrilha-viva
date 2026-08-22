# ADR 0026 — Proteção do número: o que fazemos e o que recusamos fazer

Status: aceito (Sprint 8)

## Contexto

Quem opera disparo em massa no WhatsApp chama de "antiban" duas coisas
completamente diferentes, e confundi-las é o que destrói contas.

**A primeira é evasão:** atraso aleatório para "parecer humano", embaralhar o
texto para driblar detecção de spam, aquecer números, rotacionar números depois
de um bloqueio, cliente não oficial, manipulação de impressão digital do
dispositivo, proxy rotativo.

**A segunda é redução de reclamação:** não mandar para quem não pediu, parar de
mandar para quem pediu para parar, não mandar demais, não mandar de madrugada,
e parar quando o provedor avisa que a qualidade caiu.

## Decisão

**A primeira categoria não é implementada, e não deve ser.** Não há atraso
aleatório com intenção de disfarce, variação de texto, aquecimento de número,
rotação de identidade nem cliente não oficial em lugar nenhum deste código.

Dois motivos, e o segundo é o que importa na prática:

1. É proibido pelas regras deste produto e pela política da Meta.
2. **Não funciona.** O que rebaixa um número não é o padrão de envio parecer
   automático — envio pela Cloud API é automático por definição, e a Meta sabe
   disso. O que rebaixa é o comportamento de quem RECEBE: bloqueio e denúncia. A
   Meta mede exatamente isso, e mede depois da mensagem chegar. Nenhum disfarce
   no envio muda o que a pessoa do outro lado faz ao receber algo que não pediu.

Rotação de número após bloqueio é o pior dos casos: é o padrão que a Meta trata
como evasão deliberada, e a punição sobe de número para conta inteira.

**A segunda categoria é o produto desta sprint**, porque é o que de fato
protege:

| Freio | Por quê |
|---|---|
| Descadastro automático por palavra-chave | Quem pede para sair e continua recebendo é exatamente quem denuncia |
| Teto de frequência por contato | Volume por pessoa gera irritação; volume total, não |
| Horário silencioso | Mensagem de madrugada é denúncia quase garantida |
| Parada por qualidade | A Meta rebaixa antes de restringir; o rebaixamento é o aviso |

## O que distingue freio de disfarce, no código

Isso precisa ser verificável por quem ler o código depois, não uma promessa:

- **É determinístico.** Nenhuma decisão de envio depende de aleatoriedade. O
  jitter do backoff (ADR 0019) é espalhamento de carga entre falhas simultâneas,
  documentado como tal, e não varia com a intenção de parecer humano.
- **É configurável e visível.** Cada freio tem tela, valor explícito e aparece no
  relatório. Disfarce, por natureza, é escondido.
- **É restritivo, nunca permissivo.** Todo freio aqui só pode REDUZIR envio.
  Nenhum deles existe para fazer passar algo que passaria menos sem ele.
- **O bloqueio por qualidade não oferece saída lateral.** Quando a qualidade
  bloqueia, a tela diz para corrigir a causa — e diz explicitamente que trocar de
  número seria rotação de identidade, proibida.

## Detalhes que custaram decisão

**A comparação de descadastro é com a mensagem inteira, nunca substring.**
"não quero parar de receber" contém "parar". Silenciar esse cliente por engano é
pior que perder um descadastro — o descadastro perdido é pego na próxima
mensagem; o cliente silenciado por engano nunca mais é ouvido.

Acentuação, caixa e pontuação são ignoradas, e um prefixo curto de cortesia
("por favor", "quero") é tolerado, porque é assim que as pessoas escrevem.

**O horário silencioso ADIA, não descarta.** O job volta para a fila com hora
marcada, sem gastar tentativa. Descartar transformaria uma regra de educação em
perda de mensagem.

**O teto de frequência conta só campanha.** Resposta manual da Inbox é conversa
que o contato começou; limitá-la seria impedir atendimento.

**Qualidade desconhecida não bloqueia.** `UNKNOWN` significa que não perguntamos
ou não entendemos a resposta — e travar o produto por ignorância nossa seria
transformar falta de informação em falha. Mas a prontidão mostra que a leitura
está velha, para a decisão ser de quem opera.

## Consequências

- Uma consulta a mais por envio (frequência). Indexada por
  `(workspaceId, contactId)` via `messages`, e o custo é irrelevante perto de uma
  chamada HTTP à Meta.
- Campanha noturna simplesmente não sai à noite. É intencional, e a tela avisa.
- A leitura de qualidade **não foi validada contra a Meta real**: o campo
  `quality_rating` está documentado, mas nada aqui viu uma resposta verdadeira.
  Valor desconhecido cai em `UNKNOWN` em vez de virar verde.
