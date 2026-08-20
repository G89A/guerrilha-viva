import { describe, expect, it } from 'vitest';
import { assertTrustedOrigin, isTrustedOrigin } from '@/lib/security/origin';

describe('origin validation', () => {
  it('accepts a matching origin/host pair', () => {
    expect(isTrustedOrigin('https://app.eclizium.com', 'app.eclizium.com')).toBe(true);
  });

  it('accepts an origin matching the configured APP_URL', () => {
    expect(
      isTrustedOrigin('https://app.eclizium.com', 'internal-host', 'https://app.eclizium.com'),
    ).toBe(true);
  });

  it('rejects a cross-site origin', () => {
    expect(isTrustedOrigin('https://evil.example', 'app.eclizium.com')).toBe(false);
  });

  it('rejects a look-alike suffix domain', () => {
    expect(isTrustedOrigin('https://app.eclizium.com.evil.example', 'app.eclizium.com')).toBe(false);
  });

  it('rejects an unparseable origin', () => {
    expect(isTrustedOrigin('not-a-url', 'app.eclizium.com')).toBe(false);
  });

  it('allows requests without an Origin header', () => {
    expect(isTrustedOrigin(null, 'app.eclizium.com')).toBe(true);
    expect(isTrustedOrigin(undefined, 'app.eclizium.com')).toBe(true);
  });

  it('throws FORBIDDEN when asserting an untrusted origin', () => {
    expect(() => assertTrustedOrigin('https://evil.example', 'app.eclizium.com')).toThrowError(
      /não confiável/,
    );
  });
});
