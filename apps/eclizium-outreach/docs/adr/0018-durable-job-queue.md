# ADR 0018 — Fila durável no PostgreSQL, com reserva por `SKIP LOCKED`

Status: aceito (Sprint 5)

## Contexto

Disparar uma campanha de 10 mil contatos dentro de uma requisição HTTP não
funciona: o handler estoura o tempo, o operador não sabe o que aconteceu, e um
deploy no meio do caminho perde o que faltava. O envio precisa de trabalho em
segundo plano — durável, retomável e observável.

A escolha óbvia seria um broker dedicado (SQS, Redis + BullMQ, QStash). A
escolha que fizemos foi o banco que já existe.

## Decisão

A fila é a tabela `jobs` no mesmo PostgreSQL da aplicação.

**Por que não um broker.** O envio precisa de duas garantias que um broker
externo torna caras: (1) *enfileirar e marcar o destinatário como `QUEUED` têm
de ser a mesma transação* — com broker, ou a mensagem vai e o banco não sabe, ou
o banco sabe e a mensagem se perdeu; (2) *a chave de idempotência tem de ser
verificada pelo banco*, que é onde vive a unique. Somar um broker traria uma
segunda fonte de verdade para reconciliar, mais um segredo para operar e mais um
serviço para cair — sem resolver nada que o Postgres não resolva neste volume.

Se o volume crescer a ponto de a tabela doer, a interface (`enqueueJob`,
`leaseJobs`, `completeJob`, `failJob`) é estreita o bastante para trocar a
implementação sem tocar no worker.

**Reserva, não retirada.** Um worker não *tira* o job da fila; ele **reserva**
por 60 segundos (`LEASE_DURATION_MS`):

```sql
UPDATE jobs SET status = 'LEASED', leased_by = $1, leased_until = $2
 WHERE id IN (
   SELECT id FROM jobs
    WHERE (status IN ('PENDING','FAILED') AND run_at <= now)
       OR (status = 'LEASED' AND leased_until < now)
    ORDER BY priority DESC, run_at ASC
    LIMIT $3
    FOR UPDATE SKIP LOCKED)
RETURNING id
```

`FOR UPDATE SKIP LOCKED` é o coração: dois workers pedindo lote ao mesmo tempo
nunca recebem a mesma linha — o segundo pula as travadas em vez de esperar. Sem
isso, ou os workers serializam (lento) ou processam o mesmo job (duplicado).

A cláusula `leased_until < now` é a recuperação: worker que morreu no meio —
contêiner reciclado, deploy, OOM — não trava o job para sempre. Sessenta
segundos depois ele volta a ser elegível. É por isso que a reserva expira em vez
de a retirada ser definitiva.

**Idempotência na borda.** Cada job carrega `idempotencyKey` único por
workspace. Para envio de campanha a chave é determinística:
`campaign-send:<campaignId>:<recipientId>`. Enfileirar usa
`createMany({ skipDuplicates: true })` — `INSERT … ON CONFLICT DO NOTHING`. Isso
significa que **retomar uma campanha duas vezes não cria job duplicado**, e que
o `count` retornado já diz quantos entraram de fato.

Essa decisão vem da Sprint 3 (ADR 0014): dentro de uma transação PostgreSQL, uma
violação de unique aborta a transação inteira (`25P02`); `catch(P2002)` e
`upsert` não sobrevivem à concorrência real. `ON CONFLICT DO NOTHING` sobrevive.

## Consequências

- Um `INSERT` a mais por destinatário. Aceitável: a linha é pequena e some no
  fim.
- Polling em vez de push. Um `LISTEN/NOTIFY` reduziria latência, mas o worker
  dorme 100 ms quando há trabalho — suficiente.
- A reserva de 60 s é o piso da latência de recuperação: um job de um worker
  morto espera até um minuto. Reduzir o valor aumenta o risco de reprocessar um
  job apenas lento; a barreira contra dano nesse caso é a unique de `Message`,
  não a reserva.
- Vácuo: a tabela sofre `UPDATE` frequente. Para o volume atual o autovacuum dá
  conta; se doer, particionar por status é o próximo passo.
