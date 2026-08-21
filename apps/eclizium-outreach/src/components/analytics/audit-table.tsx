'use client';

import { Fragment, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { loadMoreAuditAction } from '@/app/(dashboard)/analytics/audit/actions';
import type { AuditEntry, AuditPage } from '@/features/analytics/audit-query';

/**
 * Tabela do registro de auditoria.
 *
 * Os metadados são JSON gravado pela aplicação e renderizados como TEXTO, dentro
 * de `<pre>` — sem `dangerouslySetInnerHTML` em lugar nenhum. Parte deles vem de
 * campos que o usuário digitou, então tratá-los como marcação seria XSS pela
 * porta dos fundos.
 */
export function AuditTable({
  page,
  options,
  filters,
}: {
  page: AuditPage;
  options: { actions: string[]; resourceTypes: string[]; actors: Array<{ id: string; name: string }> };
  filters: { action: string; resourceType: string; actorUserId: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [extra, setExtra] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(page.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);

    const result = await loadMoreAuditAction({
      cursor,
      acao: filters.action,
      recurso: filters.resourceType,
      ator: filters.actorUserId,
      dias: params.get('dias') ?? '',
      fuso: params.get('fuso') ?? '',
    });

    if (result.ok) {
      setExtra((previous) => [...previous, ...result.data.entries]);
      setCursor(result.data.nextCursor);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }

  const entries = [...page.entries, ...extra];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Filter
          label="Ação"
          value={filters.action}
          options={options.actions}
          onChange={(value) => update('acao', value)}
        />
        <Filter
          label="Recurso"
          value={filters.resourceType}
          options={options.resourceTypes}
          onChange={(value) => update('recurso', value)}
        />
        <Filter
          label="Autor"
          value={filters.actorUserId}
          options={options.actors.map((actor) => actor.id)}
          labels={Object.fromEntries(options.actors.map((actor) => [actor.id, actor.name]))}
          onChange={(value) => update('ator', value)}
        />
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum registro para os filtros escolhidos.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Recurso</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                    <TableCell className="text-xs">
                      {entry.resourceType}
                      {entry.resourceId ? (
                        <span className="ml-1 font-mono text-muted-foreground">
                          {entry.resourceId.slice(-8)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.actorName ?? (entry.actorType === 'SYSTEM' ? 'Sistema' : 'Removido')}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                        aria-expanded={expanded === entry.id}
                      >
                        {expanded === entry.id ? 'Ocultar' : 'Detalhes'}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === entry.id ? (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-muted/40">
                        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {cursor ? (
        <div>
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </Button>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Filter({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
