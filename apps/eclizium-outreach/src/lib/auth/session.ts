import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Prisma, Session, User } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getServerEnv } from '@/lib/env';
import { randomToken, sha256 } from '@/lib/security/crypto';

export const SESSION_COOKIE_NAME = 'eclizium_session';

/** How stale `lastUsedAt` may get before we spend a write to refresh it. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface AuthenticatedSession {
  session: Session;
  user: User;
}

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  activeWorkspaceId?: string | null;
}

export interface CreatedSession {
  /** Raw token — returned once, never stored. */
  token: string;
  session: Session;
}

export async function createSession(
  input: CreateSessionInput,
  client: Prisma.TransactionClient = prisma,
): Promise<CreatedSession> {
  const env = getServerEnv();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  const session = await client.session.create({
    data: {
      userId: input.userId,
      tokenHash: sha256(token),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      activeWorkspaceId: input.activeWorkspaceId ?? null,
    },
  });

  return { token, session };
}

/**
 * Resolves the session for the current request. Wrapped in `cache` so that
 * several server components in one render share a single database round-trip.
 */
export const getCurrentSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return validateSessionToken(token);
});

export async function validateSessionToken(token: string): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  const record = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!record) return null;
  if (record.revokedAt !== null) return null;
  if (record.expiresAt.getTime() <= Date.now()) {
    // Expired sessions are removed opportunistically; a scheduled sweep is
    // still required for sessions of users who never come back.
    await prisma.session.deleteMany({ where: { id: record.id } });
    return null;
  }
  if (!record.user.isActive) return null;

  if (Date.now() - record.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
  }

  const { user, ...session } = record;
  return { session, user };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user — used on password change or lockout. */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function setActiveWorkspace(
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { activeWorkspaceId: workspaceId },
  });
}

// ---------------------------------------------------------------------------
// Cookie transport
// ---------------------------------------------------------------------------

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
