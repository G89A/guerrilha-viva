import { AppError } from '@/lib/errors/app-error';

/**
 * Defence-in-depth CSRF check. Next.js already validates Origin against Host
 * for Server Actions; this repeats the check explicitly so route handlers and
 * actions share one rule, and so the rule is unit-testable.
 *
 * Requests with no Origin header (same-origin GET, server-to-server) are
 * accepted — the session cookie is SameSite=Lax, which covers the cross-site
 * form-post case that Origin would otherwise catch.
 */
export function isTrustedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  appUrl?: string,
): boolean {
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  if (host && originHost === host) return true;

  if (appUrl) {
    try {
      if (originHost === new URL(appUrl).host) return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function assertTrustedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  appUrl?: string,
): void {
  if (!isTrustedOrigin(origin, host, appUrl)) {
    throw AppError.forbidden('Origem da requisição não confiável.');
  }
}
