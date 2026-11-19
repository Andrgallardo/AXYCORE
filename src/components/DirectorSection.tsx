import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CalendarCheck,
  CheckCircle2,
  Compass,
  FileSearch,
  RefreshCw,
  Send,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { computeExecutiveCurrencyMetrics, resolvePeriodBounds } from '../engine/executiveAnalytics';
import { formatMoney, formatTimestamp } from '../utils/formatters';

const DIRECTOR_FOCUS_PROMPTS = [
  {
    label: 'Salud integral del mes actual',
    question:
      'Analiza el desempeño real del mes actual: cartera activa, total desembolsado en el mes, recuperación efectivamente aplicada, morosidad PAR 30 y solicitudes pendientes.',
  },
  {
    label: 'Focos de riesgo y morosidad PAR',
    question:
      'Evalúa los indicadores PAR 1, PAR 30, PAR 60 y PAR 90 del mes actual, promesas incumplidas y alertas Centinela activas para priorizar contención.',
  },
  {
    label: 'Embudo crediticio y aprobaciones',
    question:
      'Analiza las solicitudes recibidas en el mes actual, la tasa de aprobación con su denominador real y los cuellos de botella en Evaluación, Comité y Formalización.',
  },
  {
    label: 'Productividad de cobros del mes',
    question:
      'Evalúa la recuperación aplicada del mes actual desglosando capital e intereses, cobros exigibles hoy y desempeño por gestor.',
  },
];

export function DirectorDashboardCard() {
  const {
    directorAnalysis,
    directorLoading,
    directorError,
    runDirectorAnalysis,
    setActiveSection,
    aiConfigured,
    clockInfo,
    executivePeriod,
    setExecutivePeriod,
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

  // Always compute real current-month metrics (America/Santo_Domingo) so the user can inspect and analyze the current month's real data at any time
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
        applications,
        loans,
        loanInstallments,
        collectionAccounts,
        payments,
        paymentPromises,
        usersList,
      }),
    [
      currentMonthBounds,
      clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList,
    ]
  );

  const currentMonthUsd = useMemo(
    () =>
      computeExecutiveCurrencyMetrics({
        currency: 'USD',
        bounds: currentMonthBounds,
        todayIso: clockInfo.todayIso,
        applications,
        loans,
        loanInstallments,
        collectionAccounts,
        payments,
        paymentPromises,
        usersList,
      }),
    [
      currentMonthBounds,
      clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList,
    ]
  );

  const handleAnalyzeCurrentMonth = async (questionOverride?: string) => {
    setExpanded(true);
    if (executivePeriod !== 'CURRENT_MONTH') {
      setExecutivePeriod('CURRENT_MONTH');
    }
    const promptToUse =
      questionOverride?.trim() ||
      customPrompt.trim() ||
      `Realiza un diagnóstico ejecutivo integral sobre los datos reales del mes actual (${currentMonthBounds.startIso} al ${currentMonthBounds.endIso}): Cartera Activa DOP ${formatMoney(currentMonthDop.activePortfolioCapital, 'DOP')} (${currentMonthDop.activeLoansCount} préstamos), Desembolsado del mes DOP ${formatMoney(currentMonthDop.disbursedPeriodTotal, 'DOP')}, Recuperación aplicada del mes DOP ${formatMoney(currentMonthDop.recoveryPeriodTotal, 'DOP')}, PAR 30 DOP ${currentMonthDop.par30Pct !== null ? `${currentMonthDop.par30Pct}%` : 'Sin datos'}, Solicitudes pendientes ${currentMonthDop.pendingApplicationsCount}, y Cartera USD ${formatMoney(currentMonthUsd.activePortfolioCapital, 'USD')}.`;

    await runDirectorAnalysis(promptToUse);
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAnalyzeCurrentMonth(customPrompt);
  };

  return (
    <section
      aria-label="AxyCore Director — Análisis Ejecutivo con IA"
      className="relative overflow-hidden rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/20 p-5 sm:p-6 shadow-[0_20px_50px_-18px_rgba(0,102,255,0.28)] space-y-4 h-full flex flex-col justify-between"
    >
      <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-[#00B8FF]">
              <BrainCircuit className="w-4 h-4" />
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-[0_6px_18px_-4px_rgba(0,102,255,0.55)]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${directorLoading ? 'animate-spin' : ''}`} />
              <span>
                {directorLoading ? 'Analizando mes actual…' : 'Analizar mi operación (Mes actual)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('director')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#00B8FF]/25 bg-[#08132B] hover:bg-[#0E1D40] text-xs font-medium text-slate-200 cursor-pointer whitespace-nowrap"
            >
              <span>Centro completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Snapshot of Real Current Month Data Grounding the AI */}
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

        {/* Interactive Request Input & Quick Focus Prompts */}
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
            {DIRECTOR_FOCUS_PROMPTS.map((fp) => (
              <button
                key={fp.label}
                type="button"
                disabled={directorLoading}
                onClick={() => {
                  setCustomPrompt(fp.question);
                  handleAnalyzeCurrentMonth(fp.question);
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
              Configura <code className="font-mono">GEMINI_API_KEY</code> en el entorno del servidor para generar diagnósticos ejecutivos en vivo con AxyCore Director.
            </span>
          </div>
        )}

        {directorError && (
          <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{directorError}</span>
          </div>
        )}

        {/* AI Analysis Output */}
        {directorAnalysis && expanded ? (
          <div className="space-y-4 pt-3 border-t border-[#00B8FF]/15">
            <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[#00D1FF] font-semibold">
                <span>Dictamen Ejecutivo IA ({currentMonthBounds.label})</span>
                <span className="font-mono text-slate-400">
                  {formatTimestamp(directorAnalysis.generatedAtIso)}
                </span>
              </div>
              <p className="text-xs text-slate-100 leading-relaxed">
                {directorAnalysis.executiveSummary}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Observaciones Verificadas */}
              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#00D1FF] flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Hechos verificados</span>
                </p>
                <ul className="space-y-1.5 text-slate-200 text-[11px]">
                  {directorAnalysis.verifiedObservations.slice(0, 4).map((obs, i) => (
                    <li key={i} className="leading-relaxed">
                      · {obs}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Inferencias Analíticas */}
              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#38BDF8] flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>Inferencias estratégicas</span>
                </p>
                <ul className="space-y-1.5 text-slate-200 text-[11px]">
                  {directorAnalysis.inferences.slice(0, 4).map((inf, i) => (
                    <li key={i} className="leading-relaxed">
                      · {inf}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Acciones Recomendadas */}
              <div className="p-3.5 rounded-xl bg-[#071430] border border-[#00B8FF]/15 space-y-2">
                <p className="font-semibold text-[#E2B35E] flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  <span>Acciones recomendadas</span>
                </p>
                <div className="space-y-2">
                  {directorAnalysis.recommendedActions.slice(0, 3).map((act, i) => (
                    <div key={i} className="space-y-0.5">
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
    directorAnalysis,
    directorLoading,
    directorError,
    runDirectorAnalysis,
    setActiveSection,
    aiConfigured,
    periodBounds,
    executiveCurrency,
    setExecutivePeriod,
    rbac,
  } = useAxyCore();

  const [customQuestion, setCustomQuestion] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runDirectorAnalysis(customQuestion.trim() || undefined);
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/20 p-6 space-y-5 shadow-[0_20px_50px_-18px_rgba(0,102,255,0.28)]">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#00B8FF] flex items-center gap-1.5">
              <BrainCircuit className="w-4 h-4" />
              Centro de Inteligencia Ejecutiva AxyCore
            </p>
            <h2 className="font-display text-2xl font-bold text-white">
              Axy<span className="text-[#00B8FF]">Core</span> Director — Inteligencia para tomar mejores decisiones.
            </h2>
            <p className="text-xs text-slate-300">
              Período analizado: {periodBounds.label} ({periodBounds.startIso} → {periodBounds.endIso}) · Moneda:{' '}
              {executiveCurrency === 'SEPARATED' ? 'DOP y USD por separado' : executiveCurrency} · Alcance RBAC: {rbac.roleLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={directorLoading}
              onClick={() => {
                setExecutivePeriod('CURRENT_MONTH');
                runDirectorAnalysis(
                  'Analiza de forma integral los indicadores reales del mes actual y señala observaciones verificadas, riesgos y recomendaciones.'
                );
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#00B8FF]/25 bg-[#071430] hover:bg-[#0B1E47] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <CalendarCheck className="w-4 h-4 text-[#00B8FF]" />
              <span>Analizar mes actual</span>
            </button>

            <button
              type="button"
              disabled={directorLoading}
              onClick={() => runDirectorAnalysis()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-[0_6px_18px_-4px_rgba(0,102,255,0.55)]"
            >
              <RefreshCw className={`w-4 h-4 ${directorLoading ? 'animate-spin' : ''}`} />
              <span>{directorLoading ? 'Procesando diagnóstico…' : 'Analizar mi operación'}</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <input
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder="Formula una pregunta ejecutiva sobre cartera, mora, originación o cobros del mes actual..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#071430] border border-[#00B8FF]/20 text-sm text-white placeholder:text-slate-400 focus:border-[#00B8FF] focus:outline-none"
          />
          <button
            type="submit"
            disabled={directorLoading}
            className="px-5 py-2.5 rounded-xl bg-white text-[#040C1E] hover:bg-sky-50 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            Consultar Director
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {DIRECTOR_FOCUS_PROMPTS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={directorLoading}
              onClick={() => {
                setCustomQuestion(item.question);
                runDirectorAnalysis(item.question);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#071430] hover:bg-[#0B1E47] border border-[#00B8FF]/18 text-xs text-slate-200 cursor-pointer transition-colors disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!aiConfigured && (
        <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Motor Gemini pendiente de configuración en servidor</p>
            <p className="mt-0.5">
              Define la variable de entorno <code className="font-mono">GEMINI_API_KEY</code> para ejecutar diagnósticos en vivo. AxyCore nunca muestra análisis simulados ni cifras ficticias.
            </p>
          </div>
        </div>
      )}

      {directorError && (
        <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{directorError}</span>
        </div>
      )}

      {directorAnalysis ? (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Resumen Ejecutivo Verificado</span>
              <span className="font-mono">{formatTimestamp(directorAnalysis.generatedAtIso)}</span>
            </div>
            <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
              {directorAnalysis.executiveSummary}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00B8FF]" />
                Observaciones Verificadas (Datos Reales)
              </h3>
              {directorAnalysis.verifiedObservations.length === 0 ? (
                <p className="text-xs text-slate-500">Sin observaciones registradas.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                  {directorAnalysis.verifiedObservations.map((o, idx) => (
                    <li key={idx} className="leading-relaxed">
                      · {o}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                Inferencias Analíticas
              </h3>
              {directorAnalysis.inferences.length === 0 ? (
                <p className="text-xs text-slate-500">Sin inferencias adicionales.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                  {directorAnalysis.inferences.map((inf, idx) => (
                    <li key={idx} className="leading-relaxed">
                      · {inf}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                Recomendaciones Accionables (Supervisión Humana)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {directorAnalysis.recommendedActions.map((act, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-col justify-between gap-2"
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-950 dark:text-white">
                        {act.title}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                        {act.detail}
                      </p>
                    </div>
                    {act.targetSection && rbac.canAccessSection(act.targetSection) && (
                      <button
                        type="button"
                        onClick={() => setActiveSection(act.targetSection!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00B8FF] hover:underline cursor-pointer self-start"
                      >
                        <span>Abrir módulo relacionado</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#E2B35E]" />
                Limitaciones y Gobernanza
              </h3>
              {directorAnalysis.dataLimitations.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Cobertura completa dentro de los permisos actuales.
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  {directorAnalysis.dataLimitations.map((lim, idx) => (
                    <li key={idx}>· {lim}</li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/80 dark:border-white/10">
                AxyCore Director nunca aprueba créditos, desembolsa fondos ni altera saldos automáticamente.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-10 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 text-center space-y-3">
          <FileSearch className="w-8 h-8 text-[#0066FF] dark:text-[#00B8FF] mx-auto" />
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
            Listo para analizar tu operación financiera del mes actual
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Presiona «Analizar mes actual» o selecciona un enfoque estratégico arriba para generar un diagnóstico estructurado sobre tus datos reales.
          </p>
        </div>
      )}
    </div>
  );
}
