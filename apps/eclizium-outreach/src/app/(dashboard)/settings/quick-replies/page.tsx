import type { Metadata } from 'next';
import { QuickReplyManager } from '@/components/inbox/quick-reply-manager';
import { listQuickReplies } from '@/features/messaging/quick-reply-service';
import { requireWorkspace } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Respostas rápidas' };
export const dynamic = 'force-dynamic';

export default async function QuickRepliesPage() {
  const context = await requireWorkspace();
  const items = await listQuickReplies(context.workspace.id);

  return <QuickReplyManager items={items} />;
}
