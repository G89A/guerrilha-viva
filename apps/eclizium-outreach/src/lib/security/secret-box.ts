import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifragem autenticada para segredos guardados no banco (hoje: o access token
 * da Meta, quando a credencial é por workspace).
 *
 * AES-256-GCM: confidencialidade e integridade. Um ciphertext adulterado falha
 * na verificação da tag em vez de decifrar em lixo.
 *
 * Formato: `v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>`
 * A versão no prefixo permite trocar de algoritmo depois sem adivinhação.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, tamanho recomendado para GCM
const KEY_LENGTH = 32;

/** Rótulo de domínio do HKDF: separa esta chave de qualquer outro uso do AUTH_SECRET. */
const HKDF_INFO = 'eclizium:meta-credential:v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Deriva a chave de 256 bits.
 *
 * `META_CREDENTIAL_KEY` (32 bytes em base64) tem precedência. Sem ela, a chave
 * é derivada de `AUTH_SECRET` por HKDF-SHA256 com um `info` próprio — que é
 * exatamente o mecanismo previsto para separar usos de um mesmo segredo mestre,
 * e evita exigir mais uma variável obrigatória de ambiente.
 */
export function deriveKey(source: Readonly<Record<string, string | undefined>> = process.env): Buffer {
  const explicit = source.META_CREDENTIAL_KEY;
  if (explicit && explicit.length > 0) {
    const key = Buffer.from(explicit, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new SecretBoxError('META_CREDENTIAL_KEY deve ter 32 bytes em base64.');
    }
    return key;
  }

  const master = source.AUTH_SECRET;
  if (!master || master.length < 24) {
    throw new SecretBoxError(
      'Sem chave de cifragem: defina META_CREDENTIAL_KEY ou um AUTH_SECRET forte.',
    );
  }

  return Buffer.from(hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.alloc(0), HKDF_INFO, KEY_LENGTH));
}

export function sealSecret(plaintext: string, key: Buffer = deriveKey()): string {
  if (plaintext.length === 0) throw new SecretBoxError('Nada a cifrar.');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Lança em qualquer adulteração; nunca devolve texto parcialmente decifrado. */
export function openSecret(sealed: string, key: Buffer = deriveKey()): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('Formato de segredo inválido.');
  }

  const [, rawIv, rawTag, rawCiphertext] = parts as [string, string, string, string];

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(rawIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(rawTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(rawCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Mensagem deliberadamente genérica: distinguir "tag inválida" de "chave
    // errada" ajudaria um atacante e não ajuda o operador.
    throw new SecretBoxError('Não foi possível decifrar o segredo.');
  }
}

/**
 * Identificação não reversível de um token, para o operador distinguir qual
 * credencial está em uso.
 *
 * Deriva de um hash e NÃO carrega nenhum caractere do segredo. Um prefixo
 * literal seria quase sempre o mesmo entre tokens da Meta — não ajudaria a
 * distinguir nada e ainda colocaria material do segredo na tela e no HTML.
 */
export function fingerprintSecret(secret: string): string {
  const digest = createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 8);
  return `••••${digest}`;
}

/** Máscara para exibição em formulário: nunca envia o valor ao navegador. */
export const MASKED_SECRET = '••••••••••••••••••••••••';
