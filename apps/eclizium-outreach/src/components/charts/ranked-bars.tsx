/**
 * Barras horizontais para magnitude por categoria.
 *
 * Série única, então não há legenda: o título nomeia o que está medido. O valor
 * vai como rótulo direto ao lado da barra — número em toda marca só é ruído
 * quando há muitas séries; aqui é a leitura principal.
 */
export interface RankedItem {
  label: string;
  value: number;
  hint?: string | null;
}

export function RankedBars({
  items,
  tone = 'primary',
  emptyMessage,
}: {
  items: RankedItem[];
  tone?: 'primary' | 'critical';
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-muted-foreground" title={item.hint ?? item.label}>
            {item.label}
          </span>
          <span className="h-2 overflow-hidden rounded-sm bg-muted">
            <span
              className={
                tone === 'critical'
                  ? 'block h-full rounded-sm bg-chart-critical'
                  : 'block h-full rounded-sm bg-chart-1'
              }
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </span>
          <span className="text-xs font-medium tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
