import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { evaluateCreditDecisionV2 } from '../engine/decisionEngineV2';
import {
  computeInstallmentCountFromMonths,
  type AlternativeConditionsOverrideInput,
} from '../engine/integratedCreditEngine';
import {
  runHumanReevaluationAndPersist,
  sendReevaluatedApplicationToEvaluation,
} from '../services/axycoreStore';
import type { ApplicationRecord, CustomerRecord } from '../types/axycore';
import { formatMoney, formatUserFacingError } from '../utils/formatters';
import {
  LoanConditionsEditor,
  computeLoanConditionPreview,
  type LoanConditionDraft,
} from './LoanConditionsEditor';

interface ConditionAdjustmentModalProps {
  application: ApplicationRecord;
  customer: CustomerRecord | null;
  onClose: () => void;
  onSentToEvaluation: (applicationId: string, summaryMessage: string) => void;
  onSavedSimulation?: (summaryMessage: string) => void;
}

export function ConditionAdjustmentModal({
  application,
  customer,
  onClose,
  onSentToEvaluation,
  onSavedSimulation,
}: ConditionAdjustmentModalProps) {
  const { activeOrTestPolicy, financialAnalyses, userProfile } = useAxyCore();

  const existingAnalyses = useMemo(
    () =>
      financialAnalyses
        .filter((a) => a.applicationId === application.id)
        .sort((a, b) => (b.version || 0) - (a.version || 0)),
    [financialAnalyses, application.id]
  );

  // Default to Motor V2 recommended amount if available and smaller, otherwise requestedAmount
  const initialAmount =
    application.recommendedAmount &&
    application.recommendedAmount > 0 &&
    application.recommendedAmount < application.requestedAmount
      ? Math.round(application.recommendedAmount)
      : application.requestedAmount;

  const [draft, setDraft] = useState<LoanConditionDraft>({
    requestedAmount: initialAmount,
    termMonths:
      application.recommendedTermMonths && application.recommendedTermMonths > 0
        ? application.recommendedTermMonths
        : application.requestedTermMonths || 12,
    paymentFrequency: application.paymentFrequency || 'MENSUAL',
    amortizationMethod: application.amortizationMethod || 'SALDO_INSOLUTO',
    legalFeeMode: application.legalFeeMode || 'DESCONTAR_DESEMBOLSO',
  });

  const [note, setNote] = useState(
    'Condiciones ajustadas en bandeja de solicitudes según política institucional.'
  );
  const [submittingAction, setSubmittingAction] = useState<'SEND' | 'SAVE' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const preview = useMemo(
    () =>
      computeLoanConditionPreview(
        application.currency,
        draft,
        activeOrTestPolicy.exchangeRateConfig.dopPerUsd
      ),
    [application.currency, draft, activeOrTestPolicy.exchangeRateConfig.dopPerUsd]
  );

  // Instant client-side Motor V2 qualification check so user sees CALIFICA / NO CALIFICA live
  const liveDecision = useMemo(() => {
    if (!customer || preview.error || !preview.simulation) return null;
    try {
      const simApp: ApplicationRecord = {
        ...application,
        requestedAmount: draft.requestedAmount,
        requestedTermMonths: draft.termMonths,
        paymentFrequency: draft.paymentFrequency,
        amortizationMethod: draft.amortizationMethod,
        legalFeeMode: draft.legalFeeMode,
        installmentCount: preview.installmentCount,
      };
      const scoring = evaluateCreditDecisionV2({
        application: simApp,
        customer,
        policy: activeOrTestPolicy,
        useVerifiedData: false,
        executionTrigger: 'MANUAL_RERUN',
        executedBy: userProfile?.uid || 'preview',
        executedByName: userProfile?.displayName || 'Preview',
      });
      const qualifies =
        scoring.status === 'PREOFERTA' &&
        scoring.recommendedAmount >= draft.requestedAmount;
      return {
        scoring,
        qualifies,
      };
    } catch {
      return null;
    }
  }, [application, customer, draft, preview, activeOrTestPolicy, userProfile]);

  const buildAlternativeInput = (): AlternativeConditionsOverrideInput => ({
    requestedAmount: draft.requestedAmount,
    termMonths: draft.termMonths,
    installmentCount: computeInstallmentCountFromMonths(draft.termMonths, draft.paymentFrequency),
    paymentFrequency: draft.paymentFrequency,
    amortizationMethod: draft.amortizationMethod,
    useSuggestedRate: true,
    legalFeeMode: draft.legalFeeMode,
    interestOnlyPeriods: 0,
  });

  const handleSaveOnly = async () => {
    if (!userProfile || !customer) return;
    setSubmittingAction('SAVE');
    setErrorMsg(null);
    try {
      const res = await runHumanReevaluationAndPersist({
        application,
        customer,
        policy: activeOrTestPolicy,
        existingAnalyses,
        alternativeConditions: buildAlternativeInput(),
        justification:
          note.trim() ||
          'Ajuste de condiciones guardado en bandeja de solicitudes según política institucional.',
        user: userProfile,
      });
      onSavedSimulation?.(
        `${application.applicationNumber}: simulación v${res.analysis.version} guardada (${formatMoney(
          draft.requestedAmount,
          application.currency
        )} · Tasa política ${preview.policyRatePct}%).`
      );
      onClose();
    } catch (err) {
      setErrorMsg(formatUserFacingError(err, 'No se pudo guardar el ajuste de condiciones.'));
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleApplyAndSendToEvaluation = async () => {
    if (!userProfile || !customer) return;
    setSubmittingAction('SEND');
    setErrorMsg(null);
    const safeJustification =
      note.trim().length >= 10
        ? note.trim()
        : 'Condiciones ajustadas según política institucional y enviadas a Evaluación.';
    try {
      await sendReevaluatedApplicationToEvaluation({
        application,
        customer,
        policy: activeOrTestPolicy,
        existingAnalyses,
        alternativeConditions: buildAlternativeInput(),
        justification: safeJustification,
        user: userProfile,
      });
      onSentToEvaluation(
        application.id,
        `${application.applicationNumber} ajustada a ${formatMoney(
          draft.requestedAmount,
          application.currency
        )} (${draft.termMonths}m · tasa política ${preview.policyRatePct}%) y enviada directo a Evaluación.`
      );
    } catch (err) {
      setErrorMsg(
        formatUserFacingError(
          err,
          'Las condiciones actuales aún no cumplen los criterios para enviar a Evaluación.'
        )
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#030816]/70 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="axy-panel-in axy-surface relative w-full sm:max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl border border-[var(--axy-border-strong)] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="axy-infinity-line shrink-0" />

        {/* Sticky Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-[var(--axy-border)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                Cambiar Condiciones
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {application.applicationNumber} · {application.applicantDisplayName} · Solicitado
              original:{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatMoney(application.requestedAmount, application.currency)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-white/15 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {!customer ? (
            <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
              No se encontró el perfil del cliente vinculado a esta solicitud.
            </div>
          ) : (
            <>
              {/* Live Motor V2 Qualification Verdict Banner */}
              {liveDecision && (
                <div
                  className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs ${
                    liveDecision.qualifies
                      ? 'border-emerald-300/70 dark:border-emerald-500/35 bg-emerald-50/90 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                      : 'border-amber-300/70 dark:border-amber-500/35 bg-amber-50/90 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {liveDecision.qualifies ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="font-bold">
                        {liveDecision.qualifies
                          ? `Con estas condiciones: CALIFICA (Score ${liveDecision.scoring.totalScore}/100)`
                          : `Con estas condiciones: NO CALIFICA aún (Score ${liveDecision.scoring.totalScore}/100)`}
                      </p>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        {liveDecision.qualifies
                          ? 'Cumple las políticas del Motor V2. Puede aplicar los cambios y enviar directo a Evaluación.'
                          : liveDecision.scoring.recommendedAmount > 0 &&
                            liveDecision.scoring.recommendedAmount < draft.requestedAmount
                          ? `El Motor V2 sugiere reducir el monto hasta ${formatMoney(
                              liveDecision.scoring.recommendedAmount,
                              application.currency
                            )} o ampliar el plazo.`
                          : liveDecision.scoring.alerts[0] ||
                            'Ajuste el monto o el plazo para cumplir la capacidad de pago.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Policy-Driven Condition Editor */}
              <LoanConditionsEditor
                currency={application.currency}
                value={draft}
                onChange={setDraft}
                suggestedAmount={
                  liveDecision?.scoring.recommendedAmount || application.recommendedAmount || null
                }
                exchangeRate={activeOrTestPolicy.exchangeRateConfig.dopPerUsd}
                disabled={submittingAction !== null}
              />

              {/* Optional Justification Note */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Nota / Justificación del ajuste
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={submittingAction !== null}
                  placeholder="Ej. Se ajustó monto y plazo para cumplir capacidad de pago..."
                  className="axy-input w-full min-h-[44px] px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/35 text-xs text-rose-700 dark:text-rose-300">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky Footer Actions */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-[var(--axy-border)] bg-slate-50/70 dark:bg-[#050E22]/80 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submittingAction !== null}
            className="axy-btn-secondary min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cancelar
          </button>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {customer && (
              <button
                type="button"
                disabled={submittingAction !== null || Boolean(preview.error) || !userProfile}
                onClick={handleSaveOnly}
                className="axy-btn-secondary min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${submittingAction === 'SAVE' ? 'animate-spin' : ''}`}
                />
                {submittingAction === 'SAVE' ? 'Guardando...' : 'Guardar Simulación'}
              </button>
            )}

            {customer && (
              <button
                type="button"
                disabled={
                  submittingAction !== null ||
                  Boolean(preview.error) ||
                  !userProfile ||
                  !liveDecision?.qualifies
                }
                onClick={handleApplyAndSendToEvaluation}
                className="min-h-[44px] px-5 py-2 rounded-xl axy-brand-gradient text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
              >
                <span>
                  {submittingAction === 'SEND'
                    ? 'Enviando a Evaluación...'
                    : 'Aplicar y Enviar a Evaluación'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
