import React, { useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  ArrowLeft,
  BadgePercent,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileDown,
  Receipt,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildPayoffQuoteMessage,
  computeLoanPayoffPlan,
  listAllClientsForPayoff,
  type ClientLoanPayoffItem,
  type LoanPayoffMode,
} from '../../engine/collections/loanPayoffEngine';
import { fromCents, getSantoDomingoTodayIso, toCents } from '../../engine/collections/delinquencyEngine';
import type { CurrencyCode, PaymentChannelMethod } from '../../types/axycore';
import { formatMoney, isClosedLoanStatus } from '../../utils/formatters';

const PAYOFF_SETTLE_ROLES = new Set([
  'ADMIN',
  'FINANCE',
  'OPERATIONS',
  'COLLECTION_COORDINATOR',
  'MANAGEMENT',
]);

const DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 50];

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentChannelMethod; label: string }> = [
  { value: 'TRANSFERENCIA', label: 'Transferencia Bancaria' },
  { value: 'CAJA_EFECTIVO', label: 'Efectivo en Caja' },
  { value: 'DEPOSITO', label: 'Depósito Bancario' },
  { value: 'TARJETA', label: 'Tarjeta de Débito / Crédito' },
  { value: 'CHEQUE', label: 'Cheque' },
];

export function CollectionsPayoffView() {
  const {
    userProfile,
    organization,
    customers,
    loans,
    loanInstallments,
    collectionAccounts,
    activeCollectionPolicy,
    applyLoanPayoff,
    setSelectedCollectionLoanId,
    rbac,
  } = useAxyCore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WITH_BALANCE' | 'NO_BALANCE'>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | CurrencyCode>('ALL');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Payoff configuration inside selected client
  const [actionChoice, setActionChoice] = useState<'FULL' | 'DISCOUNT'>('FULL');
  const [discountInputType, setDiscountInputType] = useState<'PERCENT' | 'CUSTOM_AMOUNT'>('PERCENT');
  const [discountPctInput, setDiscountPctInput] = useState('10');
  const [customPayoffInput, setCustomPayoffInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentChannelMethod>('TRANSFERENCIA');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [confirmSettle, setConfirmSettle] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [copiedQuote, setCopiedQuote] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const todayIso = getSantoDomingoTodayIso();
  const canSettlePayoff = Boolean(userProfile && PAYOFF_SETTLE_ROLES.has(userProfile.role));

  const allClients = useMemo<ClientLoanPayoffItem[]>(
    () =>
      listAllClientsForPayoff({
        customers,
        loans,
        collectionAccounts,
        installments: loanInstallments,
        policy: activeCollectionPolicy,
        asOfDateIso: todayIso,
      }),
    [customers, loans, collectionAccounts, loanInstallments, activeCollectionPolicy, todayIso]
  );

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allClients.filter((item) => {
      if (statusFilter === 'WITH_BALANCE' && toCents(item.totalOwed) <= 0) return false;
      if (statusFilter === 'NO_BALANCE' && toCents(item.totalOwed) > 0) return false;
      if (currencyFilter !== 'ALL' && item.currency !== currencyFilter) return false;
      if (q) {
        const hay = `${item.applicantDisplayName} ${item.loanNumber} ${item.documentNumber} ${item.customerPhone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allClients, statusFilter, currencyFilter, search]);

  const portfolioStats = useMemo(() => {
    let withBalanceCount = 0;
    let dopOwedCents = 0;
    let usdOwedCents = 0;
    for (const item of allClients) {
      const owedCents = toCents(item.totalOwed);
      if (owedCents > 0) {
        withBalanceCount += 1;
        if (item.currency === 'USD') usdOwedCents += owedCents;
        else dopOwedCents += owedCents;
      }
    }
    return {
      totalCount: allClients.length,
      withBalanceCount,
      dopOwed: fromCents(dopOwedCents),
      usdOwed: fromCents(usdOwedCents),
    };
  }, [allClients]);

  const selectedItem = useMemo(
    () => (selectedItemId ? allClients.find((c) => c.id === selectedItemId) ?? null : null),
    [allClients, selectedItemId]
  );

  const activeMode: LoanPayoffMode =
    actionChoice === 'FULL'
      ? 'FULL_PAYOFF'
      : discountInputType === 'PERCENT'
      ? 'DISCOUNT_PERCENT'
      : 'CUSTOM_AMOUNT';

  const payoffPreview = useMemo(() => {
    if (!selectedItem || !selectedItem.hasLoan || toCents(selectedItem.totalOwed) <= 0) {
      return { plan: null, error: null as string | null };
    }
    if (isClosedLoanStatus(selectedItem.status)) {
      return { plan: null, error: null as string | null };
    }
    try {
      const plan = computeLoanPayoffPlan({
        item: selectedItem,
        mode: activeMode,
        discountPercent: activeMode === 'DISCOUNT_PERCENT' ? Number(discountPctInput) : undefined,
        customPayoffAmount: activeMode === 'CUSTOM_AMOUNT' ? Number(customPayoffInput) : undefined,
        asOfDateIso: todayIso,
      });
      return { plan, error: null as string | null };
    } catch (err) {
      return {
        plan: null,
        error: err instanceof Error ? err.message : 'Verifica el monto o porcentaje ingresado.',
      };
    }
  }, [selectedItem, activeMode, discountPctInput, customPayoffInput, todayIso]);

  const handleOpenClient = (item: ClientLoanPayoffItem) => {
    setSelectedItemId(item.id);
    setActionChoice('FULL');
    setDiscountInputType('PERCENT');
    setDiscountPctInput('10');
    setCustomPayoffInput(item.totalOwed > 0 ? String(Number((item.totalOwed * 0.9).toFixed(2))) : '');
    setReferenceNumber('');
    setReasonInput('');
    setConfirmSettle(false);
    setErrorMsg(null);
    setSuccessMsg(null);
    setCopiedQuote(false);
  };

  const handleCopyQuote = async () => {
    if (!payoffPreview.plan) return;
    const text = buildPayoffQuoteMessage({
      plan: payoffPreview.plan,
      organizationName: organization.tradeName || organization.name || 'AxyCore',
      organizationPhone: organization.phone,
      formatCurrency: (val, curr) => formatMoney(val, curr),
      note: reasonInput,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedQuote(true);
      setTimeout(() => setCopiedQuote(false), 3000);
    } catch {
      setErrorMsg('No se pudo copiar al portapapeles en este navegador.');
    }
  };

  const handleDownloadPdf = () => {
    if (!payoffPreview.plan || !selectedItem) return;
    const plan = payoffPreview.plan;
    const orgName = organization.tradeName || organization.name || 'AxyCore';
    const orgRnc = (organization.taxId || organization.rnc || '').trim();
    const orgPhone = (organization.phone || '').trim();
    const orgIdentityLine = [
      orgRnc ? `RNC: ${orgRnc}` : '',
      orgPhone ? `Tel.: ${orgPhone}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    let y = 52;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text(orgName, 48, y);
    y += 16;
    if (orgIdentityLine) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.text(orgIdentityLine, 48, y);
      y += 14;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Estado y Cotización de Saldo de Préstamo · Corte: ${plan.asOfDateIso}`, 48, y);
    y += 14;
    pdf.line(48, y, 564, y);
    y += 22;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Datos del Cliente y Préstamo', 48, y);
    y += 16;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Cliente: ${plan.applicantDisplayName}`, 48, y);
    y += 15;
    if (selectedItem.documentNumber) {
      pdf.text(`Documento: ${selectedItem.documentNumber}`, 48, y);
      y += 15;
    }
    pdf.text(`Préstamo: ${plan.loanNumber} (${plan.currency})`, 48, y);
    y += 15;
    pdf.text(
      `Modalidad: ${
        plan.mode === 'FULL_PAYOFF'
          ? 'Saldo Total sin Descuento'
          : plan.mode === 'DISCOUNT_PERCENT'
          ? `Saldo con Descuento (${plan.discountPercent.toFixed(2)}%)`
          : `Saldo Personalizado (${plan.discountPercent.toFixed(2)}% de descuento)`
      }`,
      48,
      y
    );
    y += 24;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Desglose de Deuda Actual', 48, y);
    y += 16;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const rows: Array<[string, string]> = [
      ['Capital pendiente', formatMoney(plan.remainingPrincipal, plan.currency)],
      ['Interés pendiente', formatMoney(plan.remainingInterest, plan.currency)],
      ['Otros cargos', formatMoney(plan.remainingCharges, plan.currency)],
      ['Mora pendiente', formatMoney(plan.remainingLateFee, plan.currency)],
      ['Total adeudado', formatMoney(plan.totalOwed, plan.currency)],
    ];
    if (plan.discountAmount > 0) {
      rows.push([
        `Descuento aplicado (${plan.discountPercent.toFixed(2)}%)`,
        `-${formatMoney(plan.discountAmount, plan.currency)}`,
      ]);
    }
    for (const [label, value] of rows) {
      pdf.text(label, 48, y);
      pdf.text(value, 564, y, { align: 'right' });
      y += 16;
    }

    y += 6;
    pdf.line(48, y, 564, y);
    y += 20;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text('SALDO TOTAL A PAGAR', 48, y);
    pdf.text(formatMoney(plan.finalPayoffAmount, plan.currency), 564, y, { align: 'right' });
    y += 26;

    if (reasonInput.trim()) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.text(`Observación: ${reasonInput.trim().slice(0, 180)}`, 48, y);
    }

    pdf.save(`Saldo_${plan.loanNumber}_${plan.asOfDateIso}.pdf`);
  };

  const handleSettlePayoff = async () => {
    if (!selectedItem || !selectedItem.loanId || !payoffPreview.plan || !canSettlePayoff) return;
    if (!confirmSettle) {
      setErrorMsg('Marca la confirmación para aplicar el saldo y marcar el préstamo como pagado.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const settledPlan = await applyLoanPayoff({
        loanId: selectedItem.loanId,
        mode: activeMode,
        discountPercent: activeMode === 'DISCOUNT_PERCENT' ? Number(discountPctInput) : undefined,
        customPayoffAmount: activeMode === 'CUSTOM_AMOUNT' ? Number(customPayoffInput) : undefined,
        paymentMethod,
        referenceNumber: referenceNumber.trim() || undefined,
        reason: reasonInput.trim() || undefined,
      });

      setSuccessMsg(
        `Saldo aplicado correctamente (${formatMoney(
          settledPlan.finalPayoffAmount,
          settledPlan.currency
        )}). Préstamo ${settledPlan.loanNumber} marcado como PAGADO.`
      );
      setConfirmSettle(false);
      setReferenceNumber('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo aplicar el saldo del préstamo.');
    } finally {
      setSubmitting(false);
    }
  };

  // Detail View inside a selected client
  if (selectedItem) {
    const hasActiveBalance =
      selectedItem.hasLoan &&
      toCents(selectedItem.totalOwed) > 0 &&
      !isClosedLoanStatus(selectedItem.status);

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedItemId(null);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl axy-surface text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#0E1D40] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a lista de clientes
          </button>

          {selectedItem.loanId && (
            <button
              type="button"
              onClick={() => setSelectedCollectionLoanId(selectedItem.loanId!)}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl axy-surface text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:bg-[#0066FF]/10 transition-colors cursor-pointer"
            >
              Ver ficha completa de cobranza
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Client Header & Live Debt Breakdown */}
        <div className="axy-surface rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Descuentos › Saldos · Corte {todayIso}
              </p>
              <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white">
                {selectedItem.applicantDisplayName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {selectedItem.loanNumber}
                {selectedItem.documentNumber ? ` · Doc: ${selectedItem.documentNumber}` : ''}
                {selectedItem.customerPhone ? ` · Tel: ${selectedItem.customerPhone}` : ''}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                Total de lo que debe
              </p>
              <p className="font-mono text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {formatMoney(selectedItem.totalOwed, selectedItem.currency)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Estado: {selectedItem.status}
                {selectedItem.dpd > 0 ? ` · ${selectedItem.dpd} días de atraso` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-200/80 dark:border-white/10">
            <div className="axy-surface-tonal rounded-xl p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Capital pendiente</p>
              <p className="font-mono font-bold text-sm tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatMoney(selectedItem.remainingPrincipal, selectedItem.currency)}
              </p>
            </div>
            <div className="axy-surface-tonal rounded-xl p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Interés pendiente</p>
              <p className="font-mono font-bold text-sm tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatMoney(selectedItem.remainingInterest, selectedItem.currency)}
              </p>
            </div>
            <div className="axy-surface-tonal rounded-xl p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Otros cargos</p>
              <p className="font-mono font-bold text-sm tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatMoney(selectedItem.remainingCharges, selectedItem.currency)}
              </p>
            </div>
            <div className="axy-surface-tonal rounded-xl p-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Mora pendiente</p>
              <p className="font-mono font-bold text-sm tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
                {formatMoney(selectedItem.remainingLateFee, selectedItem.currency)}
              </p>
            </div>
          </div>
        </div>

        {successMsg && (
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {!hasActiveBalance ? (
          <div className="axy-surface rounded-2xl p-6 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {selectedItem.hasLoan
                ? 'Este préstamo ya está saldado o no tiene deuda pendiente.'
                : 'Este cliente no tiene un préstamo activo desembolsado.'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Selecciona otro cliente con saldo pendiente para calcular o aplicar un saldo total o con descuento.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column: Primary Payoff Buttons + Discount Controls */}
            <div className="lg:col-span-7 space-y-4">
              <div className="axy-surface rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                    Selecciona el tipo de saldo para el cliente
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Elige si deseas otorgar el saldo por el total exacto que debe o aplicar un descuento por porcentaje o monto personalizado.
                  </p>
                </div>

                {/* Two Main Required Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActionChoice('FULL');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[68px] p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                      actionChoice === 'FULL'
                        ? 'border-[#0066FF] bg-[#0066FF]/[0.08] dark:border-[#00B8FF] dark:bg-[#0066FF]/20 ring-1 ring-[#0066FF]/30'
                        : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <Receipt className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-950 dark:text-white">
                        Dar saldo al cliente
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Total exacto de lo que debe:{' '}
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {formatMoney(selectedItem.totalOwed, selectedItem.currency)}
                        </span>
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActionChoice('DISCOUNT');
                      setErrorMsg(null);
                    }}
                    className={`min-h-[68px] p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                      actionChoice === 'DISCOUNT'
                        ? 'border-[#0066FF] bg-[#0066FF]/[0.08] dark:border-[#00B8FF] dark:bg-[#0066FF]/20 ring-1 ring-[#0066FF]/30'
                        : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <BadgePercent className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-950 dark:text-white">
                        Dar saldo con descuento
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Por porcentaje de descuento o colocando el saldo directo a otorgar.
                      </p>
                    </div>
                  </button>
                </div>

                {/* Discount Options Panel */}
                {actionChoice === 'DISCOUNT' && (
                  <div className="axy-surface-tonal rounded-xl p-4 space-y-4 border border-slate-200/70 dark:border-white/10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountInputType('PERCENT');
                          setErrorMsg(null);
                        }}
                        className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                          discountInputType === 'PERCENT'
                            ? 'border-[#0066FF] bg-[#0066FF] text-white'
                            : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#07142E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <BadgePercent className="w-4 h-4" />
                        Porcentaje de descuento (%)
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDiscountInputType('CUSTOM_AMOUNT');
                          setErrorMsg(null);
                        }}
                        className={`min-h-[44px] px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                          discountInputType === 'CUSTOM_AMOUNT'
                            ? 'border-[#0066FF] bg-[#0066FF] text-white'
                            : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#07142E] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <Calculator className="w-4 h-4" />
                        Colocar saldo personalizado
                      </button>
                    </div>

                    {discountInputType === 'PERCENT' ? (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                            Porcentaje de descuento a aplicar (%)
                          </label>
                          <div className="flex flex-wrap gap-2 mb-2.5">
                            {DISCOUNT_PRESETS.map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setDiscountPctInput(String(pct))}
                                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                                  Number(discountPctInput) === pct
                                    ? 'border-[#0066FF] bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF]'
                                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#07142E] text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                          <input
                            type="number"
                            min="0.01"
                            max="99.99"
                            step="0.5"
                            value={discountPctInput}
                            onChange={(e) => setDiscountPctInput(e.target.value)}
                            placeholder="Ej. 15"
                            className="axy-input w-full px-3 py-2.5 min-h-[44px] font-mono text-sm text-slate-950 dark:text-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Monto exacto del saldo que deseas darle al cliente ({selectedItem.currency})
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={selectedItem.totalOwed}
                          step="0.01"
                          value={customPayoffInput}
                          onChange={(e) => setCustomPayoffInput(e.target.value)}
                          placeholder={`Máximo ${selectedItem.totalOwed.toFixed(2)}`}
                          className="axy-input w-full px-3 py-2.5 min-h-[44px] font-mono text-sm text-slate-950 dark:text-white"
                        />
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          El sistema calcula automáticamente el monto y porcentaje de descuento respecto al total adeudado ({formatMoney(selectedItem.totalOwed, selectedItem.currency)}).
                        </p>
                      </div>
                    )}

                    {payoffPreview.error && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                        {payoffPreview.error}
                      </p>
                    )}
                  </div>
                )}

                {/* Settlement Payment Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/70 dark:border-white/10">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Método de pago
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentChannelMethod)}
                      className="axy-input w-full px-3 py-2.5 min-h-[44px] text-xs text-slate-900 dark:text-white"
                    >
                      {PAYMENT_METHOD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Referencia / Comprobante (opcional)
                    </label>
                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      placeholder="Ej. TRF-884120"
                      className="axy-input w-full px-3 py-2.5 min-h-[44px] text-xs font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Motivo / Observación del saldo
                  </label>
                  <textarea
                    rows={2}
                    value={reasonInput}
                    onChange={(e) => setReasonInput(e.target.value)}
                    placeholder="Ej. Acuerdo de cancelación anticipada autorizado por gerencia."
                    className="axy-input w-full px-3 py-2 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Live Payoff Calculation Summary & Actions */}
            <div className="lg:col-span-5 space-y-4">
              <div className="axy-surface rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                    Resumen del Saldo
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {selectedItem.unpaidInstallmentsCount} cuota(s) pend.
                  </span>
                </div>

                {payoffPreview.plan ? (
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-white/10">
                      <span className="text-slate-500 dark:text-slate-400">Total adeudado</span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(payoffPreview.plan.totalOwed, payoffPreview.plan.currency)}
                      </span>
                    </div>

                    <div className="flex justify-between py-1.5 border-b border-slate-200/70 dark:border-white/10">
                      <span className="text-slate-500 dark:text-slate-400">
                        Descuento otorgado ({payoffPreview.plan.discountPercent.toFixed(2)}%)
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        -{formatMoney(payoffPreview.plan.discountAmount, payoffPreview.plan.currency)}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#0066FF]/[0.08] dark:bg-[#0066FF]/20 border border-[#0066FF]/25 flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-950 dark:text-white">
                        Saldo final a pagar
                      </span>
                      <span className="font-mono text-lg font-bold tabular-nums text-[#0052CC] dark:text-[#00D1FF]">
                        {formatMoney(payoffPreview.plan.finalPayoffAmount, payoffPreview.plan.currency)}
                      </span>
                    </div>

                    <div className="axy-surface-tonal rounded-xl p-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                      <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
                        Aplicación contable del saldo
                      </p>
                      <div className="flex justify-between font-mono tabular-nums">
                        <span>Capital cobrado:</span>
                        <span>{formatMoney(payoffPreview.plan.allocatedToPrincipal, payoffPreview.plan.currency)}</span>
                      </div>
                      <div className="flex justify-between font-mono tabular-nums">
                        <span>Interés cobrado:</span>
                        <span>{formatMoney(payoffPreview.plan.allocatedToInterest, payoffPreview.plan.currency)}</span>
                      </div>
                      <div className="flex justify-between font-mono tabular-nums">
                        <span>Mora cobrada / condonada:</span>
                        <span>
                          {formatMoney(payoffPreview.plan.allocatedToLateFee, payoffPreview.plan.currency)} /{' '}
                          {formatMoney(payoffPreview.plan.waivedLateFeeInSettlement, payoffPreview.plan.currency)}
                        </span>
                      </div>
                    </div>

                    {/* Quote Actions */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleCopyQuote}
                        className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#07142E] hover:bg-slate-50 dark:hover:bg-white/[0.06] text-slate-800 dark:text-slate-100 font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedQuote ? 'Copiado' : 'Copiar saldo'}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadPdf}
                        className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#07142E] hover:bg-slate-50 dark:hover:bg-white/[0.06] text-slate-800 dark:text-slate-100 font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        Carta PDF
                      </button>
                    </div>

                    {/* Settlement Execution */}
                    {canSettlePayoff ? (
                      <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-3">
                        <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={confirmSettle}
                            onChange={(e) => setConfirmSettle(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0066FF]"
                          />
                          <span>
                            Confirmo recibir el pago de{' '}
                            <strong className="font-mono">
                              {formatMoney(payoffPreview.plan.finalPayoffAmount, payoffPreview.plan.currency)}
                            </strong>{' '}
                            para saldar completamente el préstamo {payoffPreview.plan.loanNumber}.
                          </span>
                        </label>

                        <button
                          type="button"
                          disabled={submitting || !confirmSettle}
                          onClick={handleSettlePayoff}
                          className="axy-btn-primary w-full min-h-[44px] px-4 py-2.5 text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          {submitting
                            ? 'Aplicando saldo y cerrando préstamo...'
                            : 'Aplicar Saldo y Marcar Préstamo Pagado'}
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-[11px]">
                        Tu rol actual ({rbac.roleLabel}) puede cotizar y descargar la carta de saldo. Para aplicar la liquidación definitiva en cartera se requiere perfil de Administración, Finanzas, Operaciones o Coordinación de Cobros.
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ingresa un descuento o monto válido para visualizar el resumen del saldo.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Master List View: ALL Clients
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white">
            Descuentos · Saldos de Clientes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Lista completa de clientes para otorgar saldo total de lo adeudado o saldo con descuento por porcentaje o monto directo.
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="axy-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Total clientes
          </p>
          <p className="font-mono text-2xl font-bold tabular-nums text-slate-950 dark:text-white mt-1">
            {portfolioStats.totalCount}
          </p>
        </div>
        <div className="axy-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Con saldo pendiente
          </p>
          <p className="font-mono text-2xl font-bold tabular-nums text-[#0066FF] dark:text-[#00D1FF] mt-1">
            {portfolioStats.withBalanceCount}
          </p>
        </div>
        <div className="axy-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Saldo total cartera DOP
          </p>
          <p className="font-mono text-lg font-bold tabular-nums text-slate-950 dark:text-white mt-1 truncate">
            {formatMoney(portfolioStats.dopOwed, 'DOP')}
          </p>
        </div>
        <div className="axy-surface rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Saldo total cartera USD
          </p>
          <p className="font-mono text-lg font-bold tabular-nums text-slate-950 dark:text-white mt-1 truncate">
            {formatMoney(portfolioStats.usdOwed, 'USD')}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="axy-surface rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente por nombre, cédula, teléfono o préstamo..."
            className="axy-input w-full pl-9 pr-3 py-2.5 min-h-[44px] text-xs text-slate-950 dark:text-white"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SlidersHorizontal className="w-4 h-4 text-slate-400 hidden sm:block" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="axy-input px-3 py-2.5 min-h-[44px] text-xs text-slate-900 dark:text-white"
          >
            <option value="ALL">Todos los clientes</option>
            <option value="WITH_BALANCE">Con saldo pendiente</option>
            <option value="NO_BALANCE">Saldados / Sin préstamo</option>
          </select>
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value as typeof currencyFilter)}
            className="axy-input px-3 py-2.5 min-h-[44px] text-xs text-slate-900 dark:text-white"
          >
            <option value="ALL">Todas las monedas</option>
            <option value="DOP">DOP</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      {/* Client List: Desktop Table + Mobile Stacked Cards */}
      {filteredClients.length === 0 ? (
        <div className="axy-surface rounded-2xl p-8 text-center space-y-2">
          <Wallet className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            No se encontraron clientes con ese criterio
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ajusta el buscador o los filtros para ver toda la cartera de clientes.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="grid grid-cols-1 gap-3 lg:hidden">
            {filteredClients.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpenClient(item)}
                className="axy-surface rounded-2xl p-4 text-left space-y-3 hover:border-[#0066FF]/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-950 dark:text-white truncate">
                      {item.applicantDisplayName}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {item.loanNumber} {item.documentNumber ? `· ${item.documentNumber}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {item.status}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-white/10">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Total adeudado
                    </p>
                    <p className="font-mono font-bold text-sm tabular-nums text-slate-950 dark:text-white">
                      {formatMoney(item.totalOwed, item.currency)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                    Gestionar saldo
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden lg:block axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                    <th className="py-3 px-4 font-semibold">Cliente</th>
                    <th className="py-3 px-3 font-semibold">Préstamo</th>
                    <th className="py-3 px-3 font-semibold">Estado</th>
                    <th className="py-3 px-3 font-semibold text-right">Capital</th>
                    <th className="py-3 px-3 font-semibold text-right">Interés + Cargos</th>
                    <th className="py-3 px-3 font-semibold text-right">Mora</th>
                    <th className="py-3 px-3 font-semibold text-right">Total Adeudado</th>
                    <th className="py-3 px-4 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
                  {filteredClients.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleOpenClient(item)}
                      className="axy-table-row cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-950 dark:text-white">
                          {item.applicantDisplayName}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500">
                          {item.documentNumber || item.customerPhone || '—'}
                        </p>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {item.loanNumber}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {item.status}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatMoney(item.remainingPrincipal, item.currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatMoney(item.remainingInterest + item.remainingCharges, item.currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                        {formatMoney(item.remainingLateFee, item.currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold tabular-nums text-slate-950 dark:text-white">
                        {formatMoney(item.totalOwed, item.currency)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                          Dar saldo
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
