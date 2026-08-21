'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGE_PRESETS } from '@/features/analytics/range';
import { cn } from '@/lib/utils';

/**
 * Período e fuso, numa linha só acima dos gráficos.
 *
 * O fuso aparece na tela porque a fronteira do dia muda o resultado: agrupar em
 * UTC joga tudo que aconteceu depois das 21h no Brasil para o dia seguinte.
 * Deixar isso implícito produziria relatório que ninguém consegue conferir.
 */
const ZONES = [
  ['UTC', 'UTC'],
  ['America/Sao_Paulo', 'Brasília'],
  ['America/Manaus', 'Manaus'],
  ['Europe/Lisbon', 'Lisboa'],
] as const;

export function RangeControls({ days, timeZone }: { days: number; timeZone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="Período">
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => update('dias', String(preset))}
            aria-pressed={days === preset}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              days === preset
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {preset} dias
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Fuso
        <select
          value={timeZone}
          onChange={(event) => update('fuso', event.currentTarget.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {ZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {ZONES.every(([value]) => value !== timeZone) ? (
            <option value={timeZone}>{timeZone}</option>
          ) : null}
        </select>
      </label>

      <p className="text-xs text-muted-foreground">
        Dias agrupados no fuso escolhido.
      </p>
    </div>
  );
}
