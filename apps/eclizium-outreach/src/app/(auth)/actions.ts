'use server';

import { redirect } from 'next/navigation';
import type { AuthActionState } from '@/features/auth/action-state';
import { loginSchema, registerSchema } from '@/features/auth/schemas';
import { authenticateUser, markUserLoggedIn, registerUser } from '@/features/auth/service';
import { writeAuditLog } from '@/lib/audit/audit-log';
import {
  clearSessionCookie,
  createSession,
  getCurrentSession,
  revokeSession,
  setSessionCookie,
} from '@/lib/auth/session';
import { runAction } from '@/lib/errors/result';
import { logger } from '@/lib/logging/logger';
import {
  assertWithinLimit,
  loginRateLimiter,
  registrationRateLimiter,
} from '@/lib/security/rate-limit';
import { assertSameOriginRequest, getRequestContext } from '@/lib/security/request-context';
import { formDataToObject, parseOrThrow } from '@/lib/validation/parse';

/**
 * Sign-up. Creates user + first workspace + OWNER membership + session.
 * The redirect is performed by the client component so that a failure can
 * still be rendered back into the form.
 */
export async function registerAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return runAction('auth.register', async () => {
    await assertSameOriginRequest();

    const request = await getRequestContext();
    assertWithinLimit(registrationRateLimiter.check(request.ipAddress ?? 'unknown'));

    const input = parseOrThrow(registerSchema, formDataToObject(formData));
    const { user, workspace } = await registerUser(input);

    const { token, session } = await createSession({
      userId: user.id,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      activeWorkspaceId: workspace.id,
    });
    await setSessionCookie(token, session.expiresAt);

    await writeAuditLog({
      action: 'user.registered',
      resourceType: 'User',
      resourceId: user.id,
      workspaceId: workspace.id,
      actorUserId: user.id,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    });
    await writeAuditLog({
      action: 'workspace.created',
      resourceType: 'Workspace',
      resourceId: workspace.id,
      workspaceId: workspace.id,
      actorUserId: user.id,
      metadata: { slug: workspace.slug },
    });

    logger.info('auth.registered', { userId: user.id, workspaceId: workspace.id });
    return { redirectTo: '/dashboard' };
  });
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  return runAction('auth.login', async () => {
    await assertSameOriginRequest();

    const request = await getRequestContext();
    const input = parseOrThrow(loginSchema, formDataToObject(formData));

    const rateKey = `${input.email}:${request.ipAddress ?? 'unknown'}`;
    assertWithinLimit(loginRateLimiter.check(rateKey));

    let userId: string;
    try {
      const user = await authenticateUser(input);
      userId = user.id;
    } catch (error) {
      await writeAuditLog({
        action: 'user.login_failed',
        resourceType: 'User',
        actorType: 'SYSTEM',
        metadata: { email: input.email },
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      });
      logger.warn('auth.login_failed', { email: input.email, ip: request.ipAddress });
      throw error;
    }

    loginRateLimiter.reset(rateKey);

    const { token, session } = await createSession({
      userId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    });
    await setSessionCookie(token, session.expiresAt);
    await markUserLoggedIn(userId);

    await writeAuditLog({
      action: 'user.login_succeeded',
      resourceType: 'User',
      resourceId: userId,
      actorUserId: userId,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    });

    logger.info('auth.login_succeeded', { userId });
    return { redirectTo: '/dashboard' };
  });
}

/** Revokes the current session server-side, then clears the cookie. */
export async function logoutAction(): Promise<void> {
  const current = await getCurrentSession();

  if (current) {
    await revokeSession(current.session.id);
    await writeAuditLog({
      action: 'user.logged_out',
      resourceType: 'Session',
      resourceId: current.session.id,
      actorUserId: current.user.id,
      workspaceId: current.session.activeWorkspaceId,
    });
  }

  await clearSessionCookie();
  redirect('/login');
}
