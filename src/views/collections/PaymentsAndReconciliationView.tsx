import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  GitCompare,
  HelpCircle,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { PaymentEvidencePreviewModal } from '../../components/PaymentEvidencePreviewModal';
import { PaymentReceiptModal } from '../../components/PaymentReceiptModal';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  attachPaymentEvidence,
  confirmSuggestedReconciliationMatch,
  importBankStatementBatch,
  reportPaymentPendingVerification,
  resolveUnidentifiedBankTransaction,
  reverseAppliedPaymentTransaction,
  runBankReconciliationEngine,
} from '../../services/collectionsStore';
import type {
  CollectionReceiptRecord,
  CurrencyCode,
  PaymentChannelMethod,
  PaymentRecord,
} from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';
import {
  formatEvidenceFileSize,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
  processPaymentEvidenceFile,
  type EncodedPaymentEvidence,
} from '../../utils/paymentEvidence';

export function PaymentsAndReconciliationView({
  mode,
}: {
  mode: 'payments' | 'reconciliation' | 'unidentified';
}) {
  const {
    userProfile,
    organization,
    customers,
    loans,
    loanInstallments,
    payments,
    paymentAllocations,
    paymentReversals,
    paymentPromises,
    collectionReceipts,
    bankTransactions,
    reconciliationMatches,
    reconciliationExceptions,
    activeCollectionPolicy,
    collectionsIntegrationsStatus,
    setSelectedCollectionLoanId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Payment reporting state
  const [loanId, setLoanId] = useState('');
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(getSantoDomingoTodayIso());
  const [method, setMethod] = useState<PaymentChannelMethod>('TRANSFERENCIA');
  const [bankName, setBankName] = useState('Banco Popular');
  const [refNumber, setRefNumber] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<EncodedPaymentEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [previewPayment, setPreviewPayment] = useState<PaymentRecord | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<CollectionReceiptRecord | null>(null);
  const [notes, setNotes] = useState('');

  const canOpenValidation = rbac.canAccessSection('accounting_payment_validation');
  const pendingValidationCount = useMemo(
    () => payments.filter((p) => isPaymentPendingValidation(p.status)).length,
    [payments]
  );

  // Reversal modal/inline state
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [revReason, setRevReason] = useState('');

  // Bank statement CSV/TSV import
  const [csvBank, setCsvBank] = useState('Banco Popular');
  const [csvCurrency, setCsvCurrency] = useState<CurrencyCode>('DOP');
  const [rawStatement, setRawStatement] = useState('');

  // Exception resolution target loan map
  const [resolveLoanByExc, setResolveLoanByExc] = useState<Record<string, string>>({});
  const [resolveNoteByExc, setResolveNoteByExc] = useState<Record<string, string>>({});

  const activeLoans = useMemo(
    () => loans.filter((l) => l.status !== 'CANCELADO'),
    [loans]
  );

  const selectedLoan = activeLoans.find((l) => l.id === loanId) ?? activeLoans[0] ?? null;

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')),
    [payments]
  );

  const openExceptions = useMemo(
    () => reconciliationExceptions.filter((e) => e.status === 'ABIERTA'),
    [reconciliationExceptions]
  );

  const openReceiptPreview = (receipt: CollectionReceiptRecord) => {
    setPreviewReceipt(receipt);
  };

  const handleEvidenceFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setEvidenceError(null);
    if (!file) return;
    try {
      const encoded = await processPaymentEvidenceFile(file);
      setEvidenceFile(encoded);
    } catch (err) {
      setEvidenceError(
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
        msg: `Comprobante "${encoded.fileName}" adjuntado al pago ${pay.loanNumber}. Disponible en Contabilidad → Pagos para Validación.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo adjuntar el comprobante.',
      });
    } finally {
      setUploadingPaymentId(null);
    }
  };

  const handleReportPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !selectedLoan) return;
    setBusy(true);
    setFeedback(null);
    try {
      await reportPaymentPendingVerification({
        loan: selectedLoan,
        amount: Number(amount),
        paymentDate: payDate,
        method,
        bankName,
        referenceNumber: refNumber,
        receiptEvidenceName: evidenceFile?.fileName || '',
        receiptEvidenceMimeType: evidenceFile?.mimeType,
        receiptEvidenceSizeBytes: evidenceFile?.sizeBytes,
        receiptEvidenceDataUrl: evidenceFile?.dataUrl,
        notes,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `Pago registrado para ${selectedLoan.applicantDisplayName} (${selectedLoan.loanNumber}) y enviado a Contabilidad → Pagos para Validación. El balance del cliente y su préstamo se actualizarán al presionar Validar.`,
      });
      setAmount('');
      setRefNumber('');
      setEvidenceFile(null);
      setEvidenceError(null);
      setNotes('');
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error registrando pago.' });
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawStatement(String(reader.result || ''));
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {mode === 'payments' && <CreditCard className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'reconciliation' && <GitCompare className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'unidentified' && <HelpCircle className="w-5 h-5 text-amber-500" />}
            {mode === 'payments'
              ? 'Registro, Verificación y Aplicación de Pagos'
              : mode === 'reconciliation'
              ? 'Conciliación Bancaria Determinística'
              : 'Pagos por Identificar y Excepciones'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {mode === 'payments'
              ? `Segregación estricta de funciones: orden de imputación activo ${activeCollectionPolicy.imputationOrder.join(' › ')}. Recibos oficiales emitidos únicamente tras estado APLICADO.`
              : mode === 'reconciliation'
              ? 'Importa extractos CSV/Excel tabulares con hash de idempotencia anti-duplicado y motor de emparejamiento Exacto / Probable / Ambiguo / Excepciones.'
              : 'Bandeja exclusiva de Finanzas para asociar depósitos bancarios no identificados a su préstamo real y aplicar el pago.'}
          </p>
        </div>

        {mode === 'payments' && canOpenValidation && (
          <button
            type="button"
            onClick={() => setActiveSection('accounting_payment_validation')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 font-semibold hover:brightness-95 cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Ir a Pagos para Validación ({pendingValidationCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {mode === 'reconciliation' && (
          <div
            className={`px-3 py-2 rounded-xl border font-semibold ${
              collectionsIntegrationsStatus.bankConnectorConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
            }`}
          >
            API Bancaria Directa: {collectionsIntegrationsStatus.bankConnectorMode}
          </div>
        )}
      </div>

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

      {mode === 'payments' && (
        <>
          {(rbac.hasPermission('REPORT_PAYMENTS') || rbac.hasPermission('VERIFY_AND_APPLY_PAYMENTS')) &&
            activeLoans.length > 0 && (
              <form
                onSubmit={handleReportPayment}
                className="p-5 rounded-2xl axy-surface space-y-3"
              >
                <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                  Reportar Pago o Recaudo en Ventanilla (Sin Rebajar Saldo Hasta Verificación)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">Préstamo *</label>
                    <select
                      value={selectedLoan?.id || ''}
                      onChange={(e) => setLoanId(e.target.value)}
                      className="w-full px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                    >
                      {activeLoans.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.loanNumber} · {l.applicantDisplayName} ({formatMoney(l.currentPrincipalBalance, l.currency)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">
                      Monto ({selectedLoan?.currency || 'DOP'}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-2.5 py-2 axy-input font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">Fecha de Pago *</label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full px-2.5 py-2 axy-input font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">Canal / Método</label>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentChannelMethod)}
                      className="w-full px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                    >
                      <option value="TRANSFERENCIA">Transferencia</option>
                      <option value="DEPOSITO">Depósito</option>
                      <option value="CAJA_EFECTIVO">Caja / Efectivo</option>
                      <option value="TARJETA">Tarjeta</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="LINK_PAGO">Link de Pago</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">Banco</label>
                    <input
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500 dark:text-slate-400">Número de Referencia *</label>
                    <input
                      required
                      value={refNumber}
                      onChange={(e) => setRefNumber(e.target.value)}
                      placeholder="Ej. TRF-88412"
                      className="w-full px-2.5 py-2 axy-input font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div className="space-y-1.5">
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-[var(--axy-border-strong)] bg-[var(--axy-surface-tonal)] hover:border-[#0066FF] dark:hover:border-[#00B8FF] cursor-pointer w-full justify-center font-semibold text-slate-700 dark:text-slate-200 transition-colors">
                      <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                      <span>
                        {evidenceFile ? 'Cambiar Comprobante (Imagen o PDF)' : 'Subir Comprobante del Cliente (Opcional)'}
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => void handleEvidenceFileSelect(e)}
                        className="hidden"
                      />
                    </label>
                    {evidenceError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400">{evidenceError}</p>
                    )}
                    {evidenceFile && (
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 truncate text-emerald-800 dark:text-emerald-300">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{evidenceFile.fileName}</span>
                          <span className="font-mono text-[10px]">
                            ({formatEvidenceFileSize(evidenceFile.sizeBytes)})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setEvidenceFile(null)}
                          className="p-0.5 text-emerald-700 hover:text-rose-600 cursor-pointer"
                          aria-label="Quitar comprobante"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observaciones operativas"
                    className="px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Control contable: el pago queda pendiente en <strong>Contabilidad → Pagos para Validación</strong> hasta ser validado.
                  </span>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 axy-btn-primary cursor-pointer disabled:opacity-50"
                  >
                    {busy ? 'Registrando…' : 'Registrar Pago para Validación'}
                  </button>
                </div>
              </form>
            )}

          <div className="rounded-2xl axy-surface overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Fecha / Ref</th>
                  <th className="py-3 px-3">Préstamo / Cliente</th>
                  <th className="py-3 px-3">Monto</th>
                  <th className="py-3 px-3">Canal</th>
                  <th className="py-3 px-3">Comprobante</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Acciones de Control</th>
                </tr>
              </thead>
              <tbody>
                {sortedPayments.map((pay) => {
                  const loan = loans.find(
                    (l) => l.id === pay.loanId || l.loanNumber === pay.loanNumber
                  );
                  const receipt = collectionReceipts.find((r) => r.paymentId === pay.id);
                  const isPending = isPaymentPendingValidation(pay.status);
                  const isUploading = uploadingPaymentId === pay.id;
                  const canReverse =
                    rbac.hasPermission('REVERSE_PAYMENTS') && pay.status === 'APLICADO';

                  return (
                    <React.Fragment key={pay.id}>
                      <tr className="axy-table-row">
                        <td className="py-2.5 px-4 font-mono">
                          <p className="font-semibold text-slate-900 dark:text-white">{pay.paymentDate}</p>
                          <p className="text-slate-500">{pay.referenceNumber}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => setSelectedCollectionLoanId(pay.loanId)}
                            className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                          >
                            {pay.loanNumber}
                          </button>
                          <p>{pay.customerName}</p>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                          {formatMoney(pay.amount, pay.currency)}
                        </td>
                        <td className="py-2.5 px-3">
                          <p>{pay.method}</p>
                          <p className="text-slate-500">{pay.bankName || '—'}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          {pay.receiptEvidenceDataUrl ? (
                            <button
                              type="button"
                              onClick={() => setPreviewPayment(pay)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#0066FF]/25 dark:border-[#00B8FF]/25 bg-[#0066FF]/[0.07] dark:bg-[#00B8FF]/10 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Ver Comprobante</span>
                            </button>
                          ) : isPending ? (
                            <label className="inline-flex items-center gap-1 px-2 py-1 axy-btn-secondary font-medium cursor-pointer text-slate-700 dark:text-slate-200">
                              <Upload className="w-3 h-3" />
                              <span>{isUploading ? 'Subiendo…' : 'Subir'}</span>
                              <input
                                type="file"
                                accept="image/*,application/pdf"
                                disabled={isUploading}
                                onChange={(e) => void handleInlineAttachEvidence(pay, e)}
                                className="hidden"
                              />
                            </label>
                          ) : (
                            <span className="text-slate-400">{pay.receiptEvidenceName || '—'}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          <span
                            className={
                              pay.status === 'APLICADO'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isPending
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {getPaymentValidationStatusLabel(pay.status)}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-2">
                            {receipt && pay.status === 'APLICADO' && (
                              <button
                                type="button"
                                onClick={() => openReceiptPreview(receipt)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-semibold cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                {receipt.receiptNumber}
                              </button>
                            )}
                            {isPending && canOpenValidation && (
                              <button
                                type="button"
                                onClick={() => setActiveSection('accounting_payment_validation')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 font-semibold cursor-pointer"
                              >
                                <ClipboardCheck className="w-3 h-3" />
                                <span>Validar en Contabilidad</span>
                              </button>
                            )}
                            {canReverse && (
                              <button
                                type="button"
                                onClick={() => setReversingId(pay.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 font-semibold cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Revertir
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {reversingId === pay.id && loan && userProfile && (
                        <tr>
                          <td colSpan={7} className="p-3 bg-amber-50/70 dark:bg-amber-950/30">
                            <div className="flex flex-wrap gap-2">
                              <input
                                value={revReason}
                                onChange={(e) => setRevReason(e.target.value)}
                                placeholder="Justificación obligatoria del reverso..."
                                className="flex-1 min-w-[220px] px-2.5 py-1.5 axy-input text-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  setBusy(true);
                                  try {
                                    await reverseAppliedPaymentTransaction({
                                      payment: pay,
                                      loan,
                                      installments: loanInstallments,
                                      allocations: paymentAllocations,
                                      reason: revReason,
                                      user: userProfile,
                                    });
                                    setReversingId(null);
                                    setRevReason('');
                                    setFeedback({
                                      type: 'ok',
                                      msg: 'Reverso ejecutado y saldo capital restaurado con bitácora.',
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
                                className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold cursor-pointer"
                              >
                                Confirmar Reverso
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {sortedPayments.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No existen pagos reportados o aplicados aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {paymentReversals.length > 0 && (
            <div className="p-4 rounded-2xl axy-surface space-y-2">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Historial de Reversos Autorizados ({paymentReversals.length})
              </h3>
              {paymentReversals.map((r) => (
                <div key={r.id} className="p-2.5 rounded-xl axy-surface-tonal flex justify-between">
                  <span>
                    <strong className="font-mono">{r.loanNumber}</strong> · {formatMoney(r.reversedAmount, r.currency)} · {r.reason}
                  </span>
                  <span className="text-slate-500">Autorizó: {r.authorizedByName}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'reconciliation' && (
        <div className="space-y-5">
          {rbac.hasPermission('RECONCILE_BANK_TRANSACTIONS') && (
            <div className="p-5 rounded-2xl axy-surface space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  Importar Extracto Bancario (CSV / TSV / Tabular)
                </h3>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  Auto-aplicación exacta:{' '}
                  {activeCollectionPolicy.autoApplyExactBankMatch ? 'HABILITADA' : 'DESACTIVADA (requiere confirmación)'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  value={csvBank}
                  onChange={(e) => setCsvBank(e.target.value)}
                  placeholder="Banco por defecto"
                  className="px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                />
                <select
                  value={csvCurrency}
                  onChange={(e) => setCsvCurrency(e.target.value as CurrencyCode)}
                  className="px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                >
                  <option value="DOP">DOP (RD$)</option>
                  <option value="USD">USD (US$)</option>
                </select>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileUpload}
                  className="px-2.5 py-1.5 axy-input text-slate-900 dark:text-white"
                />
              </div>

              <textarea
                rows={4}
                value={rawStatement}
                onChange={(e) => setRawStatement(e.target.value)}
                placeholder={'fecha,referencia,descripcion,monto,moneda,banco\n2026-11-17,TRF-88412,TRANSFERENCIA CLIENTE,12500.00,DOP,Banco Popular'}
                className="w-full px-3 py-2 axy-input font-mono text-slate-900 dark:text-white"
              />

              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  disabled={busy || !rawStatement.trim()}
                  onClick={async () => {
                    if (!userProfile) return;
                    setBusy(true);
                    setFeedback(null);
                    try {
                      const res = await importBankStatementBatch({
                        rawText: rawStatement,
                        defaultBankName: csvBank,
                        defaultCurrency: csvCurrency,
                        existingTransactions: bankTransactions,
                        user: userProfile,
                      });
                      setRawStatement('');
                      setFeedback({
                        type: 'ok',
                        msg: `Extracto importado: ${res.importedCount} líneas nuevas, ${res.duplicatesSkipped} duplicadas omitidas por idempotencia.`,
                      });
                    } catch (err) {
                      setFeedback({
                        type: 'err',
                        msg: err instanceof Error ? err.message : 'Error importando extracto.',
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-4 py-2 axy-btn-secondary font-semibold cursor-pointer disabled:opacity-50 text-slate-700 dark:text-slate-200"
                >
                  Importar Extracto
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!userProfile) return;
                    setBusy(true);
                    setFeedback(null);
                    try {
                      const res = await runBankReconciliationEngine({
                        bankTransactions,
                        payments,
                        loans,
                        installments: loanInstallments,
                        promises: paymentPromises,
                        policy: activeCollectionPolicy,
                        user: userProfile,
                      });
                      setFeedback({
                        type: 'ok',
                        msg: `Conciliación ejecutada: ${res.exactMatches} exactas, ${res.probableMatches} probables, ${res.autoApplied} auto-aplicadas, ${res.exceptionsCreated} excepciones.`,
                      });
                    } catch (err) {
                      setFeedback({
                        type: 'err',
                        msg: err instanceof Error ? err.message : 'Error ejecutando conciliación.',
                      });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-4 py-2 axy-btn-primary cursor-pointer disabled:opacity-50"
                >
                  Ejecutar Motor de Conciliación
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl axy-surface overflow-x-auto">
            <div className="p-4 border-b border-[var(--axy-border)]">
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Movimientos Bancarios y Coincidencias ({bankTransactions.length})
              </h3>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Fecha / Banco</th>
                  <th className="py-2.5 px-3">Referencia</th>
                  <th className="py-2.5 px-3">Descripción</th>
                  <th className="py-2.5 px-3">Monto</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Emparejamiento</th>
                </tr>
              </thead>
              <tbody>
                {bankTransactions.map((btx) => {
                  const match = reconciliationMatches.find((m) => m.bankTransactionId === btx.id);
                  const matchedPay = match?.paymentId
                    ? payments.find((p) => p.id === match.paymentId)
                    : undefined;
                  const matchedLoan = matchedPay
                    ? loans.find((l) => l.id === matchedPay.loanId)
                    : undefined;

                  return (
                    <tr key={btx.id} className="axy-table-row">
                      <td className="py-2.5 px-4 font-mono">
                        <p>{btx.transactionDate}</p>
                        <p className="text-slate-500 font-sans">{btx.bankName}</p>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-white">{btx.referenceNumber}</td>
                      <td className="py-2.5 px-3">{btx.description}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {formatMoney(btx.amount, btx.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{btx.status}</td>
                      <td className="py-2.5 px-3">
                        {match ? (
                          <div className="space-y-1">
                            <p className="font-semibold">
                              {match.confidence} ({match.score}%) · {match.status}
                            </p>
                            {match.status === 'SUGERIDO' &&
                              matchedPay &&
                              matchedLoan &&
                              rbac.hasPermission('RECONCILE_BANK_TRANSACTIONS') &&
                              userProfile && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setBusy(true);
                                    await confirmSuggestedReconciliationMatch({
                                      match,
                                      bankTx: btx,
                                      payment: matchedPay,
                                      loan: matchedLoan,
                                      installments: loanInstallments,
                                      promises: paymentPromises,
                                      policy: activeCollectionPolicy,
                                      user: userProfile,
                                    });
                                    setBusy(false);
                                    setFeedback({
                                      type: 'ok',
                                      msg: `Conciliación confirmada y pago aplicado para ${matchedLoan.loanNumber}.`,
                                    });
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                                >
                                  Confirmar y Aplicar ({matchedLoan.loanNumber})
                                </button>
                              )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {bankTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay extractos bancarios importados todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'unidentified' && (
        <div className="space-y-4">
          {openExceptions.map((exc) => {
            const btx = bankTransactions.find((b) => b.id === exc.bankTransactionId);
            if (!btx) return null;
            const sameCurrencyLoans = activeLoans.filter((l) => l.currency === btx.currency);
            const targetLoanId = resolveLoanByExc[exc.id] || sameCurrencyLoans[0]?.id || '';
            const targetLoan = sameCurrencyLoans.find((l) => l.id === targetLoanId);

            return (
              <div
                key={exc.id}
                className="p-4 rounded-2xl axy-surface space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{btx.referenceNumber}</span>
                    <span>{btx.bankName}</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {formatMoney(btx.amount, btx.currency)}
                    </span>
                  </div>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {exc.exceptionType}
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  {btx.transactionDate} · {btx.description} · {exc.detail}
                </p>

                {rbac.hasPermission('RECONCILE_BANK_TRANSACTIONS') && userProfile && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-[var(--axy-border)]">
                    <select
                      value={targetLoanId}
                      onChange={(e) =>
                        setResolveLoanByExc((prev) => ({ ...prev, [exc.id]: e.target.value }))
                      }
                      className="px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                    >
                      {sameCurrencyLoans.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.loanNumber} · {l.applicantDisplayName}
                        </option>
                      ))}
                    </select>
                    <input
                      value={resolveNoteByExc[exc.id] || ''}
                      onChange={(e) =>
                        setResolveNoteByExc((prev) => ({ ...prev, [exc.id]: e.target.value }))
                      }
                      placeholder="Nota de verificación / identificación..."
                      className="px-2.5 py-2 axy-input text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      disabled={busy || !targetLoan}
                      onClick={async () => {
                        if (!targetLoan) return;
                        setBusy(true);
                        setFeedback(null);
                        try {
                          await resolveUnidentifiedBankTransaction({
                            exception: exc,
                            bankTx: btx,
                            loan: targetLoan,
                            installments: loanInstallments,
                            promises: paymentPromises,
                            policy: activeCollectionPolicy,
                            resolutionNotes:
                              resolveNoteByExc[exc.id] || 'Identificado manualmente por Finanzas',
                            user: userProfile,
                          });
                          setFeedback({
                            type: 'ok',
                            msg: `Depósito ${btx.referenceNumber} identificado y aplicado al préstamo ${targetLoan.loanNumber}.`,
                          });
                        } catch (err) {
                          setFeedback({
                            type: 'err',
                            msg: err instanceof Error ? err.message : 'Error resolviendo excepción.',
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Asociar y Aplicar Pago
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {openExceptions.length === 0 && (
            <div className="p-8 rounded-2xl axy-surface text-center text-slate-500 dark:text-slate-400">
              No hay pagos bancarios pendientes por identificar.
            </div>
          )}
        </div>
      )}

      <PaymentEvidencePreviewModal
        payment={previewPayment}
        onClose={() => setPreviewPayment(null)}
      />

      <PaymentReceiptModal
        receipt={previewReceipt}
        organization={organization}
        payment={
          previewReceipt
            ? payments.find((p) => p.id === previewReceipt.paymentId) ?? null
            : null
        }
        loan={
          previewReceipt
            ? loans.find(
                (l) => l.id === previewReceipt.loanId || l.loanNumber === previewReceipt.loanNumber
              ) ?? null
            : null
        }
        customer={
          previewReceipt
            ? customers.find((c) => c.id === previewReceipt.customerId) ?? null
            : null
        }
        onClose={() => setPreviewReceipt(null)}
      />
    </div>
  );
}
