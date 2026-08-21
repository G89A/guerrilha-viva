/**
 * Constantes de resposta compartilhadas entre servidor e navegador.
 *
 * Vive fora de `reply-service.ts` de propósito: aquele módulo é `server-only` e
 * importá-lo de um componente de cliente arrastaria código de servidor para o
 * bundle — o build recusa, e com razão.
 */

/** Teto de caracteres de uma resposta manual. */
export const MAX_REPLY_LENGTH = 4096;

/** Janela de atendimento da Meta: 24 horas desde a última mensagem do contato. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
