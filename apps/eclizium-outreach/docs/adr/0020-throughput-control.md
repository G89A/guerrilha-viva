# ADR 0020 — Controle de vazão por canal, com balde no banco

Status: aceito (Sprint 5)

## Contexto

A Sprint 0 trouxe um `InMemoryRateLimiter` para proteger rotas. Ele conta por
processo. Com dois workers, o teto efetivo dobra; em serverless, multiplica pelo
número de instâncias vivas. Para envio isso não serve: quem impõe o limite é a
Meta, e estourar o limite dela custa reputação do número — não um 429 educado.

## Decisão

Token bucket **persistido**, uma linha por chave em `rate_limit_buckets`, com o
canal como chave (`channel:<id>`). Todos os workers disputam o mesmo balde.

Parâmetros vêm do canal (`messagesPerSecond`, `sendBurst`), não de constante
global: WABAs diferentes têm tiers diferentes, e o operador precisa poder baixar
a vazão de um número sem tocar em código.

**Recálculo e débito em uma instrução só**, com a linha travada pelo `UPDATE`:

```sql
UPDATE rate_limit_buckets
   SET tokens = LEAST(burst, tokens + EXTRACT(EPOCH FROM (now - refilled_at)) * rate) - cost,
       refilled_at = now
 WHERE key = $1
   AND LEAST(burst, tokens + EXTRACT(EPOCH FROM (now - refilled_at)) * rate) >= cost
```

Ler o balde, decidir em JavaScript e gravar de volta seria uma corrida clássica:
dois workers leriam "resta 1 token" e ambos enviariam. Aqui, ou o `WHERE` casa e
o débito acontece atomicamente, ou não casa e o worker recebe `retryAfterMs`.

**Falta de token não é falha.** O job volta para `PENDING` com `runAt` adiante,
**sem gastar tentativa** e sem tocar no destinatário. Estar sem vazão não é
defeito do envio; tratar como falha esgotaria as cinco tentativas de uma
campanha grande em minutos.

O token consumido é devolvido (`refundToken`) quando o envio não chega a
acontecer por decisão nossa — recusa de elegibilidade, por exemplo. O que foi
para a rede não é devolvido.

## O que este mecanismo NÃO é

Registrado aqui porque é regra de produto, não detalhe técnico. O controle de
vazão existe para respeitar o limite do provider e proteger a reputação do
número. Ele **não** existe para:

- parecer humano;
- mascarar automação;
- escapar de antispam ou de detecção;
- rodar número após bloqueio.

Não há — e não deve haver — atraso aleatório com intenção de disfarce, rotação
de identidade ou variação de fingerprint neste caminho. O jitter do backoff
(ADR 0019) é espalhamento de carga e está documentado como tal.

## Consequências

- Um `UPDATE` por envio. Contenção real na linha do canal quando muitos workers
  disputam; para o volume atual, invisível.
- O balde é durável: reiniciar o worker não zera a vazão nem libera rajada.
- Precisão limitada pela granularidade do relógio do banco — o suficiente para
  um teto de segurança, não para cadência exata.
- Se a Meta devolver `RATE_LIMITED` mesmo assim, o job retenta com backoff: o
  nosso teto é o primeiro anteparo, não o único.
