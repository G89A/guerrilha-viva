import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ConversationList } from '@/components/inbox/conversation-list';
import { inboxCounters, listConversations } from '@/features/messaging/inbox-query';
import { requireWorkspace } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Layout de três painéis da Inbox: a lista de conversas fica fixa à esquerda e
 * sobrevive à navegação entre conversas, sem recarregar a cada clique.
 *
 * Layout não recebe `searchParams`, então a primeira página vem sem filtro e a
 * própria lista busca a versão filtrada quando a URL pede — ver o componente.
 */
export default async function InboxLayout({ children }: { children: ReactNode }) {
  const context = await requireWorkspace();

  const [page, counters] = await Promise.all([
    listConversations(context.workspace.id, {}),
    inboxCounters(context.workspace.id, context.user.id),
  ]);

  return (
    <div className="-m-4 flex h-[calc(100vh-4rem)] md:-m-6 lg:-m-8">
      <aside className="hidden w-80 shrink-0 border-r border-border md:block">
        <ConversationList page={page} counters={counters} currentUserId={context.user.id} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
