# Começar do zero — os dois caminhos, separados

São duas coisas independentes. Não tente as duas ao mesmo tempo.

- **A —** ter o app rodando e acessível (não depende da Meta em nada)
- **B —** conseguir enviar pelo WhatsApp (depende da Meta)

Faça o A primeiro. Ele funciona sozinho, e você vai ver o produto inteiro.

---

# A — Ter o app rodando

## O que você precisa antes

- Conta no [GitHub](https://github.com) (gratuita)
- Conta na [Vercel](https://vercel.com) (gratuita — entre com o GitHub)

## Passo a passo

**1.** Abra [vercel.com/new](https://vercel.com/new) e entre com o GitHub.

**2.** Na lista de repositórios, procure `guerrilha-viva` e clique em **Import**.

**3.** Antes de qualquer coisa, ache **Root Directory** e clique em **Edit**.
Escolha a pasta `apps/eclizium-outreach`.

> **Se você pular este passo, o deploy falha.** O projeto está dentro de uma
> subpasta, e por padrão a Vercel procura na raiz.

**4.** Abra **Environment Variables** e adicione três. Para gerar os valores,
rode isto três vezes no terminal (ou use qualquer texto longo e aleatório):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Nome | Valor |
|---|---|
| `AUTH_SECRET` | o primeiro valor gerado |
| `WORKER_TOKEN` | o segundo valor gerado |
| `CRON_SECRET` | **exatamente o mesmo** do `WORKER_TOKEN` |

**5.** Clique em **Deploy**. Ele vai falhar dizendo que falta banco de dados.
Isso é esperado, siga em frente.

**6.** No projeto, vá na aba **Storage** → **Create Database** → **Postgres**.
Crie e conecte ao projeto.

**7.** Volte em **Deployments** → nos três pontinhos do último deploy →
**Redeploy**. Agora passa.

**8.** Crie as tabelas. Na aba **Storage**, copie a `DATABASE_URL` e rode na sua
máquina:

```bash
git clone https://github.com/G89A/guerrilha-viva
cd guerrilha-viva/apps/eclizium-outreach
npm install
DATABASE_URL="cole-a-url-aqui" npm run db:deploy
DATABASE_URL="cole-a-url-aqui" npx tsx prisma/seed.ts
```

**9.** Abra a URL que a Vercel te deu. Entre com:

- E-mail: `owner@acme.test`
- Senha: `eclizium-dev-2026`

**Troque essa senha depois** — ela é pública, está neste documento.

## Pronto: o que dá para ver sem a Meta

- **Contatos** — importação por CSV, consentimento, supressão
- **Campanhas** — construir audiência, preparar, e o **ensaio (dry run)**, que
  percorre tudo e não fala com a Meta
- **Analytics** e **Auditoria**
- **Proteção do número** — descadastro, frequência, horário silencioso

O painel vai dizer **"Prontidão: Bloqueado"** e listar o que falta. Está certo:
sem credencial da Meta, o envio não acontece — e o produto diz isso em vez de
fingir.

---

# B — Conseguir enviar pelo WhatsApp

Só faça depois que o A estiver funcionando.

## O que você precisa antes

Uma conta no Facebook. Comum, pessoal, a que você já tem. **Não precisa** de
página, de empresa, de CNPJ nem de verificação para o teste.

## Passo 1 — Virar desenvolvedor (2 minutos)

Abra https://developers.facebook.com e clique em **Começar** (canto superior
direito).

Ele vai pedir para confirmar seu e-mail ou celular e aceitar os termos. É só
isso — não existe cadastro separado, sua conta do Facebook vira conta de
desenvolvedor.

Se aparecer "Qual é a sua função?", escolha **Desenvolvedor**.

## Passo 2 — Criar o app (3 minutos)

Abra https://developers.facebook.com/apps/create/

A tela pergunta **o que você quer fazer**. As opções mudam de nome, mas você
quer chegar em "Empresa":

- Se aparecer uma lista de casos de uso → escolha **Outro** → **Avançar** →
  tipo **Empresa** → **Avançar**
- Se aparecer direto uma lista de tipos → escolha **Empresa**

Depois:

- **Nome do app:** qualquer coisa, ex.: `Eclizium`
- **E-mail de contato:** o seu
- **Conta do Business:** deixe em branco, ou crie uma na hora se ele exigir
- **Criar app** (pode pedir sua senha do Facebook de novo)

## Passo 3 — Adicionar o WhatsApp (1 minuto)

Você cai no painel do app. Role até achar o card **WhatsApp** e clique em
**Configurar**.

Se pedir para escolher ou criar uma conta do Business, crie — é gratuito,
instantâneo, e não exige documento.

## Passo 4 — Onde estão as credenciais

Menu da esquerda: **WhatsApp** → **Configuração da API**.

Nessa tela única está tudo:

| O que | Onde |
|---|---|
| Token temporário (24 h) | Botão **Gerar token de acesso**, no topo |
| Phone Number ID | Campo **De**, é a "Identificação do número de telefone" |
| WABA ID | Logo abaixo, "Identificação da conta do WhatsApp Business" |

## Passo 5 — Autorizar o seu celular a receber

Ainda nessa tela, campo **Para** → **Gerenciar lista de números de telefone** →
**Adicionar número** → digite o seu com `+55` → confirme o código que chega no
seu WhatsApp.

Sem isso a Meta recusa o envio, e recusa com razão.

## Passo 6 — Colar no app

No app, **Configurações → Integrações**: cole os três valores e clique em
**Testar conexão**.

Depois, **Templates → Sincronizar**. O `hello_world` aparece.

## Passo 7 — Disparar

**Campanhas → Nova campanha** → template `hello_world` → audiência com o seu
contato → **Preparar** → **Ensaio** → **Iniciar**.

> **Se for de madrugada, nada vai sair.** O horário silencioso bloqueia campanha
> das 21h às 8h. Desligue em **Configurações → Proteção do número** para testar,
> e ligue de volta depois.

---

## Onde pedir ajuda

Se travar, anote **em que passo** e **o que apareceu na tela** — com isso dá para
resolver. "Não funcionou" não dá.
