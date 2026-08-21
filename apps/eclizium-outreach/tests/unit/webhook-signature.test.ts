import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  verifyChallenge,
  verifySignature,
} from '@/features/webhooks/signature';

const SECRET = 'app-secret-de-teste-nao-real';
const BODY = '{"object":"whatsapp_business_account","entry":[]}';

describe('verifySignature', () => {
  it('aceita assinatura correta', () => {
    const header = computeSignature(BODY, SECRET);
    expect(verifySignature(BODY, header, SECRET)).toEqual({ valid: true });
  });

  it('recusa assinatura de outro segredo', () => {
    const header = computeSignature(BODY, 'outro-segredo');
    expect(verifySignature(BODY, header, SECRET)).toEqual({ valid: false, reason: 'MISMATCH' });
  });

  it('recusa quando o corpo muda um único byte', () => {
    const header = computeSignature(BODY, SECRET);
    const adulterado = BODY.replace('entry', 'entrY');
    expect(verifySignature(adulterado, header, SECRET)).toEqual({
      valid: false,
      reason: 'MISMATCH',
    });
  });

  it('recusa corpo reserializado, mesmo semanticamente igual', () => {
    const header = computeSignature(BODY, SECRET);
    // JSON.parse + stringify muda os bytes; a assinatura é sobre os bytes.
    const reserializado = JSON.stringify(JSON.parse(BODY));
    if (reserializado !== BODY) {
      expect(verifySignature(reserializado, header, SECRET).valid).toBe(false);
    }
  });

  it.each([
    ['sem cabeçalho', null, 'MISSING_HEADER'],
    ['cabeçalho vazio', '', 'MISSING_HEADER'],
    ['sem prefixo sha256', 'abc123', 'MALFORMED_HEADER'],
    ['prefixo errado', 'sha1=abc123', 'MALFORMED_HEADER'],
  ])('recusa %s', (_label, header, reason) => {
    const result = verifySignature(BODY, header, SECRET);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe(reason);
  });

  it('sem app secret configurado, recusa em vez de aceitar sem verificar', () => {
    const header = computeSignature(BODY, SECRET);
    for (const secret of [null, undefined, '']) {
      const result = verifySignature(BODY, header, secret);
      expect(result.valid).toBe(false);
      if (result.valid) return;
      expect(result.reason).toBe('NOT_CONFIGURED');
    }
  });

  it('assinatura de tamanho diferente não passa', () => {
    expect(verifySignature(BODY, 'sha256=abc', SECRET).valid).toBe(false);
  });

  it('corpo vazio ainda é assinável e verificável', () => {
    expect(verifySignature('', computeSignature('', SECRET), SECRET)).toEqual({ valid: true });
  });

  it('produz o formato que a Meta envia', () => {
    expect(computeSignature(BODY, SECRET)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe('verifyChallenge', () => {
  const TOKEN = 'verify-token-de-teste';

  it('devolve o challenge quando tudo confere', () => {
    const result = verifyChallenge(
      { mode: 'subscribe', token: TOKEN, challenge: '1158201444' },
      TOKEN,
    );
    expect(result).toEqual({ ok: true, challenge: '1158201444' });
  });

  it('recusa token errado', () => {
    const result = verifyChallenge(
      { mode: 'subscribe', token: 'errado', challenge: '123' },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, reason: 'BAD_TOKEN' });
  });

  it('recusa token com prefixo correto mas incompleto', () => {
    const result = verifyChallenge(
      { mode: 'subscribe', token: TOKEN.slice(0, -1), challenge: '123' },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, reason: 'BAD_TOKEN' });
  });

  it('recusa modo diferente de subscribe', () => {
    const result = verifyChallenge(
      { mode: 'unsubscribe', token: TOKEN, challenge: '123' },
      TOKEN,
    );
    expect(result).toEqual({ ok: false, reason: 'BAD_MODE' });
  });

  it.each([
    ['sem modo', { token: 'x', challenge: '1' }],
    ['sem token', { mode: 'subscribe', challenge: '1' }],
    ['sem challenge', { mode: 'subscribe', token: 'x' }],
    ['tudo vazio', {}],
  ])('recusa parâmetros incompletos (%s)', (_label, params) => {
    expect(verifyChallenge(params, TOKEN)).toEqual({ ok: false, reason: 'MISSING_PARAMS' });
  });

  it('sem verify token configurado, recusa', () => {
    const result = verifyChallenge(
      { mode: 'subscribe', token: 'qualquer', challenge: '1' },
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });
});
