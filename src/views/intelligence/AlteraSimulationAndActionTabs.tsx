import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  BookmarkPlus,
  CheckCircle2,
  Compass,
  FlaskConical,
  GitBranch,
  Play,
  Send,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { simulateAlternativeUniverses } from '../../engine/altera/alteraSimulationEngine';
import type { CreditPolicyRecord, LoanRecord } from '../../types/axycore';
import type { CollectionPolicyVersionRecord } from '../../types/collections';
import type {
  AlteraConfigRecord,
  AlteraCreditDigitalTwin,
  AlteraInterventionType,
  AlteraPreventiveSignal,
  AlteraRecommendationRecord,
  AlteraSavedScenarioRecord,
  AlteraUniverseParameters,
} from '../../types/altera';
import {
  AlteraExplainabilityPanel,
  INTERVENTION_LABELS,
  PRIORITY_STYLES,
  formatAlteraMoney,
} from './alteraUiShared';

function buildDefaultParamsForType(
  type: AlteraInterventionType,
  twin: AlteraCreditDigitalTwin,
  config: AlteraConfigRecord
): AlteraUniverseParameters {
  const basePrincipal = Math.max(100, twin.currentPrincipalBalance);
  switch (type) {
    case 'ABONO_EXTRAORDINARIO':
      return {
        interventionType: type,
        extraordinaryPaymentAmount: Math.round(basePrincipal * 0.2),
      };
    case 'CAMBIO_FECHA_PAGO':
      return {
        interventionType: type,
        dueDateShiftDays: Math.min(7, config.maxDueDateShiftDays),
      };
    case 'REESTRUCTURACION_PLAZO':
      return {
        interventionType: type,
        restructuredTermMonths: Math.min(
          twin.remainingTermInstallments + 4,
          twin.remainingTermInstallments + config.maxRestructureExtensionMonths
        ),
        restructuredMonthlyRatePct: twin.contractualRateMonthlyPct || 4,
      };
    case 'REDUCCION_TEMPORAL_CUOTA':
      return {
        interventionType: type,
        temporaryReductionPct: Math.min(25, config.maxTemporaryReductionPct),
        temporaryReductionMonths: Math.min(2, config.maxTemporaryReductionMonths),
      };
    case 'PAGO_PARCIAL_CONTROLADO':
      return {
        interventionType: type,
        partialPaymentAmount: Math.max(50, Math.round((twin.nextDueAmount || basePrincipal * 0.1) * 0.6)),
      };
    case 'ESTRATEGIA_COBRANZA_PREVENTIVA':
    default:
      return {
        interventionType: 'ESTRATEGIA_COBRANZA_PREVENTIVA',
        preventiveContactChannel: twin.dpdCurrent >= 15 ? 'LLAMADA' : 'WHATSAPP',
      };
  }
}

export function AlteraUniversesAndLabSection({
  mode,
  loans,
  twins,
  creditPolicy,
  collectionPolicy,
  alteraConfig,
  savedScenarios,
  selectedLoanId,
  onSelectLoan,
  canSimulate,
  canPropose,
  isReadOnlyAuditor,
  onSaveScenario,
  onCreateRecommendation,
}: {
  mode: 'alternative_universes' | 'intervention_lab' | 'scenario_simulator';
  loans: LoanRecord[];
  twins: AlteraCreditDigitalTwin[];
  creditPolicy?: CreditPolicyRecord;
  collectionPolicy?: CollectionPolicyVersionRecord;
  alteraConfig: AlteraConfigRecord;
  savedScenarios: AlteraSavedScenarioRecord[];
  selectedLoanId: string;
  onSelectLoan: (loanId: string) => void;
  canSimulate: boolean;
  canPropose: boolean;
  isReadOnlyAuditor: boolean;
  onSaveScenario: (
    scenario: Omit<
      AlteraSavedScenarioRecord,
      'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<void>;
  onCreateRecommendation: (params: {
    initialStatus?: 'GENERADA' | 'PENDIENTE_REVISION';
    recommendation: Omit<
      AlteraRecommendationRecord,
      | 'id'
      | 'organizationId'
      | 'code'
      | 'createdAtIso'
      | 'status'
      | 'followUpHistory'
      | 'createdBy'
      | 'createdByName'
      | 'createdAt'
      | 'updatedAt'
    >;
    initialNotes?: string;
  }) => Promise<void>;
}) {
  const activeTwin = twins.find((t) => t.loanId === selectedLoanId) || twins[0];
  const activeLoan = loans.find((l) => l.id === activeTwin?.loanId);

  const [interventionType, setInterventionType] =
    useState<AlteraInterventionType>('ABONO_EXTRAORDINARIO');
  const [params, setParams] = useState<AlteraUniverseParameters>(() =>
    activeTwin
      ? buildDefaultParamsForType('ABONO_EXTRAORDINARIO', activeTwin, alteraConfig)
      : { interventionType: 'ABONO_EXTRAORDINARIO', extraordinaryPaymentAmount: 5000 }
  );
  const [chartMetric, setChartMetric] = useState<'remainingBalance' | 'expectedRecoveryPct'>(
    'remainingBalance'
  );
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (activeTwin) {
      setParams(buildDefaultParamsForType(interventionType, activeTwin, alteraConfig));
    }
  }, [activeTwin?.loanId, interventionType]);

  const comparison = useMemo(() => {
    if (!activeLoan || !activeTwin) return null;
    return simulateAlternativeUniverses({
      loan: activeLoan,
      twin: activeTwin,
      parameters: params,
      creditPolicy,
      collectionPolicy,
      alteraConfig,
    });
  }, [activeLoan, activeTwin, params, creditPolicy, collectionPolicy, alteraConfig]);

  const mergedChartData = useMemo(() => {
    if (!comparison) return [];
    const [uActual, uPrev, uAlt] = comparison.universes;
    const maxLen = Math.max(
      uActual.projectionSeries.length,
      uPrev.projectionSeries.length,
      uAlt.projectionSeries.length
    );
    const rows: Array<Record<string, string | number>> = [];
    for (let i = 0; i < maxLen; i++) {
      const p0 = uActual.projectionSeries[Math.min(i, uActual.projectionSeries.length - 1)];
      const p1 = uPrev.projectionSeries[Math.min(i, uPrev.projectionSeries.length - 1)];
      const p2 = uAlt.projectionSeries[Math.min(i, uAlt.projectionSeries.length - 1)];
      rows.push({
        label: p0?.label || `Cuota ${i + 1}`,
        actual: p0 ? p0[chartMetric] : 0,
        preventivo: p1 ? p1[chartMetric] : 0,
        alternativo: p2 ? p2[chartMetric] : 0,
      });
    }
    return rows;
  }, [comparison, chartMetric]);

  if (!activeTwin || !activeLoan || !comparison) {
    return (
      <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-sm text-slate-500">
        No hay créditos disponibles en esta organización para simular Universos Alternativos.
      </div>
    );
  }

  const chosenUniverse =
    comparison.universes.find((u) => u.universeCode === comparison.recommendedUniverseCode) ||
    comparison.universes[2];

  const handleSave = async () => {
    if (!canSimulate || isReadOnlyAuditor) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const title =
        scenarioTitle.trim() ||
        `${INTERVENTION_LABELS[interventionType]} · ${activeTwin.loanNumber}`;
      await onSaveScenario({
        title,
        loanId: activeTwin.loanId,
        loanNumber: activeTwin.loanNumber,
        customerId: activeTwin.customerId,
        customerName: activeTwin.customerName,
        currency: activeTwin.currency,
        interventionType,
        parameters: params,
        recommendedUniverseCode: comparison.recommendedUniverseCode,
        projectedRecoveryPct: chosenUniverse.projectedRecoveryPct,
        projectedBalanceDelta: chosenUniverse.balanceDeltaVsCurrent,
        riskReductionPct: chosenUniverse.riskReductionPct,
        policyCompliant: chosenUniverse.policyCompliant,
        confidencePct: comparison.explainability.confidencePct,
        summaryText: comparison.alteraRecommendationHeadline,
      });
      setScenarioTitle('');
      setFeedback({ type: 'ok', msg: `Escenario "${title}" guardado en Firestore.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error guardando escenario.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleProposeRecommendation = async () => {
    if (!canPropose || isReadOnlyAuditor) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const altUniverse = comparison.universes[2];
      const categoryMap: Record<AlteraInterventionType, AlteraRecommendationRecord['category']> = {
        ABONO_EXTRAORDINARIO: 'ABONO_CAPITAL',
        CAMBIO_FECHA_PAGO: 'AJUSTE_VENCIMIENTO',
        REESTRUCTURACION_PLAZO: 'REESTRUCTURACION',
        REDUCCION_TEMPORAL_CUOTA: 'PLAN_B_PREVENTIVO',
        ESTRATEGIA_COBRANZA_PREVENTIVA: 'CONTENCION_COBRANZA',
        PAGO_PARCIAL_CONTROLADO: 'PLAN_B_PREVENTIVO',
      };
      await onCreateRecommendation({
        initialStatus: 'PENDIENTE_REVISION',
        recommendation: {
          customerId: activeTwin.customerId,
          customerName: activeTwin.customerName,
          loanId: activeTwin.loanId,
          loanNumber: activeTwin.loanNumber,
          currency: activeTwin.currency,
          category: categoryMap[interventionType],
          interventionType,
          proposedParams: params,
          priority: activeTwin.priority,
          evidenceSummary: `Deterioro ${activeTwin.deteriorationScore}/100 · DPD ${activeTwin.dpdCurrent}d · Puntualidad ${activeTwin.patterns.punctualityRatePct}%`,
          diagnosis: activeTwin.recentvsHistoricalSummary,
          proposedAlternative: `${INTERVENTION_LABELS[interventionType]} (${chosenUniverse.title})`,
          expectedImpact: `Recuperación proyectada ${chosenUniverse.projectedRecoveryPct}% (+${chosenUniverse.recoveryDeltaVsCurrentPct}%) y reducción riesgo ${chosenUniverse.riskReductionPct}%.`,
          expectedRecoveryDeltaPct: chosenUniverse.recoveryDeltaVsCurrentPct,
          expectedBalanceAtHorizon: altUniverse.projectedBalanceAtHorizon,
          confidencePct: comparison.explainability.confidencePct,
          policyCompliant: chosenUniverse.policyCompliant,
          suggestedFollowUpDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          explainability: comparison.explainability,
        },
      });
      setFeedback({
        type: 'ok',
        msg: 'Recomendación formal enviada a Revisión Humana (cola de Recomendaciones). El crédito real permanece intacto hasta aprobación.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error enviando propuesta.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const sectionTitle =
    mode === 'intervention_lab'
      ? 'Laboratorio de Intervenciones Permitidas'
      : mode === 'scenario_simulator'
      ? 'Simulador y Repositorio de Escenarios'
      : 'Universos Alternativos — Comparador 3 Vías';

  return (
    <div className="space-y-5">
      {/* Control Bar */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {mode === 'intervention_lab' ? (
              <FlaskConical className="w-5 h-5 text-[#00D1FF]" />
            ) : (
              <GitBranch className="w-5 h-5 text-[#00D1FF]" />
            )}
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                {sectionTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Simulación determinística no destructiva: evalúa escenarios sin alterar el contrato real ni las cuotas.
              </p>
            </div>
          </div>

          <select
            value={activeTwin.loanId}
            onChange={(e) => onSelectLoan(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/30 text-xs font-semibold text-slate-900 dark:text-white min-w-[260px]"
          >
            {twins.map((t) => (
              <option key={t.loanId} value={t.loanId}>
                {t.loanNumber} · {t.customerName} ({formatAlteraMoney(t.currentPrincipalBalance, t.currency)})
              </option>
            ))}
          </select>
        </div>

        {/* Parameter Studio */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-white/10">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Tipo de Intervención Permitida
            </label>
            <select
              value={interventionType}
              disabled={isReadOnlyAuditor}
              onChange={(e) => setInterventionType(e.target.value as AlteraInterventionType)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
            >
              {Object.entries(INTERVENTION_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>
                  {lbl}
                </option>
              ))}
            </select>
          </div>

          {interventionType === 'ABONO_EXTRAORDINARIO' && (
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Monto de Abono Extraordinario ({activeTwin.currency})
              </label>
              <input
                type="number"
                min={1}
                max={Math.max(100, Math.round(activeTwin.currentPrincipalBalance))}
                disabled={isReadOnlyAuditor}
                value={params.extraordinaryPaymentAmount ?? 0}
                onChange={(e) =>
                  setParams({
                    ...params,
                    extraordinaryPaymentAmount: Math.max(0, Number(e.target.value)),
                  })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>
          )}

          {interventionType === 'CAMBIO_FECHA_PAGO' && (
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Corrimiento de Fecha (días · máx política {alteraConfig.maxDueDateShiftDays}d)
              </label>
              <input
                type="number"
                min={1}
                max={45}
                disabled={isReadOnlyAuditor}
                value={params.dueDateShiftDays ?? 5}
                onChange={(e) =>
                  setParams({ ...params, dueDateShiftDays: Math.max(1, Number(e.target.value)) })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>
          )}

          {interventionType === 'REESTRUCTURACION_PLAZO' && (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Nuevo Plazo Remanente (cuotas)
                </label>
                <input
                  type="number"
                  min={2}
                  max={60}
                  disabled={isReadOnlyAuditor}
                  value={params.restructuredTermMonths ?? activeTwin.remainingTermInstallments + 4}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      restructuredTermMonths: Math.max(2, Number(e.target.value)),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Tasa Mensual Simulada (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0.5}
                  max={15}
                  disabled={isReadOnlyAuditor}
                  value={params.restructuredMonthlyRatePct ?? activeTwin.contractualRateMonthlyPct}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      restructuredMonthlyRatePct: Math.max(0.5, Number(e.target.value)),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </>
          )}

          {interventionType === 'REDUCCION_TEMPORAL_CUOTA' && (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Reducción Temporal (%)
                </label>
                <input
                  type="number"
                  min={5}
                  max={70}
                  disabled={isReadOnlyAuditor}
                  value={params.temporaryReductionPct ?? 25}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      temporaryReductionPct: Math.max(5, Number(e.target.value)),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Duración Alivio (meses)
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  disabled={isReadOnlyAuditor}
                  value={params.temporaryReductionMonths ?? 2}
                  onChange={(e) =>
                    setParams({
                      ...params,
                      temporaryReductionMonths: Math.max(1, Number(e.target.value)),
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </>
          )}

          {interventionType === 'PAGO_PARCIAL_CONTROLADO' && (
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Pago Parcial Propuesto ({activeTwin.currency})
              </label>
              <input
                type="number"
                min={1}
                disabled={isReadOnlyAuditor}
                value={params.partialPaymentAmount ?? 0}
                onChange={(e) =>
                  setParams({ ...params, partialPaymentAmount: Math.max(1, Number(e.target.value)) })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>
          )}

          {interventionType === 'ESTRATEGIA_COBRANZA_PREVENTIVA' && (
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Canal Preventivo Sugerido
              </label>
              <select
                value={params.preventiveContactChannel ?? 'WHATSAPP'}
                disabled={isReadOnlyAuditor}
                onChange={(e) =>
                  setParams({
                    ...params,
                    preventiveContactChannel: e.target.value as
                      | 'WHATSAPP'
                      | 'LLAMADA'
                      | 'VISITA_CAMPO'
                      | 'EMAIL',
                  })
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
              >
                <option value="WHATSAPP">WhatsApp Preventivo 72h</option>
                <option value="LLAMADA">Llamada Asesoría Temprana</option>
                <option value="VISITA_CAMPO">Visita Supervisada</option>
                <option value="EMAIL">Recordatorio Formal Email</option>
              </select>
            </div>
          )}

          {!isReadOnlyAuditor && (
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Etiqueta del Escenario (Opcional)
              </label>
              <input
                type="text"
                value={scenarioTitle}
                onChange={(e) => setScenarioTitle(e.target.value)}
                placeholder="Ej.: Plan B Alivio 2M"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
              />
            </div>
          )}
        </div>

        {/* Action Bar */}
        {!isReadOnlyAuditor ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-[#0052CC] dark:text-[#00D1FF] font-semibold">
              Recomendación ALTERA: {comparison.alteraRecommendationHeadline}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canSimulate && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSave}
                  className="px-3.5 py-2 rounded-xl border border-[#0066FF] text-[#0052CC] dark:text-[#00D1FF] hover:bg-[#0066FF]/10 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Guardar Escenario</span>
                </button>
              )}
              {canPropose && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleProposeRecommendation}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#0052CC] to-[#00B8FF] hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar Propuesta a Revisión Humana</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/20 text-xs text-slate-600 dark:text-slate-300">
            Modo Auditor (solo lectura): puedes inspeccionar los 3 universos calculados en memoria sin persistir escenarios ni generar propuestas.
          </div>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-medium border ${
              feedback.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
            }`}
          >
            {feedback.msg}
          </div>
        )}
      </div>

      {/* 3 Universes Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {comparison.universes.map((u) => (
          <div
            key={u.universeCode}
            className={`p-5 rounded-2xl border flex flex-col justify-between space-y-4 ${
              u.isAlteraRecommended
                ? 'bg-[#040C1E] text-white border-[#00D1FF] shadow-lg'
                : 'bg-white dark:bg-[#08132B] text-slate-900 dark:text-slate-100 border-slate-200 dark:border-[#00B8FF]/20'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider ${
                      u.isAlteraRecommended ? 'text-[#00D1FF]' : 'text-slate-400'
                    }`}
                  >
                    {u.universeCode.replace(/_/g, ' ')}
                  </span>
                  <h4 className="font-display text-base font-bold">{u.title}</h4>
                  <p
                    className={`text-xs ${
                      u.isAlteraRecommended ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {u.subtitle}
                  </p>
                </div>
                {u.policyCompliant ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs pt-2 border-t border-slate-200/20">
                <div>
                  <span className="opacity-70">Cuota Proyectada</span>
                  <p className="font-mono font-bold text-sm">
                    {formatAlteraMoney(u.projectedInstallmentAmount, activeTwin.currency)}
                  </p>
                </div>
                <div>
                  <span className="opacity-70">Recuperación Est.</span>
                  <p className="font-mono font-bold text-sm text-[#00D1FF]">
                    {u.projectedRecoveryPct}% ({u.recoveryDeltaVsCurrentPct >= 0 ? '+' : ''}
                    {u.recoveryDeltaVsCurrentPct}%)
                  </p>
                </div>
                <div>
                  <span className="opacity-70">Saldo Horizonte</span>
                  <p className="font-mono font-semibold">
                    {formatAlteraMoney(u.projectedBalanceAtHorizon, activeTwin.currency)}
                  </p>
                </div>
                <div>
                  <span className="opacity-70">Riesgo Mora Est.</span>
                  <p className="font-mono font-semibold">
                    {u.estimatedDelinquencyRiskPct}% (-{u.riskReductionPct}%)
                  </p>
                </div>
              </div>

              <div className="space-y-1 text-[11px]">
                <p className="font-bold uppercase opacity-75">Condiciones</p>
                <ul className="list-disc pl-4 space-y-0.5 opacity-90">
                  {u.conditionsConsidered.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>

              {!u.policyCompliant && u.policyViolations.length > 0 && (
                <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-[11px] text-rose-200 space-y-0.5">
                  <p className="font-bold flex items-center gap-1">
                    <AlertOctagon className="w-3.5 h-3.5" /> Fuera de política:
                  </p>
                  {u.policyViolations.map((v, i) => (
                    <p key={i}>• {v}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 text-[11px]">
                <div>
                  <p className="font-bold text-emerald-400">Beneficios</p>
                  <ul className="list-disc pl-4 space-y-0.5 opacity-90">
                    {u.benefits.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-bold text-amber-400">Contrapartidas</p>
                  <ul className="list-disc pl-4 space-y-0.5 opacity-90">
                    {u.disadvantages.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {u.isAlteraRecommended && (
              <div className="pt-2 border-t border-[#00B8FF]/30 text-[11px] font-bold text-[#00D1FF]">
                ✓ Escenario Óptimo Recomendado por ALTERA
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Multi-Universe Chart */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Trayectoria Comparada de los 3 Universos
          </h4>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setChartMetric('remainingBalance')}
              className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${
                chartMetric === 'remainingBalance'
                  ? 'bg-[#0052CC] text-white'
                  : 'bg-slate-100 dark:bg-[#040C1E] text-slate-600 dark:text-slate-300'
              }`}
            >
              Saldo Remanente
            </button>
            <button
              type="button"
              onClick={() => setChartMetric('expectedRecoveryPct')}
              className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${
                chartMetric === 'expectedRecoveryPct'
                  ? 'bg-[#0052CC] text-white'
                  : 'bg-slate-100 dark:bg-[#040C1E] text-slate-600 dark:text-slate-300'
              }`}
            >
              Prob. Recuperación (%)
            </button>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.25} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
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
              <Line
                type="monotone"
                dataKey="actual"
                name="Escenario Actual"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="preventivo"
                name="Escenario Preventivo"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="alternativo"
                name="Escenario Alternativo"
                stroke="#00D1FF"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Saved Scenarios Table */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Escenarios Guardados en esta Organización ({savedScenarios.length})
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Escenario</th>
                <th className="py-2.5 px-3">Préstamo / Cliente</th>
                <th className="py-2.5 px-3">Intervención</th>
                <th className="py-2.5 px-3 text-right">Recup. Est.</th>
                <th className="py-2.5 px-3">Política</th>
                <th className="py-2.5 px-4 text-right">Cargar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {savedScenarios.map((sc) => (
                <tr key={sc.id} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2.5 px-4 font-semibold">{sc.title}</td>
                  <td className="py-2.5 px-3">
                    {sc.loanNumber} · {sc.customerName}
                  </td>
                  <td className="py-2.5 px-3">{INTERVENTION_LABELS[sc.interventionType]}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#0052CC] dark:text-[#00D1FF]">
                    {sc.projectedRecoveryPct}%
                  </td>
                  <td className="py-2.5 px-3">
                    {sc.policyCompliant ? 'Cumple' : 'Excede Política'}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectLoan(sc.loanId);
                        setInterventionType(sc.interventionType);
                        setParams(sc.parameters);
                      }}
                      className="px-2.5 py-1 rounded-md bg-[#0052CC] hover:bg-[#0066FF] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3" /> Cargar
                    </button>
                  </td>
                </tr>
              ))}
              {savedScenarios.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-5 text-center text-slate-400">
                    Aún no se han guardado escenarios simulados en Firestore.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AlteraExplainabilityPanel explainability={comparison.explainability} />
    </div>
  );
}

export function AlteraPlanBSection({
  signals,
  canPropose,
  isReadOnlyAuditor,
  onSimulateLoan,
  onConvertSignalToRecommendation,
}: {
  signals: AlteraPreventiveSignal[];
  canPropose: boolean;
  isReadOnlyAuditor: boolean;
  onSimulateLoan: (loanId: string) => void;
  onConvertSignalToRecommendation: (signal: AlteraPreventiveSignal) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleConvert = async (sig: AlteraPreventiveSignal) => {
    if (!canPropose || isReadOnlyAuditor) return;
    setBusyId(sig.id);
    setNotice(null);
    try {
      await onConvertSignalToRecommendation(sig);
      setNotice(
        `Señal de ${sig.loanNumber} convertida en recomendación formal (Pendiente de Revisión Humana).`
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Compass className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Plan B Preventivo — Detección Temprana ({signals.length} señales)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Casos priorizados por atraso en últimas cuotas, promesas incumplidas o alertas Centinela antes del vencimiento crítico.
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
          {notice}
        </div>
      )}

      {signals.length === 0 && (
        <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-sm text-slate-500">
          No se detectan señales tempranas de deterioro en la cartera activa con los umbrales actuales.
        </div>
      )}

      <div className="space-y-3.5">
        {signals.map((sig) => (
          <div
            key={sig.id}
            className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIORITY_STYLES[sig.priority]}`}
                  >
                    PRIORIDAD {sig.priority}
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {sig.loanNumber}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    · {sig.customerName}
                  </span>
                </div>
                <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white mt-1.5">
                  {sig.situationDetected}
                </h4>
              </div>
              <div className="text-right text-xs">
                <p className="font-mono font-bold text-amber-500">
                  Deterioro {sig.deteriorationScore}/100
                </p>
                <p className="text-[11px] text-slate-500">
                  Seguimiento sugerido: {sig.suggestedFollowUpDate}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 space-y-1">
                <p className="font-bold uppercase text-[10px] text-slate-500">
                  Riesgo Detectado & Evidencia
                </p>
                <p className="text-slate-800 dark:text-slate-200">{sig.detectedRisk}</p>
                <ul className="list-disc pl-4 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  {sig.evidenceUsed.map((ev, idx) => (
                    <li key={idx}>{ev}</li>
                  ))}
                </ul>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 space-y-1">
                <p className="font-bold uppercase text-[10px] text-[#0052CC] dark:text-[#00D1FF]">
                  Plan B Recomendado ({INTERVENTION_LABELS[sig.suggestedInterventionType]})
                </p>
                <p className="text-slate-800 dark:text-slate-200">{sig.recommendedAction}</p>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 pt-1">
                  Impacto esperado: {sig.expectedImpactSummary}
                </p>
                <p className="text-[11px] text-slate-500">
                  Responsable sugerido: {sig.suggestedAssigneeName}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onSimulateLoan(sig.loanId)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-[#00B8FF]/30 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#0052CC]/25 cursor-pointer"
              >
                Abrir en Universos Alternativos
              </button>
              {canPropose && !isReadOnlyAuditor && (
                <button
                  type="button"
                  disabled={busyId === sig.id}
                  onClick={() => handleConvert(sig)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>
                    {busyId === sig.id ? 'Generando...' : 'Convertir en Recomendación Formal'}
                  </span>
                </button>
              )}
            </div>

            <AlteraExplainabilityPanel explainability={sig.explainability} />
          </div>
        ))}
      </div>
    </div>
  );
}
