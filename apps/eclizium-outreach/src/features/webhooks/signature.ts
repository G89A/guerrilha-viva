import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da assinatura `X-Hub-Signature-256` da Meta.
 *
 * A Meta assina o corpo CRU com HMAC-SHA256 usando o app secret. Qualquer
 * reserialização (parse + stringify) muda os bytes e invalida a assinatura —
 * por isso o corpo tem de ser lido como texto antes de qualquer parse.
 */

export const SIGNATURE_HEADER = 'x-hub-signature-256';

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: 'NOT_CONFIGURED' | 'MISSING_HEADER' | 'MALFORMED_HEADER' | 'MISMATCH' };

/**
 * Compara em tempo constante. Uma comparação normal vazaria, pelo tempo de
 * resposta, quantos bytes iniciais o atacante acertou.
 */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function computeSignature(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

/**
 * Sem app secret configurado o resultado é `NOT_CONFIGURED` — e o chamador
 * RECUSA a requisição. Aceitar webhook não verificado permitiria a qualquer um
 * injetar mensagens recebidas e status falsos no CRM.
 */
export function verifySignature(
  rawBody: string,
  headerValue: string | null | undefined,
  appSecret: string | null | undefined,
): SignatureResult {
  if (!appSecret) return { valid: false, reason: 'NOT_CONFIGURED' };
  if (!headerValue) return { valid: false, reason: 'MISSING_HEADER' };
  if (!headerValue.startsWith('sha256=')) return { valid: false, reason: 'MALFORMED_HEADER' };

  const expected = computeSignature(rawBody, appSecret);
  return safeEqual(headerValue, expected) ? { valid: true } : { valid: false, reason: 'MISMATCH' };
}

/**
 * Verificação do webhook (handshake GET). A Meta chama com `hub.mode=subscribe`,
 * `hub.verify_token` e `hub.challenge`; devolvemos o challenge apenas se o
 * token bater exatamente.
 */
export type VerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'MISSING_PARAMS' | 'BAD_MODE' | 'BAD_TOKEN' };

export function verifyChallenge(
  params: { mode?: string | null; token?: string | null; challenge?: string | null },
  verifyToken: string | null | undefined,
): VerificationResult {
  if (!verifyToken) return { ok: false, reason: 'NOT_CONFIGURED' };
  if (!params.mode || !params.token || !params.challenge) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  if (params.mode !== 'subscribe') return { ok: false, reason: 'BAD_MODE' };
  if (!safeEqual(params.token, verifyToken)) return { ok: false, reason: 'BAD_TOKEN' };

  return { ok: true, challenge: params.challenge };
}
