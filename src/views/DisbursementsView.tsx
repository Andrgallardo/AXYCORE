import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileUp,
  Lock,
  Printer,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { executeIdempotentDisbursement, generateId } from '../services/axycoreStore';
import { canExecuteDisbursement } from '../engine/workflowGuards';
import {
  calculateRenewalNetDisbursement,
  computeRenewalPayoffBreakdown,
} from '../engine/renewalEngine';
import { formatMoney, toIsoDateOnly } from '../utils/formatters';
import type { DisbursementRecord } from '../types/axycore';

interface VoucherUploadFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export function DisbursementsView() {
  const {
    applications,
    customers,
    loans,
    loanInstallments,
    payments,
    collectionAccounts,
    creditRenewals,
    accountingAccounts,
    activeCollectionPolicy,
    organization,
    committeeDecisions,
    formalizations,
    disbursements,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const readyInbox = useMemo(
    () => applications.filter((a) => a.status === 'FORMALIZADA'),
    [applications]
  );

  const activeApp = useMemo(() => {
    if (selectedApplicationId) {
      const f = readyInbox.find((a) => a.id === selectedApplicationId);
      if (f) return f;
    }
    return readyInbox[0] ?? null;
  }, [readyInbox, selectedApplicationId]);

  const decision = useMemo(() => {
    if (!activeApp) return null;
    return (
      committeeDecisions.find(
        (d) =>
          d.applicationId === activeApp.id &&
          d.voteStatus === 'RESOLUCION_FINAL' &&
          ['APROBADO', 'APROBADO_CONDICIONADO'].includes(d.decision)
      ) ??
      committeeDecisions.find(
        (d) =>
          d.applicationId === activeApp.id &&
          ['APROBADO', 'APROBADO_CONDICIONADO'].includes(d.decision)
      ) ??
      null
    );
  }, [activeApp, committeeDecisions]);

  const formalization = useMemo(
    () => (activeApp ? formalizations.find((f) => f.applicationId === activeApp.id) ?? null : null),
    [activeApp, formalizations]
  );

  const existingDisb = useMemo(
    () => (activeApp ? disbursements.find((d) => d.applicationId === activeApp.id) ?? null : null),
    [activeApp, disbursements]
  );

  const [paymentMethod, setPaymentMethod] =
    useState<DisbursementRecord['paymentMethod']>('TRANSFERENCIA');
  const [financialEntity, setFinancialEntity] = useState('Banco Popular Dominicano');
  const [destinationAccount, setDestinationAccount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [disbursementDate, setDisbursementDate] = useState(toIsoDateOnly());
  const [authorizerName, setAuthorizerName] = useState('');
  const [voucherFile, setVoucherFile] = useState<VoucherUploadFile | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateId('idem'));
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
    movedToActive?: boolean;
  } | null>(null);

  const [printVoucherDisb, setPrintVoucherDisb] = useState<DisbursementRecord | null>(null);

  useEffect(() => {
    setIdempotencyKey(generateId('idem'));
  }, [activeApp?.id]);

  const renewalDisbSummary = useMemo(() => {
    if (!activeApp?.isRenewal || !formalization) return null;
    const renewal =
      creditRenewals.find(
        (r) => r.id === activeApp.renewalId || r.applicationId === activeApp.id
      ) ?? null;
    const originLoan =
      loans.find(
        (l) =>
          l.id ===
          (activeApp.originLoanId || formalization.originLoanId || renewal?.originLoanId)
      ) ?? null;
    const customer = customers.find((c) => c.id === activeApp.customerId) ?? null;
    const breakdown = originLoan
      ? computeRenewalPayoffBreakdown({
          loan: originLoan,
          installments: loanInstallments.filter((i) => i.loanId === originLoan.id),
          payments: payments.filter((p) => p.loanId === originLoan.id),
          customer,
          account: collectionAccounts.find((a) => a.loanId === originLoan.id) ?? null,
          policy: activeCollectionPolicy,
          asOfDateIso: disbursementDate || toIsoDateOnly(),
        }).breakdown
      : formalization.renewalPayoffBreakdown ??
        activeApp.originPayoffSnapshot ??
        renewal?.payoffSnapshot ??
        null;
    const payoffAmt = breakdown?.totalPayoffAmount ?? formalization.renewalPayoffAmount ?? 0;
    const netCalc = calculateRenewalNetDisbursement({
      grossApprovedAmount: formalization.approvedCapital,
      payoffAmount: payoffAmt,
      otherAuthorizedDiscounts: formalization.deductedExpenses,
    });
    return { renewal, originLoan, breakdown, payoffAmt, netCalc };
  }, [
    activeApp,
    formalization,
    creditRenewals,
    loans,
    customers,
    loanInstallments,
    payments,
    collectionAccounts,
    activeCollectionPolicy,
    disbursementDate,
  ]);

  const preCheck = useMemo(() => {
    if (!activeApp || !userProfile) return null;
    return canExecuteDisbursement({
      userRole: userProfile.role,
      application: activeApp,
      decision,
      formalization,
      existingDisbursementId: existingDisb?.id ?? null,
      liveRenewalPayoffAmount: renewalDisbSummary?.payoffAmt,
    });
  }, [activeApp, userProfile, decision, formalization, existingDisb, renewalDisbSummary?.payoffAmt]);

  const handleVoucherFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVoucherError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512_000) {
      setVoucherError('El archivo supera 500 KB. Seleccione una imagen o PDF más liviano.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl || dataUrl.length > 690_000) {
        setVoucherError('El comprobante codificado supera el límite permitido (~500 KB).');
        return;
      }
      setVoucherFile({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        dataUrl,
      });
    };
    reader.onerror = () => {
      setVoucherError('No se pudo leer el archivo seleccionado.');
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmDisbursement = async () => {
    if (!activeApp || !decision || !formalization || !userProfile) return;
    if (!voucherFile) {
      setFeedback({
        type: 'err',
        msg: 'Suba el comprobante de desembolso (PDF o imagen) antes de presionar Desembolsado.',
      });
      return;
    }
    if (!financialEntity.trim() || !destinationAccount.trim() || referenceNumber.trim().length < 2) {
      setFeedback({
        type: 'err',
        msg: 'Registre la entidad financiera, la cuenta destino y un número de referencia válido (mínimo 2 caracteres) antes de confirmar.',
      });
      return;
    }

    setProcessing(true);
    setFeedback(null);
    try {
      const res = await executeIdempotentDisbursement({
        application: activeApp,
        decision,
        formalization,
        paymentMethod,
        financialEntity: financialEntity.trim(),
        destinationAccountRaw: destinationAccount.trim(),
        referenceNumber: referenceNumber.trim(),
        receiptNotes: receiptNotes.trim(),
        disbursementDate,
        authorizerUserId: userProfile.uid,
        authorizerUserName: authorizerName.trim() || userProfile.displayName,
        idempotencyKey,
        voucherFile,
        accountingAccounts,
        collectionPolicy: activeCollectionPolicy,
        user: userProfile,
      });
      setVoucherFile(null);
      setDestinationAccount('');
      setReferenceNumber('');
      setReceiptNotes('');
      setIdempotencyKey(generateId('idem'));
      if (res.disbursement.isRenewal) {
        setPrintVoucherDisb(res.disbursement);
      }
      setFeedback({
        type: 'ok',
        movedToActive: true,
        msg: res.disbursement.isRenewal
          ? `Renovación desembolsada (${res.disbursement.disbursementNumber}). Préstamo anterior ${res.disbursement.originLoanNumber} liquidado atómicamente (CANCELADO_POR_RENOVACION), nuevo préstamo ${res.loan.loanNumber} activado y asiento contable contabilizado.`
          : `Desembolso ${res.disbursement.disbursementNumber} confirmado. El préstamo ${res.loan.loanNumber} pasó oficialmente a la cartera de Activos y se envió un correo al cliente informándole que su préstamo ya se encuentra en su cuenta de banco.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error confirmando el desembolso.',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          Desembolso de Créditos Formalizados
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Adjunte el comprobante de desembolso, confirme la entrega de fondos y active oficialmente el préstamo en la cartera de Activos con notificación por correo al cliente.
        </p>
      </div>

      {readyInbox.length === 0 ? (
        <div className="axy-surface p-8 rounded-2xl text-center space-y-3">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 text-left ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <span>{feedback.msg}</span>
            </div>
          )}
          <p className="text-sm text-slate-500 dark:text-slate-400">No hay expedientes formalizados listos para desembolso.</p>
          <button
            type="button"
            onClick={() => setActiveSection('loans')}
            className="axy-btn-primary px-4 py-2 text-xs cursor-pointer"
          >
            Ir a Activos
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-2">
            {readyInbox.map((app) => (
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
                <p className="font-mono text-xs text-slate-500">{app.applicationNumber}</p>
                <p className="font-semibold text-sm text-slate-950 dark:text-white mt-1">{app.applicantDisplayName}</p>
                <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">{formatMoney(app.recommendedAmount ?? app.requestedAmount, app.currency)}</p>
              </button>
            ))}
          </div>

          {activeApp && !formalization && (
            <div className="lg:col-span-8 axy-surface p-6 rounded-2xl border-amber-200 dark:border-amber-800/60 space-y-3 text-xs">
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">
                Expediente {activeApp.applicationNumber} sin paquete de formalización registrado
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Para ejecutar el desembolso de <strong>{activeApp.applicantDisplayName}</strong>, primero completa y confirma el paquete contractual (Pagaré y Contrato) en el módulo de Formalización.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedApplicationId(activeApp.id);
                  setActiveSection('formalization');
                }}
                className="axy-btn-primary px-4 py-2 cursor-pointer"
              >
                Ir a Formalización
              </button>
            </div>
          )}

          {activeApp && formalization && (
            <div className="lg:col-span-8 space-y-5 text-xs">
              {feedback && (
                <div
                  className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                    feedback.type === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  <span>{feedback.msg}</span>
                  {feedback.movedToActive && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('loans')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                    >
                      Ir a Activos
                    </button>
                  )}
                </div>
              )}

              {/* 7 Controls Checklist */}
              <div className="axy-surface p-5 rounded-2xl space-y-3">
                <h3 className="font-semibold text-sm text-slate-950 dark:text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                  Verificación de Precondiciones de Control Interno
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['1. Aprobación vigente', Boolean(decision && ['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision.decision))],
                    ['2. Condiciones de comité cumplidas', Boolean(formalization.conditionsFulfilled)],
                    ['3. Expediente formalizado', activeApp.status === 'FORMALIZADA' && formalization.status === 'LISTA_PARA_DESEMBOLSO'],
                    ['4. Documentos obligatorios completos', formalization.requiredDocsChecklist.every((d) => d.completed)],
                    ['5. Condiciones financieras coincidentes', decision?.approvedAmount === formalization.approvedCapital],
                    ['6. Usuario facultado', rbac.hasPermission('EXECUTE_DISBURSEMENT')],
                    ['7. Sin desembolso previo (Idempotencia)', !existingDisb],
                  ].map(([label, ok]) => (
                    <div key={String(label)} className="flex items-center gap-2">
                      <CheckCircle2 className={`w-4 h-4 ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
                      <span>{String(label)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {preCheck && !preCheck.allowed && (
                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {preCheck.reason}
                </div>
              )}

              {/* Mandatory Renewal Liquidation & Net Disbursement Summary */}
              {activeApp.isRenewal && renewalDisbSummary && (
                <div
                  className={`p-5 rounded-2xl border space-y-3 ${
                    renewalDisbSummary.netCalc.valid
                      ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                      : 'border-rose-500/50 bg-rose-500/10'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display font-bold text-sm text-slate-950 dark:text-white flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        Liquidación Coordinada por Renovación · Préstamo Anterior {activeApp.originLoanNumber}
                      </span>
                    </h3>
                    <span className="text-[11px] font-mono text-slate-500">
                      Cálculo al {disbursementDate}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 font-mono tabular-nums">
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Monto Nuevo Aprobado</span>
                      <strong className="text-sm text-slate-950 dark:text-white">
                        {formatMoney(formalization.approvedCapital, activeApp.currency)}
                      </strong>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Capital Anterior</span>
                      <strong className="text-sm text-amber-700 dark:text-amber-300">
                        -{formatMoney(renewalDisbSummary.breakdown?.remainingPrincipal ?? 0, activeApp.currency)}
                      </strong>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Interés / Mora / Cargos</span>
                      <strong className="text-sm text-amber-700 dark:text-amber-300">
                        -{formatMoney(
                          (renewalDisbSummary.breakdown?.remainingInterest ?? 0) +
                            (renewalDisbSummary.breakdown?.remainingLateFee ?? 0) +
                            (renewalDisbSummary.breakdown?.remainingCharges ?? 0),
                          activeApp.currency
                        )}
                      </strong>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Otros Descuentos</span>
                      <strong className="text-sm text-slate-700 dark:text-slate-200">
                        -{formatMoney(formalization.deductedExpenses, activeApp.currency)}
                      </strong>
                    </div>
                    <div
                      className={`p-3 rounded-xl border ${
                        renewalDisbSummary.netCalc.valid
                          ? 'bg-emerald-600/15 border-emerald-500/40'
                          : 'bg-rose-600/15 border-rose-500/45'
                      }`}
                    >
                      <span className="block font-sans text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-200">
                        Desembolso Neto a Entregar
                      </span>
                      <strong
                        className={`text-base ${
                          renewalDisbSummary.netCalc.valid
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {formatMoney(renewalDisbSummary.netCalc.netDisbursementAmount, activeApp.currency)}
                      </strong>
                    </div>
                  </div>

                  {!renewalDisbSummary.netCalc.valid ? (
                    <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-800 dark:text-rose-200 font-semibold flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{renewalDisbSummary.netCalc.reason}</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      Al confirmar <strong>Desembolsado</strong>, AxyCore ejecutará en una sola transacción atómica: (1) cancelación total de {activeApp.originLoanNumber} (<strong>CANCELADO_POR_RENOVACION</strong>, saldo 0.00), (2) activación del nuevo crédito, (3) asiento contable balanceado de liquidación + neto, y (4) comprobante de desembolso por renovación. Si ocurre un error, el préstamo anterior permanecerá intacto.
                    </p>
                  )}
                </div>
              )}

              <div className="axy-surface p-5 rounded-2xl space-y-4">
                <div className="axy-surface-tonal grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl font-mono">
                  <div>
                    <p className="font-sans text-slate-500">Monto Aprobado</p>
                    <p className="font-bold text-sm tabular-nums">{formatMoney(formalization.approvedCapital, activeApp.currency)}</p>
                  </div>
                  <div>
                    <p className="font-sans text-slate-500">Total Financiado</p>
                    <p className="font-bold text-sm tabular-nums">{formatMoney(formalization.totalFinanced, activeApp.currency)}</p>
                  </div>
                  <div>
                    <p className="font-sans text-slate-500">
                      {renewalDisbSummary ? 'Liquidación + Gastos' : 'Gastos Totales'}
                    </p>
                    <p className="font-bold text-sm tabular-nums">
                      {formatMoney(
                        (renewalDisbSummary?.payoffAmt ?? 0) +
                          formalization.financedExpenses +
                          formalization.deductedExpenses,
                        activeApp.currency
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="font-sans text-[#0066FF] dark:text-[#00D1FF] font-semibold">Neto a Entregar</p>
                    <p className="font-bold text-sm tabular-nums">
                      {formatMoney(
                        renewalDisbSummary
                          ? renewalDisbSummary.netCalc.netDisbursementAmount
                          : formalization.netDisbursementAmount,
                        activeApp.currency
                      )}
                    </p>
                  </div>
                </div>

                {/* Upload Comprobante de Desembolso */}
                <div className="p-4 rounded-xl border-2 border-dashed border-[#0066FF]/35 dark:border-[#00B8FF]/35 bg-[#0066FF]/[0.04] dark:bg-[#040C1E]/75 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                        <FileUp className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                        Subir Comprobante de Desembolso (Archivo PDF o Imagen) *
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Adjunta el comprobante bancario de transferencia o depósito (máx. 500 KB) antes de marcar Desembolsado.
                      </p>
                    </div>
                    <label className="axy-btn-primary inline-flex items-center gap-1.5 px-3 py-2 cursor-pointer">
                      <FileUp className="w-3.5 h-3.5" />
                      <span>{voucherFile ? 'Cambiar Archivo' : 'Seleccionar Archivo'}</span>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={handleVoucherFileChange}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {voucherError && (
                    <p className="text-rose-600 dark:text-rose-400 font-medium">{voucherError}</p>
                  )}

                  {voucherFile && (
                    <div className="axy-surface flex items-center justify-between gap-3 p-2.5 rounded-xl">
                      <div className="flex items-center gap-3 min-w-0">
                        {voucherFile.mimeType.startsWith('image/') && (
                          <img
                            src={voucherFile.dataUrl}
                            alt={voucherFile.fileName}
                            className="w-10 h-10 rounded object-cover border border-slate-200 dark:border-white/12 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white truncate">
                            {voucherFile.fileName}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            {voucherFile.mimeType} · {(voucherFile.sizeBytes / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVoucherFile(null)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Quitar
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-500">Fecha de Desembolso</label>
                    <input
                      type="date"
                      value={disbursementDate}
                      onChange={(e) => setDisbursementDate(e.target.value)}
                      className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Medio de Pago</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as DisbursementRecord['paymentMethod'])}
                      className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                    >
                      <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="EFECTIVO_CAJA">Efectivo en Caja</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Entidad Financiera</label>
                    <input
                      value={financialEntity}
                      onChange={(e) => setFinancialEntity(e.target.value)}
                      className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Cuenta Destino (se almacenará enmascarada) *</label>
                    <input
                      value={destinationAccount}
                      onChange={(e) => setDestinationAccount(e.target.value)}
                      placeholder="Ej. 7845123456"
                      className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Número de Referencia / Comprobante *</label>
                    <input
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      placeholder="Ej. LBTR-2026-99102"
                      className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Usuario Autorizador</label>
                    <input
                      value={authorizerName}
                      onChange={(e) => setAuthorizerName(e.target.value)}
                      placeholder={userProfile?.displayName}
                      className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-slate-500">Evidencia y Notas del Comprobante</label>
                  <textarea
                    rows={2}
                    value={receiptNotes}
                    onChange={(e) => setReceiptNotes(e.target.value)}
                    placeholder="Detalle de comprobante bancario verificado por Operaciones/Finanzas..."
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-[#00B8FF]/14">
                  <span className="font-mono text-slate-500">Llave idempotencia: {idempotencyKey}</span>
                  <button
                    type="button"
                    disabled={processing || !preCheck?.allowed}
                    onClick={handleConfirmDisbursement}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {processing ? 'Procesando desembolso...' : 'Desembolsado'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {disbursements.length > 0 && (
        <div className="axy-surface rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/14">
            <h3 className="font-display text-sm font-semibold text-slate-950 dark:text-white">Desembolsos Confirmados ({disbursements.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3 font-semibold">N.º Desembolso</th>
                  <th className="py-2.5 px-3 font-semibold">Fecha</th>
                  <th className="py-2.5 px-3 font-semibold">Medio / Banco</th>
                  <th className="py-2.5 px-3 font-semibold">Cuenta Destino</th>
                  <th className="py-2.5 px-3 font-semibold">Referencia</th>
                  <th className="py-2.5 px-3 font-semibold">Comprobante</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Neto Entregado</th>
                  <th className="py-2.5 px-3 font-semibold">Estado</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Recibo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12 font-mono">
                {disbursements.map((d) => (
                  <tr key={d.id} className="axy-table-row">
                    <td className="py-2 px-3 font-semibold">
                      <div>{d.disbursementNumber}</div>
                      {d.isRenewal && (
                        <div className="font-sans text-[10px] text-emerald-600 dark:text-emerald-400">
                          Renovación de {d.originLoanNumber}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3">{d.disbursementDate}</td>
                    <td className="py-2 px-3 font-sans">{d.paymentMethod} · {d.financialEntity}</td>
                    <td className="py-2 px-3">{d.destinationAccountMasked}</td>
                    <td className="py-2 px-3">{d.referenceNumber}</td>
                    <td className="py-2 px-3 font-sans">{d.voucherFileName || '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <div>{d.netDeliveredAmount.toLocaleString()}</div>
                      {d.isRenewal && d.renewalPayoffAmount ? (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          Liq: -{d.renewalPayoffAmount.toLocaleString()}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 font-sans text-emerald-700 dark:text-emerald-400 font-semibold">{d.status}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPrintVoucherDisb(d)}
                        className="font-sans inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0066FF]/12 hover:bg-[#0066FF]/22 text-[#0052CC] dark:text-[#00D1FF] text-[11px] font-semibold cursor-pointer"
                      >
                        <Printer className="w-3 h-3" />
                        <span>Comprobante</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printable Disbursement / Renewal Liquidation Voucher Modal */}
      {printVoucherDisb && (() => {
        const linkedLoan = loans.find((l) => l.disbursementId === printVoucherDisb.id) ?? null;
        const linkedApp = applications.find((a) => a.id === printVoucherDisb.applicationId) ?? null;
        const curr = linkedLoan?.currency || linkedApp?.currency || 'DOP';
        const handlePrintIframe = () => {
          const iframe = document.createElement('iframe');
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '0';
          iframe.style.height = '0';
          iframe.style.border = '0';
          document.body.appendChild(iframe);
          const docRef = iframe.contentWindow?.document;
          if (!docRef) {
            document.body.removeChild(iframe);
            return;
          }
          const logoHtml = organization.logoUrl
            ? `<img src="${organization.logoUrl}" alt="Logo" style="height:48px;object-fit:contain;" />`
            : '';
          docRef.open();
          docRef.write(`<!DOCTYPE html><html><head><title>Comprobante ${printVoucherDisb.disbursementNumber}</title>
            <style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a;font-size:12px;}
            .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #0f3d91;padding-bottom:12px;margin-bottom:16px;}
            table{width:100%;border-collapse:collapse;margin-top:12px;}td,th{padding:8px;border:1px solid #cbd5e1;text-align:left;}
            .r{text-align:right;font-family:monospace;}.tot{background:#ecfdf5;font-weight:bold;font-size:14px;}</style></head><body>
            <div class="hdr"><div>${logoHtml}<h2 style="margin:4px 0 0;">${organization.tradeName || organization.name}</h2>
            <div>RNC: ${organization.rnc || '—'} · Tel: ${organization.phone || '—'}</div></div>
            <div style="text-align:right;"><h3 style="margin:0;color:#0f3d91;">${printVoucherDisb.isRenewal ? 'COMPROBANTE DE DESEMBOLSO POR RENOVACIÓN' : 'COMPROBANTE DE DESEMBOLSO'}</h3>
            <div>N° ${printVoucherDisb.disbursementNumber} · Fecha: ${printVoucherDisb.disbursementDate}</div></div></div>
            <p><strong>Cliente:</strong> ${linkedApp?.applicantDisplayName || '—'} · <strong>Préstamo Nuevo:</strong> ${linkedLoan?.loanNumber || '—'}${printVoucherDisb.originLoanNumber ? ` · <strong>Préstamo Anterior Liquidado:</strong> ${printVoucherDisb.originLoanNumber}` : ''}</p>
            <p><strong>Medio de Pago:</strong> ${printVoucherDisb.paymentMethod} · <strong>Entidad:</strong> ${printVoucherDisb.financialEntity} · <strong>Cuenta:</strong> ${printVoucherDisb.destinationAccountMasked} · <strong>Ref.:</strong> ${printVoucherDisb.referenceNumber}</p>
            <table><thead><tr><th>Concepto</th><th class="r">Monto (${curr})</th></tr></thead><tbody>
            <tr><td>Monto Nuevo Aprobado</td><td class="r">${formatMoney(printVoucherDisb.approvedAmount, curr)}</td></tr>
            ${printVoucherDisb.isRenewal ? `<tr><td>(-) Saldo Liquidado Préstamo Anterior (${printVoucherDisb.originLoanNumber || ''})</td><td class="r">-${formatMoney(printVoucherDisb.renewalPayoffAmount || 0, curr)}</td></tr>` : ''}
            <tr><td>(-) Otros Descuentos / Gastos Descontados</td><td class="r">-${formatMoney(printVoucherDisb.otherDiscountsAmount ?? Math.max(0, printVoucherDisb.approvedAmount - (printVoucherDisb.renewalPayoffAmount || 0) - printVoucherDisb.netDeliveredAmount), curr)}</td></tr>
            <tr class="tot"><td>DESEMBOLSO NETO ENTREGADO AL CLIENTE</td><td class="r">${formatMoney(printVoucherDisb.netDeliveredAmount, curr)}</td></tr>
            </tbody></table>
            <p style="margin-top:24px;">Autorizado por: <strong>${printVoucherDisb.authorizerUserName}</strong> · Confirmado por: <strong>${printVoucherDisb.responsibleUserName}</strong></p>
            </body></html>`);
          docRef.close();
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
          }, 1500);
        };
        return (
          <div className="fixed inset-0 z-50 bg-[#030816]/75 backdrop-blur-[2px] flex items-center justify-center p-4">
            <div className="axy-panel-in axy-surface w-full max-w-xl rounded-2xl border border-[var(--axy-border-strong)] shadow-2xl overflow-hidden text-xs">
              <div className="axy-infinity-line" />
              <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between gap-3 bg-[var(--axy-surface-tonal)]">
                <div>
                  <h4 className="font-display font-bold text-sm text-slate-950 dark:text-white">
                    {printVoucherDisb.isRenewal
                      ? 'Comprobante de Desembolso por Renovación'
                      : 'Comprobante de Desembolso'}
                  </h4>
                  <p className="font-mono text-[11px] text-slate-500">
                    {printVoucherDisb.disbursementNumber} · {printVoucherDisb.disbursementDate}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrintVoucherDisb(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--axy-border)]">
                  <div className="flex items-center gap-2.5">
                    {organization.logoUrl && (
                      <img src={organization.logoUrl} alt="Logo" className="h-9 w-auto object-contain" />
                    )}
                    <div>
                      <p className="font-bold text-slate-950 dark:text-white">
                        {organization.tradeName || organization.name}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        RNC: {organization.rnc || '—'} · Tel: {organization.phone || '—'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">Cliente:</span>{' '}
                    <strong>{linkedApp?.applicantDisplayName || '—'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Préstamo Nuevo:</span>{' '}
                    <strong className="font-mono">{linkedLoan?.loanNumber || '—'}</strong>
                  </div>
                  {printVoucherDisb.originLoanNumber && (
                    <div className="col-span-2 text-amber-700 dark:text-amber-300">
                      <span>Préstamo Anterior Liquidado:</span>{' '}
                      <strong className="font-mono">{printVoucherDisb.originLoanNumber}</strong>{' '}
                      (CANCELADO_POR_RENOVACION)
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-[var(--axy-border)] divide-y divide-[var(--axy-border)] font-mono tabular-nums">
                  <div className="p-2.5 flex justify-between">
                    <span className="font-sans text-slate-600 dark:text-slate-300">Monto Nuevo Aprobado</span>
                    <strong>{formatMoney(printVoucherDisb.approvedAmount, curr)}</strong>
                  </div>
                  {printVoucherDisb.isRenewal && (
                    <div className="p-2.5 flex justify-between text-amber-700 dark:text-amber-300">
                      <span className="font-sans">(-) Liquidación Préstamo Anterior</span>
                      <strong>-{formatMoney(printVoucherDisb.renewalPayoffAmount || 0, curr)}</strong>
                    </div>
                  )}
                  <div className="p-2.5 flex justify-between">
                    <span className="font-sans text-slate-600 dark:text-slate-300">(-) Otros Descuentos</span>
                    <strong>
                      -
                      {formatMoney(
                        printVoucherDisb.otherDiscountsAmount ??
                          Math.max(
                            0,
                            printVoucherDisb.approvedAmount -
                              (printVoucherDisb.renewalPayoffAmount || 0) -
                              printVoucherDisb.netDeliveredAmount
                          ),
                        curr
                      )}
                    </strong>
                  </div>
                  <div className="p-3 flex justify-between bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-sm">
                    <span className="font-sans font-bold">DESEMBOLSO NETO ENTREGADO</span>
                    <strong>{formatMoney(printVoucherDisb.netDeliveredAmount, curr)}</strong>
                  </div>
                </div>
              </div>
              <div className="px-5 py-3.5 border-t border-[var(--axy-border)] flex justify-end gap-2 bg-[var(--axy-surface-tonal)]">
                <button
                  type="button"
                  onClick={() => setPrintVoucherDisb(null)}
                  className="axy-btn-secondary px-4 py-2 cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={handlePrintIframe}
                  className="axy-btn-primary px-4 py-2 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir Comprobante</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

