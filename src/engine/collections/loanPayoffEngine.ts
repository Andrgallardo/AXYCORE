import type {
  CollectionAccountRecord,
  CollectionPolicyVersionRecord,
  CurrencyCode,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  computeInstallmentRemaining,
  evaluateLoanDelinquency,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from './delinquencyEngine';

export type LoanPayoffMode = 'FULL_PAYOFF' | 'DISCOUNT_PERCENT' | 'CUSTOM_AMOUNT';

export interface ClientLoanPayoffItem {
  id: string; // loanId or cust_<customerId> when customer has no loan
  hasLoan: boolean;
  loan: LoanRecord | null;
  account: CollectionAccountRecord | null;
  customer: CustomerRecord | null;
  loanId: string | null;
  loanNumber: string;
  customerId: string;
  applicantDisplayName: string;
  documentNumber: string;
  customerPhone: string;
  currency: CurrencyCode;
  status: LoanRecord['status'] | 'SIN_PRESTAMO';
  dpd: number;
  unpaidInstallmentsCount: number;
  totalInstallmentsCount: number;
  remainingPrincipal: number;
  remainingInterest: number;
  remainingCharges: number;
  remainingLateFee: number;
  totalOwed: number;
  lateFeeExempt: boolean;
  evaluatedInstallments: LoanInstallmentRecord[];
}

export interface InstallmentPayoffSettlementUpdate {
  installmentId: string;
  installmentNumber: number;
  nextPaidPrincipal: number;
  nextPaidInterest: number;
  nextPaidOtherCharges: number;
  nextPaidLateFee: number;
  nextWaivedLateFee: number;
  nextStatus: 'PAGADA';
  paidAt: string;
}

export interface LoanPayoffPlan {
  mode: LoanPayoffMode;
  loanId: string;
  loanNumber: string;
  applicantDisplayName: string;
  currency: CurrencyCode;
  asOfDateIso: string;
  remainingPrincipal: number;
  remainingInterest: number;
  remainingCharges: number;
  remainingLateFee: number;
  totalOwed: number;
  discountPercent: number;
  discountAmount: number;
  finalPayoffAmount: number;
  allocatedToPrincipal: number;
  allocatedToInterest: number;
  allocatedToCharges: number;
  allocatedToLateFee: number;
  waivedLateFeeInSettlement: number;
  nextPaidPrincipalTotal: number;
  nextPaidInterestTotal: number;
  nextPaidLateFeeTotal: number;
  nextWaivedLateFeeTotal: number;
  installmentUpdates: InstallmentPayoffSettlementUpdate[];
}

/**
 * Lists ALL clients (every loan in the portfolio plus customers without loans)
 * with exact live payoff breakdown (principal + interest + charges + late fee).
 */
export function listAllClientsForPayoff(params: {
  customers: CustomerRecord[];
  loans: LoanRecord[];
  collectionAccounts: CollectionAccountRecord[];
  installments: LoanInstallmentRecord[];
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
}): ClientLoanPayoffItem[] {
  const {
    customers,
    loans,
    collectionAccounts,
    installments,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const customerById = new Map<string, CustomerRecord>();
  for (const c of customers) {
    customerById.set(c.id, c);
  }

  const accountByLoanId = new Map<string, CollectionAccountRecord>();
  for (const acc of collectionAccounts) {
    accountByLoanId.set(acc.loanId, acc);
  }

  const instsByLoanId = new Map<string, LoanInstallmentRecord[]>();
  for (const inst of installments) {
    const arr = instsByLoanId.get(inst.loanId);
    if (arr) arr.push(inst);
    else instsByLoanId.set(inst.loanId, [inst]);
  }

  const items: ClientLoanPayoffItem[] = [];
  const customersWithLoans = new Set<string>();

  for (const loan of loans) {
    customersWithLoans.add(loan.customerId);
    const customer = customerById.get(loan.customerId) ?? null;
    const existingAcc = accountByLoanId.get(loan.id) ?? null;
    const loanInsts = instsByLoanId.get(loan.id) ?? [];

    const evaluated =
      loanInsts.length > 0 || !existingAcc
        ? evaluateLoanDelinquency({
            loan,
            installments: loanInsts,
            customer,
            policy,
            asOfDateIso,
            existingAccount: existingAcc,
          })
        : null;

    const account = evaluated?.account ?? existingAcc;
    const evaluatedInsts = evaluated?.updatedInstallments ?? loanInsts;
    const isClosed =
      loan.status === 'CANCELADO' ||
      loan.status === 'CANCELADO_POR_RENOVACION' ||
      (loan.status === 'PAGADO' && toCents(loan.currentPrincipalBalance) <= 0);

    let remPrincipalCents = 0;
    let remInterestCents = 0;
    let remChargesCents = 0;
    let remLateFeeCents = 0;
    let unpaidInstallmentsCount = 0;

    if (!isClosed) {
      if (evaluatedInsts.length > 0) {
        for (const inst of evaluatedInsts) {
          const rem = computeInstallmentRemaining(inst);
          if (rem.isPaid) continue;
          unpaidInstallmentsCount += 1;
          remPrincipalCents += toCents(rem.remPrincipal);
          remInterestCents += toCents(rem.remInterest);
          remChargesCents += toCents(rem.remCharges);
          if (!loan.lateFeeExempt) {
            remLateFeeCents += toCents(rem.remLateFee);
          }
        }
        // Safeguard: if currentPrincipalBalance is positive while installment principal remaining is 0
        if (remPrincipalCents === 0 && toCents(loan.currentPrincipalBalance) > 0) {
          remPrincipalCents = toCents(loan.currentPrincipalBalance);
        }
      } else {
        remPrincipalCents = Math.max(0, toCents(loan.currentPrincipalBalance));
        remInterestCents = Math.max(0, toCents(account?.overdueInterest ?? 0));
        remChargesCents = Math.max(0, toCents(account?.overdueCharges ?? 0));
        remLateFeeCents = loan.lateFeeExempt
          ? 0
          : Math.max(0, toCents(account?.overdueLateFee ?? 0));
        if (remPrincipalCents + remInterestCents + remChargesCents + remLateFeeCents > 0) {
          unpaidInstallmentsCount = Math.max(1, account?.overdueInstallmentsCount ?? 1);
        }
      }
    }

    const totalOwedCents =
      remPrincipalCents + remInterestCents + remChargesCents + remLateFeeCents;

    const fullName =
      loan.applicantDisplayName ||
      (customer ? `${customer.firstName} ${customer.lastName}`.trim() : '') ||
      account?.applicantDisplayName ||
      'Cliente';

    items.push({
      id: loan.id,
      hasLoan: true,
      loan,
      account,
      customer,
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      customerId: loan.customerId,
      applicantDisplayName: fullName,
      documentNumber: customer?.documentNumber ?? '',
      customerPhone: customer?.phone ?? account?.customerPhone ?? '',
      currency: loan.currency,
      status: evaluated?.derivedLoanStatus ?? loan.status,
      dpd: isClosed ? 0 : account?.dpd ?? 0,
      unpaidInstallmentsCount,
      totalInstallmentsCount: evaluatedInsts.length || account?.totalInstallmentsCount || 0,
      remainingPrincipal: fromCents(remPrincipalCents),
      remainingInterest: fromCents(remInterestCents),
      remainingCharges: fromCents(remChargesCents),
      remainingLateFee: fromCents(remLateFeeCents),
      totalOwed: fromCents(totalOwedCents),
      lateFeeExempt: Boolean(loan.lateFeeExempt),
      evaluatedInstallments: evaluatedInsts,
    });
  }

  // Also include customers who don't currently have a disbursed loan so the list covers ALL clients
  for (const c of customers) {
    if (customersWithLoans.has(c.id)) continue;
    const fullName = `${c.firstName} ${c.lastName}`.trim() || 'Cliente';
    items.push({
      id: `cust_${c.id}`,
      hasLoan: false,
      loan: null,
      account: null,
      customer: c,
      loanId: null,
      loanNumber: 'Sin préstamo activo',
      customerId: c.id,
      applicantDisplayName: fullName,
      documentNumber: c.documentNumber ?? '',
      customerPhone: c.phone ?? '',
      currency: 'DOP',
      status: 'SIN_PRESTAMO',
      dpd: 0,
      unpaidInstallmentsCount: 0,
      totalInstallmentsCount: 0,
      remainingPrincipal: 0,
      remainingInterest: 0,
      remainingCharges: 0,
      remainingLateFee: 0,
      totalOwed: 0,
      lateFeeExempt: false,
      evaluatedInstallments: [],
    });
  }

  // Sort: clients with balance > 0 first (highest total owed first), then paid/closed/no-loan alphabetically
  return items.sort((a, b) => {
    const aHasDebt = toCents(a.totalOwed) > 0 ? 1 : 0;
    const bHasDebt = toCents(b.totalOwed) > 0 ? 1 : 0;
    if (aHasDebt !== bHasDebt) return bHasDebt - aHasDebt;
    if (aHasDebt === 1 && toCents(b.totalOwed) !== toCents(a.totalOwed)) {
      return toCents(b.totalOwed) - toCents(a.totalOwed);
    }
    return a.applicantDisplayName.localeCompare(b.applicantDisplayName);
  });
}

/**
 * Computes an exact, cent-safe payoff plan (full payoff, percentage discount, or custom payoff amount)
 * and builds the per-installment settlement updates needed to close the loan cleanly.
 */
export function computeLoanPayoffPlan(params: {
  item: ClientLoanPayoffItem;
  mode: LoanPayoffMode;
  discountPercent?: number;
  customPayoffAmount?: number;
  asOfDateIso?: string;
}): LoanPayoffPlan {
  const {
    item,
    mode,
    discountPercent,
    customPayoffAmount,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  if (!item.loan || !item.loanId) {
    throw new Error('Este cliente no tiene un préstamo activo para generar o aplicar un saldo.');
  }
  if (
    item.loan.status === 'CANCELADO' ||
    item.loan.status === 'CANCELADO_POR_RENOVACION' ||
    item.loan.status === 'PAGADO'
  ) {
    throw new Error('Este préstamo ya se encuentra pagado o cancelado.');
  }

  const totalOwedCents = toCents(item.totalOwed);
  if (totalOwedCents <= 0) {
    throw new Error('Este préstamo no tiene saldo pendiente por liquidar.');
  }

  let discountCents = 0;
  let finalPayoffCents = totalOwedCents;
  let resolvedDiscountPct = 0;

  if (mode === 'FULL_PAYOFF') {
    discountCents = 0;
    finalPayoffCents = totalOwedCents;
    resolvedDiscountPct = 0;
  } else if (mode === 'DISCOUNT_PERCENT') {
    const pct = Number(discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      throw new Error('Ingresa un porcentaje de descuento válido mayor a 0% y menor a 100%.');
    }
    discountCents = Math.round((totalOwedCents * pct) / 100);
    finalPayoffCents = Math.max(1, totalOwedCents - discountCents);
    discountCents = totalOwedCents - finalPayoffCents;
    resolvedDiscountPct = Math.round((discountCents / totalOwedCents) * 10000) / 100;
  } else if (mode === 'CUSTOM_AMOUNT') {
    const customCents = toCents(customPayoffAmount);
    if (!Number.isFinite(customPayoffAmount ?? NaN) || customCents <= 0) {
      throw new Error('Ingresa un monto de saldo válido mayor que cero.');
    }
    if (customCents > totalOwedCents) {
      throw new Error(
        `El saldo otorgado no puede superar el total adeudado (${fromCents(totalOwedCents).toFixed(2)} ${item.currency}).`
      );
    }
    finalPayoffCents = customCents;
    discountCents = totalOwedCents - finalPayoffCents;
    resolvedDiscountPct = Math.round((discountCents / totalOwedCents) * 10000) / 100;
  }

  // Allocate actual collected cash across Principal -> Interest -> Charges -> Late Fee
  // so discounts forgive Late Fee and Interest first before Principal.
  let remainingCashCents = finalPayoffCents;
  const remPrincipalCents = toCents(item.remainingPrincipal);
  const remInterestCents = toCents(item.remainingInterest);
  const remChargesCents = toCents(item.remainingCharges);
  const remLateFeeCents = toCents(item.remainingLateFee);

  const allocatedPrincipalCents = Math.min(remainingCashCents, remPrincipalCents);
  remainingCashCents -= allocatedPrincipalCents;

  const allocatedInterestCents = Math.min(remainingCashCents, remInterestCents);
  remainingCashCents -= allocatedInterestCents;

  const allocatedChargesCents = Math.min(remainingCashCents, remChargesCents);
  remainingCashCents -= allocatedChargesCents;

  const allocatedLateFeeCents = Math.min(remainingCashCents, remLateFeeCents);
  remainingCashCents -= allocatedLateFeeCents;

  const waivedLateFeeInSettlementCents = Math.max(0, remLateFeeCents - allocatedLateFeeCents);

  // Build per-installment settlement updates (oldest installment first)
  let poolP = allocatedPrincipalCents;
  let poolI = allocatedInterestCents;
  let poolC = allocatedChargesCents;
  let poolM = allocatedLateFeeCents;

  const sortedInsts = [...item.evaluatedInstallments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber
  );

  const installmentUpdates: InstallmentPayoffSettlementUpdate[] = [];
  for (const inst of sortedInsts) {
    const rem = computeInstallmentRemaining(inst);
    if (rem.isPaid && inst.status === 'PAGADA') continue;

    const addP = Math.min(poolP, toCents(rem.remPrincipal));
    poolP -= addP;

    const addI = Math.min(poolI, toCents(rem.remInterest));
    poolI -= addI;

    const addC = Math.min(poolC, toCents(rem.remCharges));
    poolC -= addC;

    const instRemLateCents = item.lateFeeExempt ? 0 : toCents(rem.remLateFee);
    const addM = Math.min(poolM, instRemLateCents);
    poolM -= addM;
    const waiveM = Math.max(0, instRemLateCents - addM);

    installmentUpdates.push({
      installmentId: inst.id,
      installmentNumber: inst.installmentNumber,
      nextPaidPrincipal: fromCents(toCents(inst.paidPrincipal ?? 0) + addP),
      nextPaidInterest: fromCents(toCents(inst.paidInterest ?? 0) + addI),
      nextPaidOtherCharges: fromCents(toCents(inst.paidOtherCharges ?? 0) + addC),
      nextPaidLateFee: fromCents(toCents(inst.paidLateFee ?? 0) + addM),
      nextWaivedLateFee: fromCents(toCents(inst.waivedLateFee ?? 0) + waiveM),
      nextStatus: 'PAGADA',
      paidAt: asOfDateIso,
    });
  }

  return {
    mode,
    loanId: item.loanId,
    loanNumber: item.loanNumber,
    applicantDisplayName: item.applicantDisplayName,
    currency: item.currency,
    asOfDateIso,
    remainingPrincipal: item.remainingPrincipal,
    remainingInterest: item.remainingInterest,
    remainingCharges: item.remainingCharges,
    remainingLateFee: item.remainingLateFee,
    totalOwed: fromCents(totalOwedCents),
    discountPercent: resolvedDiscountPct,
    discountAmount: fromCents(discountCents),
    finalPayoffAmount: fromCents(finalPayoffCents),
    allocatedToPrincipal: fromCents(allocatedPrincipalCents),
    allocatedToInterest: fromCents(allocatedInterestCents),
    allocatedToCharges: fromCents(allocatedChargesCents),
    allocatedToLateFee: fromCents(allocatedLateFeeCents),
    waivedLateFeeInSettlement: fromCents(waivedLateFeeInSettlementCents),
    nextPaidPrincipalTotal: fromCents(
      toCents(item.loan.paidPrincipalTotal ?? 0) + allocatedPrincipalCents
    ),
    nextPaidInterestTotal: fromCents(
      toCents(item.loan.paidInterestTotal ?? 0) + allocatedInterestCents
    ),
    nextPaidLateFeeTotal: fromCents(
      toCents(item.loan.paidLateFeeTotal ?? 0) + allocatedLateFeeCents
    ),
    nextWaivedLateFeeTotal: fromCents(
      toCents(item.loan.waivedLateFeeTotal ?? 0) + waivedLateFeeInSettlementCents
    ),
    installmentUpdates,
  };
}

export function buildPayoffQuoteMessage(params: {
  plan: LoanPayoffPlan;
  organizationName: string;
  organizationPhone?: string;
  formatCurrency: (val: number, curr: CurrencyCode) => string;
  note?: string;
}): string {
  const { plan, organizationName, organizationPhone, formatCurrency, note } = params;
  const lines = [
    `*${organizationName} — Detalle de Saldo de Préstamo*`,
    `Cliente: ${plan.applicantDisplayName}`,
    `Préstamo: ${plan.loanNumber}`,
    `Fecha de corte: ${plan.asOfDateIso}`,
    ``,
    `• Capital pendiente: ${formatCurrency(plan.remainingPrincipal, plan.currency)}`,
    `• Interés pendiente: ${formatCurrency(plan.remainingInterest, plan.currency)}`,
  ];
  if (plan.remainingCharges > 0) {
    lines.push(`• Otros cargos: ${formatCurrency(plan.remainingCharges, plan.currency)}`);
  }
  if (plan.remainingLateFee > 0) {
    lines.push(`• Mora pendiente: ${formatCurrency(plan.remainingLateFee, plan.currency)}`);
  }
  lines.push(`• Total adeudado: ${formatCurrency(plan.totalOwed, plan.currency)}`);

  if (plan.discountAmount > 0) {
    lines.push(
      `• Descuento otorgado (${plan.discountPercent.toFixed(2)}%): -${formatCurrency(
        plan.discountAmount,
        plan.currency
      )}`
    );
  }
  lines.push(``);
  lines.push(
    `*SALDO TOTAL A PAGAR: ${formatCurrency(plan.finalPayoffAmount, plan.currency)}*`
  );
  if (note && note.trim()) {
    lines.push(`Nota: ${note.trim()}`);
  }
  if (organizationPhone && organizationPhone.trim()) {
    lines.push(`Teléfono institucional: ${organizationPhone.trim()}`);
  }
  return lines.join('\n');
}
