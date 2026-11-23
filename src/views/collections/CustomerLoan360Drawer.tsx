import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileText,
  Handshake,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useAxyCore } from '../../context/AxyCoreContext';
import { PaymentEvidencePreviewModal } from '../../components/PaymentEvidencePreviewModal';
import { PaymentReceiptModal } from '../../components/PaymentReceiptModal';
import {
  computeInstallmentRemaining,
  evaluateLoanDelinquency,
  getSantoDomingoTodayIso,
} from '../../engine/collections/delinquencyEngine';
import { validateLoanCancellationEligibility } from '../../engine/collections/botAndSentinelEngine';
import { validateContactPermission } from '../../engine/collections/promisesAndActionsEngine';
import {
  attachPaymentEvidence,
  correctClosedCollectionAction,
  executeFormalLoanClosureTransaction,
  openCustomerDispute,
  recordCollectionAction,
  reportPaymentPendingVerification,
  resolveCustomerDispute,
  reverseAppliedPaymentTransaction,
  updateCustomerWhatsAppConsent,
} from '../../services/collectionsStore';
import type {
  CollectionChannel,
  CollectionContactResult,
  CollectionReceiptRecord,
  DisputeType,
  PaymentChannelMethod,
  PaymentRecord,
} from '../../types/axycore';
import { formatMoney, formatTimestamp, PRODUCT_LABELS } from '../../utils/formatters';
import {
  formatEvidenceFileSize,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
  processPaymentEvidenceFile,
  type EncodedPaymentEvidence,
} from '../../utils/paymentEvidence';
import { PaymentAgreementModal } from './PaymentAgreementModal';

interface Props {
  loanId: string | null;
  onClose: () => void;
}

type DrawerTab = 'cuotas' | 'gestiones' | 'pagos' | 'bot_alertas' | 'cierre';

export function CustomerLoan360Drawer({ loanId, onClose }: Props) {
  const {
    userProfile,
    organization,
    loans,
    loanInstallments,
    customers,
    businesses,
    applications,
    collectionAccounts,
    collectionActions,
    paymentPromises,
    paymentAgreements,
    payments,
    paymentAllocations,
    collectionReceipts,
    messageEvents,
    riskAlerts,
    customerDisputes,
    reconciliationExceptions,
    activeCollectionPolicy,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const [tab, setTab] = useState<DrawerTab>('cuotas');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Quick action form state
  const [actionChannel, setActionChannel] = useState<CollectionChannel>('LLAMADA');
  const [contactResult, setContactResult] = useState<CollectionContactResult>('CONTACTO_EFECTIVO_PROMESA');
  const [actionNotes, setActionNotes] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [withPromise, setWithPromise] = useState(false);
  const [promisedAmount, setPromisedAmount] = useState('');
  const [promisedDate, setPromisedDate] = useState(getSantoDomingoTodayIso());

  // Corrective action modal inline state
  const [correctingActionId, setCorrectingActionId] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctedNotes, setCorrectedNotes] = useState('');

  // Report payment state
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getSantoDomingoTodayIso());
  const [payMethod, setPayMethod] = useState<PaymentChannelMethod>('TRANSFERENCIA');
  const [payBank, setPayBank] = useState('Banco Popular');
  const [payRef, setPayRef] = useState('');
  const [payEvidenceFile, setPayEvidenceFile] = useState<EncodedPaymentEvidence | null>(null);
  const [payEvidenceError, setPayEvidenceError] = useState<string | null>(null);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [previewPayment, setPreviewPayment] = useState<PaymentRecord | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<CollectionReceiptRecord | null>(null);
  const [payNotes, setPayNotes] = useState('');

  // Reversal inline state
  const [reversingPayId, setReversingPayId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  // Dispute form state
  const [disputeType, setDisputeType] = useState<DisputeType>('PAGO_NO_REFLEJADO');
  const [disputeDesc, setDisputeDesc] = useState('');
  const [disputePauseBot, setDisputePauseBot] = useState(true);
  const [agreementModalOpen, setAgreementModalOpen] = useState(false);

  const loan = useMemo(() => loans.find((l) => l.id === loanId) ?? null, [loans, loanId]);
  const customer = useMemo(
    () => (loan ? customers.find((c) => c.id === loan.customerId) ?? null : null),
    [loan, customers]
  );
  const application = useMemo(
    () => (loan ? applications.find((a) => a.id === loan.applicationId) ?? null : null),
    [loan, applications]
  );
  const business = useMemo(
    () =>
      application?.businessId
        ? businesses.find((b) => b.id === application.businessId) ?? null
        : null,
    [application, businesses]
  );

  const insts = useMemo(
    () =>
      loan
        ? loanInstallments
            .filter((i) => i.loanId === loan.id)
            .sort((a, b) => a.installmentNumber - b.installmentNumber)
        : [],
    [loan, loanInstallments]
  );

  const loanPromises = useMemo(
    () => (loan ? paymentPromises.filter((p) => p.loanId === loan.id) : []),
    [loan, paymentPromises]
  );
  const loanPayments = useMemo(
    () =>
      loan
        ? payments
            .filter((p) => p.loanId === loan.id)
            .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''))
        : [],
    [loan, payments]
  );
  const loanActions = useMemo(
    () =>
      loan
        ? collectionActions
            .filter((a) => a.loanId === loan.id)
            .sort((a, b) => (b.actionTimeIso || '').localeCompare(a.actionTimeIso || ''))
        : [],
    [loan, collectionActions]
  );
  const loanDisputes = useMemo(
    () => (loan ? customerDisputes.filter((d) => d.loanId === loan.id) : []),
    [loan, customerDisputes]
  );
  const loanAlerts = useMemo(
    () => (loan ? riskAlerts.filter((a) => a.loanId === loan.id) : []),
    [loan, riskAlerts]
  );
  const loanMessages = useMemo(
    () => (loan ? messageEvents.filter((m) => m.loanId === loan.id) : []),
    [loan, messageEvents]
  );
  const loanReceipts = useMemo(
    () => (loan ? collectionReceipts.filter((r) => r.loanId === loan.id) : []),
    [loan, collectionReceipts]
  );
  const loanAgreements = useMemo(
    () => (loan ? paymentAgreements.filter((a) => a.loanId === loan.id) : []),
    [loan, paymentAgreements]
  );

  const storedAccount = useMemo(
    () => (loan ? collectionAccounts.find((a) => a.loanId === loan.id) ?? null : null),
    [loan, collectionAccounts]
  );

  const liveEval = useMemo(() => {
    if (!loan) return null;
    return evaluateLoanDelinquency({
      loan,
      installments: insts,
      customer,
      policy: activeCollectionPolicy,
      asOfDateIso: getSantoDomingoTodayIso(),
      existingAccount: storedAccount,
      promises: loanPromises,
      payments: loanPayments,
      actions: loanActions,
      disputes: loanDisputes,
    });
  }, [
    loan,
    insts,
    customer,
    activeCollectionPolicy,
    storedAccount,
    loanPromises,
    loanPayments,
    loanActions,
    loanDisputes,
  ]);

  const account = liveEval?.account ?? storedAccount;

  const contactGuard = useMemo(() => {
    if (!loan) return null;
    return validateContactPermission({
      loanId: loan.id,
      policy: activeCollectionPolicy,
      actions: loanActions,
      messageEvents: loanMessages,
      disputes: loanDisputes,
      isAutomatedBot: false,
    });
  }, [loan, activeCollectionPolicy, loanActions, loanMessages, loanDisputes]);

  const closureCheck = useMemo(() => {
    if (!loan) return null;
    return validateLoanCancellationEligibility({
      loan,
      installments: insts,
      payments: loanPayments,
      disputes: loanDisputes,
      exceptions: reconciliationExceptions,
    });
  }, [loan, insts, loanPayments, loanDisputes, reconciliationExceptions]);

  if (!loanId || !loan || !account) return null;

  const openReceiptPreview = (receipt: CollectionReceiptRecord) => {
    setPreviewReceipt(receipt);
  };

  const downloadClosureCertificatePdf = () => {
    const docPdf = new jsPDF({ unit: 'pt', format: 'a4' });
    docPdf.setFillColor(15, 61, 145);
    docPdf.rect(0, 0, 595, 76, 'F');
    docPdf.setTextColor(255, 255, 255);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(15);
    docPdf.text(organization.name, 36, 32);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(10);
    docPdf.text('CERTIFICADO FORMAL DE CANCELACIÓN Y CIERRE DE PRÉSTAMO', 36, 54);

    docPdf.setTextColor(15, 23, 42);
    docPdf.setFontSize(11);
    const certNum = loan.closureCertificateNumber || closureCheck?.certificateNumber || `CERT-${loan.loanNumber}`;
    const body = [
      `Número de Certificado: ${certNum}`,
      `Préstamo: ${loan.loanNumber} (${PRODUCT_LABELS[loan.productCode]})`,
      `Cliente / Titular: ${loan.applicantDisplayName}`,
      `Capital Original Desembolsado: ${formatMoney(loan.totalFinancedPrincipal, loan.currency)}`,
      `Capital Pagado Acumulado: ${formatMoney(loan.paidPrincipalTotal ?? loan.totalFinancedPrincipal, loan.currency)}`,
      `Saldo Capital Actual: ${formatMoney(loan.currentPrincipalBalance, loan.currency)}`,
      `Estado del Préstamo: ${loan.status}`,
      `Fecha de Cierre Formal: ${loan.closedAt ? formatTimestamp(loan.closedAt) : getSantoDomingoTodayIso()}`,
    ];
    let y = 114;
    for (const ln of body) {
      docPdf.text(ln, 36, y);
      y += 24;
    }
    docPdf.setFontSize(9);
    docPdf.setTextColor(100, 116, 139);
    docPdf.text(
      'Este certificado acredita el saldo cero y la cancelación formal de obligaciones contractuales en AxyCore.',
      36,
      y + 20
    );
    docPdf.save(`${certNum}.pdf`);
  };

  const handleLogAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await recordCollectionAction({
        account,
        user: userProfile,
        channel: actionChannel,
        contactResult,
        notes: actionNotes,
        nextActionDate: nextActionDate || null,
        createPromise:
          withPromise && Number(promisedAmount) > 0 && promisedDate
            ? {
                promisedAmount: Number(promisedAmount),
                promisedDate,
                notes: actionNotes,
              }
            : null,
        policy: activeCollectionPolicy,
        existingActions: loanActions,
        disputes: loanDisputes,
      });
      setActionNotes('');
      setWithPromise(false);
      setPromisedAmount('');
      setFeedback({ type: 'ok', msg: 'Gestión registrada (inmutable) en la bitácora de cobranza.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error registrando gestión.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCorrectAction = async (origId: string) => {
    const orig = loanActions.find((a) => a.id === origId);
    if (!orig || !userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await correctClosedCollectionAction({
        originalAction: orig,
        user: userProfile,
        correctedResult: orig.contactResult,
        correctedNotes,
        correctionReason,
      });
      setCorrectingActionId(null);
      setCorrectionReason('');
      setCorrectedNotes('');
      setFeedback({ type: 'ok', msg: 'Gestión correctiva vinculada registrada sin sobrescribir la original.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error registrando corrección.' });
    } finally {
      setBusy(false);
    }
  };

  const handlePayEvidenceSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setPayEvidenceError(null);
    if (!file) return;
    try {
      const encoded = await processPaymentEvidenceFile(file);
      setPayEvidenceFile(encoded);
    } catch (err) {
      setPayEvidenceError(
        err instanceof Error ? err.message : 'No se pudo procesar el comprobante.'
      );
    }
  };

  const handleInlineAttachEvidence = async (
    pay: PaymentRecord,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userProfile) return;
    setUploadingPaymentId(pay.id);
    setFeedback(null);
    try {
      const encoded = await processPaymentEvidenceFile(file);
      await attachPaymentEvidence({
        payment: pay,
        evidence: encoded,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `Comprobante "${encoded.fileName}" adjuntado y enviado a Contabilidad → Pagos para Validación.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error subiendo comprobante.',
      });
    } finally {
      setUploadingPaymentId(null);
    }
  };

  const handleReportPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await reportPaymentPendingVerification({
        loan,
        amount: Number(payAmount),
        paymentDate: payDate,
        method: payMethod,
        bankName: payBank,
        referenceNumber: payRef,
        receiptEvidenceName: payEvidenceFile?.fileName || '',
        receiptEvidenceMimeType: payEvidenceFile?.mimeType,
        receiptEvidenceSizeBytes: payEvidenceFile?.sizeBytes,
        receiptEvidenceDataUrl: payEvidenceFile?.dataUrl,
        notes: payNotes,
        user: userProfile,
      });
      setPayAmount('');
      setPayRef('');
      setPayEvidenceFile(null);
      setPayEvidenceError(null);
      setPayNotes('');
      setFeedback({
        type: 'ok',
        msg: 'Pago registrado y enviado a Contabilidad → Pagos para Validación. El saldo del cliente y su préstamo se actualizarán únicamente al presionar Validar.',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error reportando pago.' });
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || disputeDesc.trim().length < 5) return;
    setBusy(true);
    setFeedback(null);
    try {
      await openCustomerDispute({
        account,
        disputeType,
        description: disputeDesc,
        pauseAutomatedMessages: disputePauseBot,
        user: userProfile,
      });
      setDisputeDesc('');
      setFeedback({
        type: 'ok',
        msg: disputePauseBot
          ? 'Reclamación abierta y envíos automáticos pausados.'
          : 'Reclamación registrada.',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error abriendo reclamación.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#030816]/65 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="axy-drawer-in axy-surface relative w-full max-w-4xl h-full overflow-y-auto border-l border-[var(--axy-border-strong)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="axy-infinity-line shrink-0" />
        {/* Top Bar */}
        <div className="sticky top-0 z-20 bg-[var(--axy-surface)]/95 backdrop-blur-md border-b border-[var(--axy-border)] px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-[#0066FF] dark:text-[#00D1FF]">
              <span>FICHA 360°</span>
              <span>·</span>
              <span>{loan.loanNumber}</span>
              <span>·</span>
              <span>{loan.currency}</span>
            </div>
            <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white truncate">
              {loan.applicantDisplayName}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {PRODUCT_LABELS[loan.productCode]} · Estado Préstamo:{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">{loan.status}</span> ·
              Etapa Cobranza:{' '}
              <span className="font-semibold text-slate-800 dark:text-slate-200">{account.stage}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="axy-btn-secondary p-2 text-slate-500 cursor-pointer"
            aria-label="Cerrar Ficha 360"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div className="px-6 py-4 bg-[var(--axy-surface-tonal)] border-b border-[var(--axy-border)] grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Saldo Capital</p>
            <p className="font-mono tabular-nums font-bold text-sm text-slate-950 dark:text-white mt-0.5">
              {formatMoney(loan.currentPrincipalBalance, loan.currency)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Total Vencido</p>
            <p className="font-mono tabular-nums font-bold text-sm text-rose-700 dark:text-rose-400">
              {formatMoney(account.overdueTotalAmount, loan.currency)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Días Atraso (DPD)</p>
            <p className="font-mono tabular-nums font-bold text-sm text-slate-900 dark:text-white">
              {account.dpd} d (Máx: {account.maxHistoricalDpd})
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Pendiente Verificar</p>
            <p className="font-mono tabular-nums font-bold text-sm text-amber-700 dark:text-amber-400">
              {formatMoney(account.pendingVerificationAmount, loan.currency)}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Comportamiento / V2</p>
            <p className="font-mono tabular-nums font-bold text-sm text-[#0052CC] dark:text-[#00D1FF]">
              {account.behaviorScore} ({account.behaviorBand})
            </p>
          </div>
        </div>

        {/* Customer & Origination Context Banner */}
        <div className="px-6 py-3 border-b border-[var(--axy-border)] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-[var(--axy-surface)]">
          <div>
            <p className="text-slate-500">Contacto Maestro</p>
            <p className="font-medium">
              Tel: {customer?.phone || '—'} · {customer?.email || 'Sin email'}
            </p>
            <p className="text-slate-500">
              {customer?.province || '—'}{customer?.municipality ? `, ${customer.municipality}` : ''}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Originación Vinculada</p>
            <p className="font-mono">
              Solicitud: {application?.applicationNumber || loan.applicationId}
            </p>
            <p className="text-slate-500">
              Score V2 Originación: {application?.latestScore ?? '—'} · Tasa {(loan.contractualRateMonthly * 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-slate-500">Gestor Asignado / Negocio</p>
            <p className="font-medium">{account.assignedCollectorName || 'Sin asignar'}</p>
            <p className="text-slate-500">
              {business ? `${business.legalName} (${business.rnc})` : 'Banca Personal'}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-[var(--axy-border)] flex flex-wrap gap-2 text-xs">
          {[
            { id: 'cuotas', label: `Cuotas (${insts.length})` },
            { id: 'gestiones', label: `Gestiones (${loanActions.length}) & Promesas (${loanPromises.length})` },
            { id: 'pagos', label: `Pagos (${loanPayments.length}) & Recibos (${loanReceipts.length})` },
            { id: 'bot_alertas', label: `Bot (${loanMessages.length}) · Alertas (${loanAlerts.length}) · Reclamos (${loanDisputes.length})` },
            { id: 'cierre', label: 'Cierre / Cancelación Formal' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as DrawerTab)}
              className={`px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === t.id
                  ? 'border-[#0066FF] dark:border-[#00D1FF] text-[#0052CC] dark:text-[#00D1FF]'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-5 text-xs flex-1">
          {feedback && (
            <div
              className={`p-3 rounded-xl border ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              {feedback.msg}
            </div>
          )}

          {tab === 'cuotas' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold">
                  Calendario Contractual e Imputación de Pagos
                </h3>
                <span className="text-slate-500">
                  Mora política: {activeCollectionPolicy.lateFeeRateMonthlyPct}% mensual tras {activeCollectionPolicy.graceDays}d de gracia
                </span>
              </div>
              <div className="overflow-x-auto axy-surface-tonal rounded-xl">
                <table className="w-full text-left">
                  <thead>
                    <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3 font-semibold">#</th>
                      <th className="py-2.5 px-3 font-semibold">Vence</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Capital</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Interés</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Mora</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Pagado</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Pendiente</th>
                      <th className="py-2.5 px-3 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {(liveEval?.updatedInstallments ?? insts).map((inst) => {
                      const rem = computeInstallmentRemaining(inst);
                      const paidSum =
                        (inst.paidPrincipal ?? 0) +
                        (inst.paidInterest ?? 0) +
                        (inst.paidOtherCharges ?? 0) +
                        (inst.paidLateFee ?? 0);
                      return (
                        <tr key={inst.id} className="axy-table-row">
                          <td className="py-2 px-3">{inst.installmentNumber}</td>
                          <td className="py-2 px-3">{inst.dueDate}</td>
                          <td className="py-2 px-3 text-right">{formatMoney(inst.principalAmount, loan.currency)}</td>
                          <td className="py-2 px-3 text-right">{formatMoney(inst.interestAmount, loan.currency)}</td>
                          <td className="py-2 px-3 text-right text-rose-700 dark:text-rose-400">
                            {loan.lateFeeExempt ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-sans text-[11px] font-medium">
                                Exenta
                              </span>
                            ) : (
                              <div>
                                <span>{formatMoney(rem.remLateFee, loan.currency)}</span>
                                {(inst.waivedLateFee ?? 0) > 0 && (
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans">
                                    Desc. {formatMoney(inst.waivedLateFee ?? 0, loan.currency)}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-700 dark:text-emerald-400">
                            {formatMoney(paidSum, loan.currency)}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold">
                            {formatMoney(rem.totalRemaining, loan.currency)}
                          </td>
                          <td className="py-2 px-3 font-sans font-semibold">{inst.status}</td>
                        </tr>
                      );
                    })}
                    {insts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-4 text-center text-slate-500 font-sans">
                          No se encontraron cuotas cargadas. Ejecuta «Sincronizar Cartera» en el Dashboard de Cobranza.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'gestiones' && (
            <div className="space-y-5">
              {rbac.hasPermission('LOG_COLLECTION_ACTIONS') && (
                <form
                  onSubmit={handleLogAction}
                  className="axy-surface-tonal p-4 rounded-xl space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                      <PhoneCall className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                      Registrar Gestión de Cobranza
                    </h4>
                    {contactGuard && (
                      <span
                        className={`font-mono ${
                          contactGuard.allowed ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        Contactos hoy: {contactGuard.dailyContactsCount}/{contactGuard.maxDailyContacts}
                        {!contactGuard.allowed && ` · ${contactGuard.reason}`}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-slate-500">Canal</label>
                      <select
                        value={actionChannel}
                        onChange={(e) => setActionChannel(e.target.value as CollectionChannel)}
                        className="axy-input w-full px-2.5 py-2"
                      >
                        <option value="LLAMADA">Llamada</option>
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="VISITA_CAMPO">Visita de Campo</option>
                        <option value="SMS">SMS</option>
                        <option value="EMAIL">Email</option>
                        <option value="OFICINA">Oficina</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500">Resultado</label>
                      <select
                        value={contactResult}
                        onChange={(e) => setContactResult(e.target.value as CollectionContactResult)}
                        className="axy-input w-full px-2.5 py-2"
                      >
                        <option value="CONTACTO_EFECTIVO_PROMESA">Contacto efectivo con promesa</option>
                        <option value="CONTACTO_SIN_ACUERDO">Contacto sin acuerdo</option>
                        <option value="SOLICITA_REESTRUCTURACION">Solicita reestructuración</option>
                        <option value="RECLAMACION_CLIENTE">Reclamación de cliente</option>
                        <option value="NO_CONTESTA">No contesta</option>
                        <option value="BUZON">Buzón</option>
                        <option value="NUMERO_EQUIVOCADO_O_INACTIVO">Número equivocado / inactivo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500">Próximo seguimiento</label>
                      <input
                        type="date"
                        value={nextActionDate}
                        onChange={(e) => setNextActionDate(e.target.value)}
                        className="axy-input w-full px-2.5 py-2 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block mb-1 text-slate-500">Bitácora de conversación / evidencia *</label>
                    <textarea
                      rows={2}
                      required
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Detalle objetivo de la gestión..."
                      className="axy-input w-full px-2.5 py-2"
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={withPromise}
                      onChange={(e) => setWithPromise(e.target.checked)}
                    />
                    Incluir Promesa de Pago Formal (sujeta a verificación real en Finanzas)
                  </label>

                  {withPromise && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block mb-1 text-slate-500">Monto Prometido ({loan.currency})</label>
                        <input
                          type="number"
                          step="0.01"
                          value={promisedAmount}
                          onChange={(e) => setPromisedAmount(e.target.value)}
                          className="axy-input w-full px-2.5 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Fecha Promesa</label>
                        <input
                          type="date"
                          value={promisedDate}
                          onChange={(e) => setPromisedDate(e.target.value)}
                          className="axy-input w-full px-2.5 py-2 font-mono"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy || (contactGuard ? !contactGuard.allowed : false)}
                      className="axy-btn-primary px-4 py-2 cursor-pointer disabled:opacity-50"
                    >
                      {busy ? 'Guardando...' : 'Registrar Gestión Cerrada'}
                    </button>
                  </div>
                </form>
              )}

              {/* Promises & Agreements */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="axy-surface rounded-xl p-4 space-y-2">
                  <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                    <Handshake className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    Promesas de Pago ({loanPromises.length})
                  </h4>
                  {loanPromises.length === 0 ? (
                    <p className="text-slate-500">Sin promesas registradas.</p>
                  ) : (
                    loanPromises.map((p) => (
                      <div key={p.id} className="axy-surface-tonal p-2.5 rounded-lg">
                        <div className="flex justify-between font-semibold">
                          <span className="font-mono">{formatMoney(p.promisedAmount, p.currency)}</span>
                          <span>{p.status}</span>
                        </div>
                        <p className="text-slate-500 font-mono">Fecha: {p.promisedDate} · Por {p.createdByUserName}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="axy-surface rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-bold">Acuerdos y Reestructuraciones ({loanAgreements.length})</h4>
                    {loan.status !== 'CANCELADO' &&
                      (rbac.hasPermission('MANAGE_PROMISES') ||
                        rbac.hasPermission('LOG_COLLECTION_ACTIONS') ||
                        rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS')) && (
                        <button
                          type="button"
                          onClick={() => setAgreementModalOpen(true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#040C1E] border border-[#00B8FF]/30 text-[#00D1FF] font-semibold cursor-pointer"
                        >
                          <Handshake className="w-3.5 h-3.5" />
                          Registrar Acuerdo
                        </button>
                      )}
                  </div>
                  {loanAgreements.length === 0 ? (
                    <p className="text-slate-500">Sin acuerdos especiales registrados.</p>
                  ) : (
                    loanAgreements.map((agr) => (
                      <div key={agr.id} className="axy-surface-tonal p-2.5 rounded-lg">
                        <div className="flex justify-between font-semibold">
                          <span>{agr.agreementType} · Vence {agr.firstDueDate}</span>
                          <span>{agr.status}</span>
                        </div>
                        <p className="font-mono text-slate-500">
                          {formatMoney(agr.totalAgreedAmount, agr.currency)} · {agr.installmentCount} cuotas
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <PaymentAgreementModal
                account={agreementModalOpen ? account : null}
                onClose={() => setAgreementModalOpen(false)}
                onSaved={(msg) => setFeedback({ type: 'ok', msg })}
              />

              {/* Immutable Action Timeline */}
              <div className="space-y-2">
                <h4 className="font-display text-sm font-bold">Historial Inmutable de Gestiones</h4>
                {loanActions.map((act) => (
                  <div
                    key={act.id}
                    className="axy-surface p-3 rounded-xl space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {act.channel} · {act.contactResult}
                        {act.correctsActionId && (
                          <span className="ml-2 text-[#0052CC] dark:text-[#00D1FF]">
                            (Corrige {act.correctsActionId})
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-slate-500">
                        {formatTimestamp(act.actionTimeIso)} · {act.dpdAtAction} DPD
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{act.notes}</p>
                    <div className="flex items-center justify-between text-slate-500">
                      <span>Gestor: {act.collectorName} · Registro cerrado inmutable</span>
                      {rbac.hasPermission('LOG_COLLECTION_ACTIONS') && !act.supersededByActionId && (
                        <button
                          type="button"
                          onClick={() => {
                            setCorrectingActionId(act.id);
                            setCorrectedNotes(act.notes);
                          }}
                          className="text-[#0052CC] dark:text-[#00D1FF] font-semibold hover:underline cursor-pointer"
                        >
                          Registrar corrección vinculada
                        </button>
                      )}
                    </div>
                    {correctingActionId === act.id && (
                      <div className="pt-2 border-t border-[var(--axy-border)] space-y-2">
                        <input
                          value={correctionReason}
                          onChange={(e) => setCorrectionReason(e.target.value)}
                          placeholder="Motivo obligatorio de corrección..."
                          className="axy-input w-full px-2.5 py-1.5"
                        />
                        <textarea
                          rows={2}
                          value={correctedNotes}
                          onChange={(e) => setCorrectedNotes(e.target.value)}
                          className="axy-input w-full px-2.5 py-1.5"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setCorrectingActionId(null)}
                            className="axy-btn-secondary px-3 py-1 cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCorrectAction(act.id)}
                            className="axy-btn-primary px-3 py-1 cursor-pointer"
                          >
                            Guardar Corrección
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'pagos' && (
            <div className="space-y-5">
              {(rbac.hasPermission('REPORT_PAYMENTS') || rbac.hasPermission('VERIFY_AND_APPLY_PAYMENTS')) &&
                loan.status !== 'CANCELADO' && (
                  <form
                    onSubmit={handleReportPayment}
                    className="axy-surface-tonal p-4 rounded-xl space-y-3"
                  >
                    <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                      Reportar Pago / Comprobante (Pendiente de Verificación en Finanzas)
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block mb-1 text-slate-500">Monto ({loan.currency}) *</label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          className="axy-input w-full px-2.5 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Fecha *</label>
                        <input
                          type="date"
                          required
                          value={payDate}
                          onChange={(e) => setPayDate(e.target.value)}
                          className="axy-input w-full px-2.5 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Método</label>
                        <select
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value as PaymentChannelMethod)}
                          className="axy-input w-full px-2.5 py-2"
                        >
                          <option value="TRANSFERENCIA">Transferencia</option>
                          <option value="DEPOSITO">Depósito</option>
                          <option value="CAJA_EFECTIVO">Caja / Efectivo</option>
                          <option value="TARJETA">Tarjeta</option>
                          <option value="LINK_PAGO">Link de Pago</option>
                        </select>
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Banco</label>
                        <input
                          value={payBank}
                          onChange={(e) => setPayBank(e.target.value)}
                          className="axy-input w-full px-2.5 py-2"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Referencia Bancaria *</label>
                        <input
                          required
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                          placeholder="Ej. REF-998811"
                          className="axy-input w-full px-2.5 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500">Comprobante (Opcional · Imagen/PDF)</label>
                        <label className="inline-flex items-center justify-center gap-1.5 w-full px-2.5 py-2 rounded-xl border border-dashed border-[var(--axy-border-strong)] bg-[var(--axy-surface)] hover:border-[#0066FF] dark:hover:border-[#00D1FF] cursor-pointer font-medium transition-colors">
                          <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                          <span className="truncate">
                            {payEvidenceFile
                              ? `${payEvidenceFile.fileName} (${formatEvidenceFileSize(payEvidenceFile.sizeBytes)})`
                              : 'Subir Comprobante'}
                          </span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={(e) => void handlePayEvidenceSelect(e)}
                            className="hidden"
                          />
                        </label>
                        {payEvidenceError && (
                          <p className="text-[11px] text-rose-600 mt-1">{payEvidenceError}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">
                        Control contable: el pago pasará a <strong>Contabilidad → Pagos para Validación</strong> y no afectará el saldo hasta ser validado.
                      </span>
                      <button
                        type="submit"
                        disabled={busy}
                        className="axy-btn-primary px-4 py-2 shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        Registrar Pago
                      </button>
                    </div>
                  </form>
                )}

              <div className="space-y-2">
                <h4 className="font-display text-sm font-bold">Historial de Pagos y Recibos Oficiales</h4>
                {loanPayments.map((pay) => {
                  const receipt = loanReceipts.find((r) => r.paymentId === pay.id);
                  const isPending = isPaymentPendingValidation(pay.status);
                  const isUploading = uploadingPaymentId === pay.id;
                  const canReverse =
                    rbac.hasPermission('REVERSE_PAYMENTS') && pay.status === 'APLICADO';

                  return (
                    <div
                      key={pay.id}
                      className="axy-surface p-3.5 rounded-xl space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono font-bold">
                          {formatMoney(pay.amount, pay.currency)} · Ref: {pay.referenceNumber}
                        </div>
                        <div
                          className={`font-semibold ${
                            pay.status === 'APLICADO'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isPending
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {getPaymentValidationStatusLabel(pay.status)}
                        </div>
                      </div>
                      <p className="text-slate-500">
                        Fecha: {pay.paymentDate} · Método: {pay.method} ({pay.bankName || '—'}) · Reportado por: {pay.reportedByName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {pay.receiptEvidenceDataUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewPayment(pay)}
                            className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver Comprobante</span>
                          </button>
                        ) : isPending ? (
                          <label className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 font-medium cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>{isUploading ? 'Subiendo…' : 'Subir Comprobante'}</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              disabled={isUploading}
                              onChange={(e) => void handleInlineAttachEvidence(pay, e)}
                              className="hidden"
                            />
                          </label>
                        ) : null}
                        {receipt && pay.status === 'APLICADO' && (
                          <button
                            type="button"
                            onClick={() => openReceiptPreview(receipt)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-semibold cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Recibo Oficial ({receipt.receiptNumber})
                          </button>
                        )}
                        {isPending && rbac.canAccessSection('accounting_payment_validation') && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              setActiveSection('accounting_payment_validation');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                          >
                            Ir a Contabilidad (Validar)
                          </button>
                        )}
                        {canReverse && (
                          <button
                            type="button"
                            onClick={() => setReversingPayId(pay.id)}
                            className="px-3 py-1.5 rounded-xl border border-amber-300 text-amber-800 dark:text-amber-300 font-semibold cursor-pointer"
                          >
                            Ejecutar Reverso Autorizado
                          </button>
                        )}
                      </div>

                      {reversingPayId === pay.id && userProfile && (
                        <div className="pt-2 border-t border-[var(--axy-border)] flex flex-wrap gap-2">
                          <input
                            value={reversalReason}
                            onChange={(e) => setReversalReason(e.target.value)}
                            placeholder="Justificación obligatoria del reverso..."
                            className="axy-input flex-1 min-w-[200px] px-2.5 py-1.5"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              setBusy(true);
                              setFeedback(null);
                              try {
                                await reverseAppliedPaymentTransaction({
                                  payment: pay,
                                  loan,
                                  installments: loanInstallments,
                                  allocations: paymentAllocations,
                                  reason: reversalReason,
                                  user: userProfile,
                                });
                                setReversingPayId(null);
                                setReversalReason('');
                                setFeedback({
                                  type: 'ok',
                                  msg: 'Pago revertido con restauración exacta de capital, cuotas y anulación de recibo.',
                                });
                              } catch (err) {
                                setFeedback({
                                  type: 'err',
                                  msg: err instanceof Error ? err.message : 'Error en reverso.',
                                });
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="px-3 py-1.5 rounded bg-rose-700 text-white font-semibold cursor-pointer"
                          >
                            Confirmar Reverso
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'bot_alertas' && (
            <div className="space-y-5">
              <div className="axy-surface p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    Consentimiento WhatsApp / Mensajería Automatizada
                  </h4>
                  <p className="text-slate-500">
                    Estado actual:{' '}
                    <span className="font-semibold">
                      {account.consentWhatsAppOptIn ? 'OPT-IN ACTIVO' : 'OPT-OUT / BLOQUEADO'}
                    </span>
                  </p>
                </div>
                {userProfile && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await updateCustomerWhatsAppConsent({
                        account,
                        optIn: !account.consentWhatsAppOptIn,
                        user: userProfile,
                      });
                      setBusy(false);
                    }}
                    className="axy-btn-secondary px-3 py-1.5 font-semibold cursor-pointer"
                  >
                    {account.consentWhatsAppOptIn ? 'Registrar Opt-Out (Baja)' : 'Reactivar Opt-In'}
                  </button>
                )}
              </div>

              {/* Open Dispute Form */}
              <form
                onSubmit={handleOpenDispute}
                className="axy-surface-tonal p-4 rounded-xl space-y-3"
              >
                <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  Registrar Reclamación / Caso Especial
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={disputeType}
                    onChange={(e) => setDisputeType(e.target.value as DisputeType)}
                    className="axy-input px-2.5 py-2"
                  >
                    <option value="PAGO_NO_REFLEJADO">Pago no reflejado</option>
                    <option value="COBRO_INDEBIDO">Cobro indebido / mora cuestionada</option>
                    <option value="ERROR_SALDO">Discrepancia de saldo</option>
                    <option value="ACOSO_CONTACTO">Queja de frecuencia de contacto</option>
                    <option value="OTRO">Otro caso especial</option>
                  </select>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={disputePauseBot}
                      onChange={(e) => setDisputePauseBot(e.target.checked)}
                    />
                    Pausar mensajería automatizada del Bot mientras se investiga
                  </label>
                </div>
                <textarea
                  rows={2}
                  required
                  value={disputeDesc}
                  onChange={(e) => setDisputeDesc(e.target.value)}
                  placeholder="Descripción de la reclamación..."
                  className="axy-input w-full px-2.5 py-2"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-semibold cursor-pointer"
                >
                  Abrir Reclamación
                </button>
              </form>

              {loanDisputes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display text-sm font-bold">Reclamaciones del Préstamo</h4>
                  {loanDisputes.map((d) => (
                    <div key={d.id} className="axy-surface p-3 rounded-xl space-y-2">
                      <div className="flex justify-between font-semibold">
                        <span>{d.disputeType}</span>
                        <span>{d.status}</span>
                      </div>
                      <p>{d.description}</p>
                      {['ABIERTA', 'EN_INVESTIGACION'].includes(d.status) &&
                        rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS') &&
                        userProfile && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                resolveCustomerDispute({
                                  dispute: d,
                                  resolutionStatus: 'RESUELTA_FAVOR_CLIENTE',
                                  resolutionNotes: 'Ajuste o verificación validada a favor del cliente.',
                                  user: userProfile,
                                })
                              }
                              className="px-3 py-1 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                            >
                              Resolver a Favor Cliente
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                resolveCustomerDispute({
                                  dispute: d,
                                  resolutionStatus: 'RESUELTA_IMPROCEDENTE',
                                  resolutionNotes: 'Validado y documentado como improcedente.',
                                  user: userProfile,
                                })
                              }
                              className="axy-btn-secondary px-3 py-1 font-semibold cursor-pointer"
                            >
                              Cerrar Improcedente
                            </button>
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              )}

              {loanAlerts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display text-sm font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Alertas Centinela ({loanAlerts.length})
                  </h4>
                  {loanAlerts.map((a) => (
                    <div key={a.id} className="axy-surface p-3 rounded-xl">
                      <div className="flex justify-between font-semibold">
                        <span>{a.title}</span>
                        <span>{a.severity} · {a.status}</span>
                      </div>
                      <p className="text-slate-500">{a.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'cierre' && closureCheck && (
            <div className="axy-surface p-5 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold flex items-center gap-2">
                  <Award className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                  Cierre y Cancelación Formal de Préstamo
                </h3>
                <span className="font-mono font-bold">{loan.status}</span>
              </div>

              {loan.status === 'CANCELADO' ? (
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 space-y-2">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    Préstamo Cancelado Formalmente · Certificado {loan.closureCertificateNumber}
                  </p>
                  <button
                    type="button"
                    onClick={downloadClosureCertificatePdf}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Descargar Certificado de Cancelación (PDF)
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <p className="font-semibold">
                      Validación automática de requisitos de cancelación:
                    </p>
                    {closureCheck.allowed ? (
                      <p className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Todos los requisitos cumplidos: saldo 0.00, 0 cuotas pendientes, 0 pagos por verificar y 0 reclamaciones/excepciones abiertas.
                      </p>
                    ) : (
                      <ul className="list-disc pl-5 text-rose-700 dark:text-rose-400 space-y-1">
                        {closureCheck.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {rbac.hasPermission('CLOSE_CANCEL_LOAN') && userProfile && (
                    <button
                      type="button"
                      disabled={!closureCheck.allowed || busy}
                      onClick={async () => {
                        setBusy(true);
                        setFeedback(null);
                        try {
                          const cert = await executeFormalLoanClosureTransaction({
                            loan,
                            installments: loanInstallments,
                            payments: loanPayments,
                            disputes: loanDisputes,
                            exceptions: reconciliationExceptions,
                            user: userProfile,
                          });
                          setFeedback({
                            type: 'ok',
                            msg: `Préstamo CANCELADO formalmente. Certificado emitido: ${cert}`,
                          });
                        } catch (err) {
                          setFeedback({
                            type: 'err',
                            msg: err instanceof Error ? err.message : 'Error cerrando préstamo.',
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="axy-btn-primary px-4 py-2 cursor-pointer disabled:opacity-50"
                    >
                      Ejecutar Cierre Formal y Emitir Certificado
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <PaymentEvidencePreviewModal
        payment={previewPayment}
        onClose={() => setPreviewPayment(null)}
      />

      <PaymentReceiptModal
        receipt={previewReceipt}
        organization={organization}
        payment={
          previewReceipt
            ? loanPayments.find((p) => p.id === previewReceipt.paymentId) ?? null
            : null
        }
        loan={loan}
        customer={customer ?? null}
        onClose={() => setPreviewReceipt(null)}
      />
    </div>
  );
}
