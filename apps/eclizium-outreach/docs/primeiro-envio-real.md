# Seu primeiro envio real — número de teste da Meta

Caminho mais rápido para uma mensagem **de verdade** chegar no seu WhatsApp, sem
tocar no seu número pessoal e sem custo.

**Como funciona:** todo app da Meta ganha um número de teste. Ele envia mensagens
reais para até **5 números verificados** que você cadastrar. O seu número entra como *destinatário* — continua sendo seu WhatsApp normal,
com todo o histórico.

Tempo: 20 a 30 minutos.

---

## O que já está pronto no app

| Item | Estado |
|---|---|
| Seu contato | Cadastrado, com nome e empresa |
| Consentimento WhatsApp | `GRANTED`, com a origem registrada |
| Campanha "Primeiro disparo — meu número" | **Pronta**, com você como único destinatário |
| Fila, worker, freios de proteção | Funcionando |

Falta só a credencial. Nada mais.

---

## Passo 1 — Criar o app na Meta

1. Vá em [developers.facebook.com](https://developers.facebook.com) e entre com
   sua conta do Facebook.
2. **Meus Apps → Criar app**.
3. Em "Casos de uso", escolha **Outro** → tipo **Empresa (Business)**.
4. Dê um nome (ex.: `ECLIZIUM Outreach`) e crie.
5. No painel do app, procure o card **WhatsApp** e clique em **Configurar**.
6. Se pedir uma conta do Business, crie uma na hora — é gratuito e leva um
   minuto.

## Passo 2 — Pegar os três valores

Ainda no app, menu lateral: **WhatsApp → Configuração da API**.

Nessa tela você tem tudo:

| O que copiar | Onde está |
|---|---|
| **Token de acesso temporário** | Botão "Gerar token de acesso" no topo — vale **24 horas** |
| **Identificação do número de telefone** | Abaixo de "Enviar e receber mensagens", no campo "De" |
| **Identificação da conta do WhatsApp Business** | Logo abaixo do anterior |

> O token temporário serve perfeitamente para o teste de hoje. O permanente é o
> Passo 8 — não precisa dele agora.

## Passo 3 — Cadastrar o seu número como destinatário

Na mesma tela, no campo **Para**:

1. Clique em **Gerenciar lista de números de telefone**.
2. **Adicionar número** → digite o seu, no formato internacional (`+55 …`).
3. A Meta manda um **código pelo WhatsApp** para esse número. Digite o código.
4. Pronto: seu número agora pode receber do número de teste.

Sem esse passo, a Meta recusa o envio — e recusa com razão: o número de teste
não pode mandar mensagem para quem não confirmou.

## Passo 4 — Configurar no app

Suba o app se ainda não estiver rodando:

```bash
cd apps/eclizium-outreach
docker compose up --build
```

Entre em `http://localhost:3000` com `owner@acme.test` / `eclizium-dev-2026`.

Vá em **Configurações → Integrações** e preencha:

- **WhatsApp Business Account ID** → o valor do Passo 2
- **Phone Number ID** → o valor do Passo 2
- **Token de acesso** → o token temporário

Salve e clique em **Testar conexão**. Tem que dar verde. Se der erro de
autenticação, o token expirou (24 h) — gere outro.

> As credenciais ficam **só no servidor**, cifradas. Nunca vão para o navegador
> e nunca aparecem em log.

## Passo 5 — Sincronizar o template

Vá em **Templates** e clique em **Sincronizar**.

Duas coisas acontecem, e as duas são corretas:

- O `hello_world` aparece — ele vem aprovado junto com o número de teste, e
  basta para o primeiro envio.
- O `boas_vindas`, que veio nos dados de demonstração, é marcado
  **INDISPONÍVEL**. Ele nunca existiu na sua conta da Meta, e o app corrige isso
  sozinho em vez de continuar exibindo um template aprovado que não é.

> O app lê o estado real da Meta. Se um template não estiver aprovado lá, ele
> não fica aprovado aqui.

## Passo 6 — Desligar o horário silencioso, se for de madrugada

**Isto vai te pegar se você testar à noite.** O padrão bloqueia campanha das
21h às 8h — e quando montei sua campanha, às 2h da manhã, o envio foi adiado
exatamente como devia.

Se for testar fora desse horário, ignore este passo. Se for de madrugada:
**Configurações → Proteção do número** → desmarque "Não enviar campanha nesse
intervalo" → Salvar. **Ligue de volta depois do teste.**

## Passo 7 — Disparar

Existe uma campanha "Primeiro disparo — meu número" já pronta, com você como
único destinatário. Ela usa o `boas_vindas`, que vai ficar indisponível depois
da sincronização — então crie uma nova com o `hello_world`:
1. **Campanhas → Nova campanha**
2. Canal: WhatsApp · Template: `hello_world`
3. Audiência: busque pelos últimos dígitos do seu número
4. Sem variáveis para mapear — o `hello_world` não tem nenhuma
5. **Preparar** → deve mostrar **1 destinatário, 1 elegível**.
6. **Ensaio (dry run)** → roda tudo e não fala com a Meta. Confira a prévia.
7. **Iniciar**.

O worker envia em segundos. **A mensagem chega no seu WhatsApp.**

## Passo 8 — Depois do primeiro envio

**Token permanente** (o temporário morre em 24 h):

1. [business.facebook.com](https://business.facebook.com) → **Configurações do
   negócio → Usuários → Usuários do sistema**
2. **Adicionar** → nome, função **Administrador**
3. **Adicionar ativos** → seu app e sua conta do WhatsApp, com controle total
4. **Gerar novo token** → escolha o app → marque
   `whatsapp_business_messaging` e `whatsapp_business_management`
5. Copie e cole em Configurações → Integrações

**Webhook** (para receber status de entrega e as respostas):

- Precisa de uma URL pública. Em desenvolvimento, use
  [ngrok](https://ngrok.com): `ngrok http 3000`
- Meta → WhatsApp → Configuração → **Webhooks**
- URL: `https://SEU-NGROK/api/webhooks/meta/whatsapp`
- Token de verificação: o mesmo `META_WEBHOOK_VERIFY_TOKEN` do seu `.env`
- Assine o campo **messages**

Sem webhook o envio funciona, mas você não vê entrega, leitura nem resposta.

---

## Limites do número de teste

| Limite | Valor |
|---|---|
| Destinatários | 5 números verificados |
| Mensagens | ~1.000 por mês, grátis |
| Para quem não está na lista | Recusado |

É para validar, não para operar. Para valer, um chip separado registrado na
plataforma — nunca o seu pessoal.

## Se der errado

| Erro | Causa quase certa |
|---|---|
| `AUTHENTICATION` no teste de conexão | Token expirou — gere outro |
| Envio recusado, código 131030 | Seu número não está na lista de destinatários (Passo 3) |
| Campanha "Em execução" e nada sai | Worker parado, ou horário silencioso (Passo 6) |
| Template não aparece | Sincronize; se não está aprovado na Meta, não existe aqui |
| Prontidão diz "Bloqueado" | O painel lista o que falta, item por item |
