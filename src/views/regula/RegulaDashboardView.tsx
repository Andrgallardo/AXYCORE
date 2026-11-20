import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  GraduationCap,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';
import type { RegulaSectionId } from '../../types/regula';

const RISK_LEVEL_COLORS: Record<string, string> = {
  CRITICO: '#DC2626',
  ALTO: '#EA580C',
  MEDIO: '#D97706',
  BAJO: '#16A34A',
};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICA: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border border-rose-500/25',
  ALTA: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/25',
  MEDIA: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border border-sky-500/25',
  BAJA: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
};

export function RegulaDashboardView({
  ws,
  onNavigate,
}: {
  ws: RegulaWorkspaceState;
  onNavigate: (section: RegulaSectionId) => void;
}) {
  const { kpis, charts, residualHeatmap, priorityAlerts, ecosystemSignals, syncingAlerts, persistDerivedAlerts } = ws;
  const [alertSyncMessage, setAlertSyncMessage] = useState<string | null>(null);

  const handleSyncAlerts = async () => {
    setAlertSyncMessage(null);
    try {
      const count = await persistDerivedAlerts();
      setAlertSyncMessage(
        count > 0
          ? `${count} alerta(s) nuevas sincronizadas con REGULA y el Centro de Notificaciones de AxyCore.`
          : 'Todas las alertas prioritarias ya se encuentran sincronizadas (sin duplicados).'
      );
    } catch (err) {
      setAlertSyncMessage(err instanceof Error ? err.message : 'Error sincronizando alertas.');
    }
  };

  const kpiCards: Array<{
    label: string;
    value: string;
    sub: string;
    section: RegulaSectionId;
    tone: 'default' | 'good' | 'warn' | 'critical';
  }> = [
    {
      label: 'Índice General de Cumplimiento',
      value: kpis.generalComplianceIndexPct !== null ? `${kpis.generalComplianceIndexPct}%` : 'Sin datos',
      sub: `${kpis.fulfilledObligationsCount} de ${kpis.applicableObligationsCount} aplicables`,
      section: 'cumplimiento',
      tone:
        kpis.generalComplianceIndexPct === null
          ? 'default'
          : kpis.generalComplianceIndexPct >= 85
          ? 'good'
          : kpis.generalComplianceIndexPct >= 65
          ? 'warn'
          : 'critical',
    },
    {
      label: 'Obligaciones Aplicables',
      value: String(kpis.applicableObligationsCount),
      sub: 'Activas en matriz normativa',
      section: 'cumplimiento',
      tone: 'default',
    },
    {
      label: 'Obligaciones Cumplidas',
      value: String(kpis.fulfilledObligationsCount),
      sub: 'Con cumplimiento verificado',
      section: 'cumplimiento',
      tone: kpis.fulfilledObligationsCount > 0 ? 'good' : 'default',
    },
    {
      label: 'Próximas a Vencer (≤30d)',
      value: String(kpis.upcomingObligationsCount),
      sub: 'Exigibles en ventana preventiva',
      section: 'cumplimiento',
      tone: kpis.upcomingObligationsCount > 0 ? 'warn' : 'default',
    },
    {
      label: 'Obligaciones Vencidas',
      value: String(kpis.overdueObligationsCount),
      sub: 'Escalamiento obligatorio',
      section: 'cumplimiento',
      tone: kpis.overdueObligationsCount > 0 ? 'critical' : 'good',
    },
    {
      label: 'Riesgos Activos',
      value: String(kpis.activeRisksCount),
      sub: `Exposición residual: ${kpis.institutionalRiskExposureScore !== null ? `${kpis.institutionalRiskExposureScore}/100` : 'N/A'}`,
      section: 'riesgos',
      tone: 'default',
    },
    {
      label: 'Riesgos Críticos',
      value: String(kpis.criticalRisksCount),
      sub: 'Zona roja (16–25 pts)',
      section: 'riesgos',
      tone: kpis.criticalRisksCount > 0 ? 'critical' : 'good',
    },
    {
      label: 'Riesgos Altos',
      value: String(kpis.highRisksCount),
      sub: 'Zona naranja (10–15 pts)',
      section: 'riesgos',
      tone: kpis.highRisksCount > 0 ? 'warn' : 'default',
    },
    {
      label: 'Controles Evaluados',
      value: String(kpis.evaluatedControlsCount),
      sub: `De ${ws.data.controles.filter((c) => !c.deletedAt).length} registrados`,
      section: 'control_interno',
      tone: 'default',
    },
    {
      label: 'Efectividad de Controles',
      value: kpis.controlEffectivenessPct !== null ? `${kpis.controlEffectivenessPct}%` : 'Sin pruebas',
      sub: 'Resultado de pruebas vigentes',
      section: 'control_interno',
      tone:
        kpis.controlEffectivenessPct === null
          ? 'default'
          : kpis.controlEffectivenessPct >= 80
          ? 'good'
          : 'warn',
    },
    {
      label: 'Hallazgos Abiertos',
      value: String(kpis.openFindingsCount),
      sub: `${kpis.criticalFindingsCount} crítico(s) en auditoría`,
      section: 'auditoria',
      tone: kpis.criticalFindingsCount > 0 ? 'critical' : kpis.openFindingsCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'Planes de Acción Activos',
      value: String(kpis.activeActionPlansCount),
      sub: 'Correctivos y preventivos',
      section: 'planes_accion',
      tone: 'default',
    },
    {
      label: 'Planes de Acción Vencidos',
      value: String(kpis.overdueActionPlansCount),
      sub: 'Requieren seguimiento inmediato',
      section: 'planes_accion',
      tone: kpis.overdueActionPlansCount > 0 ? 'critical' : 'good',
    },
    {
      label: 'Incidentes Abiertos',
      value: String(kpis.openIncidentsCount),
      sub: 'Eventos en investigación',
      section: 'incidentes',
      tone: kpis.openIncidentsCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'Alertas / Casos PLAFTPADM',
      value: String(kpis.plaftActiveAlertsCount),
      sub: 'Revisión humana obligatoria',
      section: 'plaftpadm',
      tone: kpis.plaftActiveAlertsCount > 0 ? 'critical' : 'good',
    },
    {
      label: 'Docs. Vencidos / Cobertura Cap.',
      value: `${kpis.expiredOrPendingDocumentsCount} / ${kpis.trainingCoveragePct !== null ? `${kpis.trainingCoveragePct}%` : 'N/A'}`,
      sub: 'Documentos pendientes · Cultura %',
      section: kpis.expiredOrPendingDocumentsCount > 0 ? 'evidencias' : 'cultura',
      tone: kpis.expiredOrPendingDocumentsCount > 0 ? 'warn' : 'default',
    },
  ];

  const toneText = (t: 'default' | 'good' | 'warn' | 'critical') => {
    if (t === 'critical') return 'text-rose-600 dark:text-rose-400';
    if (t === 'warn') return 'text-amber-600 dark:text-amber-400';
    if (t === 'good') return 'text-emerald-600 dark:text-emerald-400';
    return 'text-slate-950 dark:text-white';
  };

  return (
    <div className="space-y-6">
      {/* Empty Onboarding Banner when no REGULA data exists yet */}
      {!kpis.hasAnyData && (
        <div className="axy-surface-ai rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                <ShieldCheck className="w-4 h-4" />
                <span>Espacio Institucional Nuevo · Sin Datos Simulados</span>
              </div>
              <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                Inicia el programa de Cumplimiento y Riesgos en AxyCore REGULA
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Todos los indicadores de este tablero se calculan exclusivamente sobre registros reales de{' '}
                <strong>{ws.organization.tradeName || ws.organization.name}</strong>. Registra tu primera obligación
                normativa, evalúa tu primer riesgo institucional, vincula clientes a KYC/PLAFTPADM o usa REGULA AI
                para analizar una normativa.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('cumplimiento')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Registrar Obligación</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('riesgos')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-secondary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Evaluar Riesgo</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('regula_ai')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-secondary text-xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Analizar Normativa con IA</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 16 Real Clickable KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-4 gap-3">
        {kpiCards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => onNavigate(card.section)}
            className="axy-surface rounded-xl p-4 text-left hover:border-[#0066FF]/40 dark:hover:border-[#00B8FF]/45 transition-colors cursor-pointer group"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-tight">
                {card.label}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:text-[#0066FF] dark:group-hover:text-[#00D1FF] shrink-0 transition-colors" />
            </div>
            <div className={`mt-2 font-mono tabular-nums text-xl sm:text-2xl font-bold ${toneText(card.tone)}`}>
              {card.value}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">{card.sub}</div>
          </button>
        ))}
      </div>

      {/* Priority Alerts + Ecosystem Signals Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Priority Alerts Panel */}
        <div className="lg:col-span-7 axy-surface rounded-2xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <BellRing className="w-4 h-4 text-rose-500" />
                <span>Alertas Prioritarias de Cumplimiento y Riesgo ({priorityAlerts.length})</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Detección automática sin duplicados de vencimientos, controles inefectivos, hallazgos y KYC.
              </p>
            </div>
            <button
              type="button"
              disabled={syncingAlerts || priorityAlerts.length === 0}
              onClick={handleSyncAlerts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingAlerts ? 'animate-spin' : ''}`} />
              <span>Sincronizar al Centro de Notificaciones</span>
            </button>
          </div>

          {alertSyncMessage && (
            <div className="px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-xs text-sky-700 dark:text-sky-300">
              {alertSyncMessage}
            </div>
          )}

          {priorityAlerts.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <span>Sin alertas prioritarias abiertas en este momento.</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-72 overflow-y-auto">
              {priorityAlerts.slice(0, 12).map((alert) => (
                <button
                  key={alert.dedupKey}
                  type="button"
                  onClick={() => onNavigate(alert.targetSection)}
                  className="w-full py-2.5 px-2 flex items-start justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] rounded-lg transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${SEVERITY_BADGE[alert.severity]}`}>
                        {alert.severity}
                      </span>
                      {alert.escalated && (
                        <span className="text-[10px] font-mono uppercase text-rose-600 dark:text-rose-400 font-semibold">
                          Escalada
                        </span>
                      )}
                      <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {alert.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                      {alert.description}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-1" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Read-Only AxyCore Ecosystem Integration Panel */}
        <div className="lg:col-span-5 axy-surface rounded-2xl p-5 space-y-3">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
              <span>Señales del Ecosistema AxyCore (Solo Lectura)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Lectura transversal sin alterar préstamos, clientes, pagos ni contabilidad.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Centinela (Activas / Crít.)</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5">
                {ecosystemSignals.centinelaActiveAlerts} / {ecosystemSignals.centinelaCriticalAlerts}
              </div>
            </div>
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Altera (Rec. Prioritarias)</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5">
                {ecosystemSignals.alteraHighRiskRecommendations}
              </div>
            </div>
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Cuentas ≥30 / ≥60 DPD</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5">
                {ecosystemSignals.loansWithHighDpdCount} / {ecosystemSignals.anticipateSevereDelinquencyLoans}
              </div>
            </div>
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Excepciones Banco / e-CF</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5">
                {ecosystemSignals.openReconciliationExceptions} / {ecosystemSignals.ecfPendingOrErrorCount}
              </div>
            </div>
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Cobertura KYC vs. Maestro</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5">
                {ecosystemSignals.customersWithRegulaKyc} / {ecosystemSignals.totalCustomersMaster}
              </div>
            </div>
            <div className="p-2.5 rounded-xl axy-surface-tonal">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Política Motor V2 / Docs</div>
              <div className="font-mono tabular-nums font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                {ecosystemSignals.creditPoliciesActiveVersion} · {ecosystemSignals.pendingCreditDocumentsCount} pend.
              </div>
            </div>
          </div>

          {ecosystemSignals.proposedAlerts.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {ecosystemSignals.proposedAlerts.map((sig) => (
                <button
                  key={sig.key}
                  type="button"
                  onClick={() => onNavigate(sig.targetSection)}
                  className="w-full p-2 rounded-lg border border-slate-200/80 dark:border-white/10 hover:border-[#0066FF]/40 text-left flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono text-[#0052CC] dark:text-[#00D1FF] font-semibold">
                      {sig.sourceModule}
                    </span>
                    <div className="text-xs font-medium text-slate-900 dark:text-white truncate">{sig.title}</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Interactive 5x5 Risk Heatmap + Upcoming Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6 axy-surface rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Mapa de Calor de Riesgo Residual (5×5)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Haz clic en el mapa para abrir la Matriz de Riesgos y expedientes detallados.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('riesgos')}
              className="text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
            >
              Abrir Matriz
            </button>
          </div>

          <div className="overflow-x-auto">
            <div className="grid grid-cols-6 gap-1.5 min-w-[340px]">
              <div className="text-[10px] font-mono text-slate-400 flex items-end justify-center pb-1">P \ I</div>
              {[1, 2, 3, 4, 5].map((imp) => (
                <div key={imp} className="text-center text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400">
                  Imp {imp}
                </div>
              ))}
              {residualHeatmap.map((row) => (
                <React.Fragment key={row[0].probability}>
                  <div className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center">
                    P{row[0].probability}
                  </div>
                  {row.map((cell) => {
                    const bg =
                      cell.level === 'CRITICO'
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-800 dark:text-rose-200'
                        : cell.level === 'ALTO'
                        ? 'bg-orange-500/20 border-orange-500/40 text-orange-800 dark:text-orange-200'
                        : cell.level === 'MEDIO'
                        ? 'bg-amber-500/18 border-amber-500/35 text-amber-800 dark:text-amber-200'
                        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-200';
                    return (
                      <button
                        key={`${cell.probability}_${cell.impact}`}
                        type="button"
                        onClick={() => onNavigate('riesgos')}
                        title={`Prob ${cell.probability} × Imp ${cell.impact} = ${cell.score} (${cell.level}) · ${cell.risks.length} riesgo(s)`}
                        className={`h-11 rounded-lg border flex flex-col items-center justify-center transition hover:brightness-110 cursor-pointer ${bg}`}
                      >
                        <span className="font-mono tabular-nums text-xs font-bold">
                          {cell.risks.length > 0 ? cell.risks.length : '·'}
                        </span>
                        <span className="text-[9px] font-mono opacity-75">{cell.score}</span>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Upcoming Deadlines Calendar List */}
        <div className="lg:col-span-6 axy-surface rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Calendario de Próximos Vencimientos</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Obligaciones, hallazgos y planes de acción ordenados por fecha exigible.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('cumplimiento')}
              className="text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
            >
              Ver Calendario
            </button>
          </div>

          {charts.upcomingDeadlines.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay vencimientos pendientes registrados. Crea obligaciones o planes de acción con fecha límite.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-64 overflow-y-auto">
              {charts.upcomingDeadlines.map((item) => (
                <button
                  key={`${item.type}_${item.id}`}
                  type="button"
                  onClick={() => onNavigate(item.section)}
                  className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] px-2 rounded-lg cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                        {item.type}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {item.code} · {item.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Responsable: {item.owner}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono tabular-nums text-xs font-bold text-slate-900 dark:text-white">
                      {item.dueDate}
                    </div>
                    <div
                      className={`font-mono text-[10px] font-semibold ${
                        item.daysLeft < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : item.daysLeft <= 10
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d vencido` : `en ${item.daysLeft}d`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Analytics Charts Grid (Recharts over 100% Real Data) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Compliance by Department */}
        <div className="axy-surface rounded-2xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Cumplimiento por Área / Departamento (%)
          </h3>
          {charts.complianceByArea.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Registra obligaciones asignadas por área para visualizar esta gráfica.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.complianceByArea} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="area" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="cumplimientoPct" name="Cumplimiento %" fill="#0066FF" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Risk Distribution by Level */}
        <div className="axy-surface rounded-2xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Distribución de Riesgos Activos por Nivel Residual
          </h3>
          {charts.riskByLevel.every((r) => r.value === 0) ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Registra riesgos en la Matriz de Riesgos para visualizar su distribución.
            </div>
          ) : (
            <div className="h-56 flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={charts.riskByLevel.filter((r) => r.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {charts.riskByLevel
                      .filter((r) => r.value > 0)
                      .map((entry) => (
                        <Cell key={entry.name} fill={RISK_LEVEL_COLORS[entry.name] || '#0066FF'} />
                      ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Compliance Evolution */}
        <div className="axy-surface rounded-2xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Evolución de Cumplimiento por Mes de Vencimiento (%)
          </h3>
          {charts.complianceEvolution.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Sin historial mensual de obligaciones todavía.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.complianceEvolution} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="cumplimientoPct" name="Cumplimiento %" stroke="#00B8FF" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Findings by Severity & Action Plans */}
        <div className="axy-surface rounded-2xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Hallazgos de Auditoría por Severidad (Abiertos vs. Cerrados)
          </h3>
          {charts.findingsBySeverity.every((f) => f.abiertos === 0 && f.cerrados === 0) ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Registra hallazgos en Auditoría Interna para visualizar la gráfica.
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.findingsBySeverity} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="severidad" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="abiertos" name="Abiertos" fill="#DC2626" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cerrados" name="Cerrados" fill="#16A34A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Quick Action Footer Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: ShieldAlert, title: 'Gestionar PLAFTPADM', desc: 'KYC, Debida Diligencia, UBO y Casos', section: 'plaftpadm' as RegulaSectionId },
          { icon: ClipboardCheck, title: 'Control Interno y Pruebas', desc: 'Matriz de controles y debilidades', section: 'control_interno' as RegulaSectionId },
          { icon: FileWarning, title: 'Incidentes y Planes', desc: 'Causa raíz y verificación de cierre', section: 'planes_accion' as RegulaSectionId },
          { icon: GraduationCap, title: 'Cultura y Reportes PDF', desc: 'Capacitación y 18 reportes oficiales', section: 'reportes' as RegulaSectionId },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => onNavigate(item.section)}
              className="axy-surface rounded-xl p-4 text-left hover:border-[#0066FF]/40 transition-colors cursor-pointer flex items-start gap-3"
            >
              <Icon className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 dark:text-white">{item.title}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
