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

/** Adiciona um membro com papel específico a um workspace existente. */
async function upsertMember(input: {
  email: string;
  name: string;
  workspaceId: string;
  role: WorkspaceRole;
}) {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: { name: input.name },
    create: { email: input.email, name: input.name, passwordHash },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
    update: { role: input.role },
    create: { workspaceId: input.workspaceId, userId: user.id, role: input.role },
  });

  return user;
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

  // Papéis não-OWNER, para exercitar RBAC à mão: quem só lê não pode
  // configurar integração nem enviar mensagem de teste.
  const viewer = await upsertMember({
    email: 'viewer@acme.test',
    name: 'Vera Viewer',
    workspaceId: acme.workspace.id,
    role: WorkspaceRole.VIEWER,
  });

  const admin = await upsertMember({
    email: 'admin@acme.test',
    name: 'Alex Admin',
    workspaceId: acme.workspace.id,
    role: WorkspaceRole.ADMIN,
  });

  console.log('Seed concluído.');
  console.log(`  ${acme.user.email} / ${SEED_PASSWORD}  → ${acme.workspace.slug}`);
  console.log(`  ${rival.user.email} / ${SEED_PASSWORD}  → ${rival.workspace.slug}`);
  console.log(`  ${admin.email} / ${SEED_PASSWORD}  → ${acme.workspace.slug} (ADMIN)`);
  console.log(`  ${viewer.email} / ${SEED_PASSWORD}  → ${acme.workspace.slug} (VIEWER)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
