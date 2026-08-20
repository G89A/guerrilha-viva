'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Loader2, ShieldBan, Tag as TagIcon, ListPlus } from 'lucide-react';
import { toast } from 'sonner';
import { batchContactAction } from '@/app/(dashboard)/contacts/actions';
import { ConsentBadge, ContactStatusBadge, SuppressionBadge } from '@/components/contacts/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatPhone } from '@/features/contacts/phone';
import type { ContactRow } from '@/features/contacts/query';
import { formatDateTime } from '@/lib/utils';

export interface ContactTableProps {
  rows: ContactRow[];
  hasFilters: boolean;
  canWrite: boolean;
}

function displayName(row: ContactRow): string {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : 'Sem nome';
}

export function ContactTable({ rows, hasFilters, canWrite }: ContactTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <EmptyState
        title={hasFilters ? 'Nenhum contato encontrado.' : 'Nenhum contato ainda.'}
        description={
          hasFilters
            ? 'Ajuste a busca ou limpe os filtros para ver outros resultados.'
            : 'Crie um contato manualmente ou importe uma planilha CSV.'
        }
        action={
          hasFilters ? null : (
            <div className="flex gap-2">
              <Button asChild size="sm">
                <Link href="/contacts/new">Novo contato</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/contacts/import">Importar CSV</Link>
              </Button>
            </div>
          )
        }
      />
    );
  }

  const allSelected = selected.size === rows.length;

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function runBatch(action: 'tag' | 'list' | 'archive' | 'suppress') {
    if (selected.size === 0 || isPending) return;

    let tagName: string | null = null;
    let listName: string | null = null;

    if (action === 'tag') {
      tagName = window.prompt('Nome da tag a aplicar:');
      if (!tagName?.trim()) return;
    }
    if (action === 'list') {
      listName = window.prompt('Nome da lista:');
      if (!listName?.trim()) return;
    }
    if (action === 'archive' && !window.confirm(`Arquivar ${selected.size} contato(s)?`)) return;
    if (action === 'suppress' && !window.confirm(`Suprimir ${selected.size} contato(s)?`)) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('action', action);
      if (tagName) formData.set('tagName', tagName.trim());
      if (listName) formData.set('listName', listName.trim());
      for (const id of selected) formData.append('contactIds', id);

      const result = await batchContactAction(formData);
      if (!result.ok) {
        toast.error('Operação em lote falhou', { description: result.error.message });
        return;
      }

      const { succeeded, skipped, failed } = result.data;
      toast.success(`${succeeded} aplicado(s)`, {
        description: `${skipped} sem alteração · ${failed} com falha`,
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canWrite && selected.size > 0 ? (
        <div
          role="region"
          aria-label="Ações em lote"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
        >
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <span className="flex-1" />
          {isPending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => runBatch('tag')}>
            <TagIcon aria-hidden="true" />
            Tag
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => runBatch('list')}>
            <ListPlus aria-hidden="true" />
            Lista
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => runBatch('archive')}
          >
            <Archive aria-hidden="true" />
            Arquivar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => runBatch('suppress')}
          >
            <ShieldBan aria-hidden="true" />
            Suprimir
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {canWrite ? (
                <TableHead className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os contatos da página"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                    className="size-4 rounded border-input"
                  />
                </TableHead>
              ) : null}
              <TableHead>Contato</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Consentimento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                {canWrite ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${displayName(row)}`}
                      checked={selected.has(row.id)}
                      onChange={(event) => toggleOne(row.id, event.target.checked)}
                      className="size-4 rounded border-input"
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Link
                    href={`/contacts/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {displayName(row)}
                  </Link>
                  {row.email ? (
                    <span className="block text-xs text-muted-foreground">{row.email}</span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {formatPhone(row.phoneE164)}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.company ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{row.city ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag.id} variant="neutral">
                        {tag.name}
                      </Badge>
                    ))}
                    {row.tags.length > 3 ? (
                      <Badge variant="outline">+{row.tags.length - 3}</Badge>
                    ) : null}
                    {row.tags.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <ConsentBadge status={row.whatsappConsent} />
                    <SuppressionBadge suppressed={row.suppressed} />
                  </div>
                </TableCell>
                <TableCell>
                  <ContactStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/contacts/${row.id}`}>Abrir</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
