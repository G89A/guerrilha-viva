import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/logging/logger';
import { MAX_WEBHOOK_BYTES, parseWebhookPayload } from '@/features/webhooks/parser';
import { SIGNATURE_HEADER, verifyChallenge, verifySignature } from '@/features/webhooks/signature';
import { ingestEvent } from '@/features/webhooks/processor';

/**
 * Webhook da Meta WhatsApp Business Cloud API.
 *
 * GET  — handshake de verificação (hub.challenge).
 * POST — recepção de eventos.
 *
 * Node.js runtime: a validação da assinatura usa `node:crypto` e precisa dos
 * bytes crus do corpo.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sem cache em nenhuma hipótese: é um endpoint de efeito. */
const NO_STORE = { 'cache-control': 'no-store' } as const;

export function GET(request: NextRequest): NextResponse {
  const params = request.nextUrl.searchParams;

  const result = verifyChallenge(
    {
      mode: params.get('hub.mode'),
      token: params.get('hub.verify_token'),
      challenge: params.get('hub.challenge'),
    },
    process.env.META_WEBHOOK_VERIFY_TOKEN,
  );

  if (!result.ok) {
    // O motivo vai para o log, nunca para a resposta: dizer ao chamador que o
    // token estava errado (em vez de ausente) já é informação demais.
    logger.warn('webhook.verification_rejected', { provider: 'META', reason: result.reason });

    const status = result.reason === 'NOT_CONFIGURED' ? 503 : 403;
    return new NextResponse(null, { status, headers: NO_STORE });
  }

  logger.info('webhook.verification_succeeded', { provider: 'META' });

  // A Meta espera o challenge cru, como texto.
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  // O corpo cru é lido ANTES de qualquer parse: reserializar mudaria os bytes
  // e invalidaria a assinatura.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400, headers: NO_STORE });
  }

  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    logger.warn('webhook.payload_too_large', { provider: 'META', bytes: rawBody.length });
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: NO_STORE });
  }

  const signature = verifySignature(
    rawBody,
    request.headers.get(SIGNATURE_HEADER),
    process.env.META_APP_SECRET,
  );

  if (!signature.valid) {
    logger.warn('webhook.signature_rejected', { provider: 'META', reason: signature.reason });

    // Sem app secret configurado, a aplicação NÃO aceita webhook: processar
    // evento não verificado permitiria injetar mensagens e status falsos.
    const status = signature.reason === 'NOT_CONFIGURED' ? 503 : 403;
    return NextResponse.json({ error: 'invalid_signature' }, { status, headers: NO_STORE });
  }

  const parsed = parseWebhookPayload(rawBody);
  if (!parsed.ok) {
    logger.warn('webhook.unparseable_payload', { provider: 'META', reason: parsed.reason });
    // Corpo assinado mas ilegível: 400 é honesto e a Meta não reentrega em laço.
    return NextResponse.json({ error: parsed.reason }, { status: 400, headers: NO_STORE });
  }

  const results = { queued: 0, duplicate: 0, ignored: 0, failed: 0 };

  // Cada evento é independente: a falha de um não impede os demais.
  //
  // Aqui a requisição só persiste e enfileira. O efeito é aplicado pelo worker,
  // que é quem pode retentar com backoff — dentro do handler não haveria tempo
  // nem segunda chance.
  for (const event of parsed.events) {
    try {
      const outcome = await ingestEvent(event, { signatureValid: true });
      if (outcome.result === 'QUEUED') results.queued += 1;
      else if (outcome.result === 'DUPLICATE') results.duplicate += 1;
      else results.ignored += 1;
    } catch (error) {
      results.failed += 1;
      logger.error('webhook.event_crashed', { provider: 'META', eventType: event.kind, error });
    }
  }

  logger.info('webhook.delivery_handled', {
    provider: 'META',
    events: parsed.events.length,
    ...results,
    durationMs: Date.now() - startedAt,
  });

  // 200 mesmo com falhas de ingestão: o que deu certo já está durável e
  // enfileirado. Devolver erro faria a Meta reentregar a carga inteira em laço,
  // sem consertar a causa.
  return NextResponse.json({ received: parsed.events.length, ...results }, {
    status: 200,
    headers: NO_STORE,
  });
}
