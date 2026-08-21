import { describe, expect, it } from 'vitest';
import {
  deriveKey,
  fingerprintSecret,
  openSecret,
  sealSecret,
  SecretBoxError,
} from '@/lib/security/secret-box';

const ENV = { AUTH_SECRET: 'chave-mestra-de-teste-com-tamanho-suficiente' };

describe('sealSecret / openSecret', () => {
  it('cifra e decifra de volta ao valor original', () => {
    const key = deriveKey(ENV);
    const sealed = sealSecret('EAAG-token-de-acesso', key);
    expect(openSecret(sealed, key)).toBe('EAAG-token-de-acesso');
  });

  it('nunca deixa o texto claro aparecer no ciphertext', () => {
    const key = deriveKey(ENV);
    const sealed = sealSecret('EAAG-token-de-acesso', key);
    expect(sealed).not.toContain('EAAG-token-de-acesso');
    expect(sealed.startsWith('v1.')).toBe(true);
  });

  it('produz ciphertext diferente a cada chamada (IV aleatório)', () => {
    const key = deriveKey(ENV);
    const first = sealSecret('mesmo-token', key);
    const second = sealSecret('mesmo-token', key);

    expect(first).not.toBe(second);
    expect(openSecret(first, key)).toBe(openSecret(second, key));
  });

  it('recusa ciphertext adulterado', () => {
    const key = deriveKey(ENV);
    const sealed = sealSecret('token-integro', key);
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join('.');

    expect(() => openSecret(tampered, key)).toThrow(SecretBoxError);
  });

  it('recusa tag de autenticação trocada', () => {
    const key = deriveKey(ENV);
    const sealed = sealSecret('token-integro', key);
    const parts = sealed.split('.');
    const swapped = [parts[0], parts[1], 'AAAAAAAAAAAAAAAAAAAAAA', parts[3]].join('.');

    expect(() => openSecret(swapped, key)).toThrow(SecretBoxError);
  });

  it('recusa decifrar com chave diferente', () => {
    const sealed = sealSecret('token', deriveKey(ENV));
    const otherKey = deriveKey({ AUTH_SECRET: 'uma-chave-mestra-completamente-diferente' });

    expect(() => openSecret(sealed, otherKey)).toThrow(SecretBoxError);
  });

  it.each([
    ['vazio', ''],
    ['formato errado', 'nao-e-um-segredo'],
    ['versão desconhecida', 'v9.aaa.bbb.ccc'],
    ['partes faltando', 'v1.aaa.bbb'],
  ])('recusa entrada malformada (%s)', (_label, sealed) => {
    expect(() => openSecret(sealed, deriveKey(ENV))).toThrow(SecretBoxError);
  });

  it('recusa cifrar string vazia', () => {
    expect(() => sealSecret('', deriveKey(ENV))).toThrow(SecretBoxError);
  });

  it('preserva unicode', () => {
    const key = deriveKey(ENV);
    const value = 'token-com-acentuação-e-emoji-🔐';
    expect(openSecret(sealSecret(value, key), key)).toBe(value);
  });
});

describe('deriveKey', () => {
  it('é determinística para o mesmo AUTH_SECRET', () => {
    expect(deriveKey(ENV).toString('hex')).toBe(deriveKey(ENV).toString('hex'));
  });

  it('difere entre AUTH_SECRETs diferentes', () => {
    const other = deriveKey({ AUTH_SECRET: 'outro-segredo-mestre-suficientemente-longo' });
    expect(deriveKey(ENV).toString('hex')).not.toBe(other.toString('hex'));
  });

  it('nunca é o próprio AUTH_SECRET', () => {
    expect(deriveKey(ENV).toString('utf8')).not.toBe(ENV.AUTH_SECRET);
  });

  it('prefere META_CREDENTIAL_KEY quando presente', () => {
    const explicit = Buffer.alloc(32, 7).toString('base64');
    const key = deriveKey({ ...ENV, META_CREDENTIAL_KEY: explicit });
    expect(key.toString('base64')).toBe(explicit);
  });

  it('recusa META_CREDENTIAL_KEY com tamanho errado', () => {
    expect(() => deriveKey({ ...ENV, META_CREDENTIAL_KEY: 'curta' })).toThrow(SecretBoxError);
  });

  it('recusa derivar sem material suficiente', () => {
    expect(() => deriveKey({})).toThrow(SecretBoxError);
    expect(() => deriveKey({ AUTH_SECRET: 'curto' })).toThrow(SecretBoxError);
  });
});

describe('fingerprintSecret', () => {
  it('não contém nenhum caractere do segredo', () => {
    const secret = 'EAAGabcdefghijklmnop';
    const fingerprint = fingerprintSecret(secret);

    expect(fingerprint.startsWith('••••')).toBe(true);
    expect(fingerprint).not.toContain('EAAG');
    expect(fingerprint).not.toContain('abcdefghijklmnop');
    // Nenhuma subsequência de 4+ caracteres do segredo aparece no fingerprint.
    for (let index = 0; index + 4 <= secret.length; index += 1) {
      expect(fingerprint).not.toContain(secret.slice(index, index + 4));
    }
  });

  it('é estável e distingue tokens diferentes', () => {
    expect(fingerprintSecret('token-a')).toBe(fingerprintSecret('token-a'));
    expect(fingerprintSecret('token-a')).not.toBe(fingerprintSecret('token-b'));
  });
});
