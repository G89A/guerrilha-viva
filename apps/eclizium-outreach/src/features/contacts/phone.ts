import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Ponto único de normalização e validação de telefone.
 *
 * Nenhum outro módulo pode normalizar telefone por conta própria: a identidade
 * de um contato dentro do workspace é o E.164 produzido aqui, e duas regras
 * divergentes gerariam contatos duplicados que a constraint não pega.
 *
 * Isomórfico de propósito — a mesma função roda no preview do CSV no navegador
 * e na importação no servidor, para que o que o usuário vê seja o que grava.
 */

export const DEFAULT_PHONE_REGION = 'BR';

/** Acima disso não é telefone; é tentativa de gastar CPU do parser. */
const MAX_INPUT_LENGTH = 40;

export type PhoneErrorCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'UNPARSEABLE'
  | 'INVALID_NUMBER';

export interface NormalizedPhone {
  /** Forma canônica, ex.: `+5585999999999`. */
  e164: string;
  /** ISO 3166-1 alpha-2 detectado, quando o parser consegue determinar. */
  country: string | null;
  /** Forma nacional legível, ex.: `(85) 99999-9999`. */
  national: string;
}

export type PhoneResult =
  | { ok: true; phone: NormalizedPhone }
  | { ok: false; code: PhoneErrorCode; message: string };

const MESSAGES: Record<PhoneErrorCode, string> = {
  EMPTY: 'Informe um telefone.',
  TOO_LONG: 'Telefone longo demais.',
  UNPARSEABLE: 'Não foi possível interpretar este telefone.',
  INVALID_NUMBER: 'Telefone inválido para o país informado.',
};

function fail(code: PhoneErrorCode): PhoneResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** `BR` → `BR`; qualquer coisa que não seja alpha-2 cai no padrão. */
export function resolveRegion(region: string | null | undefined): CountryCode {
  const candidate = (region ?? '').trim().toUpperCase();
  return (/^[A-Z]{2}$/.test(candidate) ? candidate : DEFAULT_PHONE_REGION) as CountryCode;
}

/**
 * Converte entrada livre em E.164. Um número já em formato internacional
 * (`+55…`) ignora a região; sem `+`, a região do workspace decide o DDI.
 */
export function normalizePhone(
  raw: string | null | undefined,
  region: string | null | undefined = DEFAULT_PHONE_REGION,
): PhoneResult {
  const input = (raw ?? '').trim();
  if (input.length === 0) return fail('EMPTY');
  if (input.length > MAX_INPUT_LENGTH) return fail('TOO_LONG');

  // Sem nenhum dígito não há o que interpretar; o parser aceitaria letras
  // como teclado alfanumérico (`800-FLOWERS`), o que não queremos aqui.
  if (!/\d/.test(input)) return fail('UNPARSEABLE');
  if (/[A-Za-z]/.test(input)) return fail('UNPARSEABLE');

  const parsed = parsePhoneNumberFromString(input, resolveRegion(region));
  if (!parsed) return fail('UNPARSEABLE');
  if (!parsed.isValid()) return fail('INVALID_NUMBER');

  return {
    ok: true,
    phone: {
      e164: parsed.number,
      country: parsed.country ?? null,
      national: parsed.formatNational(),
    },
  };
}

export function isValidPhone(
  raw: string | null | undefined,
  region?: string | null,
): boolean {
  return normalizePhone(raw, region).ok;
}

/**
 * Formata um E.164 já armazenado para exibição. Nunca lança: um valor legado
 * que não parseie é devolvido como está, em vez de quebrar a listagem.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
