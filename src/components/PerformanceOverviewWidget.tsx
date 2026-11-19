import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Layers,
  Minus,
} from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildPerformanceOverviewData,
  type PerformanceDailyPoint,
  type PerformanceWindowDays,
} from '../engine/performanceOverviewEngine';
import type { ExecutiveCurrencyMetrics } from '../engine/executiveAnalytics';
import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CollectionDailySnapshotRecord,
  CurrencyCode,
  LoanRecord,
  NavSectionId,
} from '../types/axycore';
import { formatMoney } from '../utils/formatters';

interface PerformanceOverviewWidgetProps {
  currency: CurrencyCode;
  todayIso: string;
  darkMode: boolean;
  metrics: ExecutiveCurrencyMetrics;
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  collectionAccounts: CollectionAccountRecord[];
  collectionDailySnapshots: CollectionDailySnapshotRecord[];
  canAccessSection: (section: NavSectionId) => boolean;
  onNavigate: (section: NavSectionId) => void;
}

const WINDOW_OPTIONS: Array<{ value: PerformanceWindowDays; label: string }> = [
  { value: 7, label: '7 días' },
  { value: 14, label: '14 días' },
  { value: 30, label: '30 días' },
];

type LayoutViewMode = 'SPLIT' | 'COMBINED';

function DeltaCaption({
  delta,
  unit,
  inverse = false,
  fallback,
}: {
  delta: number | null;
  unit: 'pts' | '%';
  inverse?: boolean;
  fallback: string;
}) {
  if (delta === null || Number.isNaN(delta)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        <Minus className="w-3 h-3 shrink-0" />
        <span>{fallback}</span>
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        <Minus className="w-3 h-3 shrink-0" />
        <span>
          0.0{unit === 'pts' ? ' pts' : '%'} vs período previo
        </span>
      </span>
    );
  }
  const positive = delta > 0;
  const favorable = inverse ? !positive : positive;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-semibold ${
        favorable
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-rose-700 dark:text-rose-400'
      }`}
    >
      {positive ? (
        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>
        {positive ? `+${delta}` : `${delta}`}
        {unit === 'pts' ? ' pts' : '%'} vs período previo
      </span>
    </span>
  );
}

export function PerformanceOverviewWidget({
  currency,
  todayIso,
  darkMode,
  metrics,
  applications,
  loans,
  collectionAccounts,
  collectionDailySnapshots,
  canAccessSection,
  onNavigate,
}: PerformanceOverviewWidgetProps) {
  const [windowDays, setWindowDays] = useState<PerformanceWindowDays>(14);
  const [viewMode, setViewMode] = useState<LayoutViewMode>('SPLIT');
  const [showCumulativeLine, setShowCumulativeLine] = useState<boolean>(false);
  const [combinedVisibility, setCombinedVisibility] = useState({
    placement: true,
    approval: true,
    par30: true,
  });

  const data = useMemo(
    () =>
      buildPerformanceOverviewData({
        currency,
        windowDays,
        todayIso,
        metrics,
        applications,
        loans,
        collectionAccounts,
        collectionDailySnapshots,
      }),
    [
      currency,
      windowDays,
      todayIso,
      metrics,
      applications,
      loans,
      collectionAccounts,
      collectionDailySnapshots,
    ]
  );

  const axisTickColor = darkMode ? '#94A3B8' : '#64748B';
  const gridStroke = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(11,31,58,0.07)';

  const compactCurrency = (val: number) => {
    const prefix = currency === 'USD' ? 'US$' : 'RD$';
    if (Math.abs(val) >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${prefix}${(val / 1_000).toFixed(0)}k`;
    return `${prefix}${val.toFixed(0)}`;
  };

  const parStatusTone =
    data.par30.status === 'OPTIMO'
      ? 'text-emerald-700 dark:text-emerald-400'
      : data.par30.status === 'VIGILANCIA'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-rose-700 dark:text-rose-400';

  const parAxisMax = useMemo(() => {
    const maxObserved = Math.max(
      10,
      ...data.series.map((pt) => Math.max(pt.par30Pct, pt.par1Pct))
    );
    return Math.min(100, Math.ceil(maxObserved / 5) * 5 + 5);
  }, [data.series]);

  const tickInterval = windowDays === 30 ? 4 : windowDays === 14 ? 1 : 0;

  return (
    <section
      aria-label={`Vista General de Desempeño (${currency})`}
      className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#20C4E8]/18 shadow-[0_1px_3px_rgba(11,31,58,0.05)] overflow-hidden"
    >
      {/* Header Toolbar */}
      <div className="p-5 sm:p-6 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 border-b border-slate-100 dark:border-white/[0.07]">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white tracking-tight text-balance">
            Vista General de Desempeño
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Moneda {currency}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {data.startIso} al {data.endIso}
            </span>
            <span aria-hidden="true">·</span>
            <span>Tasa de aprobación, colocación diaria e índice PAR 30</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Horizon Segmented Control */}
          <div
            role="group"
            aria-label="Ventana de análisis"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/[0.08]"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setWindowDays(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  windowDays === opt.value
                    ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Layout Mode Segmented Control */}
          <div
            role="group"
            aria-label="Modo de visualización de gráficas"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/[0.08]"
          >
            <button
              type="button"
              onClick={() => setViewMode('SPLIT')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'SPLIT'
                  ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>3 Gráficas</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('COMBINED')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                viewMode === 'COMBINED'
                  ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>Vista Combinada</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3-Column Critical KPI Summary Strip (Flat with Hairline Dividers) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-white/[0.07] border-b border-slate-100 dark:border-white/[0.07]">
        {/* KPI 1: Tasa de Aprobación (Approval Rate) */}
        <div className="p-5 sm:p-6 flex flex-col justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Tasa de Aprobación (Approval Rate)
              </p>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                {data.approvalRate.scopeLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5">
              <p className="font-mono tabular-nums text-2xl sm:text-[28px] font-extrabold text-[#0B1F3A] dark:text-white tracking-tight">
                {data.approvalRate.currentPct !== null
                  ? `${data.approvalRate.currentPct.toFixed(1)}%`
                  : '—'}
              </p>
              <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                {data.approvalRate.approvedCount} aprob. / {data.approvalRate.decidedCount} decid.
              </span>
            </div>
            <DeltaCaption
              delta={data.approvalRate.deltaPts}
              unit="pts"
              fallback={
                data.approvalRate.decidedCount === 0
                  ? 'Sin resoluciones en cartera'
                  : 'Sin base previa comparable'
              }
            />
          </div>

          <div className="pt-2.5 border-t border-slate-100/90 dark:border-white/[0.05] flex items-center justify-between gap-2 text-[11px]">
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {data.approvalRate.rejectedCount} rechaz. · {data.approvalRate.pendingCount} en curso
            </span>
            {canAccessSection('applications') && (
              <button
                type="button"
                onClick={() => onNavigate('applications')}
                className="inline-flex items-center gap-1 font-semibold text-[#168BFF] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver originación</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* KPI 2: Volumen Total de Colocación Diaria */}
        <div className="p-5 sm:p-6 flex flex-col justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Colocación Diaria · {currency}
              </p>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                Hoy: {formatMoney(data.dailyPlacement.todayAmount, currency)}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <p className="font-mono tabular-nums text-2xl sm:text-[28px] font-extrabold text-[#0B1F3A] dark:text-white tracking-tight">
                {formatMoney(data.dailyPlacement.windowTotalAmount, currency)}
              </p>
              <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                {data.dailyPlacement.windowTotalCount} desembolso(s)
              </span>
            </div>
            <DeltaCaption
              delta={data.dailyPlacement.deltaPct}
              unit="%"
              fallback={
                data.dailyPlacement.windowTotalCount === 0
                  ? `Sin colocación en ${windowDays} días`
                  : 'Sin colocación en período previo'
              }
            />
          </div>

          <div className="pt-2.5 border-t border-slate-100/90 dark:border-white/[0.05] flex items-center justify-between gap-2 text-[11px]">
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              Prom. diario: {formatMoney(data.dailyPlacement.dailyAverageAmount, currency)}
            </span>
            {canAccessSection('disbursements') && (
              <button
                type="button"
                onClick={() => onNavigate('disbursements')}
                className="inline-flex items-center gap-1 font-semibold text-[#168BFF] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver desembolsos</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* KPI 3: Índice de Mora (PAR 30) */}
        <div className="p-5 sm:p-6 flex flex-col justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Índice de Mora (PAR 30)
              </p>
              <span className={`text-[11px] font-semibold shrink-0 ${parStatusTone}`}>
                {data.par30.statusLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <p className="font-mono tabular-nums text-2xl sm:text-[28px] font-extrabold text-[#0B1F3A] dark:text-white tracking-tight">
                {data.par30.currentPct.toFixed(2)}%
              </p>
              <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
                {formatMoney(data.par30.currentExposure, currency)}
              </span>
            </div>
            <DeltaCaption
              delta={data.par30.deltaPts}
              unit="pts"
              inverse
              fallback="Sin variación registrada"
            />
          </div>

          <div className="pt-2.5 border-t border-slate-100/90 dark:border-white/[0.05] flex items-center justify-between gap-2 text-[11px]">
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              PAR 1: {data.par30.par1Pct.toFixed(2)}% · {data.par30.accountsCount} cta(s) ≥30d
            </span>
            {canAccessSection('cobranza_portfolio') && (
              <button
                type="button"
                onClick={() => onNavigate('cobranza_portfolio')}
                className="inline-flex items-center gap-1 font-semibold text-[#168BFF] hover:underline cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Ver cartera</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Recharts Visualizations */}
      <div className="p-5 sm:p-6 space-y-6">
        {viewMode === 'COMBINED' ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                  Correlación Diaria: Colocación, Aprobación y Mora PAR 30
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Eje izquierdo en {currency} (barras) · Eje derecho en porcentaje 0–100% (líneas)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    {
                      key: 'placement',
                      label: 'Colocación diaria',
                      swatch: 'bg-[#168BFF]',
                    },
                    {
                      key: 'approval',
                      label: 'Tasa de aprobación',
                      swatch: 'bg-emerald-500',
                    },
                    {
                      key: 'par30',
                      label: 'Mora PAR 30',
                      swatch: 'bg-rose-500',
                    },
                  ] as const
                ).map((item) => {
                  const active = combinedVisibility[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        setCombinedVisibility((prev) => ({
                          ...prev,
                          [item.key]: !prev[item.key],
                        }))
                      }
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-slate-50 dark:bg-[#040C1E] border-slate-300 dark:border-[#20C4E8]/35 text-[#0B1F3A] dark:text-white'
                          : 'bg-transparent border-slate-200/70 dark:border-white/10 text-slate-400 dark:text-slate-500 line-through'
                      }`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-xs shrink-0 ${item.swatch} ${
                          active ? 'opacity-100' : 'opacity-30'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!data.hasPlacementData && !data.hasApprovalData && !data.hasParData ? (
              <div className="h-72 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Sin movimientos registrados en los últimos {windowDays} días ({currency})
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md">
                  A medida que se aprueben solicitudes y se desembolsen operaciones en {currency}, las series aparecerán automáticamente.
                </p>
                {windowDays < 30 && (
                  <button
                    type="button"
                    onClick={() => setWindowDays(30)}
                    className="mt-1 px-3 py-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#168BFF] text-white text-xs font-semibold cursor-pointer"
                  >
                    Ampliar a 30 días
                  </button>
                )}
              </div>
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={data.series}
                    margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={gridStroke}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      interval={tickInterval}
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={compactCurrency}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fill: axisTickColor, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0]?.payload as PerformanceDailyPoint;
                        return (
                          <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1.5 min-w-[220px]">
                            <p className="font-sans font-bold text-[#0B1F3A] dark:text-white border-b border-slate-100 dark:border-white/10 pb-1">
                              {pt.fullDateLabel}
                            </p>
                            {combinedVisibility.placement && (
                              <div className="flex items-center justify-between gap-4 text-[#168BFF]">
                                <span className="font-sans">Colocación:</span>
                                <span className="font-bold">
                                  {formatMoney(pt.dailyPlacementAmount, currency)} ({pt.dailyPlacementCount})
                                </span>
                              </div>
                            )}
                            {combinedVisibility.approval && (
                              <div className="flex items-center justify-between gap-4 text-emerald-700 dark:text-emerald-400">
                                <span className="font-sans">Aprobación acum.:</span>
                                <span className="font-bold">
                                  {pt.approvalRatePct !== null ? `${pt.approvalRatePct.toFixed(1)}%` : 'Sin base'}
                                </span>
                              </div>
                            )}
                            {combinedVisibility.par30 && (
                              <div className="flex items-center justify-between gap-4 text-rose-700 dark:text-rose-400">
                                <span className="font-sans">Mora PAR 30:</span>
                                <span className="font-bold">
                                  {pt.par30Pct.toFixed(2)}% ({formatMoney(pt.par30Exposure, currency)})
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    {combinedVisibility.placement && (
                      <Bar
                        yAxisId="left"
                        dataKey="dailyPlacementAmount"
                        name="Colocación diaria"
                        fill="#168BFF"
                        fillOpacity={0.85}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={24}
                      />
                    )}
                    {combinedVisibility.approval && (
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="approvalRatePct"
                        name="Tasa de aprobación (%)"
                        stroke="#10B981"
                        strokeWidth={2.25}
                        dot={{ r: 2.5, fill: '#10B981', strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    )}
                    {combinedVisibility.par30 && (
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="par30Pct"
                        name="Índice PAR 30 (%)"
                        stroke="#E11D48"
                        strokeWidth={2.25}
                        dot={{ r: 2.5, fill: '#E11D48', strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Primary Chart: Volumen Total de Colocación Diaria */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                    Volumen Total de Colocación Diaria ({currency})
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Desembolsos diarios ejecutados · Promedio{' '}
                    <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                      {formatMoney(data.dailyPlacement.dailyAverageAmount, currency)}/día
                    </span>
                    {data.dailyPlacement.peakDayLabel && (
                      <>
                        {' · '}Pico {data.dailyPlacement.peakDayLabel} (
                        <span className="font-mono tabular-nums">
                          {formatMoney(data.dailyPlacement.peakDayAmount, currency)}
                        </span>
                        )
                      </>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCumulativeLine((v) => !v)}
                  aria-pressed={showCumulativeLine}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    showCumulativeLine
                      ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white border-[#0B1F3A] dark:border-[#168BFF]'
                      : 'bg-white dark:bg-[#040C1E] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-[#168BFF]'
                  }`}
                >
                  {showCumulativeLine ? 'Ocultar acumulado' : 'Mostrar línea acumulada'}
                </button>
              </div>

              {!data.hasPlacementData ? (
                <div className="h-60 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center space-y-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Sin desembolsos en los últimos {windowDays} días ({currency})
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Cambia la ventana temporal o registra nuevos desembolsos para visualizar la colocación diaria.
                  </p>
                  {windowDays < 30 && (
                    <button
                      type="button"
                      onClick={() => setWindowDays(30)}
                      className="px-3 py-1.5 rounded-lg bg-[#0B1F3A] dark:bg-[#168BFF] text-white text-xs font-semibold cursor-pointer"
                    >
                      Ver últimos 30 días
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={data.series}
                      margin={{ top: 10, right: showCumulativeLine ? 12 : 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        interval={tickInterval}
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="daily"
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={compactCurrency}
                      />
                      {showCumulativeLine && (
                        <YAxis
                          yAxisId="cum"
                          orientation="right"
                          tick={{ fill: axisTickColor, fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={compactCurrency}
                        />
                      )}
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const pt = payload[0]?.payload as PerformanceDailyPoint;
                          return (
                            <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                              <p className="font-sans font-bold text-[#0B1F3A] dark:text-white">
                                {pt.fullDateLabel}
                              </p>
                              <p className="text-[#168BFF]">
                                Colocación del día: {formatMoney(pt.dailyPlacementAmount, currency)}
                              </p>
                              <p className="text-slate-600 dark:text-slate-300">
                                Operaciones: {pt.dailyPlacementCount} préstamo(s)
                              </p>
                              <p className="text-[#0E7490] dark:text-[#20C4E8]">
                                Acumulado ventana: {formatMoney(pt.cumulativePlacementAmount, currency)}
                              </p>
                            </div>
                          );
                        }}
                      />
                      {data.dailyPlacement.dailyAverageAmount > 0 && (
                        <ReferenceLine
                          yAxisId="daily"
                          y={data.dailyPlacement.dailyAverageAmount}
                          stroke={darkMode ? '#64748B' : '#94A3B8'}
                          strokeDasharray="4 4"
                          label={{
                            value: 'Prom. diario',
                            position: 'insideTopRight',
                            fill: axisTickColor,
                            fontSize: 10,
                          }}
                        />
                      )}
                      <Bar
                        yAxisId="daily"
                        dataKey="dailyPlacementAmount"
                        name="Colocación diaria"
                        fill="#168BFF"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      {showCumulativeLine && (
                        <Line
                          yAxisId="cum"
                          type="monotone"
                          dataKey="cumulativePlacementAmount"
                          name="Acumulado ventana"
                          stroke="#20C4E8"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Bottom 2-Column Split: Approval Rate & PAR 30 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6 border-t border-slate-100 dark:border-white/[0.07]">
              {/* Chart 2: Tasa de Aprobación (Approval Rate) */}
              <div className="lg:col-span-6 space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                      Tasa de Aprobación (Approval Rate)
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Evolución diaria del porcentaje de solicitudes aprobadas sobre decididas
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                    {data.approvalRate.currentPct !== null
                      ? `${data.approvalRate.currentPct.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>

                {!data.hasApprovalData ? (
                  <div className="h-60 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center space-y-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Sin solicitudes decididas en {currency}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      La curva de aprobación se construirá automáticamente al emitir resoluciones de comité.
                    </p>
                  </div>
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={data.series}
                        margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id={`perfApprovalGrad_${currency}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.26} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={gridStroke}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          interval={tickInterval}
                          tick={{ fill: axisTickColor, fontSize: 11 }}
                          axisLine={{ stroke: gridStroke }}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: axisTickColor, fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v: number) => `${v}%`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0]?.payload as PerformanceDailyPoint;
                            return (
                              <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                                <p className="font-sans font-bold text-[#0B1F3A] dark:text-white">
                                  {pt.fullDateLabel}
                                </p>
                                <p className="text-emerald-700 dark:text-emerald-400 font-bold">
                                  Approval Rate acum.:{' '}
                                  {pt.approvalRatePct !== null
                                    ? `${pt.approvalRatePct.toFixed(1)}%`
                                    : 'Sin base'}
                                </p>
                                <p className="text-slate-600 dark:text-slate-300">
                                  Resoluciones del día: {pt.dailyApprovedCount} aprob. ·{' '}
                                  {pt.dailyRejectedCount} rechaz.
                                </p>
                              </div>
                            );
                          }}
                        />
                        {data.approvalRate.currentPct !== null && (
                          <ReferenceLine
                            y={data.approvalRate.currentPct}
                            stroke="#10B981"
                            strokeOpacity={0.5}
                            strokeDasharray="4 4"
                          />
                        )}
                        <Area
                          type="monotone"
                          dataKey="approvalRatePct"
                          name="Tasa de aprobación"
                          stroke="#10B981"
                          strokeWidth={2.25}
                          fill={`url(#perfApprovalGrad_${currency})`}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Chart 3: Índice de Mora (PAR 30) */}
              <div className="lg:col-span-6 space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                      Índice de Mora (PAR 30 vs PAR 1)
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Cartera en riesgo ≥ 30 días frente a límite prudencial del 5.0%
                    </p>
                  </div>
                  <span className={`font-mono tabular-nums text-xs font-bold shrink-0 ${parStatusTone}`}>
                    {data.par30.currentPct.toFixed(2)}%
                  </span>
                </div>

                {!data.hasParData ? (
                  <div className="h-60 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center space-y-2">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Sin cartera activa evaluable en {currency}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      El índice PAR 30 se calculará automáticamente con préstamos vigentes y cortes diarios.
                    </p>
                  </div>
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={data.series}
                        margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id={`perfPar30Grad_${currency}`}
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="5%" stopColor="#E11D48" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#E11D48" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={gridStroke}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          interval={tickInterval}
                          tick={{ fill: axisTickColor, fontSize: 11 }}
                          axisLine={{ stroke: gridStroke }}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, parAxisMax]}
                          tick={{ fill: axisTickColor, fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v: number) => `${v}%`}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const pt = payload[0]?.payload as PerformanceDailyPoint;
                            return (
                              <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                                <p className="font-sans font-bold text-[#0B1F3A] dark:text-white">
                                  {pt.fullDateLabel}
                                </p>
                                <p className="text-rose-700 dark:text-rose-400 font-bold">
                                  PAR 30: {pt.par30Pct.toFixed(2)}% ({formatMoney(pt.par30Exposure, currency)})
                                </p>
                                <p className="text-amber-700 dark:text-amber-400">
                                  PAR 1 (≥1 día): {pt.par1Pct.toFixed(2)}%
                                </p>
                                <p className="text-slate-600 dark:text-slate-300">
                                  Cartera activa: {formatMoney(pt.activeCapital, currency)}
                                </p>
                              </div>
                            );
                          }}
                        />
                        <ReferenceLine
                          y={5}
                          stroke="#D97706"
                          strokeDasharray="4 4"
                          label={{
                            value: 'Límite 5%',
                            position: 'insideTopRight',
                            fill: darkMode ? '#FBBF24' : '#B45309',
                            fontSize: 10,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="par30Pct"
                          name="PAR 30 (%)"
                          stroke="#E11D48"
                          strokeWidth={2.25}
                          fill={`url(#perfPar30Grad_${currency})`}
                          activeDot={{ r: 5 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="par1Pct"
                          name="PAR 1 (%)"
                          stroke="#D97706"
                          strokeWidth={1.75}
                          strokeDasharray="4 3"
                          dot={false}
                          activeDot={{ r: 4 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
