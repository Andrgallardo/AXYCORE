import type {
  CollectionAccountRecord,
  CollectionPolicyVersionRecord,
  CurrencyCode,
  LoanInstallmentRecord,
  LoanRecord,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  computeLateFeeForInstallment,
  diffCalendarDays,
  evaluateLoanDelinquency,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from './delinquencyEngine';

export type LateFeeDiscountMode =
  | 'PERMANENT_EXEMPT'
  | 'CLEAR_CURRENT_KEEP_NORMAL'
  | 'SPECIFIC_AMOUNT';

export interface InstallmentPendingLateFeeItem {
  installment: LoanInstallmentRecord;
  installmentNumber: number;
  dueDate: string;
  daysOverdue: number;
  grossAccruedLateFee: number;
  paidLateFee: number;
  waivedLateFee: number;
  pendingLateFee: number;
}

export interface LoanWithPendingLateFee {
  loan: LoanRecord;
  account: CollectionAccountRecord;
  loanId: string;
  loanNumber: string;
  customerId: string;
  applicantDisplayName: string;
  customerPhone: string;
  currency: CurrencyCode;
  dpd: number;
  overdueInstallmentsCount: number;
  pendingLateFee: number;
  waivedLateFeeTotal: number;
  overdueTotalAmount: number;
  totalOutstandingPrincipal: number;
  installmentsWithLateFee: InstallmentPendingLateFeeItem[];
}

export interface InstallmentLateFeeDiscountUpdate {
  installmentId: string;
  installmentNumber: number;
  previousAccruedLateFee: number;
  nextAccruedLateFee: number;
  previousWaivedLateFee: number;
  nextWaivedLateFee: number;
  discountApplied: number;
  remainingLateFeeAfter: number;
}

export interface LateFeeDiscountPlan {
  mode: LateFeeDiscountMode;
  loanId: string;
  loanNumber: string;
  currency: CurrencyCode;
  previousLateFee: number;
  discountAmount: number;
  nextLateFee: number;
  nextWaivedLateFeeTotal: number;
  nextLateFeeExempt: boolean;
  nextAccountOverdueLateFee: number;
  nextAccountOverdueTotal: number;
  installmentUpdates: InstallmentLateFeeDiscountUpdate[];
}

export function getInstallmentPendingLateFeeCents(
  inst: LoanInstallmentRecord,
  lateFeeExempt = false
): number {
  if (lateFeeExempt) return 0;
  return Math.max(
    0,
    toCents(inst.accruedLateFee ?? 0) -
      toCents(inst.paidLateFee ?? 0) -
      toCents(inst.waivedLateFee ?? 0)
  );
}

/**
 * Returns ONLY clients/loans that currently have effective pending Mora > 0.
 * Loans that are CANCELADO, PAGADO, or permanently exempt from Mora are strictly excluded.
 */
export function listLoansWithPendingLateFee(params: {
  loans: LoanRecord[];
  collectionAccounts: CollectionAccountRecord[];
  installments: LoanInstallmentRecord[];
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
}): LoanWithPendingLateFee[] {
  const {
    loans,
    collectionAccounts,
    installments,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

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

  const items: LoanWithPendingLateFee[] = [];

  for (const loan of loans) {
    if (loan.status === 'CANCELADO' || loan.status === 'CANCELADO_POR_RENOVACION' || loan.status === 'PAGADO') continue;
    if (loan.lateFeeExempt) continue;

    const existingAcc = accountByLoanId.get(loan.id) ?? null;
    const loanInsts = instsByLoanId.get(loan.id) ?? [];

    const evaluated =
      loanInsts.length > 0 || !existingAcc
        ? evaluateLoanDelinquency({
            loan,
            installments: loanInsts,
            policy,
            asOfDateIso,
            existingAccount: existingAcc,
          })
        : null;

    const account = evaluated?.account ?? existingAcc;
    if (!account) continue;

    const evaluatedInsts = evaluated?.updatedInstallments ?? loanInsts;
    const installmentsWithLateFee: InstallmentPendingLateFeeItem[] = [];
    let pendingFromInstsCents = 0;

    for (const inst of evaluatedInsts) {
      if (inst.status === 'PAGADA') continue;
      const grossAccrued = computeLateFeeForInstallment({
        installment: inst,
        asOfDateIso,
        graceDays: policy.graceDays,
        lateFeeRateMonthlyPct: policy.lateFeeRateMonthlyPct,
        lateFeeExempt: Boolean(loan.lateFeeExempt),
      });
      const paidCents = toCents(inst.paidLateFee ?? 0);
      const waivedCents = toCents(inst.waivedLateFee ?? 0);
      const pendingCents = Math.max(0, toCents(grossAccrued) - paidCents - waivedCents);
      if (pendingCents > 0) {
        pendingFromInstsCents += pendingCents;
        installmentsWithLateFee.push({
          installment: { ...inst, accruedLateFee: grossAccrued },
          installmentNumber: inst.installmentNumber,
          dueDate: inst.dueDate,
          daysOverdue: Math.max(0, diffCalendarDays(inst.dueDate, asOfDateIso)),
          grossAccruedLateFee: grossAccrued,
          paidLateFee: fromCents(paidCents),
          waivedLateFee: fromCents(waivedCents),
          pendingLateFee: fromCents(pendingCents),
        });
      }
    }

    const totalPendingCents =
      loanInsts.length > 0 ? pendingFromInstsCents : toCents(account.overdueLateFee ?? 0);

    if (totalPendingCents <= 0) continue;

    items.push({
      loan,
      account: {
        ...account,
        overdueLateFee: fromCents(totalPendingCents),
      },
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      customerId: loan.customerId,
      applicantDisplayName: loan.applicantDisplayName || account.applicantDisplayName,
      customerPhone: account.customerPhone ?? '',
      currency: loan.currency,
      dpd: account.dpd,
      overdueInstallmentsCount:
        installmentsWithLateFee.length > 0
          ? installmentsWithLateFee.length
          : account.overdueInstallmentsCount,
      pendingLateFee: fromCents(totalPendingCents),
      waivedLateFeeTotal: fromCents(toCents(loan.waivedLateFeeTotal ?? 0)),
      overdueTotalAmount: account.overdueTotalAmount,
      totalOutstandingPrincipal: fromCents(toCents(loan.currentPrincipalBalance)),
      installmentsWithLateFee: installmentsWithLateFee.sort(
        (a, b) => a.installmentNumber - b.installmentNumber
      ),
    });
  }

  return items.sort(
    (a, b) =>
      toCents(b.pendingLateFee) - toCents(a.pendingLateFee) ||
      b.dpd - a.dpd ||
      a.applicantDisplayName.localeCompare(b.applicantDisplayName)
  );
}

/**
 * Computes an exact, cent-safe Mora discount or permanent Mora exemption plan
 * for a loan and its overdue installments.
 */
export function computeLateFeeDiscountPlan(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  account?: CollectionAccountRecord | null;
  mode: LateFeeDiscountMode;
  amount?: number;
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
}): LateFeeDiscountPlan {
  const {
    loan,
    installments,
    account,
    mode,
    amount,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  if (loan.status === 'CANCELADO' || loan.status === 'CANCELADO_POR_RENOVACION' || loan.status === 'PAGADO') {
    throw new Error('No se pueden aplicar descuentos de mora a un préstamo cerrado o cancelado.');
  }

  const sortedInsts = [...installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber
  );

  // Build current live Mora state per installment
  const instLiveEntries = sortedInsts.map((inst) => {
    const grossAccrued =
      inst.status === 'PAGADA'
        ? inst.accruedLateFee ?? 0
        : computeLateFeeForInstallment({
            installment: inst,
            asOfDateIso,
            graceDays: policy.graceDays,
            lateFeeRateMonthlyPct: policy.lateFeeRateMonthlyPct,
            lateFeeExempt: Boolean(loan.lateFeeExempt),
          });
    const paidCents = toCents(inst.paidLateFee ?? 0);
    const waivedCents = toCents(inst.waivedLateFee ?? 0);
    const pendingCents =
      inst.status === 'PAGADA' || loan.lateFeeExempt
        ? 0
        : Math.max(0, toCents(grossAccrued) - paidCents - waivedCents);

    return {
      inst,
      grossAccruedCents: toCents(grossAccrued),
      paidCents,
      waivedCents,
      pendingCents,
    };
  });

  const hasInstallments = sortedInsts.length > 0;
  const totalPendingCents = hasInstallments
    ? instLiveEntries.reduce((sum, e) => sum + e.pendingCents, 0)
    : loan.lateFeeExempt
    ? 0
    : toCents(account?.overdueLateFee ?? 0);

  if (totalPendingCents <= 0 && mode !== 'PERMANENT_EXEMPT') {
    throw new Error('Este cliente no tiene mora pendiente para descontar o eliminar.');
  }

  let targetDiscountCents = totalPendingCents;
  if (mode === 'SPECIFIC_AMOUNT') {
    const requestedCents = toCents(amount);
    if (!Number.isFinite(amount ?? NaN) || requestedCents <= 0) {
      throw new Error('Ingresa un monto de descuento de mora mayor a cero.');
    }
    if (requestedCents > totalPendingCents) {
      throw new Error(
        `El monto a descontar no puede superar la mora pendiente actual (${fromCents(totalPendingCents).toFixed(2)} ${loan.currency}).`
      );
    }
    targetDiscountCents = requestedCents;
  }

  let remainingToWaiveCents = targetDiscountCents;
  const installmentUpdates: InstallmentLateFeeDiscountUpdate[] = [];

  for (const entry of instLiveEntries) {
    if (entry.pendingCents <= 0) continue;

    const applyCents =
      mode === 'PERMANENT_EXEMPT' || mode === 'CLEAR_CURRENT_KEEP_NORMAL'
        ? entry.pendingCents
        : Math.min(remainingToWaiveCents, entry.pendingCents);

    if (applyCents <= 0) continue;

    const nextWaivedCents = entry.waivedCents + applyCents;
    const nextAccruedCents =
      mode === 'PERMANENT_EXEMPT' ? entry.paidCents : entry.grossAccruedCents;
    const remainingAfterCents =
      mode === 'PERMANENT_EXEMPT' || mode === 'CLEAR_CURRENT_KEEP_NORMAL'
        ? 0
        : Math.max(0, nextAccruedCents - entry.paidCents - nextWaivedCents);

    installmentUpdates.push({
      installmentId: entry.inst.id,
      installmentNumber: entry.inst.installmentNumber,
      previousAccruedLateFee: fromCents(toCents(entry.inst.accruedLateFee ?? 0)),
      nextAccruedLateFee: fromCents(nextAccruedCents),
      previousWaivedLateFee: fromCents(entry.waivedCents),
      nextWaivedLateFee: fromCents(nextWaivedCents),
      discountApplied: fromCents(applyCents),
      remainingLateFeeAfter: fromCents(remainingAfterCents),
    });

    remainingToWaiveCents = Math.max(0, remainingToWaiveCents - applyCents);
  }

  const nextLateFeeCents =
    mode === 'PERMANENT_EXEMPT' || mode === 'CLEAR_CURRENT_KEEP_NORMAL'
      ? 0
      : Math.max(0, totalPendingCents - targetDiscountCents);
  const nextWaivedLateFeeTotalCents =
    toCents(loan.waivedLateFeeTotal ?? 0) + targetDiscountCents;

  const baseOverdueWithoutLateFeeCents = account
    ? Math.max(
        0,
        toCents(account.overduePrincipal ?? 0) +
          toCents(account.overdueInterest ?? 0) +
          toCents(account.overdueCharges ?? 0)
      )
    : 0;
  const nextAccountOverdueTotalCents = baseOverdueWithoutLateFeeCents + nextLateFeeCents;

  return {
    mode,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    currency: loan.currency,
    previousLateFee: fromCents(totalPendingCents),
    discountAmount: fromCents(targetDiscountCents),
    nextLateFee: fromCents(nextLateFeeCents),
    nextWaivedLateFeeTotal: fromCents(nextWaivedLateFeeTotalCents),
    nextLateFeeExempt: mode === 'PERMANENT_EXEMPT' ? true : Boolean(loan.lateFeeExempt),
    nextAccountOverdueLateFee: fromCents(nextLateFeeCents),
    nextAccountOverdueTotal: fromCents(nextAccountOverdueTotalCents),
    installmentUpdates,
  };
}
