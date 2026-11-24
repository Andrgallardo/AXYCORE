import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  Download,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import type { DirectorAnalysisResponse, NavSectionId } from '../../types/axycore';
import { formatTimestamp } from '../../utils/formatters';
import {
  ACTION_PRIORITY_META,
  buildPlainTextBriefing,
  exportBriefingToPdf,
  getFocusLabel,
  HEALTH_META,
  RISK_SEVERITY_META,
} from './directorMeta';

/**
 * Defers rendering of below-the-fold heavy analytical sections until they approach
 * the viewport (or after a short idle tick), keeping initial paint and interactions smooth.
 */
function DeferredSection({
  children,
  minHeightClass = 'min-h-[160px]',
}: {
  children: React.ReactNode;
  minHeightClass?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const el = hostRef.current;
    if (!el) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '260px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  if (visible) {
    return <>{children}</>;
  }

  return (
    <div
      ref={hostRef}
      className={`${minHeightClass} rounded-2xl bg-white/70 dark:bg-[#08132B]/70 border border-slate-200/70 dark:border-[#00B8FF]/12 animate-pulse`}
      aria-hidden="true"
    />
  );
}

interface DirectorBriefingReportProps {
  directorAnalysis: DirectorAnalysisResponse;
  organizationName: string;
  roleLabel: string;
  directorLoading: boolean;
  isStale?: boolean;
  canAccessSection: (section: NavSectionId) => boolean;
  onNavigate: (section: NavSectionId) => void;
  onRunFollowUp: (question: string) => void;
}

export const DirectorBriefingReport = React.memo(function DirectorBriefingReport({
  directorAnalysis,
  organizationName,
  roleLabel,
  directorLoading,
  isStale = false,
  canAccessSection,
  onNavigate,
  onRunFollowUp,
}: DirectorBriefingReportProps) {
  const [copiedState, setCopiedState] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const safeKeyMetricsCited = Array.isArray(directorAnalysis.keyMetricsCited)
    ? directorAnalysis.keyMetricsCited.filter((m) => Boolean(m && typeof m === 'object'))
    : [];
  const safeVerifiedObservations = Array.isArray(directorAnalysis.verifiedObservations)
    ? directorAnalysis.verifiedObservations.filter((x): x is string => typeof x === 'string')
    : [];
  const safeInferences = Array.isArray(directorAnalysis.inferences)
    ? directorAnalysis.inferences.filter((x): x is string => typeof x === 'string')
    : [];
  const safePriorityRisks = Array.isArray(directorAnalysis.priorityRisks)
    ? directorAnalysis.priorityRisks.filter((r) => Boolean(r && typeof r === 'object'))
    : [];
  const safeStrategicOpportunities = Array.isArray(directorAnalysis.strategicOpportunities)
    ? directorAnalysis.strategicOpportunities.filter((o) => Boolean(o && typeof o === 'object'))
    : [];
  const safeRecommendedActions = Array.isArray(directorAnalysis.recommendedActions)
    ? directorAnalysis.recommendedActions.filter((a) => Boolean(a && typeof a === 'object'))
    : [];
  const safeDataLimitations = Array.isArray(directorAnalysis.dataLimitations)
    ? directorAnalysis.dataLimitations.filter((x): x is string => typeof x === 'string')
    : [];
  const safeFollowUpQuestions = Array.isArray(directorAnalysis.followUpQuestions)
    ? directorAnalysis.followUpQuestions.filter((x): x is string => typeof x === 'string')
    : [];

  const activeHealthMeta =
    directorAnalysis.healthStatus && HEALTH_META[directorAnalysis.healthStatus]
      ? HEALTH_META[directorAnalysis.healthStatus]
      : HEALTH_META.ESTABLE;

  const handleCopySummary = async () => {
    try {
      const text = buildPlainTextBriefing(directorAnalysis, organizationName || 'AxyCore');
      await navigator.clipboard.writeText(text);
      setCopiedState(true);
      setTimeout(() => setCopiedState(false), 2400);
    } catch {
      setCopiedState(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      await exportBriefingToPdf(directorAnalysis, organizationName || 'AxyCore', roleLabel);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className={`space-y-6 transition-opacity duration-200 ${isStale ? 'opacity-70' : 'opacity-100'}`}>
      {/* Executive Briefing Summary Banner */}
      <div
        className={`p-6 rounded-2xl bg-white dark:bg-[#08132B] border ${activeHealthMeta.borderClass} space-y-4 shadow-2xs`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border font-bold ${activeHealthMeta.badgeClass}`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{activeHealthMeta.label}</span>
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-white/8 text-slate-700 dark:text-slate-300 font-semibold">
                Modo: {getFocusLabel(directorAnalysis.focusMode)}
              </span>
              {directorAnalysis.periodLabel && (
                <span className="text-slate-500 dark:text-slate-400">
                  {directorAnalysis.periodLabel}
                </span>
              )}
              {directorAnalysis.currencyScope && (
                <span className="text-slate-500 dark:text-slate-400">
                  · {directorAnalysis.currencyScope}
                </span>
              )}
            </div>

            <h3 className="font-display text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
              {directorAnalysis.executiveHeadline || 'Dictamen Ejecutivo Verificado'}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mr-1">
              {formatTimestamp(directorAnalysis.generatedAtIso)}
            </span>
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/12 bg-slate-50 dark:bg-[#040C1E] hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {copiedState ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedState ? 'Copiado' : 'Copiar'}</span>
            </button>
            <button
              type="button"
              disabled={exportingPdf}
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#041B4E] hover:bg-[#0B2D73] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {exportingPdf ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{exportingPdf ? 'Generando PDF…' : 'Exportar PDF'}</span>
            </button>
          </div>
        </div>

        <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">
          {directorAnalysis.executiveSummary}
        </p>

        {/* Key Metrics Cited */}
        {safeKeyMetricsCited.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 dark:border-white/8">
            {safeKeyMetricsCited.map((metric, idx) => (
              <div
                key={`metric-${idx}`}
                className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10"
              >
                <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                  {metric.label}
                </span>
                <strong className="font-mono tabular-nums text-xs sm:text-sm font-bold text-[#041B4E] dark:text-[#00D1FF] block mt-0.5">
                  {metric.value}
                </strong>
                {metric.context && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5 line-clamp-1">
                    {metric.context}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Priority Risks & Strategic Opportunities */}
      {(safePriorityRisks.length > 0 || safeStrategicOpportunities.length > 0) && (
        <DeferredSection minHeightClass="min-h-[220px]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3.5">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <span>Matriz de Riesgos Priorizados</span>
              </h3>
              {safePriorityRisks.length === 0 ? (
                <p className="text-xs text-slate-500">No se detectaron riesgos críticos en este corte.</p>
              ) : (
                <div className="space-y-3">
                  {safePriorityRisks.map((risk, idx) => {
                    const sMeta = RISK_SEVERITY_META[risk.severity] || RISK_SEVERITY_META.MEDIA;
                    return (
                      <div
                        key={`risk-${idx}`}
                        className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-950 dark:text-white">
                            {risk.title}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              {risk.area}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${sMeta.className}`}>
                              {sMeta.label}
                            </span>
                          </div>
                        </div>
                        {risk.evidence && (
                          <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-white dark:bg-[#08132B] px-2.5 py-1.5 rounded-lg border border-slate-200/70 dark:border-white/8">
                            Evidencia: {risk.evidence}
                          </p>
                        )}
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          <strong className="text-slate-800 dark:text-slate-100">Mitigación:</strong>{' '}
                          {risk.mitigation}
                        </p>
                        {risk.targetSection && canAccessSection(risk.targetSection) && (
                          <button
                            type="button"
                            onClick={() => onNavigate(risk.targetSection!)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                          >
                            <span>Atender en módulo</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3.5">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-500" />
                <span>Oportunidades Estratégicas</span>
              </h3>
              {safeStrategicOpportunities.length === 0 ? (
                <p className="text-xs text-slate-500">Sin oportunidades adicionales destacadas.</p>
              ) : (
                <div className="space-y-3">
                  {safeStrategicOpportunities.map((opp, idx) => (
                    <div
                      key={`opp-${idx}`}
                      className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-500/20 space-y-1.5"
                    >
                      <p className="text-xs font-bold text-slate-950 dark:text-white">
                        {opp.title}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {opp.detail}
                      </p>
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        Impacto esperado: {opp.expectedImpact}
                      </p>
                      {opp.targetSection && canAccessSection(opp.targetSection) && (
                        <button
                          type="button"
                          onClick={() => onNavigate(opp.targetSection!)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer pt-0.5"
                        >
                          <span>Explorar módulo</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DeferredSection>
      )}

      {/* Observations & Inferences */}
      <DeferredSection minHeightClass="min-h-[160px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#00B8FF]" />
              <span>Observaciones Verificadas (Datos Reales)</span>
            </h3>
            {safeVerifiedObservations.length === 0 ? (
              <p className="text-xs text-slate-500">Sin observaciones registradas.</p>
            ) : (
              <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                {safeVerifiedObservations.map((o, idx) => (
                  <li key={`obs-${idx}`} className="leading-relaxed">
                    · {o}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Inferencias Analíticas</span>
            </h3>
            {safeInferences.length === 0 ? (
              <p className="text-xs text-slate-500">Sin inferencias adicionales.</p>
            ) : (
              <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                {safeInferences.map((inf, idx) => (
                  <li key={`inf-${idx}`} className="leading-relaxed">
                    · {inf}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DeferredSection>

      {/* Recommended Action Plan + Governance */}
      <DeferredSection minHeightClass="min-h-[180px]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Plan de Acción Recomendado (Supervisión Humana)</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {safeRecommendedActions.map((act, idx) => {
                const pMeta =
                  ACTION_PRIORITY_META[act.priority || 'CORTO_PLAZO'] ||
                  ACTION_PRIORITY_META.CORTO_PLAZO;
                return (
                  <div
                    key={`act-${idx}`}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${pMeta.className}`}>
                          {pMeta.label}
                        </span>
                        {act.ownerRole && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                            {act.ownerRole}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-slate-950 dark:text-white">
                        {act.title}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {act.detail}
                      </p>
                    </div>
                    {act.targetSection && canAccessSection(act.targetSection) && (
                      <button
                        type="button"
                        onClick={() => onNavigate(act.targetSection!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00B8FF] hover:underline cursor-pointer self-start"
                      >
                        <span>Abrir módulo relacionado</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-4 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#E2B35E]" />
              <span>Limitaciones y Gobernanza</span>
            </h3>
            {safeDataLimitations.length === 0 ? (
              <p className="text-xs text-slate-500">
                Cobertura completa dentro de los permisos actuales.
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {safeDataLimitations.map((lim, idx) => (
                  <li key={`lim-${idx}`}>· {lim}</li>
                ))}
              </ul>
            )}
            <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <p>
                AxyCore Director nunca aprueba créditos, desembolsa fondos ni altera saldos automáticamente.
              </p>
              <p className="font-mono text-[10px]">
                Alcance RBAC: {roleLabel}
              </p>
            </div>
          </div>
        </div>
      </DeferredSection>

      {/* Interactive Follow-up Drill-Down Questions */}
      {safeFollowUpQuestions.length > 0 && (
        <DeferredSection minHeightClass="min-h-[96px]">
          <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Profundizar este Dictamen</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {safeFollowUpQuestions.map((fq, idx) => (
                <button
                  key={`fq-${idx}`}
                  type="button"
                  disabled={directorLoading}
                  onClick={() => onRunFollowUp(fq)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] hover:bg-[#0066FF]/10 dark:hover:bg-[#00B8FF]/15 border border-slate-200 dark:border-[#00B8FF]/20 text-xs text-slate-800 dark:text-slate-200 font-medium cursor-pointer transition disabled:opacity-50 text-left"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF] shrink-0" />
                  <span>{fq}</span>
                </button>
              ))}
            </div>
          </div>
        </DeferredSection>
      )}
    </div>
  );
});

export default DirectorBriefingReport;
