import { prisma } from '@/lib/db/client';

/**
 * Integration tests share the application's Prisma singleton. `tests/setup.ts`
 * repoints DATABASE_URL at TEST_DATABASE_URL before any module loads, so this
 * cannot reach the development database.
 */
export function testPrisma() {
  return prisma;
}

const TABLES = [
  'audit_logs',
  'webhook_events',
  'messages',
  'conversations',
  'campaign_recipients',
  'campaigns',
  'message_templates',
  'messaging_channels',
  'suppression_entries',
  'contact_tags',
  'tags',
  'contact_list_members',
  'contact_lists',
  'contact_consents',
  'contacts',
  'sessions',
  'workspace_members',
  'workspaces',
  'users',
] as const;

/** Wipes every table. `CASCADE` handles the FK graph, so order is cosmetic. */
export async function resetDatabase(): Promise<void> {
  const list = TABLES.map((table) => `"public"."${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export async function disconnectTestPrisma(): Promise<void> {
  await prisma.$disconnect();
}
