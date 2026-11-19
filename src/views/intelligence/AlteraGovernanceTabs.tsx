import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  GraduationCap,
  History,
  Lock,
  Save,
  Sliders,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { evaluateOutcomeLearning } from '../../engine/altera/alteraSimulationEngine';
import type {
  AuditLogRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentPromiseRecord,
  PaymentRecord,
} from '../../types/axycore';
import type {
  AlteraAnalysisLogRecord,
  AlteraConfigRecord,
  AlteraCreditDigitalTwin,
  AlteraOutcomeRecord,
  AlteraRecommendationRecord,
  AlteraRecommendationStatus,
} from '../../types/altera';
import {
  AlteraExplainabilityPanel,
  INTERVENTION_LABELS,
  PRIORITY_STYLES,
  REC_STATUS_LABELS,
  REC_STATUS_STYLES,
  formatAlteraMoney,
} from './alteraUiShared';

export function AlteraRecommendationsSection({
  recommendations,
  canPropose,
  canApprove,
  isReadOnlyAuditor,
  onTransitionStatus,
}: {
  recommendations: AlteraRecommendationRecord[];
  canPropose: boolean;
  canApprove: boolean;
  isReadOnlyAuditor: boolean;
  onTransitionStatus: (params: {
    recommendation: AlteraRecommendationRecord;
    nextStatus: AlteraRecommendationStatus;
    notes?: string;
  }) => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [noteByRecId, setNoteByRecId] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const filtered = useMemo(() => {
    return [...recommendations]
      .filter((r) => statusFilter === 'ALL' || r.status === statusFilter)
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  }, [recommendations, statusFilter]);

  const handleAction = async (
    rec: AlteraRecommendationRecord,
    nextStatus: AlteraRecommendationStatus
  ) => {
    if (isReadOnlyAuditor) return;
    setBusyId(rec.id);
    setMsg(null);
    try {
      await onTransitionStatus({
        recommendation: rec,
        nextStatus,
        notes: noteByRecId[rec.id],
      });
      setMsg({
        type: 'ok',
        text: `Recomendación ${rec.code} actualizada a ${REC_STATUS_LABELS[nextStatus]}.`,
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo actualizar el estado.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ClipboardList className="w-5 h-5 text-[#00D1FF]" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Cola de Recomendaciones ALTERA ({filtered.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Control obligatorio de autorización humana: ninguna recomendación modifica préstamos, tasas ni fechas de forma autónoma.
            </p>
          </div>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-semibold text-slate-900 dark:text-white"
        >
          <option value="ALL">Todos los estados</option>
          {Object.entries(REC_STATUS_LABELS).map(([k, lbl]) => (
            <option key={k} value={k}>
              {lbl}
            </option>
          ))}
        </select>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border ${
            msg.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-sm text-slate-500">
          No existen recomendaciones registradas en este filtro. Genera propuestas desde Plan B Preventivo o el Laboratorio de Intervenciones.
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((rec) => (
          <div
            key={rec.id}
            className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">
                    {rec.code}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIORITY_STYLES[rec.priority]}`}
                  >
                    {rec.priority}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${REC_STATUS_STYLES[rec.status]}`}
                  >
                    {REC_STATUS_LABELS[rec.status]}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {rec.createdAtIso.slice(0, 10)}
                  </span>
                </div>
                <h4 className="font-display text-base font-bold text-slate-950 dark:text-white mt-1">
                  {rec.loanNumber} · {rec.customerName} — {INTERVENTION_LABELS[rec.interventionType]}
                </h4>
              </div>
              <div className="text-right text-xs">
                <p className="font-mono font-bold text-slate-900 dark:text-white">
                  Confianza {rec.confidencePct}%
                </p>
                <p className="text-[11px] text-slate-500">
                  Seguimiento: {rec.suggestedFollowUpDate}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold uppercase text-[10px] text-slate-500">Evidencia y Diagnóstico</span>
                <p className="text-slate-700 dark:text-slate-300">{rec.evidenceSummary}</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">{rec.diagnosis}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold uppercase text-[10px] text-[#0052CC] dark:text-[#00D1FF]">
                  Alternativa Propuesta
                </span>
                <p className="text-slate-800 dark:text-slate-200 font-semibold">
                  {rec.proposedAlternative}
                </p>
                <p className="text-[11px] text-slate-500">
                  Política: {rec.policyCompliant ? 'Dentro de política' : 'Requiere excepción'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 space-y-1">
                <span className="font-bold uppercase text-[10px] text-emerald-500">
                  Impacto Esperado
                </span>
                <p className="text-slate-800 dark:text-slate-200">{rec.expectedImpact}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  Saldo est. horizonte: {formatAlteraMoney(rec.expectedBalanceAtHorizon, rec.currency)}
                </p>
              </div>
            </div>

            {/* Follow-up Audit Trail */}
            {rec.followUpHistory && rec.followUpHistory.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#040C1E]/60 border border-slate-200 dark:border-white/5 text-[11px] space-y-1">
                <p className="font-bold uppercase text-slate-500 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Trazabilidad de Decisiones y Seguimiento
                </p>
                {rec.followUpHistory.map((h, i) => (
                  <p key={i} className="text-slate-600 dark:text-slate-300">
                    <span className="font-mono text-slate-400">{h.timestampIso.slice(0, 16).replace('T', ' ')}</span>{' '}
                    · <strong>{h.userName}</strong> ({h.userRole}): {h.fromStatus} →{' '}
                    <strong>{h.toStatus}</strong> — {h.notes}
                  </p>
                ))}
              </div>
            )}

            {/* RBAC Workflow Actions */}
            {!isReadOnlyAuditor && (canPropose || canApprove) && rec.status !== 'CERRADA' && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
                <input
                  type="text"
                  value={noteByRecId[rec.id] || ''}
                  onChange={(e) =>
                    setNoteByRecId((prev) => ({ ...prev, [rec.id]: e.target.value }))
                  }
                  placeholder="Nota o justificación de decisión / seguimiento..."
                  className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/20 text-xs text-slate-900 dark:text-white"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {canPropose && rec.status === 'GENERADA' && (
                    <button
                      type="button"
                      disabled={busyId === rec.id}
                      onClick={() => handleAction(rec, 'PENDIENTE_REVISION')}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer"
                    >
                      Enviar a Revisión
                    </button>
                  )}
                  {canApprove &&
                    (rec.status === 'GENERADA' || rec.status === 'PENDIENTE_REVISION') && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === rec.id}
                          onClick={() => handleAction(rec, 'APROBADA')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar
                        </button>
                        <button
                          type="button"
                          disabled={busyId === rec.id}
                          onClick={() => handleAction(rec, 'RECHAZADA')}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Rechazar
                        </button>
                      </>
                    )}
                  {canApprove && rec.status === 'APROBADA' && (
                    <button
                      type="button"
                      disabled={busyId === rec.id}
                      onClick={() => handleAction(rec, 'EN_EJECUCION')}
                      className="px-3 py-1.5 rounded-lg bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold cursor-pointer"
                    >
                      Iniciar Ejecución
                    </button>
                  )}
                  {canApprove &&
                    (rec.status === 'APROBADA' || rec.status === 'EN_EJECUCION') && (
                      <button
                        type="button"
                        disabled={busyId === rec.id}
                        onClick={() => handleAction(rec, 'EJECUTADA')}
                        className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold cursor-pointer"
                      >
                        Marcar Ejecutada
                      </button>
                    )}
                  {canApprove && (
                    <button
                      type="button"
                      disabled={busyId === rec.id}
                      onClick={() => handleAction(rec, 'CERRADA')}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/20 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                    >
                      Cerrar
                    </button>
                  )}
                </div>
              </div>
            )}

            <AlteraExplainabilityPanel explainability={rec.explainability} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AlteraOutcomeLearningSection({
  recommendations,
  outcomes,
  loans,
  twins,
  installments,
  payments,
  promises,
  canPropose,
  isReadOnlyAuditor,
  onSaveOutcome,
}: {
  recommendations: AlteraRecommendationRecord[];
  outcomes: AlteraOutcomeRecord[];
  loans: LoanRecord[];
  twins: AlteraCreditDigitalTwin[];
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  promises: PaymentPromiseRecord[];
  canPropose: boolean;
  isReadOnlyAuditor: boolean;
  onSaveOutcome: (
    outcome: Omit<
      AlteraOutcomeRecord,
      'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<void>;
}) {
  const evaluableRecs = useMemo(
    () =>
      recommendations.filter((r) =>
        ['APROBADA', 'EN_EJECUCION', 'EJECUTADA', 'CERRADA'].includes(r.status)
      ),
    [recommendations]
  );

  const [selectedRecId, setSelectedRecId] = useState<string>(evaluableRecs[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeRec = evaluableRecs.find((r) => r.id === selectedRecId) || evaluableRecs[0];
  const liveEval = useMemo(() => {
    if (!activeRec) return null;
    const loan = loans.find((l) => l.id === activeRec.loanId);
    const twin = twins.find((t) => t.loanId === activeRec.loanId);
    if (!loan || !twin) return null;
    return evaluateOutcomeLearning({
      recommendation: activeRec,
      loan,
      twin,
      installments,
      payments,
      promises,
    });
  }, [activeRec, loans, twins, installments, payments, promises]);

  const chartData = useMemo(() => {
    return outcomes.slice(0, 10).map((o) => ({
      code: o.recommendationCode,
      proyectada: o.projectedRecoveryPct,
      real: o.actualRecoveryPct,
      efectividad: o.effectivenessScore,
    }));
  }, [outcomes]);

  const handlePersistEvaluation = async () => {
    if (!liveEval || !canPropose || isReadOnlyAuditor) return;
    setSaving(true);
    setNotice(null);
    try {
      await onSaveOutcome(liveEval);
      setNotice(
        `Resultado evaluado y guardado para ${liveEval.recommendationCode}. Efectividad: ${liveEval.effectivenessScore}/100.`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-5 h-5 text-[#00D1FF]" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Aprendizaje de Resultados y Calibración Post-Intervención
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Compara lo proyectado por ALTERA contra los pagos y regularización real posterior en AxyCore.
              </p>
            </div>
          </div>

          {evaluableRecs.length > 0 && (
            <select
              value={activeRec?.id || ''}
              onChange={(e) => setSelectedRecId(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-semibold text-slate-900 dark:text-white min-w-[260px]"
            >
              {evaluableRecs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.loanNumber} ({REC_STATUS_LABELS[r.status]})
                </option>
              ))}
            </select>
          )}
        </div>

        {liveEval ? (
          <div className="p-4 rounded-xl bg-[#040C1E] text-white border border-[#00B8FF]/25 space-y-3 text-xs">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <span className="text-slate-400">Recup. Proyectada vs Real</span>
                <p className="font-mono text-base font-bold text-[#00D1FF]">
                  {liveEval.projectedRecoveryPct}% vs {liveEval.actualRecoveryPct}%
                </p>
              </div>
              <div>
                <span className="text-slate-400">Efectividad Real</span>
                <p className="font-mono text-base font-bold text-emerald-400">
                  {liveEval.effectivenessScore}/100
                </p>
              </div>
              <div>
                <span className="text-slate-400">Cumplimiento Compromiso</span>
                <p className="font-mono text-base font-bold">
                  {liveEval.commitmentFulfilled ? 'Cumplido' : 'Parcial / Pendiente'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Delta de Calibración</span>
                <p className="font-mono text-base font-bold text-amber-400">
                  {liveEval.calibrationDeltaPct >= 0 ? '+' : ''}
                  {liveEval.calibrationDeltaPct}%
                </p>
              </div>
            </div>
            <p className="text-slate-200">{liveEval.learningConclusion}</p>
            <p className="text-[#00D1FF] font-semibold">
              Sugerencia de calibración transparente: {liveEval.recommendedWeightAdjustment}
            </p>
            {canPropose && !isReadOnlyAuditor && (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handlePersistEvaluation}
                  className="px-4 py-2 rounded-xl bg-[#0052CC] hover:bg-[#0066FF] text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Registrando...' : 'Evaluar y Guardar Calibración'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-500">
            Aprueba o ejecuta al menos una recomendación en la cola de Recomendaciones para medir su resultado real frente a la proyección.
          </div>
        )}

        {notice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
            {notice}
          </div>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
            Recuperación Proyectada vs Real en Intervenciones Evaluadas
          </h4>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.25} />
                <XAxis dataKey="code" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#040C1E',
                    borderColor: '#00B8FF',
                    color: '#fff',
                    borderRadius: '10px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="proyectada" name="Proyectada (%)" fill="#0052CC" radius={[4, 4, 0, 0]} />
                <Bar dataKey="real" name="Real (%)" fill="#00D1FF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Histórico de Evaluaciones Post-Intervención ({outcomes.length})
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Código Rec.</th>
                <th className="py-2.5 px-3">Préstamo / Cliente</th>
                <th className="py-2.5 px-3 text-right">Proyectada</th>
                <th className="py-2.5 px-3 text-right">Real</th>
                <th className="py-2.5 px-3 text-right">Efectividad</th>
                <th className="py-2.5 px-4">Conclusión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {outcomes.map((o) => (
                <tr key={o.id} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2.5 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                    {o.recommendationCode}
                  </td>
                  <td className="py-2.5 px-3">
                    {o.loanNumber} · {o.customerName}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono">{o.projectedRecoveryPct}%</td>
                  <td className="py-2.5 px-3 text-right font-mono">{o.actualRecoveryPct}%</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold">
                    {o.effectivenessScore}/100
                  </td>
                  <td className="py-2.5 px-4 text-[11px] text-slate-500 dark:text-slate-400 max-w-md">
                    {o.learningConclusion}
                  </td>
                </tr>
              ))}
              {outcomes.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-5 text-center text-slate-400">
                    Sin evaluaciones guardadas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AlteraAnalysisHistorySection({
  analyses,
  auditLogs,
}: {
  analyses: AlteraAnalysisLogRecord[];
  auditLogs: AuditLogRecord[];
}) {
  const [search, setSearch] = useState('');

  const alteraAudits = useMemo(
    () => auditLogs.filter((a) => String(a.eventType || '').startsWith('ALTERA_')),
    [auditLogs]
  );

  const filteredAnalyses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...analyses]
      .filter((a) => {
        if (!q) return true;
        return (
          a.summary.toLowerCase().includes(q) ||
          (a.loanNumber || '').toLowerCase().includes(q) ||
          (a.customerName || '').toLowerCase().includes(q) ||
          (a.queryText || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  }, [analyses, search]);

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <History className="w-5 h-5 text-[#00D1FF]" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Historial de Análisis y Trazabilidad ALTERA
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Registro inmutable de consultas, simulaciones y eventos auditables ejecutados en la organización.
            </p>
          </div>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrar historial..."
          className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
        />
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Consultas y Análisis Registrados ({filteredAnalyses.length})
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Fecha</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3">Actor / Rol</th>
                <th className="py-2.5 px-3">Referencia</th>
                <th className="py-2.5 px-4">Resumen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredAnalyses.map((item) => (
                <tr key={item.id} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2.5 px-4 font-mono text-[11px]">
                    {item.createdAtIso.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 px-3 font-semibold">{item.analysisType}</td>
                  <td className="py-2.5 px-3">
                    {item.actorName} ({item.actorRole})
                  </td>
                  <td className="py-2.5 px-3">{item.loanNumber || item.customerName || 'Cartera'}</td>
                  <td className="py-2.5 px-4 text-[11px] text-slate-600 dark:text-slate-300">
                    {item.queryText ? `"${item.queryText}" — ` : ''}
                    {item.summary}
                  </td>
                </tr>
              ))}
              {filteredAnalyses.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-5 text-center text-slate-400">
                    Sin consultas registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Auditoría Crítica ALTERA ({alteraAudits.length})
          </h4>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-white/5 text-xs">
          {alteraAudits.slice(0, 20).map((log) => (
            <div key={log.id} className="p-3.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                  {log.eventType}
                </span>
                <p className="text-slate-800 dark:text-slate-200 mt-0.5">{log.action}</p>
              </div>
              <div className="text-right text-[11px] text-slate-500">
                <p>
                  {log.userEmail} ({log.userRole})
                </p>
                <p className="font-mono">{log.transactionId || log.id}</p>
              </div>
            </div>
          ))}
          {alteraAudits.length === 0 && (
            <p className="p-5 text-center text-slate-400">Sin eventos críticos ALTERA aún.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function AlteraConfigParamsSection({
  config,
  canManageConfig,
  onSaveConfig,
}: {
  config: AlteraConfigRecord;
  canManageConfig: boolean;
  onSaveConfig: (
    next: Partial<
      Omit<
        AlteraConfigRecord,
        | 'id'
        | 'organizationId'
        | 'requireHumanApprovalForAllInterventions'
        | 'updatedBy'
        | 'updatedByName'
        | 'createdAt'
        | 'updatedAt'
      >
    >
  ) => Promise<void>;
}) {
  const [form, setForm] = useState({
    earlyDeteriorationDelayThresholdDays: config.earlyDeteriorationDelayThresholdDays,
    minPunctualityPctForHealthy: config.minPunctualityPctForHealthy,
    maxRestructureExtensionMonths: config.maxRestructureExtensionMonths,
    maxTemporaryReductionPct: config.maxTemporaryReductionPct,
    maxTemporaryReductionMonths: config.maxTemporaryReductionMonths,
    maxDueDateShiftDays: config.maxDueDateShiftDays,
    minConfidenceForPriorityAlertPct: config.minConfidenceForPriorityAlertPct,
    preventiveHorizonDays: config.preventiveHorizonDays,
    calibrationFactorPct: config.calibrationFactorPct,
    delayTrendWeight: config.deteriorationWeights.delayTrendWeight,
    brokenPromisesWeight: config.deteriorationWeights.brokenPromisesWeight,
    overdueRatioWeight: config.deteriorationWeights.overdueRatioWeight,
    behavioralShiftWeight: config.deteriorationWeights.behavioralShiftWeight,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageConfig) return;
    setSaving(true);
    setMsg(null);
    try {
      await onSaveConfig({
        earlyDeteriorationDelayThresholdDays: Number(form.earlyDeteriorationDelayThresholdDays),
        minPunctualityPctForHealthy: Number(form.minPunctualityPctForHealthy),
        maxRestructureExtensionMonths: Number(form.maxRestructureExtensionMonths),
        maxTemporaryReductionPct: Number(form.maxTemporaryReductionPct),
        maxTemporaryReductionMonths: Number(form.maxTemporaryReductionMonths),
        maxDueDateShiftDays: Number(form.maxDueDateShiftDays),
        minConfidenceForPriorityAlertPct: Number(form.minConfidenceForPriorityAlertPct),
        preventiveHorizonDays: Number(form.preventiveHorizonDays),
        calibrationFactorPct: Number(form.calibrationFactorPct),
        deteriorationWeights: {
          delayTrendWeight: Number(form.delayTrendWeight),
          brokenPromisesWeight: Number(form.brokenPromisesWeight),
          overdueRatioWeight: Number(form.overdueRatioWeight),
          behavioralShiftWeight: Number(form.behavioralShiftWeight),
        },
      });
      setMsg({ type: 'ok', text: 'Parámetros de ALTERA guardados y auditados correctamente.' });
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error guardando configuración.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-5 h-5 text-[#00D1FF]" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Configuración y Parámetros Operativos de ALTERA
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Define límites de política para simulaciones, pesos de deterioro y umbrales preventivos.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#040C1E] border border-[#00B8FF]/30 text-[11px] font-semibold text-[#00D1FF]">
          <Lock className="w-3.5 h-3.5" /> Aprobación humana obligatoria para toda intervención activa
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
        {[
          {
            key: 'earlyDeteriorationDelayThresholdDays',
            label: 'Umbral de atraso temprano (días)',
          },
          {
            key: 'minPunctualityPctForHealthy',
            label: 'Puntualidad mínima saludable (%)',
          },
          {
            key: 'maxRestructureExtensionMonths',
            label: 'Extensión máx. reestructuración (meses)',
          },
          {
            key: 'maxTemporaryReductionPct',
            label: 'Reducción temporal máx. de cuota (%)',
          },
          {
            key: 'maxTemporaryReductionMonths',
            label: 'Duración máx. alivio temporal (meses)',
          },
          {
            key: 'maxDueDateShiftDays',
            label: 'Corrimiento máx. fecha de pago (días)',
          },
          {
            key: 'preventiveHorizonDays',
            label: 'Horizonte preventivo (días)',
          },
          {
            key: 'minConfidenceForPriorityAlertPct',
            label: 'Confianza mín. alerta prioritaria (%)',
          },
          {
            key: 'calibrationFactorPct',
            label: 'Factor de calibración aprendizaje (%)',
          },
        ].map((f) => (
          <div key={f.key}>
            <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
              {f.label}
            </label>
            <input
              type="number"
              disabled={!canManageConfig}
              value={form[f.key as keyof typeof form]}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 font-mono text-slate-900 dark:text-white disabled:opacity-60"
            />
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-3 text-xs">
        <p className="font-bold uppercase tracking-wider text-slate-500">
          Pesos Determinísticos del Score de Deterioro
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { key: 'delayTrendWeight', label: 'Tendencia DPD / Atraso (%)' },
            { key: 'brokenPromisesWeight', label: 'Promesas incumplidas (%)' },
            { key: 'overdueRatioWeight', label: 'Ratio vencido / saldo (%)' },
            { key: 'behavioralShiftWeight', label: 'Desviación últimas 3 cuotas (%)' },
          ].map((w) => (
            <div key={w.key}>
              <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {w.label}
              </label>
              <input
                type="number"
                disabled={!canManageConfig}
                value={form[w.key as keyof typeof form]}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [w.key]: Number(e.target.value) }))
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 font-mono text-slate-900 dark:text-white disabled:opacity-60"
              />
            </div>
          ))}
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border ${
            msg.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {canManageConfig ? (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0052CC] to-[#00B8FF] hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Guardando...' : 'Guardar Parámetros ALTERA'}</span>
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Solo los roles Administrador, Oficial de Riesgos o Coordinador de Cobranza pueden editar estos parámetros.
        </p>
      )}
    </form>
  );
}
