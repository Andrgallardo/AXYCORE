import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Download,
  PlusCircle,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { INVESTOR_TX_LABELS } from '../../engine/accountingEngine';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  createInvestorWithInitialCapital,
  recordInvestorCapitalMovement,
  toggleInvestorStatus,
} from '../../services/operationsStore';
import type {
  CurrencyCode,
  ExpensePaymentMethod,
  InvestorRecord,
  InvestorStatus,
  InvestorTransactionType,
  InvestorType,
} from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = {
  PERSONA_FISICA: 'Persona Física',
  PERSONA_JURIDICA: 'Persona Jurídica / Empresa',
};

const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  TRANSFERENCIA: 'Transferencia Bancaria',
  CHEQUE: 'Cheque',
  EFECTIVO: 'Efectivo / Caja',
  TARJETA: 'Tarjeta Corporativa',
};

export function RegisterInvestorsView() {
  const { userProfile, organization, investors, investorTransactions } = useAxyCore();
  const todayIso = getSantoDomingoTodayIso();

  const canManage = ['ADMIN', 'FINANCE', 'OPERATIONS', 'MANAGEMENT'].includes(
    userProfile?.role || ''
  );

  // Registration state
  const [fullName, setFullName] = useState('');
  const [investorType, setInvestorType] = useState<InvestorType>('PERSONA_FISICA');
  const [documentNumber, setDocumentNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(organization.currency || 'DOP');
  const [annualReturnRatePct, setAnnualReturnRatePct] = useState('14');
  const [joinDate, setJoinDate] = useState(todayIso);
  const [initialCapitalAmount, setInitialCapitalAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('TRANSFERENCIA');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [busyCreate, setBusyCreate] = useState(false);

  // Movement form state
  const [selectedInvestorId, setSelectedInvestorId] = useState<string>('');
  const [txType, setTxType] = useState<InvestorTransactionType>('APORTE_CAPITAL');
  const [txDate, setTxDate] = useState(todayIso);
  const [txAmount, setTxAmount] = useState('');
  const [txPaymentMethod, setTxPaymentMethod] = useState<ExpensePaymentMethod>('TRANSFERENCIA');
  const [txReference, setTxReference] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [busyMovement, setBusyMovement] = useState(false);

  const [busyStatusId, setBusyStatusId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | InvestorStatus>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | CurrencyCode>('ALL');
  const [txTypeFilter, setTxTypeFilter] = useState<'ALL' | InvestorTransactionType>('ALL');

  const selectedInvestor = useMemo(
    () => investors.find((inv) => inv.id === selectedInvestorId) ?? null,
    [investors, selectedInvestorId]
  );

  const kpis = useMemo(() => {
    const activeCount = investors.filter((i) => i.status === 'ACTIVO').length;
    const capitalDop = investors
      .filter((i) => i.currency === 'DOP')
      .reduce((s, i) => s + i.currentInvestedBalance, 0);
    const capitalUsd = investors
      .filter((i) => i.currency === 'USD')
      .reduce((s, i) => s + i.currentInvestedBalance, 0);
    const returnsDop = investors
      .filter((i) => i.currency === 'DOP')
      .reduce((s, i) => s + i.totalReturnsPaid, 0);
    const returnsUsd = investors
      .filter((i) => i.currency === 'USD')
      .reduce((s, i) => s + i.totalReturnsPaid, 0);

    return { activeCount, capitalDop, capitalUsd, returnsDop, returnsUsd };
  }, [investors]);

  const filteredInvestors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return investors.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (currencyFilter !== 'ALL' && inv.currency !== currencyFilter) return false;
      if (!q) return true;
      return (
        inv.fullName.toLowerCase().includes(q) ||
        inv.investorCode.toLowerCase().includes(q) ||
        inv.documentNumber.toLowerCase().includes(q) ||
        (inv.email || '').toLowerCase().includes(q)
      );
    });
  }, [investors, searchQuery, statusFilter, currencyFilter]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return investorTransactions.filter((tx) => {
      if (txTypeFilter !== 'ALL' && tx.transactionType !== txTypeFilter) return false;
      if (currencyFilter !== 'ALL' && tx.currency !== currencyFilter) return false;
      if (selectedInvestorId && tx.investorId !== selectedInvestorId) return false;
      if (!q) return true;
      return (
        tx.investorName.toLowerCase().includes(q) ||
        (tx.referenceNumber || '').toLowerCase().includes(q) ||
        (tx.notes || '').toLowerCase().includes(q)
      );
    });
  }, [investorTransactions, txTypeFilter, currencyFilter, selectedInvestorId, searchQuery]);

  const handleCreateInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !canManage) return;
    setFeedback(null);

    const parsedRate = Number(annualReturnRatePct);
    const parsedInitial = initialCapitalAmount.trim() === '' ? 0 : Number(initialCapitalAmount);
    if (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 200) {
      setFeedback({ type: 'err', msg: 'Ingresa una tasa de rendimiento anual válida (0 - 200%).' });
      return;
    }
    if (!Number.isFinite(parsedInitial) || parsedInitial < 0) {
      setFeedback({ type: 'err', msg: 'El capital inicial no puede ser negativo.' });
      return;
    }

    setBusyCreate(true);
    try {
      const res = await createInvestorWithInitialCapital({
        organizationId: organization.id,
        fullName,
        investorType,
        documentNumber,
        phone,
        email,
        currency,
        annualReturnRatePct: parsedRate,
        joinDate,
        initialCapitalAmount: parsedInitial,
        paymentMethod,
        referenceNumber,
        notes,
        user: userProfile,
      });

      setSelectedInvestorId(res.investor.id);
      setFeedback({
        type: 'ok',
        msg: `Inversionista ${res.investor.investorCode} (${res.investor.fullName}) registrado con capital inicial de ${formatMoney(
          res.investor.currentInvestedBalance,
          res.investor.currency
        )}.`,
      });

      setFullName('');
      setDocumentNumber('');
      setPhone('');
      setEmail('');
      setInitialCapitalAmount('');
      setReferenceNumber('');
      setNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo registrar el inversionista.',
      });
    } finally {
      setBusyCreate(false);
    }
  };

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !canManage || !selectedInvestor) return;
    setFeedback(null);

    const parsedAmount = Number(txAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFeedback({ type: 'err', msg: 'El monto del movimiento debe ser mayor que cero.' });
      return;
    }

    setBusyMovement(true);
    try {
      const tx = await recordInvestorCapitalMovement({
        investor: selectedInvestor,
        transactionType: txType,
        transactionDate: txDate,
        amount: parsedAmount,
        paymentMethod: txPaymentMethod,
        referenceNumber: txReference,
        notes: txNotes,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `${INVESTOR_TX_LABELS[tx.transactionType]} registrado para ${
          selectedInvestor.fullName
        } por ${formatMoney(tx.amount, tx.currency)}.`,
      });
      setTxAmount('');
      setTxReference('');
      setTxNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo registrar el movimiento.',
      });
    } finally {
      setBusyMovement(false);
    }
  };

  const handleToggleStatus = async (inv: InvestorRecord) => {
    if (!userProfile || !canManage) return;
    setFeedback(null);
    setBusyStatusId(inv.id);
    const nextStatus: InvestorStatus = inv.status === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    try {
      await toggleInvestorStatus({ investor: inv, nextStatus, user: userProfile });
      setFeedback({
        type: 'ok',
        msg: `Inversionista ${inv.investorCode} actualizado a ${nextStatus}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error al cambiar el estado.',
      });
    } finally {
      setBusyStatusId(null);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Código',
      'Nombre / Razón Social',
      'Tipo',
      'Documento',
      'Teléfono',
      'Email',
      'Moneda',
      'Tasa Anual %',
      'Capital Actual',
      'Total Aportado',
      'Total Retirado',
      'Rendimientos Pagados',
      'Estado',
    ];
    const rows = filteredInvestors.map((i) => [
      i.investorCode,
      i.fullName,
      INVESTOR_TYPE_LABELS[i.investorType],
      i.documentNumber,
      i.phone,
      i.email || '',
      i.currency,
      i.annualReturnRatePct.toFixed(2),
      i.currentInvestedBalance.toFixed(2),
      i.totalContributed.toFixed(2),
      i.totalWithdrawn.toFixed(2),
      i.totalReturnsPaid.toFixed(2),
      i.status,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AxyCore_Inversionistas_${todayIso}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#0066FF] dark:text-[#00D1FF]">
            Operaciones Generales · Fondeo y Capital de Terceros
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white mt-0.5">
            Registrar Inversionistas
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Administra socios fondeadores, aportes de capital, retiros y pago de rendimientos con
            impacto automático en Balance y Flujo de Financiamiento.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredInvestors.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 self-start cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
          Exportar CSV ({filteredInvestors.length})
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Inversionistas Activos
          </p>
          <p className="font-display text-2xl font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {kpis.activeCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Total registrados: {investors.length}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Capital Invertido (DOP)
          </p>
          <p className="font-display text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.capitalDop, 'DOP')}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
            Pasivo financiero vigente
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Capital Invertido (USD)
          </p>
          <p className="font-display text-xl font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.capitalUsd, 'USD')}
          </p>
          <p className="text-[11px] text-[#0066FF] dark:text-[#00D1FF] mt-1">
            Fondeo en moneda extranjera
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Rendimientos Pagados
          </p>
          <p className="font-display text-lg font-bold text-slate-950 dark:text-white tabular-nums mt-1">
            {formatMoney(kpis.returnsDop, 'DOP')}
          </p>
          <p className="text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] tabular-nums mt-0.5">
            {formatMoney(kpis.returnsUsd, 'USD')}
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

      {/* Forms Grid: Register Investor + Capital Movement */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* New Investor Form */}
        <div className="xl:col-span-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-white/10 pb-3">
            <div className="w-8 h-8 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                Registrar Nuevo Inversionista
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Alta de fondeador con aporte de capital inicial opcional
              </p>
            </div>
          </div>

          {!canManage ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-400">
              Tu rol tiene acceso de solo lectura para consultar el registro de inversionistas.
            </div>
          ) : (
            <form onSubmit={handleCreateInvestor} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Nombre Completo / Razón Social *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={160}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nombre del inversionista o empresa"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Tipo de Inversionista *
                  </label>
                  <select
                    value={investorType}
                    onChange={(e) => setInvestorType(e.target.value as InvestorType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  >
                    {(Object.keys(INVESTOR_TYPE_LABELS) as InvestorType[]).map((t) => (
                      <option key={t} value={t}>
                        {INVESTOR_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Cédula o RNC *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    maxLength={40}
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="001-0000000-0"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Teléfono *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={7}
                    maxLength={40}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="809-555-0100"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Correo Electrónico
                  </label>
                  <input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Moneda *
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="DOP">DOP</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Rendimiento Anual %
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="200"
                    step="0.1"
                    value={annualReturnRatePct}
                    onChange={(e) => setAnnualReturnRatePct(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Fecha Ingreso *
                  </label>
                  <input
                    type="date"
                    required
                    value={joinDate}
                    onChange={(e) => setJoinDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Capital Inicial
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={initialCapitalAmount}
                    onChange={(e) => setInitialCapitalAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Método de Recepción
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
                    No. Referencia / Contrato
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="TRF-000123"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Acuerdos / Notas del Inversionista
                </label>
                <input
                  type="text"
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Liquidación mensual de intereses, cuenta bancaria de retorno, etc."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={busyCreate}
                className="w-full py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                {busyCreate ? 'Registrando Inversionista...' : 'Registrar Inversionista'}
              </button>
            </form>
          )}
        </div>

        {/* Capital Movements Form */}
        <div className="xl:col-span-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#00B8FF]/10 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-950 dark:text-white">
                  Movimientos de Capital y Rendimientos
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Aportes adicionales, retiros de capital o pago de intereses
                </p>
              </div>
            </div>
            {selectedInvestor && (
              <button
                type="button"
                onClick={() => setSelectedInvestorId('')}
                className="text-[11px] font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
              >
                Ver todos
              </button>
            )}
          </div>

          {!canManage ? (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-400">
              Tu perfil no tiene permisos para registrar aportes, retiros o pagos de rendimientos.
            </div>
          ) : (
            <form onSubmit={handleRecordMovement} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Seleccionar Inversionista *
                </label>
                <select
                  required
                  value={selectedInvestorId}
                  onChange={(e) => setSelectedInvestorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                >
                  <option value="">-- Elige un inversionista --</option>
                  {investors.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.investorCode} · {inv.fullName} ({inv.currency}{' '}
                      {inv.currentInvestedBalance.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })}
                      )
                    </option>
                  ))}
                </select>
              </div>

              {selectedInvestor && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E]/80 border border-slate-200/80 dark:border-[#00B8FF]/20 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Capital Vigente</span>
                    <span className="font-mono font-bold text-slate-950 dark:text-white">
                      {formatMoney(selectedInvestor.currentInvestedBalance, selectedInvestor.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Tasa Anual</span>
                    <span className="font-mono font-bold text-[#0066FF] dark:text-[#00D1FF]">
                      {selectedInvestor.annualReturnRatePct}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Rend. Pagados</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatMoney(selectedInvestor.totalReturnsPaid, selectedInvestor.currency)}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Tipo de Operación *
                  </label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value as InvestorTransactionType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="APORTE_CAPITAL">Aporte de Capital (+)</option>
                    <option value="RETIRO_CAPITAL">Retiro de Capital (-)</option>
                    <option value="PAGO_RENDIMIENTO">Pago de Rendimiento</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Fecha Operación *
                  </label>
                  <input
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Monto {selectedInvestor ? `(${selectedInvestor.currency})` : ''} *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Método de Pago *
                  </label>
                  <select
                    value={txPaymentMethod}
                    onChange={(e) => setTxPaymentMethod(e.target.value as ExpensePaymentMethod)}
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
                    Referencia Bancaria
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={txReference}
                    onChange={(e) => setTxReference(e.target.value)}
                    placeholder="No. transferencia o comprobante"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Detalle / Concepto
                </label>
                <input
                  type="text"
                  maxLength={1000}
                  value={txNotes}
                  onChange={(e) => setTxNotes(e.target.value)}
                  placeholder="Ej. Liquidación rendimiento mensual o ampliación de línea"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={busyMovement || !selectedInvestor}
                className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-[#0066FF] hover:opacity-90 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {busyMovement ? 'Procesando Movimiento...' : 'Registrar Movimiento de Capital'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Investors Directory Table */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
            <h2 className="text-sm font-bold text-slate-950 dark:text-white">
              Cartera de Inversionistas ({filteredInvestors.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar código, nombre o documento..."
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white w-56"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | InvestorStatus)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
            >
              <option value="ALL">Todos los estados</option>
              <option value="ACTIVO">Activos</option>
              <option value="INACTIVO">Inactivos</option>
            </select>

            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value as 'ALL' | CurrencyCode)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
            >
              <option value="ALL">Todas las monedas</option>
              <option value="DOP">DOP</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-semibold">Código / Inversionista</th>
                <th className="px-4 py-3 font-semibold">Documento / Contacto</th>
                <th className="px-4 py-3 font-semibold text-right">Tasa Anual</th>
                <th className="px-4 py-3 font-semibold text-right">Capital Vigente</th>
                <th className="px-4 py-3 font-semibold text-right">Aportado / Retirado</th>
                <th className="px-4 py-3 font-semibold text-right">Rend. Pagados</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredInvestors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    No hay inversionistas registrados con los filtros actuales.
                  </td>
                </tr>
              ) : (
                filteredInvestors.map((inv) => {
                  const isSelected = selectedInvestorId === inv.id;
                  return (
                    <tr
                      key={inv.id}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-[#0066FF]/[0.06] dark:bg-[#00B8FF]/[0.08]'
                          : 'hover:bg-slate-50/70 dark:hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">
                          {inv.investorCode} · {inv.currency}
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {inv.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {INVESTOR_TYPE_LABELS[inv.investorType]} · Ingreso: {inv.joinDate}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-slate-800 dark:text-slate-200">
                          {inv.documentNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {inv.phone}
                          {inv.email ? ` · ${inv.email}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                        {inv.annualReturnRatePct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-950 dark:text-white tabular-nums">
                        {formatMoney(inv.currentInvestedBalance, inv.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] tabular-nums">
                        <div className="text-emerald-600 dark:text-emerald-400">
                          +{formatMoney(inv.totalContributed, inv.currency)}
                        </div>
                        <div className="text-rose-600 dark:text-rose-400">
                          -{formatMoney(inv.totalWithdrawn, inv.currency)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-[#0066FF] dark:text-[#00D1FF] tabular-nums">
                        {formatMoney(inv.totalReturnsPaid, inv.currency)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                            inv.status === 'ACTIVO'
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                              : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedInvestorId(isSelected ? '' : inv.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                              isSelected
                                ? 'bg-[#0066FF] text-white'
                                : 'border border-[#0066FF]/30 text-[#0066FF] dark:text-[#00D1FF] hover:bg-[#0066FF]/10'
                            }`}
                          >
                            {isSelected ? 'Seleccionado' : 'Operar'}
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              disabled={busyStatusId === inv.id}
                              onClick={() => handleToggleStatus(inv)}
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50 cursor-pointer"
                            >
                              {inv.status === 'ACTIVO' ? 'Desactivar' : 'Activar'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Capital Transactions Ledger */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950 dark:text-white">
              Bitácora de Movimientos de Inversionistas ({filteredTransactions.length})
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {selectedInvestor
                ? `Filtrado por: ${selectedInvestor.fullName}`
                : 'Historial completo de aportes, retiros y pagos de rendimiento'}
            </p>
          </div>
          <select
            value={txTypeFilter}
            onChange={(e) => setTxTypeFilter(e.target.value as 'ALL' | InvestorTransactionType)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white"
          >
            <option value="ALL">Todos los movimientos</option>
            <option value="APORTE_CAPITAL">Aportes de Capital</option>
            <option value="RETIRO_CAPITAL">Retiros de Capital</option>
            <option value="PAGO_RENDIMIENTO">Pagos de Rendimiento</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Inversionista</th>
                <th className="px-4 py-3 font-semibold">Movimiento</th>
                <th className="px-4 py-3 font-semibold">Referencia / Método</th>
                <th className="px-4 py-3 font-semibold text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No hay movimientos registrados todavía.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const isInflow = tx.transactionType === 'APORTE_CAPITAL';
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {tx.transactionDate}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        {tx.investorName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                            isInflow
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
                              : tx.transactionType === 'RETIRO_CAPITAL'
                              ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30'
                              : 'text-[#0052CC] dark:text-[#00D1FF] bg-[#0066FF]/10 border-[#0066FF]/25'
                          }`}
                        >
                          {isInflow ? (
                            <ArrowDownLeft className="w-3 h-3" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3" />
                          )}
                          {INVESTOR_TX_LABELS[tx.transactionType]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {tx.referenceNumber || '—'} · {PAYMENT_METHOD_LABELS[tx.paymentMethod]}
                        </div>
                        {tx.notes && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {tx.notes}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                          isInflow
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isInflow ? '+' : '-'}
                        {formatMoney(tx.amount, tx.currency)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
