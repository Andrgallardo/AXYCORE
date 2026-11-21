import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, CalendarDays, Download, Landmark, Layers, Search, UserRoundCheck } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { fetchInstallmentsByLoan, runBackendAmortization } from '../services/axycoreStore';
import {
  formatMoney,
  formatRatePct,
  PRODUCT_LABELS,
  toIsoDateOnly,
} from '../utils/formatters';
import type { AmortizationScheduleResult } from '../engine/amortizationEngine';
import type {
  AmortizationMethod,
  CurrencyCode,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentFrequency,
} from '../types/axycore';

interface SimulatedScheduleRow {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  otherCharges: number;
  totalAmount: number;
  remainingPrincipalBalance: number;
}

type LoanStatusFilter = 'TODOS' | 'VIGENTES' | 'ACTIVO' | 'VENCIDO' | 'PAGADO' | 'CANCELADO';

function getLoanStatusBadgeClass(status: LoanRecord['status']): string {
  switch (status) {
    case 'ACTIVO':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'VENCIDO':
      return 'text-amber-700 dark:text-amber-400';
    case 'PAGADO':
      return 'text-[#0066FF] dark:text-[#00D1FF]';
    case 'CANCELADO':
      return 'text-rose-700 dark:text-rose-400';
    default:
      return 'text-slate-600 dark:text-slate-300';
  }
}

export function DisbursedLoansView() {
  const {
    loans,
    customers,
    loanInstallments,
    disbursements,
    documents,
    userProfile,
    setSelectedCollectionLoanId,
    rbac,
  } = useAxyCore();
  const isExternal = userProfile?.role === 'EXTERNAL_CLIENT';

  const [tab, setTab] = useState<'PORTFOLIO' | 'SIMULATOR'>('PORTFOLIO');
  const [statusFilter, setStatusFilter] = useState<LoanStatusFilter>('TODOS');
  const [search, setSearch] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<LoanRecord | null>(null);
  const [installments, setInstallments] = useState<LoanInstallmentRecord[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);

  // Interactive Amortization Simulator state
  const [simPrincipal, setSimPrincipal] = useState('200000');
  const [simCurrency, setSimCurrency] = useState<CurrencyCode>('DOP');
  const [simMonthlyRatePct, setSimMonthlyRatePct] = useState('4.50');
  const [simTermMonths, setSimTermMonths] = useState('12');
  const [simFrequency, setSimFrequency] = useState<PaymentFrequency>('MENSUAL');
  const [simMethod, setSimMethod] = useState<AmortizationMethod>('SALDO_INSOLUTO');
  const [simDisbDate, setSimDisbDate] = useState(toIsoDateOnly());
  const [simFirstDate, setSimFirstDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return toIsoDateOnly(d);
  });
  const [simOtherCharges, setSimOtherCharges] = useState('0');
  const [simResult, setSimResult] = useState<AmortizationScheduleResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const customerById = useMemo(() => {
    const map = new Map<string, (typeof customers)[number]>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  const statusCounts = useMemo(() => {
    let activos = 0;
    let vencidos = 0;
    let pagados = 0;
    let cancelados = 0;
    for (const l of loans) {
      if (l.status === 'ACTIVO') activos++;
      else if (l.status === 'VENCIDO') vencidos++;
      else if (l.status === 'PAGADO') pagados++;
      else if (l.status === 'CANCELADO') cancelados++;
    }
    return {
      total: loans.length,
      vigentes: activos + vencidos,
      activos,
      vencidos,
      pagados,
      cancelados,
    };
  }, [loans]);

  const filteredLoans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return loans
      .filter((l) => {
        if (statusFilter === 'VIGENTES') {
          if (l.status !== 'ACTIVO' && l.status !== 'VENCIDO') return false;
        } else if (statusFilter !== 'TODOS' && l.status !== statusFilter) {
          return false;
        }
        if (!q) return true;
        const cust = customerById.get(l.customerId);
        return (
          l.loanNumber.toLowerCase().includes(q) ||
          l.applicantDisplayName.toLowerCase().includes(q) ||
          l.productCode.toLowerCase().includes(q) ||
          l.customerId.toLowerCase().includes(q) ||
          (cust?.documentNumber || '').toLowerCase().includes(q) ||
          (cust?.phone || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.disbursementDate || '').localeCompare(a.disbursementDate || ''));
  }, [loans, search, statusFilter, customerById]);

  useEffect(() => {
    if (filteredLoans.length === 0) {
      setSelectedLoan(null);
      return;
    }
    if (!selectedLoan || !filteredLoans.some((l) => l.id === selectedLoan.id)) {
      setSelectedLoan(filteredLoans[0]);
    }
  }, [filteredLoans, selectedLoan]);

  const selectedCustomer = useMemo(
    () =>
      selectedLoan ? customerById.get(selectedLoan.customerId) ?? null : null,
    [selectedLoan, customerById]
  );

  const selectedDisbursement = useMemo(
    () =>
      selectedLoan
        ? disbursements.find(
            (d) =>
              d.applicationId === selectedLoan.applicationId ||
              d.id === selectedLoan.disbursementId
          ) ?? null
        : null,
    [selectedLoan, disbursements]
  );

  const voucherDoc = useMemo(
    () =>
      selectedDisbursement?.voucherDocumentId
        ? documents.find((doc) => doc.id === selectedDisbursement.voucherDocumentId) ?? null
        : null,
    [selectedDisbursement, documents]
  );

  useEffect(() => {
    let active = true;
    const loadSchedule = async () => {
      if (!selectedLoan) {
        setInstallments([]);
        return;
      }
      const contextRows = loanInstallments
        .filter((inst) => inst.loanId === selectedLoan.id)
        .sort((a, b) => a.installmentNumber - b.installmentNumber);

      if (contextRows.length > 0 && !isExternal) {
        setInstallments(contextRows);
        setLoadingInstallments(false);
        return;
      }

      setLoadingInstallments(true);
      try {
        if (!isExternal) {
          const rows = await fetchInstallmentsByLoan(selectedLoan.id, selectedLoan.organizationId);
          if (active) setInstallments(rows.length > 0 ? rows : contextRows);
        } else {
          const sim = await runBackendAmortization({
            financedPrincipal: selectedLoan.totalFinancedPrincipal,
            monthlyRate: selectedLoan.contractualRateMonthly,
            termMonths: selectedLoan.termMonths,
            frequency: selectedLoan.frequency,
            amortizationMethod: selectedLoan.amortizationMethod,
            disbursementDate: selectedLoan.disbursementDate,
            firstPaymentDate: selectedLoan.firstPaymentDate,
          });
          if (active) {
            setInstallments(
              (sim.rows || []).map((r: SimulatedScheduleRow) => ({
                id: `${selectedLoan.id}_${r.installmentNumber}`,
                organizationId: selectedLoan.organizationId,
                loanId: selectedLoan.id,
                installmentNumber: r.installmentNumber,
                dueDate: r.dueDate,
                principalAmount: r.principalAmount,
                interestAmount: r.interestAmount,
                otherCharges: r.otherCharges,
                totalAmount: r.totalAmount,
                remainingPrincipalBalance: r.remainingPrincipalBalance,
                status: 'PENDIENTE',
              }))
            );
          }
        }
      } catch {
        if (active) setInstallments(contextRows);
      } finally {
        if (active) setLoadingInstallments(false);
      }
    };
    loadSchedule();
    return () => {
      active = false;
    };
  }, [selectedLoan, isExternal, loanInstallments]);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimLoading(true);
    setSimError(null);
    try {
      const rateDec = Number(simMonthlyRatePct) / 100;
      const res = await runBackendAmortization({
        financedPrincipal: Number(simPrincipal),
        monthlyRate: rateDec,
        termMonths: Number(simTermMonths),
        frequency: simFrequency,
        amortizationMethod: simMethod,
        disbursementDate: simDisbDate,
        firstPaymentDate: simFirstDate,
        perInstallmentOtherCharges: Number(simOtherCharges) || 0,
      });
      setSimResult(res);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Error simulando amortización.');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl sm:text-[22px] font-bold tracking-tight text-slate-950 dark:text-white">
            Cartera de Préstamos — Activos e Históricos
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Préstamos activos, vencidos, saldados e históricos persistidos en la plataforma con su ficha completa, comprobante y plan de cuotas.
          </p>
        </div>

        <div className="axy-surface inline-flex rounded-xl p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab('PORTFOLIO')}
            className={`px-3.5 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
              tab === 'PORTFOLIO'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            Cartera ({statusCounts.total})
          </button>
          <button
            type="button"
            onClick={() => setTab('SIMULATOR')}
            className={`px-3.5 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
              tab === 'SIMULATOR'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            Simulador de Amortización
          </button>
        </div>
      </div>

      {tab === 'PORTFOLIO' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar préstamo, cliente, cédula o teléfono..."
                  className="axy-input w-full pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as LoanStatusFilter)}
                className="axy-input px-3 py-2 text-xs text-slate-900 dark:text-white"
              >
                <option value="TODOS">Todos ({statusCounts.total})</option>
                <option value="VIGENTES">Vigentes ({statusCounts.vigentes})</option>
                <option value="ACTIVO">Activos ({statusCounts.activos})</option>
                <option value="VENCIDO">Vencidos ({statusCounts.vencidos})</option>
                <option value="PAGADO">Pagados ({statusCounts.pagados})</option>
                <option value="CANCELADO">Cancelados ({statusCounts.cancelados})</option>
              </select>
            </div>

            {filteredLoans.length === 0 ? (
              <div className="axy-surface p-8 rounded-2xl text-center text-xs text-slate-500">
                No existen préstamos que coincidan con el filtro actual. Complete un Desembolso o cambie el filtro de estado para visualizar la cartera completa.
              </div>
            ) : (
              <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                {filteredLoans.map((loan) => {
                  const selected = selectedLoan?.id === loan.id;
                  return (
                    <button
                      key={loan.id}
                      type="button"
                      onClick={() => setSelectedLoan(loan)}
                      className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#0066FF] bg-[#0066FF]/[0.06] dark:bg-[#0066FF]/15 dark:border-[#00B8FF]/60 shadow-sm'
                          : 'axy-surface hover:bg-slate-50/70 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                          {loan.loanNumber}
                        </span>
                        <span className={`font-semibold ${getLoanStatusBadgeClass(loan.status)}`}>
                          {loan.status}
                        </span>
                      </div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white mt-1">
                        {loan.applicantDisplayName}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                        <span>{PRODUCT_LABELS[loan.productCode]} · {loan.termMonths}m</span>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatMoney(loan.totalFinancedPrincipal, loan.currency)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-7">
            {selectedLoan ? (
              <div className="space-y-4">
                {/* Ficha Completa del Cliente */}
                <div className="axy-surface p-5 rounded-2xl space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <UserRoundCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                      Ficha Completa del Cliente Activo
                    </h3>
                    <span className="font-mono text-slate-500 dark:text-slate-400">ID Cliente: {selectedLoan.customerId}</span>
                  </div>

                  {selectedCustomer ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-slate-700 dark:text-slate-300">
                      <p>
                        Nombre: <strong className="text-slate-900 dark:text-white">{selectedCustomer.firstName} {selectedCustomer.lastName}</strong>
                      </p>
                      <p>
                        Documento: <strong className="font-mono">{selectedCustomer.documentType} {selectedCustomer.documentNumber}</strong>
                      </p>
                      <p>
                        Teléfono: <strong className="font-mono">{selectedCustomer.phone}</strong>
                        {selectedCustomer.altPhone ? ` / ${selectedCustomer.altPhone}` : ''}
                      </p>
                      <p>
                        Correo: <strong className="font-mono">{selectedCustomer.email || 'No registrado'}</strong>
                      </p>
                      <p className="sm:col-span-2">
                        Dirección: <strong>{selectedCustomer.address || 'No registrada'}</strong>
                        {selectedCustomer.municipality || selectedCustomer.province
                          ? ` (${[selectedCustomer.municipality, selectedCustomer.province].filter(Boolean).join(', ')})`
                          : ''}
                      </p>
                      <p>
                        Vivienda: <strong>{selectedCustomer.housingType || 'No declarada'}</strong> ({selectedCustomer.residenceMonths ?? 0} meses)
                      </p>
                      <p>
                        Redes Sociales:{' '}
                        <strong>
                          {selectedCustomer.socialMediaHandle ||
                            (selectedCustomer.socialMediaDeclared === 'NO_MEDIA' ? 'Sin redes' : 'No declarada')}
                        </strong>
                      </p>
                    </div>
                  ) : (
                    <p className="text-slate-500">
                      Titular: <strong>{selectedLoan.applicantDisplayName}</strong>
                    </p>
                  )}
                </div>

                {/* Ficha del Préstamo Adquirido y Desembolso */}
                <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
                    <div>
                      <p className="font-mono text-slate-500 dark:text-slate-400">{selectedLoan.loanNumber} · Ref. {selectedLoan.disbursementId}</p>
                      <h3 className="font-display text-base font-bold text-slate-900 dark:text-white mt-0.5">
                        Ficha del Préstamo Adquirido — {PRODUCT_LABELS[selectedLoan.productCode]}
                      </h3>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-500 dark:text-slate-400">Estado Operativo</p>
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400">{selectedLoan.status}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <p className="font-sans text-slate-500 dark:text-slate-400">Capital Aprobado</p>
                      <p className="font-bold text-sm tabular-nums mt-0.5 text-slate-900 dark:text-white">
                        {formatMoney(selectedLoan.approvedPrincipal, selectedLoan.currency)}
                      </p>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <p className="font-sans text-slate-500 dark:text-slate-400">Capital Financiado</p>
                      <p className="font-bold text-sm tabular-nums mt-0.5 text-slate-900 dark:text-white">
                        {formatMoney(selectedLoan.totalFinancedPrincipal, selectedLoan.currency)}
                      </p>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <p className="font-sans text-slate-500 dark:text-slate-400">Saldo Capital Actual</p>
                      <p className="font-bold text-sm tabular-nums mt-0.5 text-[#0066FF] dark:text-[#00D1FF]">
                        {formatMoney(selectedLoan.currentPrincipalBalance, selectedLoan.currency)}
                      </p>
                    </div>
                    <div className="axy-surface-tonal p-3 rounded-xl">
                      <p className="font-sans text-slate-500 dark:text-slate-400">Total Contractual</p>
                      <p className="font-bold text-sm tabular-nums mt-0.5 text-slate-900 dark:text-white">
                        {formatMoney(selectedLoan.totalContractualPayable, selectedLoan.currency)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-slate-600 dark:text-slate-300">
                    <p>Tasa mensual: <strong className="font-mono">{formatRatePct(selectedLoan.contractualRateMonthly)}</strong></p>
                    <p>Frecuencia: <strong>{selectedLoan.frequency}</strong></p>
                    <p>Método: <strong>{selectedLoan.amortizationMethod}</strong></p>
                    <p>Desembolso: <strong className="font-mono">{selectedLoan.disbursementDate}</strong></p>
                    <p>Primer vencimiento: <strong className="font-mono">{selectedLoan.firstPaymentDate}</strong></p>
                    <p>Vencimiento final: <strong className="font-mono">{selectedLoan.maturityDate}</strong></p>
                  </div>

                  {selectedDisbursement && (
                    <div className="axy-surface-tonal p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1 text-slate-600 dark:text-slate-300">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          Evidencia de Desembolso ({selectedDisbursement.disbursementNumber})
                        </p>
                        <p>
                          Banco: <strong>{selectedDisbursement.financialEntity}</strong> · Cuenta:{' '}
                          <strong className="font-mono">{selectedDisbursement.destinationAccountMasked}</strong> · Ref.:{' '}
                          <strong className="font-mono">{selectedDisbursement.referenceNumber}</strong>
                        </p>
                      </div>
                      {voucherDoc?.fileDataUrl && (
                        <a
                          href={voucherDoc.fileDataUrl}
                          download={voucherDoc.fileName}
                          className="axy-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Descargar Comprobante
                        </a>
                      )}
                    </div>
                  )}

                  <div className="axy-surface-tonal p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF] shrink-0" />
                      <span>
                        Sincronizado con el Módulo Integral de Cobranza (<code className="font-mono">loan_installments</code> y <code className="font-mono">collection_accounts</code>).
                      </span>
                    </div>
                    {!isExternal && rbac.hasPermission('VIEW_COLLECTIONS_PORTFOLIO') && (
                      <button
                        type="button"
                        onClick={() => setSelectedCollectionLoanId(selectedLoan.id)}
                        className="axy-btn-primary px-3 py-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Abrir Ficha 360° Cobranza
                      </button>
                    )}
                  </div>
                </div>

                <div className="axy-surface rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex items-center justify-between">
                    <h4 className="font-display text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
                      <CalendarDays className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                      Plan de Cuotas Inmutable ({installments.length})
                    </h4>
                    {loadingInstallments && <span className="text-xs text-slate-500">Cargando cuotas...</span>}
                  </div>
                  <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="axy-table-head sticky top-0 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Cuota</th>
                          <th className="py-2.5 px-3 font-semibold">Vencimiento</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Capital</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Interés</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Total Cuota</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Saldo Insoluto</th>
                          <th className="py-2.5 px-3 font-semibold">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {installments.map((inst) => (
                          <tr key={inst.id} className="axy-table-row">
                            <td className="py-2 px-3 font-semibold">#{inst.installmentNumber}</td>
                            <td className="py-2 px-3">{inst.dueDate}</td>
                            <td className="py-2 px-3 text-right">{inst.principalAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{inst.interestAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-semibold">{inst.totalAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{inst.remainingPrincipalBalance.toFixed(2)}</td>
                            <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-300">{inst.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="axy-surface p-8 rounded-2xl text-center text-xs text-slate-500">
                Seleccione un cliente activo para inspeccionar su ficha completa y plan de cuotas.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSimulate}
            className="axy-surface lg:col-span-4 p-5 rounded-2xl space-y-3 text-xs h-fit"
          >
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Parámetros de Simulación (Aritmética en Centavos)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Capital Financiado</label>
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  value={simPrincipal}
                  onChange={(e) => setSimPrincipal(e.target.value)}
                  className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Moneda</label>
                <select
                  value={simCurrency}
                  onChange={(e) => setSimCurrency(e.target.value as CurrencyCode)}
                  className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                >
                  <option value="DOP">DOP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Tasa Mensual (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={simMonthlyRatePct}
                  onChange={(e) => setSimMonthlyRatePct(e.target.value)}
                  className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Plazo (Meses)</label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={simTermMonths}
                  onChange={(e) => setSimTermMonths(e.target.value)}
                  className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Frecuencia</label>
                <select
                  value={simFrequency}
                  onChange={(e) => setSimFrequency(e.target.value as PaymentFrequency)}
                  className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                >
                  <option value="MENSUAL">Mensual</option>
                  <option value="QUINCENAL">Quincenal</option>
                  <option value="SEMANAL">Semanal</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Método</label>
                <select
                  value={simMethod}
                  onChange={(e) => setSimMethod(e.target.value as AmortizationMethod)}
                  className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                >
                  <option value="SALDO_INSOLUTO">Saldo Insoluto</option>
                  <option value="INTERES_FIJO">Interés Fijo</option>
                </select>
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Fecha Desembolso</label>
                <input
                  type="date"
                  value={simDisbDate}
                  onChange={(e) => setSimDisbDate(e.target.value)}
                  className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500 dark:text-slate-400">Primer Vencimiento</label>
                <input
                  type="date"
                  value={simFirstDate}
                  onChange={(e) => setSimFirstDate(e.target.value)}
                  className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block mb-1 text-slate-500 dark:text-slate-400">Otros Cargos por Cuota (Opcional)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={simOtherCharges}
                onChange={(e) => setSimOtherCharges(e.target.value)}
                className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white"
              />
            </div>

            {simError && (
              <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                {simError}
              </div>
            )}

            <button
              type="submit"
              disabled={simLoading}
              className="axy-btn-primary w-full py-2.5 cursor-pointer disabled:opacity-50"
            >
              {simLoading ? 'Calculando...' : 'Calcular Tabla de Amortización'}
            </button>
          </form>

          <div className="lg:col-span-8 space-y-4">
            {simResult ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="axy-surface p-4 rounded-xl">
                    <p className="font-sans text-slate-500 dark:text-slate-400">Cuota Base</p>
                    <p className="font-bold text-base tabular-nums mt-1 text-[#0066FF] dark:text-[#00D1FF]">
                      {formatMoney(simResult.periodicInstallmentEstimate, simCurrency)}
                    </p>
                  </div>
                  <div className="axy-surface p-4 rounded-xl">
                    <p className="font-sans text-slate-500 dark:text-slate-400">Total Intereses</p>
                    <p className="font-bold text-base tabular-nums mt-1 text-slate-900 dark:text-white">
                      {formatMoney(simResult.totalInterestScheduled, simCurrency)}
                    </p>
                  </div>
                  <div className="axy-surface p-4 rounded-xl">
                    <p className="font-sans text-slate-500 dark:text-slate-400">Total a Pagar</p>
                    <p className="font-bold text-base tabular-nums mt-1 text-slate-900 dark:text-white">
                      {formatMoney(simResult.totalContractualPayable, simCurrency)}
                    </p>
                  </div>
                  <div className="axy-surface p-4 rounded-xl">
                    <p className="font-sans text-slate-500 dark:text-slate-400">Cuotas / Vence</p>
                    <p className="font-bold text-sm mt-1 text-slate-900 dark:text-white">
                      {simResult.rows.length} · {simResult.maturityDate}
                    </p>
                  </div>
                </div>

                <div className="axy-surface rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex items-center justify-between text-xs">
                    <span className="font-display font-semibold text-sm text-slate-900 dark:text-white">Calendario Simulado</span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Reconciliación exacta de capital: {simResult.isReconciled ? 'Verificada' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="axy-table-head sticky top-0 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">#</th>
                          <th className="py-2.5 px-3 font-semibold">Vencimiento</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Capital</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Interés</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Cargos</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Total Cuota</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Saldo Final</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {simResult.rows.map((r) => (
                          <tr key={r.installmentNumber} className="axy-table-row">
                            <td className="py-2 px-3 font-semibold">{r.installmentNumber}</td>
                            <td className="py-2 px-3">{r.dueDate}</td>
                            <td className="py-2 px-3 text-right">{r.principalAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{r.interestAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{r.otherCharges.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-semibold">{r.totalAmount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right">{r.remainingPrincipalBalance.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="axy-surface p-10 rounded-2xl text-center text-xs text-slate-500">
                Configure los parámetros del préstamo y presione <strong>Calcular Tabla de Amortización</strong> para generar el calendario real con conciliación exacta de la última cuota.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
