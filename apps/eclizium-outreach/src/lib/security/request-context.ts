import 'server-only';
import { headers } from 'next/headers';
import { getServerEnv } from '@/lib/env';
import { assertTrustedOrigin } from '@/lib/security/origin';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Client IP as reported by the platform proxy. `x-forwarded-for` is only
 * trustworthy because Vercel rewrites it at the edge; do not trust it when
 * self-hosting behind an unvalidated proxy.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null;

  return {
    ipAddress: ipAddress && ipAddress.length > 0 ? ipAddress.slice(0, 64) : null,
    userAgent: headerList.get('user-agent')?.slice(0, 512) ?? null,
  };
}

/** Rejects a mutation whose Origin does not match this deployment. */
export async function assertSameOriginRequest(): Promise<void> {
  const headerList = await headers();
  assertTrustedOrigin(
    headerList.get('origin'),
    headerList.get('host'),
    getServerEnv().APP_URL,
  );
}
