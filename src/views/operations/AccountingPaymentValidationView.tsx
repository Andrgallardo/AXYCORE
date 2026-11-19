import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  Search,
  Upload,
  XCircle,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useAxyCore } from '../../context/AxyCoreContext';
import { PaymentEvidencePreviewModal } from '../../components/PaymentEvidencePreviewModal';
import { allocatePaymentAcrossInstallments } from '../../engine/collections/paymentsAndReconciliationEngine';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  attachPaymentEvidence,
  rejectReportedPayment,
  verifyAndApplyPaymentTransaction,
} from '../../services/collectionsStore';
import type { CollectionReceiptRecord, PaymentRecord } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';
import {
  downloadPaymentEvidence,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
  processPaymentEvidenceFile,
} from '../../utils/paymentEvidence';

type ValidationFilterTab = 'PENDING' | 'VALIDATED' | 'REJECTED' | 'ALL';

export function AccountingPaymentValidationView({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const {
    userProfile,
    organization,
    loans,
    loanInstallments,
    payments,
    paymentPromises,
    collectionReceipts,
    activeCollectionPolicy,
    setSelectedCollectionLoanId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const [filterTab, setFilterTab] = useState<ValidationFilterTab>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [rejectingPaymentId, setRejectingPaymentId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [previewPayment, setPreviewPayment] = useState<PaymentRecord | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
    receipt?: CollectionReceiptRecord;
  } | null>(null);

  const canValidate = rbac.hasPermission('VERIFY_AND_APPLY_PAYMENTS');
  const canAttachEvidence =
    rbac.hasPermission('REPORT_PAYMENTS') || rbac.hasPermission('VERIFY_AND_APPLY_PAYMENTS');

  const pendingPayments = useMemo(
    () =>
      payments
        .filter((p) => isPaymentPendingValidation(p.status))
        .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')),
    [payments]
  );

  const validatedPayments = useMemo(
    () =>
      payments
        .filter((p) => p.status === 'APLICADO')
        .sort((a, b) => (b.appliedAt || b.paymentDate || '').localeCompare(a.appliedAt || a.paymentDate || '')),
    [payments]
  );

  const rejectedPayments = useMemo(
    () =>
      payments
        .filter((p) => p.status === 'RECHAZADO' || p.status === 'REVERTIDO')
        .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || '')),
    [payments]
  );

  const kpis = useMemo(() => {
    const pendingDop = pendingPayments
      .filter((p) => p.currency === 'DOP')
      .reduce((sum, p) => sum + p.amount, 0);
    const pendingUsd = pendingPayments
      .filter((p) => p.currency === 'USD')
      .reduce((sum, p) => sum + p.amount, 0);
    const withEvidenceCount = pendingPayments.filter(
      (p) => Boolean(p.receiptEvidenceDataUrl || p.receiptEvidenceName)
    ).length;
    return {
      pendingCount: pendingPayments.length,
      pendingDop,
      pendingUsd,
      withEvidenceCount,
      validatedCount: validatedPayments.length,
    };
  }, [pendingPayments, validatedPayments]);

  const filteredPayments = useMemo(() => {
    const base =
      filterTab === 'PENDING'
        ? pendingPayments
        : filterTab === 'VALIDATED'
        ? validatedPayments
        : filterTab === 'REJECTED'
        ? rejectedPayments
        : [...payments].sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));

    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) =>
        (p.customerName || '').toLowerCase().includes(q) ||
        (p.loanNumber || '').toLowerCase().includes(q) ||
        (p.referenceNumber || '').toLowerCase().includes(q) ||
        (p.bankName || '').toLowerCase().includes(q) ||
        (p.reportedByName || '').toLowerCase().includes(q)
    );
  }, [filterTab, pendingPayments, validatedPayments, rejectedPayments, payments, searchQuery]);

  const downloadReceiptPdf = (receipt: CollectionReceiptRecord) => {
    const docPdf = new jsPDF({ unit: 'pt', format: 'a4' });
    docPdf.setFillColor(4, 12, 30);
    docPdf.rect(0, 0, 595, 72, 'F');
    docPdf.setTextColor(255, 255, 255);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(14);
    docPdf.text(`${organization.tradeName || organization.name} · RECIBO OFICIAL VALIDADO`, 36, 32);
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9.5);
    docPdf.text(`Recibo ${receipt.receiptNumber} · Préstamo ${receipt.loanNumber}`, 36, 52);

    docPdf.setTextColor(15, 23, 42);
    docPdf.setFontSize(10.5);
    const lines = [
      `Cliente: ${receipt.customerName}`,
      `Fecha de Pago: ${receipt.paymentDate}`,
      `Referencia: ${receipt.referenceNumber}`,
      `Estado: ${receipt.status}`,
      `Monto Validado y Aplicado: ${formatMoney(receipt.amount, receipt.currency)}`,
      `Mora: ${formatMoney(receipt.appliedToLateFee, receipt.currency)} · Cargos: ${formatMoney(receipt.appliedToCharges, receipt.currency)}`,
      `Interés: ${formatMoney(receipt.appliedToInterest, receipt.currency)} · Capital: ${formatMoney(receipt.appliedToPrincipal, receipt.currency)}`,
      `Saldo Capital Posterior: ${formatMoney(receipt.remainingPrincipalAfter, receipt.currency)}`,
      `Validado por: ${receipt.issuedByName}`,
    ];
    let y = 108;
    for (const ln of lines) {
      docPdf.text(ln, 36, y);
      y += 22;
    }
    docPdf.save(`${receipt.receiptNumber}.pdf`);
  };

  const handleValidatePayment = async (pay: PaymentRecord) => {
    if (!userProfile || !canValidate) return;
    const targetLoan = loans.find((l) => l.id === pay.loanId || l.loanNumber === pay.loanNumber);
    if (!targetLoan) {
      setFeedback({
        type: 'err',
        msg: `No se encontró el préstamo asociado (${pay.loanNumber || pay.loanId}) para validar este pago.`,
      });
      return;
    }

    setBusyPaymentId(pay.id);
    setFeedback(null);
    const previousBalance = targetLoan.currentPrincipalBalance;
    try {
      const res = await verifyAndApplyPaymentTransaction({
        payment: pay,
        loan: targetLoan,
        installments: loanInstallments,
        promises: paymentPromises,
        policy: activeCollectionPolicy,
        user: userProfile,
      });

      const syntheticReceipt: CollectionReceiptRecord = {
        id: `rec_${pay.id}`,
        organizationId: pay.organizationId,
        receiptNumber: res.receiptNumber,
        paymentId: pay.id,
        loanId: targetLoan.id,
        loanNumber: targetLoan.loanNumber,
        customerId: targetLoan.customerId,
        customerName: pay.customerName,
        currency: targetLoan.currency,
        amount: pay.amount,
        appliedToPrincipal: res.appliedPrincipalTotal,
        appliedToInterest: res.appliedInterestTotal,
        appliedToLateFee: res.appliedLateFeeTotal,
        appliedToCharges: res.appliedChargesTotal,
        remainingPrincipalAfter: res.nextPrincipalBalance,
        paymentDate: pay.paymentDate,
        referenceNumber: pay.referenceNumber,
        issuedBy: userProfile.uid,
        issuedByName: userProfile.displayName || userProfile.email,
        issuedAt: new Date().toISOString(),
        status: 'EMITIDO',
      };

      setFeedback({
        type: 'ok',
        msg: `Pago validado para ${pay.customerName} (${targetLoan.loanNumber}). Recibo ${res.receiptNumber} emitido · Saldo capital actualizado de ${formatMoney(previousBalance, targetLoan.currency)} a ${formatMoney(res.nextPrincipalBalance, targetLoan.currency)} (Capital: ${formatMoney(res.appliedPrincipalTotal, targetLoan.currency)} · Interés: ${formatMoney(res.appliedInterestTotal, targetLoan.currency)} · Mora: ${formatMoney(res.appliedLateFeeTotal, targetLoan.currency)}).`,
        receipt: syntheticReceipt,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo validar el pago.',
      });
    } finally {
      setBusyPaymentId(null);
    }
  };

  const handleRejectPayment = async (pay: PaymentRecord) => {
    if (!userProfile || !canValidate) return;
    const reason = rejectReason.trim() || 'Comprobante no verificado en conciliación contable.';
    setBusyPaymentId(pay.id);
    setFeedback(null);
    try {
      await rejectReportedPayment({
        payment: pay,
        reason,
        user: userProfile,
      });
      setRejectingPaymentId(null);
      setRejectReason('');
      setFeedback({
        type: 'ok',
        msg: `Pago de ${pay.customerName} (${pay.loanNumber}) marcado como RECHAZADO sin afectar el balance del préstamo.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error rechazando el pago.',
      });
    } finally {
      setBusyPaymentId(null);
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
        msg: `Comprobante "${encoded.fileName}" adjuntado correctamente al pago de ${pay.customerName}.`,
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

  const estimateBalanceAfterValidation = (pay: PaymentRecord) => {
    const targetLoan = loans.find((l) => l.id === pay.loanId || l.loanNumber === pay.loanNumber);
    if (!targetLoan || !isPaymentPendingValidation(pay.status)) return null;
    try {
      const loanInsts = loanInstallments.filter((i) => i.loanId === targetLoan.id);
      const preview = allocatePaymentAcrossInstallments({
        payment: pay,
        loan: targetLoan,
        installments: loanInsts,
        imputationOrder: activeCollectionPolicy.imputationOrder,
        asOfDateIso: getSantoDomingoTodayIso(),
      });
      return {
        currentBalance: targetLoan.currentPrincipalBalance,
        nextBalance: preview.nextLoanPrincipalBalance,
        principalDelta: preview.appliedPrincipalTotal,
      };
    } catch {
      return {
        currentBalance: targetLoan.currentPrincipalBalance,
        nextBalance: Math.max(0, targetLoan.currentPrincipalBalance - pay.amount),
        principalDelta: pay.amount,
      };
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2
            className={`font-display font-bold text-slate-950 dark:text-white flex items-center gap-2 ${
              embedded ? 'text-base' : 'text-xl'
            }`}
          >
            <ClipboardCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Pagos para Validación</span>
            {kpis.pendingCount > 0 && (
              <span className="font-mono tabular-nums text-xs px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/70 dark:border-amber-700/60">
                {kpis.pendingCount} pendientes
              </span>
            )}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Listado de pagos registrados por clientes y gestores en espera de control contable. El balance del cliente y de su préstamo únicamente se afectan al presionar{' '}
            <strong className="text-slate-800 dark:text-slate-200">Validar</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {embedded && (
            <button
              type="button"
              onClick={() => setActiveSection('accounting_payment_validation')}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer"
            >
              Ver Pantalla Completa
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveSection('register_payment')}
            className="px-3 py-1.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer"
          >
            + Registrar Pago de Cliente
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      {!embedded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Clientes / Pagos por Validar
            </p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-amber-600 dark:text-amber-400">
              {kpis.pendingCount}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Sin afectar balance todavía
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Monto Pendiente (DOP)
            </p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-950 dark:text-white">
              {formatMoney(kpis.pendingDop, 'DOP')}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              USD: {formatMoney(kpis.pendingUsd, 'USD')}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Con Comprobante Adjunto
            </p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-[#0052CC] dark:text-[#00D1FF]">
              {kpis.withEvidenceCount} / {kpis.pendingCount}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Listos para verificación visual
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Pagos Validados y Aplicados
            </p>
            <p className="mt-1 font-mono tabular-nums text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {kpis.validatedCount}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Reflejados en cartera y contabilidad
            </p>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border font-medium flex flex-wrap items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          <span>{feedback.msg}</span>
          {feedback.receipt && (
            <button
              type="button"
              onClick={() => downloadReceiptPdf(feedback.receipt!)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Recibo PDF</span>
            </button>
          )}
        </div>
      )}

      {!canValidate && (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Vista de consulta. Solo los roles autorizados de Contabilidad/Finanzas o Administrador pueden ejecutar la acción Validar para afectar el saldo del cliente.
        </div>
      )}

      {/* Filter Toolbar & Client List Table */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-[#00B8FF]/15">
            {(
              [
                { id: 'PENDING', label: `Pendientes (${pendingPayments.length})` },
                { id: 'VALIDATED', label: `Validados (${validatedPayments.length})` },
                { id: 'REJECTED', label: `Rechazados (${rejectedPayments.length})` },
                { id: 'ALL', label: `Todos (${payments.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === tab.id
                    ? 'axy-brand-gradient text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[230px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, préstamo o referencia…"
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-[#00B8FF]/15 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Cliente / Préstamo</th>
                <th className="py-3 px-3">Fecha / Canal / Referencia</th>
                <th className="py-3 px-3 text-right">Monto del Pago</th>
                <th className="py-3 px-3 text-right">Impacto en Saldo</th>
                <th className="py-3 px-3">Comprobante</th>
                <th className="py-3 px-3">Estado</th>
                <th className="py-3 px-4 text-right">Validación Contable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    {filterTab === 'PENDING'
                      ? 'No hay pagos pendientes de validación en este momento.'
                      : 'No se encontraron pagos que coincidan con el filtro seleccionado.'}
                  </td>
                </tr>
              ) : (
                (embedded ? filteredPayments.slice(0, 12) : filteredPayments).map((pay) => {
                  const isPending = isPaymentPendingValidation(pay.status);
                  const targetLoan = loans.find(
                    (l) => l.id === pay.loanId || l.loanNumber === pay.loanNumber
                  );
                  const balancePreview = isPending ? estimateBalanceAfterValidation(pay) : null;
                  const receipt = collectionReceipts.find(
                    (r) => r.paymentId === pay.id && r.status === 'EMITIDO'
                  );
                  const isRowBusy = busyPaymentId === pay.id;
                  const isUploading = uploadingPaymentId === pay.id;

                  return (
                    <React.Fragment key={pay.id}>
                      <tr className="hover:bg-slate-50/70 dark:hover:bg-[#0C1B3B]/60">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-950 dark:text-white">
                            {pay.customerName}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCollectionLoanId(pay.loanId)}
                              className="font-mono text-[11px] font-bold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                            >
                              {pay.loanNumber}
                            </button>
                            <span className="text-[11px] text-slate-400">
                              · Por: {pay.reportedByName}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                            {pay.paymentDate}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {pay.method} {pay.bankName ? `· ${pay.bankName}` : ''}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            Ref: {pay.referenceNumber}
                          </p>
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-sm text-slate-950 dark:text-white">
                          {formatMoney(pay.amount, pay.currency)}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[11px]">
                          {isPending && balancePreview ? (
                            <div>
                              <span className="text-slate-500 dark:text-slate-400 block">
                                Actual: {formatMoney(balancePreview.currentBalance, pay.currency)}
                              </span>
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                Al validar: {formatMoney(balancePreview.nextBalance, pay.currency)}
                              </span>
                            </div>
                          ) : targetLoan ? (
                            <span className="text-slate-500 dark:text-slate-400">
                              Saldo: {formatMoney(targetLoan.currentPrincipalBalance, targetLoan.currency)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          {pay.receiptEvidenceDataUrl ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPreviewPayment(pay)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-sky-200 dark:border-[#00B8FF]/30 bg-sky-50 dark:bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer hover:brightness-95"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Ver Comprobante</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadPaymentEvidence(pay)}
                                title="Descargar comprobante"
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-1">
                              {pay.receiptEvidenceName ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
                                  <FileText className="w-3 h-3 text-slate-400" />
                                  <span className="truncate max-w-[140px]">
                                    {pay.receiptEvidenceName}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">Sin archivo</span>
                              )}
                              {isPending && canAttachEvidence && (
                                <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
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
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <span
                            className={`inline-block font-semibold text-[11px] ${
                              pay.status === 'APLICADO'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : isPending
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {getPaymentValidationStatusLabel(pay.status)}
                          </span>
                          {pay.status === 'APLICADO' && pay.appliedByName && (
                            <p className="text-[10px] text-slate-400">
                              Por: {pay.appliedByName}
                            </p>
                          )}
                          {pay.status === 'RECHAZADO' && pay.reversalReason && (
                            <p className="text-[10px] text-rose-500 max-w-[180px] truncate" title={pay.reversalReason}>
                              {pay.reversalReason}
                            </p>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {isPending && canValidate && (
                              <>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => void handleValidatePayment(pay)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-xs"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>{isRowBusy ? 'Validando…' : 'Validar'}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isRowBusy}
                                  onClick={() => {
                                    setRejectingPaymentId(
                                      rejectingPaymentId === pay.id ? null : pay.id
                                    );
                                    setRejectReason('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Rechazar</span>
                                </button>
                              </>
                            )}
                            {receipt && pay.status === 'APLICADO' && (
                              <button
                                type="button"
                                onClick={() => downloadReceiptPdf(receipt)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-semibold cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Recibo PDF</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {rejectingPaymentId === pay.id && canValidate && (
                        <tr>
                          <td
                            colSpan={7}
                            className="p-3 bg-rose-50/80 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="Motivo del rechazo (ej: transferencia no reflejada en banco, monto distinto)…"
                                className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-[#040C1E] text-slate-900 dark:text-white"
                              />
                              <button
                                type="button"
                                disabled={isRowBusy}
                                onClick={() => void handleRejectPayment(pay)}
                                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Confirmar Rechazo
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectingPaymentId(null)}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-medium cursor-pointer"
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
    </div>
  );
}
