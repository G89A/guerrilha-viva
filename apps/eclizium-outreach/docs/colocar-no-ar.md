# Colocar no ar — do zero ao primeiro disparo real

Guia de operação, não de desenvolvimento. Ao fim dele o painel mostra
**"Prontidão para disparo: Pronto"** e uma campanha sai de verdade.

Leva entre 40 minutos e alguns dias — a parte lenta não é o código, é a Meta
aprovar o número e o template.

---

## O que só você pode fazer

O código está pronto e testado, mas **quatro coisas dependem de você** e não há
como o produto contorná-las:

| Item | Por quê |
|---|---|
| Conta Meta Business com WhatsApp Business Platform | O número e o WABA são seus |
| Token de acesso permanente | Credencial da sua conta; nunca deve ser compartilhada |
| Template aprovado pela Meta | Disparo em massa **exige** template aprovado — não existe atalho |
| Consentimento dos contatos | Exigência da política da Meta e da LGPD |

Sem isso o produto reporta `NOT_CONFIGURED` e **recusa** enviar. Ele nunca
simula um envio para parecer que funcionou.

---

## Passo 1 — Banco de dados

Qualquer PostgreSQL 14+. [Neon](https://neon.tech) e
[Supabase](https://supabase.com) têm plano gratuito e servem.

Guarde duas URLs:

- `DATABASE_URL` — a de aplicação (pode ser a com *pooler*)
- `DIRECT_DATABASE_URL` — a conexão direta, exigida pelas migrations

## Passo 2 — Subir a aplicação

### Opção A — Vercel (recomendada)

1. Importe o repositório na Vercel.
2. **Root Directory:** `apps/eclizium-outreach`
3. **Build Command:** `npm run build` (já roda `prisma generate`)
4. Configure as variáveis do Passo 3.
5. Aplique as migrations uma vez, da sua máquina, apontando para o banco de
   produção:

   ```bash
   cd apps/eclizium-outreach
   DATABASE_URL="<sua url>" DIRECT_DATABASE_URL="<sua url direta>" npm run db:deploy
   ```

   **Nunca** rode `migrate dev` ou `migrate reset` contra produção.

6. Configure o cron do worker — **sem isso nada é enviado** (Passo 6).

### Opção B — Docker, um comando

Na raiz de `apps/eclizium-outreach`:

```bash
docker compose up --build
```

Sobe banco, aplica as migrations, popula dados de desenvolvimento e roda a
aplicação **e o worker**. Acesse `http://localhost:3000` e entre com
`owner@acme.test` / `eclizium-dev-2026`.

Para disparar de verdade, passe as credenciais da Meta no ambiente antes de
subir:

```bash
export META_ACCESS_TOKEN=... META_PHONE_NUMBER_ID=... META_WABA_ID=...
export META_APP_SECRET=... META_WEBHOOK_VERIFY_TOKEN=...
docker compose up --build
```

> Este compose é para **avaliação**. Os segredos nele são fixos de propósito,
> para o comando funcionar sem configuração; em produção eles vêm do ambiente da
> hospedagem e nunca de um arquivo versionado.

### Opção C — Sua máquina, sem Docker

```bash
cd apps/eclizium-outreach
npm install
cp .env.example .env      # preencha conforme o Passo 3
npm run db:deploy
npm run build
npm run start             # aplicação em :3000
npm run worker            # em OUTRO terminal — é ele que envia
```

## Passo 3 — Variáveis de ambiente

```
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
AUTH_SECRET=<32+ caracteres aleatórios>

META_ACCESS_TOKEN=<token permanente>
META_PHONE_NUMBER_ID=<id do número>
META_WABA_ID=<id da conta WhatsApp Business>
META_GRAPH_API_VERSION=v21.0

META_WEBHOOK_VERIFY_TOKEN=<string aleatória que você inventa>
META_APP_SECRET=<app secret do app Meta>

WORKER_TOKEN=<32+ caracteres aleatórios>

# Só na Vercel: mesmo valor de WORKER_TOKEN, para o cron ser aceito.
CRON_SECRET=<igual ao WORKER_TOKEN>
```

Gerar segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

As variáveis da Meta são **exclusivamente de servidor**. Nenhuma delas pode
receber o prefixo `NEXT_PUBLIC_` — isso as colocaria no bundle do navegador.

## Passo 4 — Meta WhatsApp Business Platform

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do
   tipo **Business** e adicione o produto **WhatsApp**.
2. Conecte (ou crie) a **WhatsApp Business Account** e registre o número.
   O número **não pode** estar ativo no app WhatsApp comum.
3. Anote **Phone Number ID** e **WhatsApp Business Account ID**.
4. Gere um **token permanente**: crie um usuário de sistema no Business Manager,
   dê a ele acesso ao app e ao WABA, e gere o token com as permissões:
   - `whatsapp_business_messaging` — enviar
   - `whatsapp_business_management` — ler e sincronizar templates
5. Copie o **App Secret** em Configurações → Básico.

Um token temporário (24 h) serve para testar, mas expira no meio do disparo.

## Passo 5 — Webhook

Em WhatsApp → Configuração → Webhooks:

- **URL de callback:** `https://SEU-DOMINIO/api/webhooks/meta/whatsapp`
- **Token de verificação:** o mesmo `META_WEBHOOK_VERIFY_TOKEN`
- **Campos:** assine `messages`

A Meta faz um `GET` de verificação na hora. Se falhar, confira se a aplicação já
está no ar com as variáveis carregadas.

Sem `META_APP_SECRET` configurado a rota **recusa toda entrega** em vez de
aceitar sem verificar assinatura — o comportamento é intencional.

O webhook não é obrigatório para enviar, mas sem ele você não recebe status de
entrega, leitura, nem as respostas dos contatos.

## Passo 6 — O worker (esta parte é obrigatória)

**Enfileirar não é enviar.** A campanha cria um job por destinatário; quem fala
com a Meta é o worker.

### Na Vercel — cron

`vercel.json` na raiz de `apps/eclizium-outreach`:

```json
{
  "crons": [{ "path": "/api/internal/worker/tick", "schedule": "* * * * *" }]
}
```

A Vercel envia `Authorization: Bearer $CRON_SECRET` nas chamadas de cron quando a
variável `CRON_SECRET` existe. Então **defina `CRON_SECRET` com o mesmo valor de
`WORKER_TOKEN`** e o endpoint aceita a chamada sem nenhuma configuração extra.

**Atenção ao plano:** no Hobby os crons rodam **uma vez por dia**, o que não
serve para disparo. Cadência de minuto exige plano Pro. Nos planos sem isso, duas
saídas:

- um agendador externo (cron-job.org, GitHub Actions, Upstash QStash) chamando
  `POST /api/internal/worker/tick` com `Authorization: Bearer $WORKER_TOKEN`; ou
- o worker como processo contínuo num serviço que aceite processos longos
  (Railway, Render, Fly.io, uma VM) — é a opção mais simples e mais barata.

### Em servidor próprio

```bash
npm run worker
```

Use `systemd`, `pm2` ou o supervisor da sua preferência para reiniciar sozinho.

> Se o worker parar, nada se perde: a fila é durável e o painel acusa
> "job parado há mais de 5 minutos". Mas nada sai enquanto ele estiver parado.

## Passo 7 — Primeiro acesso

O primeiro cadastro cria o workspace.

```bash
npm run db:seed   # opcional: dados de desenvolvimento
```

O seed cria `owner@acme.test` / `eclizium-dev-2026`. **Não use o seed em
produção com esses dados.**

## Passo 8 — Template aprovado

1. Crie o template no Gerenciador do WhatsApp (Meta), na categoria correta
   (`MARKETING`, `UTILITY` ou `AUTHENTICATION`).
2. Espere a aprovação — de minutos a alguns dias.
3. Em `/templates`, clique em **Sincronizar**: o produto lê o estado real da
   Meta e nunca inventa aprovação.

## Passo 9 — Contatos com consentimento

Importe em `/contacts/import` (CSV com wizard) ou cadastre à mão.

Regras que o produto aplica e não deixa contornar:

- consentimento `UNKNOWN` **nunca** vira `GRANTED` automaticamente — ter o
  telefone não é consentimento;
- quem está na lista de supressão não recebe, mesmo com consentimento;
- telefone inválido é bloqueado na preparação, não no meio do disparo.

## Passo 10 — Disparar

1. `/campaigns/new` — assistente de 9 etapas.
2. **Preparar**: congela a audiência e avalia elegibilidade contato a contato.
3. **Ensaio (dry run)**: roda tudo e **não fala com a Meta**. Use sempre antes.
4. **Iniciar**: enfileira. O worker envia, respeitando a vazão do canal.
5. Acompanhe a barra de progresso e os estados da fila na tela da campanha.

Pode pausar no meio: os jobs pendentes são removidos e retomar reenfileira.
Antes de cada envio o worker **reavalia a elegibilidade** — quem revogou
consentimento entre preparar e enviar não recebe.

---

## Proteção do número (o "antiban" que funciona)

Em `Configurações → Proteção do número`. Vale a pena configurar **antes** do
primeiro disparo, não depois do primeiro susto.

| Freio | O que faz |
|---|---|
| Descadastro automático | Quem responde "PARAR", "SAIR", "CANCELAR" entra na supressão e tem o consentimento revogado |
| Teto de frequência | Máximo de mensagens de campanha por contato numa janela (padrão: 4 a cada 7 dias) |
| Horário silencioso | Campanha não sai de madrugada; o envio é adiado, não perdido (padrão: 21h–8h) |
| Parada por qualidade | Campanha é bloqueada quando a Meta rebaixa o número para vermelho |

O que derruba um número no WhatsApp **não é volume** — é gente apertando
"Bloquear" e "Denunciar". A Meta mede isso, rebaixa a qualidade do número e
depois restringe o envio. Todos os freios acima existem para reduzir essa
chance.

**O que este produto não faz, por decisão:** atraso aleatório para parecer
humano, embaralhar texto para driblar antispam, aquecer número, rotacionar
número após bloqueio, cliente não oficial. Além de proibido pela política da
Meta, não funciona — nenhum disfarce no envio muda o que a pessoa do outro lado
faz ao receber algo que não pediu. E rotação de número após bloqueio é o padrão
que a Meta pune com a conta inteira, não só o número.

Ver `docs/adr/0026-number-protection.md`.

## Conferindo: o painel responde

Abra `/dashboard`. O cartão **Prontidão para disparo** verifica, contra o banco e
o ambiente:

| Verificação | Fica verde quando |
|---|---|
| Canal WhatsApp configurado | WABA ID, Phone Number ID e token presentes |
| Conexão testada com a Meta | o teste de conexão passou de verdade |
| Template aprovado | existe template com status `APPROVED` vindo da Meta |
| Contatos com consentimento | há contato ativo, consentido e não suprimido |
| Webhook recebendo eventos | ao menos um evento real chegou |
| Worker processando a fila | há job concluído nas últimas 24 h |
| Qualidade do número na Meta | a leitura é recente e não bloqueia o envio |

Enquanto qualquer bloqueante estiver vermelho, o cartão diz **Bloqueado** e
explica o que fazer. Ele nunca fica verde por configuração existir — fica verde
por comportamento observado.

---

## Custos

- **Meta:** cobra por conversa iniciada, com preço por país e categoria.
  Consulte a tabela oficial. Há uma cota mensal de conversas de serviço grátis.
- **Banco:** plano gratuito de Neon/Supabase aguenta bem o começo.
- **Hospedagem:** Vercel Hobby serve para avaliar; o worker contínuo pede um
  serviço que aceite processos longos.

## Limites de vazão

O canal tem `messagesPerSecond` e `sendBurst` configuráveis. O padrão é
conservador (10/s, rajada de 20). A Meta impõe limites por tier do número —
começar devagar e subir conforme a qualidade do número é o caminho.

Esse controle existe para respeitar o provedor e proteger a reputação do número.
**Não** existe, e não deve ser adaptado, para parecer humano, mascarar automação
ou escapar de detecção.

## Quando algo não funciona

| Sintoma | Onde olhar |
|---|---|
| Campanha em execução e nada sai | Prontidão → "Worker processando a fila" |
| "Desistidos" na campanha | jobs em carta morta; o motivo está na campanha |
| Webhook não verifica | `META_WEBHOOK_VERIFY_TOKEN` igual dos dois lados; app no ar |
| Nenhum evento chega | Configurações → Integrações → Eventos do webhook |
| Template não aparece | sincronize em `/templates`; se não aprovou na Meta, não existe aqui |
| Envio recusado por janela | texto livre só dentro de 24 h da última mensagem do contato |
