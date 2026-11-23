import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CollectionPolicyVersionRecord,
  CreditPolicyRecord,
  CreditRenewalRecord,
  CurrencyCode,
  CustomerRecord,
  DisbursementRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentRecord,
  ProductCode,
  RenewalModality,
  RenewalPayoffBreakdown,
  RenewalProcessStatus,
} from '../types/axycore';
import type {
  AccountingAccountRecord,
  JournalEntryLine,
  JournalEntryRecord,
} from '../types/dgiiEcf';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from './collections/delinquencyEngine';
import {
  computeLoanPayoffPlan,
  listAllClientsForPayoff,
  type LoanPayoffPlan,
} from './collections/loanPayoffEngine';
import { isClosedLoanStatus } from '../utils/formatters';

export const ACTIVE_IN_FLIGHT_RENEWAL_STATUSES: ReadonlySet<RenewalProcessStatus> = new Set([
  'RENOVACION_INICIADA',
  'PENDIENTE_EVALUACION',
  'EN_EVALUACION',
  'PENDIENTE_COMITE',
  'EN_COMITE',
  'APROBADA',
  'DEVUELTA_CORRECCION',
  'PENDIENTE_FORMALIZACION',
  'PENDIENTE_DESEMBOLSO',
  'ERROR_EJECUCION',
]);

export interface RenewalEligibilityResult {
  eligible: boolean;
  blockingReasons: string[];
  warnings: string[];
  payoff: RenewalPayoffBreakdown;
  payoffPlan: LoanPayoffPlan | null;
  behaviorSummary: string;
  paidInstallmentsCount: number;
  paidPercent: number;
}

export interface RenewalNetDisbursementCalculation {
  valid: boolean;
  grossApprovedAmount: number;
  payoffAmount: number;
  otherAuthorizedDiscounts: number;
  totalDeductions: number;
  netDisbursementAmount: number;
  reason?: string;
}

export interface RenewalChainNode {
  loanId: string;
  loanNumber: string;
  status: LoanRecord['status'];
  currency: CurrencyCode;
  approvedPrincipal: number;
  currentPrincipalBalance: number;
  disbursementDate: string;
  originLoanId?: string | null;
  originLoanNumber?: string | null;
  renewedToLoanId?: string | null;
  renewedToLoanNumber?: string | null;
  renewalId?: string | null;
  renewalPayoffAmount?: number | null;
  netDisbursementDelivered?: number | null;
}

export interface CustomerRenewalChain {
  rootLoanId: string;
  nodes: RenewalChainNode[];
  renewalsCount: number;
}

export interface RenewalPeriodBreakdown {
  period: string; // YYYY-MM
  count: number;
  disbursedCount: number;
  grossRenewed: number;
  payoffSettled: number;
  otherDiscounts: number;
  netNewCash: number;
}

export interface RenewalGroupBreakdown {
  key: string;
  label: string;
  count: number;
  disbursedCount: number;
  grossRenewed: number;
  payoffSettled: number;
  netNewCash: number;
}

export interface RenewalExecutiveMetrics {
  currency: CurrencyCode | 'ALL';
  totalInitiated: number;
  totalApproved: number;
  totalDisbursed: number;
  totalRejected: number;
  totalPendingCommittee: number;
  totalPendingDisbursement: number;
  totalInEvaluation: number;
  grossRenewedAmount: number;
  totalPriorPayoffSettled: number;
  totalOtherDiscounts: number;
  totalNetNewCashDelivered: number;
  averageNetDisbursement: number;
  modalityBreakdown: {
    mismasCondicionesCount: number;
    mismasCondicionesDisbursed: number;
    mismasCondicionesGross: number;
    mismasCondicionesNet: number;
    aumentoCount: number;
    aumentoDisbursed: number;
    aumentoGross: number;
    aumentoNet: number;
  };
  byProduct: RenewalGroupBreakdown[];
  byOfficer: RenewalGroupBreakdown[];
  byPeriod: RenewalPeriodBreakdown[];
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function extractIsoDate(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (typeof val === 'object' && val !== null) {
    if ('toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    }
    if ('seconds' in val && typeof (val as { seconds: number }).seconds === 'number') {
      return new Date((val as { seconds: number }).seconds * 1000).toISOString().slice(0, 10);
    }
  }
  return '';
}

/**
 * Computes exact, live cancellation balance for an origin loan as of `asOfDateIso`,
 * incorporating principal, accrued/unpaid interest, authorized charges, late fees (respecting exemption),
 * and any valid approved financial adjustments.
 */
export function computeRenewalPayoffBreakdown(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  payments?: PaymentRecord[];
  customer?: CustomerRecord | null;
  account?: CollectionAccountRecord | null;
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
  validAdjustmentAmount?: number;
}): {
  breakdown: RenewalPayoffBreakdown;
  plan: LoanPayoffPlan | null;
} {
  const {
    loan,
    installments,
    payments = [],
    customer = null,
    account = null,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
    validAdjustmentAmount = 0,
  } = params;

  const loanInsts = installments.filter((i) => i.loanId === loan.id);
  const loanPayments = payments.filter(
    (p) => p.loanId === loan.id && p.status !== 'REVERTIDO' && p.status !== 'RECHAZADO'
  );

  const [item] = listAllClientsForPayoff({
    customers: customer ? [customer] : [],
    loans: [loan],
    collectionAccounts: account ? [account] : [],
    installments: loanInsts,
    policy,
    asOfDateIso,
  });

  if (!item) {
    const fallbackPrincipal = Math.max(0, round2(loan.currentPrincipalBalance));
    return {
      breakdown: {
        asOfDateIso,
        remainingPrincipal: fallbackPrincipal,
        remainingInterest: 0,
        remainingCharges: 0,
        remainingLateFee: 0,
        adjustmentsAmount: 0,
        totalPayoffAmount: fallbackPrincipal,
        unpaidInstallmentsCount: 0,
        overdueInstallmentsCount: 0,
        totalInstallmentsCount: loanInsts.length,
        dpd: 0,
        paidPrincipalTotal: round2(loan.paidPrincipalTotal ?? 0),
        paidInterestTotal: round2(loan.paidInterestTotal ?? 0),
        paidLateFeeTotal: round2(loan.paidLateFeeTotal ?? 0),
        paymentsCount: loanPayments.length,
      },
      plan: null,
    };
  }

  const overdueInstallmentsCount = item.evaluatedInstallments.filter(
    (i) => i.status === 'VENCIDA' || (i.status !== 'PAGADA' && i.dueDate < asOfDateIso)
  ).length;

  let plan: LoanPayoffPlan | null = null;
  const safeAdj = Math.max(0, round2(validAdjustmentAmount));
  if (!isClosedLoanStatus(loan.status) && item.totalOwed > 0) {
    const targetPayoff = Math.max(0, fromCents(Math.max(0, toCents(item.totalOwed) - toCents(safeAdj))));
    plan = computeLoanPayoffPlan({
      item,
      mode: safeAdj > 0 ? 'CUSTOM_AMOUNT' : 'FULL_PAYOFF',
      customPayoffAmount: safeAdj > 0 ? targetPayoff : undefined,
      asOfDateIso,
    });
  }

  const totalPayoffCents = Math.max(0, toCents(item.totalOwed) - toCents(safeAdj));

  return {
    breakdown: {
      asOfDateIso,
      remainingPrincipal: round2(item.remainingPrincipal),
      remainingInterest: round2(item.remainingInterest),
      remainingCharges: round2(item.remainingCharges),
      remainingLateFee: round2(item.remainingLateFee),
      adjustmentsAmount: safeAdj,
      totalPayoffAmount: fromCents(totalPayoffCents),
      unpaidInstallmentsCount: item.unpaidInstallmentsCount,
      overdueInstallmentsCount,
      totalInstallmentsCount: item.totalInstallmentsCount,
      dpd: item.dpd,
      paidPrincipalTotal: round2(loan.paidPrincipalTotal ?? 0),
      paidInterestTotal: round2(loan.paidInterestTotal ?? 0),
      paidLateFeeTotal: round2(loan.paidLateFeeTotal ?? 0),
      paymentsCount: loanPayments.length,
    },
    plan,
  };
}

/**
 * Validates whether an existing loan is eligible for renewal under AxyCore credit policies
 * and enforces strict single-active-renewal concurrency protection.
 */
export function evaluateLoanRenewalEligibility(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  payments?: PaymentRecord[];
  existingRenewals?: CreditRenewalRecord[];
  existingApplications?: ApplicationRecord[];
  customer?: CustomerRecord | null;
  account?: CollectionAccountRecord | null;
  creditPolicy?: CreditPolicyRecord | null;
  collectionPolicy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
}): RenewalEligibilityResult {
  const {
    loan,
    installments,
    payments = [],
    existingRenewals = [],
    existingApplications = [],
    customer = null,
    account = null,
    collectionPolicy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const { breakdown: payoff, plan: payoffPlan } = computeRenewalPayoffBreakdown({
    loan,
    installments,
    payments,
    customer,
    account,
    policy: collectionPolicy,
    asOfDateIso,
  });

  if (isClosedLoanStatus(loan.status)) {
    blockingReasons.push(
      `El préstamo ${loan.loanNumber} se encuentra en estado ${loan.status} y no puede renovarse. Utilice Nueva Solicitud para un crédito nuevo.`
    );
  }

  if (loan.renewedToLoanId) {
    blockingReasons.push(
      `El préstamo ${loan.loanNumber} ya fue liquidado por renovación hacia el crédito ${loan.renewedToLoanNumber || loan.renewedToLoanId}.`
    );
  }

  const activeRenewal = existingRenewals.find(
    (r) => r.originLoanId === loan.id && ACTIVE_IN_FLIGHT_RENEWAL_STATUSES.has(r.status)
  );
  if (activeRenewal) {
    blockingReasons.push(
      `Ya existe una renovación en curso (${activeRenewal.renewalNumber} · estado ${activeRenewal.status}) para el préstamo ${loan.loanNumber}. No se permiten dos renovaciones simultáneas del mismo crédito.`
    );
  }

  const activeLinkedApp = existingApplications.find(
    (a) =>
      a.isRenewal &&
      a.originLoanId === loan.id &&
      !['RECHAZADA', 'DESEMBOLSADA'].includes(a.status) &&
      (!activeRenewal || a.id !== activeRenewal.applicationId)
  );
  if (activeLinkedApp) {
    blockingReasons.push(
      `Existe una solicitud de renovación activa (${activeLinkedApp.applicationNumber} · ${activeLinkedApp.status}) vinculada al préstamo ${loan.loanNumber}.`
    );
  }

  if (payoff.totalPayoffAmount <= 0 && !isClosedLoanStatus(loan.status)) {
    warnings.push(
      'El saldo pendiente calculado es RD$0.00; confirme si el préstamo debe saldarse en Cobranza antes de originar un crédito nuevo.'
    );
  }

  const totalInsts = Math.max(0, payoff.totalInstallmentsCount);
  const paidInstallmentsCount = Math.max(0, totalInsts - payoff.unpaidInstallmentsCount);
  const paidPercent =
    loan.totalFinancedPrincipal > 0
      ? Math.min(
          100,
          round2(
            ((loan.totalFinancedPrincipal - Math.min(loan.totalFinancedPrincipal, payoff.remainingPrincipal)) /
              loan.totalFinancedPrincipal) *
              100
          )
        )
      : totalInsts > 0
      ? round2((paidInstallmentsCount / totalInsts) * 100)
      : 0;

  if (payoff.dpd > 90) {
    blockingReasons.push(
      `El préstamo presenta ${payoff.dpd} días de atraso (>90 días). Requiere regularización o acuerdo de pago antes de renovar.`
    );
  } else if (payoff.dpd > 15) {
    warnings.push(
      `El préstamo presenta ${payoff.dpd} días de atraso (${payoff.overdueInstallmentsCount} cuota(s) vencida(s)). Se recomienda evaluación reforzada y validación en Comité.`
    );
  } else if (payoff.dpd > 0) {
    warnings.push(
      `Presenta ${payoff.dpd} día(s) de atraso menor. La mora acumulada se incluirá automáticamente en el saldo de cancelación.`
    );
  }

  if (paidPercent < 25 && totalInsts > 1) {
    warnings.push(
      `El cliente ha amortizado ${paidPercent.toFixed(1)}% del capital (${paidInstallmentsCount}/${totalInsts} cuotas). Verifique que el monto nuevo supere ampliamente el saldo de cancelación.`
    );
  }

  const behaviorSummary =
    payoff.dpd === 0
      ? `Excelente comportamiento · Al día (0 DPD) · ${paidInstallmentsCount}/${totalInsts || '—'} cuotas pagadas (${paidPercent.toFixed(0)}% amortizado) · ${payoff.paymentsCount} pago(s) registrados`
      : `Comportamiento con atraso (${payoff.dpd} DPD · ${payoff.overdueInstallmentsCount} cuota(s) vencida(s)) · ${paidInstallmentsCount}/${totalInsts || '—'} cuotas pagadas · ${payoff.paymentsCount} pago(s) registrados`;

  return {
    eligible: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    payoff,
    payoffPlan,
    behaviorSummary,
    paidInstallmentsCount,
    paidPercent,
  };
}

/**
 * Computes mandatory renewal net disbursement:
 * DESEMBOLSO NETO = MONTO NUEVO APROBADO - SALDO DE CANCELACIÓN ANTERIOR - OTROS DESCUENTOS AUTORIZADOS.
 * Strictly blocks net <= 0.
 */
export function calculateRenewalNetDisbursement(params: {
  grossApprovedAmount: number;
  payoffAmount: number;
  otherAuthorizedDiscounts?: number;
}): RenewalNetDisbursementCalculation {
  const grossCents = toCents(params.grossApprovedAmount);
  const payoffCents = Math.max(0, toCents(params.payoffAmount));
  const otherCents = Math.max(0, toCents(params.otherAuthorizedDiscounts ?? 0));
  const totalDeductionsCents = payoffCents + otherCents;
  const netCents = grossCents - totalDeductionsCents;

  const grossApprovedAmount = fromCents(grossCents);
  const payoffAmount = fromCents(payoffCents);
  const otherAuthorizedDiscounts = fromCents(otherCents);
  const totalDeductions = fromCents(totalDeductionsCents);
  const netDisbursementAmount = fromCents(netCents);

  if (grossCents <= 0) {
    return {
      valid: false,
      grossApprovedAmount,
      payoffAmount,
      otherAuthorizedDiscounts,
      totalDeductions,
      netDisbursementAmount,
      reason: 'El monto bruto aprobado del nuevo préstamo debe ser mayor a cero.',
    };
  }

  if (netCents <= 0) {
    return {
      valid: false,
      grossApprovedAmount,
      payoffAmount,
      otherAuthorizedDiscounts,
      totalDeductions,
      netDisbursementAmount,
      reason: `Desembolso bloqueado: el saldo de cancelación (${payoffAmount.toFixed(2)}) más otros descuentos (${otherAuthorizedDiscounts.toFixed(2)}) igualan o superan el monto aprobado (${grossApprovedAmount.toFixed(2)}), produciendo un desembolso neto de ${netDisbursementAmount.toFixed(2)}. Modifique las condiciones o aumente el monto con autorización.`,
    };
  }

  return {
    valid: true,
    grossApprovedAmount,
    payoffAmount,
    otherAuthorizedDiscounts,
    totalDeductions,
    netDisbursementAmount,
  };
}

/**
 * Enforces Section 7 authorized renewal workflow transitions and prevents skipping mandatory stages.
 */
export function isRenewalTransitionAllowed(params: {
  from: RenewalProcessStatus;
  to: RenewalProcessStatus;
  modality: RenewalModality;
}): { allowed: boolean; reason?: string } {
  const { from, to, modality } = params;
  if (from === to) return { allowed: true };

  if (from === 'DESEMBOLSADA' || from === 'RECHAZADA' || from === 'CANCELADA_USUARIO') {
    return {
      allowed: false,
      reason: `La renovación se encuentra en estado terminal (${from}) y no admite transición a ${to}.`,
    };
  }

  if (modality === 'AUMENTO_O_MODIFICACION') {
    if (
      (from === 'RENOVACION_INICIADA' || from === 'PENDIENTE_EVALUACION') &&
      (to === 'PENDIENTE_COMITE' || to === 'EN_COMITE' || to === 'APROBADA' || to === 'DESEMBOLSADA')
    ) {
      return {
        allowed: false,
        reason:
          'Una renovación con aumento o modificación de condiciones debe pasar obligatoriamente por Evaluación antes de llegar a Comité.',
      };
    }
  }

  const allowedTargets: Record<RenewalProcessStatus, RenewalProcessStatus[]> = {
    RENOVACION_INICIADA:
      modality === 'MISMAS_CONDICIONES'
        ? ['PENDIENTE_COMITE', 'EN_COMITE', 'CANCELADA_USUARIO', 'ERROR_EJECUCION']
        : ['PENDIENTE_EVALUACION', 'EN_EVALUACION', 'CANCELADA_USUARIO', 'ERROR_EJECUCION'],
    PENDIENTE_EVALUACION: ['EN_EVALUACION', 'DEVUELTA_CORRECCION', 'RECHAZADA', 'CANCELADA_USUARIO'],
    EN_EVALUACION: ['PENDIENTE_COMITE', 'EN_COMITE', 'DEVUELTA_CORRECCION', 'RECHAZADA', 'CANCELADA_USUARIO'],
    PENDIENTE_COMITE: ['EN_COMITE', 'APROBADA', 'PENDIENTE_FORMALIZACION', 'RECHAZADA', 'DEVUELTA_CORRECCION', 'CANCELADA_USUARIO'],
    EN_COMITE: ['APROBADA', 'PENDIENTE_FORMALIZACION', 'RECHAZADA', 'DEVUELTA_CORRECCION', 'CANCELADA_USUARIO'],
    DEVUELTA_CORRECCION:
      modality === 'MISMAS_CONDICIONES'
        ? ['PENDIENTE_COMITE', 'EN_COMITE', 'EN_EVALUACION', 'CANCELADA_USUARIO']
        : ['PENDIENTE_EVALUACION', 'EN_EVALUACION', 'CANCELADA_USUARIO'],
    APROBADA: ['PENDIENTE_FORMALIZACION', 'PENDIENTE_DESEMBOLSO', 'CANCELADA_USUARIO'],
    PENDIENTE_FORMALIZACION: ['PENDIENTE_DESEMBOLSO', 'DEVUELTA_CORRECCION', 'CANCELADA_USUARIO'],
    PENDIENTE_DESEMBOLSO: ['DESEMBOLSADA', 'ERROR_EJECUCION', 'CANCELADA_USUARIO'],
    ERROR_EJECUCION: ['PENDIENTE_DESEMBOLSO', 'DESEMBOLSADA', 'CANCELADA_USUARIO'],
    DESEMBOLSADA: [],
    RECHAZADA: [],
    CANCELADA_USUARIO: [],
  };

  if (!allowedTargets[from]?.includes(to)) {
    return {
      allowed: false,
      reason: `Transición no autorizada de ${from} a ${to} para modalidad ${modality}.`,
    };
  }

  return { allowed: true };
}

/**
 * Builds a strictly balanced double-entry accounting journal entry for a coordinated
 * renewal liquidation + net cash disbursement.
 *
 * Debit:  1201 Cartera de Préstamos por Cobrar = totalFinancedNewLoan
 * Credit: 1201 Cartera de Préstamos por Cobrar = settledOriginPrincipal
 * Credit: 4102 Ingresos por Intereses, Mora y Comisiones = settledInterest + settledLateFee + settledCharges + financedExpenses + deductedExpenses
 * Credit: 1102 Bancos y Cuentas Corrientes = netDisbursementDelivered
 */
export function buildRenewalAccountingJournalEntry(params: {
  entryId: string;
  organizationId: string;
  entryDate: string;
  currency: CurrencyCode;
  renewalNumber: string;
  originLoanNumber: string;
  targetLoanNumber: string;
  disbursementId: string;
  disbursementNumber: string;
  customerName: string;
  totalFinancedNewLoan: number;
  financedExpenses: number;
  deductedExpenses: number;
  settledPrincipal: number;
  settledInterest: number;
  settledLateFee: number;
  settledCharges: number;
  netDisbursementDelivered: number;
  idempotencyKey: string;
  accounts?: AccountingAccountRecord[];
  userId: string;
  userName: string;
}): Omit<JournalEntryRecord, 'createdAt' | 'updatedAt'> {
  const {
    entryId,
    organizationId,
    entryDate,
    currency,
    renewalNumber,
    originLoanNumber,
    targetLoanNumber,
    disbursementId,
    disbursementNumber,
    customerName,
    totalFinancedNewLoan,
    financedExpenses,
    deductedExpenses,
    settledPrincipal,
    settledInterest,
    settledLateFee,
    settledCharges,
    netDisbursementDelivered,
    idempotencyKey,
    accounts = [],
    userId,
    userName,
  } = params;

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
  const revenueAcct = resolveAcc('4102', 'Ingresos por Intereses, Mora y Comisiones');

  const debitPortfolioCents = toCents(totalFinancedNewLoan);
  const creditOldPrincipalCents = Math.max(0, toCents(settledPrincipal));
  const creditNetBankCents = Math.max(0, toCents(netDisbursementDelivered));
  const explicitRevenueCents =
    Math.max(0, toCents(settledInterest)) +
    Math.max(0, toCents(settledLateFee)) +
    Math.max(0, toCents(settledCharges)) +
    Math.max(0, toCents(financedExpenses)) +
    Math.max(0, toCents(deductedExpenses));

  // Ensure exact cent-level accounting equilibrium even if rounding differed by 1 cent
  const residualCents = debitPortfolioCents - (creditOldPrincipalCents + creditNetBankCents + explicitRevenueCents);
  const finalRevenueCents = Math.max(0, explicitRevenueCents + residualCents);

  const lines: JournalEntryLine[] = [
    {
      ...portfolioAcct,
      debit: fromCents(debitPortfolioCents),
      credit: 0,
      memo: `Activación nuevo préstamo ${targetLoanNumber} por renovación (${renewalNumber})`.slice(0, 200),
    },
  ];

  if (creditOldPrincipalCents > 0) {
    lines.push({
      ...portfolioAcct,
      debit: 0,
      credit: fromCents(creditOldPrincipalCents),
      memo: `Liquidación de capital préstamo anterior ${originLoanNumber}`.slice(0, 200),
    });
  }

  if (finalRevenueCents > 0) {
    const revNotes: string[] = [];
    if (settledInterest > 0) revNotes.push(`Int. ant. ${settledInterest.toFixed(2)}`);
    if (settledLateFee > 0) revNotes.push(`Mora ant. ${settledLateFee.toFixed(2)}`);
    if (settledCharges > 0) revNotes.push(`Cargos ant. ${settledCharges.toFixed(2)}`);
    if (financedExpenses + deductedExpenses > 0) {
      revNotes.push(`Gastos form. ${(financedExpenses + deductedExpenses).toFixed(2)}`);
    }
    lines.push({
      ...revenueAcct,
      debit: 0,
      credit: fromCents(finalRevenueCents),
      memo: (revNotes.join(' · ') || `Intereses y comisiones por renovación ${originLoanNumber}`).slice(0, 200),
    });
  }

  if (creditNetBankCents > 0) {
    lines.push({
      ...bankAcct,
      debit: 0,
      credit: fromCents(creditNetBankCents),
      memo: `Desembolso neto entregado al cliente (${disbursementNumber})`.slice(0, 200),
    });
  }

  const totalDebit = fromCents(lines.reduce((s, l) => s + toCents(l.debit), 0));
  const totalCredit = fromCents(lines.reduce((s, l) => s + toCents(l.credit), 0));

  return {
    id: entryId,
    organizationId,
    entryNumber: `REN-${disbursementNumber.replace(/^DES-/, '')}`.slice(0, 40),
    entryDate,
    sourceType: 'DESEMBOLSO',
    sourceId: disbursementId,
    idempotencyKey: `je_ren_${idempotencyKey}`.slice(0, 128),
    currency,
    description: `Renovación ${renewalNumber}: Liquidación ${originLoanNumber} y desembolso neto ${targetLoanNumber} (${customerName})`.slice(
      0,
      400
    ),
    referenceDoc: `${renewalNumber} / ${originLoanNumber} -> ${targetLoanNumber}`.slice(0, 120),
    lines,
    totalDebit,
    totalCredit,
    status: 'CONTABILIZADO',
    createdBy: userId,
    createdByName: userName.slice(0, 160),
  };
}

/**
 * Builds ordered historical renewal chains for a customer:
 * Example: PRE-001 -> PRE-002 -> PRE-003.
 */
export function buildCustomerRenewalChains(params: {
  customerLoans: LoanRecord[];
  customerRenewals: CreditRenewalRecord[];
}): CustomerRenewalChain[] {
  const { customerLoans, customerRenewals } = params;
  const loanById = new Map<string, LoanRecord>(customerLoans.map((l) => [l.id, l]));
  const nextByOrigin = new Map<string, LoanRecord>();
  const renewalByOrigin = new Map<string, CreditRenewalRecord>();

  for (const r of customerRenewals) {
    if (r.status === 'DESEMBOLSADA' && r.targetLoanId) {
      renewalByOrigin.set(r.originLoanId, r);
      const target = loanById.get(r.targetLoanId);
      if (target) nextByOrigin.set(r.originLoanId, target);
    }
  }

  for (const loan of customerLoans) {
    if (loan.originLoanId && !nextByOrigin.has(loan.originLoanId)) {
      nextByOrigin.set(loan.originLoanId, loan);
    }
    if (loan.renewedToLoanId && !nextByOrigin.has(loan.id)) {
      const target = loanById.get(loan.renewedToLoanId);
      if (target) nextByOrigin.set(loan.id, target);
    }
  }

  // Identify roots that participate in at least one renewal link
  const participatingIds = new Set<string>();
  for (const [origId, targetLoan] of nextByOrigin.entries()) {
    participatingIds.add(origId);
    participatingIds.add(targetLoan.id);
  }

  const roots = customerLoans
    .filter((l) => participatingIds.has(l.id) && (!l.originLoanId || !loanById.has(l.originLoanId)))
    .sort((a, b) => (a.disbursementDate || '').localeCompare(b.disbursementDate || ''));

  const chains: CustomerRenewalChain[] = [];
  const visitedGlobal = new Set<string>();

  for (const root of roots) {
    if (visitedGlobal.has(root.id)) continue;
    const nodes: RenewalChainNode[] = [];
    let cursor: LoanRecord | undefined = root;
    let safety = 0;
    while (cursor && !visitedGlobal.has(cursor.id) && safety < 50) {
      safety += 1;
      visitedGlobal.add(cursor.id);
      const outRenewal = renewalByOrigin.get(cursor.id);
      nodes.push({
        loanId: cursor.id,
        loanNumber: cursor.loanNumber,
        status: cursor.status,
        currency: cursor.currency,
        approvedPrincipal: cursor.approvedPrincipal,
        currentPrincipalBalance: cursor.currentPrincipalBalance,
        disbursementDate: cursor.disbursementDate,
        originLoanId: cursor.originLoanId ?? null,
        originLoanNumber: cursor.originLoanNumber ?? null,
        renewedToLoanId: cursor.renewedToLoanId ?? outRenewal?.targetLoanId ?? null,
        renewedToLoanNumber: cursor.renewedToLoanNumber ?? outRenewal?.targetLoanNumber ?? null,
        renewalId: cursor.renewalId ?? outRenewal?.id ?? null,
        renewalPayoffAmount: cursor.renewalPayoffAmount ?? cursor.payoffSettledAmount ?? null,
        netDisbursementDelivered: cursor.netDisbursementDelivered ?? null,
      });
      cursor = nextByOrigin.get(cursor.id);
    }
    if (nodes.length >= 2) {
      chains.push({
        rootLoanId: root.id,
        nodes,
        renewalsCount: nodes.length - 1,
      });
    }
  }

  return chains;
}

/**
 * Computes all 15 required renewal executive metrics (Section 9),
 * strictly separating Gross Renewed Amount vs Settled Prior Balance vs Other Discounts vs Net New Cash Delivered.
 */
export function computeRenewalExecutiveMetrics(params: {
  renewals: CreditRenewalRecord[];
  disbursements?: DisbursementRecord[];
  currency?: CurrencyCode | 'ALL';
  productFilter?: ProductCode | 'ALL';
  dateFrom?: string;
  dateTo?: string;
}): RenewalExecutiveMetrics {
  const {
    renewals,
    disbursements = [],
    currency = 'ALL',
    productFilter = 'ALL',
    dateFrom = '',
    dateTo = '',
  } = params;

  const disbById = new Map(disbursements.map((d) => [d.id, d]));

  const filtered = renewals.filter((r) => {
    if (currency !== 'ALL' && r.originCurrency !== currency) return false;
    if (productFilter !== 'ALL' && r.originProductCode !== productFilter) return false;
    const refDate = r.disbursedAt?.slice(0, 10) || r.liquidationDate || extractIsoDate(r.createdAt);
    if (dateFrom && refDate && refDate < dateFrom) return false;
    if (dateTo && refDate && refDate > dateTo) return false;
    return true;
  });

  let totalApproved = 0;
  let totalDisbursed = 0;
  let totalRejected = 0;
  let totalPendingCommittee = 0;
  let totalPendingDisbursement = 0;
  let totalInEvaluation = 0;

  let grossRenewedCents = 0;
  let payoffSettledCents = 0;
  let otherDiscountsCents = 0;
  let netNewCashCents = 0;

  const modalityBreakdown = {
    mismasCondicionesCount: 0,
    mismasCondicionesDisbursed: 0,
    mismasCondicionesGross: 0,
    mismasCondicionesNet: 0,
    aumentoCount: 0,
    aumentoDisbursed: 0,
    aumentoGross: 0,
    aumentoNet: 0,
  };

  const productMap = new Map<string, RenewalGroupBreakdown>();
  const officerMap = new Map<string, RenewalGroupBreakdown>();
  const periodMap = new Map<string, RenewalPeriodBreakdown>();

  for (const r of filtered) {
    const isDisbursed = r.status === 'DESEMBOLSADA';
    const isApproved =
      r.status === 'APROBADA' ||
      r.status === 'PENDIENTE_FORMALIZACION' ||
      r.status === 'PENDIENTE_DESEMBOLSO' ||
      isDisbursed;

    if (isApproved) totalApproved += 1;
    if (isDisbursed) totalDisbursed += 1;
    if (r.status === 'RECHAZADA') totalRejected += 1;
    if (r.status === 'PENDIENTE_COMITE' || r.status === 'EN_COMITE') totalPendingCommittee += 1;
    if (r.status === 'PENDIENTE_DESEMBOLSO' || r.status === 'PENDIENTE_FORMALIZACION') {
      totalPendingDisbursement += 1;
    }
    if (r.status === 'PENDIENTE_EVALUACION' || r.status === 'EN_EVALUACION') {
      totalInEvaluation += 1;
    }

    const linkedDisb = r.disbursementId ? disbById.get(r.disbursementId) : undefined;
    const grossAmt = isDisbursed
      ? r.approvedAmount ?? linkedDisb?.approvedAmount ?? r.requestedAmount
      : 0;
    const settledAmt = isDisbursed
      ? r.settledPayoffAmount ?? linkedDisb?.renewalPayoffAmount ?? r.payoffSnapshot.totalPayoffAmount
      : 0;
    const otherDiscAmt = isDisbursed
      ? r.otherDeductionsAmount ?? linkedDisb?.otherDiscountsAmount ?? 0
      : 0;
    const netAmt = isDisbursed
      ? r.netDisbursementAmount ??
        linkedDisb?.netDeliveredAmount ??
        Math.max(0, round2(grossAmt - settledAmt - otherDiscAmt))
      : 0;

    if (isDisbursed) {
      grossRenewedCents += toCents(grossAmt);
      payoffSettledCents += toCents(settledAmt);
      otherDiscountsCents += toCents(otherDiscAmt);
      netNewCashCents += toCents(netAmt);
    }

    if (r.modality === 'MISMAS_CONDICIONES') {
      modalityBreakdown.mismasCondicionesCount += 1;
      if (isDisbursed) {
        modalityBreakdown.mismasCondicionesDisbursed += 1;
        modalityBreakdown.mismasCondicionesGross = round2(
          modalityBreakdown.mismasCondicionesGross + grossAmt
        );
        modalityBreakdown.mismasCondicionesNet = round2(
          modalityBreakdown.mismasCondicionesNet + netAmt
        );
      }
    } else {
      modalityBreakdown.aumentoCount += 1;
      if (isDisbursed) {
        modalityBreakdown.aumentoDisbursed += 1;
        modalityBreakdown.aumentoGross = round2(modalityBreakdown.aumentoGross + grossAmt);
        modalityBreakdown.aumentoNet = round2(modalityBreakdown.aumentoNet + netAmt);
      }
    }

    // By Product
    const prodKey = r.originProductCode;
    const prodEntry = productMap.get(prodKey) ?? {
      key: prodKey,
      label: prodKey,
      count: 0,
      disbursedCount: 0,
      grossRenewed: 0,
      payoffSettled: 0,
      netNewCash: 0,
    };
    prodEntry.count += 1;
    if (isDisbursed) {
      prodEntry.disbursedCount += 1;
      prodEntry.grossRenewed = round2(prodEntry.grossRenewed + grossAmt);
      prodEntry.payoffSettled = round2(prodEntry.payoffSettled + settledAmt);
      prodEntry.netNewCash = round2(prodEntry.netNewCash + netAmt);
    }
    productMap.set(prodKey, prodEntry);

    // By Officer
    const offKey = r.initiatedBy || 'sin_asignar';
    const offEntry = officerMap.get(offKey) ?? {
      key: offKey,
      label: r.initiatedByName || 'Oficial',
      count: 0,
      disbursedCount: 0,
      grossRenewed: 0,
      payoffSettled: 0,
      netNewCash: 0,
    };
    offEntry.count += 1;
    if (isDisbursed) {
      offEntry.disbursedCount += 1;
      offEntry.grossRenewed = round2(offEntry.grossRenewed + grossAmt);
      offEntry.payoffSettled = round2(offEntry.payoffSettled + settledAmt);
      offEntry.netNewCash = round2(offEntry.netNewCash + netAmt);
    }
    officerMap.set(offKey, offEntry);

    // By Period (YYYY-MM)
    const periodIso = (
      r.disbursedAt?.slice(0, 7) ||
      r.liquidationDate?.slice(0, 7) ||
      extractIsoDate(r.createdAt).slice(0, 7) ||
      getSantoDomingoTodayIso().slice(0, 7)
    );
    const perEntry = periodMap.get(periodIso) ?? {
      period: periodIso,
      count: 0,
      disbursedCount: 0,
      grossRenewed: 0,
      payoffSettled: 0,
      otherDiscounts: 0,
      netNewCash: 0,
    };
    perEntry.count += 1;
    if (isDisbursed) {
      perEntry.disbursedCount += 1;
      perEntry.grossRenewed = round2(perEntry.grossRenewed + grossAmt);
      perEntry.payoffSettled = round2(perEntry.payoffSettled + settledAmt);
      perEntry.otherDiscounts = round2(perEntry.otherDiscounts + otherDiscAmt);
      perEntry.netNewCash = round2(perEntry.netNewCash + netAmt);
    }
    periodMap.set(periodIso, perEntry);
  }

  const totalNetNewCashDelivered = fromCents(netNewCashCents);

  return {
    currency,
    totalInitiated: filtered.length,
    totalApproved,
    totalDisbursed,
    totalRejected,
    totalPendingCommittee,
    totalPendingDisbursement,
    totalInEvaluation,
    grossRenewedAmount: fromCents(grossRenewedCents),
    totalPriorPayoffSettled: fromCents(payoffSettledCents),
    totalOtherDiscounts: fromCents(otherDiscountsCents),
    totalNetNewCashDelivered,
    averageNetDisbursement:
      totalDisbursed > 0 ? round2(totalNetNewCashDelivered / totalDisbursed) : 0,
    modalityBreakdown,
    byProduct: Array.from(productMap.values()).sort((a, b) => b.netNewCash - a.netNewCash),
    byOfficer: Array.from(officerMap.values()).sort((a, b) => b.netNewCash - a.netNewCash),
    byPeriod: Array.from(periodMap.values()).sort((a, b) => b.period.localeCompare(a.period)),
  };
}
