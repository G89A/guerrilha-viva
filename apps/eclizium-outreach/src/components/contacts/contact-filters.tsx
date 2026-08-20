'use client';

import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { ConsentStatus, ContactStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FilterOptions {
  tags: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string }>;
  cities: string[];
  sources: string[];
}

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--color-ring]';

/**
 * Busca e filtros vivem na query string: o estado da listagem é linkável,
 * recarregável e compartilhável, e a paginação nunca fica dessincronizada.
 */
export function ContactFilters({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const apply = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // Qualquer mudança de filtro reinicia a paginação.
      params.delete('page');
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [pathname, router, searchParams],
  );

  const current = (key: string) => searchParams.get(key) ?? '';
  const hasFilters = [...searchParams.keys()].some((key) => key !== 'page');

  return (
    <div className="mb-4 space-y-3" data-pending={isPending ? '' : undefined}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('search');
          apply({ search: typeof value === 'string' ? value.trim() : '' });
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="search"
            defaultValue={current('search')}
            placeholder="Buscar por nome, telefone, empresa ou e-mail"
            aria-label="Buscar contatos"
            className="pl-8"
            maxLength={120}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={isPending}>
          Buscar
        </Button>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => startTransition(() => router.push(pathname))}
          >
            <X aria-hidden="true" />
            Limpar
          </Button>
        ) : null}
      </form>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="space-y-1">
          <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <select
            id="filter-status"
            className={SELECT_CLASS}
            value={current('status')}
            onChange={(event) => apply({ status: event.target.value })}
          >
            <option value="">Todos</option>
            <option value={ContactStatus.ACTIVE}>Ativo</option>
            <option value={ContactStatus.ARCHIVED}>Arquivado</option>
            <option value={ContactStatus.INVALID}>Inválido</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-tag" className="text-xs text-muted-foreground">
            Tag
          </Label>
          <select
            id="filter-tag"
            className={SELECT_CLASS}
            value={current('tagId')}
            onChange={(event) => apply({ tagId: event.target.value })}
          >
            <option value="">Todas</option>
            {options.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-list" className="text-xs text-muted-foreground">
            Lista
          </Label>
          <select
            id="filter-list"
            className={SELECT_CLASS}
            value={current('listId')}
            onChange={(event) => apply({ listId: event.target.value })}
          >
            <option value="">Todas</option>
            {options.lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-city" className="text-xs text-muted-foreground">
            Cidade
          </Label>
          <select
            id="filter-city"
            className={SELECT_CLASS}
            value={current('city')}
            onChange={(event) => apply({ city: event.target.value })}
          >
            <option value="">Todas</option>
            {options.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-source" className="text-xs text-muted-foreground">
            Origem
          </Label>
          <select
            id="filter-source"
            className={SELECT_CLASS}
            value={current('source')}
            onChange={(event) => apply({ source: event.target.value })}
          >
            <option value="">Todas</option>
            {options.sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-consent" className="text-xs text-muted-foreground">
            Consentimento
          </Label>
          <select
            id="filter-consent"
            className={SELECT_CLASS}
            value={current('consent')}
            onChange={(event) => apply({ consent: event.target.value })}
          >
            <option value="">Todos</option>
            <option value={ConsentStatus.GRANTED}>Concedido</option>
            <option value={ConsentStatus.REVOKED}>Revogado</option>
            <option value={ConsentStatus.UNKNOWN}>Desconhecido</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-suppressed" className="text-xs text-muted-foreground">
            Supressão
          </Label>
          <select
            id="filter-suppressed"
            className={SELECT_CLASS}
            value={current('suppressed')}
            onChange={(event) => apply({ suppressed: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="yes">Suprimidos</option>
            <option value="no">Não suprimidos</option>
          </select>
        </div>
      </div>
    </div>
  );
}
