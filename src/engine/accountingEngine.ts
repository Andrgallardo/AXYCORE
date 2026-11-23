import type {
  CollectionReceiptRecord,
  CurrencyCode,
  DisbursementRecord,
  ExpenseCategory,
  InvestorRecord,
  InvestorTransactionRecord,
  LoanInstallmentRecord,
  LoanRecord,
  OperatingExpenseRecord,
  PaymentAllocationRecord,
  PaymentRecord,
} from '../types/axycore';
import type {
  AccountingAccountRecord,
  JournalEntryLine,
  JournalEntryRecord,
} from '../types/dgiiEcf';

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
  key: string; // e.g. '2026-01' or '2026' or 'ACUMULADO'
  label: string;
  cutoffDateIso: string; // YYYY-MM-DD end of period
  // 1. Estado de Resultados (Flujo del período)
  incomeStatement: {
    interestIncome: number;
    lateFeeIncome: number;
    chargesIncome: number;
    otherOperatingIncome: number; // Facturación e-CF / Asientos manuales de ingreso (neto NC)
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
    otherCurrentAssets: number; // CxC e-CF, ITBIS adelantado, otros activos de asientos
    totalAssets: number;
    investorCapitalPayable: number;
    accountsPayableExpenses: number;
    otherLiabilities: number; // ITBIS por pagar, retenciones, otros pasivos de asientos
    totalLiabilities: number;
    paidInCapital: number; // Capital social / aportes patrimoniales (3101)
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
  reconciliationMeta: {
    activeLoansCount: number;
    activePortfolioFromLoans: number;
    balanceSheetPortfolio: number;
    portfolioDiff: number;
    totalCashCollectedFromLoans: number;
    inferredRevenuePaymentsCount: number;
    historicalInstallmentAdjustmentsCount: number;
  };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
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

/**
 * Extracts a YYYY-MM-DD date string from ISO strings, Firestore Timestamps, or Date objects.
 */
export function resolveAccountingIsoDate(...candidates: unknown[]): string | null {
  for (const raw of candidates) {
    if (!raw) continue;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (slashMatch) {
        const [, a, b, y] = slashMatch;
        const n1 = Number(a);
        const n2 = Number(b);
        const month = n1 > 12 ? n2 : n1;
        const day = n1 > 12 ? n1 : n2;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString().slice(0, 10);
      }
    } else if (raw instanceof Date && Number.isFinite(raw.getTime())) {
      return raw.toISOString().slice(0, 10);
    } else if (typeof raw === 'object') {
      const obj = raw as { toDate?: () => Date; seconds?: number; _seconds?: number };
      if (typeof obj.toDate === 'function') {
        const d = obj.toDate();
        if (d instanceof Date && Number.isFinite(d.getTime())) {
          return d.toISOString().slice(0, 10);
        }
      }
      const sec = typeof obj.seconds === 'number' ? obj.seconds : obj._seconds;
      if (typeof sec === 'number' && Number.isFinite(sec)) {
        return new Date(sec * 1000).toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

interface NormalizedFlowEvent {
  id: string;
  dateIso: string; // YYYY-MM-DD
  kind:
    | 'LOAN_DISBURSEMENT'
    | 'LOAN_PAYMENT'
    | 'OPERATING_EXPENSE'
    | 'INVESTOR_TX'
    | 'JOURNAL_ADJUSTMENT';
  referenceDoc?: string;
  description?: string;
  interestIncome: number;
  lateFeeIncome: number;
  chargesIncome: number;
  otherOperatingIncome: number;
  principalRecovered: number;
  loansDisbursed: number;
  expenseCategory?: ExpenseCategory;
  expensePaid: number;
  expensePending: number;
  investorContribution: number;
  investorWithdrawal: number;
  investorReturnPaid: number;
  // Additional balance-sheet / cash impacts from persisted journal entries (e-CF & Manual)
  journalCashDelta: number;
  journalOtherAssetsDelta: number;
  journalOtherLiabilitiesDelta: number;
  journalPaidInCapitalDelta: number;
  journalPortfolioDelta: number;
  journalInvestorPayableDelta: number;
  journalApExpensesDelta: number;
}

interface NormalizedEventsOutput {
  events: NormalizedFlowEvent[];
  inferredRevenuePaymentsCount: number;
  historicalInstallmentAdjustmentsCount: number;
}

function getEffectiveInstallmentPaid(inst: LoanInstallmentRecord): {
  paidPrincipal: number;
  paidInterest: number;
  paidLateFee: number;
  paidCharges: number;
} {
  const explicitP = Math.max(0, round2(Number(inst.paidPrincipal || 0)));
  const explicitI = Math.max(0, round2(Number(inst.paidInterest || 0)));
  const explicitL = Math.max(0, round2(Number(inst.paidLateFee || 0)));
  const explicitC = Math.max(0, round2(Number(inst.paidOtherCharges || 0)));

  if (inst.status === 'PAGADA' && explicitP === 0 && explicitI === 0) {
    return {
      paidPrincipal: Math.max(0, round2(Number(inst.principalAmount || 0))),
      paidInterest: Math.max(0, round2(Number(inst.interestAmount || 0))),
      paidLateFee: explicitL,
      paidCharges: Math.max(explicitC, round2(Number(inst.otherCharges || 0))),
    };
  }
  return {
    paidPrincipal: explicitP,
    paidInterest: explicitI,
    paidLateFee: explicitL,
    paidCharges: explicitC,
  };
}

function mapJournalExpenseAccountToCategory(code: string): ExpenseCategory {
  if (code.startsWith('5102')) return 'NOMINA';
  if (code.startsWith('5103')) return 'TECNOLOGIA';
  if (code.startsWith('5109')) return 'INTERESES_INVERSIONISTAS';
  return 'OTROS';
}

function buildNormalizedEvents(params: {
  currency: CurrencyCode;
  loans: LoanRecord[];
  loanInstallments?: LoanInstallmentRecord[];
  disbursements: DisbursementRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  payments: PaymentRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
  journalEntries?: JournalEntryRecord[];
}): NormalizedEventsOutput {
  const {
    currency,
    loans,
    loanInstallments = [],
    disbursements,
    collectionReceipts,
    payments,
    paymentAllocations = [],
    operatingExpenses,
    investorTransactions,
    journalEntries = [],
  } = params;

  const events: NormalizedFlowEvent[] = [];
  let inferredRevenuePaymentsCount = 0;
  let historicalInstallmentAdjustmentsCount = 0;
  let seq = 0;

  const blank = (
    dateIso: string,
    kind: NormalizedFlowEvent['kind'],
    meta?: { id?: string; referenceDoc?: string; description?: string }
  ): NormalizedFlowEvent => ({
    id: meta?.id || `ev_${kind.toLowerCase()}_${++seq}`,
    dateIso,
    kind,
    referenceDoc: meta?.referenceDoc,
    description: meta?.description,
    interestIncome: 0,
    lateFeeIncome: 0,
    chargesIncome: 0,
    otherOperatingIncome: 0,
    principalRecovered: 0,
    loansDisbursed: 0,
    expensePaid: 0,
    expensePending: 0,
    investorContribution: 0,
    investorWithdrawal: 0,
    investorReturnPaid: 0,
    journalCashDelta: 0,
    journalOtherAssetsDelta: 0,
    journalOtherLiabilitiesDelta: 0,
    journalPaidInCapitalDelta: 0,
    journalPortfolioDelta: 0,
    journalInvestorPayableDelta: 0,
    journalApExpensesDelta: 0,
  });

  // Index disbursements, receipts, allocations, payments, and installments by loanId
  const disbByLoanId = new Map<string, DisbursementRecord>();
  for (const d of disbursements) {
    if (d.status === 'CONFIRMADO') {
      disbByLoanId.set(d.loanId, d);
    }
  }

  const validReceipts = collectionReceipts.filter(
    (r) => r.currency === currency && r.status === 'EMITIDO'
  );
  const receiptsByLoanId = new Map<string, CollectionReceiptRecord[]>();
  const receiptPaymentIds = new Set<string>();
  for (const rec of validReceipts) {
    receiptPaymentIds.add(rec.paymentId);
    const list = receiptsByLoanId.get(rec.loanId) || [];
    list.push(rec);
    receiptsByLoanId.set(rec.loanId, list);
  }

  const activeAllocationsByPaymentId = new Map<string, PaymentAllocationRecord[]>();
  for (const alloc of paymentAllocations) {
    if (alloc.reversed) continue;
    if (alloc.currency && alloc.currency !== currency) continue;
    const list = activeAllocationsByPaymentId.get(alloc.paymentId) || [];
    list.push(alloc);
    activeAllocationsByPaymentId.set(alloc.paymentId, list);
  }

  const appliedPaymentsByLoanId = new Map<string, PaymentRecord[]>();
  const currencyAppliedPayments: PaymentRecord[] = [];
  for (const pay of payments) {
    if (pay.currency !== currency || pay.status !== 'APLICADO') continue;
    currencyAppliedPayments.push(pay);
    const list = appliedPaymentsByLoanId.get(pay.loanId) || [];
    list.push(pay);
    appliedPaymentsByLoanId.set(pay.loanId, list);
  }

  const installmentsByLoanId = new Map<string, LoanInstallmentRecord[]>();
  for (const inst of loanInstallments) {
    const list = installmentsByLoanId.get(inst.loanId) || [];
    list.push(inst);
    installmentsByLoanId.set(inst.loanId, list);
  }

  const currencyLoanIds = new Set<string>();

  // 1 & 2. Reconcile every loan in this currency (disbursements + receipts + payments + installments)
  for (const loan of loans) {
    if (loan.currency !== currency) continue;
    currencyLoanIds.add(loan.id);

    const loanReceipts = receiptsByLoanId.get(loan.id) || [];
    const loanPayments = appliedPaymentsByLoanId.get(loan.id) || [];
    const loanInsts = (installmentsByLoanId.get(loan.id) || []).sort(
      (a, b) => a.installmentNumber - b.installmentNumber
    );

    const disb = disbByLoanId.get(loan.id);
    const disbDate =
      resolveAccountingIsoDate(
        disb?.disbursementDate,
        loan.disbursementDate,
        loanInsts[0]?.dueDate,
        loan.firstPaymentDate,
        loan.createdAt
      ) || new Date().toISOString().slice(0, 10);

    const disbursedPrincipal = round2(
      disb?.totalFinanced ?? loan.totalFinancedPrincipal ?? loan.approvedPrincipal ?? 0
    );

    // Paid installments aggregate evidence
    let instPaidPrincipalTotal = 0;
    let instPaidInterestTotal = 0;
    let instPaidLateFeeTotal = 0;
    let instPaidChargesTotal = 0;
    let schedPrincipalTotal = 0;
    let schedInterestTotal = 0;
    const paidInstallmentEntries: Array<{
      dateIso: string;
      instNumber: number;
      principal: number;
      interest: number;
      lateFee: number;
      charges: number;
    }> = [];

    for (const inst of loanInsts) {
      schedPrincipalTotal = round2(schedPrincipalTotal + Math.max(0, Number(inst.principalAmount || 0)));
      schedInterestTotal = round2(schedInterestTotal + Math.max(0, Number(inst.interestAmount || 0)));
      const eff = getEffectiveInstallmentPaid(inst);
      if (eff.paidPrincipal > 0 || eff.paidInterest > 0 || eff.paidLateFee > 0 || eff.paidCharges > 0) {
        instPaidPrincipalTotal = round2(instPaidPrincipalTotal + eff.paidPrincipal);
        instPaidInterestTotal = round2(instPaidInterestTotal + eff.paidInterest);
        instPaidLateFeeTotal = round2(instPaidLateFeeTotal + eff.paidLateFee);
        instPaidChargesTotal = round2(instPaidChargesTotal + eff.paidCharges);
        const instDate = resolveAccountingIsoDate(inst.paidAt, inst.dueDate, disbDate) || disbDate;
        paidInstallmentEntries.push({
          dateIso: instDate,
          instNumber: inst.installmentNumber,
          principal: eff.paidPrincipal,
          interest: eff.paidInterest,
          lateFee: eff.paidLateFee,
          charges: eff.paidCharges,
        });
      }
    }

    // Skip truly voided CANCELADO loans (zero payments, zero receipts, zero paid installments/totals)
    const isVoidedCancelled =
      loan.status === 'CANCELADO' &&
      loanReceipts.length === 0 &&
      loanPayments.length === 0 &&
      paidInstallmentEntries.length === 0 &&
      Number(loan.paidPrincipalTotal || 0) === 0 &&
      Number(loan.paidInterestTotal || 0) === 0;
    if (isVoidedCancelled) continue;

    if (disbursedPrincipal > 0) {
      events.push({
        ...blank(disbDate, 'LOAN_DISBURSEMENT', {
          id: `disb_${loan.id}`,
          referenceDoc: loan.loanNumber,
          description: `Desembolso préstamo ${loan.loanNumber} · ${loan.applicantDisplayName}`,
        }),
        loansDisbursed: disbursedPrincipal,
      });
    }

    // Track already-accounted principal & revenue for this loan
    let accountedPrincipal = 0;
    let accountedInterest = 0;
    let accountedLateFee = 0;
    let accountedCharges = 0;

    // Tier 1A: Official CollectionReceipts
    for (const rec of loanReceipts) {
      const dateIso = resolveAccountingIsoDate(rec.paymentDate, rec.issuedAt, disbDate) || disbDate;
      const p = round2(rec.appliedToPrincipal || 0);
      const i = round2(rec.appliedToInterest || 0);
      const l = round2(rec.appliedToLateFee || 0);
      const c = round2(rec.appliedToCharges || 0);
      accountedPrincipal = round2(accountedPrincipal + p);
      accountedInterest = round2(accountedInterest + i);
      accountedLateFee = round2(accountedLateFee + l);
      accountedCharges = round2(accountedCharges + c);
      events.push({
        ...blank(dateIso, 'LOAN_PAYMENT', {
          id: `rec_${rec.id}`,
          referenceDoc: rec.receiptNumber || loan.loanNumber,
          description: `Cobro préstamo ${loan.loanNumber} · ${loan.applicantDisplayName} (${rec.receiptNumber})`,
        }),
        principalRecovered: p,
        interestIncome: i,
        lateFeeIncome: l,
        chargesIncome: c,
      });
    }

    // Tier 1B & 1C: Applied payments without receipts
    const unbrokenPayments: PaymentRecord[] = [];
    for (const pay of loanPayments) {
      if (receiptPaymentIds.has(pay.id)) continue;
      const dateIso =
        resolveAccountingIsoDate(pay.paymentDate, pay.appliedDate, pay.appliedAt, pay.createdAt, disbDate) ||
        disbDate;

      const allocs = activeAllocationsByPaymentId.get(pay.id) || [];
      if (allocs.length > 0) {
        const p = round2(allocs.reduce((s, a) => s + (a.appliedToPrincipal || 0), 0));
        const i = round2(allocs.reduce((s, a) => s + (a.appliedToInterest || 0), 0));
        const l = round2(allocs.reduce((s, a) => s + (a.appliedToLateFee || 0), 0));
        const c = round2(allocs.reduce((s, a) => s + (a.appliedToCharges || 0), 0));
        accountedPrincipal = round2(accountedPrincipal + p);
        accountedInterest = round2(accountedInterest + i);
        accountedLateFee = round2(accountedLateFee + l);
        accountedCharges = round2(accountedCharges + c);
        events.push({
          ...blank(dateIso, 'LOAN_PAYMENT', {
            id: `pay_${pay.id}`,
            referenceDoc: pay.referenceNumber || loan.loanNumber,
            description: `Cobro préstamo ${loan.loanNumber} · ${loan.applicantDisplayName}`,
          }),
          principalRecovered: p,
          interestIncome: i,
          lateFeeIncome: l,
          chargesIncome: c,
        });
        continue;
      }

      const bd = pay.appliedBreakdown;
      const bdP = Math.max(0, round2(Number(bd?.principal || 0)));
      const bdI = Math.max(0, round2(Number(bd?.interest || 0)));
      const bdL = Math.max(0, round2(Number(bd?.lateFee || 0)));
      const bdC = Math.max(0, round2(Number(bd?.otherCharges || 0)));
      const hasExplicitRevenueSplit = bdI > 0 || bdL > 0 || bdC > 0;

      if (hasExplicitRevenueSplit) {
        // Ensure components sum cleanly to pay.amount
        const bdSum = round2(bdP + bdI + bdL + bdC);
        let p = bdP;
        let i = bdI;
        let l = bdL;
        let c = bdC;
        if (bdSum > 0 && Math.abs(bdSum - pay.amount) > 0.02) {
          const factor = pay.amount / bdSum;
          i = round2(bdI * factor);
          l = round2(bdL * factor);
          c = round2(bdC * factor);
          p = Math.max(0, round2(pay.amount - i - l - c));
        }
        accountedPrincipal = round2(accountedPrincipal + p);
        accountedInterest = round2(accountedInterest + i);
        accountedLateFee = round2(accountedLateFee + l);
        accountedCharges = round2(accountedCharges + c);
        events.push({
          ...blank(dateIso, 'LOAN_PAYMENT', {
            id: `pay_${pay.id}`,
            referenceDoc: pay.referenceNumber || loan.loanNumber,
            description: `Cobro préstamo ${loan.loanNumber} · ${loan.applicantDisplayName}`,
          }),
          principalRecovered: p,
          interestIncome: i,
          lateFeeIncome: l,
          chargesIncome: c,
        });
      } else {
        // Payment has NO revenue breakdown (e.g., migrated AppSheet payment defaulted to 100% principal)
        unbrokenPayments.push(pay);
      }
    }

    // Authoritative expected principal recovered from loan balance
    const isClosedLoan =
      loan.status === 'PAGADO' ||
      loan.status === 'CANCELADO' ||
      loan.status === 'CANCELADO_POR_RENOVACION';
    const currentBalance = isClosedLoan
      ? 0
      : Math.max(0, round2(Number(loan.currentPrincipalBalance || 0)));
    const expectedPrincipalRecovered = isClosedLoan
      ? disbursedPrincipal
      : Math.max(0, round2(disbursedPrincipal - currentBalance));

    const expectedPaidInterest = Math.max(
      instPaidInterestTotal,
      Math.max(0, round2(Number(loan.paidInterestTotal || 0)))
    );
    const expectedPaidLateFee = Math.max(
      instPaidLateFeeTotal,
      Math.max(0, round2(Number(loan.paidLateFeeTotal || 0)))
    );

    const loanHasInterestTerms =
      Number(loan.contractualRateMonthly || 0) > 0 ||
      Number(loan.totalContractualInterest || 0) > 0 ||
      schedInterestTotal > 0 ||
      expectedPaidInterest > 0;

    // Tier 2: Reconcile unbroken payments (those without explicit interest/principal breakdown)
    if (unbrokenPayments.length > 0) {
      unbrokenPayments.sort((a, b) =>
        (resolveAccountingIsoDate(a.paymentDate, a.appliedDate) || '').localeCompare(
          resolveAccountingIsoDate(b.paymentDate, b.appliedDate) || ''
        )
      );
      const sumUnbroken = round2(unbrokenPayments.reduce((s, p) => s + round2(p.amount), 0));
      const remainingPrincipalNeeded = Math.max(
        0,
        round2(expectedPrincipalRecovered - accountedPrincipal)
      );

      let targetPrincipal = sumUnbroken;
      let targetInterest = 0;
      let targetLateFee = 0;
      let targetCharges = 0;

      if (loanHasInterestTerms && sumUnbroken > 0) {
        if (sumUnbroken > remainingPrincipalNeeded + 0.005) {
          // Exact balance tie-out: principal equals exact reduction in loan balance,
          // remainder is earned interest / late fees / charges!
          targetPrincipal = remainingPrincipalNeeded;
          const totalRev = round2(sumUnbroken - targetPrincipal);
          const remLate = Math.max(0, round2(expectedPaidLateFee - accountedLateFee));
          const remCharges = Math.max(0, round2(instPaidChargesTotal - accountedCharges));
          targetLateFee = Math.min(totalRev, remLate);
          targetCharges = Math.min(round2(totalRev - targetLateFee), remCharges);
          targetInterest = round2(totalRev - targetLateFee - targetCharges);
          inferredRevenuePaymentsCount += unbrokenPayments.length;
        } else {
          // Payments total <= remaining principal delta: check if installment/loan data gives a real interest ratio
          let interestShare = 0;
          if (instPaidInterestTotal > 0 && instPaidPrincipalTotal + instPaidInterestTotal > 0) {
            interestShare =
              instPaidInterestTotal / (instPaidPrincipalTotal + instPaidInterestTotal);
          } else if (
            Number(loan.paidInterestTotal || 0) > 0 &&
            Number(loan.paidPrincipalTotal || 0) + Number(loan.paidInterestTotal || 0) > 0
          ) {
            interestShare =
              Number(loan.paidInterestTotal || 0) /
              (Number(loan.paidPrincipalTotal || 0) + Number(loan.paidInterestTotal || 0));
          } else if (schedInterestTotal > 0 && schedPrincipalTotal + schedInterestTotal > 0) {
            interestShare = schedInterestTotal / (schedPrincipalTotal + schedInterestTotal);
          } else if (
            Number(loan.totalContractualInterest || 0) > 0 &&
            Number(loan.totalContractualPayable || 0) > 0
          ) {
            interestShare =
              Number(loan.totalContractualInterest || 0) /
              Number(loan.totalContractualPayable || 0);
          }

          if (interestShare > 0 && interestShare < 1) {
            targetInterest = round2(sumUnbroken * interestShare);
            targetPrincipal = round2(sumUnbroken - targetInterest);
            inferredRevenuePaymentsCount += unbrokenPayments.length;
          }
        }
      }

      // Distribute targets proportionally across each payment date (cent-accurate on last payment)
      let remP = targetPrincipal;
      let remI = targetInterest;
      let remL = targetLateFee;
      let remC = targetCharges;

      unbrokenPayments.forEach((pay, idx) => {
        const isLast = idx === unbrokenPayments.length - 1;
        const weight = sumUnbroken > 0 ? round2(pay.amount) / sumUnbroken : 0;
        const p = isLast ? round2(remP) : round2(targetPrincipal * weight);
        const i = isLast ? round2(remI) : round2(targetInterest * weight);
        const l = isLast ? round2(remL) : round2(targetLateFee * weight);
        const c = isLast ? round2(remC) : round2(targetCharges * weight);
        remP = round2(remP - p);
        remI = round2(remI - i);
        remL = round2(remL - l);
        remC = round2(remC - c);

        accountedPrincipal = round2(accountedPrincipal + p);
        accountedInterest = round2(accountedInterest + i);
        accountedLateFee = round2(accountedLateFee + l);
        accountedCharges = round2(accountedCharges + c);

        const dateIso =
          resolveAccountingIsoDate(
            pay.paymentDate,
            pay.appliedDate,
            pay.appliedAt,
            pay.createdAt,
            disbDate
          ) || disbDate;

        events.push({
          ...blank(dateIso, 'LOAN_PAYMENT', {
            id: `pay_${pay.id}`,
            referenceDoc: pay.referenceNumber || loan.loanNumber,
            description: `Cobro préstamo ${loan.loanNumber} · ${loan.applicantDisplayName}`,
          }),
          principalRecovered: p,
          interestIncome: i,
          lateFeeIncome: l,
          chargesIncome: c,
        });
      });
    }

    // Tier 3: Reconcile historical paid installments / reduced loan balance missing from payments table
    const missingPrincipal = round2(expectedPrincipalRecovered - accountedPrincipal);
    const missingInterest = round2(expectedPaidInterest - accountedInterest);
    const missingLateFee = round2(expectedPaidLateFee - accountedLateFee);
    const missingCharges = round2(instPaidChargesTotal - accountedCharges);

    const hasMissingPrincipal = missingPrincipal > 0.01;
    const hasMissingInterest = missingInterest > 0.01;
    const hasMissingLateFee = missingLateFee > 0.01;
    const hasMissingCharges = missingCharges > 0.01;

    if (hasMissingPrincipal || hasMissingInterest || hasMissingLateFee || hasMissingCharges) {
      const addP = hasMissingPrincipal ? missingPrincipal : 0;
      const addI = hasMissingInterest ? missingInterest : 0;
      const addL = hasMissingLateFee ? missingLateFee : 0;
      const addC = hasMissingCharges ? missingCharges : 0;

      if (paidInstallmentEntries.length > 0) {
        const sumInstP = paidInstallmentEntries.reduce((s, e) => s + e.principal, 0);
        const sumInstI = paidInstallmentEntries.reduce((s, e) => s + e.interest, 0);
        const sumInstL = paidInstallmentEntries.reduce((s, e) => s + e.lateFee, 0);
        const sumInstC = paidInstallmentEntries.reduce((s, e) => s + e.charges, 0);
        const count = paidInstallmentEntries.length;

        let remP = addP;
        let remI = addI;
        let remL = addL;
        let remC = addC;

        paidInstallmentEntries.forEach((entry, idx) => {
          const isLast = idx === count - 1;
          const p = isLast
            ? round2(remP)
            : round2(addP * (sumInstP > 0 ? entry.principal / sumInstP : 1 / count));
          const i = isLast
            ? round2(remI)
            : round2(addI * (sumInstI > 0 ? entry.interest / sumInstI : 1 / count));
          const l = isLast
            ? round2(remL)
            : round2(addL * (sumInstL > 0 ? entry.lateFee / sumInstL : 1 / count));
          const c = isLast
            ? round2(remC)
            : round2(addC * (sumInstC > 0 ? entry.charges / sumInstC : 1 / count));
          remP = round2(remP - p);
          remI = round2(remI - i);
          remL = round2(remL - l);
          remC = round2(remC - c);

          if (p > 0 || i > 0 || l > 0 || c > 0) {
            historicalInstallmentAdjustmentsCount++;
            events.push({
              ...blank(entry.dateIso, 'LOAN_PAYMENT', {
                id: `inst_rec_${loan.id}_${entry.instNumber}`,
                referenceDoc: `${loan.loanNumber}-C${entry.instNumber}`,
                description: `Cobro cuota #${entry.instNumber} · ${loan.loanNumber} (${loan.applicantDisplayName})`,
              }),
              principalRecovered: p,
              interestIncome: i,
              lateFeeIncome: l,
              chargesIncome: c,
            });
          }
        });
      } else {
        const fallbackDate =
          resolveAccountingIsoDate(
            loan.closedAt,
            loan.firstPaymentDate,
            loan.disbursementDate,
            disbDate
          ) || disbDate;
        historicalInstallmentAdjustmentsCount++;
        events.push({
          ...blank(fallbackDate, 'LOAN_PAYMENT', {
            id: `hist_rec_${loan.id}`,
            referenceDoc: loan.loanNumber,
            description: `Conciliación histórica de cobros · ${loan.loanNumber} (${loan.applicantDisplayName})`,
          }),
          principalRecovered: addP,
          interestIncome: addI,
          lateFeeIncome: addL,
          chargesIncome: addC,
        });
      }
    }
  }

  // Handle orphan receipts/payments whose loanId is not present in `loans`
  for (const rec of validReceipts) {
    if (currencyLoanIds.has(rec.loanId)) continue;
    const dateIso = resolveAccountingIsoDate(rec.paymentDate, rec.issuedAt);
    if (!dateIso) continue;
    events.push({
      ...blank(dateIso, 'LOAN_PAYMENT', {
        id: `rec_orphan_${rec.id}`,
        referenceDoc: rec.receiptNumber || rec.loanNumber,
        description: `Cobro ${rec.loanNumber} · ${rec.customerName}`,
      }),
      interestIncome: round2(rec.appliedToInterest || 0),
      lateFeeIncome: round2(rec.appliedToLateFee || 0),
      chargesIncome: round2(rec.appliedToCharges || 0),
      principalRecovered: round2(rec.appliedToPrincipal || 0),
    });
  }

  for (const pay of currencyAppliedPayments) {
    if (currencyLoanIds.has(pay.loanId) || receiptPaymentIds.has(pay.id)) continue;
    const dateIso = resolveAccountingIsoDate(pay.paymentDate, pay.appliedDate, pay.appliedAt, pay.createdAt);
    if (!dateIso) continue;
    const allocs = activeAllocationsByPaymentId.get(pay.id) || [];
    if (allocs.length > 0) {
      events.push({
        ...blank(dateIso, 'LOAN_PAYMENT', {
          id: `pay_orphan_${pay.id}`,
          referenceDoc: pay.referenceNumber || pay.loanNumber,
          description: `Cobro ${pay.loanNumber} · ${pay.customerName}`,
        }),
        interestIncome: round2(allocs.reduce((s, a) => s + (a.appliedToInterest || 0), 0)),
        lateFeeIncome: round2(allocs.reduce((s, a) => s + (a.appliedToLateFee || 0), 0)),
        chargesIncome: round2(allocs.reduce((s, a) => s + (a.appliedToCharges || 0), 0)),
        principalRecovered: round2(allocs.reduce((s, a) => s + (a.appliedToPrincipal || 0), 0)),
      });
    } else if (pay.appliedBreakdown) {
      events.push({
        ...blank(dateIso, 'LOAN_PAYMENT', {
          id: `pay_orphan_${pay.id}`,
          referenceDoc: pay.referenceNumber || pay.loanNumber,
          description: `Cobro ${pay.loanNumber} · ${pay.customerName}`,
        }),
        interestIncome: round2(pay.appliedBreakdown.interest || 0),
        lateFeeIncome: round2(pay.appliedBreakdown.lateFee || 0),
        chargesIncome: round2(pay.appliedBreakdown.otherCharges || 0),
        principalRecovered: round2(pay.appliedBreakdown.principal || 0),
      });
    } else {
      events.push({
        ...blank(dateIso, 'LOAN_PAYMENT', {
          id: `pay_orphan_${pay.id}`,
          referenceDoc: pay.referenceNumber || pay.loanNumber,
          description: `Cobro ${pay.loanNumber} · ${pay.customerName}`,
        }),
        principalRecovered: round2(pay.amount),
      });
    }
  }

  // 3. Operating Expenses
  for (const exp of operatingExpenses) {
    if (exp.currency !== currency || exp.status === 'ANULADO') continue;
    const dateIso = resolveAccountingIsoDate(exp.expenseDate, exp.createdAt);
    if (!dateIso) continue;
    events.push({
      ...blank(dateIso, 'OPERATING_EXPENSE', {
        id: `exp_${exp.id}`,
        referenceDoc: exp.expenseNumber,
        description: `${EXPENSE_CATEGORY_LABELS[exp.category] || exp.category}: ${exp.concept} (${exp.vendorName})`,
      }),
      expenseCategory: exp.category,
      expensePaid: exp.status === 'PAGADO' ? round2(exp.amount) : 0,
      expensePending: exp.status === 'PENDIENTE' ? round2(exp.amount) : 0,
    });
  }

  // 4. Investor Transactions
  for (const tx of investorTransactions) {
    if (tx.currency !== currency) continue;
    const dateIso = resolveAccountingIsoDate(tx.transactionDate, tx.createdAt);
    if (!dateIso) continue;
    events.push({
      ...blank(dateIso, 'INVESTOR_TX', {
        id: `invtx_${tx.id}`,
        referenceDoc: tx.referenceNumber || tx.investorName,
        description: `${INVESTOR_TX_LABELS[tx.transactionType]} · ${tx.investorName}`,
      }),
      investorContribution: tx.transactionType === 'APORTE_CAPITAL' ? round2(tx.amount) : 0,
      investorWithdrawal: tx.transactionType === 'RETIRO_CAPITAL' ? round2(tx.amount) : 0,
      investorReturnPaid: tx.transactionType === 'PAGO_RENDIMIENTO' ? round2(tx.amount) : 0,
    });
  }

  // 5. Persisted Journal Entries from Facturación e-CF & Asientos Manuales
  // (Operational sourceTypes are excluded here to prevent double counting with sections 1–4)
  const operationalSourceTypes = new Set(['DESEMBOLSO', 'PAGO_PRESTAMO', 'GASTO_OPERATIVO']);
  for (const je of journalEntries) {
    if (je.currency !== currency) continue;
    if (operationalSourceTypes.has(je.sourceType)) continue;
    const dateIso = resolveAccountingIsoDate(je.entryDate, je.createdAt);
    if (!dateIso) continue;

    // Emit one balanced event per journal entry (both original REVERTIDO and its REVERSO cancel out cleanly)
    const ev = blank(dateIso, 'JOURNAL_ADJUSTMENT', {
      id: `je_${je.id}`,
      referenceDoc: je.referenceDoc || je.entryNumber,
      description: je.description,
    });

    const expenseByCat = emptyCategoryMap();
    let hasIncomeOrExpense = false;
    let totalJournalExpense = 0;

    for (const line of je.lines) {
      const code = (line.accountCode || '').trim();
      const debit = round2(Number(line.debit || 0));
      const credit = round2(Number(line.credit || 0));
      const netDebit = round2(debit - credit);
      const netCredit = round2(credit - debit);

      if (code.startsWith('1101') || code.startsWith('1102')) {
        ev.journalCashDelta = round2(ev.journalCashDelta + netDebit);
      } else if (code.startsWith('1201')) {
        ev.journalPortfolioDelta = round2(ev.journalPortfolioDelta + netDebit);
      } else if (code.startsWith('1')) {
        ev.journalOtherAssetsDelta = round2(ev.journalOtherAssetsDelta + netDebit);
      } else if (code.startsWith('2102')) {
        ev.journalInvestorPayableDelta = round2(ev.journalInvestorPayableDelta + netCredit);
      } else if (code.startsWith('2101')) {
        ev.journalApExpensesDelta = round2(ev.journalApExpensesDelta + netCredit);
      } else if (code.startsWith('2')) {
        ev.journalOtherLiabilitiesDelta = round2(ev.journalOtherLiabilitiesDelta + netCredit);
      } else if (code.startsWith('3')) {
        ev.journalPaidInCapitalDelta = round2(ev.journalPaidInCapitalDelta + netCredit);
      } else if (code.startsWith('4102')) {
        ev.interestIncome = round2(ev.interestIncome + netCredit);
        hasIncomeOrExpense = true;
      } else if (code.startsWith('4')) {
        ev.otherOperatingIncome = round2(ev.otherOperatingIncome + netCredit);
        hasIncomeOrExpense = true;
      } else if (code.startsWith('5') || code.startsWith('6')) {
        const cat = mapJournalExpenseAccountToCategory(code);
        expenseByCat[cat] = round2(expenseByCat[cat] + netDebit);
        totalJournalExpense = round2(totalJournalExpense + netDebit);
        hasIncomeOrExpense = true;
      }
    }

    // If a journal entry touched multiple expense categories, attach separate lightweight category events
    // while keeping balance sheet deltas on the primary event so Σ Assets === Σ Liabilities + Equity.
    if (totalJournalExpense !== 0) {
      const nonZeroCats = (Object.entries(expenseByCat) as Array<[ExpenseCategory, number]>).filter(
        ([, val]) => Math.abs(val) > 0.001
      );
      if (nonZeroCats.length === 1) {
        ev.expenseCategory = nonZeroCats[0][0];
        ev.expensePending = nonZeroCats[0][1];
        // Note: journal balance sheet liability/cash side was ALREADY captured in journal*Delta above,
        // so we neutralize expensePending from balanceSheet AP inside summarizePeriodColumn via journalApExpensesDelta offset!
        ev.journalApExpensesDelta = round2(ev.journalApExpensesDelta - nonZeroCats[0][1]);
      } else {
        for (const [cat, val] of nonZeroCats) {
          events.push({
            ...blank(dateIso, 'JOURNAL_ADJUSTMENT', {
              id: `je_${je.id}_cat_${cat}`,
              referenceDoc: je.referenceDoc || je.entryNumber,
              description: je.description,
            }),
            expenseCategory: cat,
            expensePending: val,
            journalApExpensesDelta: round2(-val),
          });
        }
      }
    }

    if (
      hasIncomeOrExpense ||
      ev.journalCashDelta !== 0 ||
      ev.journalOtherAssetsDelta !== 0 ||
      ev.journalOtherLiabilitiesDelta !== 0 ||
      ev.journalPaidInCapitalDelta !== 0 ||
      ev.journalPortfolioDelta !== 0 ||
      ev.journalInvestorPayableDelta !== 0 ||
      ev.journalApExpensesDelta !== 0
    ) {
      events.push(ev);
    }
  }

  return {
    events,
    inferredRevenuePaymentsCount,
    historicalInstallmentAdjustmentsCount,
  };
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
    let otherOperatingIncome = 0;
    let principalRecovered = 0;
    let loansDisbursed = 0;
    let paidOpExWithoutInvestorInterest = 0;
    let pendingOpExWithoutInvestorInterest = 0;
    let expenseInvestorInterestPaid = 0;
    let expenseInvestorInterestPending = 0;
    let investorContribution = 0;
    let investorWithdrawal = 0;
    let investorReturnPaid = 0;

    let journalCashDelta = 0;
    let journalOtherAssetsDelta = 0;
    let journalOtherLiabilitiesDelta = 0;
    let journalPaidInCapitalDelta = 0;
    let journalPortfolioDelta = 0;
    let journalInvestorPayableDelta = 0;
    let journalApExpensesDelta = 0;
    let operationalRevenueCash = 0;

    const byCat = emptyCategoryMap();

    for (const ev of list) {
      interestIncome += ev.interestIncome;
      lateFeeIncome += ev.lateFeeIncome;
      chargesIncome += ev.chargesIncome;
      otherOperatingIncome += ev.otherOperatingIncome;
      principalRecovered += ev.principalRecovered;
      loansDisbursed += ev.loansDisbursed;
      investorContribution += ev.investorContribution;
      investorWithdrawal += ev.investorWithdrawal;
      investorReturnPaid += ev.investorReturnPaid;

      if (ev.kind !== 'JOURNAL_ADJUSTMENT') {
        operationalRevenueCash += ev.interestIncome + ev.lateFeeIncome + ev.chargesIncome;
      }

      journalCashDelta += ev.journalCashDelta;
      journalOtherAssetsDelta += ev.journalOtherAssetsDelta;
      journalOtherLiabilitiesDelta += ev.journalOtherLiabilitiesDelta;
      journalPaidInCapitalDelta += ev.journalPaidInCapitalDelta;
      journalPortfolioDelta += ev.journalPortfolioDelta;
      journalInvestorPayableDelta += ev.journalInvestorPayableDelta;
      journalApExpensesDelta += ev.journalApExpensesDelta;

      const expTotal = ev.expensePaid + ev.expensePending;
      if (ev.expenseCategory && Math.abs(expTotal) > 0.0001) {
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

    const totalRevenue = round2(
      interestIncome + lateFeeIncome + chargesIncome + otherOperatingIncome
    );
    const operatingExpensesTotal = round2(
      paidOpExWithoutInvestorInterest + pendingOpExWithoutInvestorInterest
    );
    const operatingIncome = round2(totalRevenue - operatingExpensesTotal);
    const investorYieldCost = round2(
      investorReturnPaid + expenseInvestorInterestPaid + expenseInvestorInterestPending
    );
    const netIncome = round2(operatingIncome - investorYieldCost);

    const operatingInflows = round2(
      operationalRevenueCash + (journalCashDelta > 0 ? journalCashDelta : 0)
    );
    const operatingOutflows = round2(
      paidOpExWithoutInvestorInterest + (journalCashDelta < 0 ? Math.abs(journalCashDelta) : 0)
    );
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
      otherOperatingIncome: round2(otherOperatingIncome),
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
      pendingExpenses: round2(
        pendingOpExWithoutInvestorInterest +
          expenseInvestorInterestPending +
          journalApExpensesDelta
      ),
      journalOtherAssetsDelta: round2(journalOtherAssetsDelta),
      journalOtherLiabilitiesDelta: round2(journalOtherLiabilitiesDelta),
      journalPaidInCapitalDelta: round2(journalPaidInCapitalDelta),
      journalPortfolioDelta: round2(journalPortfolioDelta),
      journalInvestorPayableDelta: round2(journalInvestorPayableDelta),
    };
  };

  const pFlow = computeFlows(periodEvents);
  const cFlow = computeFlows(cumulativeEvents);

  const cashAndBanks = cFlow.netCashChange;
  const loanPortfolioReceivable = round2(
    cFlow.loansDisbursed - cFlow.principalRecovered + cFlow.journalPortfolioDelta
  );
  const otherCurrentAssets = cFlow.journalOtherAssetsDelta;
  const totalAssets = round2(cashAndBanks + loanPortfolioReceivable + otherCurrentAssets);

  const investorCapitalPayable = round2(
    cFlow.investorContribution - cFlow.investorWithdrawal + cFlow.journalInvestorPayableDelta
  );
  const accountsPayableExpenses = cFlow.pendingExpenses;
  const otherLiabilities = cFlow.journalOtherLiabilitiesDelta;
  const totalLiabilities = round2(
    investorCapitalPayable + accountsPayableExpenses + otherLiabilities
  );

  const paidInCapital = cFlow.journalPaidInCapitalDelta;
  const accumulatedResults = cFlow.netIncome;
  const totalEquity = round2(paidInCapital + accumulatedResults);
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
      otherOperatingIncome: pFlow.otherOperatingIncome,
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
      otherCurrentAssets,
      totalAssets,
      investorCapitalPayable,
      accountsPayableExpenses,
      otherLiabilities,
      totalLiabilities,
      paidInCapital,
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
  loanInstallments?: LoanInstallmentRecord[];
  disbursements: DisbursementRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  payments: PaymentRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
  journalEntries?: JournalEntryRecord[];
}): FinancialStatementsReport {
  const { currency, year, loans } = params;
  const { events, inferredRevenuePaymentsCount, historicalInstallmentAdjustmentsCount } =
    buildNormalizedEvents(params);

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

  const activeCurrencyLoans = loans.filter(
    (l) => l.currency === currency && (l.status === 'ACTIVO' || l.status === 'VENCIDO')
  );
  const activePortfolioFromLoans = round2(
    activeCurrencyLoans.reduce((s, l) => s + Math.max(0, Number(l.currentPrincipalBalance || 0)), 0)
  );
  const balanceSheetPortfolio = cumulativeAllYearsColumn.balanceSheet.loanPortfolioReceivable;
  const totalCashCollectedFromLoans = round2(
    cumulativeAllYearsColumn.cashFlow.principalRecovered +
      cumulativeAllYearsColumn.incomeStatement.interestIncome +
      cumulativeAllYearsColumn.incomeStatement.lateFeeIncome +
      cumulativeAllYearsColumn.incomeStatement.chargesIncome
  );

  return {
    currency,
    selectedYear: year,
    availableYears,
    monthlyColumns,
    yearTotalColumn,
    annualColumns,
    cumulativeAllYearsColumn,
    reconciliationMeta: {
      activeLoansCount: activeCurrencyLoans.length,
      activePortfolioFromLoans,
      balanceSheetPortfolio,
      portfolioDiff: round2(balanceSheetPortfolio - activePortfolioFromLoans),
      totalCashCollectedFromLoans,
      inferredRevenuePaymentsCount,
      historicalInstallmentAdjustmentsCount,
    },
  };
}

/**
 * Generates strictly balanced double-entry operational Journal Entries from loans, payments,
 * operating expenses, and investor transactions, merged with persisted fiscal/manual entries.
 * Guarantees 100% tie-out between Libro Diario, Libro Mayor, and Estados Financieros.
 */
export function buildConsolidatedJournalEntries(params: {
  organizationId: string;
  accounts: AccountingAccountRecord[];
  loans: LoanRecord[];
  loanInstallments?: LoanInstallmentRecord[];
  disbursements: DisbursementRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  payments: PaymentRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
  persistedJournalEntries: JournalEntryRecord[];
}): JournalEntryRecord[] {
  const { organizationId, accounts, persistedJournalEntries } = params;

  const resolveAcc = (code: string, fallbackName: string) => {
    const found = accounts.find((a) => a.code === code);
    return {
      accountId: found?.id || `acc_auto_${code}`,
      accountCode: found?.code || code,
      accountName: found?.name || fallbackName,
    };
  };

  const bankAcct = resolveAcc('1102', 'Bancos y Cuentas Corrientes');
  const portfolioAcct = resolveAcc('1201', 'Cartera de Préstamos por Cobrar');
  const apAcct = resolveAcc('2101', 'Cuentas por Pagar Proveedores');
  const investorCapAcct = resolveAcc('2102', 'Capital de Inversionistas por Pagar');
  const interestRevAcct = resolveAcc('4102', 'Ingresos por Intereses, Mora y Comisiones');
  const payrollAcct = resolveAcc('5102', 'Gastos de Nómina y Personal');
  const techAcct = resolveAcc('5103', 'Servicios Profesionales y Tecnología');
  const opExAcct = resolveAcc('5105', 'Gastos Operativos y Administrativos');
  const finCostAcct = resolveAcc('5109', 'Gastos Financieros y Rendimientos');

  const resolveExpenseAcct = (cat?: ExpenseCategory) => {
    if (cat === 'NOMINA') return payrollAcct;
    if (cat === 'TECNOLOGIA' || cat === 'LEGAL_COBRANZA') return techAcct;
    if (cat === 'INTERESES_INVERSIONISTAS') return finCostAcct;
    return opExAcct;
  };

  const operationalEntries: JournalEntryRecord[] = [];
  const persistedDisbKeys = new Set<string>();
  for (const pe of params.persistedJournalEntries) {
    if (pe.status === 'CONTABILIZADO' && pe.sourceType === 'DESEMBOLSO') {
      if (pe.sourceId) persistedDisbKeys.add(pe.sourceId);
      if (pe.referenceDoc) persistedDisbKeys.add(pe.referenceDoc);
    }
  }
  let seq = 0;

  for (const cur of ['DOP', 'USD'] as const) {
    const { events } = buildNormalizedEvents({
      currency: cur,
      loans: params.loans,
      loanInstallments: params.loanInstallments,
      disbursements: params.disbursements,
      collectionReceipts: params.collectionReceipts,
      payments: params.payments,
      paymentAllocations: params.paymentAllocations,
      operatingExpenses: params.operatingExpenses,
      investors: params.investors,
      investorTransactions: params.investorTransactions,
      journalEntries: [], // Persisted entries are merged directly below
    });

    for (const ev of events) {
      if (ev.kind === 'LOAN_DISBURSEMENT' && ev.loansDisbursed > 0) {
        if (
          (ev.referenceDoc && persistedDisbKeys.has(ev.referenceDoc)) ||
          persistedDisbKeys.has(ev.id)
        ) {
          continue;
        }
        seq++;
        const amt = round2(ev.loansDisbursed);
        operationalEntries.push({
          id: `op_${cur}_${ev.id}`,
          organizationId,
          entryNumber: `OP-DES-${String(seq).padStart(5, '0')}`,
          entryDate: ev.dateIso,
          sourceType: 'DESEMBOLSO',
          sourceId: ev.id,
          idempotencyKey: `op_${cur}_${ev.id}`,
          currency: cur,
          description: ev.description || `Desembolso de préstamo ${ev.referenceDoc || ''}`.trim(),
          referenceDoc: ev.referenceDoc,
          lines: [
            { ...portfolioAcct, debit: amt, credit: 0, memo: 'Colocación de capital en cartera' },
            { ...bankAcct, debit: 0, credit: amt, memo: 'Salida de bancos por desembolso' },
          ],
          totalDebit: amt,
          totalCredit: amt,
          status: 'CONTABILIZADO',
          createdBy: 'system',
          createdByName: 'Contabilidad Automática',
        });
      } else if (ev.kind === 'LOAN_PAYMENT') {
        const p = round2(ev.principalRecovered);
        const rev = round2(ev.interestIncome + ev.lateFeeIncome + ev.chargesIncome);
        const total = round2(p + rev);
        if (total <= 0) continue;
        seq++;
        const lines: JournalEntryLine[] = [
          { ...bankAcct, debit: total, credit: 0, memo: 'Ingreso en bancos / caja por cobro' },
        ];
        if (p > 0) {
          lines.push({
            ...portfolioAcct,
            debit: 0,
            credit: p,
            memo: 'Recuperación de capital de cartera',
          });
        }
        if (rev > 0) {
          const detailParts: string[] = [];
          if (ev.interestIncome > 0) detailParts.push(`Interés ${ev.interestIncome.toFixed(2)}`);
          if (ev.lateFeeIncome > 0) detailParts.push(`Mora ${ev.lateFeeIncome.toFixed(2)}`);
          if (ev.chargesIncome > 0) detailParts.push(`Cargos ${ev.chargesIncome.toFixed(2)}`);
          lines.push({
            ...interestRevAcct,
            debit: 0,
            credit: rev,
            memo: detailParts.join(' · ') || 'Ingresos financieros cobrados',
          });
        }
        operationalEntries.push({
          id: `op_${cur}_${ev.id}`,
          organizationId,
          entryNumber: `OP-COB-${String(seq).padStart(5, '0')}`,
          entryDate: ev.dateIso,
          sourceType: 'PAGO_PRESTAMO',
          sourceId: ev.id,
          idempotencyKey: `op_${cur}_${ev.id}`,
          currency: cur,
          description: ev.description || `Cobro de préstamo ${ev.referenceDoc || ''}`.trim(),
          referenceDoc: ev.referenceDoc,
          lines,
          totalDebit: total,
          totalCredit: total,
          status: 'CONTABILIZADO',
          createdBy: 'system',
          createdByName: 'Contabilidad Automática',
        });
      } else if (ev.kind === 'OPERATING_EXPENSE') {
        const amt = round2(ev.expensePaid + ev.expensePending);
        if (amt <= 0) continue;
        seq++;
        const expAcct = resolveExpenseAcct(ev.expenseCategory);
        const creditAcct = ev.expensePaid > 0 ? bankAcct : apAcct;
        operationalEntries.push({
          id: `op_${cur}_${ev.id}`,
          organizationId,
          entryNumber: `OP-GST-${String(seq).padStart(5, '0')}`,
          entryDate: ev.dateIso,
          sourceType: 'GASTO_OPERATIVO',
          sourceId: ev.id,
          idempotencyKey: `op_${cur}_${ev.id}`,
          currency: cur,
          description: ev.description || `Gasto operativo ${ev.referenceDoc || ''}`.trim(),
          referenceDoc: ev.referenceDoc,
          lines: [
            { ...expAcct, debit: amt, credit: 0, memo: ev.description },
            {
              ...creditAcct,
              debit: 0,
              credit: amt,
              memo: ev.expensePaid > 0 ? 'Gasto pagado en bancos/caja' : 'Gasto pendiente por pagar',
            },
          ],
          totalDebit: amt,
          totalCredit: amt,
          status: 'CONTABILIZADO',
          createdBy: 'system',
          createdByName: 'Contabilidad Automática',
        });
      } else if (ev.kind === 'INVESTOR_TX') {
        if (ev.investorContribution > 0) {
          seq++;
          const amt = round2(ev.investorContribution);
          operationalEntries.push({
            id: `op_${cur}_${ev.id}`,
            organizationId,
            entryNumber: `OP-INV-${String(seq).padStart(5, '0')}`,
            entryDate: ev.dateIso,
            sourceType: 'MANUAL',
            sourceId: ev.id,
            idempotencyKey: `op_${cur}_${ev.id}`,
            currency: cur,
            description: ev.description || 'Aporte de capital de inversionista',
            referenceDoc: ev.referenceDoc,
            lines: [
              { ...bankAcct, debit: amt, credit: 0, memo: 'Entrada de capital de inversionista' },
              { ...investorCapAcct, debit: 0, credit: amt, memo: 'Capital de inversionista por pagar' },
            ],
            totalDebit: amt,
            totalCredit: amt,
            status: 'CONTABILIZADO',
            createdBy: 'system',
            createdByName: 'Contabilidad Automática',
          });
        } else if (ev.investorWithdrawal > 0) {
          seq++;
          const amt = round2(ev.investorWithdrawal);
          operationalEntries.push({
            id: `op_${cur}_${ev.id}`,
            organizationId,
            entryNumber: `OP-INV-${String(seq).padStart(5, '0')}`,
            entryDate: ev.dateIso,
            sourceType: 'MANUAL',
            sourceId: ev.id,
            idempotencyKey: `op_${cur}_${ev.id}`,
            currency: cur,
            description: ev.description || 'Retiro de capital de inversionista',
            referenceDoc: ev.referenceDoc,
            lines: [
              { ...investorCapAcct, debit: amt, credit: 0, memo: 'Reducción capital de inversionista' },
              { ...bankAcct, debit: 0, credit: amt, memo: 'Salida de bancos por retiro' },
            ],
            totalDebit: amt,
            totalCredit: amt,
            status: 'CONTABILIZADO',
            createdBy: 'system',
            createdByName: 'Contabilidad Automática',
          });
        } else if (ev.investorReturnPaid > 0) {
          seq++;
          const amt = round2(ev.investorReturnPaid);
          operationalEntries.push({
            id: `op_${cur}_${ev.id}`,
            organizationId,
            entryNumber: `OP-INV-${String(seq).padStart(5, '0')}`,
            entryDate: ev.dateIso,
            sourceType: 'GASTO_OPERATIVO',
            sourceId: ev.id,
            idempotencyKey: `op_${cur}_${ev.id}`,
            currency: cur,
            description: ev.description || 'Pago de rendimientos a inversionista',
            referenceDoc: ev.referenceDoc,
            lines: [
              { ...finCostAcct, debit: amt, credit: 0, memo: 'Rendimiento financiero a inversionista' },
              { ...bankAcct, debit: 0, credit: amt, memo: 'Pago de rendimiento desde bancos' },
            ],
            totalDebit: amt,
            totalCredit: amt,
            status: 'CONTABILIZADO',
            createdBy: 'system',
            createdByName: 'Contabilidad Automática',
          });
        }
      }
    }
  }

  const operationalSourceTypes = new Set(['DESEMBOLSO', 'PAGO_PRESTAMO', 'GASTO_OPERATIVO']);
  const nonOperationalPersisted = persistedJournalEntries.filter(
    (je) => !operationalSourceTypes.has(je.sourceType)
  );

  return [...nonOperationalPersisted, ...operationalEntries];
}
