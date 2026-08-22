# ADR 0028 — Fila sem worker de fundo: a drenagem manual

Status: aceito

## Contexto

Enfileirar não é enviar. A campanha entra na fila e alguém precisa girar a
manivela. Até aqui existiam dois jeitos:

1. processo longo (`npm run worker`), que exige terminal ou um segundo serviço;
2. cron chamando `POST /api/internal/worker/tick`.

Nenhum dos dois serve para a instalação mais provável de quem não programa:
hospedagem serverless no plano gratuito. Lá não existe processo longo, e o cron
gratuito roda uma vez por dia — o que, para uma campanha, é o mesmo que não
existir. O resultado seria a campanha ficando "em execução" e nada saindo: a
forma mais cruel de um produto parecer quebrado, porque tudo indica sucesso.

Pior: o `vercel.json` **declarava** um cron de minuto em minuto que nunca rodou
uma vez. A rota só aceitava `POST` e o agendador da Vercel chama por `GET`.
Havia uma funcionalidade no papel, sem nada por trás — exatamente o que este
projeto não pode ter.

## Decisão

**Terceiro caminho: a pessoa gira a manivela, clicando.**

`drainWorkspaceQueue` processa a fila do workspace por alguns segundos e devolve
o que aconteceu e quanto falta. A tela chama de novo enquanto houver trabalho, e
mostra o progresso.

Três coisas que isto **não** é:

- **Não é um caminho de envio paralelo.** Chama o mesmo `runWorkerTick` do worker
  de fundo. Reserva com `FOR UPDATE SKIP LOCKED`, idempotência, recheque de
  elegibilidade, guardrails de proteção do número e limite de taxa: tudo igual.
  Há teste com seis drenagens simultâneas provando que nada sai duas vezes.
- **Não é um worker disfarçado.** Só anda enquanto a aba está aberta, e a tela
  diz isso com todas as letras. Fechou, parou. Prometer o contrário seria mentir
  sobre o que o produto faz.
- **Não é um jeito de furar o limite de envio.** Quando o limite de taxa é
  atingido, a drenagem para e avisa. Insistir só devolveria os mesmos jobs
  adiados.

## O que mudou junto

- A rota `/api/internal/worker/tick` passou a aceitar `GET` além de `POST`, e a
  aceitar `CRON_SECRET` além de `WORKER_TOKEN` — o nome que a Vercel usa no
  header que ela mesma envia. Sem nenhum segredo configurado, continua
  recusando: não existe modo aberto.
- O cron de minuto em minuto saiu do `vercel.json`. Ele não funcionava, e no
  plano gratuito não funcionaria mesmo depois de consertado. Quem tiver plano
  pago pode declará-lo de novo — agora a rota responde.
- O `buildCommand` da Vercel passou a aplicar migrations (`prisma migrate
  deploy`), como o da Render já fazia.
- A rota ganhou testes. Ela não tinha nenhum, e é por isso que o `405` do cron
  sobreviveu: serviço testado, rota não testada, defeito invisível.

## Consequência aceita

Numa campanha grande, ficar com a aba aberta é ruim. É explicitamente uma
solução de plano gratuito. Para volume, o caminho continua sendo worker de fundo
(`RUN_WORKER_IN_PROCESS` em serviço que não hiberna) ou cron de verdade — e a
tela de prontidão descreve qual dos três este deploy está usando.
