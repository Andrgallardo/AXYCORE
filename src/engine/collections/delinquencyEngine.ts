import type {
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionBucket,
  CollectionPolicyVersionRecord,
  CollectionStage,
  CollectionStageDefinition,
  CustomerDisputeRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentPromiseRecord,
  PaymentRecord,
} from '../../types/axycore';

export const SANTO_DOMINGO_TZ = 'America/Santo_Domingo';

export function toCents(amount: number | null | undefined): number {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return 0;
  return Math.round(Number(amount) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function getSantoDomingoTodayIso(referenceDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SANTO_DOMINGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getSantoDomingoHour(referenceDate: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTO_DOMINGO_TZ,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(referenceDate);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  return h === 24 ? 0 : h;
}

export function getSantoDomingoWeekday(referenceDate: Date = new Date()): number {
  const wk = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTO_DOMINGO_TZ,
    weekday: 'short',
  }).format(referenceDate);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wk] ?? 1;
}

export function diffCalendarDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = toIso.slice(0, 10).split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86400000);
}

export function addCalendarDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

export const DEFAULT_COLLECTION_STAGES: CollectionStageDefinition[] = [
  {
    stage: 'PREVENTIVA',
    label: 'Cobranza Preventiva (Próximo a vencer / Gracia)',
    minDpd: 0,
    maxDpd: 0,
    suggestedChannel: 'WHATSAPP',
    slaHours: 48,
  },
  {
    stage: 'TEMPRANA',
    label: 'Mora Temprana (1–15 días)',
    minDpd: 1,
    maxDpd: 15,
    suggestedChannel: 'LLAMADA',
    slaHours: 24,
  },
  {
    stage: 'INTERMEDIA',
    label: 'Mora Intermedia (16–30 días)',
    minDpd: 16,
    maxDpd: 30,
    suggestedChannel: 'LLAMADA',
    slaHours: 24,
  },
  {
    stage: 'AVANZADA',
    label: 'Mora Avanzada (31–60 días)',
    minDpd: 31,
    maxDpd: 60,
    suggestedChannel: 'VISITA_CAMPO',
    slaHours: 12,
  },
  {
    stage: 'CRITICA',
    label: 'Mora Crítica / Pre-Legal (61+ días)',
    minDpd: 61,
    maxDpd: null,
    suggestedChannel: 'VISITA_CAMPO',
    slaHours: 8,
  },
];

export const DEFAULT_COLLECTION_POLICY_V1: CollectionPolicyVersionRecord = {
  id: 'col_pol_v1',
  organizationId: 'org_axycore_main',
  version: 'cobranza-v1.0',
  status: 'ACTIVA',
  graceDays: 3,
  lateFeeRateMonthlyPct: 5,
  imputationOrder: ['MORA', 'CARGOS', 'INTERES', 'CAPITAL'],
  stagesConfig: DEFAULT_COLLECTION_STAGES,
  allowedContactHours: {
    startHour: 8,
    endHour: 20,
    allowSundays: false,
  },
  maxDailyContactsPerLoan: 3,
  maxWeeklyBotMessagesPerLoan: 4,
  autoApplyExactBankMatch: false,
  autoMarkBrokenPromises: true,
  requireFinanceApprovalForClosure: true,
  createdBy: 'system',
};

export function mapDpdToBucket(dpd: number): CollectionBucket {
  if (dpd <= 0) return 'AL_DIA';
  if (dpd <= 5) return '1_5';
  if (dpd <= 15) return '6_15';
  if (dpd <= 30) return '16_30';
  if (dpd <= 60) return '31_60';
  if (dpd <= 90) return '61_90';
  return '90_MAS';
}

export function mapDpdToStage(params: {
  dpd: number;
  nextDueDate?: string | null;
  asOfDateIso: string;
  loanStatus: LoanRecord['status'];
  currentPrincipalBalance: number;
  stagesConfig: CollectionStageDefinition[];
}): CollectionStage {
  if (params.loanStatus === 'CANCELADO' || (params.loanStatus === 'PAGADO' && toCents(params.currentPrincipalBalance) <= 0)) {
    return 'CANCELADO';
  }
  if (params.dpd <= 0) {
    if (params.nextDueDate) {
      const daysUntilDue = diffCalendarDays(params.asOfDateIso, params.nextDueDate);
      if (daysUntilDue >= 0 && daysUntilDue <= 3) {
        return 'PREVENTIVA';
      }
    }
    return 'AL_DIA';
  }
  const sorted = [...params.stagesConfig].sort((a, b) => a.minDpd - b.minDpd);
  for (const st of sorted) {
    if (st.stage === 'PREVENTIVA') continue;
    const withinMin = params.dpd >= st.minDpd;
    const withinMax = st.maxDpd === null || params.dpd <= st.maxDpd;
    if (withinMin && withinMax) {
      return st.stage;
    }
  }
  return params.dpd >= 61 ? 'CRITICA' : 'TEMPRANA';
}

export function computeInstallmentRemaining(inst: LoanInstallmentRecord): {
  remPrincipal: number;
  remInterest: number;
  remCharges: number;
  remLateFee: number;
  totalRemaining: number;
  isPaid: boolean;
} {
  const pCents = Math.max(0, toCents(inst.principalAmount) - toCents(inst.paidPrincipal ?? 0));
  const iCents = Math.max(0, toCents(inst.interestAmount) - toCents(inst.paidInterest ?? 0));
  const cCents = Math.max(0, toCents(inst.otherCharges) - toCents(inst.paidOtherCharges ?? 0));
  const mCents = Math.max(
    0,
    toCents(inst.accruedLateFee ?? 0) -
      toCents(inst.paidLateFee ?? 0) -
      toCents(inst.waivedLateFee ?? 0)
  );
  const totalCents = pCents + iCents + cCents + mCents;
  return {
    remPrincipal: fromCents(pCents),
    remInterest: fromCents(iCents),
    remCharges: fromCents(cCents),
    remLateFee: fromCents(mCents),
    totalRemaining: fromCents(totalCents),
    isPaid: inst.status === 'PAGADA' || totalCents === 0,
  };
}

export function computeLateFeeForInstallment(params: {
  installment: LoanInstallmentRecord;
  asOfDateIso: string;
  graceDays: number;
  lateFeeRateMonthlyPct: number;
  lateFeeExempt?: boolean;
}): number {
  const { installment, asOfDateIso, graceDays, lateFeeRateMonthlyPct, lateFeeExempt = false } = params;
  if (lateFeeExempt) {
    return fromCents(toCents(installment.paidLateFee ?? 0));
  }
  const rem = computeInstallmentRemaining(installment);
  if (rem.isPaid || installment.dueDate >= asOfDateIso) {
    return installment.accruedLateFee ?? 0;
  }
  const daysOverdue = diffCalendarDays(installment.dueDate, asOfDateIso);
  if (daysOverdue <= graceDays) {
    return installment.accruedLateFee ?? 0;
  }
  const baseCents = toCents(rem.remPrincipal) + toCents(rem.remInterest);
  const effectiveDays = daysOverdue - graceDays;
  const dailyRate = (lateFeeRateMonthlyPct / 100) / 30;
  const computedCents = Math.round(baseCents * dailyRate * effectiveDays);
  const existingCents = toCents(installment.accruedLateFee ?? 0);
  return fromCents(Math.max(existingCents, computedCents));
}

export interface EvaluatedLoanState {
  account: CollectionAccountRecord;
  updatedInstallments: LoanInstallmentRecord[];
  derivedLoanStatus: LoanRecord['status'];
}

export function evaluateLoanDelinquency(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  customer?: CustomerRecord | null;
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
  existingAccount?: CollectionAccountRecord | null;
  promises?: PaymentPromiseRecord[];
  payments?: PaymentRecord[];
  actions?: CollectionActionRecord[];
  disputes?: CustomerDisputeRecord[];
}): EvaluatedLoanState {
  const {
    loan,
    installments,
    customer,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
    existingAccount,
    promises = [],
    payments = [],
    actions = [],
    disputes = [],
  } = params;

  const sortedInsts = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);

  let maxDpd = 0;
  let overdueInstallmentsCount = 0;
  let paidInstallmentsCount = 0;
  let overduePrincipalCents = 0;
  let overdueInterestCents = 0;
  let overdueLateFeeCents = 0;
  let overdueChargesCents = 0;
  let nextDueDate: string | null = null;
  let nextDueAmount = 0;

  const updatedInstallments: LoanInstallmentRecord[] = sortedInsts.map((inst) => {
    const remBefore = computeInstallmentRemaining(inst);
    if (remBefore.isPaid) {
      paidInstallmentsCount += 1;
      return {
        ...inst,
        status: 'PAGADA',
      };
    }

    const paidSomething =
      toCents(inst.paidPrincipal ?? 0) +
        toCents(inst.paidInterest ?? 0) +
        toCents(inst.paidOtherCharges ?? 0) +
        toCents(inst.paidLateFee ?? 0) >
      0;

    if (inst.dueDate < asOfDateIso && loan.status !== 'CANCELADO' && loan.status !== 'PAGADO') {
      const instDpd = Math.max(0, diffCalendarDays(inst.dueDate, asOfDateIso));
      if (instDpd > maxDpd) maxDpd = instDpd;
      overdueInstallmentsCount += 1;

      const accruedLateFee = computeLateFeeForInstallment({
        installment: inst,
        asOfDateIso,
        graceDays: policy.graceDays,
        lateFeeRateMonthlyPct: policy.lateFeeRateMonthlyPct,
        lateFeeExempt: Boolean(loan.lateFeeExempt),
      });
      const remLateCents = loan.lateFeeExempt
        ? 0
        : Math.max(
            0,
            toCents(accruedLateFee) -
              toCents(inst.paidLateFee ?? 0) -
              toCents(inst.waivedLateFee ?? 0)
          );

      overduePrincipalCents += toCents(remBefore.remPrincipal);
      overdueInterestCents += toCents(remBefore.remInterest);
      overdueChargesCents += toCents(remBefore.remCharges);
      overdueLateFeeCents += remLateCents;

      return {
        ...inst,
        accruedLateFee,
        status: 'VENCIDA',
      };
    }

    if (!nextDueDate) {
      nextDueDate = inst.dueDate;
      nextDueAmount = remBefore.totalRemaining;
    }

    return {
      ...inst,
      status: paidSomething ? 'PARCIAL' : 'PENDIENTE',
    };
  });

  const overdueTotalCents =
    overduePrincipalCents + overdueInterestCents + overdueChargesCents + overdueLateFeeCents;

  // Derived loan status respects CANCELADO, PAGADO (0 principal), and VENCIDO even when loan_installments is empty (e.g. migrated loans)
  let derivedLoanStatus: LoanRecord['status'] = loan.status;
  if (loan.status === 'CANCELADO') {
    derivedLoanStatus = 'CANCELADO';
    maxDpd = 0;
  } else if (
    toCents(loan.currentPrincipalBalance) <= 0 &&
    (updatedInstallments.length > 0
      ? paidInstallmentsCount === updatedInstallments.length
      : loan.status === 'PAGADO')
  ) {
    derivedLoanStatus = 'PAGADO';
    maxDpd = 0;
  } else if (maxDpd > 0) {
    derivedLoanStatus = 'VENCIDO';
  } else if (updatedInstallments.length === 0 && loan.status === 'VENCIDO') {
    derivedLoanStatus = 'VENCIDO';
    const fallbackDpd =
      loan.firstPaymentDate && loan.firstPaymentDate < asOfDateIso
        ? diffCalendarDays(loan.firstPaymentDate, asOfDateIso)
        : 0;
    maxDpd = Math.max(existingAccount?.dpd ?? 0, fallbackDpd, 1);
  } else {
    derivedLoanStatus = 'ACTIVO';
  }

  const resolvedNextDueDate =
    nextDueDate ??
    existingAccount?.nextDueDate ??
    (derivedLoanStatus === 'ACTIVO' ? loan.firstPaymentDate ?? null : null);
  const resolvedNextDueAmount = nextDueAmount > 0 ? nextDueAmount : existingAccount?.nextDueAmount ?? 0;

  const bucket = mapDpdToBucket(maxDpd);
  const stage = mapDpdToStage({
    dpd: maxDpd,
    nextDueDate: resolvedNextDueDate,
    asOfDateIso,
    loanStatus: derivedLoanStatus,
    currentPrincipalBalance: loan.currentPrincipalBalance,
    stagesConfig: policy.stagesConfig,
  });

  // Promises, pending payments, actions, disputes belonging to this loan
  const loanPromises = promises.filter((p) => p.loanId === loan.id);
  const activePromise = loanPromises.find((p) =>
    ['VIGENTE', 'PENDIENTE_VERIFICACION'].includes(p.status)
  );
  const brokenPromisesCount = loanPromises.filter((p) => p.status === 'INCUMPLIDA').length;

  const loanPayments = payments.filter((p) => p.loanId === loan.id);
  const pendingVerificationCents = loanPayments
    .filter((p) => ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status))
    .reduce((acc, p) => acc + toCents(p.amount), 0);

  const appliedPayments = loanPayments
    .filter((p) => p.status === 'APLICADO')
    .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));

  const loanActions = actions
    .filter((a) => a.loanId === loan.id)
    .sort((a, b) => (b.actionTimeIso || '').localeCompare(a.actionTimeIso || ''));

  const openDisputes = disputes.filter(
    (d) => d.loanId === loan.id && ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status)
  );

  // Separate Behavior Indicator (NOT Origination Score V2)
  let behaviorScore = 920;
  behaviorScore -= Math.min(480, maxDpd * 6);
  behaviorScore -= brokenPromisesCount * 85;
  behaviorScore -= overdueInstallmentsCount * 35;
  if (appliedPayments.length > 0 && maxDpd === 0) behaviorScore += 35;
  behaviorScore = Math.max(50, Math.min(1000, Math.round(behaviorScore)));

  const behaviorBand: CollectionAccountRecord['behaviorBand'] =
    behaviorScore >= 850
      ? 'EXCELENTE'
      : behaviorScore >= 700
      ? 'BUENO'
      : behaviorScore >= 500
      ? 'ATENCION'
      : behaviorScore >= 300
      ? 'RIESGO_ALTO'
      : 'CRITICO';

  const maxHistoricalDpd = Math.max(existingAccount?.maxHistoricalDpd ?? 0, maxDpd);

  const preserveFallbackOverdue =
    updatedInstallments.length === 0 &&
    derivedLoanStatus === 'VENCIDO' &&
    overdueTotalCents === 0;

  const resolvedOverduePrincipal = preserveFallbackOverdue
    ? existingAccount?.overduePrincipal && existingAccount.overduePrincipal > 0
      ? existingAccount.overduePrincipal
      : fromCents(toCents(loan.currentPrincipalBalance))
    : fromCents(overduePrincipalCents);
  const resolvedOverdueInterest = preserveFallbackOverdue
    ? existingAccount?.overdueInterest ?? 0
    : fromCents(overdueInterestCents);
  const resolvedOverdueLateFee = loan.lateFeeExempt
    ? 0
    : preserveFallbackOverdue
    ? Math.max(
        0,
        fromCents(
          toCents(existingAccount?.overdueLateFee ?? 0) - toCents(loan.waivedLateFeeTotal ?? 0)
        )
      )
    : fromCents(overdueLateFeeCents);
  const resolvedOverdueCharges = preserveFallbackOverdue
    ? existingAccount?.overdueCharges ?? 0
    : fromCents(overdueChargesCents);
  const resolvedOverdueTotal = preserveFallbackOverdue
    ? fromCents(
        toCents(resolvedOverduePrincipal) +
          toCents(resolvedOverdueInterest) +
          toCents(resolvedOverdueCharges) +
          toCents(resolvedOverdueLateFee)
      )
    : fromCents(overdueTotalCents);
  const resolvedOverdueInstallmentsCount = preserveFallbackOverdue
    ? Math.max(existingAccount?.overdueInstallmentsCount ?? 0, 1)
    : overdueInstallmentsCount;

  const account: CollectionAccountRecord = {
    id: loan.id,
    organizationId: loan.organizationId,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    applicationId: loan.applicationId,
    customerId: loan.customerId,
    applicantDisplayName: loan.applicantDisplayName,
    customerPhone: customer?.phone ?? existingAccount?.customerPhone ?? '',
    customerEmail: customer?.email ?? existingAccount?.customerEmail ?? '',
    province: customer?.province ?? existingAccount?.province ?? '',
    municipality: customer?.municipality ?? existingAccount?.municipality ?? '',
    branchName: existingAccount?.branchName ?? customer?.province ?? 'Principal',
    productCode: loan.productCode,
    currency: loan.currency,
    dpd: maxDpd,
    maxHistoricalDpd,
    stage,
    bucket,
    priority: maxDpd >= 31 || brokenPromisesCount >= 2 ? 'CRITICA' : maxDpd >= 6 ? 'ALTA' : maxDpd >= 1 ? 'MEDIA' : 'BAJA',
    priorityScore: Math.min(100, maxDpd + brokenPromisesCount * 15 + (resolvedOverdueInstallmentsCount * 5)),
    priorityReasons: existingAccount?.priorityReasons ?? [],
    overdueInstallmentsCount: resolvedOverdueInstallmentsCount,
    totalInstallmentsCount: updatedInstallments.length || existingAccount?.totalInstallmentsCount || 0,
    paidInstallmentsCount,
    overduePrincipal: resolvedOverduePrincipal,
    overdueInterest: resolvedOverdueInterest,
    overdueLateFee: resolvedOverdueLateFee,
    overdueCharges: resolvedOverdueCharges,
    overdueTotalAmount: resolvedOverdueTotal,
    totalOutstandingPrincipal: fromCents(toCents(loan.currentPrincipalBalance)),
    nextDueDate: resolvedNextDueDate,
    nextDueAmount: resolvedNextDueAmount,
    lastPaymentDate: appliedPayments[0]?.paymentDate ?? existingAccount?.lastPaymentDate ?? null,
    lastPaymentAmount: appliedPayments[0]?.amount ?? existingAccount?.lastPaymentAmount ?? 0,
    pendingVerificationAmount: fromCents(pendingVerificationCents),
    assignedCollectorId: existingAccount?.assignedCollectorId ?? null,
    assignedCollectorName: existingAccount?.assignedCollectorName ?? null,
    lastActionAt: loanActions[0]?.actionTimeIso ?? existingAccount?.lastActionAt ?? null,
    lastActionType: loanActions[0]?.channel ?? existingAccount?.lastActionType ?? null,
    lastActionResult: loanActions[0]?.contactResult ?? existingAccount?.lastActionResult ?? null,
    nextFollowUpDate: loanActions[0]?.nextActionDate ?? existingAccount?.nextFollowUpDate ?? null,
    activePromiseId: activePromise?.id ?? null,
    activePromiseDate: activePromise?.promisedDate ?? null,
    activePromiseAmount: activePromise?.promisedAmount ?? null,
    brokenPromisesCount,
    behaviorScore,
    behaviorBand,
    isRestructured: existingAccount?.isRestructured ?? false,
    hasOpenDispute: openDisputes.length > 0,
    lateFeeExempt: Boolean(loan.lateFeeExempt),
    waivedLateFeeTotal: fromCents(toCents(loan.waivedLateFeeTotal ?? 0)),
    consentWhatsAppOptIn: existingAccount?.consentWhatsAppOptIn ?? true,
    closedAt: loan.closedAt ?? existingAccount?.closedAt ?? null,
    closureCertificateNumber: loan.closureCertificateNumber ?? existingAccount?.closureCertificateNumber ?? null,
    cutoffDate: asOfDateIso,
  };

  return {
    account,
    updatedInstallments,
    derivedLoanStatus,
  };
}

/**
 * Reconciles persisted/migrated collection_accounts snapshots against the live state of
 * loans, installments, payments, promises, actions, and disputes so queues like
 * "Cobros del día" immediately reflect applied payments without waiting for a manual sync,
 * and every persisted/migrated loan appears in Collections even before installments sync.
 */
export function reconcileLiveCollectionAccounts(params: {
  loans: LoanRecord[];
  installments: LoanInstallmentRecord[];
  existingAccounts: CollectionAccountRecord[];
  customers?: CustomerRecord[];
  payments?: PaymentRecord[];
  promises?: PaymentPromiseRecord[];
  actions?: CollectionActionRecord[];
  disputes?: CustomerDisputeRecord[];
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
}): CollectionAccountRecord[] {
  const {
    loans,
    installments,
    existingAccounts,
    customers = [],
    payments = [],
    promises = [],
    actions = [],
    disputes = [],
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const existingByLoanId = new Map<string, CollectionAccountRecord>();
  for (const acc of existingAccounts) {
    existingByLoanId.set(acc.loanId, acc);
  }

  const customerById = new Map<string, CustomerRecord>();
  for (const c of customers) {
    customerById.set(c.id, c);
  }

  const instsByLoanId = new Map<string, LoanInstallmentRecord[]>();
  for (const inst of installments) {
    const arr = instsByLoanId.get(inst.loanId);
    if (arr) arr.push(inst);
    else instsByLoanId.set(inst.loanId, [inst]);
  }

  const paymentsByLoanId = new Map<string, PaymentRecord[]>();
  for (const p of payments) {
    const arr = paymentsByLoanId.get(p.loanId);
    if (arr) arr.push(p);
    else paymentsByLoanId.set(p.loanId, [p]);
  }

  const promisesByLoanId = new Map<string, PaymentPromiseRecord[]>();
  for (const pr of promises) {
    const arr = promisesByLoanId.get(pr.loanId);
    if (arr) arr.push(pr);
    else promisesByLoanId.set(pr.loanId, [pr]);
  }

  const actionsByLoanId = new Map<string, CollectionActionRecord[]>();
  for (const act of actions) {
    const arr = actionsByLoanId.get(act.loanId);
    if (arr) arr.push(act);
    else actionsByLoanId.set(act.loanId, [act]);
  }

  const disputesByLoanId = new Map<string, CustomerDisputeRecord[]>();
  for (const disp of disputes) {
    const arr = disputesByLoanId.get(disp.loanId);
    if (arr) arr.push(disp);
    else disputesByLoanId.set(disp.loanId, [disp]);
  }

  const result: CollectionAccountRecord[] = [];
  const seenLoanIds = new Set<string>();

  for (const loan of loans) {
    seenLoanIds.add(loan.id);
    const existingAcc = existingByLoanId.get(loan.id) ?? null;
    const loanInsts = instsByLoanId.get(loan.id) ?? [];
    const customer = customerById.get(loan.customerId) ?? null;
    const loanPays = paymentsByLoanId.get(loan.id) ?? [];
    const loanPromises = promisesByLoanId.get(loan.id) ?? [];
    const loanActs = actionsByLoanId.get(loan.id) ?? [];
    const loanDisputes = disputesByLoanId.get(loan.id) ?? [];

    if (loanInsts.length > 0 || !existingAcc) {
      const evaluated = evaluateLoanDelinquency({
        loan,
        installments: loanInsts,
        customer,
        policy,
        asOfDateIso,
        existingAccount: existingAcc,
        promises: loanPromises,
        payments: loanPays,
        actions: loanActs,
        disputes: loanDisputes,
      });
      result.push(evaluated.account);
      continue;
    }

    // existingAcc exists & loanInsts is empty: preserve snapshot DPD/overdue metrics while refreshing live balances, customer contact, and latest payments/actions/promises
    const isClosed =
      loan.status === 'CANCELADO' ||
      loan.status === 'PAGADO' ||
      toCents(loan.currentPrincipalBalance) <= 0;
    const appliedPays = loanPays
      .filter((p) => p.status === 'APLICADO')
      .sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
    const pendingVerificationCents = loanPays
      .filter((p) => ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status))
      .reduce((acc, p) => acc + toCents(p.amount), 0);
    const activePromise = loanPromises.find((p) =>
      ['VIGENTE', 'PENDIENTE_VERIFICACION'].includes(p.status)
    );
    const sortedActs = [...loanActs].sort((a, b) =>
      (b.actionTimeIso || '').localeCompare(a.actionTimeIso || '')
    );

    if (isClosed) {
      result.push({
        ...existingAcc,
        customerPhone: customer?.phone || existingAcc.customerPhone || '',
        customerEmail: customer?.email || existingAcc.customerEmail || '',
        province: customer?.province || existingAcc.province || '',
        municipality: customer?.municipality || existingAcc.municipality || '',
        dpd: 0,
        stage: 'CANCELADO',
        bucket: 'AL_DIA',
        priority: 'BAJA',
        overdueInstallmentsCount: 0,
        overduePrincipal: 0,
        overdueInterest: 0,
        overdueLateFee: 0,
        overdueCharges: 0,
        overdueTotalAmount: 0,
        totalOutstandingPrincipal: 0,
        lastPaymentDate: appliedPays[0]?.paymentDate ?? existingAcc.lastPaymentDate ?? null,
        lastPaymentAmount: appliedPays[0]?.amount ?? existingAcc.lastPaymentAmount ?? 0,
        lastActionAt: sortedActs[0]?.actionTimeIso ?? existingAcc.lastActionAt ?? null,
        lastActionType: sortedActs[0]?.channel ?? existingAcc.lastActionType ?? null,
        lastActionResult: sortedActs[0]?.contactResult ?? existingAcc.lastActionResult ?? null,
        cutoffDate: asOfDateIso,
      });
    } else {
      const effectiveOverdueLateFee = loan.lateFeeExempt
        ? 0
        : existingAcc.overdueLateFee ?? 0;
      const effectiveOverdueTotal = loan.lateFeeExempt
        ? fromCents(
            Math.max(
              0,
              toCents(existingAcc.overduePrincipal ?? 0) +
                toCents(existingAcc.overdueInterest ?? 0) +
                toCents(existingAcc.overdueCharges ?? 0)
            )
          )
        : existingAcc.overdueTotalAmount;
      result.push({
        ...existingAcc,
        customerPhone: customer?.phone || existingAcc.customerPhone || '',
        customerEmail: customer?.email || existingAcc.customerEmail || '',
        province: customer?.province || existingAcc.province || '',
        municipality: customer?.municipality || existingAcc.municipality || '',
        overdueLateFee: effectiveOverdueLateFee,
        overdueTotalAmount: effectiveOverdueTotal,
        lateFeeExempt: Boolean(loan.lateFeeExempt),
        waivedLateFeeTotal: fromCents(toCents(loan.waivedLateFeeTotal ?? 0)),
        totalOutstandingPrincipal: fromCents(toCents(loan.currentPrincipalBalance)),
        pendingVerificationAmount: fromCents(pendingVerificationCents),
        lastPaymentDate: appliedPays[0]?.paymentDate ?? existingAcc.lastPaymentDate ?? null,
        lastPaymentAmount: appliedPays[0]?.amount ?? existingAcc.lastPaymentAmount ?? 0,
        lastActionAt: sortedActs[0]?.actionTimeIso ?? existingAcc.lastActionAt ?? null,
        lastActionType: sortedActs[0]?.channel ?? existingAcc.lastActionType ?? null,
        lastActionResult: sortedActs[0]?.contactResult ?? existingAcc.lastActionResult ?? null,
        nextFollowUpDate: sortedActs[0]?.nextActionDate ?? existingAcc.nextFollowUpDate ?? null,
        activePromiseId: activePromise?.id ?? existingAcc.activePromiseId ?? null,
        activePromiseDate: activePromise?.promisedDate ?? existingAcc.activePromiseDate ?? null,
        activePromiseAmount: activePromise?.promisedAmount ?? existingAcc.activePromiseAmount ?? null,
      });
    }
  }

  // Keep any orphan persisted account whose loan was not yet loaded
  for (const acc of existingAccounts) {
    if (!seenLoanIds.has(acc.loanId)) {
      result.push(acc);
    }
  }

  return result;
}

