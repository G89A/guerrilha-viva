# ADR 0022 — Mídia recebida é buscada sob demanda e não é armazenada

Status: aceito (Sprint 6)

## Contexto

A Sprint 3 guardava os metadados da mídia (`mediaId`, mime, sha256, nome) e
deixava o binário de fora, com `MediaStatus.NOT_YET_FETCHED`. A Inbox mostrava
"anexo (não baixado)" — honesto, e inútil para quem atende.

Baixar exige duas coisas da Meta: um `GET /{media-id}` que devolve uma **URL
temporária** (minutos de validade) e um segundo GET nessa URL **com o token de
acesso no header**.

## Decisão

O servidor busca na hora e transmite. Nada é armazenado.

**Por que não guardar.** Guardar exigiria um bucket, que este produto não tem
configurado. A alternativa tentadora seria salvar a URL da Meta e mandar para o
navegador — o que produziria exatamente o tipo de funcionalidade falsa que este
produto não pode ter: um link que funciona por cinco minutos e depois quebra
para sempre, ou pior, um link que carrega o token junto.

Como consequência, `NOT_YET_FETCHED` continua dizendo a verdade: o binário não
está guardado do nosso lado.

**A rota é nossa e é autenticada.** `GET /api/inbox/media/[messageId]` exige
sessão, resolve o workspace **da sessão** e busca a mensagem com o workspace no
filtro — id de outro tenant simplesmente não encontra nada, e nenhuma chamada
externa chega a acontecer.

**Allowlist de tipo, não blocklist.** O mime vem do WhatsApp: é texto de
terceiro. Servir `text/html` a partir do nosso domínio transformaria uma mídia
recebida em XSS hospedado por nós. Só imagem, vídeo, áudio e PDF são servidos,
com `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` e uma CSP
restritiva na resposta.

**Allowlist de host.** A URL do binário é escolhida pela Meta, mas o token vai
junto na requisição. Seguir um host arbitrário seria entregá-lo. Só domínios da
Meta são seguidos — e essa regra encontrou um erro real: a allowlist inicial não
tinha `fbsbx.com`, que é justamente o host que a Cloud API devolve. O teste pegou
antes de qualquer credencial real existir.

**Teto de tamanho aplicado depois de ler.** `content-length` é informado pelo
outro lado e não é confiável.

## Consequências

- Cada visualização é uma busca nova, com custo de latência e de cota da Meta.
  Mitigado por `Cache-Control: private, max-age=60` — cache do navegador de quem
  tem permissão, nunca cache compartilhado.
- Mídia de conversa antiga pode não existir mais na Meta. A tela mostra
  "indisponível" em vez de um quadro quebrado.
- Quando existir armazenamento próprio, esta rota vira o ponto natural para
  gravar o binário na primeira busca — sem mudar a interface.
