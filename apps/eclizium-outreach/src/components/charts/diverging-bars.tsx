'use client';

import { useState } from 'react';

/**
 * Barras divergentes: ganhos acima da linha zero, perdas abaixo.
 *
 * A polaridade é carregada pela POSIÇÃO — a cor só reforça. O par azul/vermelho
 * é o par divergente validado (visão normal ΔE 32.3 no claro, 29.0 no escuro),
 * e a linha zero é neutra, para que o meio leia como "nada aconteceu".
 */

export interface DivergingPoint {
  label: string;
  positive: number;
  negative: number;
}

const WIDTH = 720;
const HEIGHT = 180;
const PADDING = { top: 14, right: 12, bottom: 24, left: 40 };

export function DivergingBars({
  points,
  positiveLabel,
  negativeLabel,
  ariaLabel,
}: {
  points: DivergingPoint[];
  positiveLabel: string;
  negativeLabel: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...points.map((point) => Math.max(point.positive, point.negative)));
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const zero = PADDING.top + plotHeight / 2;
  const slot = plotWidth / Math.max(1, points.length);
  // 2px de respiro entre barras vizinhas, como manda a especificação de marca.
  const barWidth = Math.max(2, slot - 2);

  const height = (value: number): number => (value / max) * (plotHeight / 2);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={zero}
          y2={zero}
          className="stroke-chart-grid"
          strokeWidth={1}
        />
        <text x={PADDING.left - 6} y={zero + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
          0
        </text>

        {points.map((point, index) => {
          const x = PADDING.left + index * slot + (slot - barWidth) / 2;
          const up = height(point.positive);
          const down = height(point.negative);

          return (
            <g
              key={point.label}
              onMouseEnter={() => setHover(index)}
              opacity={hover === null || hover === index ? 1 : 0.55}
            >
              <rect x={x} y={PADDING.top} width={barWidth} height={plotHeight} fill="transparent" />
              {point.positive > 0 ? (
                <rect
                  x={x}
                  y={zero - up}
                  width={barWidth}
                  height={up}
                  rx={2}
                  className="fill-chart-positive"
                />
              ) : null}
              {point.negative > 0 ? (
                <rect
                  x={x}
                  y={zero}
                  width={barWidth}
                  height={down}
                  rx={2}
                  className="fill-chart-negative"
                />
              ) : null}
            </g>
          );
        })}

        <text x={PADDING.left} y={HEIGHT - 6} className="fill-muted-foreground text-[9px]">
          {points.at(0)?.label}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          {points.at(-1)?.label}
        </text>
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-positive" />
          {positiveLabel}
          {hover !== null ? (
            <strong className="font-medium text-foreground">{points[hover]?.positive ?? 0}</strong>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-chart-negative" />
          {negativeLabel}
          {hover !== null ? (
            <strong className="font-medium text-foreground">{points[hover]?.negative ?? 0}</strong>
          ) : null}
        </span>
        {hover !== null ? <span>em {points[hover]?.label}</span> : null}
      </figcaption>
    </figure>
  );
}
