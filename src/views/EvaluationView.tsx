import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { DocumentOcrVerifierPanel } from '../components/DocumentOcrVerifierPanel';
import { ConfidentialDocPreviewModal } from '../components/ConfidentialDocPreviewModal';
import { ApplicationFinancialAnalysisPanel } from '../components/ApplicationFinancialAnalysisPanel';
import {
  LoanConditionsEditor,
  computeLoanConditionPreview,
  type LoanConditionDraft,
} from '../components/LoanConditionsEditor';
import {
  generateId,
  recordConfidentialDocumentAccess,
  saveAnalystEvaluationAndRecalc,
  saveEvaluationConditionsAdjustment,
  saveRiskOfficerSignOff,
  updateDocumentReviewStatus,
} from '../services/axycoreStore';
import {
  APPLICATION_STATUS_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatUserFacingError,
} from '../utils/formatters';
import type {
  ApplicationDocumentRecord,
  CreditEvaluationRecord,
  RiskOpinionStatus,
} from '../types/axycore';

export function EvaluationView() {
  const {
    applications,
    customers,
    businesses,
    scoringExecutions,
    evaluations,
    documents,
    activeOrTestPolicy,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const [previewDoc, setPreviewDoc] = useState<ApplicationDocumentRecord | null>(null);

  // Collapsible secondary panels so mobile & desktop stay clean and fast
  const [showAmortizationPanel, setShowAmortizationPanel] = useState(false);
  const [showDocumentsOcr, setShowDocumentsOcr] = useState(false);
  const [showRiskPanel, setShowRiskPanel] = useState(userProfile?.role === 'RISK_OFFICER');

  const evalInbox = useMemo(
    () =>
      applications
        .filter((a) => ['EN_EVALUACION', 'DEVUELTA', 'RECIBIDA'].includes(a.status))
        .sort((a, b) => {
          const priority = (s: string) => (s === 'EN_EVALUACION' ? 0 : s === 'DEVUELTA' ? 1 : 2);
          const diff = priority(a.status) - priority(b.status);
          return diff !== 0 ? diff : b.applicationNumber.localeCompare(a.applicationNumber);
        }),
    [applications]
  );

  const activeApp = useMemo(() => {
    if (selectedApplicationId) {
      const found = evalInbox.find((a) => a.id === selectedApplicationId);
      if (found) return found;
    }
    return evalInbox[0] ?? null;
  }, [evalInbox, selectedApplicationId]);

  const customer = useMemo(
    () => (activeApp ? customers.find((c) => c.id === activeApp.customerId) ?? null : null),
    [activeApp, customers]
  );

  const business = useMemo(
    () => (activeApp?.businessId ? businesses.find((b) => b.id === activeApp.businessId) ?? null : null),
    [activeApp, businesses]
  );

  const appExecutions = useMemo(
    () =>
      activeApp
        ? scoringExecutions
            .filter((s) => s.applicationId === activeApp.id)
            .sort((a, b) => String(a.executedAt ?? '').localeCompare(String(b.executedAt ?? '')))
        : [],
    [activeApp, scoringExecutions]
  );

  const preliminaryExec = appExecutions[0] ?? null;
  const latestExec = appExecutions[appExecutions.length - 1] ?? null;

  const existingEval = useMemo(
    () => (activeApp ? evaluations.find((e) => e.applicationId === activeApp.id) ?? null : null),
    [activeApp, evaluations]
  );

  const appDocs = useMemo(
    () => (activeApp ? documents.filter((d) => d.applicationId === activeApp.id) : []),
    [activeApp, documents]
  );

  // Policy-driven editable loan conditions
  const [conditionDraft, setConditionDraft] = useState<LoanConditionDraft>({
    requestedAmount: 0,
    termMonths: 12,
    paymentFrequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    legalFeeMode: 'DESCONTAR_DESEMBOLSO',
  });
  const [applyingConditions, setApplyingConditions] = useState(false);

  // Verified editable financials (never overwrites original declared financialData!)
  const [verPrimaryIncome, setVerPrimaryIncome] = useState<string>('');
  const [verAddIncome, setVerAddIncome] = useState<string>('');
  const [verExpenses, setVerExpenses] = useState<string>('');
  const [verDebtPayments, setVerDebtPayments] = useState<string>('');
  const [verNetBizFlow, setVerNetBizFlow] = useState<string>('');

  const [identityVerified, setIdentityVerified] = useState(false);
  const [incomeVerified, setIncomeVerified] = useState(false);
  const [obligationsVerified, setObligationsVerified] = useState(false);
  const [referencesVerified, setReferencesVerified] = useState(false);
  const [addressVerified, setAddressVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [socialMediaVerified, setSocialMediaVerified] = useState(false);

  const [findings, setFindings] = useState('');
  const [observations, setObservations] = useState('');
  const [technicalReport, setTechnicalReport] = useState('');
  const [recommendedDecision, setRecommendedDecision] =
    useState<CreditEvaluationRecord['recommendedDecision']>('APROBAR');
  const [recConditions, setRecConditions] = useState('');
  const [justification, setJustification] = useState('');

  // Independent Risk Officer review state
  const [riskOpinionStatus, setRiskOpinionStatus] = useState<RiskOpinionStatus>('PENDIENTE');
  const [riskOpinionNotes, setRiskOpinionNotes] = useState('');
  const [recalcOnRiskSave, setRecalcOnRiskSave] = useState(true);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!activeApp) return;
    setConditionDraft({
      requestedAmount: activeApp.requestedAmount,
      termMonths: activeApp.requestedTermMonths || 12,
      paymentFrequency: activeApp.paymentFrequency || 'MENSUAL',
      amortizationMethod: activeApp.amortizationMethod || 'SALDO_INSOLUTO',
      legalFeeMode: activeApp.legalFeeMode || 'DESCONTAR_DESEMBOLSO',
    });

    const baseFin = activeApp.verifiedFinancialData ?? activeApp.financialData;
    const baseBiz = activeApp.verifiedBusinessFinancialData ?? activeApp.businessFinancialData;
    setVerPrimaryIncome(String(baseFin.primaryNetIncome ?? ''));
    setVerAddIncome(String(baseFin.additionalNetIncome ?? 0));
    setVerExpenses(String(baseFin.essentialExpenses ?? ''));
    setVerDebtPayments(String(baseFin.currentDebtPayments ?? 0));
    setVerNetBizFlow(String(baseBiz?.netMonthlyFlow ?? ''));

    if (existingEval) {
      setIdentityVerified(existingEval.identityVerified);
      setIncomeVerified(existingEval.incomeVerified);
      setObligationsVerified(existingEval.obligationsVerified);
      setReferencesVerified(existingEval.referencesVerified);
      setAddressVerified(Boolean(existingEval.addressVerified));
      setPhoneVerified(Boolean(existingEval.phoneVerified));
      setSocialMediaVerified(Boolean(existingEval.socialMediaVerified));
      setFindings(existingEval.findings);
      setObservations(existingEval.observations);
      setTechnicalReport(existingEval.technicalReport);
      setRecommendedDecision(existingEval.recommendedDecision);
      setRecConditions(existingEval.recommendedConditions ?? '');
      setJustification(existingEval.justification ?? '');
      setRiskOpinionStatus(existingEval.riskOpinionStatus ?? 'PENDIENTE');
      setRiskOpinionNotes(existingEval.riskOpinionNotes ?? '');
    } else {
      setIdentityVerified(false);
      setIncomeVerified(false);
      setObligationsVerified(false);
      setReferencesVerified(false);
      setAddressVerified(false);
      setPhoneVerified(false);
      setSocialMediaVerified(false);
      setFindings('');
      setObservations('');
      setTechnicalReport('');
      setRecommendedDecision('APROBAR');
      setRecConditions('');
      setJustification('');
      setRiskOpinionStatus('PENDIENTE');
      setRiskOpinionNotes('');
    }
    setFeedback(null);
  }, [activeApp?.id, existingEval?.id]);

  const conditionPreview = useMemo(
    () =>
      activeApp
        ? computeLoanConditionPreview(
            activeApp.currency,
            conditionDraft,
            activeOrTestPolicy.exchangeRateConfig.dopPerUsd
          )
        : null,
    [activeApp, conditionDraft, activeOrTestPolicy.exchangeRateConfig.dopPerUsd]
  );

  const conditionsDirty = useMemo(() => {
    if (!activeApp) return false;
    return (
      Math.abs(conditionDraft.requestedAmount - activeApp.requestedAmount) >= 0.01 ||
      conditionDraft.termMonths !== (activeApp.requestedTermMonths || 12) ||
      conditionDraft.paymentFrequency !== (activeApp.paymentFrequency || 'MENSUAL') ||
      conditionDraft.amortizationMethod !== (activeApp.amortizationMethod || 'SALDO_INSOLUTO') ||
      conditionDraft.legalFeeMode !== (activeApp.legalFeeMode || 'DESCONTAR_DESEMBOLSO')
    );
  }, [activeApp, conditionDraft]);

  const workflowAccess = useMemo(() => {
    if (!activeApp) return null;
    return rbac.getWorkflowAccess({
      application: activeApp,
      evaluation: existingEval,
    });
  }, [activeApp, existingEval, rbac]);

  const canEditAnalystSection = Boolean(workflowAccess?.canEditVerifiedFinancials.allowed);
  const canVerifyDocs = Boolean(workflowAccess?.canVerifyDocuments.allowed);
  const canIssueRiskOpinion = Boolean(workflowAccess?.canIssueRiskOpinion.allowed);

  const clientDepurationComplete =
    referencesVerified && addressVerified && phoneVerified && socialMediaVerified;

  const handleApplyConditionsOnly = async () => {
    if (!activeApp || !userProfile || !customer) return;
    if (!canEditAnalystSection) {
      setFeedback({
        type: 'err',
        msg:
          workflowAccess?.canEditVerifiedFinancials.reason ||
          'Solo un Analista de Créditos o Administrador puede ajustar las condiciones.',
      });
      return;
    }
    if (!conditionPreview || conditionPreview.error) {
      setFeedback({
        type: 'err',
        msg: conditionPreview?.error || 'Verifica los valores de las condiciones del préstamo.',
      });
      return;
    }

    setApplyingConditions(true);
    setFeedback(null);
    try {
      const res = await saveEvaluationConditionsAdjustment({
        application: activeApp,
        customer,
        policy: activeOrTestPolicy,
        adjustedConditions: conditionDraft,
        justification: justification.trim() || undefined,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `Condiciones actualizadas según política vigente: ${formatMoney(
          conditionDraft.requestedAmount,
          activeApp.currency
        )} · ${conditionDraft.termMonths} meses · Tasa política ${res.policyRatePct}% · Gastos legales ${formatMoney(
          res.policyLegalFees,
          activeApp.currency
        )} (${
          conditionDraft.legalFeeMode === 'FINANCIAR' ? 'agregados al préstamo' : 'descontados del desembolso'
        }) · Score Motor V2: ${res.newScoring.totalScore}/100.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudieron guardar las nuevas condiciones del préstamo.'),
      });
    } finally {
      setApplyingConditions(false);
    }
  };

  const handleSaveEvaluation = async (mode: 'RECALC_ONLY' | 'TO_COMMITTEE' | 'RETURN') => {
    if (!activeApp || !userProfile) return;
    if (!customer) {
      setFeedback({
        type: 'err',
        msg: 'No se encontró la ficha del cliente vinculada a esta solicitud. Verifica el expediente en clientes antes de evaluar.',
      });
      return;
    }
    if (!canEditAnalystSection) {
      setFeedback({
        type: 'err',
        msg:
          workflowAccess?.canEditVerifiedFinancials.reason ||
          'Solo un Analista de Créditos o Administrador puede registrar evaluaciones.',
      });
      return;
    }

    if (mode === 'TO_COMMITTEE' && !clientDepurationComplete) {
      setFeedback({
        type: 'err',
        msg: 'Debe confirmar todo el Checklist de Depuración del Cliente (Referencias, Dirección, Teléfono y Redes Sociales) antes de enviar a Comité.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const verifiedFin = {
        ...activeApp.financialData,
        primaryNetIncome: verPrimaryIncome !== '' ? Number(verPrimaryIncome) : null,
        additionalNetIncome: verAddIncome !== '' ? Number(verAddIncome) : 0,
        essentialExpenses: verExpenses !== '' ? Number(verExpenses) : null,
        currentDebtPayments: verDebtPayments !== '' ? Number(verDebtPayments) : 0,
        debtDeclarationStatus:
          Number(verDebtPayments || 0) > 0
            ? ('HAS_DEBTS' as const)
            : activeApp.financialData.debtDeclarationStatus,
      };

      const verifiedBiz = activeApp.businessFinancialData
        ? {
            ...activeApp.businessFinancialData,
            netMonthlyFlow: verNetBizFlow !== '' ? Number(verNetBizFlow) : null,
          }
        : null;

      const evalRecord: Omit<CreditEvaluationRecord, 'createdAt' | 'updatedAt'> = {
        id: existingEval?.id ?? generateId('eval'),
        organizationId: activeApp.organizationId,
        applicationId: activeApp.id,
        analystId: userProfile.uid,
        analystName: userProfile.displayName,
        declaredSnapshot: {
          financialData: activeApp.financialData,
          businessFinancialData: activeApp.businessFinancialData ?? null,
        },
        verifiedSnapshot: {
          financialData: verifiedFin,
          businessFinancialData: verifiedBiz,
        },
        preliminaryScoringId: preliminaryExec?.id ?? null,
        updatedScoringId: latestExec?.id ?? null,
        identityVerified,
        incomeVerified,
        obligationsVerified,
        referencesVerified,
        addressVerified,
        phoneVerified,
        socialMediaVerified,
        findings: findings.trim(),
        observations: observations.trim(),
        technicalReport: technicalReport.trim(),
        recommendedDecision,
        recommendedAmount: conditionDraft.requestedAmount > 0 ? conditionDraft.requestedAmount : null,
        recommendedRateMonthly:
          conditionPreview && conditionPreview.policyRateDecimal > 0
            ? conditionPreview.policyRateDecimal
            : null,
        recommendedTermMonths: conditionDraft.termMonths > 0 ? conditionDraft.termMonths : null,
        recommendedConditions: recConditions.trim(),
        justification: justification.trim(),
        status: mode === 'RECALC_ONLY' ? 'BORRADOR' : 'COMPLETADA',
      };

      const res = await saveAnalystEvaluationAndRecalc({
        application: activeApp,
        customer,
        policy: activeOrTestPolicy,
        evaluation: evalRecord,
        adjustedConditions: conditionDraft,
        sendToCommittee: mode === 'TO_COMMITTEE',
        returnToApplicant: mode === 'RETURN',
        user: userProfile,
      });

      setFeedback({
        type: 'ok',
        msg:
          mode === 'TO_COMMITTEE'
            ? `Evaluación y condiciones guardadas, Motor V2 recalculado (Score ${res.newScoring.totalScore}/100) y enviada al Comité de Crédito.`
            : mode === 'RETURN'
            ? 'Expediente devuelto para información adicional y recálculo registrado.'
            : `Evaluación y condiciones guardadas según política vigente (Score ${res.newScoring.totalScore}/100).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'Error guardando la evaluación.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRiskOpinion = async (action: 'SAVE_ONLY' | 'ESCALATE_COMMITTEE' | 'RETURN') => {
    if (!activeApp || !userProfile) return;
    if (!customer) {
      setFeedback({
        type: 'err',
        msg: 'No se encontró la ficha del cliente vinculada a esta solicitud para emitir el dictamen de riesgo.',
      });
      return;
    }
    if (!canIssueRiskOpinion) {
      setFeedback({
        type: 'err',
        msg:
          workflowAccess?.canIssueRiskOpinion.reason ||
          'Solo el Oficial de Riesgo o Administrador puede emitir el dictamen de riesgo.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const res = await saveRiskOfficerSignOff({
        application: activeApp,
        customer,
        policy: activeOrTestPolicy,
        existingEvaluation: existingEval,
        riskOpinionStatus,
        riskOpinionNotes,
        recalculateScoring: recalcOnRiskSave,
        action,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg:
          action === 'ESCALATE_COMMITTEE'
            ? `Dictamen de riesgo (${riskOpinionStatus}) registrado y expediente escalado al Comité de Crédito.`
            : action === 'RETURN'
            ? `Expediente devuelto con observaciones del Oficial de Riesgo (${riskOpinionStatus}).`
            : `Dictamen de riesgo (${riskOpinionStatus}) guardado${res.newScoring ? ` con recálculo V2 (${res.newScoring.totalScore}/100)` : ''}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'Error registrando el dictamen de riesgo.'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (evalInbox.length === 0) {
    return (
      <div className="axy-surface p-8 rounded-2xl text-center space-y-3">
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
          Bandeja de Evaluación vacía
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No hay solicitudes pendientes de evaluación en este momento.
        </p>
        <button
          type="button"
          onClick={() => setActiveSection('applications')}
          className="axy-btn-primary min-h-[44px] px-5 py-2 text-xs cursor-pointer"
        >
          Ir a Solicitudes Recibidas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mobile Compact Queue Selector (replaces long vertical stack on phones) */}
      <div className="lg:hidden axy-surface p-3.5 rounded-2xl space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-900 dark:text-white">
            Expediente en Evaluación ({evalInbox.length})
          </span>
          <span className="text-slate-500 font-mono">
            {activeApp?.applicationNumber}
          </span>
        </div>
        <select
          value={activeApp?.id ?? ''}
          onChange={(e) => setSelectedApplicationId(e.target.value)}
          className="axy-input w-full min-h-[44px] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
        >
          {evalInbox.map((app) => (
            <option key={app.id} value={app.id}>
              {app.applicantDisplayName} · {formatMoney(app.requestedAmount, app.currency)} · Score{' '}
              {app.latestScore ?? '—'}/100 ({APPLICATION_STATUS_LABELS[app.status]})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Desktop Left Queue */}
        <div className="hidden lg:block lg:col-span-4 space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            En Evaluación ({evalInbox.length})
          </h2>
          <div className="space-y-2 max-h-[calc(100vh-190px)] overflow-y-auto pr-1">
            {evalInbox.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedApplicationId(app.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                  activeApp?.id === app.id
                    ? 'border-[#0066FF] bg-[#0066FF]/[0.06] dark:bg-[#0066FF]/16 dark:border-[#00B8FF]'
                    : 'axy-surface hover:bg-slate-50/90 dark:hover:bg-[#0E1D40]/70'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>{app.applicationNumber}</span>
                  <span>Score {app.latestScore ?? '—'}/100</span>
                </div>
                <p className="font-semibold text-sm text-slate-900 dark:text-white mt-1 truncate">
                  {app.applicantDisplayName}
                </p>
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mt-1">
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(app.requestedAmount, app.currency)}
                  </span>
                  <span className="text-[11px]">{APPLICATION_STATUS_LABELS[app.status]}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main Evaluation Workspace */}
        {activeApp && (
          <div className="lg:col-span-8 space-y-4">
            {/* Compact Header + Score Summary */}
            <div className="axy-surface p-4 sm:p-5 rounded-2xl space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display text-base sm:text-lg font-bold text-slate-950 dark:text-white truncate">
                    {activeApp.applicantDisplayName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {activeApp.applicationNumber} · {customer?.documentType || 'Doc'}{' '}
                    {customer?.documentNumber || '—'} · {APPLICATION_STATUS_LABELS[activeApp.status]}
                  </p>
                </div>
                <span className="text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">
                  {activeApp.prequalificationStatus
                    ? SCORING_STATUS_LABELS[activeApp.prequalificationStatus]
                    : 'Motor V2'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2.5 border-t border-slate-200/80 dark:border-white/10 text-xs">
                <div>
                  <p className="text-[11px] text-slate-500">Score Motor V2</p>
                  <p className="font-mono text-base font-bold tabular-nums text-slate-950 dark:text-white">
                    {latestExec ? `${latestExec.totalScore}/100` : `${activeApp.latestScore ?? '—'}/100`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Banda de Riesgo</p>
                  <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {latestExec?.riskBand.label ?? activeApp.latestRiskBand ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Monto Sugerido</p>
                  <p className="font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                    {formatMoney(
                      latestExec?.recommendedAmount ?? activeApp.recommendedAmount ?? 0,
                      activeApp.currency
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Tasa Política Actual</p>
                  <p className="font-mono font-bold tabular-nums text-[#0052CC] dark:text-[#00D1FF] mt-0.5">
                    {conditionPreview && !conditionPreview.error
                      ? `${conditionPreview.policyRatePct}%/mes`
                      : formatRatePct(activeApp.recommendedRateMonthly)}
                  </p>
                </div>
              </div>
            </div>

            {feedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs ${
                  feedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                }`}
              >
                {feedback.msg}
              </div>
            )}

            {/* SECTION 1: Condiciones del Préstamo (Tarjetas Apiladas adaptables a móvil y escritorio) */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
                <div className="flex items-start gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-display text-sm sm:text-base font-bold text-slate-950 dark:text-white">
                      1. Condiciones del Préstamo
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Ajusta monto, plazo, frecuencia, tipo de tasa y gastos legales. La tasa y los gastos legales se aplican según política vigente.
                    </p>
                  </div>
                </div>
                {!canEditAnalystSection && (
                  <span className="text-xs text-slate-500">Solo lectura · {rbac.roleLabel}</span>
                )}
              </div>

              <LoanConditionsEditor
                variant="stacked"
                currency={activeApp.currency}
                value={conditionDraft}
                onChange={setConditionDraft}
                suggestedAmount={latestExec?.recommendedAmount ?? activeApp.recommendedAmount ?? null}
                exchangeRate={activeOrTestPolicy.exchangeRateConfig.dopPerUsd}
                disabled={!canEditAnalystSection || applyingConditions || saving}
                footerAction={
                  canEditAnalystSection ? (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {conditionsDirty
                          ? 'Cambios pendientes por guardar y recalcular.'
                          : 'Condiciones sincronizadas con el expediente actual.'}
                      </span>
                      <button
                        type="button"
                        disabled={
                          applyingConditions ||
                          saving ||
                          !customer ||
                          Boolean(conditionPreview?.error)
                        }
                        onClick={handleApplyConditionsOnly}
                        className="w-full sm:w-auto min-h-[46px] px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 shrink-0 ${applyingConditions ? 'animate-spin' : ''}`}
                        />
                        {applyingConditions
                          ? 'Aplicando y Recalculando...'
                          : 'Aplicar Condiciones y Recalcular'}
                      </button>
                    </div>
                  ) : undefined
                }
              />
            </section>

            {/* SECTION 2: Depuración Financiera y Checklist del Cliente */}
            <div className="axy-surface p-4 sm:p-5 rounded-2xl space-y-4 text-xs">
              <div>
                <h4 className="font-display text-sm sm:text-base font-bold text-slate-950 dark:text-white">
                  2. Verificación del Cliente y Datos Financieros
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Confirma los datos verificados y completa el checklist obligatorio para pasar a Comité.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="axy-surface-tonal space-y-1.5 p-3.5 rounded-xl">
                  <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Declarado por el Cliente (Original)
                  </p>
                  <p className="font-mono tabular-nums">
                    Ingreso principal:{' '}
                    <strong>
                      {activeApp.financialData.primaryNetIncome !== null &&
                      activeApp.financialData.primaryNetIncome !== undefined
                        ? formatMoney(activeApp.financialData.primaryNetIncome, activeApp.currency)
                        : 'N/D'}
                    </strong>
                  </p>
                  <p className="font-mono tabular-nums">
                    Ingresos adicionales:{' '}
                    {formatMoney(activeApp.financialData.additionalNetIncome ?? 0, activeApp.currency)}
                  </p>
                  <p className="font-mono tabular-nums">
                    Gastos esenciales:{' '}
                    {activeApp.financialData.essentialExpenses !== null &&
                    activeApp.financialData.essentialExpenses !== undefined
                      ? formatMoney(activeApp.financialData.essentialExpenses, activeApp.currency)
                      : 'N/D'}
                  </p>
                  <p className="font-mono tabular-nums">
                    Cuotas de deudas:{' '}
                    {formatMoney(activeApp.financialData.currentDebtPayments ?? 0, activeApp.currency)}
                  </p>
                  {activeApp.businessFinancialData && (
                    <p className="font-mono tabular-nums">
                      Flujo neto empresa:{' '}
                      {activeApp.businessFinancialData.netMonthlyFlow !== null &&
                      activeApp.businessFinancialData.netMonthlyFlow !== undefined
                        ? formatMoney(activeApp.businessFinancialData.netMonthlyFlow, activeApp.currency)
                        : 'N/D'}
                    </p>
                  )}
                </div>

                <div className="space-y-2.5">
                  <p className="font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                    Datos Verificados por Analista
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Ingreso Principal</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEditAnalystSection}
                        value={verPrimaryIncome}
                        onChange={(e) => setVerPrimaryIncome(e.target.value)}
                        className="axy-input w-full min-h-[44px] px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Ing. Adicionales</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEditAnalystSection}
                        value={verAddIncome}
                        onChange={(e) => setVerAddIncome(e.target.value)}
                        className="axy-input w-full min-h-[44px] px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Gastos Esenciales</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEditAnalystSection}
                        value={verExpenses}
                        onChange={(e) => setVerExpenses(e.target.value)}
                        className="axy-input w-full min-h-[44px] px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Cuotas Deudas</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={!canEditAnalystSection}
                        value={verDebtPayments}
                        onChange={(e) => setVerDebtPayments(e.target.value)}
                        className="axy-input w-full min-h-[44px] px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                    {activeApp.businessFinancialData && (
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Flujo Neto Empresa Verificado
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          disabled={!canEditAnalystSection}
                          value={verNetBizFlow}
                          onChange={(e) => setVerNetBizFlow(e.target.value)}
                          className="axy-input w-full min-h-[44px] px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {customer && (
                <div className="axy-surface-tonal p-3.5 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Dirección</span>
                    <span className="text-slate-900 dark:text-slate-100">
                      {customer.address || 'No declarada'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Teléfono(s)</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {customer.phone || '—'} {customer.altPhone ? `· Alt: ${customer.altPhone}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Redes sociales</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {customer.socialMediaHandle ||
                        (customer.socialMediaDeclared === 'YES'
                          ? 'Declarada sin usuario'
                          : 'No declaradas')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">
                      Referencias ({activeApp.references?.length ?? 0})
                    </span>
                    <span className="text-slate-900 dark:text-slate-100">
                      {activeApp.references && activeApp.references.length > 0
                        ? activeApp.references
                            .map((r) => `${r.name} (${r.relationship}: ${r.phone})`)
                            .join(' · ')
                        : 'Sin referencias registradas'}
                    </span>
                  </div>
                </div>
              )}

              {/* Touch-Friendly Mandatory Checklist */}
              <div className="space-y-2 pt-1">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Checklist de Depuración (Obligatorio para Enviar a Comité)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    {
                      label: 'Referencias confirmadas *',
                      checked: referencesVerified,
                      onChange: setReferencesVerified,
                    },
                    {
                      label: 'Dirección confirmada *',
                      checked: addressVerified,
                      onChange: setAddressVerified,
                    },
                    {
                      label: 'Teléfono confirmado *',
                      checked: phoneVerified,
                      onChange: setPhoneVerified,
                    },
                    {
                      label: 'Redes sociales confirmadas *',
                      checked: socialMediaVerified,
                      onChange: setSocialMediaVerified,
                    },
                  ].map((item) => (
                    <label
                      key={item.label}
                      className={`min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                        item.checked
                          ? 'border-emerald-300/80 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-900 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-white/12 bg-slate-50/60 dark:bg-white/[0.03] text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canEditAnalystSection}
                        checked={item.checked}
                        onChange={(e) => item.onChange(e.target.checked)}
                        className="w-4 h-4 accent-[#0066FF]"
                      />
                      <span className="font-medium">{item.label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-wrap gap-4 pt-1.5 text-slate-600 dark:text-slate-300">
                  <label className="min-h-[36px] inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={identityVerified}
                      onChange={(e) => setIdentityVerified(e.target.checked)}
                      className="w-4 h-4 accent-[#0066FF]"
                    />
                    <span>Identidad verificada</span>
                  </label>
                  <label className="min-h-[36px] inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={incomeVerified}
                      onChange={(e) => setIncomeVerified(e.target.checked)}
                      className="w-4 h-4 accent-[#0066FF]"
                    />
                    <span>Ingresos confirmados</span>
                  </label>
                  <label className="min-h-[36px] inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={obligationsVerified}
                      onChange={(e) => setObligationsVerified(e.target.checked)}
                      className="w-4 h-4 accent-[#0066FF]"
                    />
                    <span>Obligaciones revisadas</span>
                  </label>
                </div>
              </div>
            </div>

            {/* SECTION 3: Informe Técnico y Envío a Comité */}
            <div className="axy-surface p-4 sm:p-5 rounded-2xl space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display text-sm sm:text-base font-bold text-slate-950 dark:text-white">
                  3. Recomendación y Envío a Comité
                </h4>
                {!canEditAnalystSection && (
                  <span className="text-slate-500 dark:text-slate-400">
                    {workflowAccess?.canEditVerifiedFinancials.reason}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-semibold text-slate-700 dark:text-slate-200">
                    Recomendación Analítica
                  </label>
                  <select
                    disabled={!canEditAnalystSection}
                    value={recommendedDecision}
                    onChange={(e) =>
                      setRecommendedDecision(
                        e.target.value as CreditEvaluationRecord['recommendedDecision']
                      )
                    }
                    className="axy-input w-full min-h-[44px] px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                  >
                    <option value="APROBAR">Aprobar con condiciones configuradas</option>
                    <option value="MODIFICAR">Aprobar con condiciones modificadas</option>
                    <option value="DEVOLVER">Devolver por información adicional</option>
                    <option value="RECHAZAR">Rechazar solicitud</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 font-semibold text-slate-700 dark:text-slate-200">
                    Justificación / Nota de Condiciones
                  </label>
                  <input
                    type="text"
                    disabled={!canEditAnalystSection}
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Motivo del ajuste o recomendación..."
                    className="axy-input w-full min-h-[44px] px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 text-slate-600 dark:text-slate-300">
                    Hallazgos de Depuración
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEditAnalystSection}
                    value={findings}
                    onChange={(e) => setFindings(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-600 dark:text-slate-300">
                    Informe Técnico para Comité
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEditAnalystSection}
                    value={technicalReport}
                    onChange={(e) => setTechnicalReport(e.target.value)}
                    placeholder="Resumen de capacidad de pago, estabilidad y mitigantes..."
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Touch-Friendly Action Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10">
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    disabled={saving || applyingConditions || !canEditAnalystSection}
                    onClick={() => handleSaveEvaluation('RECALC_ONLY')}
                    className="axy-btn-secondary min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer disabled:opacity-45"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Guardar Borrador
                  </button>
                  <button
                    type="button"
                    disabled={saving || applyingConditions || !canEditAnalystSection}
                    onClick={() => handleSaveEvaluation('RETURN')}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300 font-semibold cursor-pointer disabled:opacity-45"
                  >
                    Devolver
                  </button>
                </div>

                <button
                  type="button"
                  disabled={saving || applyingConditions || !canEditAnalystSection}
                  onClick={() => handleSaveEvaluation('TO_COMMITTEE')}
                  className="axy-btn-primary min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold cursor-pointer disabled:opacity-45"
                >
                  <Send className="w-4 h-4" />
                  {saving ? 'Procesando...' : 'Enviar a Comité'}
                </button>
              </div>
            </div>

            {/* COLLAPSIBLE SECONDARY PANEL 1: Tabla de Amortización y Análisis Financiero */}
            <div className="axy-surface rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAmortizationPanel((v) => !v)}
                className="w-full min-h-[52px] px-4 sm:px-5 py-3 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">
                    Tabla de Amortización y Análisis Financiero Detallado
                  </span>
                </div>
                {showAmortizationPanel ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {showAmortizationPanel && (
                <div className="px-4 sm:px-5 pb-5 border-t border-slate-200/80 dark:border-white/10 pt-4">
                  <ApplicationFinancialAnalysisPanel
                    application={activeApp}
                    customer={customer}
                    mode="EVALUATION"
                  />
                </div>
              )}
            </div>

            {/* COLLAPSIBLE SECONDARY PANEL 2: Documentos y Verificador OCR */}
            <div className="axy-surface rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDocumentsOcr((v) => !v)}
                className="w-full min-h-[52px] px-4 sm:px-5 py-3 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">
                    Documentos del Expediente ({appDocs.length}) y Verificador OCR
                  </span>
                </div>
                {showDocumentsOcr ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {showDocumentsOcr && (
                <div className="px-4 sm:px-5 pb-5 border-t border-slate-200/80 dark:border-white/10 pt-4 space-y-4">
                  {appDocs.length > 0 ? (
                    <div className="space-y-2 text-xs">
                      {appDocs.map((d) => (
                        <div
                          key={d.id}
                          className="axy-surface-tonal flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl"
                        >
                          <span className="truncate font-mono">
                            [{d.category}] {d.fileName}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {d.fileDataUrl && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreviewDoc(d);
                                    if (userProfile) {
                                      void recordConfidentialDocumentAccess({
                                        document: d,
                                        accessType: 'PREVIEW',
                                        user: userProfile,
                                        applicationNumber: activeApp.applicationNumber,
                                      }).catch(() => {});
                                    }
                                  }}
                                  className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!d.fileDataUrl) return;
                                    if (userProfile) {
                                      void recordConfidentialDocumentAccess({
                                        document: d,
                                        accessType: 'DOWNLOAD',
                                        user: userProfile,
                                        applicationNumber: activeApp.applicationNumber,
                                      }).catch(() => {});
                                    }
                                    const link = document.createElement('a');
                                    link.href = d.fileDataUrl;
                                    link.download = d.fileName;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                  }}
                                  className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-[#0066FF] dark:text-[#00D1FF] cursor-pointer"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Descargar
                                </button>
                              </>
                            )}
                            <select
                              disabled={!canVerifyDocs}
                              value={d.reviewStatus}
                              onChange={(e) =>
                                userProfile &&
                                canVerifyDocs &&
                                updateDocumentReviewStatus({
                                  docId: d.id,
                                  reviewStatus: e.target.value as typeof d.reviewStatus,
                                  notes: `Revisado por ${rbac.roleLabel}`,
                                  reviewerId: userProfile.uid,
                                  user: userProfile,
                                  organizationId: d.organizationId,
                                  previousStatus: d.reviewStatus,
                                  fileName: d.fileName,
                                  category: d.category,
                                  applicationId: d.applicationId,
                                })
                              }
                              className="axy-input px-2 py-1.5 text-slate-900 dark:text-white disabled:opacity-60"
                            >
                              <option value="RECIBIDO">Recibido</option>
                              <option value="VERIFICADO">Verificado</option>
                              <option value="OBSERVADO">Observado</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No hay documentos adjuntos en este expediente todavía.
                    </p>
                  )}

                  <DocumentOcrVerifierPanel
                    application={activeApp}
                    customer={customer}
                    business={business}
                    documents={appDocs}
                    canVerifyDocs={canVerifyDocs}
                    canEditAnalystSection={canEditAnalystSection}
                    userProfile={userProfile}
                    isReadOnlyAuditor={rbac.isReadOnlyAuditor}
                    onApplyExtractedFinancials={({
                      primaryNetIncome,
                      currentDebtPayments,
                      markIncomeVerified,
                      markIdentityVerified,
                      findingsSnippet,
                    }) => {
                      if (!canEditAnalystSection) return;
                      if (primaryNetIncome !== null && primaryNetIncome !== undefined) {
                        setVerPrimaryIncome(String(primaryNetIncome));
                      }
                      if (currentDebtPayments !== null && currentDebtPayments !== undefined) {
                        setVerDebtPayments(String(currentDebtPayments));
                      }
                      if (markIncomeVerified) setIncomeVerified(true);
                      if (markIdentityVerified) setIdentityVerified(true);
                      if (findingsSnippet) {
                        setFindings((prev) =>
                          prev.includes(findingsSnippet)
                            ? prev
                            : prev.trim()
                            ? `${prev.trim()}\n${findingsSnippet}`
                            : findingsSnippet
                        );
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* COLLAPSIBLE SECONDARY PANEL 3: Dictamen Independiente de Riesgo (Segunda Línea) */}
            <div className="axy-surface rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowRiskPanel((v) => !v)}
                className="w-full min-h-[52px] px-4 sm:px-5 py-3 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">
                    Dictamen Independiente de Riesgo (Segunda Línea)
                  </span>
                </div>
                {showRiskPanel ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {showRiskPanel && (
                <div className="px-4 sm:px-5 pb-5 border-t border-slate-200/80 dark:border-white/10 pt-4 space-y-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-slate-500 dark:text-slate-400">
                      {existingEval?.riskOfficerName
                        ? `Última revisión por ${existingEval.riskOfficerName} · Estado: ${existingEval.riskOpinionStatus ?? 'PENDIENTE'}`
                        : 'Facultad exclusiva de Oficial de Riesgo o Administrador para validar mitigantes y escalar o devolver.'}
                    </p>
                    {!canIssueRiskOpinion && (
                      <span className="text-slate-500 dark:text-slate-400">
                        {workflowAccess?.canIssueRiskOpinion.reason}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-slate-500">Dictamen de Riesgo</label>
                      <select
                        disabled={!canIssueRiskOpinion}
                        value={riskOpinionStatus}
                        onChange={(e) => setRiskOpinionStatus(e.target.value as RiskOpinionStatus)}
                        className="axy-input w-full min-h-[42px] px-2.5 py-1.5 text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        <option value="PENDIENTE">Pendiente de revisión</option>
                        <option value="CONFORME">Conforme con el riesgo</option>
                        <option value="CON_OBSERVACIONES">Conforme con observaciones</option>
                        <option value="RECHAZO_RIESGO">Objeción crítica de riesgo</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 flex items-end">
                      <label className="inline-flex items-center gap-2 cursor-pointer pb-2">
                        <input
                          type="checkbox"
                          disabled={!canIssueRiskOpinion}
                          checked={recalcOnRiskSave}
                          onChange={(e) => setRecalcOnRiskSave(e.target.checked)}
                          className="w-4 h-4 accent-[#0066FF]"
                        />
                        <span>Ejecutar verificación Motor V2 (estrés y capacidad) al guardar</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-500">Observaciones y Mitigantes</label>
                    <textarea
                      rows={2}
                      disabled={!canIssueRiskOpinion}
                      value={riskOpinionNotes}
                      onChange={(e) => setRiskOpinionNotes(e.target.value)}
                      placeholder="Análisis independiente de riesgo, concentración o garantías..."
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={saving || !canIssueRiskOpinion}
                      onClick={() => handleSaveRiskOpinion('SAVE_ONLY')}
                      className="axy-btn-secondary min-h-[42px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-45"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Registrar Dictamen
                    </button>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <button
                        type="button"
                        disabled={saving || !canIssueRiskOpinion}
                        onClick={() => handleSaveRiskOpinion('RETURN')}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-rose-300 text-rose-800 dark:border-rose-800 dark:text-rose-300 font-medium cursor-pointer disabled:opacity-45"
                      >
                        Devolver por Riesgo
                      </button>
                      <button
                        type="button"
                        disabled={saving || !canIssueRiskOpinion}
                        onClick={() => handleSaveRiskOpinion('ESCALATE_COMMITTEE')}
                        className="axy-btn-primary min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 cursor-pointer disabled:opacity-45"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Avalar y Escalar a Comité
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <ConfidentialDocPreviewModal
              document={previewDoc}
              applicationLabel={`${activeApp.applicationNumber} · ${activeApp.applicantDisplayName}`}
              onClose={() => setPreviewDoc(null)}
              onDownload={(docItem) => {
                if (!docItem.fileDataUrl) return;
                if (userProfile) {
                  void recordConfidentialDocumentAccess({
                    document: docItem,
                    accessType: 'DOWNLOAD',
                    user: userProfile,
                    applicationNumber: activeApp.applicationNumber,
                  }).catch(() => {});
                }
                const link = document.createElement('a');
                link.href = docItem.fileDataUrl;
                link.download = docItem.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
