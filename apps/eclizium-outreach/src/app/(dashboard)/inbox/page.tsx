import { Inbox as InboxIcon } from 'lucide-react';
import { ConversationList } from '@/components/inbox/conversation-list';
import { EmptyState } from '@/components/ui/empty-state';
import { inboxCounters, listConversations, unreadTotal } from '@/features/messaging/inbox-query';
import { requireWorkspace } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/**
 * Estado inicial da Inbox: nenhuma conversa selecionada.
 * No celular a lista ocupa a tela inteira, já que não há painel lateral.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireWorkspace();
  const raw = await searchParams;

  const filters = {
    ...(typeof raw.search === 'string' && raw.search.length > 0 ? { search: raw.search } : {}),
    ...(raw.unread === '1' ? { unreadOnly: true } : {}),
    ...(typeof raw.assignee === 'string' && raw.assignee.length > 0
      ? { assigneeId: raw.assignee }
      : {}),
  };

  // A query com que ESTA página foi montada, para a lista saber se o que está
  // na URL já está refletido no que ela recebeu.
  const serverQuery = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === 'string' && value.length > 0 ? [[key, value] as [string, string]] : [],
    ),
  ).toString();

  const [page, unread, counters] = await Promise.all([
    listConversations(context.workspace.id, filters),
    unreadTotal(context.workspace.id),
    inboxCounters(context.workspace.id, context.user.id),
  ]);

  return (
    <>
      <div className="h-full md:hidden">
        <ConversationList
          page={page}
          counters={counters}
          currentUserId={context.user.id}
          serverQuery={serverQuery}
        />
      </div>

      <div className="hidden h-full items-center justify-center p-8 md:flex">
        <EmptyState
          icon={<InboxIcon aria-hidden="true" className="size-6" />}
          title={
            page.items.length === 0 ? 'Nenhuma conversa ainda' : 'Selecione uma conversa'
          }
          description={
            page.items.length === 0
              ? 'As conversas aparecem aqui quando alguém escreve para o seu número do WhatsApp. Nada é simulado: elas dependem do webhook da Meta estar configurado e recebendo eventos.'
              : `${unread} mensagem(ns) não lida(s). Escolha uma conversa à esquerda para ler e responder.`
          }
        />
      </div>
    </>
  );
}
