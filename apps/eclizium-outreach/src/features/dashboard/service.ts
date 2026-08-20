import 'server-only';
import { prisma } from '@/lib/db/client';

export interface WorkspaceOverview {
  contacts: number;
  suppressed: number;
  campaigns: number;
  conversations: number;
  messagesSent: number;
  channels: number;
}

/**
 * Real counts, scoped to one workspace. In SPRINT 0 every number is legitimately
 * zero — no placeholder values are ever substituted.
 */
export async function getWorkspaceOverview(workspaceId: string): Promise<WorkspaceOverview> {
  const [contacts, suppressed, campaigns, conversations, messagesSent, channels] =
    await prisma.$transaction([
      prisma.contact.count({ where: { workspaceId, status: 'ACTIVE' } }),
      prisma.suppressionEntry.count({ where: { workspaceId } }),
      prisma.campaign.count({ where: { workspaceId } }),
      prisma.conversation.count({ where: { workspaceId } }),
      prisma.message.count({ where: { workspaceId, direction: 'OUTBOUND', status: 'SENT' } }),
      prisma.messagingChannel.count({ where: { workspaceId, status: 'CONNECTED' } }),
    ]);

  return { contacts, suppressed, campaigns, conversations, messagesSent, channels };
}
