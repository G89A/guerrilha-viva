# Destravando o cadastro na Meta

A interface da Meta muda de nome e de lugar com frequência, e é onde quase todo
mundo empaca. Aqui vão os atalhos diretos e as respostas para os pontos onde
costuma travar.

## Links diretos — pule a navegação

| Para quê | Link |
|---|---|
| Criar o app | https://developers.facebook.com/apps/create/ |
| Seus apps | https://developers.facebook.com/apps/ |
| Gerenciador do WhatsApp | https://business.facebook.com/wa/manage/ |
| Configurações do negócio | https://business.facebook.com/settings |
| Usuários do sistema (token permanente) | https://business.facebook.com/settings/system-users |

## Os cinco pontos onde trava

### 1. "Não tenho conta de desenvolvedor"

Não precisa criar nada separado. Entre em developers.facebook.com com o seu
Facebook pessoal comum — ele vira conta de desenvolvedor no primeiro acesso, de
graça. Se pedir confirmação por celular ou e-mail, é só a confirmação normal do
Facebook.

### 2. "A tela de criar app pede um tipo e não sei qual"

A Meta pergunta primeiro **o que você quer fazer**. Escolha:

- Caso de uso: **Outro** (*Other*)
- Tipo: **Empresa** (*Business*)

Se aparecer uma opção direta de WhatsApp, pode usar também — leva ao mesmo lugar.

### 3. "Está pedindo verificação do negócio"

**Para o número de teste, não precisa.** Verificação de negócio só é exigida para
número próprio em produção e volume alto.

Se a tela insistir, procure **Pular por enquanto** / *Skip for now*, ou apenas vá
direto para `WhatsApp → Configuração da API` pelo menu lateral — o número de
teste já está lá, mesmo sem verificação.

### 4. "Não acho o token / os IDs"

Menu lateral do app: **WhatsApp** → **Configuração da API**
(*API Setup* / *Primeiros passos*).

Tudo está nessa tela única:

- **Token de acesso temporário** — botão no topo, vale 24 h
- **Identificação do número de telefone** — no campo "De" (*From*)
- **Identificação da conta do WhatsApp Business** — logo abaixo

Se o menu estiver em inglês: *WhatsApp → API Setup*.

### 5. "Mandei e não chegou nada"

Quase sempre é o número de destino não confirmado. Na mesma tela, campo **Para**
(*To*) → **Gerenciar lista de números** → adicionar o seu → confirmar o código
que chega no WhatsApp.

O número de teste **só** envia para números dessa lista. É proteção da Meta, não
defeito.

---

## Enquanto isso: veja o produto funcionando sem a Meta

O **ensaio (dry run)** percorre a campanha inteira — audiência, elegibilidade,
consentimento, supressão, renderização de cada mensagem — e **não fala com a
Meta**. Nenhuma chamada externa, nenhuma mensagem enviada.

É a forma honesta de ver tudo funcionando antes de ter credencial: em
**Campanhas → sua campanha → Ensaio**.

## E os parceiros (BSP)?

Existem empresas que fazem o cadastro por você — Twilio, 360dialog, Gupshup,
Infobip. Elas resolvem a burocracia, mas **cada uma tem seu próprio endpoint e
sua própria autenticação**.

Este produto fala com `graph.facebook.com` usando token da Meta. Usar um parceiro
exigiria escrever um provider novo — trabalho de uma sprint inteira, não uma
configuração. Se quiser esse caminho, dá para fazer; só não é atalho.

**O que não é opção**, e não vai ser implementado aqui: bibliotecas não oficiais
que se passam pelo WhatsApp Web (Baileys, whatsapp-web.js, WPPConnect, Venom).
Funcionam por alguns dias e terminam com o número banido — é justamente o que a
Meta procura e pune.
