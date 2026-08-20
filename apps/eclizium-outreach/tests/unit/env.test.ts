import { describe, expect, it } from 'vitest';
import { getMetaEnvState } from '@/lib/env';

const COMPLETE = {
  META_ACCESS_TOKEN: 'EAAG-token',
  META_PHONE_NUMBER_ID: '1234567890',
  META_WABA_ID: '0987654321',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
  META_APP_SECRET: 'app-secret',
  META_GRAPH_API_VERSION: 'v21.0',
} satisfies Record<string, string>;

describe('getMetaEnvState', () => {
  it('reports NOT_CONFIGURED with the exact missing keys', () => {
    const state = getMetaEnvState({ META_ACCESS_TOKEN: 'EAAG-token' });

    expect(state.configured).toBe(false);
    if (state.configured) return;
    expect(state.missing).toEqual([
      'META_APP_SECRET',
      'META_PHONE_NUMBER_ID',
      'META_WABA_ID',
      'META_WEBHOOK_VERIFY_TOKEN',
    ]);
  });

  it('treats an empty string as missing, not as configured', () => {
    const state = getMetaEnvState({ ...COMPLETE, META_APP_SECRET: '' });

    expect(state.configured).toBe(false);
    if (state.configured) return;
    expect(state.missing).toContain('META_APP_SECRET');
  });

  it('reports configured when every variable is present', () => {
    const state = getMetaEnvState(COMPLETE);

    expect(state.configured).toBe(true);
    if (!state.configured) return;
    expect(state.env.META_PHONE_NUMBER_ID).toBe('1234567890');
  });

  it('defaults the Graph API version', () => {
    const { META_GRAPH_API_VERSION: _omitted, ...withoutVersion } = COMPLETE;
    const state = getMetaEnvState(withoutVersion);

    expect(state.configured).toBe(true);
    if (!state.configured) return;
    expect(state.env.META_GRAPH_API_VERSION).toBe('v21.0');
  });
});
