'use client';

import { useId, useState } from 'react';

/**
 * Gráfico de linhas com camada de hover.
 *
 * SVG à mão, sem biblioteca: as formas aqui são simples e uma dependência de
 * gráficos custaria mais bundle do que resolve.
 *
 * Decisões que NÃO são estéticas:
 *
 *   - eixo único. Séries de unidades diferentes viram outro gráfico, nunca um
 *     segundo eixo y;
 *   - as cores vêm dos tokens `--chart-N`, validados contra a superfície de
 *     cada modo. `--chart-3` fica abaixo de 3:1 no claro, e por isso as pontas
 *     levam rótulo direto — a compensação exigida pela regra de relevo;
 *   - legenda sempre presente com 2+ séries, porque identidade não pode
 *     depender só de cor;
 *   - o dia sem movimento entra com zero. Omiti-lo faria uma queda parecer
 *     buraco no eixo.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  points: number[];
}

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 16, right: 74, bottom: 26, left: 40 };
/** Altura mínima entre dois rótulos de ponta, para não se sobreporem. */
const LABEL_GAP = 11;

function niceCeiling(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function LineChart({
  labels,
  series,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  ariaLabel: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  const max = niceCeiling(Math.max(1, ...series.flatMap((entry) => entry.points)));
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const x = (index: number): number =>
    PADDING.left + (labels.length <= 1 ? 0 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number): number => PADDING.top + plotHeight - (value / max) * plotHeight;

  const ticks = [0, max / 2, max];

  /*
   * Rótulos de ponta empurrados para não colidir.
   *
   * Séries que terminam no mesmo valor — o caso comum quando tudo está zerado —
   * escreveriam os três nomes por cima uns dos outros. Ordena por altura e
   * afasta o suficiente; sem isso o rótulo direto, que é a compensação exigida
   * pelo contraste do slot 3, deixaria de ser legível.
   */
  const labelPositions = series
    .map((entry, index) => ({ index, y: y(entry.points.at(-1) ?? 0) }))
    .sort((a, b) => a.y - b.y);

  for (let position = 1; position < labelPositions.length; position += 1) {
    const previous = labelPositions[position - 1];
    const current = labelPositions[position];
    if (!previous || !current) continue;
    if (current.y - previous.y < LABEL_GAP) current.y = previous.y + LABEL_GAP;
  }

  const labelY = new Map(labelPositions.map((entry) => [entry.index, entry.y]));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-chart-grid"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {Math.round(tick)}
            </text>
          </g>
        ))}

        {series.map((entry, seriesIndex) => {
          const path = entry.points
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(value)}`)
            .join(' ');
          const last = entry.points.at(-1) ?? 0;
          const textY = labelY.get(seriesIndex) ?? y(last);

          return (
            <g key={entry.key}>
              <path d={path} fill="none" stroke={entry.color} strokeWidth={2} strokeLinejoin="round" />
              {/* Rótulo direto na ponta: identidade sem depender só da cor. */}
              {Math.abs(textY - y(last)) > 1 ? (
                <line
                  x1={WIDTH - PADDING.right}
                  x2={WIDTH - PADDING.right + 4}
                  y1={y(last)}
                  y2={textY}
                  stroke={entry.color}
                  strokeWidth={1}
                />
              ) : null}
              <text
                x={WIDTH - PADDING.right + 6}
                y={textY + 3}
                className="fill-muted-foreground text-[9px]"
              >
                {entry.label}
              </text>
            </g>
          );
        })}

        {hover !== null ? (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              className="stroke-chart-grid"
              strokeWidth={1}
            />
            {series.map((entry) => (
              <circle
                key={entry.key}
                cx={x(hover)}
                cy={y(entry.points[hover] ?? 0)}
                r={4}
                fill={entry.color}
                className="stroke-card"
                strokeWidth={2}
              />
            ))}
          </>
        ) : null}

        {/* Faixas de captura maiores que a marca, para o ponteiro alcançar. */}
        {labels.map((label, index) => (
          <rect
            key={`${id}-${label}`}
            x={x(index) - plotWidth / Math.max(1, labels.length - 1) / 2}
            y={PADDING.top}
            width={plotWidth / Math.max(1, labels.length - 1)}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}

        <text x={PADDING.left} y={HEIGHT - 8} className="fill-muted-foreground text-[9px]">
          {labels.at(0)}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          {labels.at(-1)}
        </text>
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            {entry.label}
            {hover !== null ? (
              <strong className="font-medium text-foreground">{entry.points[hover] ?? 0}</strong>
            ) : null}
          </span>
        ))}
        {hover !== null ? <span>em {labels[hover]}</span> : null}
      </figcaption>
    </figure>
  );
}
