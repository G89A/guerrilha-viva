'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ConversationStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { ConversationListItem } from '@/features/messaging/inbox-query';

const STATUS_FILTERS = [
  ['', 'Todas'],
  [ConversationStatus.OPEN, 'Abertas'],
  [ConversationStatus.PENDING, 'Pendentes'],
  [ConversationStatus.CLOSED, 'Fechadas'],
] as const;

/**
 * Lista de conversas, ordenada pela atividade mais recente.
 *
 * O conteúdo da última mensagem vem do WhatsApp e é renderizado como texto —
 * o React escapa por padrão e não há `dangerouslySetInnerHTML` em lugar nenhum
 * desta árvore.
 */
export function ConversationList({ conversations }: { conversations: ConversationListItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // O layout pai não recebe o parâmetro `[id]` do segmento filho, então a
  // conversa ativa é lida da própria URL.
  const activeId = pathname.startsWith('/inbox/') ? pathname.slice('/inbox/'.length) : undefined;

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  const currentStatus = params.get('status') ?? '';
  const unreadOnly = params.get('unread') === '1';

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <Input
          placeholder="Buscar por nome ou telefone…"
          defaultValue={params.get('search') ?? ''}
          aria-label="Buscar conversas"
          onKeyDown={(event) => {
            if (event.key === 'Enter') updateFilter('search', event.currentTarget.value.trim());
          }}
        />
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => updateFilter('status', value)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                currentStatus === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => updateFilter('unread', unreadOnly ? '' : '1')}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              unreadOnly ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            Não lidas
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa por aqui.
          </p>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/inbox/${conversation.id}`}
                  className={cn(
                    'block border-b border-border px-3 py-3 transition-colors hover:bg-accent',
                    activeId === conversation.id && 'bg-accent',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {conversation.contactName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {conversation.lastMessageAt
                        ? formatRelativeTime(conversation.lastMessageAt)
                        : '—'}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {conversation.phoneE164}
                  </p>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">
                      {conversation.lastMessageInbound ? '' : 'Você: '}
                      {conversation.lastMessagePreview ?? 'Sem mensagens'}
                    </p>
                    {conversation.unreadCount > 0 ? (
                      <Badge variant="default" className="shrink-0">
                        {conversation.unreadCount}
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
