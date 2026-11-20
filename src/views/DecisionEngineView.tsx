import React, { useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CheckCircle2, Cpu, Play, ShieldAlert } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  advanceApplicationToEvaluation,
  validateApplicationPreEvaluationInFirestore,
} from '../services/axycoreStore';
import {
  PreEvaluationValidationError,
  type PreEvaluationValidationResult,
} from '../engine/preEvaluationValidation';
import { PreEvaluationValidationAlert } from '../components/PreEvaluationValidationAlert';
import {
  formatMoney,
  formatRatePct,
  formatTimestamp,
  formatUserFacingError,
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
} from '../utils/formatters';
import type { CurrencyCode, ProductCode, ScoringExecutionRecord } from '../types/axycore';
import { IntelligenceDashboardView } from '../components/IntelligenceDashboardView';

export function DecisionEngineView() {
  const {
    applications,
    customers,
    activeOrTestPolicy,
    scoringExecutions,
    userProfile,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const receivedApps = useMemo(
    () =>
      applications
        .filter((a) => a.status === 'RECIBIDA')
        .sort((a, b) => b.applicationNumber.localeCompare(a.applicationNumber)),
    [applications]
  );

  const [engineViewMode, setEngineViewMode] = useState<'PENDIENTES_EVALUAR' | 'INTELLIGENCE' | 'SANDBOX'>(() =>
    receivedApps.length > 0 ? 'PENDIENTES_EVALUAR' : 'INTELLIGENCE'
  );
  const [alternateDrafts, setAlternateDrafts] = useState<Record<string, { amount: string; note: string }>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [processingStage, setProcessingStage] = useState<'VALIDATING' | 'TRANSITIONING' | null>(null);
  const [engineFeedback, setEngineFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [validationAlert, setValidationAlert] = useState<PreEvaluationValidationResult | null>(null);
  const [revalidatingAlert, setRevalidatingAlert] = useState(false);

  const handleRevalidateAlert = async () => {
    if (!validationAlert || !userProfile) return;
    const targetApp = applications.find((a) => a.id === validationAlert.applicationId);
    if (!targetApp) {
      setValidationAlert(null);
      return;
    }
    setRevalidatingAlert(true);
    try {
      const refreshed = await validateApplicationPreEvaluationInFirestore({
        application: targetApp,
        user: userProfile,
      });
      if (refreshed.canProceed) {
        setValidationAlert(null);
        setEngineFeedback({
          type: 'ok',
          msg: `Validación en Firestore superada para ${targetApp.applicationNumber}. Perfil del cliente y documentos requeridos completos; ya puede enviarla a Evaluación.`,
        });
      } else {
        setValidationAlert(refreshed);
      }
    } catch (err) {
      setEngineFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo re-verificar la solicitud en Firestore.'),
      });
    } finally {
      setRevalidatingAlert(false);
    }
  };

  const [simProduct, setSimProduct] = useState<ProductCode>('PERSONAL_DOP');
  const [simAmount, setSimAmount] = useState<number>(120000);
  const [simTerm, setSimTerm] = useState<number>(12);
  const [simIncome, setSimIncome] = useState<number>(95000);
  const [simExpenses, setSimExpenses] = useState<number>(30000);
  const [simDebtPay, setSimDebtPay] = useState<number>(8000);
  const [simEmpMonths, setSimEmpMonths] = useState<number>(36);
  const [simResult, setSimResult] = useState<Omit<ScoringExecutionRecord, 'executedAt'> | null>(null);
  const [running, setRunning] = useState(false);

  const simCurrency: CurrencyCode = simProduct.endsWith('USD') ? 'USD' : 'DOP';

  const handleRunSimulation = async () => {
    setRunning(true);
    try {
      const resp = await fetch('/api/engine/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy: activeOrTestPolicy,
          executionTrigger: 'MANUAL_RERUN',
          executedBy: 'simulator_sandbox',
          executedByName: 'Simulador Motor V2',
          customer: {
            phone: '8095550000',
            address: 'Santo Domingo',
            email: 'sim@axycore.do',
            residenceMonths: 36,
            housingType: 'ALQUILADA',
            housingPayment: 12000,
            socialMediaDeclared: 'YES',
            socialMediaHandle: '@sim',
          },
          application: {
            id: 'sim_app',
            organizationId: activeOrTestPolicy.organizationId,
            applicantType: simProduct.startsWith('EMPRESARIAL') ? 'BUSINESS' : 'INDIVIDUAL',
            productCode: simProduct,
            currency: simCurrency,
            requestedAmount: simAmount,
            requestedTermMonths: simTerm,
            paymentFrequency: 'MENSUAL',
            amortizationMethod: 'SALDO_INSOLUTO',
            loanPurpose: 'Simulación de capacidad',
            loanPurposeDescription: 'Prueba determinista en entorno de pruebas',
            references: [
              { name: 'Ref 1', relationship: 'Familiar', phone: '8095551111' },
              { name: 'Ref 2', relationship: 'Laboral', phone: '8095552222' },
            ],
            declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
            financialData: {
              employerOrBusinessName: 'Empresa Simulada',
              occupationOrRole: 'Analista',
              employmentMonths: simEmpMonths,
              incomeSourceType: 'FIJA_RECURRENTE',
              primaryNetIncome: simIncome,
              additionalIncomeStatus: 'EXPLICIT_NONE',
              additionalNetIncome: 0,
              declaredTotalMonthlyIncome: simIncome,
              incomeCurrency: 'DOP',
              essentialExpenses: simExpenses,
              housingPayment: 12000,
              housingIncludedInExpenses: true,
              debtDeclarationStatus: simDebtPay > 0 ? 'HAS_DEBTS' : 'NO_DEBTS_EXPLICIT',
              debtCount: simDebtPay > 0 ? 1 : 0,
              totalDebtBalance: simDebtPay * 12,
              currentDebtPayments: simDebtPay,
            },
            businessFinancialData: simProduct.startsWith('EMPRESARIAL')
              ? {
                  grossSales: simIncome * 2,
                  operatingCosts: simIncome,
                  netMonthlyFlow: simIncome,
                  operationsMonths: simEmpMonths,
                  incomeCurrency: 'DOP',
                  debtDeclarationStatus: simDebtPay > 0 ? 'HAS_DEBTS' : 'NO_DEBTS_EXPLICIT',
                }
              : null,
          },
        }),
      });
      const data = await resp.json();
      setSimResult(data);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Tab Bar: Pendientes por Dictaminar vs Intelligence Dashboard vs Sandbox Simulator */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-1.5 rounded-xl bg-slate-100 dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setEngineViewMode('PENDIENTES_EVALUAR')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              engineViewMode === 'PENDIENTES_EVALUAR'
                ? 'bg-white dark:bg-[#0066FF] text-[#0052CC] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Dictaminar Solicitudes Recibidas ({receivedApps.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setEngineViewMode('INTELLIGENCE')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              engineViewMode === 'INTELLIGENCE'
                ? 'bg-white dark:bg-[#0066FF] text-[#0052CC] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Rendimiento & Flujo de Originación</span>
          </button>
          <button
            type="button"
            onClick={() => setEngineViewMode('SANDBOX')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              engineViewMode === 'SANDBOX'
                ? 'bg-white dark:bg-[#0066FF] text-[#0052CC] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Simulador Interactivo Sandbox V2</span>
          </button>
        </div>

        <div className="text-[11px] text-slate-500 dark:text-slate-400 px-2 font-mono">
          Política: {activeOrTestPolicy.version} · {activeOrTestPolicy.status}
        </div>
      </div>

      {engineViewMode === 'PENDIENTES_EVALUAR' ? (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 text-xs flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Dictamen del Motor de Decisiones sobre Solicitudes Recibidas
              </h2>
              <p className="text-slate-500 dark:text-slate-400">
                Si la solicitud califica para el monto completo solicitado pasa directamente a Evaluación; de lo contrario, autoriza otro monto para re-evaluar en el Motor.
              </p>
            </div>
          </div>

          {validationAlert && (
            <PreEvaluationValidationAlert
              result={validationAlert}
              revalidating={revalidatingAlert}
              onClose={() => setValidationAlert(null)}
              onRevalidate={handleRevalidateAlert}
              onGoToCustomers={() =>
                setActiveSection(rbac.canAccessSection('customers_update') ? 'customers_update' : 'customers')
              }
              onGoToDocuments={(appId) => {
                setSelectedApplicationId(appId);
                setActiveSection('documents');
              }}
            />
          )}

          {engineFeedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
                engineFeedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <span>{engineFeedback.msg}</span>
              {engineFeedback.type === 'ok' && rbac.canAccessSection('evaluation') && (
                <button
                  type="button"
                  onClick={() => setActiveSection('evaluation')}
                  className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                >
                  Ir a Evaluación
                </button>
              )}
            </div>
          )}

          {receivedApps.length === 0 ? (
            <div className="p-10 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 text-center space-y-3 text-xs">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No hay solicitudes en estado Recibida pendientes de dictamen del Motor.
              </p>
              <button
                type="button"
                onClick={() => setActiveSection('applications')}
                className="px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                Ver Bandeja de Solicitudes Recibidas
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {receivedApps.map((app) => {
                const qualifiesFullAmount =
                  app.prequalificationStatus === 'PREOFERTA' &&
                  (app.recommendedAmount ?? 0) >= app.requestedAmount;
                const cust = customers.find((c) => c.id === app.customerId) ?? null;
                const suggestedAlt =
                  app.recommendedAmount && app.recommendedAmount > 0
                    ? app.recommendedAmount
                    : Math.round(app.requestedAmount * 0.7);
                const draft = alternateDrafts[app.id] ?? { amount: String(suggestedAlt), note: '' };

                return (
                  <div
                    key={app.id}
                    className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 space-y-4 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-slate-500">
                          {app.applicationNumber} · {PRODUCT_LABELS[app.productCode]}
                        </p>
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white mt-0.5">
                          {app.applicantDisplayName}
                        </h3>
                        <p className="text-slate-500 mt-0.5">
                          Solicitado: <strong className="font-mono text-slate-900 dark:text-white">{formatMoney(app.requestedAmount, app.currency)}</strong> a{' '}
                          {app.requestedTermMonths} meses
                        </p>
                      </div>

                      <div className="text-right space-y-1">
                        <p className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                          Score V2: {app.latestScore ?? '—'}/100 ({app.latestRiskBand ?? '—'})
                        </p>
                        <p
                          className={`font-semibold ${
                            qualifiesFullAmount
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {qualifiesFullAmount
                            ? 'Califica Monto Completo — Pasa directo a Evaluación'
                            : 'Requiere Autorización de Otro Monto'}
                        </p>
                        <p className="font-mono text-slate-500">
                          Dictamen Motor: {app.prequalificationStatus ? SCORING_STATUS_LABELS[app.prequalificationStatus] : 'Pendiente'} · Sugerido:{' '}
                          {formatMoney(app.recommendedAmount ?? 0, app.currency)}
                        </p>
                      </div>
                    </div>

                    {qualifiesFullAmount ? (
                      <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          Oferta aprobada íntegramente por el Motor V2 ({formatRatePct(app.recommendedRateMonthly)} mensual · Cuota{' '}
                          {formatMoney(app.recommendedInstallment ?? 0, app.currency)}).
                        </span>
                        <button
                          type="button"
                          disabled={processingId === app.id || !userProfile || rbac.isReadOnlyAuditor}
                          onClick={async () => {
                            if (!userProfile) return;
                            setProcessingId(app.id);
                            setProcessingStage('VALIDATING');
                            setEngineFeedback(null);
                            setValidationAlert(null);
                            try {
                              const validation = await validateApplicationPreEvaluationInFirestore({
                                application: app,
                                user: userProfile,
                              });
                              if (!validation.canProceed) {
                                setValidationAlert(validation);
                                return;
                              }
                              setProcessingStage('TRANSITIONING');
                              await advanceApplicationToEvaluation({
                                application: app,
                                customer: cust,
                                policy: activeOrTestPolicy,
                                user: userProfile,
                                validatedResult: validation,
                              });
                              setSelectedApplicationId(app.id);
                              setEngineFeedback({
                                type: 'ok',
                                msg: `${app.applicationNumber} validada en Firestore y enviada directamente a Evaluación con aprobación íntegra del Motor.${validation.warnings.length > 0 ? ` (${validation.warnings.length} advertencia(s) informativa(s)).` : ''}`,
                              });
                            } catch (err) {
                              if (err instanceof PreEvaluationValidationError) {
                                setValidationAlert(err.validation);
                              } else {
                                setEngineFeedback({
                                  type: 'err',
                                  msg: formatUserFacingError(
                                    err,
                                    'Error pasando solicitud a Evaluación.'
                                  ),
                                });
                              }
                            } finally {
                              setProcessingId(null);
                              setProcessingStage(null);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          {processingId === app.id
                            ? processingStage === 'VALIDATING'
                              ? 'Validando en Firestore...'
                              : 'Pasando...'
                            : 'Pasar Directo a Evaluación'}
                        </button>
                      </div>
                    ) : (
                      <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.08] grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-1">
                            Autorizar Otro Monto ({app.currency})
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={draft.amount}
                            onChange={(e) =>
                              setAlternateDrafts((prev) => ({
                                ...prev,
                                [app.id]: { ...draft, amount: e.target.value },
                              }))
                            }
                            className="axy-input w-full px-3 py-2 border-amber-300 dark:border-amber-700 font-mono font-semibold text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="sm:col-span-5">
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Autorización / Justificación
                          </label>
                          <input
                            type="text"
                            value={draft.note}
                            onChange={(e) =>
                              setAlternateDrafts((prev) => ({
                                ...prev,
                                [app.id]: { ...draft, note: e.target.value },
                              }))
                            }
                            placeholder="Ej. Autorizo re-evaluar por monto ajustado a capacidad..."
                            className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="sm:col-span-4 flex justify-end">
                          <button
                            type="button"
                            disabled={
                              processingId === app.id ||
                              !userProfile ||
                              rbac.isReadOnlyAuditor ||
                              Number(draft.amount) <= 0
                            }
                            onClick={async () => {
                              if (!userProfile) return;
                              const alt = Number(draft.amount);
                              if (!Number.isFinite(alt) || alt <= 0) return;
                              setProcessingId(app.id);
                              setProcessingStage('VALIDATING');
                              setEngineFeedback(null);
                              setValidationAlert(null);
                              try {
                                const validation = await validateApplicationPreEvaluationInFirestore({
                                  application: app,
                                  user: userProfile,
                                });
                                if (!validation.canProceed) {
                                  setValidationAlert(validation);
                                  return;
                                }
                                setProcessingStage('TRANSITIONING');
                                await advanceApplicationToEvaluation({
                                  application: app,
                                  customer: cust,
                                  policy: activeOrTestPolicy,
                                  user: userProfile,
                                  alternateAmount: alt,
                                  authorizationNote: draft.note.trim(),
                                  validatedResult: validation,
                                });
                                setSelectedApplicationId(app.id);
                                setEngineFeedback({
                                  type: 'ok',
                                  msg: `${app.applicationNumber} validada en Firestore, autorizada por ${formatMoney(alt, app.currency)}, re-evaluada en Motor V2 y enviada a Evaluación.`,
                                });
                              } catch (err) {
                                if (err instanceof PreEvaluationValidationError) {
                                  setValidationAlert(err.validation);
                                } else {
                                  setEngineFeedback({
                                    type: 'err',
                                    msg: formatUserFacingError(
                                      err,
                                      'Error re-evaluando con otro monto.'
                                    ),
                                  });
                                }
                              } finally {
                                setProcessingId(null);
                                setProcessingStage(null);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {processingId === app.id
                              ? processingStage === 'VALIDATING'
                                ? 'Validando en Firestore...'
                                : 'Re-evaluando...'
                              : 'Autorizar Otro Monto y Pasar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : engineViewMode === 'INTELLIGENCE' ? (
        <IntelligenceDashboardView />
      ) : (
        <>
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
        <div>
          <strong>Política {activeOrTestPolicy.version} ({activeOrTestPolicy.status}):</strong>{' '}
          Motor determinista de 22 indicadores en entorno de pruebas, pendiente de validación y autorización comercial.
        </div>
        <span className="font-mono">
          TC Ref: {activeOrTestPolicy.exchangeRateConfig.dopPerUsd ?? 'No configurado'} DOP/USD
        </span>
      </div>

      {/* Interactive Backend Simulator */}
      <div className="axy-surface p-6 rounded-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Laboratorio Sandbox — Motor de Decisiones Crediticias V2 (Backend API)
            </h2>
          </div>
          <button
            type="button"
            onClick={handleRunSimulation}
            disabled={running}
            className="axy-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? 'Calculando...' : 'Simular Scoring V2'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <div>
            <label className="block mb-1 text-slate-500">Producto</label>
            <select
              value={simProduct}
              onChange={(e) => setSimProduct(e.target.value as ProductCode)}
              className="axy-input w-full px-2.5 py-1.5 text-slate-900 dark:text-white"
            >
              <option value="PERSONAL_DOP">Personal DOP</option>
              <option value="EMPRESARIAL_DOP">Empresarial DOP</option>
              <option value="PERSONAL_USD">Personal USD</option>
              <option value="EMPRESARIAL_USD">Empresarial USD</option>
            </select>
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Monto Sol. ({simCurrency})</label>
            <input
              type="number"
              value={simAmount}
              onChange={(e) => setSimAmount(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Plazo (Meses)</label>
            <input
              type="number"
              value={simTerm}
              onChange={(e) => setSimTerm(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Ingreso Neto DOP</label>
            <input
              type="number"
              value={simIncome}
              onChange={(e) => setSimIncome(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Gastos Esenciales</label>
            <input
              type="number"
              value={simExpenses}
              onChange={(e) => setSimExpenses(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Cuotas Deuda (D)</label>
            <input
              type="number"
              value={simDebtPay}
              onChange={(e) => setSimDebtPay(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500">Antigüedad (Meses)</label>
            <input
              type="number"
              value={simEmpMonths}
              onChange={(e) => setSimEmpMonths(Number(e.target.value))}
              className="axy-input w-full px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {simResult && (
          <div className="space-y-4 pt-4 border-t border-slate-200/80 dark:border-[#00B8FF]/14">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
              <div>
                <p className="text-slate-500">Score Total</p>
                <p className="text-2xl font-bold font-mono tabular-nums">{simResult.totalScore}/100</p>
              </div>
              <div>
                <p className="text-slate-500">Banda de Riesgo</p>
                <p className="text-sm font-semibold mt-1">{simResult.riskBand.label}</p>
              </div>
              <div>
                <p className="text-slate-500">Estado Motor</p>
                <p className="text-sm font-semibold text-[#0066FF] dark:text-[#00D1FF] mt-1">
                  {SCORING_STATUS_LABELS[simResult.status]}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Oferta Sostenible</p>
                <p className="text-lg font-bold font-mono tabular-nums">
                  {formatMoney(simResult.recommendedAmount, simCurrency)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Tasa / Plazo / Cuota</p>
                <p className="text-sm font-mono tabular-nums font-semibold">
                  {formatRatePct(simResult.recommendedRateMonthly)} · {simResult.recommendedTermMonths}m ·{' '}
                  {formatMoney(simResult.recommendedInstallment, simCurrency)}
                </p>
              </div>
            </div>

            {simResult.alerts.length > 0 && (
              <div className="axy-surface-tonal p-3 rounded-xl text-xs text-slate-700 dark:text-slate-300">
                {simResult.alerts.map((a, idx) => (
                  <p key={idx}>• {a}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Historical Scoring Executions */}
      <div className="axy-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/14">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Historial Inmutable de Ejecuciones ({scoringExecutions.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-3 font-semibold">Ejecución</th>
                <th className="py-2.5 px-3 font-semibold">Disparador</th>
                <th className="py-2.5 px-3 font-semibold">Política</th>
                <th className="py-2.5 px-3 font-semibold text-right">Score</th>
                <th className="py-2.5 px-3 font-semibold">Banda</th>
                <th className="py-2.5 px-3 font-semibold">Estado</th>
                <th className="py-2.5 px-3 font-semibold text-right">Monto Rec.</th>
                <th className="py-2.5 px-3 font-semibold">Fecha</th>
                <th className="py-2.5 px-3 font-semibold text-right">Expediente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
              {scoringExecutions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    Aún no existen ejecuciones registradas.
                  </td>
                </tr>
              ) : (
                scoringExecutions.map((ex) => (
                  <tr key={ex.id} className="axy-table-row">
                    <td className="py-2 px-3 font-mono">{ex.id.slice(0, 18)}</td>
                    <td className="py-2 px-3">{ex.executionTrigger}</td>
                    <td className="py-2 px-3 font-mono">{ex.policyVersion}</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right font-semibold">
                      {ex.totalScore}/100
                    </td>
                    <td className="py-2 px-3">{ex.riskBand.label}</td>
                    <td className="py-2 px-3">{SCORING_STATUS_LABELS[ex.status]}</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right">
                      {formatMoney(ex.recommendedAmount, ex.capacityResult.loanCurrency)}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-500">{formatTimestamp(ex.executedAt)}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedApplicationId(ex.applicationId);
                          setActiveSection('applications');
                        }}
                        className="text-[#0066FF] dark:text-[#00D1FF] hover:underline font-medium cursor-pointer"
                      >
                        Abrir ficha
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
