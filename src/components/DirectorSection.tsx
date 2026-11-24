import React, {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CalendarCheck,
  CheckCircle2,
  Compass,
  FileSearch,
  History,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { computeExecutiveCurrencyMetrics, resolvePeriodBounds } from '../engine/executiveAnalytics';
import type {
  DirectorAnalysisResponse,
  DirectorFocusMode,
  ExecutiveCurrencyMode,
  ExecutivePeriodPreset,
} from '../types/axycore';
import { formatMoney, formatTimestamp } from '../utils/formatters';
import {
  prefetchDirectorBriefing,
  prefetchDirectorHistory,
  scheduleIdleWork,
} from '../utils/lazyPrefetch';
import {
  CURRENCY_OPTIONS,
  DIRECTOR_FOCUS_MODES,
  HEALTH_META,
  PERIOD_OPTIONS,
} from './director/directorMeta';
import {
  DirectorBriefingSkeleton,
  DirectorHistorySkeleton,
} from './director/DirectorSkeletons';
import { DirectorTelemetryStrip } from './director/DirectorTelemetryStrip';

const LazyDirectorBriefingReport = React.lazy(() =>
  import('./director/DirectorBriefingReport').then((m) => ({
    default: m.DirectorBriefingReport,
  }))
);

const LazyDirectorHistoryDrawer = React.lazy(() =>
  import('./director/DirectorHistoryDrawer').then((m) => ({
    default: m.DirectorHistoryDrawer,
  }))
);

export function DirectorDashboardCard() {
  const {
    directorAnalysis,
    directorLoading,
    directorError,
    runDirectorAnalysis,
    setActiveSection,
    aiConfigured,
    clockInfo,
    applications,
    loans,
    loanInstallments,
    collectionAccounts,
    payments,
    paymentPromises,
    usersList,
    rbac,
  } = useAxyCore();

  const [customPrompt, setCustomPrompt] = useState('');
  const [expanded, setExpanded] = useState(true);

  const deferredApplications = useDeferredValue(applications);
  const deferredLoans = useDeferredValue(loans);
  const deferredInstallments = useDeferredValue(loanInstallments);
  const deferredCollectionAccounts = useDeferredValue(collectionAccounts);
  const deferredPayments = useDeferredValue(payments);
  const deferredPromises = useDeferredValue(paymentPromises);

  const currentMonthBounds = useMemo(
    () => resolvePeriodBounds('CURRENT_MONTH', undefined, undefined, clockInfo.todayIso),
    [clockInfo.todayIso]
  );

  const currentMonthDop = useMemo(
    () =>
      computeExecutiveCurrencyMetrics({
        currency: 'DOP',
        bounds: currentMonthBounds,
        todayIso: clockInfo.todayIso,
        applications: deferredApplications,
        loans: deferredLoans,
        loanInstallments: deferredInstallments,
        collectionAccounts: deferredCollectionAccounts,
        payments: deferredPayments,
        paymentPromises: deferredPromises,
        usersList,
      }),
    [
      currentMonthBounds,
      clockInfo.todayIso,
      deferredApplications,
      deferredLoans,
      deferredInstallments,
      deferredCollectionAccounts,
      deferredPayments,
      deferredPromises,
      usersList,
    ]
  );

  const currentMonthUsd = useMemo(
    () =>
      computeExecutiveCurrencyMetrics({
        currency: 'USD',
        bounds: currentMonthBounds,
        todayIso: clockInfo.todayIso,
        applications: deferredApplications,
        loans: deferredLoans,
        loanInstallments: deferredInstallments,
        collectionAccounts: deferredCollectionAccounts,
        payments: deferredPayments,
        paymentPromises: deferredPromises,
        usersList,
      }),
    [
      currentMonthBounds,
      clockInfo.todayIso,
      deferredApplications,
      deferredLoans,
      deferredInstallments,
      deferredCollectionAccounts,
      deferredPayments,
      deferredPromises,
      usersList,
    ]
  );

  const handleAnalyzeCurrentMonth = async (
    questionOverride?: string,
    focusMode: DirectorFocusMode = 'INTEGRAL'
  ) => {
    setExpanded(true);
    const promptToUse =
      questionOverride?.trim() ||
      customPrompt.trim() ||
      `Realiza un diagnóstico ejecutivo integral sobre los datos reales del mes actual (${currentMonthBounds.startIso} al ${currentMonthBounds.endIso}): Cartera Activa DOP ${formatMoney(currentMonthDop.activePortfolioCapital, 'DOP')} (${currentMonthDop.activeLoansCount} préstamos), Desembolsado del mes DOP ${formatMoney(currentMonthDop.disbursedPeriodTotal, 'DOP')}, Recuperación aplicada del mes DOP ${formatMoney(currentMonthDop.recoveryPeriodTotal, 'DOP')}, PAR 30 DOP ${currentMonthDop.par30Pct !== null ? `${currentMonthDop.par30Pct}%` : 'Sin datos'}, Solicitudes pendientes ${currentMonthDop.pendingApplicationsCount}, y Cartera USD ${formatMoney(currentMonthUsd.activePortfolioCapital, 'USD')}.`;

    await runDirectorAnalysis(promptToUse, {
      focusMode,
      periodOverride: 'CURRENT_MONTH',
    });
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAnalyzeCurrentMonth(customPrompt, 'INTEGRAL');
  };

  const cardQuickModes: Array<{ label: string; mode: DirectorFocusMode; question: string }> = [
    {
      label: 'Salud integral del mes',
      mode: 'INTEGRAL',
      question: DIRECTOR_FOCUS_MODES[0].quickPrompts[0].question,
    },
    {
      label: 'Focos de mora PAR',
      mode: 'RIESGO_MORA',
      question: DIRECTOR_FOCUS_MODES[1].quickPrompts[0].question,
    },
    {
      label: 'Embudo y aprobaciones',
      mode: 'ORIGINACION',
      question: DIRECTOR_FOCUS_MODES[2].quickPrompts[0].question,
    },
    {
      label: 'Productividad de cobros',
      mode: 'COBRANZA_FLUJO',
      question: DIRECTOR_FOCUS_MODES[3].quickPrompts[0].question,
    },
  ];

  return (
    <section
      aria-label="AxyCore Director — Análisis Ejecutivo con IA"
      className="relative overflow-hidden rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/22 p-5 sm:p-6 shadow-sm space-y-4 h-full flex flex-col justify-between"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-ai-line" />
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#00D1FF]">
              <BrainCircuit className="w-4 h-4 text-[#00B8FF]" />
              <span>Centro de Inteligencia Ejecutiva · Mes Actual ({clockInfo.currentMonthYm})</span>
            </div>
            <h3 className="font-display text-lg sm:text-xl font-bold text-white tracking-tight">
              Axy<span className="text-[#00B8FF]">Core</span> Director
            </h3>
            <p className="text-xs text-slate-300">
              Inteligencia para tomar mejores decisiones basadas en los datos reales del mes actual.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={directorLoading}
              onClick={() => handleAnalyzeCurrentMonth()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${directorLoading ? 'animate-spin' : ''}`} />
              <span>
                {directorLoading ? 'Analizando mes actual…' : 'Analizar mi operación (Mes actual)'}
              </span>
            </button>

            <button
              type="button"
              onMouseEnter={() => prefetchDirectorBriefing()}
              onFocus={() => prefetchDirectorBriefing()}
              onClick={() => setActiveSection('director')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#00B8FF]/25 bg-[#08132B] hover:bg-[#0E1D40] text-xs font-medium text-slate-200 cursor-pointer whitespace-nowrap"
            >
              <span>Centro completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-[#071430]/90 border border-[#00B8FF]/15 text-xs">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
              Cartera Activa (DOP)
            </span>
            <span className="font-mono tabular-nums font-bold text-white text-sm">
              {formatMoney(currentMonthDop.activePortfolioCapital, 'DOP')}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">
              {currentMonthDop.activeLoansCount} préstamo(s) · USD: {formatMoney(currentMonthUsd.activePortfolioCapital, 'USD')}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
              Desembolsado Mes (DOP)
            </span>
            <span className="font-mono tabular-nums font-bold text-[#00D1FF] text-sm">
              {formatMoney(currentMonthDop.disbursedPeriodTotal, 'DOP')}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">
              {currentMonthDop.disbursedPeriodCount} op. · USD: {formatMoney(currentMonthUsd.disbursedPeriodTotal, 'USD')}
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
              Recuperación Mes (DOP)
            </span>
            <span className="font-mono tabular-nums font-bold text-emerald-400 text-sm">
              {formatMoney(currentMonthDop.recoveryPeriodTotal, 'DOP')}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">
              {currentMonthDop.recoveryPaymentsCount} pago(s) aplicados
            </span>
          </div>

          <div>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
              PAR 30 / Pendientes
            </span>
            <span className="font-mono tabular-nums font-bold text-[#E2B35E] text-sm">
              {currentMonthDop.par30Pct !== null ? `${currentMonthDop.par30Pct}%` : '0.00%'}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">
              {currentMonthDop.pendingApplicationsCount + currentMonthUsd.pendingApplicationsCount} solic. en cola
            </span>
          </div>
        </div>

        <form onSubmit={handleCustomSubmit} className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Solicita a AxyCore Director un análisis específico de los datos reales del mes actual…"
              className="flex-1 px-3.5 py-2 rounded-xl bg-[#071430] border border-[#00B8FF]/20 text-xs text-white placeholder:text-slate-400 focus:border-[#00B8FF] focus:outline-none"
            />
            <button
              type="submit"
              disabled={directorLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white text-[#040C1E] hover:bg-sky-50 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Solicitar análisis IA</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
              <CalendarCheck className="w-3 h-3 text-[#00B8FF]" />
              Enfoques del mes:
            </span>
            {cardQuickModes.map((fp, idx) => (
              <button
                key={`card-mode-${fp.mode}-${idx}`}
                type="button"
                disabled={directorLoading}
                onClick={() => {
                  setCustomPrompt(fp.question);
                  void handleAnalyzeCurrentMonth(fp.question, fp.mode);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#071430] hover:bg-[#0B1E47] border border-[#00B8FF]/18 text-[11px] text-slate-200 cursor-pointer transition-colors disabled:opacity-50"
              >
                {fp.label}
              </button>
            ))}
          </div>
        </form>

        {!aiConfigured && (
          <div className="p-3 rounded-xl border border-[#E2B35E]/30 bg-[#E2B35E]/10 text-xs text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#E2B35E]" />
            <span>
              El motor de inteligencia ejecutiva no está activo en este entorno todavía. Verifica la configuración del servicio en Settings &gt; Secrets.
            </span>
          </div>
        )}

        {directorError && (
          <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{directorError}</span>
            </div>
            <button
              type="button"
              disabled={directorLoading}
              onClick={() => handleAnalyzeCurrentMonth()}
              className="px-2.5 py-1 rounded-lg bg-rose-500/25 hover:bg-rose-500/35 border border-rose-400/40 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Reintentar
            </button>
          </div>
        )}

        {directorAnalysis && expanded ? (
          <div className="space-y-4 pt-3 border-t border-[#00B8FF]/15">
            <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#00D1FF] font-semibold">
                <span className="flex items-center gap-2">
                  <span>Dictamen Ejecutivo IA ({directorAnalysis.periodLabel || currentMonthBounds.label})</span>
                  {directorAnalysis.healthStatus && HEALTH_META[directorAnalysis.healthStatus] && (
                    <span className="px-2 py-0.5 rounded-md bg-white/10 text-white text-[10px]">
                      {HEALTH_META[directorAnalysis.healthStatus].label}
                    </span>
                  )}
                </span>
                <span className="font-mono text-slate-400">
                  {formatTimestamp(directorAnalysis.generatedAtIso)}
                </span>
              </div>
              {directorAnalysis.executiveHeadline && (
                <p className="text-xs font-bold text-white">{directorAnalysis.executiveHeadline}</p>
              )}
              <p className="text-xs text-slate-100 leading-relaxed">
                {directorAnalysis.executiveSummary}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#00D1FF] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Hechos verificados</span>
                </p>
                <ul className="space-y-1.5 text-slate-200 text-[11px]">
                  {(Array.isArray(directorAnalysis.verifiedObservations) ? directorAnalysis.verifiedObservations : [])
                    .slice(0, 4)
                    .map((obs, i) => (
                      <li key={`card-obs-${i}`} className="leading-relaxed">
                        · {obs}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#38BDF8] flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>Inferencias estratégicas</span>
                </p>
                <ul className="space-y-1.5 text-slate-200 text-[11px]">
                  {(Array.isArray(directorAnalysis.inferences) ? directorAnalysis.inferences : [])
                    .slice(0, 4)
                    .map((inf, i) => (
                      <li key={`card-inf-${i}`} className="leading-relaxed">
                        · {inf}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#E2B35E] flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>Acciones recomendadas</span>
                </p>
                <div className="space-y-2">
                  {(Array.isArray(directorAnalysis.recommendedActions) ? directorAnalysis.recommendedActions : [])
                    .filter((act) => Boolean(act && typeof act === 'object'))
                    .slice(0, 3)
                    .map((act, i) => (
                      <div key={`card-act-${i}`} className="space-y-0.5">
                        <p className="font-medium text-white text-[11px]">{act.title}</p>
                        <p className="text-[11px] text-slate-300 leading-snug">{act.detail}</p>
                        {act.targetSection && rbac.canAccessSection(act.targetSection) && (
                          <button
                            type="button"
                            onClick={() => setActiveSection(act.targetSection!)}
                            className="inline-flex items-center gap-1 text-[11px] text-[#00D1FF] hover:underline cursor-pointer pt-0.5"
                          >
                            <span>Ir al módulo</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                Alcance RBAC: {rbac.roleLabel} · Sin alteración automática de datos financieros
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                Contraer dictamen
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function DirectorDedicatedView() {
  const {
    organization,
    directorAnalysis,
    directorHistory = [],
    directorLoading,
    directorError,
    runDirectorAnalysis,
    selectDirectorHistoryItem,
    clearDirectorHistory,
    setActiveSection,
    aiConfigured,
    executivePeriod,
    setExecutivePeriod,
    executiveCurrency,
    setExecutiveCurrency,
    periodBounds,
    dopMetrics,
    usdMetrics,
    riskAlerts = [],
    payments = [],
    rbac,
  } = useAxyCore();

  const [selectedMode, setSelectedMode] = useState<DirectorFocusMode>(
    directorAnalysis?.focusMode || 'INTEGRAL'
  );
  const [customQuestion, setCustomQuestion] = useState('');
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [isScopePending, startScopeTransition] = useTransition();

  // Defer heavy financial telemetry and briefing renders so typing and scope switches never block the UI
  const deferredDopMetrics = useDeferredValue(dopMetrics);
  const deferredUsdMetrics = useDeferredValue(usdMetrics);
  const deferredRiskAlerts = useDeferredValue(riskAlerts);
  const deferredPayments = useDeferredValue(payments);
  const deferredDirectorAnalysis = useDeferredValue(directorAnalysis);

  const isTelemetryStale =
    isScopePending ||
    deferredDopMetrics !== dopMetrics ||
    deferredUsdMetrics !== usdMetrics;
  const isBriefingStale = deferredDirectorAnalysis !== directorAnalysis;

  const safeHistory = useMemo(
    () =>
      Array.isArray(directorHistory)
        ? directorHistory.filter((item): item is DirectorAnalysisResponse =>
            Boolean(item && typeof item === 'object')
          )
        : [],
    [directorHistory]
  );

  // Warm up briefing chunk during browser idle time without blocking first paint
  useEffect(() => {
    return scheduleIdleWork(() => {
      prefetchDirectorBriefing();
    });
  }, []);

  const activeModeMeta = useMemo(
    () => DIRECTOR_FOCUS_MODES.find((m) => m.id === selectedMode) || DIRECTOR_FOCUS_MODES[0],
    [selectedMode]
  );

  const activeSentinelCount = useMemo(
    () =>
      (Array.isArray(deferredRiskAlerts) ? deferredRiskAlerts : []).filter(
        (a) => a.status === 'ACTIVA'
      ).length,
    [deferredRiskAlerts]
  );

  const pendingPaymentsCount = useMemo(
    () =>
      (Array.isArray(deferredPayments) ? deferredPayments : []).filter(
        (p) => p.status === 'REPORTADO' || p.status === 'RECIBIDO_PENDIENTE_VERIFICACION'
      ).length,
    [deferredPayments]
  );

  const primaryMetrics = executiveCurrency === 'USD' ? deferredUsdMetrics : deferredDopMetrics;
  const primaryCurrency = executiveCurrency === 'USD' ? 'USD' : 'DOP';

  const handlePeriodChange = (period: ExecutivePeriodPreset) => {
    startScopeTransition(() => {
      setExecutivePeriod(period);
    });
  };

  const handleCurrencyChange = (currency: ExecutiveCurrencyMode) => {
    startScopeTransition(() => {
      setExecutiveCurrency(currency);
    });
  };

  const handleRunModeAnalysis = async (
    mode: DirectorFocusMode,
    questionOverride?: string,
    opts?: {
      periodOverride?: ExecutivePeriodPreset;
      currencyOverride?: ExecutiveCurrencyMode;
      followUp?: boolean;
    }
  ) => {
    prefetchDirectorBriefing();
    startScopeTransition(() => {
      setSelectedMode(mode);
    });
    const meta = DIRECTOR_FOCUS_MODES.find((m) => m.id === mode) || DIRECTOR_FOCUS_MODES[0];
    const prompt = questionOverride?.trim() || meta.defaultQuestion;
    await runDirectorAnalysis(prompt, {
      focusMode: mode,
      periodOverride: opts?.periodOverride,
      currencyOverride: opts?.currencyOverride,
      followUp: opts?.followUp,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = customQuestion.trim();
    await handleRunModeAnalysis(selectedMode, q || undefined, {
      followUp: Boolean(q && directorAnalysis),
    });
    if (q) setCustomQuestion('');
  };

  return (
    <div className="space-y-6">
      {/* Executive Command Header */}
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/22 p-6 space-y-5 shadow-sm">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-ai-line" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#00D1FF]">
              <BrainCircuit className="w-4 h-4 text-[#00B8FF]" />
              <span>Centro de Inteligencia Ejecutiva AxyCore</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300 font-normal">{organization?.name || 'AxyCore'}</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Axy<span className="text-[#00B8FF]">Core</span> Director
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl">
              CFO / CRO virtual conectado a tus datos reales en tiempo real. Diagnóstico estructurado, matriz de riesgos, oportunidades y plan de acción con trazabilidad RBAC ({rbac.roleLabel}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {safeHistory.length > 0 && (
              <button
                type="button"
                onMouseEnter={() => prefetchDirectorHistory()}
                onFocus={() => prefetchDirectorHistory()}
                onClick={() => {
                  prefetchDirectorHistory();
                  startScopeTransition(() => {
                    setShowHistoryDrawer((prev) => !prev);
                  });
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                  showHistoryDrawer
                    ? 'bg-[#0066FF] border-[#00B8FF] text-white'
                    : 'border-[#00B8FF]/25 bg-[#071430] hover:bg-[#0B1E47] text-slate-200'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Historial ({safeHistory.length})</span>
              </button>
            )}

            <button
              type="button"
              disabled={directorLoading}
              onClick={() => handleRunModeAnalysis('INTEGRAL', undefined, { periodOverride: 'CURRENT_MONTH' })}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#00B8FF]/25 bg-[#071430] hover:bg-[#0B1E47] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <CalendarCheck className="w-4 h-4 text-[#00B8FF]" />
              <span>Analizar mes actual</span>
            </button>

            <button
              type="button"
              disabled={directorLoading}
              onClick={() => handleRunModeAnalysis(selectedMode)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-btn-primary text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${directorLoading ? 'animate-spin' : ''}`} />
              <span>{directorLoading ? 'Analizando operación…' : `Ejecutar ${activeModeMeta.shortLabel}`}</span>
            </button>
          </div>
        </div>

        {/* Synchronized Period & Currency Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/10">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Período:</span>
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={`period-${opt.value}`}
                type="button"
                disabled={directorLoading}
                onClick={() => handlePeriodChange(opt.value)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  executivePeriod === opt.value
                    ? 'bg-[#0066FF] text-white'
                    : 'bg-[#071430] text-slate-300 hover:bg-[#0B1E47] border border-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Moneda:</span>
            {CURRENCY_OPTIONS.map((opt) => (
              <button
                key={`currency-${opt.value}`}
                type="button"
                disabled={directorLoading}
                onClick={() => handleCurrencyChange(opt.value)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  executiveCurrency === opt.value
                    ? 'bg-[#00B8FF] text-[#040C1E]'
                    : 'bg-[#071430] text-slate-300 hover:bg-[#0B1E47] border border-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Deferred & Memoized Real-Time Telemetry Strip */}
        <DirectorTelemetryStrip
          primaryMetrics={primaryMetrics}
          primaryCurrency={primaryCurrency}
          executiveCurrency={executiveCurrency}
          dopMetrics={deferredDopMetrics}
          usdMetrics={deferredUsdMetrics}
          periodLabel={periodBounds.label}
          activeSentinelCount={activeSentinelCount}
          pendingPaymentsCount={pendingPaymentsCount}
          isUpdating={isTelemetryStale}
        />

        {/* 5 Specialized Intelligence Modes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {DIRECTOR_FOCUS_MODES.map((mode) => {
            const isActive = selectedMode === mode.id;
            return (
              <button
                key={`mode-${mode.id}`}
                type="button"
                disabled={directorLoading}
                onClick={() => startScopeTransition(() => setSelectedMode(mode.id))}
                className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                  isActive
                    ? 'bg-[#0066FF]/22 border-[#00B8FF] text-white'
                    : 'bg-[#071430]/80 border-white/10 text-slate-300 hover:border-[#00B8FF]/45 hover:bg-[#0B1E47]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold">{mode.label}</span>
                  {isActive && <Sparkles className="w-3.5 h-3.5 text-[#00D1FF] shrink-0" />}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">
                  {mode.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Interactive Executive Consultation Input */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder={`Pregunta ejecutiva en modo «${activeModeMeta.label}» sobre ${periodBounds.label}…`}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#071430] border border-[#00B8FF]/25 text-sm text-white placeholder:text-slate-400 focus:border-[#00B8FF] focus:outline-none"
            />
            <button
              type="submit"
              disabled={directorLoading}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#040C1E] hover:bg-sky-50 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{directorLoading ? 'Consultando…' : 'Consultar Director'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400">Consultas rápidas:</span>
            {activeModeMeta.quickPrompts.map((qp, qpIdx) => (
              <button
                key={`qp-${selectedMode}-${qpIdx}`}
                type="button"
                disabled={directorLoading}
                onClick={() => handleRunModeAnalysis(selectedMode, qp.question)}
                className="px-3 py-1.5 rounded-lg bg-[#071430] hover:bg-[#0B1E47] border border-[#00B8FF]/20 text-xs text-slate-200 cursor-pointer transition-colors disabled:opacity-50"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </form>
      </div>

      {/* Lazy-Loaded Session History Drawer */}
      {showHistoryDrawer && safeHistory.length > 0 && (
        <Suspense fallback={<DirectorHistorySkeleton />}>
          <LazyDirectorHistoryDrawer
            history={safeHistory}
            selectedAnalysisId={directorAnalysis?.analysisId}
            onSelect={(analysisId) => {
              startScopeTransition(() => {
                selectDirectorHistoryItem?.(analysisId);
                setShowHistoryDrawer(false);
              });
            }}
            onClear={() => clearDirectorHistory?.()}
          />
        </Suspense>
      )}

      {!aiConfigured && (
        <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Motor de inteligencia pendiente de activación</p>
            <p className="mt-0.5">
              Verifica tu clave de Gemini en el panel <strong>Settings &gt; Secrets</strong> para ejecutar diagnósticos en vivo. AxyCore nunca muestra análisis simulados ni cifras ficticias.
            </p>
          </div>
        </div>
      )}

      {directorError && (
        <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{directorError}</span>
          </div>
          <button
            type="button"
            disabled={directorLoading}
            onClick={() => handleRunModeAnalysis(selectedMode)}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 shrink-0"
          >
            Reintentar análisis
          </button>
        </div>
      )}

      {directorLoading && (
        <div className="p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-[#0066FF]/25 dark:border-[#00B8FF]/25 flex items-center gap-4">
          <RefreshCw className="w-6 h-6 text-[#0066FF] dark:text-[#00B8FF] animate-spin shrink-0" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-slate-950 dark:text-white">
              AxyCore Director está auditando tu operación ({activeModeMeta.label})…
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluando cartera DOP/USD, morosidad PAR, embudo de crédito, alertas Centinela y trazabilidad de cobros para {periodBounds.label}.
            </p>
          </div>
        </div>
      )}

      {/* Lazy-Loaded & Deferred Executive Briefing Report */}
      {deferredDirectorAnalysis ? (
        <Suspense fallback={<DirectorBriefingSkeleton />}>
          <LazyDirectorBriefingReport
            directorAnalysis={deferredDirectorAnalysis}
            organizationName={organization?.name || 'AxyCore'}
            roleLabel={rbac.roleLabel}
            directorLoading={directorLoading}
            isStale={isBriefingStale}
            canAccessSection={rbac.canAccessSection}
            onNavigate={(section) => startScopeTransition(() => setActiveSection(section))}
            onRunFollowUp={(fq) => handleRunModeAnalysis(selectedMode, fq, { followUp: true })}
          />
        </Suspense>
      ) : (
        <div className="p-10 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 text-center space-y-3">
          <FileSearch className="w-8 h-8 text-[#0066FF] dark:text-[#00B8FF] mx-auto" />
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
            AxyCore Director listo para auditar tu operación ({periodBounds.label})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            Selecciona uno de los 5 modos de inteligencia ejecutiva arriba o formula una consulta directa para generar un dictamen completo con matriz de riesgos, oportunidades, plan de acción y exportación PDF.
          </p>
        </div>
      )}
    </div>
  );
}
