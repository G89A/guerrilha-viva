/**
 * Detecção de pedido de descadastro na resposta do contato.
 *
 * ISTO É O QUE PROTEGE O NÚMERO. O que derruba a qualidade de um número no
 * WhatsApp não é volume — é gente apertando "Bloquear" e "Denunciar". Quem
 * responde "PARAR" e continua recebendo é exatamente quem aperta.
 *
 * Regras da comparação, cada uma com um motivo:
 *
 *   1. Compara a MENSAGEM INTEIRA, normalizada — nunca substring. "não quero
 *      parar de receber" contém "parar" e é o oposto de um descadastro.
 *   2. Ignora acentuação, caixa e pontuação: "Cancelar.", "CANCELAR" e
 *      "cancelar!" são o mesmo pedido.
 *   3. Aceita um prefixo curto de cortesia ("por favor", "quero", "favor"),
 *      porque é assim que as pessoas escrevem de verdade.
 *   4. Na dúvida, NÃO descadastra. Um falso positivo silencia um cliente que
 *      queria falar com você; um falso negativo é pego pela próxima mensagem.
 */

/** Prefixos de cortesia que não mudam a intenção do pedido. */
const COURTESY_PREFIXES = [
  'por favor',
  'porfavor',
  'favor',
  'quero',
  'gostaria de',
  'gostaria',
  'desejo',
  'eu quero',
  'me',
  'pode',
];

/** Sufixos igualmente inofensivos. */
const COURTESY_SUFFIXES = ['por favor', 'porfavor', 'favor', 'obrigado', 'obrigada'];

export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    // Remove diacríticos: "não" e "nao" precisam casar.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Pontuação vira espaço; espaços colapsam.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCourtesy(value: string): string {
  let text = value;

  for (const prefix of COURTESY_PREFIXES) {
    if (text.startsWith(`${prefix} `)) {
      text = text.slice(prefix.length + 1);
      break;
    }
  }
  for (const suffix of COURTESY_SUFFIXES) {
    if (text.endsWith(` ${suffix}`)) {
      text = text.slice(0, -(suffix.length + 1));
      break;
    }
  }

  return text.trim();
}

/**
 * `true` quando a mensagem é um pedido de descadastro.
 *
 * As palavras-chave vêm da política do workspace, então o operador pode ajustar
 * para o vocabulário do público dele.
 */
export function isOptOutMessage(body: string | null | undefined, keywords: string[]): boolean {
  if (!body) return false;

  const normalized = normalizeForMatch(body);
  if (normalized.length === 0 || normalized.length > 60) return false;

  const core = stripCourtesy(normalized);
  const normalizedKeywords = keywords
    .map((keyword) => normalizeForMatch(keyword))
    .filter((keyword) => keyword.length > 0);

  return normalizedKeywords.some((keyword) => core === keyword || normalized === keyword);
}
