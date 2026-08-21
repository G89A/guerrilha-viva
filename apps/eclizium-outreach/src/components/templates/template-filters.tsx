'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STATUS_OPTIONS = [
  ['', 'Todos os status'],
  ['APPROVED', 'Aprovado'],
  ['PENDING', 'Em análise'],
  ['REJECTED', 'Rejeitado'],
  ['PAUSED', 'Pausado'],
  ['DISABLED', 'Desativado'],
  ['UNKNOWN', 'Desconhecido'],
] as const;

const CATEGORY_OPTIONS = [
  ['', 'Todas as categorias'],
  ['MARKETING', 'Marketing'],
  ['UTILITY', 'Utilidade'],
  ['AUTHENTICATION', 'Autenticação'],
  ['UNKNOWN', 'Desconhecida'],
] as const;

/** Filtros refletidos na query string, para o estado da tela ser linkável. */
export function TemplateFilters({ languages }: { languages: string[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      router.push(`/templates?${next.toString()}`);
    },
    [params, router],
  );

  const hasFilters = ['search', 'status', 'category', 'language'].some((key) => params.get(key));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Buscar por nome…"
        defaultValue={params.get('search') ?? ''}
        aria-label="Buscar templates por nome"
        className="w-full sm:w-64"
        onKeyDown={(event) => {
          if (event.key === 'Enter') update('search', event.currentTarget.value.trim());
        }}
      />

      <select
        aria-label="Filtrar por status"
        defaultValue={params.get('status') ?? ''}
        onChange={(event) => update('status', event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        {STATUS_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filtrar por categoria"
        defaultValue={params.get('category') ?? ''}
        onChange={(event) => update('category', event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        {CATEGORY_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filtrar por idioma"
        defaultValue={params.get('language') ?? ''}
        onChange={(event) => update('language', event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Todos os idiomas</option>
        {languages.map((language) => (
          <option key={language} value={language}>
            {language}
          </option>
        ))}
      </select>

      {hasFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/templates')}>
          Limpar
        </Button>
      ) : null}
    </div>
  );
}
