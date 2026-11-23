import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronRight,
  Eye,
  Percent,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  computeLateFeeDiscountPlan,
  listLoansWithPendingLateFee,
  type LateFeeDiscountMode,
  type LoanWithPendingLateFee,
} from '../../engine/collections/lateFeeDiscountEngine';
import { fromCents, getSantoDomingoTodayIso, toCents } from '../../engine/collections/delinquencyEngine';
import type { CurrencyCode } from '../../types/axycore';
import { formatMoney, PRODUCT_LABELS } from '../../utils/formatters';

const DISCOUNT_AUTHORIZED_ROLES = new Set([
  'ADMIN',
  'FINANCE',
  'OPERATIONS',
  'COLLECTION_COORDINATOR',
  'SUPERVISOR',
  'MANAGEMENT',
]);

export function CollectionsDiscountsView() {
  const {
    userProfile,
    loans,
    loanInstallments,
    collectionAccounts,
    activeCollectionPolicy,
    applyLateFeeDiscount,
    runDailyCollectionsSync,
    setSelectedCollectionLoanId,
    rbac,
  } = useAxyCore();

  const [search, setSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | CurrencyCode>('ALL');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [discountMode, setDiscountMode] = useState<LateFeeDiscountMode>('SPECIFIC_AMOUNT');
  const [amountInput, setAmountInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [confirmPermanentChecked, setConfirmPermanentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const todayIso = getSantoDomingoTodayIso();
  const canApplyDiscounts = Boolean(
    userProfile && DISCOUNT_AUTHORIZED_ROLES.has(userProfile.role)
  );

  // Strictly lists ONLY clients/loans that currently have pending Mora > 0
  const loansWithMora = useMemo<LoanWithPendingLateFee[]>(
    () =>
      listLoansWithPendingLateFee({
        loans,
        collectionAccounts,
        installments: loanInstallments,
        policy: activeCollectionPolicy,
        asOfDateIso: todayIso,
      }),
    [loans, collectionAccounts, loanInstallments, activeCollectionPolicy, todayIso]
  );

  const filteredLoans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return loansWithMora.filter((item) => {
      if (currencyFilter !== 'ALL' && item.currency !== currencyFilter) return false;
      if (q) {
        const hay = `${item.applicantDisplayName} ${item.loanNumber} ${item.customerPhone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [loansWithMora, currencyFilter, search]);

  const totalsByCurrency = useMemo(() => {
    let dopCents = 0;
    let usdCents = 0;
    let dopCount = 0;
    let usdCount = 0;
    for (const item of loansWithMora) {
      if (item.currency === 'USD') {
        usdCents += toCents(item.pendingLateFee);
        usdCount += 1;
      } else {
        dopCents += toCents(item.pendingLateFee);
        dopCount += 1;
      }
    }
    return {
      dopTotal: fromCents(dopCents),
      usdTotal: fromCents(usdCents),
      dopCount,
      usdCount,
    };
  }, [loansWithMora]);

  const selectedClient = useMemo(
    () => loansWithMora.find((item) => item.loanId === selectedLoanId) ?? null,
    [loansWithMora, selectedLoanId]
  );

  const parsedSpecificAmount = useMemo(() => {
    const cleaned = amountInput.replace(/,/g, '').trim();
    if (!cleaned) return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }, [amountInput]);

  // Live preview plan for the selected client & mode
  const previewResult = useMemo(() => {
    if (!selectedClient) return { plan: null, validationError: null as string | null };
    if (discountMode === 'SPECIFIC_AMOUNT') {
      if (!amountInput.trim()) {
        return { plan: null, validationError: null as string | null };
      }
      if (!Number.isFinite(parsedSpecificAmount) || parsedSpecificAmount <= 0) {
        return {
          plan: null,
          validationError: 'Ingresa un monto válido mayor que cero.',
        };
      }
      if (toCents(parsedSpecificAmount) > toCents(selectedClient.pendingLateFee)) {
        return {
          plan: null,
          validationError: `El monto supera la mora pendiente actual (${formatMoney(
            selectedClient.pendingLateFee,
            selectedClient.currency
          )}).`,
        };
      }
    }

    try {
      const loanInsts = loanInstallments.filter((i) => i.loanId === selectedClient.loanId);
      const plan = computeLateFeeDiscountPlan({
        loan: selectedClient.loan,
        installments: loanInsts,
        account: selectedClient.account,
        mode: discountMode,
        amount: discountMode === 'SPECIFIC_AMOUNT' ? parsedSpecificAmount : undefined,
        policy: activeCollectionPolicy,
        asOfDateIso: todayIso,
      });
      return { plan, validationError: null as string | null };
    } catch (err) {
      return {
        plan: null,
        validationError: err instanceof Error ? err.message : 'Monto inválido.',
      };
    }
  }, [
    selectedClient,
    discountMode,
    amountInput,
    parsedSpecificAmount,
    loanInstallments,
    activeCollectionPolicy,
    todayIso,
  ]);

  const handleSelectClient = (item: LoanWithPendingLateFee) => {
    setSelectedLoanId(item.loanId);
    setDiscountMode('SPECIFIC_AMOUNT');
    setAmountInput('');
    setReasonInput('');
    setConfirmPermanentChecked(false);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleBackToList = () => {
    setSelectedLoanId(null);
    setAmountInput('');
    setReasonInput('');
    setConfirmPermanentChecked(false);
    setErrorMsg(null);
  };

  const handleQuickPercent = (pct: number) => {
    if (!selectedClient) return;
    const rawCents =
      pct === 100
        ? toCents(selectedClient.pendingLateFee)
        : Math.round((toCents(selectedClient.pendingLateFee) * pct) / 100);
    setDiscountMode('SPECIFIC_AMOUNT');
    setAmountInput(fromCents(rawCents).toFixed(2));
    setErrorMsg(null);
  };

  const handleSync = async () => {
    setSyncing(true);
    setErrorMsg(null);
    try {
      const res = await runDailyCollectionsSync({ saveSnapshot: false });
      setSuccessMsg(
        `Mora actualizada al corte (${res.syncedLoans} préstamos evaluados).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al sincronizar cartera.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmitDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !canApplyDiscounts) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (discountMode === 'PERMANENT_EXEMPT' && !confirmPermanentChecked) {
      setErrorMsg(
        'Confirma la casilla de verificación antes de eliminar la mora definitivamente.'
      );
      return;
    }

    if (discountMode === 'SPECIFIC_AMOUNT') {
      if (!Number.isFinite(parsedSpecificAmount) || parsedSpecificAmount <= 0) {
        setErrorMsg('Ingresa el monto específico de mora que deseas descontar.');
        return;
      }
      if (toCents(parsedSpecificAmount) > toCents(selectedClient.pendingLateFee)) {
        setErrorMsg(
          `El descuento no puede superar la mora pendiente (${formatMoney(
            selectedClient.pendingLateFee,
            selectedClient.currency
          )}).`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const plan = await applyLateFeeDiscount({
        loanId: selectedClient.loanId,
        mode: discountMode,
        amount: discountMode === 'SPECIFIC_AMOUNT' ? parsedSpecificAmount : undefined,
        reason: reasonInput.trim() || undefined,
      });

      const clientName = selectedClient.applicantDisplayName;
      const loanNumber = selectedClient.loanNumber;
      const currency = selectedClient.currency;

      if (plan.mode === 'PERMANENT_EXEMPT') {
        setSuccessMsg(
          `Mora eliminada definitivamente para ${clientName} (${loanNumber}). Se exoneraron ${formatMoney(
            plan.discountAmount,
            currency
          )} y este préstamo no volverá a generar mora.`
        );
        setSelectedLoanId(null);
      } else if (plan.mode === 'CLEAR_CURRENT_KEEP_NORMAL') {
        setSuccessMsg(
          `Mora actual eliminada para ${clientName} (${loanNumber}) por ${formatMoney(
            plan.discountAmount,
            currency
          )}. Mora pendiente actual: ${formatMoney(
            0,
            currency
          )}. Si el cliente vuelve a atrasarse, el préstamo generará mora normalmente.`
        );
        setSelectedLoanId(null);
      } else if (toCents(plan.nextLateFee) <= 0) {
        setSuccessMsg(
          `Descuento total de ${formatMoney(
            plan.discountAmount,
            currency
          )} aplicado a ${clientName} (${loanNumber}). Mora pendiente actual: ${formatMoney(
            0,
            currency
          )}.`
        );
        setSelectedLoanId(null);
      } else {
        setSuccessMsg(
          `Descuento de ${formatMoney(
            plan.discountAmount,
            currency
          )} aplicado a ${clientName} (${loanNumber}). Nueva mora pendiente: ${formatMoney(
            plan.nextLateFee,
            currency
          )}.`
        );
        setAmountInput('');
        setReasonInput('');
      }
      setConfirmPermanentChecked(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo aplicar el descuento de mora.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // --- DETAIL VIEW WHEN A CLIENT WITH MORA IS SELECTED ---
  if (selectedClient) {
    const previewPlan = previewResult.plan;
    const previewByInstId = new Map(
      (previewPlan?.installmentUpdates ?? []).map((u) => [u.installmentId, u])
    );

    return (
      <div className="space-y-6">
        {/* Top Back Navigation & Client Identity */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleBackToList}
            className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-xl axy-surface hover:border-[#00B8FF]/50 text-sm font-medium text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a clientes con mora
          </button>

          <button
            type="button"
            onClick={() => setSelectedCollectionLoanId(selectedClient.loanId)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-xl axy-surface-tonal hover:border-[#00B8FF]/40 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] transition cursor-pointer"
          >
            <Eye className="w-4 h-4" />
            Ver Ficha 360°
          </button>
        </div>

        {/* Client & Loan Mora Summary Header */}
        <div className="axy-surface p-5 sm:p-6 rounded-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-slate-800">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {selectedClient.loanNumber} ·{' '}
                {PRODUCT_LABELS[selectedClient.loan.productCode] ?? selectedClient.loan.productCode}
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                {selectedClient.applicantDisplayName}
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                <span>
                  Atraso: <strong className="text-slate-800 dark:text-slate-200 tabular-nums">{selectedClient.dpd} días</strong>
                </span>
                <span>
                  Cuotas con mora:{' '}
                  <strong className="text-slate-800 dark:text-slate-200 tabular-nums">
                    {selectedClient.overdueInstallmentsCount}
                  </strong>
                </span>
                {selectedClient.waivedLateFeeTotal > 0 && (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Descuentos previos:{' '}
                    <strong className="tabular-nums">
                      {formatMoney(selectedClient.waivedLateFeeTotal, selectedClient.currency)}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            <div className="sm:text-right shrink-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Mora pendiente actual
              </div>
              <div className="font-mono tabular-nums text-2xl sm:text-3xl font-bold text-rose-600 dark:text-rose-400 mt-0.5">
                {formatMoney(selectedClient.pendingLateFee, selectedClient.currency)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                Total vencido: {formatMoney(selectedClient.overdueTotalAmount, selectedClient.currency)}
              </div>
            </div>
          </div>

          {!canApplyDiscounts && (
            <div className="mt-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Tu perfil ({rbac.roleLabel}) tiene acceso de solo consulta. Para aplicar descuentos o
                quitar mora definitivamente se requiere perfil de Supervisor, Coordinador de Cobranza,
                Finanzas, Operaciones, Gerencia o Administrador.
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action Selector: Specific Amount vs Permanent Removal */}
          <form onSubmit={handleSubmitDiscount} className="mt-5 space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                Selecciona el tipo de acción sobre la mora
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountMode('SPECIFIC_AMOUNT');
                    setErrorMsg(null);
                    setConfirmPermanentChecked(false);
                  }}
                  className={`p-4 rounded-xl border text-left transition cursor-pointer min-h-[96px] ${
                    discountMode === 'SPECIFIC_AMOUNT'
                      ? 'border-[#0066FF] bg-[#0066FF]/5 dark:bg-[#00B8FF]/10 dark:border-[#00B8FF]'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        discountMode === 'SPECIFIC_AMOUNT'
                          ? 'bg-[#0066FF] text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Quitar monto específico
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Descuenta una cantidad exacta de la mora acumulada manteniendo el cálculo
                        normal.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDiscountMode('CLEAR_CURRENT_KEEP_NORMAL');
                    setErrorMsg(null);
                    setConfirmPermanentChecked(false);
                  }}
                  className={`p-4 rounded-xl border text-left transition cursor-pointer min-h-[96px] ${
                    discountMode === 'CLEAR_CURRENT_KEEP_NORMAL'
                      ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/25 dark:border-amber-400'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        discountMode === 'CLEAR_CURRENT_KEEP_NORMAL'
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Eliminar Mora actual
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Borra toda la mora generada hasta hoy; si vuelve a atrasarse, generará mora
                        como un préstamo normal.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDiscountMode('PERMANENT_EXEMPT');
                    setErrorMsg(null);
                  }}
                  className={`p-4 rounded-xl border text-left transition cursor-pointer min-h-[96px] ${
                    discountMode === 'PERMANENT_EXEMPT'
                      ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-500'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        discountMode === 'PERMANENT_EXEMPT'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <Ban className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Quitar Mora definitivamente
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Elimina el 100 % de la mora actual y exime permanentemente este préstamo de
                        mora futura.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Specific Amount Controls */}
            {discountMode === 'SPECIFIC_AMOUNT' && (
              <div className="p-4 sm:p-5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor="mora-discount-amount"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
                    >
                      Monto de mora a descontar ({selectedClient.currency})
                    </label>
                    <input
                      id="mora-discount-amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max={selectedClient.pendingLateFee}
                      disabled={!canApplyDiscounts || submitting}
                      value={amountInput}
                      onChange={(e) => {
                        setAmountInput(e.target.value);
                        setErrorMsg(null);
                      }}
                      placeholder={`Máximo ${selectedClient.pendingLateFee.toFixed(2)}`}
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#050E24] border border-slate-300 dark:border-slate-700 text-base font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2 sm:w-auto">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        disabled={!canApplyDiscounts || submitting}
                        onClick={() => handleQuickPercent(pct)}
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-white dark:bg-[#050E24] border border-slate-200 dark:border-slate-700 hover:border-[#0066FF] text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums transition cursor-pointer disabled:opacity-50"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {previewResult.validationError && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    {previewResult.validationError}
                  </p>
                )}

                {previewPlan && (
                  <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 text-xs">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Mora actual</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white mt-0.5">
                        {formatMoney(previewPlan.previousLateFee, selectedClient.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Descuento</div>
                      <div className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                        −{formatMoney(previewPlan.discountAmount, selectedClient.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500 dark:text-slate-400">Nueva mora</div>
                      <div className="font-mono tabular-nums font-bold text-[#0066FF] dark:text-[#00D1FF] mt-0.5">
                        {formatMoney(previewPlan.nextLateFee, selectedClient.currency)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Clear Current Mora (Keep Normal Future Accrual) */}
            {discountMode === 'CLEAR_CURRENT_KEEP_NORMAL' && (
              <div className="p-4 sm:p-5 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 space-y-4">
                <div className="flex items-start gap-3">
                  <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-950 dark:text-amber-200 space-y-1">
                    <div className="font-semibold text-sm">
                      Eliminación de mora actual generada en {selectedClient.loanNumber}
                    </div>
                    <p>
                      Se eliminará el 100 % de la mora pendiente hasta hoy (
                      <strong className="font-mono tabular-nums">
                        {formatMoney(selectedClient.pendingLateFee, selectedClient.currency)}
                      </strong>
                      ), dejándola en{' '}
                      <strong className="font-mono tabular-nums">
                        {formatMoney(0, selectedClient.currency)}
                      </strong>
                      . El préstamo <strong>no quedará exento</strong>: si continúa atrasado o vuelve a
                      atrasarse en cuotas futuras, generará mora nuevamente bajo la política normal.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-amber-200/80 dark:border-amber-900/50 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Mora actual</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white mt-0.5">
                      {formatMoney(selectedClient.pendingLateFee, selectedClient.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Mora eliminada</div>
                    <div className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">
                      −{formatMoney(selectedClient.pendingLateFee, selectedClient.currency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Nueva mora hoy</div>
                    <div className="font-mono tabular-nums font-bold text-[#0066FF] dark:text-[#00D1FF] mt-0.5">
                      {formatMoney(0, selectedClient.currency)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Permanent Removal Controls */}
            {discountMode === 'PERMANENT_EXEMPT' && (
              <div className="p-4 sm:p-5 rounded-xl bg-rose-50/70 dark:bg-rose-950/25 border border-rose-200 dark:border-rose-800/60 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-900 dark:text-rose-200 space-y-1">
                    <div className="font-semibold text-sm">
                      Exención definitiva de mora en {selectedClient.loanNumber}
                    </div>
                    <p>
                      Se eliminarán{' '}
                      <strong className="font-mono tabular-nums">
                        {formatMoney(selectedClient.pendingLateFee, selectedClient.currency)}
                      </strong>{' '}
                      de mora pendiente actual y el préstamo quedará marcado como{' '}
                      <strong>Exento de Mora</strong> para que los cierres diarios futuros no vuelvan a
                      calcular ni cobrar mora.
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-3 p-3 rounded-xl bg-white/80 dark:bg-[#050E24]/80 border border-rose-200/80 dark:border-rose-900/60 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={confirmPermanentChecked}
                    disabled={!canApplyDiscounts || submitting}
                    onChange={(e) => {
                      setConfirmPermanentChecked(e.target.checked);
                      setErrorMsg(null);
                    }}
                    className="mt-0.5 w-4 h-4 accent-rose-600"
                  />
                  <span className="text-xs text-slate-800 dark:text-slate-200 font-medium">
                    Confirmo que deseo quitar toda la mora actual y desactivar definitivamente el cobro
                    de mora futura para este préstamo.
                  </span>
                </label>
              </div>
            )}

            {/* Optional Justification / Audit Note */}
            <div>
              <label
                htmlFor="mora-discount-reason"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5"
              >
                Motivo o nota de auditoría (opcional)
              </label>
              <input
                id="mora-discount-reason"
                type="text"
                maxLength={500}
                disabled={!canApplyDiscounts || submitting}
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="Ej. Acuerdo de pago inmediato autorizado por gerencia"
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#050E24] border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
              />
            </div>

            {/* Submit Actions */}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleBackToList}
                disabled={submitting}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  !canApplyDiscounts ||
                  submitting ||
                  (discountMode === 'SPECIFIC_AMOUNT' &&
                    (!previewPlan || Boolean(previewResult.validationError))) ||
                  (discountMode === 'PERMANENT_EXEMPT' && !confirmPermanentChecked)
                }
                className={`min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  discountMode === 'PERMANENT_EXEMPT'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : discountMode === 'CLEAR_CURRENT_KEEP_NORMAL'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-[#0066FF] hover:bg-[#0052CC]'
                }`}
              >
                {submitting
                  ? 'Aplicando...'
                  : discountMode === 'PERMANENT_EXEMPT'
                  ? 'Quitar Mora Definitivamente'
                  : discountMode === 'CLEAR_CURRENT_KEEP_NORMAL'
                  ? 'Eliminar Mora Actual'
                  : 'Aplicar Descuento de Mora'}
              </button>
            </div>
          </form>
        </div>

        {/* Overdue Installments Mora Breakdown */}
        {selectedClient.installmentsWithLateFee.length > 0 && (
          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Desglose de mora por cuota vencida
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Los descuentos específicos se aplican automáticamente desde la cuota vencida más antigua.
              </p>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-left">
                    <th className="py-2.5 px-4 font-semibold">Cuota</th>
                    <th className="py-2.5 px-4 font-semibold">Vencimiento</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Días atraso</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Mora acumulada</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Ya descontada</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Mora pendiente</th>
                    {previewPlan && (
                      <th className="py-2.5 px-4 font-semibold text-right">Quedará en</th>
                    )}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums divide-y divide-slate-100 dark:divide-slate-800/70">
                  {selectedClient.installmentsWithLateFee.map((row) => {
                    const upd = previewByInstId.get(row.installment.id);
                    return (
                      <tr key={row.installment.id}>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                          #{row.installmentNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                          {row.dueDate}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-700 dark:text-slate-300">
                          {row.daysOverdue} d
                        </td>
                        <td className="py-3 px-4 text-right text-slate-700 dark:text-slate-300">
                          {formatMoney(row.grossAccruedLateFee, selectedClient.currency)}
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-700 dark:text-emerald-400">
                          {formatMoney(row.waivedLateFee, selectedClient.currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-rose-600 dark:text-rose-400">
                          {formatMoney(row.pendingLateFee, selectedClient.currency)}
                        </td>
                        {previewPlan && (
                          <td className="py-3 px-4 text-right font-bold text-[#0066FF] dark:text-[#00D1FF]">
                            {formatMoney(
                              upd ? upd.remainingLateFeeAfter : row.pendingLateFee,
                              selectedClient.currency
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/70">
              {selectedClient.installmentsWithLateFee.map((row) => {
                const upd = previewByInstId.get(row.installment.id);
                return (
                  <div key={row.installment.id} className="p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        Cuota #{row.installmentNumber}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        Vence {row.dueDate} · {row.daysOverdue} días atraso
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-sm font-bold text-rose-600 dark:text-rose-400">
                        {formatMoney(row.pendingLateFee, selectedClient.currency)}
                      </div>
                      {previewPlan && (
                        <div className="text-[11px] font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                          →{' '}
                          {formatMoney(
                            upd ? upd.remainingLateFeeAfter : row.pendingLateFee,
                            selectedClient.currency
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- MAIN LIST VIEW: STRICTLY CLIENTS WITH PENDING MORA > 0 ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Percent className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            Descuentos de Mora
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Clientes que actualmente tienen mora pendiente. Selecciona un cliente para descontar un
            monto específico o quitar la mora definitivamente.
          </p>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={handleSync}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 axy-btn-primary text-xs cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Actualizando...' : 'Actualizar Mora'}
        </button>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-start justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-700 dark:text-emerald-300 font-semibold hover:underline cursor-pointer shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Compact KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="axy-surface p-4 rounded-2xl">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Clientes con mora activa
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {loansWithMora.length}
          </div>
        </div>

        <div className="axy-surface p-4 rounded-2xl">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mora pendiente en DOP
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
            {formatMoney(totalsByCurrency.dopTotal, 'DOP')}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {totalsByCurrency.dopCount} {totalsByCurrency.dopCount === 1 ? 'préstamo' : 'préstamos'}
          </div>
        </div>

        <div className="axy-surface p-4 rounded-2xl">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mora pendiente en USD
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
            {formatMoney(totalsByCurrency.usdTotal, 'USD')}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {totalsByCurrency.usdCount} {totalsByCurrency.usdCount === 1 ? 'préstamo' : 'préstamos'}
          </div>
        </div>
      </div>

      {/* Search & Currency Filter Bar */}
      <div className="axy-surface p-3.5 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, número de préstamo o teléfono..."
            className="w-full min-h-[42px] pl-10 pr-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(['ALL', 'DOP', 'USD'] as const).map((curr) => (
            <button
              key={curr}
              type="button"
              onClick={() => setCurrencyFilter(curr)}
              className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                currencyFilter === curr
                  ? 'bg-[#0066FF] text-white'
                  : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {curr === 'ALL' ? 'Todas' : curr}
            </button>
          ))}
        </div>
      </div>

      {/* Clients with Mora List */}
      {filteredLoans.length === 0 ? (
        <div className="axy-surface p-10 rounded-2xl text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {loansWithMora.length === 0
              ? 'No hay clientes con mora pendiente'
              : 'Sin resultados para tu búsqueda'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {loansWithMora.length === 0
              ? 'Todos los préstamos activos se encuentran sin mora pendiente o exentos de mora al corte actual.'
              : 'Prueba buscando con otro nombre, número de préstamo o cambiando el filtro de moneda.'}
          </p>
        </div>
      ) : (
        <div className="axy-surface rounded-2xl overflow-hidden">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 text-left">
                  <th className="py-3 px-4 font-semibold">Cliente / Préstamo</th>
                  <th className="py-3 px-4 font-semibold text-right">Días de atraso</th>
                  <th className="py-3 px-4 font-semibold text-right">Cuotas con mora</th>
                  <th className="py-3 px-4 font-semibold text-right">Total vencido</th>
                  <th className="py-3 px-4 font-semibold text-right">Mora pendiente</th>
                  <th className="py-3 px-4 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {filteredLoans.map((item) => (
                  <tr
                    key={item.loanId}
                    onClick={() => handleSelectClient(item)}
                    className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition cursor-pointer"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {item.applicantDisplayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {item.loanNumber} · {item.currency}
                        {item.waivedLateFeeTotal > 0 && (
                          <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                            · Desc. previo {formatMoney(item.waivedLateFeeTotal, item.currency)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {item.dpd} días
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                      {item.overdueInstallmentsCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                      {formatMoney(item.overdueTotalAmount, item.currency)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                      {formatMoney(item.pendingLateFee, item.currency)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                        Descontar
                        <ChevronRight className="w-4 h-4" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/70">
            {filteredLoans.map((item) => (
              <button
                key={item.loanId}
                type="button"
                onClick={() => handleSelectClient(item)}
                className="w-full p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                    {item.applicantDisplayName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {item.loanNumber} · {item.dpd} días atraso · {item.overdueInstallmentsCount}{' '}
                    {item.overdueInstallmentsCount === 1 ? 'cuota' : 'cuotas'}
                  </div>
                  {item.waivedLateFeeTotal > 0 && (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
                      Desc. previo: {formatMoney(item.waivedLateFeeTotal, item.currency)}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Mora
                    </div>
                    <div className="font-mono tabular-nums text-sm font-bold text-rose-600 dark:text-rose-400">
                      {formatMoney(item.pendingLateFee, item.currency)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
