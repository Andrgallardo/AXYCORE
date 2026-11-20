import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { DocumentOcrVerifierPanel } from '../components/DocumentOcrVerifierPanel';
import { ConfidentialDocPreviewModal } from '../components/ConfidentialDocPreviewModal';
import { ApplicationFinancialAnalysisPanel } from '../components/ApplicationFinancialAnalysisPanel';
import {
  generateId,
  recordConfidentialDocumentAccess,
  saveAnalystEvaluationAndRecalc,
  saveRiskOfficerSignOff,
  updateDocumentReviewStatus,
} from '../services/axycoreStore';
import {
  APPLICATION_STATUS_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  normalizeMonthlyRateDecimal,
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

  const evalInbox = useMemo(
    () =>
      applications.filter((a) =>
        ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(a.status)
      ),
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
  const [recAmount, setRecAmount] = useState<string>('');
  const [recRatePct, setRecRatePct] = useState<string>('');
  const [recTerm, setRecTerm] = useState<string>('');
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
      setRecAmount(String(existingEval.recommendedAmount ?? activeApp.recommendedAmount ?? ''));
      const normalizedEvalRate = existingEval.recommendedRateMonthly
        ? normalizeMonthlyRateDecimal(existingEval.recommendedRateMonthly, 0)
        : activeApp.recommendedRateMonthly
        ? normalizeMonthlyRateDecimal(activeApp.recommendedRateMonthly, 0)
        : 0;
      setRecRatePct(normalizedEvalRate > 0 ? (normalizedEvalRate * 100).toFixed(2) : '');
      setRecTerm(String(existingEval.recommendedTermMonths ?? activeApp.recommendedTermMonths ?? ''));
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
      setRecAmount(String(activeApp.recommendedAmount ?? activeApp.requestedAmount));
      const normalizedAppRate = activeApp.recommendedRateMonthly
        ? normalizeMonthlyRateDecimal(activeApp.recommendedRateMonthly, 0)
        : 0;
      setRecRatePct(normalizedAppRate > 0 ? (normalizedAppRate * 100).toFixed(2) : '');
      setRecTerm(String(activeApp.recommendedTermMonths ?? activeApp.requestedTermMonths));
      setRecConditions('');
      setJustification('');
      setRiskOpinionStatus('PENDIENTE');
      setRiskOpinionNotes('');
    }
  }, [activeApp?.id, existingEval?.id]);

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

  const handleSaveEvaluation = async (mode: 'RECALC_ONLY' | 'TO_COMMITTEE' | 'RETURN') => {
    if (!activeApp || !userProfile) return;
    if (!customer) {
      setFeedback({
        type: 'err',
        msg: 'No se encontró la ficha del cliente vinculada a esta solicitud. Verifica el expediente en la bandeja de clientes antes de evaluar.',
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
        recommendedAmount: recAmount !== '' ? Number(recAmount) : null,
        recommendedRateMonthly: recRatePct !== '' ? Number(recRatePct) / 100 : null,
        recommendedTermMonths: recTerm !== '' ? Number(recTerm) : null,
        recommendedConditions: recConditions.trim(),
        justification: justification.trim(),
        status: mode === 'RECALC_ONLY' ? 'BORRADOR' : 'COMPLETADA',
      };

      const res = await saveAnalystEvaluationAndRecalc({
        application: activeApp,
        customer,
        policy: activeOrTestPolicy,
        evaluation: evalRecord,
        sendToCommittee: mode === 'TO_COMMITTEE',
        returnToApplicant: mode === 'RETURN',
        user: userProfile,
      });

      setFeedback({
        type: 'ok',
        msg:
          mode === 'TO_COMMITTEE'
            ? `Informe guardado, Motor V2 recalculado (Score ${res.newScoring.totalScore}/100) y enviado al Comité de Crédito.`
            : mode === 'RETURN'
            ? 'Expediente devuelto para información adicional y recálculo registrado.'
            : `Datos verificados guardados y nueva ejecución versionada creada (Score ${res.newScoring.totalScore}/100).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error guardando la evaluación.',
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
        msg: err instanceof Error ? err.message : 'Error registrando el dictamen de riesgo.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (evalInbox.length === 0) {
    return (
      <div className="axy-surface p-8 rounded-2xl text-center space-y-3">
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
          Bandeja de Evaluación de Créditos vacía
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No hay solicitudes pendientes de análisis en este momento.
        </p>
        <button
          type="button"
          onClick={() => setActiveSection('applications')}
          className="axy-btn-primary px-4 py-2 text-xs cursor-pointer"
        >
          Ir a Solicitudes Recibidas
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Queue */}
      <div className="lg:col-span-4 space-y-3">
        <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
          Bandeja de Analista ({evalInbox.length})
        </h2>
        <div className="space-y-2">
          {evalInbox.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => setSelectedApplicationId(app.id)}
              className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                activeApp?.id === app.id
                  ? 'border-[#0066FF] bg-[#0066FF]/[0.06] dark:bg-[#0066FF]/16 dark:border-[#00B8FF]'
                  : 'axy-surface hover:bg-slate-50/90 dark:hover:bg-[#0E1D40]/70'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                <span>{app.applicationNumber}</span>
                <span>Score: {app.latestScore ?? '—'}/100</span>
              </div>
              <p className="font-semibold text-sm text-slate-900 dark:text-white mt-1 truncate">
                {app.applicantDisplayName}
              </p>
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mt-1">
                <span className="font-mono tabular-nums">{formatMoney(app.requestedAmount, app.currency)}</span>
                <span>{APPLICATION_STATUS_LABELS[app.status]}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Workspace */}
      {activeApp && (
        <div className="lg:col-span-8 space-y-5">
          {/* RBAC Context Banner for Credit Evaluation Flow */}
          <div className="axy-surface p-4 rounded-2xl space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Control RBAC de Evaluación · Rol activo: {rbac.roleLabel}</span>
              </div>
              <span className="text-slate-500 dark:text-slate-400">{rbac.workflowFocus}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 dark:border-[#00B8FF]/14">
              <div className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100 block">
                  Analista · {canEditAnalystSection ? 'Habilitado' : 'Solo lectura'}
                </span>
                <span>Depuración financiera, verificación e informe técnico</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100 block">
                  Oficial de Riesgo · {canIssueRiskOpinion ? 'Habilitado' : 'Solo lectura'}
                </span>
                <span>Dictamen independiente de riesgo y estrés V2</span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100 block">
                  Comité · {rbac.hasPermission('DECIDE_COMMITTEE') ? 'Resuelve en Comité' : 'Sin voto decisor'}
                </span>
                <span>Resolución inmutable en módulo Comité de Crédito</span>
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

          {/* Preliminary vs Updated Scoring */}
          <div className="axy-surface p-5 rounded-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">{activeApp.applicantDisplayName}</h3>
                <p className="text-xs text-slate-500 font-mono">
                  {activeApp.applicationNumber} · {activeApp.fileNumber} · {customer?.documentType} {customer?.documentNumber}
                </p>
              </div>
              <span className="text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                {activeApp.prequalificationStatus ? SCORING_STATUS_LABELS[activeApp.prequalificationStatus] : '—'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="axy-surface-tonal p-3.5 rounded-xl">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Resultado Preliminar (Original)</p>
                <p className="font-mono text-lg font-bold tabular-nums mt-1 text-slate-950 dark:text-white">
                  {preliminaryExec ? `${preliminaryExec.totalScore}/100 (${preliminaryExec.riskBand.label})` : '—'}
                </p>
                <p className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  Rec.: {formatMoney(preliminaryExec?.recommendedAmount ?? 0, activeApp.currency)} ·{' '}
                  {formatRatePct(preliminaryExec?.recommendedRateMonthly)}
                </p>
              </div>
              <div className="axy-surface-tonal p-3.5 rounded-xl">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  Resultado Actualizado ({appExecutions.length} ejecuciones)
                </p>
                <p className="font-mono text-lg font-bold tabular-nums mt-1 text-slate-950 dark:text-white">
                  {latestExec ? `${latestExec.totalScore}/100 (${latestExec.riskBand.label})` : '—'}
                </p>
                <p className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  Rec.: {formatMoney(latestExec?.recommendedAmount ?? 0, activeApp.currency)} ·{' '}
                  {formatRatePct(latestExec?.recommendedRateMonthly)}
                </p>
              </div>
            </div>
          </div>

          {/* Persisted Financial Analysis & Amortization Schedule (Decision V2 + Financial Engine) */}
          <ApplicationFinancialAnalysisPanel
            application={activeApp}
            customer={customer}
            mode="EVALUATION"
          />

          {/* Declared vs Verified Financials */}
          <div className="axy-surface p-5 rounded-2xl space-y-4">
            <h4 className="font-semibold text-sm text-slate-950 dark:text-white">Depuración Financiera: Declarado vs. Verificado</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="axy-surface-tonal space-y-2 p-3.5 rounded-xl">
                <p className="font-semibold text-slate-500 dark:text-slate-400">Datos Originalmente Declarados (Inmutables)</p>
                <p className="font-mono">Ingreso principal: {activeApp.financialData.primaryNetIncome ?? 'N/D'}</p>
                <p className="font-mono">Ingresos adicionales: {activeApp.financialData.additionalNetIncome ?? 0}</p>
                <p className="font-mono">Gastos esenciales: {activeApp.financialData.essentialExpenses ?? 'N/D'}</p>
                <p className="font-mono">Cuotas deudas: {activeApp.financialData.currentDebtPayments ?? 0}</p>
                {activeApp.businessFinancialData && (
                  <p className="font-mono">Flujo neto empresa: {activeApp.businessFinancialData.netMonthlyFlow ?? 'N/D'}</p>
                )}
              </div>

              <div className="space-y-2.5">
                <p className="font-semibold text-[#0066FF] dark:text-[#00D1FF]">Datos Verificados por Analista</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500">Ingreso Principal Verif.</label>
                    <input
                      type="number"
                      disabled={!canEditAnalystSection}
                      value={verPrimaryIncome}
                      onChange={(e) => setVerPrimaryIncome(e.target.value)}
                      className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Ing. Adicionales Verif.</label>
                    <input
                      type="number"
                      disabled={!canEditAnalystSection}
                      value={verAddIncome}
                      onChange={(e) => setVerAddIncome(e.target.value)}
                      className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Gastos Esenciales Verif.</label>
                    <input
                      type="number"
                      disabled={!canEditAnalystSection}
                      value={verExpenses}
                      onChange={(e) => setVerExpenses(e.target.value)}
                      className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Cuotas Deudas Verif.</label>
                    <input
                      type="number"
                      disabled={!canEditAnalystSection}
                      value={verDebtPayments}
                      onChange={(e) => setVerDebtPayments(e.target.value)}
                      className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  {activeApp.businessFinancialData && (
                    <div className="col-span-2">
                      <label className="block text-[11px] text-slate-500">Flujo Neto Empresa Verif.</label>
                      <input
                        type="number"
                        disabled={!canEditAnalystSection}
                        value={verNetBizFlow}
                        onChange={(e) => setVerNetBizFlow(e.target.value)}
                        className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Verification Checkboxes: Verificación Financiera y Checklist de Depuración del Cliente */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-[#00B8FF]/14 space-y-3 text-xs">
              {customer && (
                <div className="axy-surface-tonal p-3.5 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Dirección declarada</span>
                    <span className="text-slate-900 dark:text-slate-100">{customer.address || 'No declarada'}</span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Teléfono(s) del cliente</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {customer.phone || '—'} {customer.altPhone ? `· Alt: ${customer.altPhone}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Redes sociales</span>
                    <span className="font-mono text-slate-900 dark:text-slate-100">
                      {customer.socialMediaHandle || (customer.socialMediaDeclared === 'YES' ? 'Declarada sin usuario' : 'No declaradas')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 block">Referencias declaradas ({activeApp.references?.length ?? 0})</span>
                    <span className="text-slate-900 dark:text-slate-100">
                      {activeApp.references && activeApp.references.length > 0
                        ? activeApp.references.map((r) => `${r.name} (${r.relationship}: ${r.phone})`).join(' · ')
                        : 'Sin referencias registradas'}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <p className="font-semibold text-slate-900 dark:text-white mb-2">
                  Checklist de Depuración del Cliente (Obligatorio para Enviar a Comité)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="axy-surface-tonal inline-flex items-center gap-2 p-2.5 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={referencesVerified}
                      onChange={(e) => setReferencesVerified(e.target.checked)}
                    />
                    <span className="font-medium">Referencias confirmadas *</span>
                  </label>
                  <label className="axy-surface-tonal inline-flex items-center gap-2 p-2.5 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={addressVerified}
                      onChange={(e) => setAddressVerified(e.target.checked)}
                    />
                    <span className="font-medium">Dirección confirmada *</span>
                  </label>
                  <label className="axy-surface-tonal inline-flex items-center gap-2 p-2.5 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={phoneVerified}
                      onChange={(e) => setPhoneVerified(e.target.checked)}
                    />
                    <span className="font-medium">Teléfono confirmado *</span>
                  </label>
                  <label className="axy-surface-tonal inline-flex items-center gap-2 p-2.5 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canEditAnalystSection}
                      checked={socialMediaVerified}
                      onChange={(e) => setSocialMediaVerified(e.target.checked)}
                    />
                    <span className="font-medium">Redes sociales confirmadas *</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canEditAnalystSection}
                    checked={identityVerified}
                    onChange={(e) => setIdentityVerified(e.target.checked)}
                  />
                  <span>Identidad verificada</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canEditAnalystSection}
                    checked={incomeVerified}
                    onChange={(e) => setIncomeVerified(e.target.checked)}
                  />
                  <span>Ingresos confirmados</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canEditAnalystSection}
                    checked={obligationsVerified}
                    onChange={(e) => setObligationsVerified(e.target.checked)}
                  />
                  <span>Obligaciones revisadas</span>
                </label>
              </div>
            </div>

            {appDocs.length > 0 && (
              <div className="pt-2 border-t border-slate-200/80 dark:border-[#00B8FF]/14 space-y-2 text-xs">
                <p className="font-semibold text-slate-900 dark:text-white">Documentos del Expediente ({appDocs.length})</p>
                {appDocs.map((d) => (
                  <div key={d.id} className="axy-surface-tonal flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl">
                    <span className="truncate font-mono">[{d.category}] {d.fileName}</span>
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
                            className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
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
                            className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[#0066FF] dark:text-[#00D1FF] cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
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
                        className="axy-input px-2 py-1 text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        <option value="RECIBIDO">Recibido</option>
                        <option value="VERIFICADO">Verificado</option>
                        <option value="OBSERVADO">Observado</option>
                      </select>
                    </div>
                  </div>
                ))}
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

          {/* Verificador Automático de Documentos (Gemini OCR) */}
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

          {/* Technical Report & Recommendation (Analyst) */}
          <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold text-sm text-slate-950 dark:text-white">Informe Técnico y Recomendación Analítica</h4>
              {!canEditAnalystSection && (
                <span className="text-slate-500 dark:text-slate-400">
                  {workflowAccess?.canEditVerifiedFinancials.reason}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block mb-1 text-slate-500">Recomendación</label>
                <select
                  disabled={!canEditAnalystSection}
                  value={recommendedDecision}
                  onChange={(e) => setRecommendedDecision(e.target.value as CreditEvaluationRecord['recommendedDecision'])}
                  className="axy-input w-full px-2.5 py-1.5 text-slate-900 dark:text-white disabled:opacity-60"
                >
                  <option value="APROBAR">Aprobar</option>
                  <option value="MODIFICAR">Modificar condiciones</option>
                  <option value="DEVOLVER">Devolver por información</option>
                  <option value="RECHAZAR">Rechazar</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Monto Propuesto</label>
                <input
                  type="number"
                  disabled={!canEditAnalystSection}
                  value={recAmount}
                  onChange={(e) => setRecAmount(e.target.value)}
                  className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Tasa Mensual Prop. (%)</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={!canEditAnalystSection}
                  value={recRatePct}
                  onChange={(e) => setRecRatePct(e.target.value)}
                  className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Plazo Prop. (Meses)</label>
                <input
                  type="number"
                  disabled={!canEditAnalystSection}
                  value={recTerm}
                  onChange={(e) => setRecTerm(e.target.value)}
                  className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 text-slate-500">Hallazgos y Depuración</label>
                <textarea
                  rows={2}
                  disabled={!canEditAnalystSection}
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Justificación de Condiciones / Excepción</label>
                <textarea
                  rows={2}
                  disabled={!canEditAnalystSection}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label className="block mb-1 text-slate-500">Informe Técnico para Comité de Crédito</label>
              <textarea
                rows={3}
                disabled={!canEditAnalystSection}
                value={technicalReport}
                onChange={(e) => setTechnicalReport(e.target.value)}
                placeholder="Resumen ejecutivo de capacidad de pago, estabilidad laboral/comercial y mitigantes..."
                className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                disabled={saving || !canEditAnalystSection}
                onClick={() => handleSaveEvaluation('RECALC_ONLY')}
                className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Guardar y Recalcular Motor V2
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !canEditAnalystSection}
                  onClick={() => handleSaveEvaluation('RETURN')}
                  className="px-3 py-2 rounded-xl border border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300 font-medium cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Devolver por Información
                </button>
                <button
                  type="button"
                  disabled={saving || !canEditAnalystSection}
                  onClick={() => handleSaveEvaluation('TO_COMMITTEE')}
                  className="axy-btn-primary inline-flex items-center gap-1.5 px-4 py-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  Enviar a Comité
                </button>
              </div>
            </div>
          </div>

          {/* Independent Risk Officer Opinion (Oficial de Riesgo) */}
          <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-semibold text-sm text-slate-950 dark:text-white">Dictamen Independiente de Riesgo (Segunda Línea)</h4>
                <p className="text-slate-500 dark:text-slate-400">
                  {existingEval?.riskOfficerName
                    ? `Última revisión por ${existingEval.riskOfficerName} · Estado: ${existingEval.riskOpinionStatus ?? 'PENDIENTE'}`
                    : 'Facultad exclusiva de Oficial de Riesgo o Administrador para validar mitigantes y escalar o devolver.'}
                </p>
              </div>
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
                  className="axy-input w-full px-2.5 py-1.5 text-slate-900 dark:text-white disabled:opacity-60"
                >
                  <option value="PENDIENTE">Pendiente de revisión</option>
                  <option value="CONFORME">Conforme con el riesgo</option>
                  <option value="CON_OBSERVACIONES">Conforme con observaciones</option>
                  <option value="RECHAZO_RIESGO">Objeción crítica de riesgo</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex items-end">
                <label className="inline-flex items-center gap-2 cursor-pointer pb-1.5">
                  <input
                    type="checkbox"
                    disabled={!canIssueRiskOpinion}
                    checked={recalcOnRiskSave}
                    onChange={(e) => setRecalcOnRiskSave(e.target.checked)}
                  />
                  <span>Ejecutar verificación Motor V2 (auditoría de estrés y capacidad) al guardar</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block mb-1 text-slate-500">Observaciones y Mitigantes de Riesgo</label>
              <textarea
                rows={2}
                disabled={!canIssueRiskOpinion}
                value={riskOpinionNotes}
                onChange={(e) => setRiskOpinionNotes(e.target.value)}
                placeholder="Análisis independiente de riesgo cambiario, concentración, garantías o condiciones sugeridas para el Comité..."
                className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                disabled={saving || !canIssueRiskOpinion}
                onClick={() => handleSaveRiskOpinion('SAVE_ONLY')}
                className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Registrar Dictamen de Riesgo
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !canIssueRiskOpinion}
                  onClick={() => handleSaveRiskOpinion('RETURN')}
                  className="px-3 py-2 rounded-xl border border-rose-300 text-rose-800 dark:border-rose-800 dark:text-rose-300 font-medium cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Devolver por Riesgo
                </button>
                <button
                  type="button"
                  disabled={saving || !canIssueRiskOpinion}
                  onClick={() => handleSaveRiskOpinion('ESCALATE_COMMITTEE')}
                  className="axy-btn-primary inline-flex items-center gap-1.5 px-4 py-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  Avalar y Escalar a Comité
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
