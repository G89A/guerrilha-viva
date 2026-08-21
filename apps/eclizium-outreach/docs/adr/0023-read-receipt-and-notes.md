# ADR 0023 — Confirmação de leitura e notas internas: o que vai para fora é sempre explícito

Status: aceito (Sprint 6)

## Contexto

A Inbox ganhou duas coisas que parecem inofensivas e não são: confirmar leitura
no WhatsApp e escrever notas internas. As duas mexem com a fronteira entre o que
fica na equipe e o que chega ao contato.

## Decisão

### Confirmação de leitura é ato explícito

Existem **três** conceitos de "lido" neste produto, e confundi-los seria fácil:

| Conceito | Onde | O que significa |
|---|---|---|
| `Conversation.unreadCount` | CRM | quantas mensagens a equipe ainda não abriu aqui |
| `MessageStatus.READ` | webhook | o CONTATO leu o que NÓS enviamos |
| `Message.readReceiptAt` | Sprint 6 | NÓS confirmamos à Meta que lemos a mensagem do contato |

Abrir a conversa zera o contador do CRM e **não** conta nada a ninguém.
Confirmar leitura ao WhatsApp — o tique azul que o contato vê — é botão separado.

Isso é deliberado: é comunicação para fora. Um contato pode escolher não sinalizar
leitura, e uma equipe pode ler uma mensagem sem querer sinalizar que leu. Fazer
isso automaticamente ao abrir a tela tiraria essa escolha de quem atende.

A marca local só é gravada **depois** que a Meta aceita. Marcar antes registraria
uma confirmação que talvez nunca tenha acontecido — e este produto não registra
sucesso que não teve.

Só a última mensagem recebida é enviada: a Meta marca as anteriores da mesma
conversa junto, então repetir por mensagem gastaria cota sem efeito extra.

### Nota interna nunca sai

`ConversationNote` não tem caminho para o provider. Não existe função que
transforme nota em mensagem, e há teste afirmando que criar nota não cria
`Message`.

Na tela, o bloco de notas é visualmente diferente do compositor — cor, ícone e
aviso explícito de que só a equipe vê. Uma nota confundida com resposta vira uma
mensagem que o contato acha que recebeu e não recebeu, e o operador só descobre
quando o cliente cobra.

### Resposta rápida preenche, não envia

Clicar numa resposta rápida escreve o texto no campo e devolve o foco. O envio
continua sendo um clique separado, deliberado. Atalho que dispara mensagem é
mensagem enviada sem querer para uma pessoa real.

Texto puro, sem variáveis: substituição de variável tem política própria (o que
fazer quando o valor falta) e trazer isso para cá sem a política produziria
mensagem com lacuna visível.

## Consequências

- Mais um clique para confirmar leitura. É o preço de não decidir pelo operador
  o que ele comunica ao contato.
- O contador do CRM e o tique azul podem divergir — e isso é o comportamento
  correto, não um bug.
- Notas não são editáveis nem apagáveis pela tela: são registro do atendimento.
