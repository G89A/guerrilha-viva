import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ConversationStatus } from '@prisma/client';
import { ContactPanel } from '@/components/inbox/contact-panel';
import { MessageThread } from '@/components/inbox/message-thread';
import { ReplyComposer } from '@/components/inbox/reply-composer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { assignableMembers, getConversationDetail } from '@/features/messaging/inbox-query';
import { listQuickReplies } from '@/features/messaging/quick-reply-service';
import { AssignControl } from '@/components/inbox/assign-control';
import { NotesPanel } from '@/components/inbox/notes-panel';
import { prisma } from '@/lib/db/client';
import { MessageDirection } from '@prisma/client';
import { serviceWindow } from '@/features/messaging/conversation-service';
import { requireWorkspace } from '@/lib/auth/guards';
import { hasAtLeastRole, WorkspaceRole } from '@/lib/auth/roles';
import { ConversationActions } from '@/components/inbox/conversation-actions';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ConversationStatus, string> = {
  [ConversationStatus.OPEN]: 'Aberta',
  [ConversationStatus.PENDING]: 'Pendente',
  [ConversationStatus.CLOSED]: 'Fechada',
};

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireWorkspace();
  const { id } = await params;

  // Escopada ao workspace: o id de outro tenant simplesmente não existe.
  const conversation = await getConversationDetail(context.workspace.id, id);
  if (!conversation) notFound();

  const [members, quickReplies, unconfirmedInbound] = await Promise.all([
    assignableMembers(context.workspace.id),
    listQuickReplies(context.workspace.id),
    prisma.message.count({
      where: {
        workspaceId: context.workspace.id,
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        providerMessageId: { not: null },
        readReceiptAt: null,
      },
    }),
  ]);

  const window = serviceWindow(conversation.lastInboundAt);
  const canReply = hasAtLeastRole(context.role, WorkspaceRole.MEMBER);
  const name =
    [conversation.contact.firstName, conversation.contact.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Sem nome';

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="md:hidden">
              <Link href="/inbox" aria-label="Voltar para a lista">
                <ArrowLeft aria-hidden="true" className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {conversation.contact.phoneE164}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={conversation.status === ConversationStatus.CLOSED ? 'neutral' : 'default'}>
              {STATUS_LABELS[conversation.status]}
            </Badge>

            <AssignControl
              conversationId={conversation.id}
              assigneeId={conversation.assigneeId}
              members={members}
            />

            <ConversationActions
              conversationId={conversation.id}
              status={conversation.status}
              unreadCount={conversation.unreadCount}
              hasUnconfirmedInbound={unconfirmedInbound > 0}
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-muted/30">
          <MessageThread
            conversationId={conversation.id}
            messages={conversation.messages}
            olderCursor={conversation.olderCursor}
          />
        </div>

        <ReplyComposer
          conversationId={conversation.id}
          windowOpen={window.open}
          windowExpiresAt={window.expiresAt}
          canReply={canReply}
          quickReplies={quickReplies}
        />
      </div>

      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border lg:block">
        <ContactPanel
          contact={conversation.contact}
          tags={conversation.contact.tags.map((link) => link.tag)}
          lists={conversation.contact.listMembers.map((link) => link.list)}
          consents={conversation.contact.consents}
          suppressed={conversation.contact.suppressions.length > 0}
        />

        <NotesPanel conversationId={conversation.id} notes={conversation.notes} />
      </aside>
    </div>
  );
}
