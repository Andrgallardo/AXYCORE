import React, { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  buildPrincipalDonutSegments,
  type LoanHealthLevel,
  type PrincipalDonutSegment,
} from '../../engine/clientPortalHealthEngine';
import type { LoanRecord } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

interface ClientPrincipalProgressDonutProps {
  loan: LoanRecord;
  healthLevel: LoanHealthLevel;
}

const PAID_SEGMENT_COLOR: Record<LoanHealthLevel, string> = {
  AL_DIA: '#10B981',
  PROXIMO_VENCIMIENTO: '#E2B35E',
  ATRASO_MODERADO: '#F59E0B',
  MORA_CRITICA: '#F43F5E',
  CANCELADO: '#00B8FF',
};

const PENDING_SEGMENT_COLOR = '#64748B';

interface DonutTooltipPayloadItem {
  payload?: PrincipalDonutSegment;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: DonutTooltipPayloadItem[];
  currency: LoanRecord['currency'];
  totalFinanced: number;
  paidColor: string;
}

function PrincipalDonutTooltip({
  active,
  payload,
  currency,
  totalFinanced,
  paidColor,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }

  const seg = payload[0].payload;
  const swatch = seg.key === 'PAID' ? paidColor : PENDING_SEGMENT_COLOR;

  return (
    <div className="rounded-xl bg-[#040C1E]/95 border border-[#00B8FF]/35 px-3.5 py-2.5 text-white shadow-xl backdrop-blur-md min-w-[195px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: swatch }}
          />
          <span className="text-[11px] font-bold tracking-tight truncate">{seg.name}</span>
        </div>
        <span className="font-mono tabular-nums text-xs font-bold text-[#00D1FF]">
          {seg.pct.toFixed(1)}%
        </span>
      </div>

      <p className="mt-1.5 font-mono tabular-nums text-sm font-bold text-white">
        {formatMoney(seg.value, currency)}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-300 leading-snug">
        {seg.description} · de {formatMoney(totalFinanced, currency)}
      </p>
    </div>
  );
}

export function ClientPrincipalProgressDonut({
  loan,
  healthLevel,
}: ClientPrincipalProgressDonutProps) {
  const [hoveredKey, setHoveredKey] = useState<'PAID' | 'PENDING' | null>(null);

  const donutData = useMemo(() => buildPrincipalDonutSegments(loan), [loan]);
  const paidColor = PAID_SEGMENT_COLOR[healthLevel] || '#10B981';

  // Ensure Recharts always receives at least one non-zero slice when totalFinanced is 0
  const chartSegments = useMemo(() => {
    const hasPositive = donutData.segments.some((s) => s.value > 0);
    if (hasPositive) return donutData.segments;
    return [
      {
        key: 'PENDING' as const,
        name: 'Capital pendiente',
        value: 1,
        pct: 100,
        description: 'Sin saldo financiado registrado',
      },
    ];
  }, [donutData.segments]);

  const activeSegment = useMemo(() => {
    if (!hoveredKey) return null;
    return donutData.segments.find((s) => s.key === hoveredKey) || null;
  }, [hoveredKey, donutData.segments]);

  const centerPct = activeSegment ? Math.round(activeSegment.pct) : Math.round(donutData.paidPct);
  const centerLabel = activeSegment
    ? activeSegment.key === 'PAID'
      ? 'Pagado'
      : 'Pendiente'
    : 'Amortizado';

  return (
    <div className="flex flex-col items-center shrink-0 w-full sm:w-[196px]">
      {/* Recharts Interactive Donut Chart */}
      <div className="relative w-[176px] h-[176px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartSegments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={76}
              startAngle={90}
              endAngle={-270}
              paddingAngle={donutData.paidPrincipal > 0 && donutData.pendingPrincipal > 0 ? 3 : 0}
              cornerRadius={6}
              stroke="none"
              isAnimationActive={true}
              animationDuration={650}
              onMouseEnter={(_, idx) => {
                const seg = chartSegments[idx];
                if (seg) setHoveredKey(seg.key);
              }}
              onMouseLeave={() => setHoveredKey(null)}
            >
              {chartSegments.map((seg) => {
                const fill = seg.key === 'PAID' ? paidColor : PENDING_SEGMENT_COLOR;
                const isDimmed = hoveredKey !== null && hoveredKey !== seg.key;
                return (
                  <Cell
                    key={seg.key}
                    fill={fill}
                    fillOpacity={isDimmed ? 0.32 : seg.key === 'PENDING' ? 0.45 : 1}
                    style={{
                      cursor: 'pointer',
                      transition: 'fill-opacity 180ms ease',
                    }}
                  />
                );
              })}
            </Pie>
            <Tooltip
              wrapperStyle={{ zIndex: 40, pointerEvents: 'none' }}
              content={
                <PrincipalDonutTooltip
                  currency={loan.currency}
                  totalFinanced={donutData.totalFinancedPrincipal}
                  paidColor={paidColor}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center Readout (pointer-events-none so hover passes smoothly to slices) */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          <span className="font-display font-mono tabular-nums text-2xl font-bold text-slate-950 dark:text-white leading-none">
            {centerPct}%
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
            {centerLabel}
          </span>
        </div>
      </div>

      {/* Interactive Segment Legend */}
      <div className="mt-1 w-full space-y-1.5 text-[11px]">
        {donutData.segments.map((seg) => {
          const isHovered = hoveredKey === seg.key;
          const swatch = seg.key === 'PAID' ? paidColor : PENDING_SEGMENT_COLOR;
          return (
            <div
              key={seg.key}
              onMouseEnter={() => setHoveredKey(seg.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg transition-colors cursor-default ${
                isHovered
                  ? 'bg-slate-100 dark:bg-white/[0.07]'
                  : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
              }`}
            >
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 truncate">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: swatch,
                    opacity: seg.key === 'PENDING' ? 0.65 : 1,
                  }}
                />
                <span className="truncate">{seg.key === 'PAID' ? 'Pagado' : 'Pendiente'}</span>
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                {formatMoney(seg.value, loan.currency)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
