import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConversationList } from '@/components/inbox/conversation-list';
import { listConversations } from '@/features/messaging/inbox-query';
import { requireWorkspace } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Layout de três painéis da Inbox: a lista de conversas fica fixa à esquerda e
 * sobrevive à navegação entre conversas, sem recarregar a cada clique.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  const context = await requireWorkspace();
  const conversations = await listConversations(context.workspace.id, {});

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] md:-m-6 lg:-m-8">
      <aside className="hidden w-80 shrink-0 border-r border-border md:block">
        <ConversationList conversations={conversations} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
