import { WorkspaceRole } from '@prisma/client';
import { hashPassword } from '@/lib/auth/password';
import { testPrisma } from './db';

let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface SeededTenant {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
}

/** Creates an isolated user + workspace + OWNER membership. */
export async function seedTenant(label = 'tenant'): Promise<SeededTenant> {
  const prisma = testPrisma();
  const email = `${unique(label)}@example.test`;
  const slug = unique(label);

  const user = await prisma.user.create({
    data: {
      email,
      name: `User ${label}`,
      // Fixed low-cost hash: factories run per-test and scrypt is deliberately slow.
      passwordHash: 'scrypt$1024$8$1$c2FsdHNhbHRzYWx0c2E=$bm90LWEtcmVhbC1oYXNo',
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `Workspace ${label}`,
      slug,
      members: { create: { userId: user.id, role: WorkspaceRole.OWNER } },
    },
  });

  return { userId: user.id, email, workspaceId: workspace.id, workspaceSlug: workspace.slug };
}

export async function seedContact(
  workspaceId: string,
  phoneE164: string,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    city: string;
    source: string;
  }> = {},
): Promise<string> {
  const contact = await testPrisma().contact.create({
    data: { workspaceId, phoneE164, firstName: 'Contato', ...overrides },
  });
  return contact.id;
}

/** Workspace no formato que os serviços de contato esperam. */
export function workspaceRef(workspaceId: string, region = 'BR') {
  return { id: workspaceId, defaultPhoneRegion: region };
}

export async function seedUserWithPassword(
  email: string,
  password: string,
): Promise<string> {
  const user = await testPrisma().user.create({
    data: { email, name: 'Usuário Teste', passwordHash: await hashPassword(password) },
  });
  return user.id;
}
