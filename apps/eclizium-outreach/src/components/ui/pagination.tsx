'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Rótulo acessível da navegação; identifica a lista que está sendo paginada. */
  label?: string;
}

export function Pagination({ page, pageCount, total, pageSize, label = 'Paginação' }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goTo(target: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) params.delete('page');
    else params.set('page', String(target));
    router.push(`${pathname}?${params.toString()}`);
  }

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={label}
      className="flex items-center justify-between gap-3 pt-3 text-sm"
    >
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0 ? 'Nenhum resultado' : `${first}–${last} de ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft aria-hidden="true" />
          Anterior
        </Button>
        <span className="text-muted-foreground">
          Página {page} de {pageCount}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => goTo(page + 1)}
          aria-label="Próxima página"
        >
          Próxima
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
