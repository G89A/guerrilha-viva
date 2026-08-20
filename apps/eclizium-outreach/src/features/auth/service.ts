import 'server-only';
import type { User, Workspace } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { AppError } from '@/lib/errors/app-error';
import { isUniqueConstraintError } from '@/lib/db/errors';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createWorkspaceWithOwner, withUniqueSlug } from '@/features/workspaces/service';
import type { RegisterInput } from '@/features/auth/schemas';

/**
 * A syntactically valid hash for an unguessable password. Verifying against it
 * when the email is unknown keeps the login path's timing profile roughly
 * constant, so it cannot be used to enumerate registered addresses.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZG8tbm90LW1hdGNoLWFueXRoaW5nLWV2ZXItcGxhY2Vob2xkZXItdmFsdWUtMDAwMDAwMDA=';

export interface RegisterResult {
  user: User;
  workspace: Workspace;
}

/**
 * Creates the user, their first workspace and the OWNER membership atomically.
 * A partial signup (user with no workspace) would strand the account outside
 * every tenant, so all three rows share one transaction.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const passwordHash = await hashPassword(input.password);

  try {
    // One transaction per slug candidate: a collision rolls the whole attempt
    // back (user included), so a retry never leaves a half-created account.
    return await withUniqueSlug(input.workspaceName, (slug) =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { name: input.name, email: input.email, passwordHash },
        });

        const workspace = await createWorkspaceWithOwner(
          { name: input.workspaceName, ownerUserId: user.id, slug },
          tx,
        );

        return { user, workspace };
      }),
    );
  } catch (error) {
    if (isUniqueConstraintError(error, 'email')) {
      throw AppError.conflict('Já existe uma conta com este e-mail.');
    }
    throw error;
  }
}

/**
 * Verifies credentials. Every failure returns the same message and the same
 * error code — the caller cannot tell "no such user" from "wrong password"
 * from "account disabled".
 */
export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const matches = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !matches || !user.isActive) {
    throw new AppError('UNAUTHENTICATED', 'E-mail ou senha inválidos.');
  }

  return user;
}

export async function markUserLoggedIn(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}
