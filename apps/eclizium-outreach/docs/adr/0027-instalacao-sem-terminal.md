# ADR 0027 — Instalação sem terminal: a receita não pode pedir o que ninguém tem

Status: aceito

## Contexto

O produto estava correto e inacessível ao mesmo tempo. Quem precisava usá-lo não
programa: não tem terminal, não instala Docker, não edita arquivo de
configuração. Três tentativas de instalação falharam antes de alguém enxergar
uma tela.

O blueprint da Render (`render.yaml`) resolvia a maior parte disso — cria banco,
serviço, segredos e aplica migrations sem um comando sequer. Mas ele carregava
três defeitos que só apareceriam depois do primeiro clique, que é o pior momento
possível para aparecer.

## Os três defeitos

### 1. `next start` não funciona com `output: 'standalone'`

O `next.config.ts` ligava `standalone` por padrão, para a imagem Docker ficar
enxuta. O blueprint sobe com `npm run start`, que é `next start`. O Next recusa
essa combinação e manda usar `node .next/standalone/server.js`.

O build passaria. O deploy quebraria depois, em produção, com uma mensagem que
não faz sentido para quem não escreveu o arquivo.

**Decisão:** `standalone` passou a ser opt-in por `BUILD_STANDALONE=true`, ligada
apenas no `Dockerfile`. Quem usa o comando normal recebe o comportamento normal.

### 2. Cinco campos em branco na hora de instalar

O blueprint declarava `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`,
`META_WABA_ID`, `META_APP_SECRET` e `META_WEBHOOK_VERIFY_TOKEN` como
`sync: false` — isto é, "pergunte ao instalador".

Nenhum desses valores existe no momento da instalação: eles vêm de um cadastro
na Meta que só acontece depois. Pedir os cinco ali é apresentar cinco formulários
sem resposta possível para alguém que ainda não viu o produto funcionar.

**Decisão:** o blueprint não pergunta nada. Token, WABA ID e Phone Number ID são
preenchidos dentro do produto (cifrados no banco, por workspace — ADR 0011).
`META_WEBHOOK_VERIFY_TOKEN` passou a ser gerado pela plataforma, porque é uma
string inventada, não um dado da Meta. `META_APP_SECRET` continua fora: vem da
Meta, não pode ser gerado, e é do app — não do workspace. É acrescentado depois,
nas variáveis de ambiente da hospedagem, e o produto diz exatamente isso.

### 3. Orientação escrita para outro tipo de instalação

A verificação de prontidão mandava `Rode `npm run worker`` — conselho impossível
de seguir para quem instalou por blueprint, e que descreve um deploy diferente do
que a pessoa tem na frente.

**Decisão:** a orientação passou a depender de como o worker existe naquele
deploy. Com `RUN_WORKER_IN_PROCESS`, ela explica que o worker roda junto com a
aplicação e que a fila anda enquanto o serviço estiver no ar. Sem ele, continua
sendo o comando ou o cron.

## Consequência aceita: hibernação

No plano gratuito da Render o serviço hiberna sem acesso, e o worker hiberna
junto. Para o primeiro envio isso é indiferente — quem testa está com a tela
aberta. Para campanha grande não serve, e está escrito tanto no `render.yaml`
quanto na tela de prontidão. Não foi disfarçado.

## Como isto foi verificado

Sem acesso à Render a partir do ambiente de desenvolvimento, a checagem foi feita
localmente reproduzindo exatamente o ambiente que o blueprint entrega: apenas
`DATABASE_URL`, `AUTH_SECRET`, `RUN_WORKER_IN_PROCESS`, `NODE_VERSION`,
`META_GRAPH_API_VERSION` e `META_WEBHOOK_VERIFY_TOKEN`, com todas as demais
variáveis da Meta ausentes, `NODE_ENV=production` e `next start`.

Resultado: servidor de pé, worker em processo iniciado, `/login` e `/register`
em 200, `/api/health` reportando `database: up` e `messaging: NOT_CONFIGURED`,
cadastro de conta concluído e as sete telas principais abertas sem um único erro
de console.

Isso não substitui um deploy real na Render — a plataforma pode recusar o
arquivo por algo que não dá para observar daqui. É por isso que existe um
caminho manual documentado, com os mesmos comandos e as mesmas variáveis.
