import type { ProviderErrorKind } from '@/providers/messaging/types';

/**
 * Mensagens que o usuário final vê quando o provider falha.
 *
 * Existe um único mapa porque o texto de erro da Meta é conteúdo de terceiro:
 * ele serve para diagnóstico no log, nunca para ser exibido cru. Toda camada
 * que mostra falha de provider passa por aqui.
 */
const CONNECTION_MESSAGES: Record<ProviderErrorKind, string> = {
  AUTHENTICATION:
    'Não foi possível autenticar a integração Meta. Verifique as credenciais e permissões.',
  PERMISSION:
    'O token não tem as permissões necessárias (whatsapp_business_management, whatsapp_business_messaging).',
  NOT_FOUND: 'WABA ID ou Phone Number ID não encontrado nesta conta.',
  RATE_LIMITED: 'A Meta está limitando as requisições. Tente novamente em alguns minutos.',
  TIMEOUT: 'A Meta não respondeu a tempo. Tente novamente.',
  NETWORK: 'Falha de rede ao contatar a Meta.',
  PROVIDER_UNAVAILABLE: 'A Meta está indisponível no momento.',
  MALFORMED_RESPONSE: 'A resposta da Meta veio em formato inesperado.',
  INVALID_REQUEST: 'A Meta recusou os parâmetros da requisição.',
  UNKNOWN: 'Falha inesperada ao falar com a Meta.',
};

const SEND_MESSAGES: Partial<Record<ProviderErrorKind, string>> = {
  PERMISSION: 'O token não tem permissão para enviar mensagens.',
  RATE_LIMITED: 'A Meta limitou o envio. Tente novamente em alguns minutos.',
  TIMEOUT: 'A Meta não respondeu a tempo. O envio pode ou não ter ocorrido.',
  INVALID_REQUEST: 'A Meta recusou a mensagem.',
  NOT_FOUND: 'Template ou número não encontrado na Meta.',
};

export function connectionFailureMessage(kind: ProviderErrorKind): string {
  return CONNECTION_MESSAGES[kind];
}

export function sendFailureMessage(kind: ProviderErrorKind): string {
  return SEND_MESSAGES[kind] ?? CONNECTION_MESSAGES[kind];
}
