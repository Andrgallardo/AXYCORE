import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Download,
  PlusCircle,
  Receipt,
  Search,
  Wallet,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { EXPENSE_CATEGORY_LABELS } from '../../engine/accountingEngine';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  createOperatingExpense,
  updateOperatingExpenseStatus,
} from '../../services/operationsStore';
import type {
  CurrencyCode,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseStatus,
  OperatingExpenseRecord,
} from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  EFECTIVO: 'Efectivo / Caja',
  TRANSFERENCIA: 'Transferencia Bancaria',
  TARJETA: 'Tarjeta Corporativa',
  CHEQUE: 'Cheque',
};

const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export function RegisterExpensesView() {
  const { userProfile, organization, operatingExpenses } = useAxyCore();
  const todayIso = getSantoDomingoTodayIso();
  const currentMonthKey = todayIso.slice(0, 7);

  const canManage = ['ADMIN', 'FINANCE', 'OPERATIONS', 'MANAGEMENT'].includes(
    userProfile?.role || ''
  );

  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [category, setCategory] = useState<ExpenseCategory>('SERVICIOS_BASICOS');
  const [concept, setConcept] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(organization.currency || 'DOP');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('TRANSFERENCIA');
  const [status, setStatus] = useState<'PAGADO' | 'PENDIENTE'>('PAGADO');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<'ALL' | ExpenseCategory>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | ExpenseStatus>('ALL');
  const [filterCurrency, setFilterCurrency] = useState<'ALL' | CurrencyCode>('ALL');
  const [filterMonth, setFilterMonth] = useState<string>('ALL');

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey);
    for (const exp of operatingExpenses) {
      if (exp.expenseDate && exp.expenseDate.length >= 7) {
        months.add(exp.expenseDate.slice(0, 7));
      }
    }
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [operatingExpenses, currentMonthKey]);

  const kpis = useMemo(() => {
    const active = operatingExpenses.filter((e) => e.status !== 'ANULADO');
    const monthDop = active
      .filter((e) => e.currency === 'DOP' && e.expenseDate.startsWith(currentMonthKey))
      .reduce((s, e) => s + e.amount, 0);
    const monthUsd = active
      .filter((e) => e.currency === 'USD' && e.expenseDate.startsWith(currentMonthKey))
      .reduce((s, e) => s + e.amount, 0);
    const totalDop = active
      .filter((e) => e.currency === 'DOP')
      .reduce((s, e) => s + e.amount, 0);
    const totalUsd = active
      .filter((e) => e.currency === 'USD')
      .reduce((s, e) => s + e.amount, 0);
    const pending = active.filter((e) => e.status === 'PENDIENTE');
    const pendingDop = pending
      .filter((e) => e.currency === 'DOP')
      .reduce((s, e) => s + e.amount, 0);
    const pendingUsd = pending
      .filter((e) => e.currency === 'USD')
      .reduce((s, e) => s + e.amount, 0);

    return {
      monthDop,
      monthUsd,
      totalDop,
      totalUsd,
      pendingCount: pending.length,
      pendingDop,
      pendingUsd,
    };
  }, [operatingExpenses, currentMonthKey]);

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return operatingExpenses.filter((exp) => {
      if (filterCategory !== 'ALL' && exp.category !== filterCategory) return false;
      if (filterStatus !== 'ALL' && exp.status !== filterStatus) return false;
      if (filterCurrency !== 'ALL' && exp.currency !== filterCurrency) return false;
      if (filterMonth !== 'ALL' && !exp.expenseDate.startsWith(filterMonth)) return false;
      if (!q) return true;
      return (
        exp.expenseNumber.toLowerCase().includes(q) ||
        exp.concept.toLowerCase().includes(q) ||
        exp.vendorName.toLowerCase().includes(q) ||
        (exp.invoiceNumber || '').toLowerCase().includes(q) ||
        EXPENSE_CATEGORY_LABELS[exp.category].toLowerCase().includes(q)
      );
    });
  }, [operatingExpenses, searchQuery, filterCategory, filterStatus, filterCurrency, filterMonth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !canManage) return;
    setFeedback(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFeedback({ type: 'err', msg: 'Ingresa un monto válido mayor que cero.' });
      return;
    }

    setBusy(true);
    try {
      const created = await createOperatingExpense({
        organizationId: organization.id,
        expenseDate,
        category,
        concept,
        vendorName,
        invoiceNumber,
        currency,
        amount: parsedAmount,
        paymentMethod,
        status,
        notes,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `Gasto ${created.expenseNumber} registrado correctamente (${formatMoney(
          created.amount,
          created.currency
        )}). Ya impacta en Estados Financieros.`,
      });
      setConcept('');
      setVendorName('');
      setInvoiceNumber('');
      setAmount('');
      setNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo registrar el gasto.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStatusUpdate = async (
    expense: OperatingExpenseRecord,
    nextStatus: ExpenseStatus
  ) => {
    if (!userProfile || !canManage) return;
    setFeedback(null);
    setActionBusyId(expense.id);
    try {
      await updateOperatingExpenseStatus({
        expense,
        nextStatus,
        user: userProfile,
      });
      setConfirmVoidId(null);
      setFeedback({
        type: 'ok',
        msg: `Gasto ${expense.expenseNumber} actualizado a ${nextStatus}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error al actualizar el estado del gasto.',
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Código',
      'Fecha',
      'Categoría',
      'Concepto',
      'Proveedor',
      'Comprobante/NCF',
      'Moneda',
      'Monto',
      'Método Pago',
      'Estado',
      'Registrado Por',
    ];
    const rows = filteredExpenses.map((e) => [
      e.expenseNumber,
      e.expenseDate,
      EXPENSE_CATEGORY_LABELS[e.category],
      e.concept,
      e.vendorName,
      e.invoiceNumber || '',
      e.currency,
      e.amount.toFixed(2),
      PAYMENT_METHOD_LABELS[e.paymentMethod],
      e.status,
      e.createdByName || '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AxyCore_Gastos_Operativos_${todayIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0066FF] dark:text-[#00D1FF]">
            Operaciones Generales · Egresos y Cuentas por Pagar
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white mt-0.5">
            Registrar Gastos Operativos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Controla nómina, alquiler, servicios, tecnología y costos operativos integrados al Estado
            de Resultados y Flujo de Efectivo.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredExpenses.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 self-start cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
          Exportar CSV ({filteredExpenses.length})
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Gastos del Mes (DOP)
          </p>
          <p className="font-display text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.monthDop, 'DOP')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Período {currentMonthKey}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Gastos del Mes (USD)
          </p>
          <p className="font-display text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.monthUsd, 'USD')}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Período {currentMonthKey}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Histórico Válido
          </p>
          <p className="font-display text-lg font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.totalDop, 'DOP')}
          </p>
          <p className="text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] tabular-nums mt-0.5">
            {formatMoney(kpis.totalUsd, 'USD')}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Cuentas por Pagar ({kpis.pendingCount})
          </p>
          <p className="font-display text-lg font-bold text-amber-600 dark:text-[#E2B35E] tabular-nums mt-1">
            {formatMoney(kpis.pendingDop, 'DOP')}
          </p>
          <p className="text-xs font-semibold text-amber-600/80 dark:text-[#E2B35E]/80 tabular-nums mt-0.5">
            {formatMoney(kpis.pendingUsd, 'USD')}
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Main Split: Registration Form + Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Form Card */}
        <div className="xl:col-span-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center">
                <PlusCircle className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                  Nuevo Gasto Operativo
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Impacto contable inmediato
                </p>
              </div>
            </div>
          </div>

          {!canManage ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-400">
              Tu perfil tiene acceso de solo lectura en el libro de gastos operativos.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Fecha del Gasto *
                  </label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Moneda *
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="DOP">DOP (Pesos)</option>
                    <option value="USD">USD (Dólares)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Categoría Contable *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {EXPENSE_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Concepto / Descripción *
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={200}
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="Ej. Alquiler oficina central o factura eléctrica"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Proveedor / Beneficiario *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={160}
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    placeholder="Nombre o razón social"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    NCF / No. Factura
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="B0100001234"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Monto ({currency}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Estado *
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'PAGADO' | 'PENDIENTE')}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="PAGADO">Pagado (Desembolsado)</option>
                    <option value="PENDIENTE">Pendiente (Por Pagar)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Método de Pago *
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                >
                  {(Object.keys(PAYMENT_METHOD_LABELS) as ExpensePaymentMethod[]).map((pm) => (
                    <option key={pm} value={pm}>
                      {PAYMENT_METHOD_LABELS[pm]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Notas / Centro de Costo
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observaciones adicionales..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                {busy ? 'Registrando Gasto...' : 'Registrar Gasto Operativo'}
              </button>
            </form>
          )}
        </div>

        {/* Expenses Ledger */}
        <div className="xl:col-span-8 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-white/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                  Libro de Gastos Operativos ({filteredExpenses.length})
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="relative lg:col-span-2">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar código, proveedor, concepto o NCF..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as 'ALL' | ExpenseCategory)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              >
                <option value="ALL">Todas las categorías</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'ALL' | ExpenseStatus)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
              >
                <option value="ALL">Todos los estados</option>
                <option value="PAGADO">Pagado</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="ANULADO">Anulado</option>
              </select>

              <div className="flex gap-2">
                <select
                  value={filterCurrency}
                  onChange={(e) => setFilterCurrency(e.target.value as 'ALL' | CurrencyCode)}
                  className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                >
                  <option value="ALL">Moneda</option>
                  <option value="DOP">DOP</option>
                  <option value="USD">USD</option>
                </select>
                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                >
                  <option value="ALL">Mes</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-white/10">
                <tr>
                  <th className="px-4 py-3 font-semibold">Código / Fecha</th>
                  <th className="px-4 py-3 font-semibold">Categoría / Concepto</th>
                  <th className="px-4 py-3 font-semibold">Proveedor / NCF</th>
                  <th className="px-4 py-3 font-semibold text-right">Monto</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  {canManage && <th className="px-4 py-3 font-semibold text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManage ? 6 : 5}
                      className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                    >
                      No hay gastos registrados que coincidan con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((exp) => {
                    const isBusyRow = actionBusyId === exp.id;
                    const statusStyle =
                      exp.status === 'PAGADO'
                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                        : exp.status === 'PENDIENTE'
                        ? 'text-amber-700 dark:text-[#E2B35E] bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                        : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 line-through';

                    return (
                      <tr
                        key={exp.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900 dark:text-white">
                            {exp.expenseNumber}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {exp.expenseDate} · {PAYMENT_METHOD_LABELS[exp.paymentMethod]}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                            {EXPENSE_CATEGORY_LABELS[exp.category]}
                          </div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {exp.concept}
                          </div>
                          {exp.notes && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                              {exp.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {exp.vendorName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {exp.invoiceNumber ? `NCF: ${exp.invoiceNumber}` : 'Sin comprobante'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-bold text-slate-950 dark:text-white tabular-nums">
                          {formatMoney(exp.amount, exp.currency)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${statusStyle}`}
                          >
                            {exp.status}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {exp.status === 'ANULADO' ? (
                              <span className="text-[11px] text-slate-400">Inmutable</span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                {exp.status === 'PENDIENTE' && (
                                  <button
                                    type="button"
                                    disabled={isBusyRow}
                                    onClick={() => handleStatusUpdate(exp, 'PAGADO')}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                                  >
                                    Marcar Pagado
                                  </button>
                                )}
                                {confirmVoidId === exp.id ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={isBusyRow}
                                      onClick={() => handleStatusUpdate(exp, 'ANULADO')}
                                      className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                                    >
                                      Confirmar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmVoidId(null)}
                                      className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isBusyRow}
                                    onClick={() => setConfirmVoidId(exp.id)}
                                    title="Anular gasto"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-[11px] font-semibold cursor-pointer"
                                  >
                                    <Ban className="w-3 h-3" />
                                    Anular
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
