import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, FileText, History, Mail, Pencil, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ApplicationEditModal } from './ApplicationEditModal';
import { EMAIL_EVENT_LABELS } from '../engine/emailTemplates';
import {
  canEditApplicationRecord,
  reevaluateApplicationWithEngine,
  retryCustomerEmailNotification,
} from '../services/axycoreStore';
import {
  APPLICATION_STATUS_LABELS,
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatTimestamp,
  formatUserFacingError,
} from '../utils/formatters';

export function ApplicationDetailDrawer({
  applicationId,
  onClose,
}: {
  applicationId: string | null;
  onClose: () => void;
}) {
  const {
    applications,
    customers,
    businesses,
    scoringExecutions,
    evaluations,
    committeeDecisions,
    formalizations,
    disbursements,
    documents,
    emailNotifications,
    activeOrTestPolicy,
    userProfile,
    rbac,
  } = useAxyCore();

  const [tab, setTab] = useState<'overview' | 'indicators' | 'capacity' | 'history' | 'emails'>('overview');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [drawerFeedback, setDrawerFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const app = useMemo(
    () => applications.find((a) => a.id === applicationId) ?? null,
    [applications, applicationId]
  );

  const customer = useMemo(
    () => (app ? customers.find((c) => c.id === app.customerId) ?? null : null),
    [app, customers]
  );

  const business = useMemo(
    () => (app?.businessId ? businesses.find((b) => b.id === app.businessId) ?? null : null),
    [app, businesses]
  );

  const appExecutions = useMemo(
    () =>
      app
        ? scoringExecutions
            .filter((s) => s.applicationId === app.id)
            .sort((a, b) => String(b.executedAt ?? '').localeCompare(String(a.executedAt ?? '')))
        : [],
    [app, scoringExecutions]
  );

  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);
  const activeExecution = useMemo(() => {
    if (selectedExecId) {
      const found = appExecutions.find((e) => e.id === selectedExecId);
      if (found) return found;
    }
    if (app?.latestScoringExecutionId) {
      const latest = appExecutions.find((e) => e.id === app.latestScoringExecutionId);
      if (latest) return latest;
    }
    return appExecutions[0] ?? null;
  }, [app, appExecutions, selectedExecId]);

  const evaluation = useMemo(
    () => (app ? evaluations.find((e) => e.applicationId === app.id) ?? null : null),
    [app, evaluations]
  );
  const decision = useMemo(
    () => (app ? committeeDecisions.find((d) => d.applicationId === app.id) ?? null : null),
    [app, committeeDecisions]
  );
  const formalization = useMemo(
    () => (app ? formalizations.find((f) => f.applicationId === app.id) ?? null : null),
    [app, formalizations]
  );
  const disbursement = useMemo(
    () => (app ? disbursements.find((d) => d.applicationId === app.id) ?? null : null),
    [app, disbursements]
  );
  const appDocs = useMemo(
    () => (app ? documents.filter((d) => d.applicationId === app.id) : []),
    [app, documents]
  );

  const appEmails = useMemo(
    () =>
      app
        ? emailNotifications
            .filter((n) => n.applicationId === app.id)
            .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        : [],
    [app, emailNotifications]
  );

  if (!applicationId || !app) return null;

  const isApprovedOrBeyond = [
    'APROBADA',
    'APROBADA_CONDICIONADA',
    'FORMALIZADA',
    'DESEMBOLSADA',
  ].includes(app.status);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[2px] flex justify-end"
      onClick={onClose}
    >
      <div
        className="axy-drawer-in relative w-full max-w-4xl bg-white dark:bg-[#08132B] h-full overflow-y-auto border-l border-slate-200/90 dark:border-[#00B8FF]/20 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="axy-infinity-line shrink-0" />
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 dark:bg-[#08132B]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-[#00B8FF]/15 px-6 py-4 flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span>{app.applicationNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{app.fileNumber}</span>
              <span aria-hidden="true">·</span>
              <span>Canal {app.channel === 'EXTERNAL' ? 'Externo' : 'Interno'}</span>
            </div>
            <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white truncate">
              {app.applicantDisplayName}
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Estado del expediente: {APPLICATION_STATUS_LABELS[app.status]}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  isApprovedOrBeyond
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-sky-700 dark:text-sky-400'
                }`}
              >
                {isApprovedOrBeyond
                  ? 'APROBADO CONTRACTUALMENTE'
                  : `PRECALIFICACIÓN PRELIMINAR: ${
                      app.prequalificationStatus
                        ? SCORING_STATUS_LABELS[app.prequalificationStatus]
                        : 'Pendiente'
                    }`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canEditApplicationRecord(app.status, userProfile?.role) && (
              <>
                <button
                  type="button"
                  onClick={() => setShowEditModal(true)}
                  className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Editar Solicitud</span>
                </button>
                <button
                  type="button"
                  disabled={reevaluating || !userProfile}
                  onClick={async () => {
                    if (!userProfile) return;
                    setReevaluating(true);
                    setDrawerFeedback(null);
                    try {
                      const res = await reevaluateApplicationWithEngine({
                        application: app,
                        customer,
                        policy: activeOrTestPolicy,
                        user: userProfile,
                      });
                      setSelectedExecId(null);
                      setDrawerFeedback({
                        type: 'ok',
                        msg: `Motor V2 ejecutado: Score ${
                          res.previousScore !== null ? `${res.previousScore} → ` : ''
                        }${res.newScoring.totalScore}/100 · ${SCORING_STATUS_LABELS[res.newScoring.status]} · Monto rec.: ${formatMoney(
                          res.newScoring.recommendedAmount,
                          app.currency
                        )}.`,
                      });
                    } catch (err) {
                      setDrawerFeedback({
                        type: 'err',
                        msg: formatUserFacingError(err, 'No se pudo reevaluar con Motor V2.'),
                      });
                    } finally {
                      setReevaluating(false);
                    }
                  }}
                  className="axy-brand-gradient inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                >
                  <Cpu className={`w-3.5 h-3.5 ${reevaluating ? 'animate-spin' : ''}`} />
                  <span>{reevaluating ? 'Reevaluando...' : 'Reevaluar Motor V2'}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="axy-btn-secondary p-2 text-slate-600 dark:text-slate-300 cursor-pointer"
              aria-label="Cerrar expediente"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'overview', label: 'Resumen y Condiciones' },
            { id: 'indicators', label: '22 Indicadores Motor V2' },
            { id: 'capacity', label: 'Capacidad de Pago y Estrés' },
            { id: 'history', label: `Historial (${appExecutions.length} ejecuciones)` },
            { id: 'emails', label: `Emails Cliente (${appEmails.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                tab === t.id
                  ? 'border-[#0066FF] text-[#0066FF] dark:text-[#00D1FF] dark:border-[#00D1FF]'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 flex-1">
          {drawerFeedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                drawerFeedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <span>{drawerFeedback.msg}</span>
              <button type="button" onClick={() => setDrawerFeedback(null)} className="underline cursor-pointer">
                Cerrar
              </button>
            </div>
          )}
          {activeExecution && (
            <div className="axy-surface-tonal p-4 rounded-xl space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  Política: <strong className="font-mono">{activeExecution.policyVersion}</strong> (
                  {activeExecution.policyStatus}) · Disparador: {activeExecution.executionTrigger}
                </span>
                <span>
                  Nota: El score constituye una recomendación preliminar, nunca una aprobación automática.
                </span>
              </div>
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              {/* Top KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="axy-surface p-4 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Score Interno V2</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {activeExecution ? `${activeExecution.totalScore}/100` : '—'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Riesgo: {activeExecution?.riskBand.label ?? '—'}
                  </p>
                </div>
                <div className="axy-surface p-4 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Monto Solicitado</p>
                  <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {formatMoney(app.requestedAmount, app.currency)}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    {app.requestedTermMonths} meses · {PRODUCT_LABELS[app.productCode]}
                  </p>
                </div>
                <div className="axy-surface p-4 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Monto Recomendado</p>
                  <p className="text-xl font-bold font-mono tabular-nums text-[#0066FF] dark:text-[#00D1FF] mt-1">
                    {formatMoney(activeExecution?.recommendedAmount ?? 0, app.currency)}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Plazo rec.: {activeExecution?.recommendedTermMonths || '—'} meses
                  </p>
                </div>
                <div className="axy-surface p-4 rounded-xl">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Tasa y Cuota Rec.</p>
                  <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                    {formatRatePct(activeExecution?.recommendedRateMonthly)}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 mt-0.5">
                    Cuota: {formatMoney(activeExecution?.recommendedInstallment ?? 0, app.currency)}
                  </p>
                </div>
              </div>

              {/* Favorable, Alerts & Missing Data */}
              {activeExecution && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="axy-surface-tonal p-4 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Factores Favorables</span>
                    </div>
                    {activeExecution.favorableFactors.length === 0 ? (
                      <p className="text-xs text-slate-500">Sin factores destacados.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                        {activeExecution.favorableFactors.map((f, idx) => (
                          <li key={idx}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="axy-surface-tonal p-4 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>Alertas del Motor</span>
                    </div>
                    {activeExecution.alerts.length === 0 ? (
                      <p className="text-xs text-slate-500">Sin alertas.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                        {activeExecution.alerts.map((a, idx) => (
                          <li key={idx}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="axy-surface-tonal p-4 rounded-xl space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-400">
                      <FileText className="w-4 h-4" />
                      <span>Información Faltante</span>
                    </div>
                    {activeExecution.missingData.length === 0 ? (
                      <p className="text-xs text-slate-500">Datos completos para evaluación.</p>
                    ) : (
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                        {activeExecution.missingData.map((m, idx) => (
                          <li key={idx}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Customer, Business & Lifecycle Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-3 border-t border-slate-200/80 dark:border-[#00B8FF]/15">
                <div className="space-y-2 text-sm">
                  <h3 className="font-semibold text-slate-900 dark:text-white">Datos del Solicitante</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Documento</dt>
                    <dd className="font-mono">{customer ? `${customer.documentType} ${customer.documentNumber}` : '—'}</dd>
                    <dt className="text-slate-500">Teléfono</dt>
                    <dd className="font-mono">{customer?.phone ?? '—'}</dd>
                    <dt className="text-slate-500">Correo</dt>
                    <dd>{customer?.email || 'No suministrado'}</dd>
                    <dt className="text-slate-500">Vivienda / Residencia</dt>
                    <dd>{customer ? `${customer.housingType ?? '—'} · ${customer.residenceMonths ?? 0} meses` : '—'}</dd>
                    {business && (
                      <>
                        <dt className="text-slate-500">Empresa / RNC</dt>
                        <dd>{business.legalName} ({business.rnc})</dd>
                      </>
                    )}
                  </dl>
                </div>

                <div className="space-y-2 text-sm">
                  <h3 className="font-semibold text-slate-900 dark:text-white">Trazabilidad de Etapas</h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate-500">Consentimiento Ley 172-13</dt>
                    <dd>{app.consentVersion ?? '—'} · {formatTimestamp(app.consentAcceptedAt)}</dd>
                    <dt className="text-slate-500">Evaluación Analítica</dt>
                    <dd>{evaluation ? `${evaluation.recommendedDecision} (${evaluation.analystName})` : 'Pendiente'}</dd>
                    <dt className="text-slate-500">Decisión Comité</dt>
                    <dd>{decision ? `${decision.decision} (${decision.decidedByName})` : 'Pendiente'}</dd>
                    <dt className="text-slate-500">Formalización</dt>
                    <dd>{formalization ? formalization.status : 'Pendiente'}</dd>
                    <dt className="text-slate-500">Desembolso</dt>
                    <dd className="font-mono">{disbursement ? `${disbursement.disbursementNumber} (${disbursement.referenceNumber})` : 'No desembolsado'}</dd>
                    <dt className="text-slate-500">Documentos adjuntos</dt>
                    <dd>{appDocs.length} archivos en expediente</dd>
                  </dl>
                </div>
              </div>
            </div>
          )}

          {tab === 'indicators' && activeExecution && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-sm text-slate-900 dark:text-white">
                  Desglose Exacto de 22 Indicadores (Total: {activeExecution.totalScore} / 100 pts)
                </h3>
                {appExecutions.length > 1 && (
                  <select
                    value={activeExecution.id}
                    onChange={(e) => setSelectedExecId(e.target.value)}
                    className="axy-input text-xs px-2.5 py-1.5 text-slate-900 dark:text-white"
                  >
                    {appExecutions.map((ex, i) => (
                      <option key={ex.id} value={ex.id}>
                        Ejecución #{appExecutions.length - i} · Score {ex.totalScore} ({ex.executionTrigger})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="axy-surface overflow-x-auto rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="axy-table-head">
                    <tr className="text-slate-600 dark:text-slate-300">
                      <th className="py-2.5 px-3 font-semibold">#</th>
                      <th className="py-2.5 px-3 font-semibold">Indicador</th>
                      <th className="py-2.5 px-3 font-semibold">Valor Utilizado</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Puntos</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Máximo</th>
                      <th className="py-2.5 px-3 font-semibold">Explicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeExecution.indicatorDetails.map((ind) => (
                      <tr key={ind.number} className="axy-table-row">
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-500">
                          {String(ind.number).padStart(2, '0')}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {ind.name}
                          {ind.isFairnessWatch && (
                            <span className="block text-[11px] text-amber-700 dark:text-amber-400">
                              Variable de equidad en revisión
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                          {ind.usedValue}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-right font-semibold text-slate-900 dark:text-white">
                          {ind.awardedPoints}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-500">
                          {ind.maxPoints}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{ind.explanation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'capacity' && activeExecution && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                {[
                  ['Ingreso Elegible (I)', formatMoney(activeExecution.capacityResult.eligibleIncome, app.currency)],
                  ['Gastos Esenciales (E)', formatMoney(activeExecution.capacityResult.essentialExpenses, app.currency)],
                  ['Cuotas Deudas Actuales (D)', formatMoney(activeExecution.capacityResult.currentDebtPayments, app.currency)],
                  ['Flujo Disponible (F)', formatMoney(activeExecution.capacityResult.availableFlow, app.currency)],
                  ['DTI Actual (D / I)', `${(activeExecution.capacityResult.currentDti * 100).toFixed(2)}%`],
                  ['DTI Proyectado', `${(activeExecution.capacityResult.projectedDti * 100).toFixed(2)}%`],
                  ['Cuota Máxima Sostenible', formatMoney(activeExecution.capacityResult.maxInstallmentAllowed, app.currency)],
                  ['Cuota Simulada Ref. 5.5%', formatMoney(activeExecution.capacityResult.simulatedReferenceInstallment, app.currency)],
                  ['Cobertura Ref. (F / Cuota)', `${activeExecution.capacityResult.simulatedReferenceCoverage.toFixed(2)}x`],
                ].map(([label, val]) => (
                  <div key={label} className="axy-surface p-4 rounded-xl">
                    <p className="text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {val}
                    </p>
                  </div>
                ))}
              </div>

              {activeExecution.currencyStressResults?.applied && (
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                    Escenarios de Estrés Cambiario USD (Ingresos en DOP)
                  </h4>
                  <div className="axy-surface overflow-x-auto rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="axy-table-head">
                        <tr className="text-slate-600 dark:text-slate-300">
                          <th className="py-2.5 px-3 font-semibold">Depreciación</th>
                          <th className="py-2.5 px-3 font-semibold">Tasa Estresada</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Ingreso USD</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Flujo USD</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Cuota Máx USD</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Capital Sostenible</th>
                          <th className="py-2.5 px-3 font-semibold">Resultado</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {activeExecution.currencyStressResults.scenarios.map((sc) => (
                          <tr key={sc.depreciationPct} className="axy-table-row">
                            <td className="py-2 px-3">+{(sc.depreciationPct * 100).toFixed(0)}%</td>
                            <td className="py-2 px-3">{sc.stressedExchangeRate.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{formatMoney(sc.stressedEligibleIncome, 'USD')}</td>
                            <td className="py-2 px-3 text-right">{formatMoney(sc.stressedAvailableFlow, 'USD')}</td>
                            <td className="py-2 px-3 text-right">{formatMoney(sc.stressedMaxInstallment, 'USD')}</td>
                            <td className="py-2 px-3 text-right">{formatMoney(sc.stressedSustainablePrincipal, 'USD')}</td>
                            <td className="py-2 px-3 font-sans">
                              {sc.remainsSustainable ? 'Sostenible' : 'Insuficiente'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
                  <History className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  Ejecuciones Inmutables del Motor V2
                </h4>
                {appExecutions.map((ex) => (
                  <div
                    key={ex.id}
                    className="axy-surface p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Score {ex.totalScore}/100 · {ex.riskBand.label} · {SCORING_STATUS_LABELS[ex.status]}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {ex.executionTrigger} · Política {ex.policyVersion} · Ejecutado por {ex.executedByName ?? ex.executedBy}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="font-semibold text-slate-900 dark:text-white">{formatMoney(ex.recommendedAmount, app.currency)}</p>
                      <p className="text-slate-500 dark:text-slate-400">{formatTimestamp(ex.executedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-200/80 dark:border-[#00B8FF]/15">
                <h4 className="font-semibold text-sm text-slate-900 dark:text-white">Historial de Movimientos del Expediente</h4>
                <div className="space-y-2">
                  {(app.movementHistory ?? []).map((m, i) => (
                    <div
                      key={i}
                      className="axy-surface-tonal p-3 rounded-lg text-xs flex flex-wrap justify-between gap-2"
                    >
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{m.action}</p>
                        {m.note && <p className="text-slate-600 dark:text-slate-400 mt-0.5">{m.note}</p>}
                      </div>
                      <div className="text-right text-slate-500 dark:text-slate-400">
                        <p>{m.userName}</p>
                        <p className="font-mono">{formatTimestamp(m.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'emails' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
                    <Mail className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                    Notificaciones Automáticas al Cliente
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Disparadas en cambios de estado (Recibida, Evaluación, Comité, Aprobada, Rechazada, Pendiente de Firma y Desembolso).
                  </p>
                </div>
              </div>

              {appEmails.length === 0 ? (
                <div className="axy-surface p-6 rounded-xl text-center text-xs text-slate-500">
                  Aún no se han generado notificaciones email para este expediente.
                </div>
              ) : (
                <div className="space-y-3">
                  {appEmails.map((em) => {
                    const isExpanded = expandedEmailId === em.id;
                    const statusLabel =
                      em.status === 'SENT'
                        ? 'Enviado'
                        : em.status === 'PENDING_CLOUD_FUNCTION'
                        ? 'En cola Cloud Function'
                        : em.status === 'QUEUED'
                        ? 'Encolado'
                        : em.status === 'SKIPPED_NO_EMAIL'
                        ? 'Sin correo en perfil'
                        : 'Error SMTP';
                    const statusColor =
                      em.status === 'SENT'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : em.status === 'FAILED' || em.status === 'SKIPPED_NO_EMAIL'
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-amber-700 dark:text-amber-400';

                    return (
                      <div
                        key={em.id}
                        className="axy-surface p-4 rounded-xl space-y-2 text-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white">{em.subject}</p>
                            <p className="text-slate-500 dark:text-slate-400">
                              Evento: {EMAIL_EVENT_LABELS[em.eventCode]} · Para: {em.recipientEmail || 'No registrado'} ·{' '}
                              <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                            </p>
                            {em.errorMessage && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{em.errorMessage}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setExpandedEmailId(isExpanded ? null : em.id)}
                              className="axy-btn-secondary px-2.5 py-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                              {isExpanded ? 'Ocultar vista' : 'Ver contenido'}
                            </button>
                            {rbac.isInternalStaff && !rbac.isReadOnlyAuditor && em.recipientEmail && em.status !== 'SENT' && (
                              <button
                                type="button"
                                disabled={retryingId === em.id}
                                onClick={async () => {
                                  setRetryingId(em.id);
                                  try {
                                    await retryCustomerEmailNotification(em);
                                  } finally {
                                    setRetryingId(null);
                                  }
                                }}
                                className="axy-btn-primary inline-flex items-center gap-1 px-2.5 py-1 cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw className="w-3 h-3" />
                                {retryingId === em.id ? 'Reintentando...' : 'Despachar SMTP'}
                              </button>
                            )}
                          </div>
                        </div>
                        {isExpanded && (
                          <pre className="axy-surface-tonal p-3 rounded-lg whitespace-pre-wrap font-sans text-xs text-slate-700 dark:text-slate-300">
                            {em.bodyText}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showEditModal && (
        <ApplicationEditModal
          application={app}
          onClose={() => setShowEditModal(false)}
          onSaved={(res) => {
            setSelectedExecId(null);
            setDrawerFeedback({
              type: 'ok',
              msg: res.newScoring
                ? `Solicitud actualizada (${res.changedFields.join(', ') || 'confirmada'}) y reevaluada por Motor V2: Score ${
                    res.previousScore !== null ? `${res.previousScore} → ` : ''
                  }${res.newScoring.totalScore}/100 · ${SCORING_STATUS_LABELS[res.newScoring.status]}.`
                : `Solicitud actualizada (${res.changedFields.join(', ') || 'confirmada'}). Puedes pulsar "Reevaluar Motor V2" cuando desees.`,
            });
          }}
        />
      )}
    </div>
  );
}
