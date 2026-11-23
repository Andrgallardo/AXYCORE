import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  FileText,
  Search,
  Upload,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { PaymentEvidencePreviewModal } from '../../components/PaymentEvidencePreviewModal';
import { PaymentReceiptModal } from '../../components/PaymentReceiptModal';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  attachPaymentEvidence,
  reportPaymentPendingVerification,
} from '../../services/collectionsStore';
import type {
  CollectionReceiptRecord,
  LoanRecord,
  PaymentChannelMethod,
  PaymentRecord,
} from '../../types/axycore';
import { formatMoney, isClosedLoanStatus } from '../../utils/formatters';
import {
  formatEvidenceFileSize,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
  processPaymentEvidenceFile,
  type EncodedPaymentEvidence,
} from '../../utils/paymentEvidence';

interface SelectableClient {
  id: string;
  kind: 'INDIVIDUAL' | 'BUSINESS';
  displayName: string;
  documentLabel: string;
  phone: string;
  loans: LoanRecord[];
  totalPrincipalBalance: number;
}

export function RegisterPaymentsView() {
  const {
    userProfile,
    organization,
    customers,
    businesses,
    loans,
    loanInstallments,
    collectionAccounts,
    payments,
    collectionReceipts,
    activeCollectionPolicy,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const [clientQuery, setClientQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(getSantoDomingoTodayIso());
  const [method, setMethod] = useState<PaymentChannelMethod>('TRANSFERENCIA');
  const [bankName, setBankName] = useState('Banco Popular');
  const [refNumber, setRefNumber] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<EncodedPaymentEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [previewPayment, setPreviewPayment] = useState<PaymentRecord | null>(null);
  const [previewReceipt, setPreviewReceipt] = useState<CollectionReceiptRecord | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const canReport =
    rbac.hasPermission('REPORT_PAYMENTS') || rbac.hasPermission('VERIFY_AND_APPLY_PAYMENTS');
  const canOpenValidation = rbac.canAccessSection('accounting_payment_validation');

  const pendingValidationCount = useMemo(
    () => payments.filter((p) => isPaymentPendingValidation(p.status)).length,
    [payments]
  );

  const clientsList = useMemo<SelectableClient[]>(() => {
    const activeLoans = loans.filter((l) => !isClosedLoanStatus(l.status));
    const items: SelectableClient[] = [];

    for (const c of customers) {
      const custLoans = activeLoans.filter((l) => l.customerId === c.id && !l.businessId);
      const allCustLoans = activeLoans.filter((l) => l.customerId === c.id);
      const matched = custLoans.length > 0 ? custLoans : allCustLoans;
      items.push({
        id: c.id,
        kind: 'INDIVIDUAL',
        displayName: `${c.firstName} ${c.lastName}`,
        documentLabel: `${c.documentType}: ${c.documentNumber}`,
        phone: c.phone || '—',
        loans: matched,
        totalPrincipalBalance: matched.reduce((s, l) => s + l.currentPrincipalBalance, 0),
      });
    }

    for (const b of businesses) {
      const bizLoans = activeLoans.filter((l) => l.businessId === b.id);
      items.push({
        id: b.id,
        kind: 'BUSINESS',
        displayName: b.tradeName || b.legalName,
        documentLabel: `RNC: ${b.rnc}`,
        phone: 'Empresa',
        loans: bizLoans,
        totalPrincipalBalance: bizLoans.reduce((s, l) => s + l.currentPrincipalBalance, 0),
      });
    }

    return items.sort((a, b) => {
      if (b.loans.length !== a.loans.length) return b.loans.length - a.loans.length;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [customers, businesses, loans]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clientsList;
    return clientsList.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.documentLabel.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
    );
  }, [clientsList, clientQuery]);

  const selectedClient =
    clientsList.find((c) => c.id === selectedClientId) ??
    filteredClients.find((c) => c.loans.length > 0) ??
    filteredClients[0] ??
    null;

  const clientLoans = selectedClient?.loans ?? [];
  const activeLoan =
    clientLoans.find((l) => l.id === selectedLoanId) ?? clientLoans[0] ?? null;

  const activeAccount = useMemo(
    () =>
      activeLoan
        ? collectionAccounts.find((a) => a.loanId === activeLoan.id) ?? null
        : null,
    [collectionAccounts, activeLoan]
  );

  const nextInstallment = useMemo(() => {
    if (!activeLoan) return null;
    return (
      loanInstallments
        .filter((i) => i.loanId === activeLoan.id && i.status !== 'PAGADA')
        .sort((a, b) => a.installmentNumber - b.installmentNumber)[0] ?? null
    );
  }, [loanInstallments, activeLoan]);

  const clientPayments = useMemo(() => {
    const base = selectedClient
      ? payments.filter(
          (p) =>
            p.customerId === selectedClient.id ||
            clientLoans.some((l) => l.id === p.loanId)
        )
      : payments;
    return [...base].sort((a, b) =>
      (b.paymentDate || '').localeCompare(a.paymentDate || '')
    );
  }, [payments, selectedClient, clientLoans]);

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
        err instanceof Error ? err.message : 'No se pudo procesar el comprobante seleccionado.'
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
        msg: `Comprobante "${encoded.fileName}" subido y vinculado al pago de ${pay.customerName}. Ya está disponible para validación en Contabilidad.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo subir el comprobante.',
      });
    } finally {
      setUploadingPaymentId(null);
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !activeLoan) return;
    setBusy(true);
    setFeedback(null);
    try {
      const created = await reportPaymentPendingVerification({
        loan: activeLoan,
        amount: Number(amount),
        paymentDate: payDate,
        method,
        bankName: method === 'CAJA_EFECTIVO' ? 'Caja General' : bankName,
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
        msg: `Pago de ${formatMoney(created.amount, created.currency)} registrado para ${selectedClient?.displayName} (${activeLoan.loanNumber})${
          evidenceFile ? ` con comprobante "${evidenceFile.fileName}"` : ''
        }. Enviado a Contabilidad → Pagos para Validación. El balance del cliente y su préstamo se actualizarán al presionar Validar.`,
      });
      setAmount('');
      setRefNumber('');
      setEvidenceFile(null);
      setEvidenceError(null);
      setNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo registrar el pago.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Registrar Pagos de Clientes</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Registra el pago del cliente y adjunta su comprobante (opcional). El pago pasará a{' '}
            <strong className="text-slate-800 dark:text-slate-200">
              Contabilidad → Pagos para Validación
            </strong>{' '}
            y afectará el balance del cliente y su préstamo únicamente al validarse.
          </p>
        </div>

        {canOpenValidation && (
          <button
            type="button"
            onClick={() => setActiveSection('accounting_payment_validation')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 font-semibold hover:brightness-95 cursor-pointer shrink-0"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Pagos para Validación ({pendingValidationCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border font-medium flex flex-wrap items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          <span>{feedback.msg}</span>
          {feedback.type === 'ok' && canOpenValidation && (
            <button
              type="button"
              onClick={() => setActiveSection('accounting_payment_validation')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer shrink-0"
            >
              <span>Ir a Pagos para Validación</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Client Selector */}
        <div className="lg:col-span-5 p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>1. Seleccionar Cliente</span>
            </h3>
            <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              {filteredClients.length} clientes
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Buscar por nombre, cédula, RNC o teléfono…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
            />
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-white/5 rounded-xl border border-slate-200/70 dark:border-[#00B8FF]/15">
            {filteredClients.length === 0 ? (
              <div className="p-6 text-center text-slate-500 dark:text-slate-400">
                No hay clientes que coincidan con la búsqueda.
              </div>
            ) : (
              filteredClients.map((client) => {
                const isSelected = selectedClient?.id === client.id;
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setSelectedClientId(client.id);
                      setSelectedLoanId(client.loans[0]?.id || '');
                    }}
                    className={`w-full text-left p-3 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#0066FF]/10 dark:bg-[#0066FF]/20'
                        : 'hover:bg-slate-50 dark:hover:bg-[#0C1B3B]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950 dark:text-white truncate">
                        {client.displayName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {client.documentLabel} · {client.phone}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono tabular-nums font-bold text-[#0052CC] dark:text-[#00D1FF] block">
                        {client.loans.length} prést.
                      </span>
                      {client.loans.length > 0 && (
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatMoney(client.totalPrincipalBalance, client.loans[0].currency)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Loan Picker + Register Payment Form + Comprobante Upload */}
        <div className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>
                  2. Registrar Pago {selectedClient ? `· ${selectedClient.displayName}` : ''}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Orden de imputación al validarse en Contabilidad: {activeCollectionPolicy.imputationOrder.join(' › ')}
              </p>
            </div>
          </div>

          {!selectedClient ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              Selecciona un cliente del panel izquierdo para registrar un pago.
            </div>
          ) : clientLoans.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/70 dark:border-[#00B8FF]/15 text-slate-500 dark:text-slate-400">
              El cliente <strong>{selectedClient.displayName}</strong> no posee préstamos activos pendientes de pago.
            </div>
          ) : !canReport ? (
            <div className="p-6 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300">
              Tu rol actual es de solo lectura y no posee permiso para registrar pagos.
            </div>
          ) : (
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              {/* Loan Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Préstamo del Cliente *
                  </label>
                  <select
                    value={activeLoan?.id || ''}
                    onChange={(e) => setSelectedLoanId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white font-medium"
                  >
                    {clientLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.loanNumber} · Saldo {formatMoney(l.currentPrincipalBalance, l.currency)} ({l.status})
                      </option>
                    ))}
                  </select>
                </div>

                {activeLoan && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-col justify-center">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400">Saldo Capital Actual:</span>
                      <span className="font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                        {formatMoney(activeLoan.currentPrincipalBalance, activeLoan.currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] mt-0.5">
                      <span className="text-slate-500 dark:text-slate-400">
                        {nextInstallment
                          ? `Cuota #${nextInstallment.installmentNumber} (${nextInstallment.dueDate}):`
                          : 'Atraso / Mora:'}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                        {nextInstallment
                          ? formatMoney(
                              Math.max(
                                0,
                                nextInstallment.totalAmount -
                                  (nextInstallment.paidPrincipal ?? 0) -
                                  (nextInstallment.paidInterest ?? 0) -
                                  (nextInstallment.paidOtherCharges ?? 0)
                              ),
                              activeLoan.currency
                            )
                          : `${activeAccount?.dpd ?? 0} DPD`}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Fill Amount Helpers */}
              {activeLoan && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Autocompletar monto:
                  </span>
                  {nextInstallment && (
                    <button
                      type="button"
                      onClick={() =>
                        setAmount(
                          String(
                            Math.max(
                              0,
                              Math.round(
                                (nextInstallment.totalAmount -
                                  (nextInstallment.paidPrincipal ?? 0) -
                                  (nextInstallment.paidInterest ?? 0) -
                                  (nextInstallment.paidOtherCharges ?? 0)) *
                                  100
                              ) / 100
                            )
                          )
                        )
                      }
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-[#0C1B3B] font-mono tabular-nums font-semibold cursor-pointer"
                    >
                      Cuota #{nextInstallment.installmentNumber}:{' '}
                      {formatMoney(
                        Math.max(
                          0,
                          nextInstallment.totalAmount -
                            (nextInstallment.paidPrincipal ?? 0) -
                            (nextInstallment.paidInterest ?? 0) -
                            (nextInstallment.paidOtherCharges ?? 0)
                        ),
                        activeLoan.currency
                      )}
                    </button>
                  )}
                  {activeAccount && activeAccount.overdueTotalAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(activeAccount.overdueTotalAmount))}
                      className="px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 font-mono tabular-nums font-semibold cursor-pointer"
                    >
                      Total Vencido: {formatMoney(activeAccount.overdueTotalAmount, activeLoan.currency)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAmount(String(activeLoan.currentPrincipalBalance))}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-[#0C1B3B] font-mono tabular-nums font-semibold cursor-pointer"
                  >
                    Saldo Capital: {formatMoney(activeLoan.currentPrincipalBalance, activeLoan.currency)}
                  </button>
                </div>
              )}

              {/* Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Monto ({activeLoan?.currency || 'DOP'}) *
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] font-mono tabular-nums text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Fecha de Pago *
                  </label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Método de Pago *
                  </label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentChannelMethod)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
                  >
                    <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                    <option value="DEPOSITO">Depósito Bancario</option>
                    <option value="CAJA_EFECTIVO">Efectivo en Caja</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="TARJETA">Tarjeta</option>
                    <option value="LINK_PAGO">Link de Pago</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Banco / Caja
                  </label>
                  <input
                    type="text"
                    value={method === 'CAJA_EFECTIVO' ? 'Caja General' : bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    disabled={method === 'CAJA_EFECTIVO'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    N° Referencia / Comprobante
                  </label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="Ej: TRF-99410 o REC-001"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                    Nota / Observación
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Detalle opcional del abono"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Comprobante Upload Zone */}
              <div className="p-3.5 rounded-xl border border-dashed border-slate-300 dark:border-[#00B8FF]/30 bg-slate-50/70 dark:bg-[#040C1E] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                      <span>Comprobante de Pago del Cliente (Opcional)</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sube captura de transferencia, foto del voucher o PDF (se comprime automáticamente para Contabilidad).
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-[#00B8FF]/35 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-slate-800 dark:text-slate-100 font-semibold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                    <span>{evidenceFile ? 'Cambiar Comprobante' : 'Subir Comprobante'}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => void handleEvidenceFileSelect(e)}
                      className="hidden"
                    />
                  </label>
                </div>

                {evidenceError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                    {evidenceError}
                  </p>
                )}

                {evidenceFile && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="font-medium text-emerald-900 dark:text-emerald-200 truncate">
                        {evidenceFile.fileName}
                      </span>
                      <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 shrink-0">
                        {formatEvidenceFileSize(evidenceFile.sizeBytes)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEvidenceFile(null)}
                      className="p-1 rounded hover:bg-emerald-200/60 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 cursor-pointer"
                      aria-label="Quitar comprobante"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Governance Info Banner */}
              <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/50 text-[11px] text-amber-900 dark:text-amber-200">
                <strong>Control Contable:</strong> Al registrar el pago, se enviará automáticamente a{' '}
                <strong>Contabilidad → Pagos para Validación</strong>. El saldo del cliente y de su préstamo no cambiarán hasta que Contabilidad presione <strong>Validar</strong>.
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={busy || !activeLoan}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{busy ? 'Registrando…' : 'Registrar Pago para Validación'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Client Payment History */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Historial de Pagos {selectedClient ? `de ${selectedClient.displayName}` : ''}
          </h3>
          <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
            {clientPayments.length} registros
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#00B8FF]/15 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Fecha</th>
                <th className="py-2.5 px-3">Préstamo</th>
                <th className="py-2.5 px-3">Cliente</th>
                <th className="py-2.5 px-3">Método / Referencia</th>
                <th className="py-2.5 px-3 text-right">Monto</th>
                <th className="py-2.5 px-3">Comprobante</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {clientPayments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    No hay pagos registrados para este cliente todavía.
                  </td>
                </tr>
              ) : (
                clientPayments.slice(0, 25).map((p) => {
                  const receipt = collectionReceipts.find(
                    (r) => r.paymentId === p.id && r.status === 'EMITIDO'
                  );
                  const isPending = isPaymentPendingValidation(p.status);
                  const isUploading = uploadingPaymentId === p.id;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-[#0C1B3B]/60">
                      <td className="py-2.5 px-3 font-mono tabular-nums">{p.paymentDate}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-white">
                        {p.loanNumber}
                      </td>
                      <td className="py-2.5 px-3">{p.customerName}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                        {p.method} · {p.referenceNumber}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                        {formatMoney(p.amount, p.currency)}
                      </td>
                      <td className="py-2.5 px-3">
                        {p.receiptEvidenceDataUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewPayment(p)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-sky-200 dark:border-[#00B8FF]/30 bg-sky-50 dark:bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Ver</span>
                          </button>
                        ) : isPending && canReport ? (
                          <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200 font-medium cursor-pointer">
                            <Upload className="w-3 h-3" />
                            <span>{isUploading ? 'Subiendo…' : 'Subir Comprobante'}</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              disabled={isUploading}
                              onChange={(e) => void handleInlineAttachEvidence(p, e)}
                              className="hidden"
                            />
                          </label>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {p.receiptEvidenceName || '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span
                          className={
                            p.status === 'APLICADO'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isPending
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }
                        >
                          {getPaymentValidationStatusLabel(p.status)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-2">
                        {isPending && canOpenValidation && (
                          <button
                            type="button"
                            onClick={() => setActiveSection('accounting_payment_validation')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 font-semibold cursor-pointer"
                          >
                            <span>Validar en Contabilidad</span>
                          </button>
                        )}
                        {receipt && (
                          <button
                            type="button"
                            onClick={() => openReceiptPreview(receipt)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-[#0C1B3B] font-semibold cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>Recibo</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
