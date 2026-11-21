import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarRange,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Layers,
  PlusCircle,
  Settings2,
  TrendingUp,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  computeFinancialStatements,
  EXPENSE_CATEGORY_LABELS,
  type FinancialPeriodColumn,
} from '../../engine/accountingEngine';
import type { CurrencyCode, ExpenseCategory } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';
import { AccountingPaymentValidationView } from './AccountingPaymentValidationView';
import { isPaymentPendingValidation } from '../../utils/paymentEvidence';

type StatementTab = 'situacion' | 'resultados' | 'flujo';
type PeriodMode = 'monthly' | 'annual';

const EXPENSE_CATEGORIES_ORDERED: ExpenseCategory[] = [
  'NOMINA',
  'ALQUILER',
  'SERVICIOS_BASICOS',
  'TECNOLOGIA',
  'MARKETING',
  'LEGAL_COBRANZA',
  'IMPUESTOS',
  'SUMINISTROS',
  'OTROS',
];

export function AccountingStatementsView({
  mode,
}: {
  mode: 'overview' | 'statements';
}) {
  const {
    organization,
    loans,
    disbursements,
    collectionReceipts,
    payments,
    paymentAllocations,
    operatingExpenses,
    investors,
    investorTransactions,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const currentYear = new Date().getFullYear();
  const [currency, setCurrency] = useState<CurrencyCode>(organization.currency || 'DOP');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [statementTab, setStatementTab] = useState<StatementTab>('situacion');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly');

  const report = useMemo(
    () =>
      computeFinancialStatements({
        currency,
        year: selectedYear,
        loans,
        disbursements,
        collectionReceipts,
        payments,
        paymentAllocations,
        operatingExpenses,
        investors,
        investorTransactions,
      }),
    [
      currency,
      selectedYear,
      loans,
      disbursements,
      collectionReceipts,
      payments,
      paymentAllocations,
      operatingExpenses,
      investors,
      investorTransactions,
    ]
  );

  const columns: FinancialPeriodColumn[] = useMemo(() => {
    if (periodMode === 'monthly') {
      return [...report.monthlyColumns, report.yearTotalColumn];
    }
    return [...report.annualColumns, report.cumulativeAllYearsColumn];
  }, [periodMode, report]);

  const cumulative = report.cumulativeAllYearsColumn;

  const fmtCell = (val: number) => {
    const formatted = formatMoney(Math.abs(val), currency);
    return val < 0 ? `-${formatted}` : formatted;
  };

  const handleExportCsv = () => {
    const headers = ['Partida / Cuenta', ...columns.map((c) => c.label)];
    const rows: Array<Array<string | number>> = [];

    if (statementTab === 'situacion') {
      rows.push(
        ['ACTIVOS', ...columns.map(() => '')],
        ['Efectivo y Bancos Neto', ...columns.map((c) => c.balanceSheet.cashAndBanks.toFixed(2))],
        ['Cartera de Préstamos por Cobrar', ...columns.map((c) => c.balanceSheet.loanPortfolioReceivable.toFixed(2))],
        ['TOTAL ACTIVOS', ...columns.map((c) => c.balanceSheet.totalAssets.toFixed(2))],
        ['PASIVOS', ...columns.map(() => '')],
        ['Capital de Inversionistas por Pagar', ...columns.map((c) => c.balanceSheet.investorCapitalPayable.toFixed(2))],
        ['Gastos Operativos por Pagar', ...columns.map((c) => c.balanceSheet.accountsPayableExpenses.toFixed(2))],
        ['TOTAL PASIVOS', ...columns.map((c) => c.balanceSheet.totalLiabilities.toFixed(2))],
        ['PATRIMONIO', ...columns.map(() => '')],
        ['Resultados Acumulados', ...columns.map((c) => c.balanceSheet.accumulatedResults.toFixed(2))],
        ['TOTAL PASIVO Y PATRIMONIO', ...columns.map((c) => c.balanceSheet.totalLiabilitiesAndEquity.toFixed(2))]
      );
    } else if (statementTab === 'resultados') {
      rows.push(
        ['INGRESOS OPERATIVOS', ...columns.map(() => '')],
        ['Intereses Cobrados', ...columns.map((c) => c.incomeStatement.interestIncome.toFixed(2))],
        ['Mora y Penalidades', ...columns.map((c) => c.incomeStatement.lateFeeIncome.toFixed(2))],
        ['Cargos y Comisiones', ...columns.map((c) => c.incomeStatement.chargesIncome.toFixed(2))],
        ['TOTAL INGRESOS', ...columns.map((c) => c.incomeStatement.totalRevenue.toFixed(2))],
        ['GASTOS OPERATIVOS', ...columns.map(() => '')],
        ...EXPENSE_CATEGORIES_ORDERED.map((cat) => [
          EXPENSE_CATEGORY_LABELS[cat],
          ...columns.map((c) => c.incomeStatement.expensesByCategory[cat].toFixed(2)),
        ]),
        ['TOTAL GASTOS OPERATIVOS', ...columns.map((c) => c.incomeStatement.operatingExpensesTotal.toFixed(2))],
        ['Utilidad Operativa (EBIT)', ...columns.map((c) => c.incomeStatement.operatingIncome.toFixed(2))],
        ['Rendimientos a Inversionistas', ...columns.map((c) => c.incomeStatement.investorYieldCost.toFixed(2))],
        ['RESULTADO NETO DEL PERÍODO', ...columns.map((c) => c.incomeStatement.netIncome.toFixed(2))]
      );
    } else {
      rows.push(
        ['ACTIVIDADES DE OPERACIÓN', ...columns.map(() => '')],
        ['Cobros de Intereses, Mora y Cargos', ...columns.map((c) => c.cashFlow.operatingInflows.toFixed(2))],
        ['Gastos Operativos Pagados', ...columns.map((c) => (-c.cashFlow.operatingOutflows).toFixed(2))],
        ['Flujo Neto de Operación', ...columns.map((c) => c.cashFlow.netOperatingCash.toFixed(2))],
        ['ACTIVIDADES DE INVERSIÓN (CARTERA)', ...columns.map(() => '')],
        ['Recuperación de Capital de Préstamos', ...columns.map((c) => c.cashFlow.principalRecovered.toFixed(2))],
        ['Desembolsos de Préstamos', ...columns.map((c) => (-c.cashFlow.loansDisbursed).toFixed(2))],
        ['Flujo Neto de Cartera', ...columns.map((c) => c.cashFlow.netInvestingCash.toFixed(2))],
        ['ACTIVIDADES DE FINANCIAMIENTO', ...columns.map(() => '')],
        ['Aportes de Capital de Inversionistas', ...columns.map((c) => c.cashFlow.investorContributions.toFixed(2))],
        ['Retiros de Capital de Inversionistas', ...columns.map((c) => (-c.cashFlow.investorWithdrawals).toFixed(2))],
        ['Rendimientos Pagados a Inversionistas', ...columns.map((c) => (-c.cashFlow.investorReturnsPaid).toFixed(2))],
        ['Flujo Neto de Financiamiento', ...columns.map((c) => c.cashFlow.netFinancingCash.toFixed(2))],
        ['VARIACIÓN NETA DE EFECTIVO', ...columns.map((c) => c.cashFlow.netCashChange.toFixed(2))],
        ['EFECTIVO FINAL ACUMULADO', ...columns.map((c) => c.cashFlow.endingCashBalance.toFixed(2))]
      );
    }

    const csvEscape = (val: string | number) => {
      const str = String(val);
      return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `axycore_${statementTab}_${periodMode}_${currency}_${selectedYear}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderRow = (
    label: string,
    getter: (col: FinancialPeriodColumn) => number,
    opts?: {
      isTotal?: boolean;
      isSubtotal?: boolean;
      indent?: boolean;
      highlightNegative?: boolean;
    }
  ) => {
    const rowBg = opts?.isTotal
      ? 'bg-slate-100/90 dark:bg-[#0D1E42] font-bold text-slate-950 dark:text-white border-t border-b border-slate-300 dark:border-[#00B8FF]/30'
      : opts?.isSubtotal
      ? 'bg-slate-50/70 dark:bg-[#091632] font-semibold text-slate-900 dark:text-slate-100 border-t border-slate-200 dark:border-[#00B8FF]/15'
      : 'hover:bg-slate-50/60 dark:hover:bg-[#0C1B3B]/60 text-slate-700 dark:text-slate-300';

    return (
      <tr key={label} className={`border-b border-slate-100 dark:border-white/5 ${rowBg}`}>
        <td
          className={`sticky left-0 z-10 py-2.5 pr-4 whitespace-nowrap ${
            opts?.indent ? 'pl-7' : 'pl-4'
          } ${
            opts?.isTotal
              ? 'bg-slate-100 dark:bg-[#0D1E42]'
              : opts?.isSubtotal
              ? 'bg-slate-50 dark:bg-[#091632]'
              : 'bg-white dark:bg-[#08132B]'
          }`}
        >
          {label}
        </td>
        {columns.map((col, idx) => {
          const val = getter(col);
          const isLastTotalCol = idx === columns.length - 1;
          const colorCls =
            opts?.highlightNegative && val < 0
              ? 'text-rose-600 dark:text-rose-400'
              : val > 0 && opts?.isTotal
              ? 'text-[#0052CC] dark:text-[#00D1FF]'
              : '';
          return (
            <td
              key={col.key}
              className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                isLastTotalCol
                  ? 'bg-[#0066FF]/[0.06] dark:bg-[#00B8FF]/[0.08] font-bold border-l border-slate-200 dark:border-[#00B8FF]/20'
                  : ''
              } ${colorCls}`}
            >
              {fmtCell(val)}
            </td>
          );
        })}
      </tr>
    );
  };

  const renderSectionBanner = (title: string) => (
    <tr key={`sec_${title}`} className="bg-slate-50/90 dark:bg-[#040C1E] border-b border-slate-200 dark:border-[#00B8FF]/15">
      <td
        colSpan={columns.length + 1}
        className="py-2 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#00B8FF]"
      >
        {title}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            {mode === 'overview' ? (
              <BookOpen className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            ) : (
              <FileSpreadsheet className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            )}
            <span>
              {mode === 'overview'
                ? 'Contabilidad General y Estados Financieros'
                : 'Estados Financieros (Mensual y Acumulativo Anual)'}
            </span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Consolidación en tiempo real de cartera desembolsada, ingresos cobrados, gastos operativos e inversionistas en{' '}
            {organization.tradeName || organization.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">

          {/* Currency Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20">
            {(['DOP', 'USD'] as const).map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => setCurrency(cur)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  currency === cur
                    ? 'bg-white dark:bg-[#0066FF] text-slate-950 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {cur}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] hover:border-[#0066FF]/50 text-slate-800 dark:text-slate-100 font-semibold whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Top Executive Accounting Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Total Activos ({currency})
          </p>
          <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
            {fmtCell(cumulative.balanceSheet.totalAssets)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Cartera: {fmtCell(cumulative.balanceSheet.loanPortfolioReceivable)}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Ingresos Operativos Acumulados
          </p>
          <p className="mt-1 font-mono tabular-nums text-lg font-bold text-emerald-600 dark:text-emerald-400">
            {fmtCell(cumulative.incomeStatement.totalRevenue)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Intereses: {fmtCell(cumulative.incomeStatement.interestIncome)}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Gastos + Costo Financiero
          </p>
          <p className="mt-1 font-mono tabular-nums text-lg font-bold text-amber-600 dark:text-amber-400">
            {fmtCell(
              cumulative.incomeStatement.operatingExpensesTotal +
                cumulative.incomeStatement.investorYieldCost
            )}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Por pagar: {fmtCell(cumulative.balanceSheet.accountsPayableExpenses)}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Resultado Neto Acumulado
          </p>
          <p
            className={`mt-1 font-mono tabular-nums text-lg font-bold ${
              cumulative.incomeStatement.netIncome >= 0
                ? 'text-[#0052CC] dark:text-[#00D1FF]'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {fmtCell(cumulative.incomeStatement.netIncome)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Caja neta: {fmtCell(cumulative.balanceSheet.cashAndBanks)}
          </p>
        </div>
      </div>

      {/* Quick Operations Shortcuts when opened via Contabilidad */}
      {mode === 'overview' && (
        <>
          <div className="flex flex-wrap items-center gap-2 p-3.5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
            <span className="text-slate-500 dark:text-slate-400 font-medium mr-1">
              Accesos directos de Contabilidad:
            </span>
            <button
              type="button"
              onClick={() => setActiveSection('accounting_payment_validation')}
              className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer whitespace-nowrap"
            >
              Pagos para Validación (
              {payments.filter((p) => isPaymentPendingValidation(p.status)).length})
            </button>
            {rbac.canAccessSection('cobranza_reconciliation') && (
              <button
                type="button"
                onClick={() => setActiveSection('cobranza_reconciliation')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
              >
                Conciliación Bancaria
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveSection('ecf_dashboard')}
              className="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-[#00D1FF] border border-[#00B8FF]/30 font-semibold cursor-pointer whitespace-nowrap"
            >
              Facturación Electrónica DGII (e-CF)
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('accounting_chart_of_accounts')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Plan de Cuentas
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('accounting_general_ledger')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Libro Mayor
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('accounting_taxes')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Impuestos (ITBIS)
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('accounting_statements')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Estados Financieros
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('register_payment')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Registrar Pagos
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('register_expense')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Registrar Gastos
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('register_investor')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 font-semibold cursor-pointer whitespace-nowrap"
            >
              Registrar Inversionistas
            </button>
          </div>

          {rbac.canAccessSection('ecf_dashboard') && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-indigo-500/10 dark:from-[#00B8FF]/15 dark:via-[#08132B] dark:to-indigo-500/10 border border-cyan-500/30 dark:border-[#00B8FF]/30 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 dark:bg-[#00B8FF]/20 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-[#00B8FF] shrink-0">
                  <FileCheck2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Facturación Electrónica DGII (e-CF · Ley 32-23)
                    </h3>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-700 dark:text-[#00B8FF] border border-cyan-500/25">
                      Integrado en Contabilidad
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Emite comprobantes 31–47, valida esquemas XML/XSD oficiales, gestiona secuencias e-NCF, certificados digitales y asientos automáticos.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection('ecf_dashboard')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold shadow-xs cursor-pointer whitespace-nowrap"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  Abrir Dashboard e-CF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('ecf_emit')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-800 dark:text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-cyan-600 dark:text-[#00B8FF]" />
                  Emitir Factura Electrónica
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('ecf_config')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Configuración DGII
                </button>
              </div>
            </div>
          )}

          <AccountingPaymentValidationView embedded />
        </>
      )}

      {/* Statement Selector & Periodicity Toolbar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 3 Statements Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-[#00B8FF]/15">
            {(
              [
                { id: 'situacion', label: 'Estado de Situación' },
                { id: 'resultados', label: 'Estado de Resultados' },
                { id: 'flujo', label: 'Estado de Flujo de Efectivo' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatementTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  statementTab === tab.id
                    ? 'axy-brand-gradient text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Periodicity Toggle: Por Meses vs Acumulativo por Años */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-[#00B8FF]/15">
              <button
                type="button"
                onClick={() => setPeriodMode('monthly')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  periodMode === 'monthly'
                    ? 'bg-white dark:bg-[#0D1E42] text-slate-950 dark:text-[#00D1FF] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                <CalendarRange className="w-3.5 h-3.5" />
                <span>Por Meses</span>
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode('annual')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  periodMode === 'annual'
                    ? 'bg-white dark:bg-[#0D1E42] text-slate-950 dark:text-[#00D1FF] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Acumulativo por Años</span>
              </button>
            </div>

            {periodMode === 'monthly' && (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                aria-label="Año fiscal"
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white font-mono font-semibold cursor-pointer"
              >
                {report.availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    Año {yr}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Financial Statement Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-[#00B8FF]/15">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-[#00B8FF]/20 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                <th className="sticky left-0 z-20 bg-slate-50 dark:bg-[#040C1E] py-3 px-4 min-w-[260px]">
                  {statementTab === 'situacion'
                    ? `Estado de Situación · ${currency}`
                    : statementTab === 'resultados'
                    ? `Estado de Resultados · ${currency}`
                    : `Estado de Flujo de Efectivo · ${currency}`}
                </th>
                {columns.map((col, idx) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 text-right whitespace-nowrap min-w-[115px] ${
                      idx === columns.length - 1
                        ? 'bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0052CC] dark:text-[#00D1FF] border-l border-slate-200 dark:border-[#00B8FF]/20'
                        : ''
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statementTab === 'situacion' && (
                <>
                  {renderSectionBanner('Activos')}
                  {renderRow('Efectivo y Bancos Neto', (c) => c.balanceSheet.cashAndBanks, {
                    indent: true,
                    highlightNegative: true,
                  })}
                  {renderRow(
                    'Cartera de Préstamos por Cobrar (Capital)',
                    (c) => c.balanceSheet.loanPortfolioReceivable,
                    { indent: true }
                  )}
                  {renderRow('Total Activos', (c) => c.balanceSheet.totalAssets, {
                    isTotal: true,
                  })}

                  {renderSectionBanner('Pasivos')}
                  {renderRow(
                    'Capital de Inversionistas por Pagar',
                    (c) => c.balanceSheet.investorCapitalPayable,
                    { indent: true }
                  )}
                  {renderRow(
                    'Gastos Operativos Pendientes por Pagar',
                    (c) => c.balanceSheet.accountsPayableExpenses,
                    { indent: true }
                  )}
                  {renderRow('Total Pasivos', (c) => c.balanceSheet.totalLiabilities, {
                    isSubtotal: true,
                  })}

                  {renderSectionBanner('Patrimonio')}
                  {renderRow(
                    'Resultados Acumulados del Ejercicio',
                    (c) => c.balanceSheet.accumulatedResults,
                    { indent: true, highlightNegative: true }
                  )}
                  {renderRow('Total Patrimonio', (c) => c.balanceSheet.totalEquity, {
                    isSubtotal: true,
                    highlightNegative: true,
                  })}
                  {renderRow(
                    'Total Pasivo + Patrimonio',
                    (c) => c.balanceSheet.totalLiabilitiesAndEquity,
                    { isTotal: true }
                  )}
                </>
              )}

              {statementTab === 'resultados' && (
                <>
                  {renderSectionBanner('Ingresos Operativos')}
                  {renderRow('Intereses Cobrados sobre Préstamos', (c) => c.incomeStatement.interestIncome, {
                    indent: true,
                  })}
                  {renderRow('Mora y Penalidades Cobradas', (c) => c.incomeStatement.lateFeeIncome, {
                    indent: true,
                  })}
                  {renderRow('Cargos y Comisiones Administrativas', (c) => c.incomeStatement.chargesIncome, {
                    indent: true,
                  })}
                  {renderRow('Total Ingresos Operativos', (c) => c.incomeStatement.totalRevenue, {
                    isSubtotal: true,
                  })}

                  {renderSectionBanner('Gastos Operativos')}
                  {EXPENSE_CATEGORIES_ORDERED.map((cat) =>
                    renderRow(
                      EXPENSE_CATEGORY_LABELS[cat],
                      (c) => c.incomeStatement.expensesByCategory[cat],
                      { indent: true }
                    )
                  )}
                  {renderRow(
                    'Total Gastos Operativos',
                    (c) => c.incomeStatement.operatingExpensesTotal,
                    { isSubtotal: true }
                  )}

                  {renderSectionBanner('Resultados y Costo Financiero')}
                  {renderRow('Utilidad Operativa (EBIT)', (c) => c.incomeStatement.operatingIncome, {
                    isSubtotal: true,
                    highlightNegative: true,
                  })}
                  {renderRow(
                    'Rendimientos / Intereses a Inversionistas',
                    (c) => c.incomeStatement.investorYieldCost,
                    { indent: true }
                  )}
                  {renderRow('Resultado Neto del Período', (c) => c.incomeStatement.netIncome, {
                    isTotal: true,
                    highlightNegative: true,
                  })}
                </>
              )}

              {statementTab === 'flujo' && (
                <>
                  {renderSectionBanner('Actividades de Operación')}
                  {renderRow(
                    '(+) Cobros de Intereses, Mora y Cargos',
                    (c) => c.cashFlow.operatingInflows,
                    { indent: true }
                  )}
                  {renderRow(
                    '(-) Gastos Operativos Pagados en Efectivo',
                    (c) => -c.cashFlow.operatingOutflows,
                    { indent: true, highlightNegative: true }
                  )}
                  {renderRow(
                    'Flujo Neto de Actividades de Operación',
                    (c) => c.cashFlow.netOperatingCash,
                    { isSubtotal: true, highlightNegative: true }
                  )}

                  {renderSectionBanner('Actividades de Inversión (Cartera de Préstamos)')}
                  {renderRow(
                    '(+) Recuperación de Capital de Préstamos',
                    (c) => c.cashFlow.principalRecovered,
                    { indent: true }
                  )}
                  {renderRow(
                    '(-) Desembolsos de Préstamos Otorgados',
                    (c) => -c.cashFlow.loansDisbursed,
                    { indent: true, highlightNegative: true }
                  )}
                  {renderRow(
                    'Flujo Neto de Cartera / Inversión',
                    (c) => c.cashFlow.netInvestingCash,
                    { isSubtotal: true, highlightNegative: true }
                  )}

                  {renderSectionBanner('Actividades de Financiamiento (Inversionistas)')}
                  {renderRow(
                    '(+) Aportes de Capital de Inversionistas',
                    (c) => c.cashFlow.investorContributions,
                    { indent: true }
                  )}
                  {renderRow(
                    '(-) Retiros de Capital de Inversionistas',
                    (c) => -c.cashFlow.investorWithdrawals,
                    { indent: true, highlightNegative: true }
                  )}
                  {renderRow(
                    '(-) Pago de Rendimientos a Inversionistas',
                    (c) => -c.cashFlow.investorReturnsPaid,
                    { indent: true, highlightNegative: true }
                  )}
                  {renderRow(
                    'Flujo Neto de Financiamiento',
                    (c) => c.cashFlow.netFinancingCash,
                    { isSubtotal: true, highlightNegative: true }
                  )}

                  {renderSectionBanner('Resumen de Efectivo')}
                  {renderRow('Variación Neta de Efectivo del Período', (c) => c.cashFlow.netCashChange, {
                    isSubtotal: true,
                    highlightNegative: true,
                  })}
                  {renderRow('Efectivo y Bancos al Cierre', (c) => c.cashFlow.endingCashBalance, {
                    isTotal: true,
                    highlightNegative: true,
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>
              {periodMode === 'monthly'
                ? `Desglose mensual enero–diciembre ${selectedYear} + columna Total ${selectedYear}.`
                : `Comparativo anual (${report.availableYears.join(', ')}) + Acumulado Total histórico.`}
            </span>
          </span>
          <span className="font-mono tabular-nums">
            Cuadre contable (Activo − Pasivo − Patrimonio):{' '}
            {fmtCell(cumulative.balanceSheet.balanceDiff)}
          </span>
        </div>
      </div>
    </div>
  );
}
