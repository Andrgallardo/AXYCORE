import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  DollarSign,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  Gavel,
  GripVertical,
  Landmark,
  Layers,
  LayoutGrid,
  ListChecks,
  Minus,
  PieChart as PieChartIcon,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  EXECUTIVE_KPI_CATALOG,
  type DashboardSectionId,
  type ExecutiveKpiWidgetId,
} from '../engine/dashboardWidgetConfig';
import {
  consolidateExecutiveMetricsToDop,
  type ExecutiveCurrencyMetrics,
} from '../engine/executiveAnalytics';
import {
  buildAxyCoreIntelligenceInsights,
  buildCollectionsOverviewSummary,
  buildEnrichedRecentActivity,
  buildHomeSmartAlerts,
  buildInstitutionalPerformance,
  buildPanoramaSeriesAndKpis,
  buildTeamProductivitySummary,
  type HomeSmartAlert,
  type PanoramaGranularity,
} from '../engine/homeDashboardEngine';
import { useBcrdExchangeRate } from '../hooks/useBcrdExchangeRate';
import { useDashboardWidgetConfig } from '../hooks/useDashboardWidgetConfig';
import type {
  CurrencyCode,
  ExecutiveCurrencyMode,
  ExecutivePeriodPreset,
  NavSectionId,
} from '../types/axycore';
import { formatMoney, formatTimestamp } from '../utils/formatters';
import { DashboardWidgetConfiguratorDrawer } from './home/DashboardWidgetConfiguratorModal';
import {
  AxyCoreIntelligencePanel,
  HomeAlertsCenterPanel,
  HomeRecentActivityPanel,
} from './home/HomeIntelligenceAndAlerts';
import {
  CollectionsSummaryPanel,
  InstitutionalPerformanceSection,
  SmartShortcutsSection,
  TeamProductivityPanel,
  type HomeShortcutItem,
} from './home/HomeOperationsPanels';
import { PerformanceOverviewWidget } from '../components/PerformanceOverviewWidget';

const GRANULARITY_OPTIONS: Array<{
  value: PanoramaGranularity;
  label: string;
  preset: ExecutivePeriodPreset;
}> = [
  { value: 'DIARIO', label: 'Diario', preset: 'TODAY' },
  { value: 'SEMANAL', label: 'Semanal', preset: 'LAST_7D' },
  { value: 'MENSUAL', label: 'Mensual', preset: 'CURRENT_MONTH' },
  { value: 'TRIMESTRAL', label: 'Trimestral', preset: 'LAST_90D' },
  { value: 'ANUAL', label: 'Anual', preset: 'CURRENT_YEAR' },
];

const CURRENCY_OPTIONS: Array<{ value: ExecutiveCurrencyMode; label: string }> = [
  { value: 'DOP', label: 'DOP (RD$)' },
  { value: 'USD', label: 'USD (US$)' },
  { value: 'SEPARATED', label: 'DOP y USD (RD$)' },
];

interface ConsolidatedBcrdInfo {
  rate: number;
  fecha: string | null;
  fuente: string;
  respaldo: boolean;
  loading: boolean;
  onRefresh: () => void;
  dopMetrics: ExecutiveCurrencyMetrics;
  usdMetrics: ExecutiveCurrencyMetrics;
}

const PRODUCT_PIE_COLORS = ['#0066FF', '#00B8FF', '#041B4E', '#E2B35E'];

type DetailIndicatorKey = ExecutiveKpiWidgetId;

function TrendIndicator({
  delta,
  suffix = 'vs período anterior',
  inverse = false,
  isPoints = false,
  emptyText = 'Sin base previa',
}: {
  delta: number | null;
  suffix?: string;
  inverse?: boolean;
  isPoints?: boolean;
  emptyText?: string;
}) {
  if (delta === null || Number.isNaN(delta)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        <Minus className="w-3 h-3 shrink-0" />
        <span>{emptyText}</span>
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
        <Minus className="w-3 h-3 shrink-0" />
        <span>0.0{isPoints ? ' pts' : '%'} {suffix}</span>
      </span>
    );
  }
  const positive = delta > 0;
  const favorable = inverse ? !positive : positive;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-semibold ${
        favorable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
      }`}
    >
      {positive ? (
        <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
      )}
      <span>
        {positive ? `+${delta}` : `${delta}`}
        {isPoints ? ' pts' : '%'} {suffix}
      </span>
    </span>
  );
}

function MiniSparkBars({
  values,
  barColor = 'bg-[#0066FF]',
}: {
  values: number[];
  barColor?: string;
}) {
  const max = Math.max(...values, 0);
  const sliced = values.slice(-6);
  if (max <= 0 || sliced.length === 0) {
    return (
      <div className="h-7 flex items-end gap-1 opacity-30" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-t-xs bg-slate-300 dark:bg-slate-600" />
        ))}
      </div>
    );
  }
  return (
    <div className="h-7 flex items-end gap-1" aria-hidden="true">
      {sliced.map((v, i) => {
        const pct = v > 0 ? Math.max(18, Math.round((v / max) * 100)) : 10;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-t-xs ${barColor} transition-all duration-300`}
            style={{ height: `${pct}%`, opacity: i === sliced.length - 1 ? 1 : 0.55 }}
          />
        );
      })}
    </div>
  );
}

function CurrencyExecutiveBlock({
  metrics,
  consolidatedInfo,
  granularity,
  onChangeGranularity,
  darkMode,
  showExecutiveSummary,
  showPanorama,
  isPrimaryCurrency,
  roleLabel,
  canConfigure,
  editMode,
  visibleKpis,
  hiddenKpis,
  lockedKpis,
  allowedKpiCount,
  onToggleEditMode,
  onReorderKpi,
  onMoveKpi,
  onToggleKpi,
  onShowAllKpis,
  onOpenConfigurator,
  onInspectIndicator,
}: {
  metrics: ExecutiveCurrencyMetrics;
  consolidatedInfo?: ConsolidatedBcrdInfo;
  granularity: PanoramaGranularity;
  onChangeGranularity: (g: PanoramaGranularity) => void;
  darkMode: boolean;
  showExecutiveSummary: boolean;
  showPanorama: boolean;
  isPrimaryCurrency: boolean;
  roleLabel: string;
  canConfigure: boolean;
  editMode: boolean;
  visibleKpis: ExecutiveKpiWidgetId[];
  hiddenKpis: ExecutiveKpiWidgetId[];
  lockedKpis: ExecutiveKpiWidgetId[];
  allowedKpiCount: number;
  onToggleEditMode: () => void;
  onReorderKpi: (fromId: ExecutiveKpiWidgetId, toId: ExecutiveKpiWidgetId) => void;
  onMoveKpi: (id: ExecutiveKpiWidgetId, dir: -1 | 1) => void;
  onToggleKpi: (id: ExecutiveKpiWidgetId) => void;
  onShowAllKpis: () => void;
  onOpenConfigurator: () => void;
  onInspectIndicator: (key: DetailIndicatorKey, currency: CurrencyCode) => void;
}) {
  const {
    loans,
    payments,
    loanInstallments,
    collectorTargets,
    collectionDailySnapshots,
    clockInfo,
    periodBounds,
  } = useAxyCore();

  const [delinquencyMode, setDelinquencyMode] = useState<'exposure' | 'count'>('exposure');
  const [draggingKpi, setDraggingKpi] = useState<ExecutiveKpiWidgetId | null>(null);
  const [dropTargetKpi, setDropTargetKpi] = useState<ExecutiveKpiWidgetId | null>(null);
  const cur = metrics.currency;
  const isConsolidated = Boolean(consolidatedInfo);
  const currencyTag = isConsolidated ? 'DOP + USD en RD$' : cur;

  const clearKpiDrag = () => {
    setDraggingKpi(null);
    setDropTargetKpi(null);
  };

  const panoramaData = useMemo(
    () =>
      buildPanoramaSeriesAndKpis({
        currency: cur,
        consolidateUsdToDopRate: consolidatedInfo?.rate,
        granularity,
        todayIso: clockInfo.todayIso,
        bounds: periodBounds,
        metrics,
        loans,
        payments,
        loanInstallments,
        collectorTargets,
        snapshots: collectionDailySnapshots,
      }),
    [
      cur,
      consolidatedInfo?.rate,
      granularity,
      clockInfo.todayIso,
      periodBounds,
      metrics,
      loans,
      payments,
      loanInstallments,
      collectorTargets,
      collectionDailySnapshots,
    ]
  );

  const axisTickColor = darkMode ? '#94A3B8' : '#64748B';
  const gridStroke = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(11,31,58,0.07)';

  const compactCurrency = (val: number) => {
    const prefix = cur === 'USD' ? 'US$' : 'RD$';
    if (Math.abs(val) >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(1)}M`;
    if (Math.abs(val) >= 1_000) return `${prefix}${(val / 1_000).toFixed(0)}k`;
    return `${prefix}${val.toFixed(0)}`;
  };

  const { enhancements, series, productDistribution } = panoramaData;
  const hasEvolution = series.some((s) => s.total > 0);
  const hasDisbOrRec = series.some((s) => s.desembolsos > 0 || s.recuperacion > 0);
  const hasDelinquency = metrics.delinquencyBuckets.some((b) => b.count > 0 || b.exposure > 0);
  const hasProducts = productDistribution.length > 0;

  const kpiGridColsClass =
    visibleKpis.length >= 4
      ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
      : visibleKpis.length === 3
      ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';

  const renderConsolidatedBreakdown = (dopAmount: number, usdAmount: number) => {
    if (!consolidatedInfo) return null;
    const usdConverted = usdAmount * consolidatedInfo.rate;
    return (
      <p
        className="mt-1 font-mono tabular-nums text-[10px] leading-snug text-slate-500 dark:text-slate-400"
        title={`DOP nativo: ${formatMoney(dopAmount, 'DOP')} + USD convertido: ${formatMoney(usdAmount, 'USD')} × RD$${consolidatedInfo.rate.toFixed(4)} = ${formatMoney(usdConverted, 'DOP')}`}
      >
        {formatMoney(dopAmount, 'DOP')} + {formatMoney(usdAmount, 'USD')}{' '}
        <span className="text-[#0052CC] dark:text-[#00D1FF]">
          (×{consolidatedInfo.rate.toFixed(2)})
        </span>
      </p>
    );
  };

  const renderKpiCardBody = (kpiId: ExecutiveKpiWidgetId) => {
    switch (kpiId) {
      case 'CARTERA_TOTAL':
        return (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Cartera Total · {currencyTag}
                </span>
                <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 dark:bg-[#0066FF]/18 text-[#0052CC] dark:text-[#00B8FF] flex items-center justify-center shrink-0">
                  <Landmark className="w-4 h-4" />
                </div>
              </div>

              <div>
                <p className="font-display tabular-nums text-2xl sm:text-[26px] font-bold text-slate-950 dark:text-white tracking-tight">
                  {formatMoney(metrics.activePortfolioCapital, cur)}
                </p>
                {consolidatedInfo &&
                  renderConsolidatedBreakdown(
                    consolidatedInfo.dopMetrics.activePortfolioCapital,
                    consolidatedInfo.usdMetrics.activePortfolioCapital
                  )}
                <div className="mt-1.5">
                  <TrendIndicator
                    delta={enhancements.portfolioGrowthPct}
                    suffix="variación mensual"
                    emptyText="Sin cierre mensual previo"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] flex items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                  {metrics.activeLoansCount} préstamo(s) vigente(s)
                </span>
                <button
                  type="button"
                  onClick={() => onInspectIndicator('CARTERA_TOTAL', cur)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ver detalle</span>
                </button>
              </div>
              <MiniSparkBars values={series.map((s) => s.total)} barColor="bg-[#0066FF]" />
            </div>
          </>
        );

      case 'CARTERA_VENCIDA':
        return (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Cartera Vencida · {currencyTag}
                </span>
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-display tabular-nums text-2xl sm:text-[26px] font-bold text-slate-950 dark:text-white tracking-tight">
                    {formatMoney(metrics.par1Exposure, cur)}
                  </p>
                  <span className="font-mono tabular-nums text-xs font-bold text-rose-600 dark:text-rose-400">
                    {metrics.par1Pct !== null ? `${metrics.par1Pct.toFixed(2)}% mora` : '0.00%'}
                  </span>
                </div>
                {consolidatedInfo &&
                  renderConsolidatedBreakdown(
                    consolidatedInfo.dopMetrics.par1Exposure,
                    consolidatedInfo.usdMetrics.par1Exposure
                  )}
                <div className="mt-1.5">
                  <TrendIndicator
                    delta={enhancements.parVariationPts}
                    inverse
                    isPoints
                    suffix="vs corte anterior"
                    emptyText="Sin snapshot de corte previo"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] flex items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                  PAR 30: {metrics.par30Pct !== null ? `${metrics.par30Pct.toFixed(2)}%` : '0.00%'} ·{' '}
                  {metrics.portfolioAtRiskCount} en riesgo
                </span>
                <button
                  type="button"
                  onClick={() => onInspectIndicator('CARTERA_VENCIDA', cur)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ver detalle</span>
                </button>
              </div>
              <MiniSparkBars
                values={metrics.delinquencyBuckets.slice(1).map((b) => b.exposure)}
                barColor="bg-rose-500"
              />
            </div>
          </>
        );

      case 'DESEMBOLSOS':
        return (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Desembolsos · {currencyTag}
                </span>
                <div className="w-8 h-8 rounded-lg bg-[#00B8FF]/12 dark:bg-[#00B8FF]/18 text-[#0052CC] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>

              <div>
                <p className="font-display tabular-nums text-2xl sm:text-[26px] font-bold text-slate-950 dark:text-white tracking-tight">
                  {formatMoney(metrics.disbursedPeriodTotal, cur)}
                </p>
                {consolidatedInfo &&
                  renderConsolidatedBreakdown(
                    consolidatedInfo.dopMetrics.disbursedPeriodTotal,
                    consolidatedInfo.usdMetrics.disbursedPeriodTotal
                  )}
                <div className="mt-1.5">
                  <TrendIndicator
                    delta={metrics.disbursedDeltaPct}
                    suffix="vs período anterior"
                    emptyText={
                      metrics.disbursedPeriodCount === 0
                        ? 'Sin desembolsos en período'
                        : 'Sin base previa comparable'
                    }
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] flex items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                  {metrics.disbursedPeriodCount} préstamo(s) desembolsado(s)
                </span>
                <button
                  type="button"
                  onClick={() => onInspectIndicator('DESEMBOLSOS', cur)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ver detalle</span>
                </button>
              </div>
              <MiniSparkBars values={series.map((s) => s.desembolsos)} barColor="bg-[#00B8FF]" />
            </div>
          </>
        );

      case 'RECUPERACION':
        return (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Recuperación · {currencyTag}
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-display tabular-nums text-2xl sm:text-[26px] font-bold text-slate-950 dark:text-white tracking-tight">
                    {formatMoney(metrics.recoveryPeriodTotal, cur)}
                  </p>
                  {enhancements.recoveryCompliancePct !== null && (
                    <span className="font-mono tabular-nums text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      {enhancements.recoveryCompliancePct}%
                    </span>
                  )}
                </div>
                {consolidatedInfo &&
                  renderConsolidatedBreakdown(
                    consolidatedInfo.dopMetrics.recoveryPeriodTotal,
                    consolidatedInfo.usdMetrics.recoveryPeriodTotal
                  )}

                {enhancements.recoveryTargetAmount !== null ? (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#0066FF] to-[#00B8FF]"
                        style={{
                          width: `${Math.min(100, Math.max(4, enhancements.recoveryCompliancePct ?? 0))}%`,
                        }}
                      />
                    </div>
                    <p className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                      Meta: {formatMoney(enhancements.recoveryTargetAmount, cur)}
                    </p>
                  </div>
                ) : (
                  <div className="mt-1.5">
                    <TrendIndicator
                      delta={metrics.recoveryDeltaPct}
                      suffix="vs período anterior"
                      emptyText="Sin meta ni cobros previos"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] flex items-end justify-between gap-2">
              <div className="space-y-1">
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                  {metrics.recoveryPaymentsCount} pago(s) aplicado(s)
                </span>
                <button
                  type="button"
                  onClick={() => onInspectIndicator('RECUPERACION', cur)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ver detalle</span>
                </button>
              </div>
              <MiniSparkBars values={series.map((s) => s.recuperacion)} barColor="bg-emerald-500" />
            </div>
          </>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* BLOQUE 2: RESUMEN EJECUTIVO (Tarjetas configurables por rol) */}
      {showExecutiveSummary && (
        <section className="space-y-3" aria-label={`Resumen Ejecutivo ${currencyTag}`}>
          {isPrimaryCurrency && (
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white tracking-tight">
                  Resumen Ejecutivo · {currencyTag}
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Rol: <strong className="text-[#0052CC] dark:text-[#00D1FF]">{roleLabel}</strong> ·{' '}
                  <span className="font-mono tabular-nums">
                    {visibleKpis.length}/{allowedKpiCount} visibles
                  </span>
                </span>
              </div>

              {canConfigure && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onToggleEditMode}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                      editMode
                        ? 'bg-[#0066FF] text-white border-[#0066FF]'
                        : 'bg-white dark:bg-[#08132B] text-slate-600 dark:text-slate-300 border-slate-200/85 dark:border-[#00B8FF]/18 hover:border-[#0066FF]'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>{editMode ? 'Listo' : 'Organizar widgets'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onOpenConfigurator}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white dark:bg-[#08132B] text-[#0052CC] dark:text-[#00D1FF] border border-slate-200/85 dark:border-[#00B8FF]/18 hover:border-[#0066FF] cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Configurar</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {isPrimaryCurrency && consolidatedInfo && (
            <div className="rounded-xl px-4 py-2.5 bg-[#0066FF]/[0.05] dark:bg-[#0066FF]/10 border border-[#0066FF]/20 dark:border-[#00B8FF]/25 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
                <Landmark className="w-3.5 h-3.5 text-[#0052CC] dark:text-[#00D1FF] shrink-0" />
                <span className="font-semibold text-slate-950 dark:text-white">
                  Consolidado real en RD$ (BCRD):
                </span>
                <span className="font-mono tabular-nums text-[11px] text-[#0052CC] dark:text-[#00D1FF] font-bold">
                  1 USD = RD${consolidatedInfo.rate.toFixed(4)}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {consolidatedInfo.fecha
                    ? `· Corte BCRD ${consolidatedInfo.fecha}`
                    : consolidatedInfo.respaldo
                    ? '· Tasa de respaldo'
                    : '· Tasa oficial de venta'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[11px]">
                <span className="text-slate-600 dark:text-slate-300">
                  DOP:{' '}
                  <strong className="text-slate-950 dark:text-white">
                    {formatMoney(consolidatedInfo.dopMetrics.activePortfolioCapital, 'DOP')}
                  </strong>
                </span>
                <span className="text-slate-400">+</span>
                <span className="text-slate-600 dark:text-slate-300">
                  USD:{' '}
                  <strong className="text-slate-950 dark:text-white">
                    {formatMoney(consolidatedInfo.usdMetrics.activePortfolioCapital, 'USD')}
                  </strong>{' '}
                  <span className="text-[#0052CC] dark:text-[#00D1FF]">
                    ({formatMoney(
                      consolidatedInfo.usdMetrics.activePortfolioCapital * consolidatedInfo.rate,
                      'DOP'
                    )})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={consolidatedInfo.onRefresh}
                  disabled={consolidatedInfo.loading}
                  className="inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer disabled:opacity-50"
                  title="Actualizar tasa oficial del Banco Central de la República Dominicana"
                >
                  <RefreshCw className={`w-3 h-3 ${consolidatedInfo.loading ? 'animate-spin' : ''}`} />
                  <span>{consolidatedInfo.loading ? 'Consultando...' : 'Actualizar BCRD'}</span>
                </button>
              </div>
            </div>
          )}

          {visibleKpis.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-dashed border-slate-300 dark:border-[#20C4E8]/25 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#0B1F3A] dark:text-white">
                  Todos los indicadores del Resumen Ejecutivo están ocultos
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Restaura tus tarjetas financieras autorizadas para {roleLabel} en un clic.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onShowAllKpis}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#168BFF] hover:bg-[#0E7AE8] text-white text-xs font-semibold cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Mostrar todos</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenConfigurator}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#168BFF] cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Abrir configurador</span>
                </button>
              </div>
            </div>
          ) : (
            <div className={`grid ${kpiGridColsClass} gap-4`}>
              {visibleKpis.map((kpiId, idx) => {
                const isDragging = draggingKpi === kpiId;
                const isDropTarget = dropTargetKpi === kpiId && draggingKpi !== kpiId;
                const isLocked = lockedKpis.includes(kpiId);
                const label = EXECUTIVE_KPI_CATALOG[kpiId].label;

                return (
                  <article
                    key={kpiId}
                    draggable={canConfigure}
                    onDragStart={(e) => {
                      if (!canConfigure) return;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', kpiId);
                      setDraggingKpi(kpiId);
                    }}
                    onDragOver={(e) => {
                      if (!canConfigure) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTargetKpi !== kpiId) setDropTargetKpi(kpiId);
                    }}
                    onDrop={(e) => {
                      if (!canConfigure) return;
                      e.preventDefault();
                      if (draggingKpi && draggingKpi !== kpiId) {
                        onReorderKpi(draggingKpi, kpiId);
                      }
                      clearKpiDrag();
                    }}
                    onDragEnd={clearKpiDrag}
                    className={`group relative rounded-2xl bg-white dark:bg-[#08132B] border shadow-[0_1px_3px_rgba(11,31,58,0.05)] p-5 flex flex-col justify-between gap-4 transition-all ${
                      isDragging
                        ? 'opacity-50 scale-[0.98] border-[#168BFF]'
                        : isDropTarget
                        ? 'border-[#168BFF] ring-2 ring-[#168BFF]/35 bg-[#168BFF]/[0.02]'
                        : editMode
                        ? 'border-dashed border-[#168BFF]/55 dark:border-[#20C4E8]/45'
                        : 'border-slate-200/85 dark:border-[#20C4E8]/18 hover:border-[#168BFF]/45'
                    }`}
                  >
                    {canConfigure && (
                      <div
                        className={`flex items-center justify-between gap-2 pb-2 -mt-1 border-b border-slate-100/90 dark:border-white/[0.06] transition-opacity ${
                          editMode
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                        }`}
                      >
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 group-hover:text-[#168BFF] cursor-grab active:cursor-grabbing select-none"
                          title="Arrastra esta tarjeta para cambiar su posición"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                          <span>Arrastrar</span>
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveKpi(kpiId, -1)}
                            className="p-1 rounded-md text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                            aria-label={`Mover ${label} a la izquierda`}
                            title="Mover a la izquierda"
                          >
                            <ArrowLeft className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === visibleKpis.length - 1}
                            onClick={() => onMoveKpi(kpiId, 1)}
                            className="p-1 rounded-md text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                            aria-label={`Mover ${label} a la derecha`}
                            title="Mover a la derecha"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          {!isLocked && (
                            <button
                              type="button"
                              onClick={() => onToggleKpi(kpiId)}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                              aria-label={`Ocultar ${label}`}
                              title={`Ocultar ${label}`}
                            >
                              <EyeOff className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {renderKpiCardBody(kpiId)}
                  </article>
                );
              })}
            </div>
          )}

          {isPrimaryCurrency && canConfigure && hiddenKpis.length > 0 && visibleKpis.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-[#08132B]/70 border border-slate-200/80 dark:border-white/[0.07] text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Indicadores ocultos:</span>
                </span>
                {hiddenKpis.map((hid) => (
                  <button
                    key={hid}
                    type="button"
                    onClick={() => onToggleKpi(hid)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F4F7FB] dark:bg-white/10 text-[#0B1F3A] dark:text-slate-200 hover:bg-[#168BFF] hover:text-white transition-colors font-semibold cursor-pointer"
                  >
                    <span>+ {EXECUTIVE_KPI_CATALOG[hid].label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onShowAllKpis}
                className="font-semibold text-[#168BFF] hover:underline cursor-pointer"
              >
                Restaurar todos
              </button>
            </div>
          )}
        </section>
      )}

      {/* BLOQUE 3: INTELIGENCIA FINANCIERA — PANORAMA FINANCIERO */}
      {showPanorama && (
        <section className="axy-surface rounded-2xl p-5 sm:p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-100 dark:border-white/[0.07]">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Panorama financiero ({currencyTag})</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {consolidatedInfo
                  ? `Analítica consolidada en RD$ convirtiendo cartera USD a tasa oficial BCRD (RD$${consolidatedInfo.rate.toFixed(4)})`
                  : 'Analítica interactiva de evolución de cartera, colocación, morosidad y mezcla de productos'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/[0.08]">
              {GRANULARITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeGranularity(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    granularity === opt.value
                      ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Gráfico 1: Evolución de cartera */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                    Evolución de cartera
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Saldo de capital vigente frente a exposición vencida ({granularity.toLowerCase()})
                  </p>
                </div>
                <span className="font-mono tabular-nums text-xs font-semibold text-[#168BFF]">
                  {formatMoney(metrics.activePortfolioCapital, cur)}
                </span>
              </div>

              {!hasEvolution ? (
                <div className="h-64 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Sin cartera registrada en {cur}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    La evolución se trazará automáticamente al desembolsar operaciones.
                  </p>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`axyGradVig_${cur}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0066FF" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#00B8FF" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="period"
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={compactCurrency}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as (typeof series)[number];
                          return (
                            <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#00B8FF]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                              <p className="font-sans font-bold text-slate-950 dark:text-white">
                                Corte {label}
                              </p>
                              <p className="text-[#0066FF] dark:text-[#00B8FF]">
                                Total cartera: {formatMoney(row.total, cur)}
                              </p>
                              <p className="text-[#00B8FF]">
                                Capital vigente: {formatMoney(row.vigente, cur)}
                              </p>
                              <p className="text-rose-600 dark:text-rose-400">
                                Capital vencido: {formatMoney(row.vencido, cur)}
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Area
                        type="monotone"
                        dataKey="vigente"
                        name="Capital Vigente"
                        stroke="#0066FF"
                        strokeWidth={2.25}
                        fill={`url(#axyGradVig_${cur})`}
                      />
                      <Area
                        type="monotone"
                        dataKey="vencido"
                        name="Capital Vencido"
                        stroke="#EF4444"
                        strokeWidth={2}
                        fill="rgba(239,68,68,0.08)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Gráfico 2: Desembolsos versus recuperaciones */}
            <div className="lg:col-span-6 space-y-3">
              <div>
                <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                  Desembolsos versus recuperaciones
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Colocación efectiva frente a pagos verificados aplicados ({granularity.toLowerCase()})
                </p>
              </div>

              {!hasDisbOrRec ? (
                <div className="h-64 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Sin desembolsos ni pagos aplicados en este horizonte ({cur})
                  </p>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="period"
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: axisTickColor, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={compactCurrency}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as (typeof series)[number];
                          return (
                            <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#00B8FF]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                              <p className="font-sans font-bold text-slate-950 dark:text-white">
                                {label}
                              </p>
                              <p className="text-[#0066FF] dark:text-[#00B8FF]">
                                Desembolsos: {formatMoney(row.desembolsos, cur)}
                              </p>
                              <p className="text-[#00B8FF]">
                                Recuperación: {formatMoney(row.recuperacion, cur)}
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar
                        dataKey="desembolsos"
                        name="Desembolsos"
                        fill="#0066FF"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="recuperacion"
                        name="Recuperaciones"
                        fill="#00B8FF"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Gráfico 3: Comportamiento de la morosidad */}
            <div className="lg:col-span-6 space-y-3 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white">
                    Comportamiento de la morosidad
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Distribución actual por días de atraso (DPD)
                  </p>
                </div>
                <div className="inline-flex p-0.5 rounded-lg bg-[#F4F7FB] dark:bg-[#040C1E] border border-slate-200/75 dark:border-white/10 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDelinquencyMode('exposure')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      delinquencyMode === 'exposure'
                        ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Monto
                  </button>
                  <button
                    type="button"
                    onClick={() => setDelinquencyMode('count')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      delinquencyMode === 'count'
                        ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Cuentas
                  </button>
                </div>
              </div>

              {!hasDelinquency ? (
                <div className="h-60 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Sin cuentas registradas en cobranza ({cur})
                  </p>
                </div>
              ) : (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={metrics.delinquencyBuckets}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fill: axisTickColor, fontSize: 10 }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: axisTickColor, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={
                          delinquencyMode === 'exposure' ? compactCurrency : (v: number) => `${v}`
                        }
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as (typeof metrics.delinquencyBuckets)[number];
                          return (
                            <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                              <p className="font-sans font-bold text-[#0B1F3A] dark:text-white">
                                {row.bucket}
                              </p>
                              <p className="text-[#168BFF]">Préstamos: {row.count}</p>
                              <p className="text-slate-700 dark:text-slate-200">
                                Exposición: {formatMoney(row.exposure, cur)}
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey={delinquencyMode === 'exposure' ? 'exposure' : 'count'}
                        name={delinquencyMode === 'exposure' ? 'Exposición' : 'Cuentas'}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={38}
                      >
                        {metrics.delinquencyBuckets.map((entry, idx) => (
                          <Cell
                            key={entry.bucket}
                            fill={
                              idx === 0
                                ? '#123B65'
                                : idx === 1
                                ? '#168BFF'
                                : idx === 2
                                ? '#E2B35E'
                                : idx === 3
                                ? '#F97316'
                                : '#EF4444'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Gráfico 4: Distribución de cartera por producto */}
            <div className="lg:col-span-6 space-y-3 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-[#0B1F3A] dark:text-white flex items-center gap-1.5">
                    <PieChartIcon className="w-3.5 h-3.5 text-[#20C4E8]" />
                    <span>Distribución de cartera por producto</span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Concentración real del saldo vigente por línea de crédito ({cur})
                  </p>
                </div>
              </div>

              {!hasProducts ? (
                <div className="h-60 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 border border-dashed border-slate-200 dark:border-white/10 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Sin cartera activa por producto en {cur}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  <div className="sm:col-span-5 h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={productDistribution}
                          dataKey="amount"
                          nameKey="label"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={3}
                        >
                          {productDistribution.map((item, idx) => (
                            <Cell
                              key={item.productCode}
                              fill={PRODUCT_PIE_COLORS[idx % PRODUCT_PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0]?.payload as (typeof productDistribution)[number];
                            return (
                              <div className="p-3 rounded-xl bg-white/95 dark:bg-[#040C1E]/95 backdrop-blur-md border border-slate-200 dark:border-[#20C4E8]/30 shadow-lg text-xs font-mono tabular-nums space-y-1">
                                <p className="font-sans font-bold text-[#0B1F3A] dark:text-white">
                                  {row.label}
                                </p>
                                <p className="text-[#168BFF]">
                                  Saldo: {formatMoney(row.amount, cur)}
                                </p>
                                <p className="text-slate-600 dark:text-slate-300">
                                  {row.count} préstamo(s) · {row.sharePct}%
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="sm:col-span-7 divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {productDistribution.map((prod, idx) => (
                      <div key={prod.productCode} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{
                              backgroundColor: PRODUCT_PIE_COLORS[idx % PRODUCT_PIE_COLORS.length],
                            }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#0B1F3A] dark:text-white truncate">
                              {prod.label}
                            </p>
                            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {prod.count} operación(es)
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 font-mono tabular-nums">
                          <p className="text-xs font-bold text-[#0B1F3A] dark:text-white">
                            {formatMoney(prod.amount, cur)}
                          </p>
                          <p className="text-[11px] text-[#168BFF] dark:text-[#20C4E8] font-semibold">
                            {prod.sharePct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export function ExecutiveDashboardView() {
  const {
    firebaseUser,
    userProfile,
    organization,
    darkMode,
    dataLoading,
    executivePeriod,
    setExecutivePeriod,
    executiveCurrency,
    setExecutiveCurrency,
    lastSyncedAtIso,
    clockInfo,
    periodBounds,
    dopMetrics,
    usdMetrics,
    activeOrTestPolicy,
    applications,
    documents,
    loans,
    loanInstallments,
    collectionAccounts,
    collectionActions,
    collectionTasks,
    paymentPromises,
    paymentAgreements,
    payments,
    collectorTargets,
    collectionDailySnapshots,
    riskAlerts,
    reconciliationExceptions,
    customerDisputes,
    operatingExpenses,
    auditLogs,
    usersList,
    aiConfigured,
    directorAnalysis,
    directorLoading,
    runDirectorAnalysis,
    setActiveSection,
    setSelectedApplicationId,
    setSelectedCollectionLoanId,
    rbac,
  } = useAxyCore();

  // Tasa oficial de cambio USD -> DOP del Banco Central de la República Dominicana (BCRD)
  const bcrd = useBcrdExchangeRate(activeOrTestPolicy.exchangeRateConfig?.dopPerUsd || 60.0);
  const isConsolidated = executiveCurrency === 'SEPARATED';
  const consolidateRate = isConsolidated ? bcrd.rate : undefined;

  const consolidatedMetrics = useMemo(
    () => consolidateExecutiveMetricsToDop(dopMetrics, usdMetrics, bcrd.rate),
    [dopMetrics, usdMetrics, bcrd.rate]
  );

  const consolidatedInfo: ConsolidatedBcrdInfo | undefined = useMemo(
    () =>
      isConsolidated
        ? {
            rate: bcrd.rate,
            fecha: bcrd.fecha,
            fuente: bcrd.fuente,
            respaldo: bcrd.respaldo,
            loading: bcrd.loading,
            onRefresh: () => {
              void bcrd.refresh();
            },
            dopMetrics,
            usdMetrics,
          }
        : undefined,
    [isConsolidated, bcrd, dopMetrics, usdMetrics]
  );

  const [granularity, setGranularity] = useState<PanoramaGranularity>(() => {
    if (executivePeriod === 'TODAY') return 'DIARIO';
    if (executivePeriod === 'LAST_7D') return 'SEMANAL';
    if (executivePeriod === 'LAST_90D') return 'TRIMESTRAL';
    if (executivePeriod === 'CURRENT_YEAR') return 'ANUAL';
    return 'MENSUAL';
  });

  const [detailModal, setDetailModal] = useState<{
    key: DetailIndicatorKey;
    currency: CurrencyCode;
  } | null>(null);

  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [focusTab, setFocusTab] = useState<
    'OVERVIEW' | 'ANALYTICS' | 'OPERATIONS' | 'INTELLIGENCE' | 'ALL'
  >('OVERVIEW');

  const widgetState = useDashboardWidgetConfig({
    organizationId: organization.id,
    userId: userProfile?.uid || 'anon',
    role: rbac.role,
    isAuthenticated: Boolean(firebaseUser && firebaseUser.emailVerified && userProfile),
    hasPermission: rbac.hasPermission,
    canAccessSection: rbac.canAccessSection,
  });

  const TAB_SECTIONS_MAP: Record<
    'OVERVIEW' | 'ANALYTICS' | 'OPERATIONS' | 'INTELLIGENCE' | 'ALL',
    DashboardSectionId[] | null
  > = {
    OVERVIEW: ['executiveSummary', 'alertsAndActivity', 'shortcuts'],
    ANALYTICS: ['performanceOverview', 'panorama', 'performance'],
    OPERATIONS: ['collections', 'teamProductivity'],
    INTELLIGENCE: ['intelligence'],
    ALL: null,
  };

  const effectiveTab = widgetState.editMode ? 'ALL' : focusTab;

  const displayedSections = useMemo(() => {
    const allowedByTab = TAB_SECTIONS_MAP[effectiveTab];
    if (!allowedByTab) return widgetState.visibleSections;
    const matched = widgetState.visibleSections.filter((s) => allowedByTab.includes(s));
    return matched.length > 0 ? matched : widgetState.visibleSections;
  }, [effectiveTab, widgetState.visibleSections]);

  const availableFocusTabs = useMemo(() => {
    const defs: Array<{
      id: 'OVERVIEW' | 'ANALYTICS' | 'OPERATIONS' | 'INTELLIGENCE' | 'ALL';
      label: string;
    }> = [
      { id: 'OVERVIEW', label: 'Resumen' },
      { id: 'ANALYTICS', label: 'Analítica' },
      { id: 'OPERATIONS', label: 'Operación' },
      { id: 'INTELLIGENCE', label: 'Inteligencia' },
      { id: 'ALL', label: 'Vista completa' },
    ];
    return defs.filter((tab) => {
      if (tab.id === 'ALL') return true;
      const list = TAB_SECTIONS_MAP[tab.id];
      return Boolean(list && widgetState.visibleSections.some((s) => list.includes(s)));
    });
  }, [widgetState.visibleSections]);

  const handleGranularityChange = (g: PanoramaGranularity) => {
    setGranularity(g);
    const match = GRANULARITY_OPTIONS.find((o) => o.value === g);
    if (match && match.preset !== executivePeriod) {
      setExecutivePeriod(match.preset);
    }
  };

  const activeCurrencyBlocks: ExecutiveCurrencyMetrics[] = useMemo(() => {
    if (executiveCurrency === 'DOP') return [dopMetrics];
    if (executiveCurrency === 'USD') return [usdMetrics];
    return [consolidatedMetrics];
  }, [executiveCurrency, dopMetrics, usdMetrics, consolidatedMetrics]);

  const primaryMetrics = activeCurrencyBlocks[0] ?? dopMetrics;
  const primaryCurrency = primaryMetrics.currency;

  const primaryEnhancements = useMemo(
    () =>
      buildPanoramaSeriesAndKpis({
        currency: primaryCurrency,
        consolidateUsdToDopRate: consolidateRate,
        granularity,
        todayIso: clockInfo.todayIso,
        bounds: periodBounds,
        metrics: primaryMetrics,
        loans,
        payments,
        loanInstallments,
        collectorTargets,
        snapshots: collectionDailySnapshots,
      }).enhancements,
    [
      primaryCurrency,
      consolidateRate,
      granularity,
      clockInfo.todayIso,
      periodBounds,
      primaryMetrics,
      loans,
      payments,
      loanInstallments,
      collectorTargets,
      collectionDailySnapshots,
    ]
  );

  // BLOQUE 4: Centro de Alertas Inteligentes
  const smartAlerts = useMemo(
    () =>
      buildHomeSmartAlerts({
        todayIso: clockInfo.todayIso,
        applications,
        loans,
        loanInstallments,
        collectionAccounts,
        paymentPromises,
        paymentAgreements,
        documents,
        riskAlerts,
        reconciliationExceptions,
        customerDisputes,
        operatingExpenses,
        canAccessSection: rbac.canAccessSection,
        hasPermission: rbac.hasPermission,
      }),
    [
      clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      collectionAccounts,
      paymentPromises,
      paymentAgreements,
      documents,
      riskAlerts,
      reconciliationExceptions,
      customerDisputes,
      operatingExpenses,
      rbac,
    ]
  );

  // BLOQUE 5: Actividad Reciente enriquecida
  const recentEntries = useMemo(
    () =>
      buildEnrichedRecentActivity({
        auditLogs,
        usersList,
        hasPermission: rbac.hasPermission,
        canAccessSection: rbac.canAccessSection,
        limit: 12,
      }),
    [auditLogs, usersList, rbac]
  );

  // BLOQUE 6: Rendimiento de la Institución
  const institutionalPerf = useMemo(
    () =>
      buildInstitutionalPerformance({
        applications,
        documents,
        collectionTasks,
        collectionActions,
        customerDisputes,
        payments,
        metrics: primaryMetrics,
      }),
    [
      applications,
      documents,
      collectionTasks,
      collectionActions,
      customerDisputes,
      payments,
      primaryMetrics,
    ]
  );

  // BLOQUE 7: Resumen de Cobros
  const collectionsSummary = useMemo(
    () =>
      buildCollectionsOverviewSummary({
        currency: primaryCurrency,
        consolidateUsdToDopRate: consolidateRate,
        todayIso: clockInfo.todayIso,
        bounds: periodBounds,
        metrics: primaryMetrics,
        collectionAccounts,
        collectionActions,
        paymentPromises,
        payments,
        collectorTargets,
      }),
    [
      primaryCurrency,
      consolidateRate,
      clockInfo.todayIso,
      periodBounds,
      primaryMetrics,
      collectionAccounts,
      collectionActions,
      paymentPromises,
      payments,
      collectorTargets,
    ]
  );

  // BLOQUE 8: Productividad del Equipo
  const teamProductivity = useMemo(
    () =>
      buildTeamProductivitySummary({
        role: rbac.role,
        userId: userProfile?.uid || '',
        bounds: periodBounds,
        usersList,
        applications,
        loans,
        payments,
        collectionActions,
        collectionTasks,
        documents,
        canAccessSection: rbac.canAccessSection,
      }),
    [
      rbac,
      userProfile?.uid,
      periodBounds,
      usersList,
      applications,
      loans,
      payments,
      collectionActions,
      collectionTasks,
      documents,
    ]
  );

  // ELEMENTO DIFERENCIADOR: AXYCORE INTELLIGENCE
  const intelligenceInsights = useMemo(
    () =>
      buildAxyCoreIntelligenceInsights({
        currency: primaryCurrency,
        consolidateUsdToDopRate: consolidateRate,
        metrics: primaryMetrics,
        enhancements: primaryEnhancements,
        alerts: smartAlerts,
        teamProductivity,
        documents,
        payments,
        canAccessSection: rbac.canAccessSection,
      }),
    [
      primaryCurrency,
      consolidateRate,
      primaryMetrics,
      primaryEnhancements,
      smartAlerts,
      teamProductivity,
      documents,
      payments,
      rbac,
    ]
  );

  // BLOQUE 9: Accesos Inteligentes (dinámicos por permisos, sin duplicar el menú)
  const smartShortcuts = useMemo<HomeShortcutItem[]>(() => {
    const canSee = rbac.canAccessSection;
    const list: Array<HomeShortcutItem & { allowed: boolean }> = [
      {
        id: 'sc_apps',
        label: 'Solicitudes Recibidas',
        subtitle: 'Bandeja de originación y pre-evaluación',
        metricBadge: `${primaryMetrics.pendingEvaluationCount} por evaluar`,
        icon: FileText,
        onClick: () => setActiveSection('applications'),
        allowed: canSee('applications'),
      },
      {
        id: 'sc_committee',
        label: 'Comité de Crédito',
        subtitle: 'Votación colegiada de expedientes',
        metricBadge: `${applications.filter((a) => a.status === 'EN_COMITE').length} en comité`,
        icon: Gavel,
        onClick: () => setActiveSection('committee'),
        allowed: canSee('committee'),
      },
      {
        id: 'sc_cobros_day',
        label: 'Cobros del Día',
        subtitle: 'Cuotas exigibles en la jornada',
        metricBadge: `${primaryMetrics.dailyDueCount} cuota(s) hoy`,
        icon: ClipboardCheck,
        onClick: () => setActiveSection('cobranza_daily'),
        allowed: canSee('cobranza_daily'),
      },
      {
        id: 'sc_actions',
        label: 'Gestiones y Acuerdos',
        subtitle: 'Seguimiento, promesas y reestructuración',
        metricBadge: `${primaryMetrics.brokenPromisesCount} incumplida(s)`,
        icon: ListChecks,
        onClick: () =>
          setActiveSection(canSee('cobranza_actions') ? 'cobranza_actions' : 'cobranza_my_actions'),
        allowed: canSee('cobranza_actions') || canSee('cobranza_my_actions'),
      },
      {
        id: 'sc_loans',
        label: 'Préstamos Activos',
        subtitle: 'Maestro de cartera vigente y ficha 360°',
        metricBadge: `${loans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO').length} vigentes`,
        icon: Briefcase,
        onClick: () => setActiveSection('loans'),
        allowed: canSee('loans'),
      },
      {
        id: 'sc_accounting',
        label: 'Estados Financieros',
        subtitle: 'Balance, resultados y flujo de efectivo',
        icon: Layers,
        onClick: () => setActiveSection('accounting_statements'),
        allowed: canSee('accounting_statements') || canSee('accounting'),
      },
      {
        id: 'sc_reports',
        label: 'Reportes de Cobranza',
        subtitle: '20 informes ejecutivos y exportación',
        icon: BarChart3,
        onClick: () => setActiveSection('cobranza_reports'),
        allowed: canSee('cobranza_reports'),
      },
      {
        id: 'sc_docs',
        label: 'Expedientes Digitales',
        subtitle: 'Validación y resguardo documental',
        metricBadge: `${documents.filter((d) => d.reviewStatus === 'OBSERVADO').length} observado(s)`,
        icon: Users,
        onClick: () => setActiveSection('documents'),
        allowed: canSee('documents'),
      },
    ];
    return list.filter((i) => i.allowed).slice(0, 8);
  }, [rbac, primaryMetrics, applications, loans, documents, setActiveSection]);

  const handleSelectAlert = (alert: HomeSmartAlert) => {
    if (alert.applicationId) {
      setSelectedApplicationId(alert.applicationId);
      return;
    }
    if (alert.loanId) {
      setSelectedCollectionLoanId(alert.loanId);
      return;
    }
    if (rbac.canAccessSection(alert.targetSection)) {
      setActiveSection(alert.targetSection);
    }
  };

  // Actions in Hero (Bloque 1)
  const canNewApplication =
    rbac.canAccessSection('new_application') || rbac.hasPermission('ORIGINATE_APPLICATION');
  const canRegisterPayment =
    rbac.canAccessSection('register_payment') || rbac.canAccessSection('cobranza_payments');
  const canNewCustomer = rbac.canAccessSection('customers');

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto">
      {/* BLOQUE 1: CABECERA EJECUTIVA SERENA (ESTILO STRIPE / MERCURY) */}
      <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 shadow-[0_1px_2px_rgba(11,31,58,0.03)]">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span>{organization.tradeName || organization.name}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>{clockInfo.formattedDate}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                {dataLoading ? (
                  <>
                    <RefreshCw className="w-3 h-3 text-[#0066FF] dark:text-[#00D1FF] animate-spin shrink-0" />
                    <span>Sincronizando…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    <span className="font-mono tabular-nums text-[11px]">
                      Actualizado {formatTimestamp(lastSyncedAtIso)}
                    </span>
                  </>
                )}
              </span>
            </div>

            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tracking-tight">
              {clockInfo.greeting}, {userProfile?.displayName || 'Ejecutivo'}
            </h1>

            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Corte activo:{' '}
              <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-300">
                {periodBounds.label} ({periodBounds.startIso} → {periodBounds.endIso})
              </span>
              <span aria-hidden="true"> · </span>
              <span>{rbac.roleLabel}</span>
            </p>
          </div>

          {/* Acciones principales claras y ordenadas */}
          {(canNewApplication || canRegisterPayment || canNewCustomer) && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canNewApplication && (
                <button
                  type="button"
                  onClick={() => setActiveSection('new_application')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Nueva solicitud</span>
                </button>
              )}
              {canRegisterPayment && (
                <button
                  type="button"
                  onClick={() =>
                    setActiveSection(
                      rbac.canAccessSection('register_payment')
                        ? 'register_payment'
                        : 'cobranza_payments'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <CreditCard className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                  <span>Registrar pago</span>
                </button>
              )}
              {canNewCustomer && (
                <button
                  type="button"
                  onClick={() => setActiveSection('customers')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span>Nuevo cliente</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Barra inferior: Navegación por vistas del tablero + Moneda + Personalización */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-100 dark:border-white/8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Selector progresivo de vistas del tablero */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 lg:pb-0">
            {availableFocusTabs.map((tab) => {
              const active = effectiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (widgetState.editMode && tab.id !== 'ALL') {
                      widgetState.setEditMode(false);
                    }
                    setFocusTab(tab.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/6'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Controles de moneda, tasa oficial BCRD y personalización */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex p-0.5 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10">
              {CURRENCY_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setExecutiveCurrency(c.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    executiveCurrency === c.value
                      ? 'bg-white dark:bg-[#0E1D40] text-slate-950 dark:text-white shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                void bcrd.refresh();
              }}
              disabled={bcrd.loading}
              title={
                bcrd.fecha
                  ? `${bcrd.fuente} · Corte ${bcrd.fecha} · Clic para actualizar`
                  : `${bcrd.fuente} · Clic para actualizar tasa oficial`
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                isConsolidated
                  ? 'border-[#0066FF]/40 bg-[#0066FF]/[0.07] dark:bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] font-semibold'
                  : 'border-slate-200/85 dark:border-white/12 bg-white dark:bg-[#040C1E] text-slate-600 dark:text-slate-300 hover:border-[#0066FF]/40'
              }`}
            >
              <RefreshCw className={`w-3 h-3 shrink-0 ${bcrd.loading ? 'animate-spin' : ''}`} />
              <span>BCRD: RD${bcrd.rate.toFixed(2)}/USD</span>
            </button>

            {widgetState.policy.canConfigure && (
              <>
                <button
                  type="button"
                  onClick={() => widgetState.setEditMode((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    widgetState.editMode
                      ? 'bg-[#0066FF] text-white border-[#0066FF]'
                      : 'border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/6'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>{widgetState.editMode ? 'Listo' : 'Reordenar'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCustomizeOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                  <span>Widgets</span>
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* RENDERIZADO ORDENADO Y CONFIGURABLE DE BLOQUES SEGÚN VISTA ACTIVA Y ROL OPERATIVO */}
      {displayedSections.map((sectionId: DashboardSectionId) => {
        switch (sectionId) {
          case 'executiveSummary':
            return (
              <div key="executiveSummary" className="space-y-6">
                {activeCurrencyBlocks.map((block, idx) => (
                  <CurrencyExecutiveBlock
                    key={`exec_${isConsolidated ? 'CONSOLIDATED_DOP' : block.currency}`}
                    metrics={block}
                    consolidatedInfo={consolidatedInfo}
                    granularity={granularity}
                    onChangeGranularity={handleGranularityChange}
                    darkMode={darkMode}
                    showExecutiveSummary
                    showPanorama={false}
                    isPrimaryCurrency={idx === 0}
                    roleLabel={rbac.roleLabel}
                    canConfigure={widgetState.policy.canConfigure}
                    editMode={widgetState.editMode}
                    visibleKpis={widgetState.visibleKpis}
                    hiddenKpis={widgetState.hiddenKpiWidgets}
                    lockedKpis={widgetState.policy.lockedVisibleKpis}
                    allowedKpiCount={widgetState.policy.allowedKpis.length}
                    onToggleEditMode={() => widgetState.setEditMode((v) => !v)}
                    onReorderKpi={widgetState.reorderKpi}
                    onMoveKpi={widgetState.moveKpi}
                    onToggleKpi={widgetState.toggleKpiVisibility}
                    onShowAllKpis={widgetState.showAllKpis}
                    onOpenConfigurator={() => setCustomizeOpen(true)}
                    onInspectIndicator={(key, currency) => setDetailModal({ key, currency })}
                  />
                ))}
              </div>
            );

          case 'performanceOverview':
            return (
              <div key="performanceOverview" className="space-y-6">
                {activeCurrencyBlocks.map((block) => (
                  <PerformanceOverviewWidget
                    key={`perf_overview_${isConsolidated ? 'CONSOLIDATED_DOP' : block.currency}`}
                    currency={block.currency}
                    consolidateUsdToDopRate={consolidateRate}
                    consolidatedRateLabel={
                      isConsolidated
                        ? `DOP + USD consolidado en RD$ (tasa BCRD RD$${bcrd.rate.toFixed(4)}${bcrd.fecha ? ` · ${bcrd.fecha}` : ''})`
                        : undefined
                    }
                    todayIso={clockInfo.todayIso}
                    darkMode={darkMode}
                    metrics={block}
                    applications={applications}
                    loans={loans}
                    collectionAccounts={collectionAccounts}
                    collectionDailySnapshots={collectionDailySnapshots}
                    canAccessSection={rbac.canAccessSection}
                    onNavigate={setActiveSection}
                  />
                ))}
              </div>
            );

          case 'panorama':
            return (
              <div key="panorama" className="space-y-6">
                {activeCurrencyBlocks.map((block, idx) => (
                  <CurrencyExecutiveBlock
                    key={`pano_${isConsolidated ? 'CONSOLIDATED_DOP' : block.currency}`}
                    metrics={block}
                    consolidatedInfo={consolidatedInfo}
                    granularity={granularity}
                    onChangeGranularity={handleGranularityChange}
                    darkMode={darkMode}
                    showExecutiveSummary={false}
                    showPanorama
                    isPrimaryCurrency={idx === 0}
                    roleLabel={rbac.roleLabel}
                    canConfigure={widgetState.policy.canConfigure}
                    editMode={widgetState.editMode}
                    visibleKpis={widgetState.visibleKpis}
                    hiddenKpis={widgetState.hiddenKpiWidgets}
                    lockedKpis={widgetState.policy.lockedVisibleKpis}
                    allowedKpiCount={widgetState.policy.allowedKpis.length}
                    onToggleEditMode={() => widgetState.setEditMode((v) => !v)}
                    onReorderKpi={widgetState.reorderKpi}
                    onMoveKpi={widgetState.moveKpi}
                    onToggleKpi={widgetState.toggleKpiVisibility}
                    onShowAllKpis={widgetState.showAllKpis}
                    onOpenConfigurator={() => setCustomizeOpen(true)}
                    onInspectIndicator={(key, currency) => setDetailModal({ key, currency })}
                  />
                ))}
              </div>
            );

          case 'intelligence':
            return (
              <AxyCoreIntelligencePanel
                key="intelligence"
                insights={intelligenceInsights}
                aiConfigured={aiConfigured}
                canRunAi={rbac.canAccessSection('director')}
                directorAnalysis={directorAnalysis}
                directorLoading={directorLoading}
                onRunDeepDiagnosis={() => {
                  const currencyNote = isConsolidated
                    ? `DOP consolidado (incluyendo USD convertido a RD$${bcrd.rate.toFixed(4)} según BCRD)`
                    : primaryCurrency;
                  void runDirectorAnalysis(
                    `Diagnóstico ejecutivo integral para ${organization.name} (${periodBounds.label}) en ${currencyNote}: Cartera activa ${formatMoney(primaryMetrics.activePortfolioCapital, primaryCurrency)}, PAR 30 ${primaryMetrics.par30Pct ?? 0}%, Desembolsos ${formatMoney(primaryMetrics.disbursedPeriodTotal, primaryCurrency)}, Recuperación ${formatMoney(primaryMetrics.recoveryPeriodTotal, primaryCurrency)}.`
                  );
                }}
                onNavigate={setActiveSection}
              />
            );

          case 'alertsAndActivity':
            return (
              <div key="alertsAndActivity" className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-6">
                  <HomeAlertsCenterPanel
                    alerts={smartAlerts}
                    onSelectAlert={handleSelectAlert}
                    visibleAlertWidgets={widgetState.visibleAlerts}
                    hiddenAlertWidgets={widgetState.hiddenAlertWidgets}
                    lockedAlertWidgets={widgetState.policy.lockedVisibleAlerts}
                    alertsViewMode={widgetState.config.alertsViewMode}
                    roleLabel={rbac.roleLabel}
                    canConfigure={widgetState.policy.canConfigure}
                    editMode={widgetState.editMode}
                    onToggleEditMode={() => widgetState.setEditMode((v) => !v)}
                    onChangeViewMode={widgetState.setAlertsViewMode}
                    onReorderAlertWidget={widgetState.reorderAlert}
                    onMoveAlertWidget={widgetState.moveAlert}
                    onToggleAlertWidgetVisibility={widgetState.toggleAlertVisibility}
                    onShowAllAlertWidgets={widgetState.showAllAlerts}
                    onOpenConfigurator={() => setCustomizeOpen(true)}
                  />
                </div>
                <div className="lg:col-span-6">
                  <HomeRecentActivityPanel
                    entries={recentEntries}
                    canViewAudit={rbac.canAccessSection('audit')}
                    onOpenAudit={() => setActiveSection('audit')}
                    onSelectEntry={(entry) => {
                      if (entry.applicationId) {
                        setSelectedApplicationId(entry.applicationId);
                      } else if (entry.loanId) {
                        setSelectedCollectionLoanId(entry.loanId);
                      } else if (rbac.canAccessSection(entry.targetSection)) {
                        setActiveSection(entry.targetSection);
                      }
                    }}
                  />
                </div>
              </div>
            );

          case 'performance':
            return <InstitutionalPerformanceSection key="performance" items={institutionalPerf} />;

          case 'collections':
            return (
              <CollectionsSummaryPanel
                key="collections"
                summary={collectionsSummary}
                currency={primaryCurrency}
                currencyLabel={isConsolidated ? 'DOP + USD en RD$' : undefined}
                canViewCollections={
                  rbac.hasPermission('VIEW_COLLECTIONS_PORTFOLIO') ||
                  rbac.canAccessSection('cobranza_daily')
                }
                onNavigate={setActiveSection}
              />
            );

          case 'teamProductivity':
            return (
              <TeamProductivityPanel
                key="teamProductivity"
                team={teamProductivity}
                onNavigate={setActiveSection}
              />
            );

          case 'shortcuts':
            return <SmartShortcutsSection key="shortcuts" shortcuts={smartShortcuts} />;
        }
      })}

      {widgetState.policy.canConfigure && widgetState.visibleSections.length === 0 && (
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-dashed border-slate-300 dark:border-[#20C4E8]/25 p-8 text-center space-y-3">
          <p className="text-sm font-bold text-[#0B1F3A] dark:text-white">
            Todos los bloques del tablero están ocultos
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Restaura la distribución recomendada para {rbac.roleLabel}.
          </p>
          <button
            type="button"
            onClick={widgetState.resetToRoleDefaults}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#168BFF] hover:bg-[#0E7AE8] text-white text-xs font-semibold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar configuración predeterminada</span>
          </button>
        </div>
      )}

      {/* CONFIGURADOR AVANZADO DE WIDGETS POR ROL */}
      {customizeOpen && widgetState.policy.canConfigure && (
        <DashboardWidgetConfiguratorDrawer
          roleLabel={rbac.roleLabel}
          policy={widgetState.policy}
          config={widgetState.config}
          syncStatus={widgetState.syncStatus}
          restrictedKpis={widgetState.restrictedKpis}
          restrictedAlerts={widgetState.restrictedAlerts}
          editMode={widgetState.editMode}
          onToggleEditMode={() => widgetState.setEditMode((v) => !v)}
          onReorderKpi={widgetState.reorderKpi}
          onMoveKpi={widgetState.moveKpi}
          onToggleKpi={widgetState.toggleKpiVisibility}
          onShowAllKpis={widgetState.showAllKpis}
          onReorderAlert={widgetState.reorderAlert}
          onMoveAlert={widgetState.moveAlert}
          onToggleAlert={widgetState.toggleAlertVisibility}
          onShowAllAlerts={widgetState.showAllAlerts}
          onChangeAlertsViewMode={widgetState.setAlertsViewMode}
          onReorderSection={widgetState.reorderSection}
          onMoveSection={widgetState.moveSection}
          onToggleSection={widgetState.toggleSectionVisibility}
          onResetDefaults={widgetState.resetToRoleDefaults}
          onClose={() => setCustomizeOpen(false)}
        />
      )}

      {/* DRAWER INTERACTIVO DE DETALLE AL SELECCIONAR INDICADORES */}
      {detailModal && (
        <IndicatorDetailDrawer
          detailKey={detailModal.key}
          currency={detailModal.currency}
          consolidateRate={consolidateRate}
          consolidatedRateDate={bcrd.fecha}
          consolidatedMetrics={isConsolidated ? consolidatedMetrics : undefined}
          onClose={() => setDetailModal(null)}
          onOpenLoan={(loanId) => {
            setDetailModal(null);
            setSelectedCollectionLoanId(loanId);
          }}
          onNavigate={(sec) => {
            setDetailModal(null);
            setActiveSection(sec);
          }}
        />
      )}
    </div>
  );
}

function IndicatorDetailDrawer({
  detailKey,
  currency,
  consolidateRate,
  consolidatedRateDate,
  consolidatedMetrics,
  onClose,
  onOpenLoan,
  onNavigate,
}: {
  detailKey: DetailIndicatorKey;
  currency: CurrencyCode;
  consolidateRate?: number;
  consolidatedRateDate?: string | null;
  consolidatedMetrics?: ExecutiveCurrencyMetrics;
  onClose: () => void;
  onOpenLoan: (loanId: string) => void;
  onNavigate: (sec: NavSectionId) => void;
}) {
  const { loans, collectionAccounts, payments, dopMetrics, usdMetrics, rbac, isPlatformAdminPortal } = useAxyCore();
  const [drawerSearch, setDrawerSearch] = useState('');

  const isConsolidated =
    currency === 'DOP' &&
    typeof consolidateRate === 'number' &&
    Number.isFinite(consolidateRate) &&
    consolidateRate > 0;
  const fxRate = isConsolidated ? consolidateRate! : 1;
  const toDisplayAmount = (amount: number, recCurrency: CurrencyCode) =>
    isConsolidated && recCurrency === 'USD' ? Number((amount * fxRate).toFixed(2)) : amount;

  const metrics = isConsolidated && consolidatedMetrics
    ? consolidatedMetrics
    : currency === 'USD'
    ? usdMetrics
    : dopMetrics;
  const scopeLabel = isConsolidated ? 'DOP + USD en RD$' : currency;

  const allCurrencyLoans = isConsolidated
    ? loans
    : loans.filter((l) => l.currency === currency);
  const allActiveOrOverdueLoans = allCurrencyLoans
    .filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO')
    .sort(
      (a, b) =>
        toDisplayAmount(Number(b.currentPrincipalBalance || 0), b.currency) -
        toDisplayAmount(Number(a.currentPrincipalBalance || 0), a.currency)
    );

  const filteredActiveLoans = allActiveOrOverdueLoans.filter((l) => {
    if (!drawerSearch.trim()) return true;
    const q = drawerSearch.trim().toLowerCase();
    return (
      l.applicantDisplayName.toLowerCase().includes(q) ||
      l.loanNumber.toLowerCase().includes(q) ||
      l.status.toLowerCase().includes(q) ||
      l.currency.toLowerCase().includes(q)
    );
  });

  const portfolioAudit = (() => {
    const activeOnly = allCurrencyLoans.filter((l) => l.status === 'ACTIVO');
    const overdueOnly = allCurrencyLoans.filter((l) => l.status === 'VENCIDO');
    const paidOnly = allCurrencyLoans.filter((l) => l.status === 'PAGADO');
    const cancelledOnly = allCurrencyLoans.filter(
      (l) => l.status === 'CANCELADO' || l.status === 'CANCELADO_POR_RENOVACION'
    );
    const activePrincipal = activeOnly.reduce(
      (s, l) => s + toDisplayAmount(Number(l.currentPrincipalBalance || 0), l.currency),
      0
    );
    const overduePrincipal = overdueOnly.reduce(
      (s, l) => s + toDisplayAmount(Number(l.currentPrincipalBalance || 0), l.currency),
      0
    );
    const totalApprovedActive = allActiveOrOverdueLoans.reduce(
      (s, l) => s + toDisplayAmount(Number(l.approvedPrincipal || 0), l.currency),
      0
    );
    const collAccCapital = collectionAccounts
      .filter((a) => (isConsolidated || a.currency === currency) && a.stage !== 'CANCELADO')
      .reduce(
        (s, a) => s + toDisplayAmount(Number(a.totalOutstandingPrincipal || 0), a.currency),
        0
      );
    const missingCollAcc = allActiveOrOverdueLoans.filter(
      (l) => !collectionAccounts.some((a) => a.loanId === l.id)
    ).length;

    return {
      activeCount: activeOnly.length,
      overdueCount: overdueOnly.length,
      paidCount: paidOnly.length,
      cancelledCount: cancelledOnly.length,
      activePrincipal,
      overduePrincipal,
      totalApprovedActive,
      collAccCapital,
      missingCollAcc,
    };
  })();

  const overdueAccounts = collectionAccounts
    .filter((a) => (isConsolidated || a.currency === currency) && a.stage !== 'CANCELADO' && a.dpd >= 1)
    .sort((a, b) => b.dpd - a.dpd)
    .slice(0, 20);

  const recentLoans = [...allCurrencyLoans]
    .sort((a, b) => (b.disbursementDate || '').localeCompare(a.disbursementDate || ''))
    .slice(0, 15);

  const appliedPayments = payments
    .filter((p) => (isConsolidated || p.currency === currency) && p.status === 'APLICADO')
    .sort((a, b) => (b.appliedDate || b.paymentDate || '').localeCompare(a.appliedDate || a.paymentDate || ''))
    .slice(0, 15);

  const titleMap: Record<DetailIndicatorKey, string> = {
    CARTERA_TOTAL: `Auditoría y Desglose de Cartera Total (${scopeLabel})`,
    CARTERA_VENCIDA: `Cuentas con Morosidad Activa (${scopeLabel})`,
    DESEMBOLSOS: `Detalle de Desembolsos (${scopeLabel})`,
    RECUPERACION: `Composición de Recuperación Aplicada (${scopeLabel})`,
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B1F3A]/60 backdrop-blur-xs flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-label={titleMap[detailKey]}
    >
      <div
        className="axy-drawer-in w-full max-w-lg bg-white dark:bg-[#08132B] h-full border-l border-slate-200 dark:border-[#20C4E8]/25 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#0B1F3A] text-white flex items-center justify-between gap-3 border-b border-[#20C4E8]/20">
          <div>
            <p className="text-[11px] font-semibold text-[#20C4E8]">Detalle Interactivo de Indicador</p>
            <h3 className="font-display text-base font-bold text-white">{titleMap[detailKey]}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
            aria-label="Cerrar detalle"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isConsolidated && (
            <div className="p-3 rounded-xl bg-[#0066FF]/[0.06] dark:bg-[#0066FF]/15 border border-[#0066FF]/20 text-[11px] text-slate-700 dark:text-slate-200 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                  Conversión oficial BCRD aplicada (USD → DOP)
                </span>
                <span className="font-mono font-bold text-slate-950 dark:text-white">
                  1 USD = RD${fxRate.toFixed(4)}
                </span>
              </div>
              {consolidatedRateDate && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Fuente: Banco Central de la República Dominicana · Corte {consolidatedRateDate}
                </p>
              )}
            </div>
          )}

          {detailKey === 'CARTERA_TOTAL' && (
            <>
              <div className="p-4 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-600 dark:text-slate-300 block">
                      Capital Activo Total (ACTIVO + VENCIDO)
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {allActiveOrOverdueLoans.length} préstamos vigentes ({allCurrencyLoans.length} totales incl. saldados)
                    </span>
                  </div>
                  <strong className="font-mono tabular-nums text-lg font-extrabold text-[#0B1F3A] dark:text-white">
                    {formatMoney(metrics.activePortfolioCapital, currency)}
                  </strong>
                </div>

                {isConsolidated && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-white/10 text-[11px]">
                    <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                      <span className="text-slate-500 block">
                        Cartera en DOP ({dopMetrics.activeLoansCount})
                      </span>
                      <strong className="font-mono text-slate-900 dark:text-white">
                        {formatMoney(dopMetrics.activePortfolioCapital, 'DOP')}
                      </strong>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                      <span className="text-slate-500 block">
                        Cartera en USD ({usdMetrics.activeLoansCount})
                      </span>
                      <strong className="font-mono text-[#0052CC] dark:text-[#00D1FF] block">
                        {formatMoney(usdMetrics.activePortfolioCapital * fxRate, 'DOP')}
                      </strong>
                      <span className="font-mono text-[10px] text-slate-400">
                        Orig: {formatMoney(usdMetrics.activePortfolioCapital, 'USD')}
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-white/10 text-[11px]">
                  <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                    <span className="text-slate-500 block">Vigentes / Al día ({portfolioAudit.activeCount})</span>
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {formatMoney(portfolioAudit.activePrincipal, currency)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                    <span className="text-slate-500 block">Vencidos ({portfolioAudit.overdueCount})</span>
                    <strong className="font-mono text-rose-700 dark:text-rose-400">
                      {formatMoney(portfolioAudit.overduePrincipal, currency)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                    <span className="text-slate-500 block">Capital Original Desemb.</span>
                    <strong className="font-mono text-slate-800 dark:text-slate-200">
                      {formatMoney(portfolioAudit.totalApprovedActive, currency)}
                    </strong>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-[#08132B]">
                    <span className="text-slate-500 block">Pagados / Cancelados</span>
                    <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                      {portfolioAudit.paidCount} / {portfolioAudit.cancelledCount}
                    </strong>
                  </div>
                </div>

                {(Math.abs(portfolioAudit.collAccCapital - metrics.activePortfolioCapital) > 1 ||
                  portfolioAudit.missingCollAcc > 0) && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-500/40 text-[11px] text-amber-900 dark:text-amber-200">
                    Desfase detectado entre Préstamos y Cobranzas:{' '}
                    <strong>{portfolioAudit.missingCollAcc}</strong> préstamo(s) sin cuenta de cobranza o diferencia de{' '}
                    <strong className="font-mono">
                      {formatMoney(Math.abs(portfolioAudit.collAccCapital - metrics.activePortfolioCapital), currency)}
                    </strong>
                    .
                  </div>
                )}

                {isPlatformAdminPortal && (
                  <button
                    type="button"
                    onClick={() => onNavigate('platform_control')}
                    className="w-full py-2 px-3 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF]/20 border border-[#0066FF]/30 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold cursor-pointer"
                  >
                    Reconectar AppSheet / Auditar Inventario Completo →
                  </button>
                )}
              </div>

              <div>
                <input
                  type="text"
                  value={drawerSearch}
                  onChange={(e) => setDrawerSearch(e.target.value)}
                  placeholder="Filtrar cliente, número, moneda o estado..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {filteredActiveLoans.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    Sin préstamos vigentes en {scopeLabel}.
                  </p>
                ) : (
                  filteredActiveLoans.map((l) => {
                    const convertedBal = toDisplayAmount(l.currentPrincipalBalance, l.currency);
                    const isUsdConverted = isConsolidated && l.currency === 'USD';
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => onOpenLoan(l.id)}
                        className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F4F7FB] dark:hover:bg-white/[0.04] px-2 rounded-lg cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                            {l.applicantDisplayName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {l.loanNumber} · {l.currency} · {l.status} · Desemb. {l.disbursementDate}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-xs font-bold text-[#168BFF] block">
                            {formatMoney(convertedBal, currency)}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {isUsdConverted
                              ? `${formatMoney(l.currentPrincipalBalance, 'USD')} × ${fxRate.toFixed(2)}`
                              : `Orig: ${formatMoney(l.approvedPrincipal, l.currency)}`}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {detailKey === 'CARTERA_VENCIDA' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]">
                  <span className="text-[11px] text-slate-500 block">PAR 1 (≥1 día)</span>
                  <strong className="font-mono tabular-nums text-base font-bold text-rose-700 dark:text-rose-400">
                    {metrics.par1Pct !== null ? `${metrics.par1Pct.toFixed(2)}%` : '0.00%'}
                  </strong>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]">
                  <span className="text-[11px] text-slate-500 block">PAR 30 (≥30 días)</span>
                  <strong className="font-mono tabular-nums text-base font-bold text-rose-700 dark:text-rose-400">
                    {metrics.par30Pct !== null ? `${metrics.par30Pct.toFixed(2)}%` : '0.00%'}
                  </strong>
                </div>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {overdueAccounts.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No hay cuentas vencidas en {scopeLabel}.
                  </p>
                ) : (
                  overdueAccounts.map((a) => {
                    const convertedOverdue = toDisplayAmount(a.overdueTotalAmount, a.currency);
                    const isUsdConverted = isConsolidated && a.currency === 'USD';
                    return (
                      <button
                        key={a.loanId}
                        type="button"
                        onClick={() => onOpenLoan(a.loanId)}
                        className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F4F7FB] dark:hover:bg-white/[0.04] px-2 rounded-lg cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                            {a.applicantDisplayName}
                          </p>
                          <p className="text-[11px] font-mono text-rose-600 dark:text-rose-400">
                            {a.loanNumber} · {a.currency} · {a.dpd} día(s) de atraso
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-xs font-bold text-rose-700 dark:text-rose-400 block">
                            {formatMoney(convertedOverdue, currency)}
                          </span>
                          {isUsdConverted && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {formatMoney(a.overdueTotalAmount, 'USD')} × {fxRate.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {detailKey === 'DESEMBOLSOS' && (
            <>
              <div className="p-4 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E] flex items-center justify-between">
                <span className="text-xs text-slate-600 dark:text-slate-300">Desembolsado en el período</span>
                <strong className="font-mono tabular-nums text-lg font-extrabold text-[#168BFF]">
                  {formatMoney(metrics.disbursedPeriodTotal, currency)}
                </strong>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {recentLoans.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    Sin desembolsos registrados en {scopeLabel}.
                  </p>
                ) : (
                  recentLoans.map((l) => {
                    const convertedAmt = toDisplayAmount(l.approvedPrincipal, l.currency);
                    const isUsdConverted = isConsolidated && l.currency === 'USD';
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => onOpenLoan(l.id)}
                        className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F4F7FB] dark:hover:bg-white/[0.04] px-2 rounded-lg cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                            {l.applicantDisplayName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {l.loanNumber} · {l.currency} · {l.disbursementDate}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-xs font-bold text-[#0B1F3A] dark:text-[#20C4E8] block">
                            {formatMoney(convertedAmt, currency)}
                          </span>
                          {isUsdConverted && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {formatMoney(l.approvedPrincipal, 'USD')} × {fxRate.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {detailKey === 'RECUPERACION' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]">
                  <span className="text-[10px] text-slate-500 block">Capital</span>
                  <strong className="font-mono tabular-nums text-xs font-bold text-[#0B1F3A] dark:text-white">
                    {formatMoney(metrics.recoveryPrincipal, currency)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]">
                  <span className="text-[10px] text-slate-500 block">Interés</span>
                  <strong className="font-mono tabular-nums text-xs font-bold text-[#0B1F3A] dark:text-white">
                    {formatMoney(metrics.recoveryInterest, currency)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]">
                  <span className="text-[10px] text-slate-500 block">Mora / Otros</span>
                  <strong className="font-mono tabular-nums text-xs font-bold text-[#0B1F3A] dark:text-white">
                    {formatMoney(metrics.recoveryOther, currency)}
                  </strong>
                </div>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {appliedPayments.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    Sin pagos aplicados en {scopeLabel}.
                  </p>
                ) : (
                  appliedPayments.map((p) => {
                    const convertedAmt = toDisplayAmount(p.amount, p.currency);
                    const isUsdConverted = isConsolidated && p.currency === 'USD';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onOpenLoan(p.loanId)}
                        className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-[#F4F7FB] dark:hover:bg-white/[0.04] px-2 rounded-lg cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                            {p.customerName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {p.loanNumber} · {p.currency} · {p.appliedDate || p.paymentDate} · {p.method}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-xs font-bold text-emerald-700 dark:text-emerald-400 block">
                            {formatMoney(convertedAmt, currency)}
                          </span>
                          {isUsdConverted && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {formatMoney(p.amount, 'USD')} × {fxRate.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold cursor-pointer"
          >
            Cerrar
          </button>
          {rbac.canAccessSection(
            detailKey === 'CARTERA_VENCIDA'
              ? 'cobranza_portfolio'
              : detailKey === 'DESEMBOLSOS'
              ? 'disbursements'
              : detailKey === 'RECUPERACION'
              ? 'cobranza_payments'
              : 'loans'
          ) && (
            <button
              type="button"
              onClick={() =>
                onNavigate(
                  detailKey === 'CARTERA_VENCIDA'
                    ? 'cobranza_portfolio'
                    : detailKey === 'DESEMBOLSOS'
                    ? 'disbursements'
                    : detailKey === 'RECUPERACION'
                    ? 'cobranza_payments'
                    : 'loans'
                )
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#168BFF] hover:bg-[#0E7AE8] text-white text-xs font-semibold cursor-pointer"
            >
              <span>Ir al módulo completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
