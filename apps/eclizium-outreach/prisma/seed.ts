/**
 * Development seed. Creates two workspaces owned by two different users so the
 * multi-tenant boundary can be exercised by hand in the UI.
 *
 * Refuses to run against NODE_ENV=production.
 */
import { PrismaClient, WorkspaceRole } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'eclizium-dev-2026';

async function upsertOwner(input: { email: string; name: string; workspace: string; slug: string }) {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name },
    create: { email: input.email, name: input.name, passwordHash },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: input.slug },
    update: { name: input.workspace },
    create: { name: input.workspace, slug: input.slug },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: WorkspaceRole.OWNER },
    create: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.OWNER },
  });

  return { user, workspace };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const acme = await upsertOwner({
    email: 'owner@acme.test',
    name: 'Ana Owner',
    workspace: 'Acme Outreach',
    slug: 'acme-outreach',
  });

  const rival = await upsertOwner({
    email: 'owner@rival.test',
    name: 'Rui Rival',
    workspace: 'Rival Comunicação',
    slug: 'rival-comunicacao',
  });

  console.log('Seed concluído.');
  console.log(`  ${acme.user.email} / ${SEED_PASSWORD}  → ${acme.workspace.slug}`);
  console.log(`  ${rival.user.email} / ${SEED_PASSWORD}  → ${rival.workspace.slug}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
