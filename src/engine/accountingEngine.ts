import type {
  CollectionReceiptRecord,
  CurrencyCode,
  DisbursementRecord,
  ExpenseCategory,
  InvestorRecord,
  InvestorTransactionRecord,
  LoanRecord,
  OperatingExpenseRecord,
  PaymentAllocationRecord,
  PaymentRecord,
} from '../types/axycore';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  NOMINA: 'Nómina y Personal',
  ALQUILER: 'Alquiler y Local',
  SERVICIOS_BASICOS: 'Servicios Básicos',
  TECNOLOGIA: 'Tecnología y Sistemas',
  MARKETING: 'Marketing y Captación',
  LEGAL_COBRANZA: 'Legal y Cobranzas',
  IMPUESTOS: 'Impuestos y Tasas',
  SUMINISTROS: 'Suministros de Oficina',
  INTERESES_INVERSIONISTAS: 'Intereses / Rendimientos',
  OTROS: 'Otros Gastos Operativos',
};

export const INVESTOR_TX_LABELS: Record<InvestorTransactionRecord['transactionType'], string> = {
  APORTE_CAPITAL: 'Aporte de Capital',
  RETIRO_CAPITAL: 'Retiro de Capital',
  PAGO_RENDIMIENTO: 'Pago de Rendimiento',
};

export const MONTH_LABELS_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

export interface FinancialPeriodColumn {
  key: string; // e.g. '2026-01' or '2026' or 'TOTAL'
  label: string;
  cutoffDateIso: string; // YYYY-MM-DD end of period
  // 1. Estado de Resultados (Flujo del período)
  incomeStatement: {
    interestIncome: number;
    lateFeeIncome: number;
    chargesIncome: number;
    totalRevenue: number;
    expensesByCategory: Record<ExpenseCategory, number>;
    operatingExpensesTotal: number;
    operatingIncome: number; // EBIT
    investorYieldCost: number;
    netIncome: number;
  };
  // 2. Estado de Flujo de Efectivo (Movimientos de caja del período)
  cashFlow: {
    operatingInflows: number;
    operatingOutflows: number;
    netOperatingCash: number;
    principalRecovered: number;
    loansDisbursed: number;
    netInvestingCash: number;
    investorContributions: number;
    investorWithdrawals: number;
    investorReturnsPaid: number;
    netFinancingCash: number;
    netCashChange: number;
    endingCashBalance: number;
  };
  // 3. Estado de Situación (Saldo acumulado a la fecha de corte)
  balanceSheet: {
    cashAndBanks: number;
    loanPortfolioReceivable: number;
    totalAssets: number;
    investorCapitalPayable: number;
    accountsPayableExpenses: number;
    totalLiabilities: number;
    accumulatedResults: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    balanceDiff: number;
  };
}

export interface FinancialStatementsReport {
  currency: CurrencyCode;
  selectedYear: number;
  availableYears: number[];
  monthlyColumns: FinancialPeriodColumn[];
  yearTotalColumn: FinancialPeriodColumn;
  annualColumns: FinancialPeriodColumn[];
  cumulativeAllYearsColumn: FinancialPeriodColumn;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptyCategoryMap(): Record<ExpenseCategory, number> {
  return {
    NOMINA: 0,
    ALQUILER: 0,
    SERVICIOS_BASICOS: 0,
    TECNOLOGIA: 0,
    MARKETING: 0,
    LEGAL_COBRANZA: 0,
    IMPUESTOS: 0,
    SUMINISTROS: 0,
    INTERESES_INVERSIONISTAS: 0,
    OTROS: 0,
  };
}

interface NormalizedFlowEvent {
  dateIso: string; // YYYY-MM-DD
  interestIncome: number;
  lateFeeIncome: number;
  chargesIncome: number;
  principalRecovered: number;
  loansDisbursed: number;
  expenseCategory?: ExpenseCategory;
  expensePaid: number;
  expensePending: number;
  investorContribution: number;
  investorWithdrawal: number;
  investorReturnPaid: number;
}

function buildNormalizedEvents(params: {
  currency: CurrencyCode;
  loans: LoanRecord[];
  disbursements: DisbursementRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  payments: PaymentRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
}): NormalizedFlowEvent[] {
  const {
    currency,
    loans,
    disbursements,
    collectionReceipts,
    payments,
    paymentAllocations = [],
    operatingExpenses,
    investorTransactions,
  } = params;

  const events: NormalizedFlowEvent[] = [];
  const blank = (dateIso: string): NormalizedFlowEvent => ({
    dateIso,
    interestIncome: 0,
    lateFeeIncome: 0,
    chargesIncome: 0,
    principalRecovered: 0,
    loansDisbursed: 0,
    expensePaid: 0,
    expensePending: 0,
    investorContribution: 0,
    investorWithdrawal: 0,
    investorReturnPaid: 0,
  });

  // 1. Loan Disbursements (prefer explicit DisbursementRecord when available per loan)
  const disbByLoanId = new Map<string, DisbursementRecord>();
  for (const d of disbursements) {
    if (d.status === 'CONFIRMADO') {
      disbByLoanId.set(d.loanId, d);
    }
  }
  for (const loan of loans) {
    if (loan.currency !== currency) continue;
    if (loan.status === 'CANCELADO' && loan.totalFinancedPrincipal === 0) continue;
    const disb = disbByLoanId.get(loan.id);
    const dateIso = (disb?.disbursementDate || loan.disbursementDate || '').slice(0, 10);
    if (!dateIso || dateIso.length < 10) continue;
    const disbursedPrincipal = disb?.totalFinanced ?? loan.totalFinancedPrincipal ?? loan.approvedPrincipal ?? 0;
    if (disbursedPrincipal > 0) {
      events.push({
        ...blank(dateIso),
        loansDisbursed: round2(disbursedPrincipal),
      });
    }
  }

  // 2. Applied Payments via Official CollectionReceipts + fallback allocations
  const validReceipts = collectionReceipts.filter(
    (r) => r.currency === currency && r.status === 'EMITIDO'
  );
  const receiptPaymentIds = new Set(validReceipts.map((r) => r.paymentId));

  for (const rec of validReceipts) {
    const dateIso = (rec.paymentDate || '').slice(0, 10);
    if (!dateIso || dateIso.length < 10) continue;
    events.push({
      ...blank(dateIso),
      interestIncome: round2(rec.appliedToInterest || 0),
      lateFeeIncome: round2(rec.appliedToLateFee || 0),
      chargesIncome: round2(rec.appliedToCharges || 0),
      principalRecovered: round2(rec.appliedToPrincipal || 0),
    });
  }

  for (const pay of payments) {
    if (pay.currency !== currency || pay.status !== 'APLICADO') continue;
    if (receiptPaymentIds.has(pay.id)) continue;
    const dateIso = (pay.paymentDate || '').slice(0, 10);
    if (!dateIso || dateIso.length < 10) continue;
    const allocs = paymentAllocations.filter((a) => a.paymentId === pay.id);
    if (allocs.length > 0) {
      events.push({
        ...blank(dateIso),
        interestIncome: round2(allocs.reduce((s, a) => s + (a.appliedToInterest || 0), 0)),
        lateFeeIncome: round2(allocs.reduce((s, a) => s + (a.appliedToLateFee || 0), 0)),
        chargesIncome: round2(allocs.reduce((s, a) => s + (a.appliedToCharges || 0), 0)),
        principalRecovered: round2(allocs.reduce((s, a) => s + (a.appliedToPrincipal || 0), 0)),
      });
    } else {
      events.push({
        ...blank(dateIso),
        principalRecovered: round2(pay.amount),
      });
    }
  }

  // 3. Operating Expenses
  for (const exp of operatingExpenses) {
    if (exp.currency !== currency || exp.status === 'ANULADO') continue;
    const dateIso = (exp.expenseDate || '').slice(0, 10);
    if (!dateIso || dateIso.length < 10) continue;
    events.push({
      ...blank(dateIso),
      expenseCategory: exp.category,
      expensePaid: exp.status === 'PAGADO' ? round2(exp.amount) : 0,
      expensePending: exp.status === 'PENDIENTE' ? round2(exp.amount) : 0,
    });
  }

  // 4. Investor Transactions
  for (const tx of investorTransactions) {
    if (tx.currency !== currency) continue;
    const dateIso = (tx.transactionDate || '').slice(0, 10);
    if (!dateIso || dateIso.length < 10) continue;
    events.push({
      ...blank(dateIso),
      investorContribution: tx.transactionType === 'APORTE_CAPITAL' ? round2(tx.amount) : 0,
      investorWithdrawal: tx.transactionType === 'RETIRO_CAPITAL' ? round2(tx.amount) : 0,
      investorReturnPaid: tx.transactionType === 'PAGO_RENDIMIENTO' ? round2(tx.amount) : 0,
    });
  }

  return events;
}

function summarizePeriodColumn(params: {
  key: string;
  label: string;
  startDateIso: string | null; // null = inception (for cumulative all-years)
  cutoffDateIso: string;
  events: NormalizedFlowEvent[];
}): FinancialPeriodColumn {
  const { key, label, startDateIso, cutoffDateIso, events } = params;

  const periodEvents = events.filter((e) => {
    if (e.dateIso > cutoffDateIso) return false;
    if (startDateIso && e.dateIso < startDateIso) return false;
    return true;
  });

  const cumulativeEvents = events.filter((e) => e.dateIso <= cutoffDateIso);

  const computeFlows = (list: NormalizedFlowEvent[]) => {
    let interestIncome = 0;
    let lateFeeIncome = 0;
    let chargesIncome = 0;
    let principalRecovered = 0;
    let loansDisbursed = 0;
    let paidOpExWithoutInvestorInterest = 0;
    let pendingOpExWithoutInvestorInterest = 0;
    let expenseInvestorInterestPaid = 0;
    let expenseInvestorInterestPending = 0;
    let investorContribution = 0;
    let investorWithdrawal = 0;
    let investorReturnPaid = 0;
    const byCat = emptyCategoryMap();

    for (const ev of list) {
      interestIncome += ev.interestIncome;
      lateFeeIncome += ev.lateFeeIncome;
      chargesIncome += ev.chargesIncome;
      principalRecovered += ev.principalRecovered;
      loansDisbursed += ev.loansDisbursed;
      investorContribution += ev.investorContribution;
      investorWithdrawal += ev.investorWithdrawal;
      investorReturnPaid += ev.investorReturnPaid;

      const expTotal = ev.expensePaid + ev.expensePending;
      if (ev.expenseCategory && expTotal > 0) {
        byCat[ev.expenseCategory] = round2(byCat[ev.expenseCategory] + expTotal);
        if (ev.expenseCategory === 'INTERESES_INVERSIONISTAS') {
          expenseInvestorInterestPaid += ev.expensePaid;
          expenseInvestorInterestPending += ev.expensePending;
        } else {
          paidOpExWithoutInvestorInterest += ev.expensePaid;
          pendingOpExWithoutInvestorInterest += ev.expensePending;
        }
      }
    }

    const totalRevenue = round2(interestIncome + lateFeeIncome + chargesIncome);
    const operatingExpensesTotal = round2(
      paidOpExWithoutInvestorInterest + pendingOpExWithoutInvestorInterest
    );
    const operatingIncome = round2(totalRevenue - operatingExpensesTotal);
    const investorYieldCost = round2(
      investorReturnPaid + expenseInvestorInterestPaid + expenseInvestorInterestPending
    );
    const netIncome = round2(operatingIncome - investorYieldCost);

    const operatingInflows = totalRevenue;
    const operatingOutflows = round2(paidOpExWithoutInvestorInterest);
    const netOperatingCash = round2(operatingInflows - operatingOutflows);
    const netInvestingCash = round2(principalRecovered - loansDisbursed);
    const totalYieldsPaidCash = round2(investorReturnPaid + expenseInvestorInterestPaid);
    const netFinancingCash = round2(
      investorContribution - investorWithdrawal - totalYieldsPaidCash
    );
    const netCashChange = round2(netOperatingCash + netInvestingCash + netFinancingCash);

    return {
      interestIncome: round2(interestIncome),
      lateFeeIncome: round2(lateFeeIncome),
      chargesIncome: round2(chargesIncome),
      totalRevenue,
      byCat,
      operatingExpensesTotal,
      operatingIncome,
      investorYieldCost,
      netIncome,
      operatingInflows,
      operatingOutflows,
      netOperatingCash,
      principalRecovered: round2(principalRecovered),
      loansDisbursed: round2(loansDisbursed),
      netInvestingCash,
      investorContribution: round2(investorContribution),
      investorWithdrawal: round2(investorWithdrawal),
      totalYieldsPaidCash,
      netFinancingCash,
      netCashChange,
      pendingExpenses: round2(pendingOpExWithoutInvestorInterest + expenseInvestorInterestPending),
    };
  };

  const pFlow = computeFlows(periodEvents);
  const cFlow = computeFlows(cumulativeEvents);

  const cashAndBanks = cFlow.netCashChange;
  const loanPortfolioReceivable = round2(cFlow.loansDisbursed - cFlow.principalRecovered);
  const totalAssets = round2(cashAndBanks + loanPortfolioReceivable);

  const investorCapitalPayable = round2(cFlow.investorContribution - cFlow.investorWithdrawal);
  const accountsPayableExpenses = cFlow.pendingExpenses;
  const totalLiabilities = round2(investorCapitalPayable + accountsPayableExpenses);

  const accumulatedResults = cFlow.netIncome;
  const totalEquity = accumulatedResults;
  const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
  const balanceDiff = round2(totalAssets - totalLiabilitiesAndEquity);

  return {
    key,
    label,
    cutoffDateIso,
    incomeStatement: {
      interestIncome: pFlow.interestIncome,
      lateFeeIncome: pFlow.lateFeeIncome,
      chargesIncome: pFlow.chargesIncome,
      totalRevenue: pFlow.totalRevenue,
      expensesByCategory: pFlow.byCat,
      operatingExpensesTotal: pFlow.operatingExpensesTotal,
      operatingIncome: pFlow.operatingIncome,
      investorYieldCost: pFlow.investorYieldCost,
      netIncome: pFlow.netIncome,
    },
    cashFlow: {
      operatingInflows: pFlow.operatingInflows,
      operatingOutflows: pFlow.operatingOutflows,
      netOperatingCash: pFlow.netOperatingCash,
      principalRecovered: pFlow.principalRecovered,
      loansDisbursed: pFlow.loansDisbursed,
      netInvestingCash: pFlow.netInvestingCash,
      investorContributions: pFlow.investorContribution,
      investorWithdrawals: pFlow.investorWithdrawal,
      investorReturnsPaid: pFlow.totalYieldsPaidCash,
      netFinancingCash: pFlow.netFinancingCash,
      netCashChange: pFlow.netCashChange,
      endingCashBalance: cashAndBanks,
    },
    balanceSheet: {
      cashAndBanks,
      loanPortfolioReceivable,
      totalAssets,
      investorCapitalPayable,
      accountsPayableExpenses,
      totalLiabilities,
      accumulatedResults,
      totalEquity,
      totalLiabilitiesAndEquity,
      balanceDiff,
    },
  };
}

export function computeFinancialStatements(params: {
  currency: CurrencyCode;
  year: number;
  loans: LoanRecord[];
  disbursements: DisbursementRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  payments: PaymentRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
}): FinancialStatementsReport {
  const { currency, year } = params;
  const events = buildNormalizedEvents(params);

  const yearSet = new Set<number>([year]);
  for (const ev of events) {
    const yr = Number(ev.dateIso.slice(0, 4));
    if (Number.isFinite(yr) && yr >= 2000 && yr <= 2100) {
      yearSet.add(yr);
    }
  }
  const availableYears = Array.from(yearSet).sort((a, b) => a - b);

  // 12 monthly columns for selectedYear
  const monthlyColumns: FinancialPeriodColumn[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const lastDay = new Date(year, m, 0).getDate();
    const startDateIso = `${year}-${mm}-01`;
    const cutoffDateIso = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    monthlyColumns.push(
      summarizePeriodColumn({
        key: `${year}-${mm}`,
        label: `${MONTH_LABELS_ES[m - 1]} ${year}`,
        startDateIso,
        cutoffDateIso,
        events,
      })
    );
  }

  const yearTotalColumn = summarizePeriodColumn({
    key: `${year}`,
    label: `Total ${year}`,
    startDateIso: `${year}-01-01`,
    cutoffDateIso: `${year}-12-31`,
    events,
  });

  const annualColumns = availableYears.map((yr) =>
    summarizePeriodColumn({
      key: String(yr),
      label: `Año ${yr}`,
      startDateIso: `${yr}-01-01`,
      cutoffDateIso: `${yr}-12-31`,
      events,
    })
  );

  const maxYear = Math.max(...availableYears, year);
  const cumulativeAllYearsColumn = summarizePeriodColumn({
    key: 'ACUMULADO',
    label: 'Acumulado Total',
    startDateIso: null,
    cutoffDateIso: `${maxYear}-12-31`,
    events,
  });

  return {
    currency,
    selectedYear: year,
    availableYears,
    monthlyColumns,
    yearTotalColumn,
    annualColumns,
    cumulativeAllYearsColumn,
  };
}
