import { Inbox as InboxIcon } from 'lucide-react';
import { ConversationList } from '@/components/inbox/conversation-list';
import { EmptyState } from '@/components/ui/empty-state';
import { listConversations, unreadTotal } from '@/features/messaging/inbox-query';
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
  };

  const [conversations, unread] = await Promise.all([
    listConversations(context.workspace.id, filters),
    unreadTotal(context.workspace.id),
  ]);

  return (
    <>
      <div className="h-full md:hidden">
        <ConversationList conversations={conversations} />
      </div>

      <div className="hidden h-full items-center justify-center p-8 md:flex">
        <EmptyState
          icon={<InboxIcon aria-hidden="true" className="size-6" />}
          title={
            conversations.length === 0
              ? 'Nenhuma conversa ainda'
              : 'Selecione uma conversa'
          }
          description={
            conversations.length === 0
              ? 'As conversas aparecem aqui quando alguém escreve para o seu número do WhatsApp. Nada é simulado: elas dependem do webhook da Meta estar configurado e recebendo eventos.'
              : `${unread} mensagem(ns) não lida(s). Escolha uma conversa à esquerda para ler e responder.`
          }
        />
      </div>
    </>
  );
}
