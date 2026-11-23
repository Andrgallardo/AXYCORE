import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  calculateRenewalNetDisbursement,
  evaluateLoanRenewalEligibility,
} from '../engine/renewalEngine';
import {
  initiateLoanRenewal,
  type InitiateLoanRenewalResult,
} from '../services/renewalService';
import {
  formatMoney,
  isClosedLoanStatus,
  LOAN_STATUS_LABELS,
  normalizeMonthlyRateDecimal,
  PRODUCT_LABELS,
  toIsoDateOnly,
} from '../utils/formatters';
import type {
  AmortizationMethod,
  CustomerRecord,
  LegalFeeApplicationMode,
  PaymentFrequency,
  ProductCode,
  RenewalModality,
} from '../types/axycore';

interface RenewalInitiationModalProps {
  customer: CustomerRecord;
  initialLoanId?: string | null;
  onClose: () => void;
  onCompleted?: (result: InitiateLoanRenewalResult) => void;
}

const PRODUCT_OPTIONS: ProductCode[] = [
  'PERSONAL_DOP',
  'EMPRESARIAL_DOP',
  'PERSONAL_USD',
  'EMPRESARIAL_USD',
];

const FREQUENCY_OPTIONS: Array<{ value: PaymentFrequency; label: string }> = [
  { value: 'MENSUAL', label: 'Mensual' },
  { value: 'QUINCENAL', label: 'Quincenal' },
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'DIARIA', label: 'Diaria' },
];

export function RenewalInitiationModal({
  customer,
  initialLoanId = null,
  onClose,
  onCompleted,
}: RenewalInitiationModalProps) {
  const {
    loans,
    loanInstallments,
    payments,
    collectionAccounts,
    applications,
    businesses,
    creditRenewals,
    activeOrTestPolicy,
    activeCollectionPolicy,
    userProfile,
    setActiveSection,
    setSelectedApplicationId,
  } = useAxyCore();

  const customerLoans = useMemo(
    () =>
      loans
        .filter((l) => l.customerId === customer.id)
        .sort((a, b) => {
          const aClosed = isClosedLoanStatus(a.status) ? 1 : 0;
          const bClosed = isClosedLoanStatus(b.status) ? 1 : 0;
          if (aClosed !== bClosed) return aClosed - bClosed;
          return (b.disbursementDate || '').localeCompare(a.disbursementDate || '');
        }),
    [loans, customer.id]
  );

  const activeLoans = useMemo(
    () => customerLoans.filter((l) => !isClosedLoanStatus(l.status)),
    [customerLoans]
  );

  const [selectedLoanId, setSelectedLoanId] = useState<string>(() => {
    if (initialLoanId && customerLoans.some((l) => l.id === initialLoanId)) {
      return initialLoanId;
    }
    return activeLoans[0]?.id || customerLoans[0]?.id || '';
  });

  const selectedLoan = useMemo(
    () => customerLoans.find((l) => l.id === selectedLoanId) ?? null,
    [customerLoans, selectedLoanId]
  );

  const originApplication = useMemo(() => {
    if (!selectedLoan) return null;
    return applications.find((a) => a.id === selectedLoan.applicationId) ?? null;
  }, [applications, selectedLoan]);

  const originBusiness = useMemo(() => {
    if (!selectedLoan?.businessId) return null;
    return businesses.find((b) => b.id === selectedLoan.businessId) ?? null;
  }, [businesses, selectedLoan]);

  const originInstallments = useMemo(
    () => (selectedLoan ? loanInstallments.filter((i) => i.loanId === selectedLoan.id) : []),
    [loanInstallments, selectedLoan]
  );

  const originPayments = useMemo(
    () => (selectedLoan ? payments.filter((p) => p.loanId === selectedLoan.id) : []),
    [payments, selectedLoan]
  );

  const originAccount = useMemo(
    () => (selectedLoan ? collectionAccounts.find((a) => a.loanId === selectedLoan.id) ?? null : null),
    [collectionAccounts, selectedLoan]
  );

  const asOfDateIso = toIsoDateOnly();

  const eligibility = useMemo(() => {
    if (!selectedLoan) return null;
    return evaluateLoanRenewalEligibility({
      loan: selectedLoan,
      installments: originInstallments,
      payments: originPayments,
      existingRenewals: creditRenewals,
      existingApplications: applications,
      customer,
      account: originAccount,
      creditPolicy: activeOrTestPolicy,
      collectionPolicy: activeCollectionPolicy,
      asOfDateIso,
    });
  }, [
    selectedLoan,
    originInstallments,
    originPayments,
    creditRenewals,
    applications,
    customer,
    originAccount,
    activeOrTestPolicy,
    activeCollectionPolicy,
    asOfDateIso,
  ]);

  const [modality, setModality] = useState<RenewalModality>('MISMAS_CONDICIONES');
  const [requestedAmount, setRequestedAmount] = useState<string>('');
  const [requestedTermMonths, setRequestedTermMonths] = useState<string>('');
  const [requestedRatePct, setRequestedRatePct] = useState<string>('');
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>('MENSUAL');
  const [amortizationMethod, setAmortizationMethod] = useState<AmortizationMethod>('SALDO_INSOLUTO');
  const [productCode, setProductCode] = useState<ProductCode>('PERSONAL_DOP');
  const [legalFeeMode, setLegalFeeMode] = useState<LegalFeeApplicationMode>('DESCONTAR_DESEMBOLSO');
  const [proposedCollateral, setProposedCollateral] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<InitiateLoanRenewalResult | null>(null);

  // Sync defaults whenever selected loan or modality switches
  useEffect(() => {
    if (!selectedLoan) return;
    const basePrincipal = Number(
      (selectedLoan.approvedPrincipal || selectedLoan.totalFinancedPrincipal || 0).toFixed(2)
    );
    const rateDec = normalizeMonthlyRateDecimal(selectedLoan.contractualRateMonthly, 0.04);
    setRequestedAmount(String(basePrincipal));
    setRequestedTermMonths(String(selectedLoan.termMonths || 12));
    setRequestedRatePct((rateDec * 100).toFixed(2));
    setPaymentFrequency(selectedLoan.frequency || 'MENSUAL');
    setAmortizationMethod(selectedLoan.amortizationMethod || 'SALDO_INSOLUTO');
    setProductCode(selectedLoan.productCode || 'PERSONAL');
    setLegalFeeMode(originApplication?.legalFeeMode || 'DESCONTAR_DESEMBOLSO');
    setProposedCollateral(originApplication?.proposedCollateral || '');
    setErrorMsg(null);
  }, [selectedLoan, originApplication]);

  const effectiveAmount = useMemo(() => {
    if (!selectedLoan) return 0;
    if (modality === 'MISMAS_CONDICIONES') {
      return Number(
        (selectedLoan.approvedPrincipal || selectedLoan.totalFinancedPrincipal || 0).toFixed(2)
      );
    }
    return Math.max(0, Number(requestedAmount) || 0);
  }, [selectedLoan, modality, requestedAmount]);

  const effectiveTerm = useMemo(() => {
    if (!selectedLoan) return 12;
    if (modality === 'MISMAS_CONDICIONES') return selectedLoan.termMonths;
    return Math.max(1, Math.min(360, Math.round(Number(requestedTermMonths) || selectedLoan.termMonths)));
  }, [selectedLoan, modality, requestedTermMonths]);

  const effectiveRatePct = useMemo(() => {
    if (!selectedLoan) return 4;
    const basePct = normalizeMonthlyRateDecimal(selectedLoan.contractualRateMonthly, 0.04) * 100;
    if (modality === 'MISMAS_CONDICIONES') return basePct;
    const parsed = Number(requestedRatePct);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : basePct;
  }, [selectedLoan, modality, requestedRatePct]);

  const netCalc = useMemo(() => {
    const payoffAmt = eligibility?.payoff.totalPayoffAmount ?? 0;
    return calculateRenewalNetDisbursement({
      grossApprovedAmount: effectiveAmount,
      payoffAmount: payoffAmt,
      otherAuthorizedDiscounts: 0,
    });
  }, [effectiveAmount, eligibility]);

  const canSubmit = Boolean(
    selectedLoan &&
      eligibility?.eligible &&
      netCalc.valid &&
      userProfile &&
      !submitting &&
      !completedResult
  );

  const handleConfirmRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLoan || !userProfile || !eligibility) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await initiateLoanRenewal({
        originLoan: selectedLoan,
        customer,
        business: originBusiness,
        originApplication,
        originInstallments,
        originPayments,
        originCollectionAccount: originAccount,
        existingRenewals: creditRenewals,
        policy: activeOrTestPolicy,
        collectionPolicy: activeCollectionPolicy,
        modality,
        requestedAmount: effectiveAmount,
        requestedTermMonths: effectiveTerm,
        requestedRateMonthly: effectiveRatePct / 100,
        paymentFrequency: modality === 'MISMAS_CONDICIONES' ? selectedLoan.frequency : paymentFrequency,
        amortizationMethod:
          modality === 'MISMAS_CONDICIONES' ? selectedLoan.amortizationMethod : amortizationMethod,
        productCode: modality === 'MISMAS_CONDICIONES' ? selectedLoan.productCode : productCode,
        legalFeeMode,
        proposedCollateral,
        justification,
        asOfDateIso,
        user: userProfile,
      });
      setCompletedResult(res);
      onCompleted?.(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo iniciar la renovación.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNavigateNext = () => {
    if (!completedResult) return;
    setSelectedApplicationId(completedResult.application.id);
    setActiveSection(
      completedResult.renewal.modality === 'MISMAS_CONDICIONES' ? 'committee' : 'evaluation'
    );
    onClose();
  };

  const currency = selectedLoan?.currency || 'DOP';
  const coDebtors = originApplication?.references ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-[#030816]/75 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4">
      <div className="axy-panel-in axy-surface w-full max-w-4xl rounded-2xl border border-[var(--axy-border-strong)] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="axy-infinity-line" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between gap-3 bg-[var(--axy-surface-tonal)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl axy-brand-gradient text-white flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Renovación y Reenganche de Crédito
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {customer.firstName} {customer.lastName} ·{' '}
                <span className="font-mono">
                  {customer.documentType}: {customer.documentNumber}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
            aria-label="Cerrar renovación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success State */}
        {completedResult ? (
          <div className="p-6 space-y-5 overflow-y-auto text-xs">
            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-display text-sm font-bold">
                <CheckCircle2 className="w-5 h-5" />
                <span>Solicitud de Renovación Creada y Vinculada Exitosamente</span>
              </div>
              <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                {completedResult.renewal.modality === 'MISMAS_CONDICIONES'
                  ? `La renovación ${completedResult.renewal.renewalNumber} (Mismas Condiciones) fue enviada directamente a COMITÉ DE CRÉDITOS sin evaluación ordinaria. El préstamo anterior ${completedResult.renewal.originLoanNumber} permanece ACTIVO y solo se liquidará al confirmar el desembolso.`
                  : `La renovación ${completedResult.renewal.renewalNumber} (Aumento o Modificación de Condiciones) fue enviada automáticamente a EVALUACIÓN CREDITICIA con todo el expediente e historial del préstamo ${completedResult.renewal.originLoanNumber}.`}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono tabular-nums">
              <div className="axy-surface-tonal p-3.5 rounded-xl border border-[var(--axy-border)]">
                <p className="font-sans text-[10px] uppercase text-slate-500">N° Renovación</p>
                <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                  {completedResult.renewal.renewalNumber}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {completedResult.application.applicationNumber}
                </p>
              </div>
              <div className="axy-surface-tonal p-3.5 rounded-xl border border-[var(--axy-border)]">
                <p className="font-sans text-[10px] uppercase text-slate-500">Monto Nuevo Solicitado</p>
                <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                  {formatMoney(completedResult.renewal.requestedAmount, currency)}
                </p>
              </div>
              <div className="axy-surface-tonal p-3.5 rounded-xl border border-[var(--axy-border)]">
                <p className="font-sans text-[10px] uppercase text-slate-500">Liquidación Estimada</p>
                <p className="font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                  -{formatMoney(completedResult.renewal.settledPayoffAmount ?? 0, currency)}
                </p>
              </div>
              <div className="axy-surface-tonal p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                <p className="font-sans text-[10px] uppercase text-emerald-700 dark:text-emerald-300">
                  Desembolso Neto Estimado
                </p>
                <p className="font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {formatMoney(completedResult.renewal.netDisbursementAmount ?? 0, currency)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--axy-border)]">
              <button
                type="button"
                onClick={onClose}
                className="axy-btn-secondary px-4 py-2 text-xs font-medium cursor-pointer"
              >
                Permanecer en Clientes
              </button>
              <button
                type="button"
                onClick={handleNavigateNext}
                className="px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <span>
                  {completedResult.renewal.modality === 'MISMAS_CONDICIONES'
                    ? 'Abrir en Comité de Créditos'
                    : 'Abrir en Evaluación'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConfirmRenewal} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-5 space-y-5 overflow-y-auto text-xs flex-1">
              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Step 1: Loan selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-display font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#00B8FF]" />
                    <span>
                      1. Préstamo Vigente a Renovar ({activeLoans.length} activo
                      {activeLoans.length === 1 ? '' : 's'})
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    No se duplica el cliente ni se borra historial
                  </span>
                </div>

                {customerLoans.length === 0 ? (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                    Este cliente no posee préstamos registrados para renovar.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {customerLoans.map((loan) => {
                      const closed = isClosedLoanStatus(loan.status);
                      const isSelected = loan.id === selectedLoanId;
                      return (
                        <button
                          key={loan.id}
                          type="button"
                          onClick={() => setSelectedLoanId(loan.id)}
                          className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'border-[#00B8FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/15 ring-1 ring-[#00B8FF]/40'
                              : closed
                              ? 'border-[var(--axy-border)] opacity-60 hover:opacity-80'
                              : 'border-[var(--axy-border)] hover:bg-[var(--axy-surface-muted)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-bold text-slate-950 dark:text-white">
                              {loan.loanNumber}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                closed
                                  ? 'bg-slate-500/15 text-slate-500'
                                  : loan.status === 'VENCIDO'
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {LOAN_STATUS_LABELS[loan.status] || loan.status}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                            {PRODUCT_LABELS[loan.productCode] || loan.productCode} · Desembolso{' '}
                            {loan.disbursementDate}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between font-mono tabular-nums text-[11px]">
                            <span className="text-slate-500">
                              Original: {formatMoney(loan.approvedPrincipal, loan.currency)}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white">
                              Capital: {formatMoney(loan.currentPrincipalBalance, loan.currency)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Eligibility & Live Payoff Summary */}
              {selectedLoan && eligibility && (
                <>
                  {eligibility.blockingReasons.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-rose-700 dark:text-rose-300 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>Renovación Bloqueada por Política / Concurrencia</span>
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                        {eligibility.blockingReasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {eligibility.warnings.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Alertas de Comportamiento y Política</span>
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                        {eligibility.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Payoff & Payment Behavior */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                    <div className="lg:col-span-7 axy-surface-tonal rounded-xl p-4 border border-[var(--axy-border)] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <h4 className="font-display font-bold text-slate-900 dark:text-white">
                          Saldo Actualizado de Cancelación ({selectedLoan.loanNumber})
                        </h4>
                        <span className="font-mono text-[10px] text-slate-500">Corte {asOfDateIso}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-[11px]">
                        <div className="p-2 rounded-lg bg-white/60 dark:bg-slate-900/40">
                          <span className="block font-sans text-[10px] text-slate-500">Capital</span>
                          <strong className="text-slate-900 dark:text-white">
                            {formatMoney(eligibility.payoff.remainingPrincipal, currency)}
                          </strong>
                        </div>
                        <div className="p-2 rounded-lg bg-white/60 dark:bg-slate-900/40">
                          <span className="block font-sans text-[10px] text-slate-500">Intereses</span>
                          <strong className="text-slate-900 dark:text-white">
                            {formatMoney(eligibility.payoff.remainingInterest, currency)}
                          </strong>
                        </div>
                        <div className="p-2 rounded-lg bg-white/60 dark:bg-slate-900/40">
                          <span className="block font-sans text-[10px] text-slate-500">Mora / Cargos</span>
                          <strong className="text-amber-600 dark:text-amber-400">
                            {formatMoney(
                              eligibility.payoff.remainingLateFee + eligibility.payoff.remainingCharges,
                              currency
                            )}
                          </strong>
                        </div>
                        <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30">
                          <span className="block font-sans text-[10px] text-amber-700 dark:text-amber-300 font-semibold">
                            Total Liquidar
                          </span>
                          <strong className="text-amber-800 dark:text-amber-200">
                            {formatMoney(eligibility.payoff.totalPayoffAmount, currency)}
                          </strong>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {eligibility.behaviorSummary}
                      </p>
                    </div>

                    <div className="lg:col-span-5 axy-surface-tonal rounded-xl p-4 border border-[var(--axy-border)] space-y-2">
                      <h4 className="font-display font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#00B8FF]" />
                        <span>Garantías y Codeudores / Referencias</span>
                      </h4>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        <strong>Garantía:</strong>{' '}
                        {originApplication?.proposedCollateral || 'Sin garantía registrada en expediente previo'}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        <strong>Codeudores / Ref.:</strong>{' '}
                        {coDebtors.length > 0
                          ? coDebtors.map((r) => `${r.name} (${r.relationship || 'Ref.'})`).join(', ')
                          : 'Ninguno registrado'}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        Cuotas pendientes: {eligibility.payoff.unpaidInstallmentsCount} · Vencidas:{' '}
                        {eligibility.payoff.overdueInstallmentsCount} · DPD: {eligibility.payoff.dpd}d
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Two Renewal Modalities */}
                  <div className="space-y-2.5">
                    <h4 className="font-display font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Sliders className="w-4 h-4 text-[#00B8FF]" />
                      <span>2. Seleccionar Modalidad de Renovación</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setModality('MISMAS_CONDICIONES')}
                        className={`text-left p-4 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                          modality === 'MISMAS_CONDICIONES'
                            ? 'border-[#00B8FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/18 ring-1 ring-[#00B8FF]/40'
                            : 'border-[var(--axy-border)] hover:bg-[var(--axy-surface-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-[#00B8FF]" />
                            <span>A. Mismas Condiciones</span>
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                            Directo a Comité
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          Reengancha manteniendo monto, tasa, plazo, frecuencia, producto y garantías actuales. Omite Evaluación ordinaria, manteniendo la autoridad plena del Comité de Créditos.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setModality('AUMENTO_O_MODIFICACION')}
                        className={`text-left p-4 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                          modality === 'AUMENTO_O_MODIFICACION'
                            ? 'border-[#00B8FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/18 ring-1 ring-[#00B8FF]/40'
                            : 'border-[var(--axy-border)] hover:bg-[var(--axy-surface-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                            <FileCheck2 className="w-4 h-4 text-emerald-500" />
                            <span>B. Aumento o Modificación</span>
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            Pasa por Evaluación
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          Permite solicitar mayor monto o cambiar plazo, tasa, frecuencia o garantías. Envía automáticamente a Evaluación Crediticia con el expediente completo del cliente.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Step 3: New Conditions (Editable for Modality B, Read-only summary for Modality A) */}
                  {modality === 'AUMENTO_O_MODIFICACION' && (
                    <div className="p-4 rounded-xl axy-surface-tonal border border-[var(--axy-border)] space-y-3">
                      <h4 className="font-display font-bold text-slate-900 dark:text-white">
                        3. Nuevas Condiciones Propuestas para Evaluación
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Monto Nuevo Solicitado ({currency}) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min={1}
                            required
                            value={requestedAmount}
                            onChange={(e) => setRequestedAmount(e.target.value)}
                            className="axy-input w-full px-3 py-2 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Plazo (Meses) *
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={360}
                            required
                            value={requestedTermMonths}
                            onChange={(e) => setRequestedTermMonths(e.target.value)}
                            className="axy-input w-full px-3 py-2 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Tasa Mensual (%)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min={0.1}
                            max={30}
                            value={requestedRatePct}
                            onChange={(e) => setRequestedRatePct(e.target.value)}
                            className="axy-input w-full px-3 py-2 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Frecuencia de Pago
                          </label>
                          <select
                            value={paymentFrequency}
                            onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}
                            className="axy-input w-full px-3 py-2"
                          >
                            {FREQUENCY_OPTIONS.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Modalidad de Interés
                          </label>
                          <select
                            value={amortizationMethod}
                            onChange={(e) =>
                              setAmortizationMethod(e.target.value as AmortizationMethod)
                            }
                            className="axy-input w-full px-3 py-2"
                          >
                            <option value="SALDO_INSOLUTO">Saldo Insoluto</option>
                            <option value="INTERES_FIJO">Interés Fijo</option>
                          </select>
                        </div>
                        <div>
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Producto Crediticio
                          </label>
                          <select
                            value={productCode}
                            onChange={(e) => setProductCode(e.target.value as ProductCode)}
                            className="axy-input w-full px-3 py-2"
                          >
                            {PRODUCT_OPTIONS.map((p) => (
                              <option key={p} value={p}>
                                {PRODUCT_LABELS[p] || p}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-3">
                          <label className="block mb-1 text-slate-500 dark:text-slate-400">
                            Garantías Propuestas / Modificadas
                          </label>
                          <input
                            value={proposedCollateral}
                            onChange={(e) => setProposedCollateral(e.target.value)}
                            placeholder="Descripción de garantía vigente o adicional..."
                            className="axy-input w-full px-3 py-2"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Side-by-side comparison & Net Disbursement Box */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                    <div className="lg:col-span-6 p-4 rounded-xl border border-[var(--axy-border)] bg-[var(--axy-surface-tonal)] space-y-2">
                      <h4 className="font-display font-bold text-slate-900 dark:text-white">
                        Comparativa: Condiciones Actuales vs Renovación
                      </h4>
                      <div className="grid grid-cols-3 gap-2 text-[11px] border-b border-[var(--axy-border)] pb-1.5 font-semibold text-slate-500">
                        <span>Concepto</span>
                        <span>Actual ({selectedLoan.loanNumber})</span>
                        <span className="text-[#0066FF] dark:text-[#00B8FF]">Nueva Propuesta</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                        <span className="font-sans text-slate-500">Monto</span>
                        <span>{formatMoney(selectedLoan.approvedPrincipal, currency)}</span>
                        <strong className="text-slate-950 dark:text-white">
                          {formatMoney(effectiveAmount, currency)}
                        </strong>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                        <span className="font-sans text-slate-500">Tasa Mensual</span>
                        <span>
                          {(
                            normalizeMonthlyRateDecimal(selectedLoan.contractualRateMonthly, 0.04) *
                            100
                          ).toFixed(2)}
                          %
                        </span>
                        <strong className="text-slate-950 dark:text-white">
                          {effectiveRatePct.toFixed(2)}%
                        </strong>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                        <span className="font-sans text-slate-500">Plazo / Frec.</span>
                        <span>
                          {selectedLoan.termMonths}m · {selectedLoan.frequency}
                        </span>
                        <strong className="text-slate-950 dark:text-white">
                          {effectiveTerm}m ·{' '}
                          {modality === 'MISMAS_CONDICIONES'
                            ? selectedLoan.frequency
                            : paymentFrequency}
                        </strong>
                      </div>
                    </div>

                    <div
                      className={`lg:col-span-6 p-4 rounded-xl border space-y-2 ${
                        netCalc.valid
                          ? 'border-emerald-500/35 bg-emerald-500/5'
                          : 'border-rose-500/40 bg-rose-500/10'
                      }`}
                    >
                      <h4 className="font-display font-bold text-slate-900 dark:text-white flex items-center justify-between">
                        <span>Cálculo Obligatorio de Desembolso Neto</span>
                        {netCalc.valid ? (
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-rose-500" />
                        )}
                      </h4>
                      <div className="space-y-1 font-mono tabular-nums text-[11px]">
                        <div className="flex justify-between">
                          <span className="font-sans text-slate-600 dark:text-slate-300">
                            Monto Nuevo Solicitado:
                          </span>
                          <span className="font-semibold">{formatMoney(effectiveAmount, currency)}</span>
                        </div>
                        <div className="flex justify-between text-amber-700 dark:text-amber-300">
                          <span className="font-sans">(-) Saldo Liquidación Préstamo Anterior:</span>
                          <span className="font-semibold">
                            -{formatMoney(netCalc.payoffAmount, currency)}
                          </span>
                        </div>
                        <div className="pt-1.5 mt-1.5 border-t border-[var(--axy-border)] flex justify-between text-sm">
                          <span className="font-sans font-bold text-slate-950 dark:text-white">
                            Desembolso Neto Estimado:
                          </span>
                          <span
                            className={`font-bold ${
                              netCalc.valid
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {formatMoney(netCalc.netDisbursementAmount, currency)}
                          </span>
                        </div>
                      </div>
                      {!netCalc.valid && (
                        <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                          {netCalc.reason}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        * El saldo definitivo se recalculará automáticamente el día del desembolso (incluyendo gastos de formalización si se descuentan). El préstamo anterior permanece ACTIVO hasta la ejecución exitosa del desembolso.
                      </p>
                    </div>
                  </div>

                  {/* Justification */}
                  <div>
                    <label className="block mb-1 text-slate-600 dark:text-slate-300 font-medium">
                      Observaciones / Justificación Comercial (opcional)
                    </label>
                    <textarea
                      rows={2}
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      placeholder="Motivo de la renovación, destino de fondos adicionales o notas para Evaluación / Comité..."
                      className="axy-input w-full px-3 py-2 text-xs"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-[var(--axy-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--axy-surface-tonal)]">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Ruta:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {modality === 'MISMAS_CONDICIONES'
                    ? 'Directo a Comité de Créditos'
                    : 'Evaluación → Comité → Formalización → Desembolso'}
                </strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="axy-btn-secondary px-4 py-2 text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${submitting ? 'animate-spin' : ''}`} />
                  <span>
                    {submitting
                      ? 'Procesando renovación...'
                      : modality === 'MISMAS_CONDICIONES'
                      ? 'Enviar Renovación a Comité'
                      : 'Enviar Renovación a Evaluación'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
