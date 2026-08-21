'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ConversationStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { ConversationListItem, InboxCounters } from '@/features/messaging/inbox-query';
import { queryConversationsAction } from '@/app/(dashboard)/inbox/actions';

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
 *
 * A paginação é por cursor e acumulada no cliente. Quando o filtro muda, a
 * página volta ao começo: misturar resultados de filtros diferentes mostraria
 * conversas que não casam com o que está selecionado.
 */
export function ConversationList({
  page,
  counters,
  currentUserId,
  serverQuery = '',
}: {
  page: { items: ConversationListItem[]; nextCursor: string | null };
  counters?: InboxCounters;
  currentUserId?: string;
  /** Query string com que o servidor montou `page`. Ver o efeito abaixo. */
  serverQuery?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const query = params.toString();
  const currentStatus = params.get('status') ?? '';
  const unreadOnly = params.get('unread') === '1';
  const assignee = params.get('assignee') ?? '';
  const search = params.get('search') ?? '';

  /**
   * Este componente vive no layout da Inbox, e layout não recebe
   * `searchParams`: a lista da lateral chegaria sempre sem filtro. Quando a URL
   * pede um filtro que o servidor não usou para montar esta página, o cliente
   * busca a página filtrada. Sem isso, clicar em "Não lidas" mudaria a URL e
   * não mudaria a lista.
   */
  useEffect(() => {
    if (query === serverQuery) {
      setItems(null);
      setCursor(page.nextCursor);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void queryConversationsAction({
      status: currentStatus,
      search,
      unread: unreadOnly ? '1' : '',
      assignee,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setItems(result.data.items);
        setCursor(result.data.nextCursor);
        setLoadError(null);
      } else {
        setLoadError(result.error.message);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [query, serverQuery, page.nextCursor, currentStatus, search, unreadOnly, assignee]);

  // O layout pai não recebe o parâmetro `[id]` do segmento filho, então a
  // conversa ativa é lida da própria URL.
  const activeId = pathname.startsWith('/inbox/') ? pathname.slice('/inbox/'.length) : undefined;

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setLoadError(null);

    const result = await queryConversationsAction({
      cursor,
      status: currentStatus,
      search,
      unread: unreadOnly ? '1' : '',
      assignee,
    });

    if (result.ok) {
      const more = result.data.items;
      setItems((previous) => [...(previous ?? page.items), ...more]);
      setCursor(result.data.nextCursor);
    } else {
      setLoadError(result.error.message);
    }
    setLoading(false);
  }

  const conversations = items ?? page.items;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <Input
          placeholder="Buscar por nome ou telefone…"
          defaultValue={search}
          aria-label="Buscar conversas"
          onKeyDown={(event) => {
            if (event.key === 'Enter') updateFilter('search', event.currentTarget.value.trim());
          }}
        />
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <FilterChip
              key={value || 'all'}
              active={currentStatus === value}
              onClick={() => updateFilter('status', value)}
            >
              {label}
              {counters && value === ConversationStatus.OPEN ? ` · ${counters.open}` : ''}
              {counters && value === ConversationStatus.PENDING ? ` · ${counters.pending}` : ''}
            </FilterChip>
          ))}
          <FilterChip
            active={unreadOnly}
            onClick={() => updateFilter('unread', unreadOnly ? '' : '1')}
          >
            Não lidas{counters ? ` · ${counters.unread}` : ''}
          </FilterChip>
          {currentUserId ? (
            <FilterChip
              active={assignee === currentUserId}
              onClick={() =>
                updateFilter('assignee', assignee === currentUserId ? '' : currentUserId)
              }
            >
              Minhas{counters ? ` · ${counters.mine}` : ''}
            </FilterChip>
          ) : null}
          <FilterChip
            active={assignee === 'UNASSIGNED'}
            onClick={() => updateFilter('assignee', assignee === 'UNASSIGNED' ? '' : 'UNASSIGNED')}
          >
            Sem responsável{counters ? ` · ${counters.unassigned}` : ''}
          </FilterChip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa por aqui.
          </p>
        ) : (
          <>
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

                    {conversation.assigneeName ? (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        Responsável: {conversation.assigneeName}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>

            {cursor ? (
              <div className="p-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={loading}
                  onClick={() => void loadMore()}
                >
                  {loading ? 'Carregando…' : 'Carregar mais'}
                </Button>
                {loadError ? (
                  <p className="mt-2 text-center text-xs text-destructive">{loadError}</p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
