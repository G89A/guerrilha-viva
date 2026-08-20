import 'server-only';
import { getMetaEnvState } from '@/lib/env';

export type IntegrationState =
  | { status: 'NOT_CONFIGURED'; missing: string[] }
  | { status: 'CONFIGURED'; phoneNumberId: string; wabaId: string; graphApiVersion: string };

/**
 * Reports whether the Meta WhatsApp Business Cloud API credentials are present.
 *
 * IMPORTANT: "CONFIGURED" here means only that the environment variables exist.
 * It does NOT mean the token is valid or the number is live — that requires a
 * real call to the Graph API, which lands in SPRINT 2. Nothing in the UI may
 * present this as a working connection.
 */
export function getMetaIntegrationState(): IntegrationState {
  const state = getMetaEnvState();

  if (!state.configured) {
    return { status: 'NOT_CONFIGURED', missing: state.missing };
  }

  return {
    status: 'CONFIGURED',
    // Identifiers only. Tokens and the app secret never leave the server.
    phoneNumberId: state.env.META_PHONE_NUMBER_ID,
    wabaId: state.env.META_WABA_ID,
    graphApiVersion: state.env.META_GRAPH_API_VERSION,
  };
}

export const META_ENV_KEYS = [
  'META_ACCESS_TOKEN',
  'META_PHONE_NUMBER_ID',
  'META_WABA_ID',
  'META_WEBHOOK_VERIFY_TOKEN',
  'META_APP_SECRET',
] as const;
