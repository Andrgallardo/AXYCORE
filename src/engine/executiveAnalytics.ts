import type {
  ApplicationRecord,
  AuditLogRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CreditPermission,
  CurrencyCode,
  ExecutivePeriodPreset,
  LoanInstallmentRecord,
  LoanRecord,
  NavSectionId,
  PaymentPromiseRecord,
  PaymentRecord,
  RiskAlertRecord,
  UserProfile,
} from '../types/axycore';
import { getSantoDomingoTodayIso } from './collections/delinquencyEngine';
import { APPLICATION_STATUS_LABELS, formatMoney, formatTimestamp } from '../utils/formatters';

export const SANTO_DOMINGO_TIMEZONE = 'America/Santo_Domingo';

export interface SantoDomingoClockInfo {
  greeting: 'Buenos días' | 'Buenas tardes' | 'Buenas noches';
  formattedDate: string;
  formattedTime: string;
  todayIso: string;
  currentMonthYm: string;
}

export function getSantoDomingoClockInfo(now: Date = new Date()): SantoDomingoClockInfo {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: SANTO_DOMINGO_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const hour = Number.parseInt(hourStr, 10) || 0;

  let greeting: SantoDomingoClockInfo['greeting'] = 'Buenas noches';
  if (hour >= 5 && hour < 12) {
    greeting = 'Buenos días';
  } else if (hour >= 12 && hour < 19) {
    greeting = 'Buenas tardes';
  }

  const formattedDate = new Intl.DateTimeFormat('es-DO', {
    timeZone: SANTO_DOMINGO_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const formattedTime = new Intl.DateTimeFormat('es-DO', {
    timeZone: SANTO_DOMINGO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(now);

  const todayIso = getSantoDomingoTodayIso(now);
  return {
    greeting,
    formattedDate: formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1),
    formattedTime,
    todayIso,
    currentMonthYm: todayIso.slice(0, 7),
  };
}

export function extractIsoDateFromTimestamp(ts: unknown): string | null {
  if (!ts) return null;
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return getSantoDomingoTodayIso(parsed);
    return null;
  }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') {
      return getSantoDomingoTodayIso(obj.toDate());
    }
    if (typeof obj.seconds === 'number') {
      return getSantoDomingoTodayIso(new Date(obj.seconds * 1000));
    }
  }
  return null;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export interface PeriodBounds {
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
  label: string;
}

export function resolvePeriodBounds(
  preset: ExecutivePeriodPreset,
  customStartIso?: string,
  customEndIso?: string,
  todayIso: string = getSantoDomingoTodayIso()
): PeriodBounds {
  if (preset === 'TODAY') {
    return {
      startIso: todayIso,
      endIso: todayIso,
      prevStartIso: addDaysIso(todayIso, -1),
      prevEndIso: addDaysIso(todayIso, -1),
      label: 'Hoy',
    };
  }
  if (preset === 'LAST_7D') {
    const startIso = addDaysIso(todayIso, -6);
    return {
      startIso,
      endIso: todayIso,
      prevStartIso: addDaysIso(startIso, -7),
      prevEndIso: addDaysIso(startIso, -1),
      label: 'Últimos 7 días',
    };
  }
  if (preset === 'CURRENT_MONTH') {
    const startIso = `${todayIso.slice(0, 7)}-01`;
    const [y, m] = todayIso.slice(0, 7).split('-').map(Number);
    const prevMonthDate = new Date(Date.UTC(y, (m || 1) - 2, 1));
    const prevEndDate = new Date(Date.UTC(y, (m || 1) - 1, 0));
    return {
      startIso,
      endIso: todayIso,
      prevStartIso: prevMonthDate.toISOString().slice(0, 10),
      prevEndIso: prevEndDate.toISOString().slice(0, 10),
      label: 'Mes actual',
    };
  }
  if (preset === 'LAST_30D') {
    const startIso = addDaysIso(todayIso, -29);
    return {
      startIso,
      endIso: todayIso,
      prevStartIso: addDaysIso(startIso, -30),
      prevEndIso: addDaysIso(startIso, -1),
      label: 'Últimos 30 días',
    };
  }
  if (preset === 'LAST_90D') {
    const startIso = addDaysIso(todayIso, -89);
    return {
      startIso,
      endIso: todayIso,
      prevStartIso: addDaysIso(startIso, -90),
      prevEndIso: addDaysIso(startIso, -1),
      label: 'Últimos 90 días',
    };
  }
  if (preset === 'CURRENT_YEAR') {
    const year = Number(todayIso.slice(0, 4));
    const startIso = `${year}-01-01`;
    return {
      startIso,
      endIso: todayIso,
      prevStartIso: `${year - 1}-01-01`,
      prevEndIso: `${year - 1}-12-31`,
      label: `Año ${year}`,
    };
  }

  const start = customStartIso && /^\d{4}-\d{2}-\d{2}$/.test(customStartIso) ? customStartIso : addDaysIso(todayIso, -29);
  const end = customEndIso && /^\d{4}-\d{2}-\d{2}$/.test(customEndIso) ? customEndIso : todayIso;
  const safeStart = start <= end ? start : end;
  const safeEnd = start <= end ? end : start;
  const diffDays = Math.max(
    1,
    Math.round((Date.parse(safeEnd) - Date.parse(safeStart)) / 86400000) + 1
  );
  return {
    startIso: safeStart,
    endIso: safeEnd,
    prevStartIso: addDaysIso(safeStart, -diffDays),
    prevEndIso: addDaysIso(safeStart, -1),
    label: `${safeStart} al ${safeEnd}`,
  };
}

function inDateRange(dateIso: string | null, startIso: string, endIso: string): boolean {
  if (!dateIso) return false;
  return dateIso >= startIso && dateIso <= endIso;
}

function computeDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export interface ExecutiveCurrencyMetrics {
  currency: CurrencyCode;
  activePortfolioCapital: number;
  activeLoansCount: number;
  disbursedPeriodTotal: number;
  disbursedPrevTotal: number;
  disbursedDeltaPct: number | null;
  disbursedPeriodCount: number;
  recoveryPeriodTotal: number;
  recoveryPrincipal: number;
  recoveryInterest: number;
  recoveryOther: number;
  recoveryPrevTotal: number;
  recoveryDeltaPct: number | null;
  recoveryPaymentsCount: number;
  par1Pct: number | null;
  par30Pct: number | null;
  par60Pct: number | null;
  par90Pct: number | null;
  par1Exposure: number;
  par30Exposure: number;
  par60Exposure: number;
  par90Exposure: number;
  pendingApplicationsCount: number;
  pendingEvaluationCount: number;
  pendingCommitteeCount: number;
  pendingFormalizationCount: number;
  dailyDueAmount: number;
  dailyDueCount: number;
  dailyConfirmedReceivedAmount: number;
  dailyConfirmedCount: number;
  brokenPromisesCount: number;
  brokenPromisesAmount: number;
  approvalsCount: number;
  approvalsDenominator: number;
  approvalsTotalReceived: number;
  approvalsRatePct: number | null;
  portfolioAtRiskBalance: number;
  portfolioAtRiskCount: number;
  portfolioEvolutionSeries: Array<{
    period: string;
    vigente: number;
    vencido: number;
    total: number;
  }>;
  disbursementsVsRecoverySeries: Array<{
    month: string;
    desembolsos: number;
    recuperacion: number;
  }>;
  delinquencyBuckets: Array<{
    bucket: string;
    count: number;
    exposure: number;
  }>;
  applicationsByStatus: Array<{
    status: string;
    label: string;
    count: number;
    amount: number;
  }>;
  recoveryByAgent: Array<{
    agentId: string;
    agentName: string;
    recoveredAmount: number;
    paymentsCount: number;
  }>;
}

export interface OperationalDayItem {
  id: string;
  label: string;
  count: number;
  detail: string;
  targetSection: NavSectionId;
  tone: 'neutral' | 'attention' | 'positive';
}

export interface RecentActivityItem {
  id: string;
  timestampDisplay: string;
  timestampIso: string;
  eventType: string;
  action: string;
  actor: string;
  entityType: string;
  entityId: string;
  targetSection: NavSectionId;
  applicationId?: string;
  loanId?: string;
}

export function computeExecutiveCurrencyMetrics(params: {
  currency: CurrencyCode;
  bounds: PeriodBounds;
  todayIso: string;
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  loanInstallments: LoanInstallmentRecord[];
  collectionAccounts: CollectionAccountRecord[];
  payments: PaymentRecord[];
  paymentPromises: PaymentPromiseRecord[];
  usersList: UserProfile[];
}): ExecutiveCurrencyMetrics {
  const {
    currency,
    bounds,
    todayIso,
    applications,
    loans,
    loanInstallments,
    collectionAccounts,
    payments,
    paymentPromises,
    usersList,
  } = params;

  const currencyLoans = loans.filter((l) => l.currency === currency);
  const activeLoans = currencyLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO');
  const activePortfolioCapital = activeLoans.reduce(
    (s, l) => s + Number(l.currentPrincipalBalance || 0),
    0
  );

  // Disbursed in period & prev period
  const disbursedInPeriod = currencyLoans.filter((l) =>
    inDateRange(l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt), bounds.startIso, bounds.endIso)
  );
  const disbursedInPrev = currencyLoans.filter((l) =>
    inDateRange(
      l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt),
      bounds.prevStartIso,
      bounds.prevEndIso
    )
  );
  const disbursedPeriodTotal = disbursedInPeriod.reduce((s, l) => s + Number(l.approvedPrincipal || 0), 0);
  const disbursedPrevTotal = disbursedInPrev.reduce((s, l) => s + Number(l.approvedPrincipal || 0), 0);

  // Recovery: ONLY verified/applied payments (`APLICADO`)
  const appliedPayments = payments.filter((p) => p.currency === currency && p.status === 'APLICADO');
  const recoveryPeriodPayments = appliedPayments.filter((p) =>
    inDateRange(p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt), bounds.startIso, bounds.endIso)
  );
  const recoveryPrevPayments = appliedPayments.filter((p) =>
    inDateRange(
      p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt),
      bounds.prevStartIso,
      bounds.prevEndIso
    )
  );

  const recoveryPeriodTotal = recoveryPeriodPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const recoveryPrevTotal = recoveryPrevPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  let recoveryPrincipal = 0;
  let recoveryInterest = 0;
  let recoveryOther = 0;
  recoveryPeriodPayments.forEach((p) => {
    if (p.appliedBreakdown) {
      recoveryPrincipal += Number(p.appliedBreakdown.principal || 0);
      recoveryInterest += Number(p.appliedBreakdown.interest || 0);
      recoveryOther +=
        Number(p.appliedBreakdown.lateFee || 0) + Number(p.appliedBreakdown.otherCharges || 0);
    } else {
      recoveryPrincipal += Number(p.amount || 0);
    }
  });

  // PAR & Delinquency from collectionAccounts matched with active currency loans
  const activeLoanMap = new Map(activeLoans.map((l) => [l.id, l]));
  const currencyAccounts = collectionAccounts.filter(
    (a) => a.currency === currency && a.stage !== 'CANCELADO' && activeLoanMap.has(a.loanId)
  );

  const getAccountBalance = (acc: CollectionAccountRecord) =>
    Number(acc.totalOutstandingPrincipal ?? activeLoanMap.get(acc.loanId)?.currentPrincipalBalance ?? 0);

  const par1Exposure = currencyAccounts
    .filter((a) => a.dpd >= 1)
    .reduce((s, a) => s + getAccountBalance(a), 0);
  const par30Exposure = currencyAccounts
    .filter((a) => a.dpd >= 30)
    .reduce((s, a) => s + getAccountBalance(a), 0);
  const par60Exposure = currencyAccounts
    .filter((a) => a.dpd >= 60)
    .reduce((s, a) => s + getAccountBalance(a), 0);
  const par90Exposure = currencyAccounts
    .filter((a) => a.dpd >= 90)
    .reduce((s, a) => s + getAccountBalance(a), 0);

  const parDenom = activePortfolioCapital;
  const par1Pct = parDenom > 0 ? Number(((par1Exposure / parDenom) * 100).toFixed(2)) : null;
  const par30Pct = parDenom > 0 ? Number(((par30Exposure / parDenom) * 100).toFixed(2)) : null;
  const par60Pct = parDenom > 0 ? Number(((par60Exposure / parDenom) * 100).toFixed(2)) : null;
  const par90Pct = parDenom > 0 ? Number(((par90Exposure / parDenom) * 100).toFixed(2)) : null;

  // Pending applications (evaluation, committee or formalization + inbox)
  const currencyApps = applications.filter((a) => a.currency === currency);
  const pendingEvalStatuses = new Set(['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA']);
  const pendingCommitteeStatuses = new Set(['EN_COMITE']);
  const pendingFormStatuses = new Set(['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA']);

  const pendingEvaluationCount = currencyApps.filter((a) => pendingEvalStatuses.has(a.status)).length;
  const pendingCommitteeCount = currencyApps.filter((a) => pendingCommitteeStatuses.has(a.status)).length;
  const pendingFormalizationCount = currencyApps.filter((a) => pendingFormStatuses.has(a.status)).length;
  const pendingApplicationsCount =
    pendingEvaluationCount + pendingCommitteeCount + pendingFormalizationCount;

  // Daily collections (exigible today vs confirmed today)
  const activeLoanIds = new Set(activeLoans.map((l) => l.id));
  const dueTodayInstallments = loanInstallments.filter(
    (inst) =>
      activeLoanIds.has(inst.loanId) &&
      inst.dueDate === todayIso &&
      inst.status !== 'PAGADA'
  );
  const dailyDueAmount = dueTodayInstallments.reduce((s, inst) => s + Number(inst.totalAmount || 0), 0);
  const dailyConfirmedToday = appliedPayments.filter(
    (p) => (p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt)) === todayIso
  );
  const dailyConfirmedReceivedAmount = dailyConfirmedToday.reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  );

  // Broken promises
  const brokenPromises = paymentPromises.filter(
    (pr) =>
      pr.currency === currency &&
      (pr.status === 'INCUMPLIDA' || (pr.status === 'VIGENTE' && pr.promisedDate < todayIso))
  );
  const brokenPromisesAmount = brokenPromises.reduce(
    (s, pr) => s + Math.max(0, Number(pr.promisedAmount || 0) - Number(pr.fulfilledAmount || 0)),
    0
  );

  // Approvals rate in period (explicit denominator = decided applications in period)
  const periodApps = currencyApps.filter((a) =>
    inDateRange(extractIsoDateFromTimestamp(a.createdAt) || todayIso, bounds.startIso, bounds.endIso)
  );
  const approvedStatuses = new Set([
    'APROBADA',
    'APROBADA_CONDICIONADA',
    'FORMALIZADA',
    'DESEMBOLSADA',
  ]);
  const decidedApps = periodApps.filter(
    (a) => approvedStatuses.has(a.status) || a.status === 'RECHAZADA'
  );
  const approvalsCount = decidedApps.filter((a) => approvedStatuses.has(a.status)).length;
  const approvalsDenominator = decidedApps.length;
  const approvalsRatePct =
    approvalsDenominator > 0 ? Number(((approvalsCount / approvalsDenominator) * 100).toFixed(1)) : null;

  // Portfolio at risk (risk criteria: DPD >= 1 or CRITICA/ALTA priority)
  const atRiskAccounts = currencyAccounts.filter(
    (a) => a.dpd >= 1 || a.priority === 'CRITICA' || a.priority === 'ALTA'
  );
  const portfolioAtRiskBalance = atRiskAccounts.reduce((s, a) => s + getAccountBalance(a), 0);

  // Monthly series for last 6 months in Santo Domingo
  const months: string[] = [];
  const [baseY, baseM] = todayIso.slice(0, 7).split('-').map(Number);
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(Date.UTC(baseY, (baseM || 1) - 1 - i, 1));
    months.push(dt.toISOString().slice(0, 7));
  }

  const disbursementsVsRecoverySeries = months.map((ym) => {
    const disb = currencyLoans
      .filter((l) => (l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt) || '').startsWith(ym))
      .reduce((s, l) => s + Number(l.approvedPrincipal || 0), 0);
    const rec = appliedPayments
      .filter((p) => (p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '').startsWith(ym))
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    return {
      month: ym,
      desembolsos: Math.round(disb),
      recuperacion: Math.round(rec),
    };
  });

  // Portfolio Evolution by month (cumulative disbursed minus cumulative principal paid up to month end)
  const portfolioEvolutionSeries = months.map((ym) => {
    const monthEnd = `${ym}-31`;
    const loansUpToMonth = currencyLoans.filter(
      (l) => (l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt) || '9999-99-99') <= monthEnd
    );
    const totalIssued = loansUpToMonth.reduce((s, l) => s + Number(l.totalFinancedPrincipal || l.approvedPrincipal || 0), 0);
    const principalPaidUpToMonth = appliedPayments
      .filter((p) => (p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '9999-99-99') <= monthEnd)
      .reduce((s, p) => s + Number(p.appliedBreakdown?.principal ?? p.amount ?? 0), 0);
    const approxTotal = Math.max(
      ym === todayIso.slice(0, 7) ? activePortfolioCapital : Math.max(0, totalIssued - principalPaidUpToMonth),
      0
    );
    const vencido = ym === todayIso.slice(0, 7) ? par1Exposure : 0;
    const vigente = Math.max(0, approxTotal - vencido);
    return {
      period: ym,
      vigente: Math.round(vigente),
      vencido: Math.round(vencido),
      total: Math.round(approxTotal),
    };
  });

  // Delinquency Distribution
  const buckets = [
    { label: 'Vigente (0d)', min: 0, max: 0 },
    { label: '1–30 días', min: 1, max: 30 },
    { label: '31–60 días', min: 31, max: 60 },
    { label: '61–90 días', min: 61, max: 90 },
    { label: '90+ días', min: 91, max: 999999 },
  ];
  const delinquencyBuckets = buckets.map((b) => {
    const matched = currencyAccounts.filter((a) => a.dpd >= b.min && a.dpd <= b.max);
    return {
      bucket: b.label,
      count: matched.length,
      exposure: Math.round(matched.reduce((s, a) => s + getAccountBalance(a), 0)),
    };
  });

  // Applications by Status
  const statusOrder: ApplicationRecord['status'][] = [
    'RECIBIDA',
    'EN_EVALUACION',
    'EN_COMITE',
    'APROBADA',
    'APROBADA_CONDICIONADA',
    'RECHAZADA',
    'DESEMBOLSADA',
  ];
  const applicationsByStatus = statusOrder.map((st) => {
    const list = currencyApps.filter((a) => a.status === st);
    return {
      status: st,
      label: APPLICATION_STATUS_LABELS[st] || st,
      count: list.length,
      amount: Math.round(list.reduce((s, a) => s + Number(a.requestedAmount || 0), 0)),
    };
  });

  // Recovery by Agent (using collectionAccounts assignedCollectorId or reportedByName)
  const accountByLoan = new Map(currencyAccounts.map((a) => [a.loanId, a]));
  const usersById = new Map(usersList.map((u) => [u.uid, u]));
  const agentTotals = new Map<string, { agentName: string; recoveredAmount: number; paymentsCount: number }>();

  recoveryPeriodPayments.forEach((p) => {
    const acc = accountByLoan.get(p.loanId);
    const agentId = acc?.assignedCollectorId || p.reportedByUserId || 'unassigned';
    const agentName =
      acc?.assignedCollectorName ||
      usersById.get(agentId)?.displayName ||
      p.reportedByName ||
      'Sin gestor asignado';
    const prev = agentTotals.get(agentId) || { agentName, recoveredAmount: 0, paymentsCount: 0 };
    agentTotals.set(agentId, {
      agentName,
      recoveredAmount: prev.recoveredAmount + Number(p.amount || 0),
      paymentsCount: prev.paymentsCount + 1,
    });
  });

  const recoveryByAgent = Array.from(agentTotals.entries())
    .map(([agentId, val]) => ({
      agentId,
      agentName: val.agentName,
      recoveredAmount: Math.round(val.recoveredAmount),
      paymentsCount: val.paymentsCount,
    }))
    .sort((a, b) => b.recoveredAmount - a.recoveredAmount)
    .slice(0, 8);

  return {
    currency,
    activePortfolioCapital,
    activeLoansCount: activeLoans.length,
    disbursedPeriodTotal,
    disbursedPrevTotal,
    disbursedDeltaPct: computeDeltaPct(disbursedPeriodTotal, disbursedPrevTotal),
    disbursedPeriodCount: disbursedInPeriod.length,
    recoveryPeriodTotal,
    recoveryPrincipal,
    recoveryInterest,
    recoveryOther,
    recoveryPrevTotal,
    recoveryDeltaPct: computeDeltaPct(recoveryPeriodTotal, recoveryPrevTotal),
    recoveryPaymentsCount: recoveryPeriodPayments.length,
    par1Pct,
    par30Pct,
    par60Pct,
    par90Pct,
    par1Exposure,
    par30Exposure,
    par60Exposure,
    par90Exposure,
    pendingApplicationsCount,
    pendingEvaluationCount,
    pendingCommitteeCount,
    pendingFormalizationCount,
    dailyDueAmount,
    dailyDueCount: dueTodayInstallments.length,
    dailyConfirmedReceivedAmount,
    dailyConfirmedCount: dailyConfirmedToday.length,
    brokenPromisesCount: brokenPromises.length,
    brokenPromisesAmount,
    approvalsCount,
    approvalsDenominator,
    approvalsTotalReceived: periodApps.length,
    approvalsRatePct,
    portfolioAtRiskBalance,
    portfolioAtRiskCount: atRiskAccounts.length,
    portfolioEvolutionSeries,
    disbursementsVsRecoverySeries,
    delinquencyBuckets,
    applicationsByStatus,
    recoveryByAgent,
  };
}

/**
 * Consolida los indicadores ejecutivos de DOP y USD en una sola realidad financiera
 * expresada en Pesos Dominicanos (DOP / RD$), convirtiendo todos los montos en dólares
 * estadounidenses (USD) mediante la tasa oficial de venta del Banco Central (BCRD).
 *
 * Todos los porcentajes (PAR 1/30/60/90, variaciones inter-período y tasa de aprobación)
 * se recalculan matemáticamente sobre las bases consolidadas en RD$.
 */
export function consolidateExecutiveMetricsToDop(
  dopMetrics: ExecutiveCurrencyMetrics,
  usdMetrics: ExecutiveCurrencyMetrics,
  usdToDopRate: number
): ExecutiveCurrencyMetrics {
  const rate =
    Number.isFinite(usdToDopRate) && usdToDopRate > 0 ? usdToDopRate : 60.0;
  const r2 = (n: number) => Number(n.toFixed(2));
  const mergeMoney = (dopVal: number, usdVal: number) =>
    r2((Number(dopVal) || 0) + (Number(usdVal) || 0) * rate);

  const activePortfolioCapital = mergeMoney(
    dopMetrics.activePortfolioCapital,
    usdMetrics.activePortfolioCapital
  );
  const activeLoansCount =
    (dopMetrics.activeLoansCount || 0) + (usdMetrics.activeLoansCount || 0);

  const disbursedPeriodTotal = mergeMoney(
    dopMetrics.disbursedPeriodTotal,
    usdMetrics.disbursedPeriodTotal
  );
  const disbursedPeriodCount =
    (dopMetrics.disbursedPeriodCount || 0) + (usdMetrics.disbursedPeriodCount || 0);
  const disbursedPrevTotal = mergeMoney(
    dopMetrics.disbursedPrevTotal,
    usdMetrics.disbursedPrevTotal
  );
  const disbursedDeltaPct =
    disbursedPrevTotal > 0
      ? Number(
          (
            ((disbursedPeriodTotal - disbursedPrevTotal) / disbursedPrevTotal) *
            100
          ).toFixed(1)
        )
      : null;

  const recoveryPeriodTotal = mergeMoney(
    dopMetrics.recoveryPeriodTotal,
    usdMetrics.recoveryPeriodTotal
  );
  const recoveryPrincipal = mergeMoney(
    dopMetrics.recoveryPrincipal,
    usdMetrics.recoveryPrincipal
  );
  const recoveryInterest = mergeMoney(
    dopMetrics.recoveryInterest,
    usdMetrics.recoveryInterest
  );
  const recoveryOther = mergeMoney(
    dopMetrics.recoveryOther,
    usdMetrics.recoveryOther
  );
  const recoveryPaymentsCount =
    (dopMetrics.recoveryPaymentsCount || 0) +
    (usdMetrics.recoveryPaymentsCount || 0);
  const recoveryPrevTotal = mergeMoney(
    dopMetrics.recoveryPrevTotal,
    usdMetrics.recoveryPrevTotal
  );
  const recoveryDeltaPct =
    recoveryPrevTotal > 0
      ? Number(
          (
            ((recoveryPeriodTotal - recoveryPrevTotal) / recoveryPrevTotal) *
            100
          ).toFixed(1)
        )
      : null;

  const par1Exposure = mergeMoney(dopMetrics.par1Exposure, usdMetrics.par1Exposure);
  const par30Exposure = mergeMoney(dopMetrics.par30Exposure, usdMetrics.par30Exposure);
  const par60Exposure = mergeMoney(dopMetrics.par60Exposure, usdMetrics.par60Exposure);
  const par90Exposure = mergeMoney(dopMetrics.par90Exposure, usdMetrics.par90Exposure);

  const calcParPct = (exposure: number) =>
    activePortfolioCapital > 0
      ? Number(((exposure / activePortfolioCapital) * 100).toFixed(2))
      : null;

  const par1Pct = calcParPct(par1Exposure);
  const par30Pct = calcParPct(par30Exposure);
  const par60Pct = calcParPct(par60Exposure);
  const par90Pct = calcParPct(par90Exposure);

  const pendingApplicationsCount =
    (dopMetrics.pendingApplicationsCount || 0) +
    (usdMetrics.pendingApplicationsCount || 0);
  const pendingEvaluationCount =
    (dopMetrics.pendingEvaluationCount || 0) +
    (usdMetrics.pendingEvaluationCount || 0);
  const pendingCommitteeCount =
    (dopMetrics.pendingCommitteeCount || 0) +
    (usdMetrics.pendingCommitteeCount || 0);
  const pendingFormalizationCount =
    (dopMetrics.pendingFormalizationCount || 0) +
    (usdMetrics.pendingFormalizationCount || 0);

  const dailyDueAmount = mergeMoney(
    dopMetrics.dailyDueAmount,
    usdMetrics.dailyDueAmount
  );
  const dailyDueCount =
    (dopMetrics.dailyDueCount || 0) + (usdMetrics.dailyDueCount || 0);

  const dailyConfirmedReceivedAmount = mergeMoney(
    dopMetrics.dailyConfirmedReceivedAmount,
    usdMetrics.dailyConfirmedReceivedAmount
  );
  const dailyConfirmedCount =
    (dopMetrics.dailyConfirmedCount || 0) +
    (usdMetrics.dailyConfirmedCount || 0);

  const brokenPromisesCount =
    (dopMetrics.brokenPromisesCount || 0) +
    (usdMetrics.brokenPromisesCount || 0);
  const brokenPromisesAmount = mergeMoney(
    dopMetrics.brokenPromisesAmount,
    usdMetrics.brokenPromisesAmount
  );

  const approvalsCount =
    (dopMetrics.approvalsCount || 0) + (usdMetrics.approvalsCount || 0);
  const approvalsDenominator =
    (dopMetrics.approvalsDenominator || 0) +
    (usdMetrics.approvalsDenominator || 0);
  const approvalsTotalReceived =
    (dopMetrics.approvalsTotalReceived || 0) +
    (usdMetrics.approvalsTotalReceived || 0);
  const approvalsRatePct =
    approvalsDenominator > 0
      ? Number(((approvalsCount / approvalsDenominator) * 100).toFixed(1))
      : null;

  const portfolioAtRiskBalance = mergeMoney(
    dopMetrics.portfolioAtRiskBalance,
    usdMetrics.portfolioAtRiskBalance
  );
  const portfolioAtRiskCount =
    (dopMetrics.portfolioAtRiskCount || 0) +
    (usdMetrics.portfolioAtRiskCount || 0);

  // Merge portfolioEvolutionSeries aligned by period
  const usdEvoByPeriod = new Map(
    usdMetrics.portfolioEvolutionSeries.map((pt) => [pt.period, pt])
  );
  const portfolioEvolutionSeries = dopMetrics.portfolioEvolutionSeries.map((dPt) => {
    const uPt = usdEvoByPeriod.get(dPt.period);
    const vigente = Math.round(dPt.vigente + (uPt?.vigente || 0) * rate);
    const vencido = Math.round(dPt.vencido + (uPt?.vencido || 0) * rate);
    const total = Math.round(dPt.total + (uPt?.total || 0) * rate);
    return {
      period: dPt.period,
      vigente,
      vencido,
      total,
    };
  });

  // Merge disbursementsVsRecoverySeries aligned by month
  const usdDrByMonth = new Map(
    usdMetrics.disbursementsVsRecoverySeries.map((pt) => [pt.month, pt])
  );
  const disbursementsVsRecoverySeries = dopMetrics.disbursementsVsRecoverySeries.map(
    (dPt) => {
      const uPt = usdDrByMonth.get(dPt.month);
      return {
        month: dPt.month,
        desembolsos: Math.round(
          dPt.desembolsos + (uPt?.desembolsos || 0) * rate
        ),
        recuperacion: Math.round(
          dPt.recuperacion + (uPt?.recuperacion || 0) * rate
        ),
      };
    }
  );

  // Merge delinquencyBuckets aligned by bucket name
  const usdBucketMap = new Map(
    usdMetrics.delinquencyBuckets.map((b) => [b.bucket, b])
  );
  const delinquencyBuckets = dopMetrics.delinquencyBuckets.map((dB) => {
    const uB = usdBucketMap.get(dB.bucket);
    return {
      bucket: dB.bucket,
      count: dB.count + (uB?.count || 0),
      exposure: Math.round(dB.exposure + (uB?.exposure || 0) * rate),
    };
  });

  // Merge applicationsByStatus aligned by status
  const usdAppStatusMap = new Map(
    usdMetrics.applicationsByStatus.map((s) => [s.status, s])
  );
  const seenStatuses = new Set<string>();
  const applicationsByStatus: Array<{
    status: string;
    label: string;
    count: number;
    amount: number;
  }> = [];
  dopMetrics.applicationsByStatus.forEach((dS) => {
    seenStatuses.add(dS.status);
    const uS = usdAppStatusMap.get(dS.status);
    applicationsByStatus.push({
      status: dS.status,
      label: dS.label,
      count: dS.count + (uS?.count || 0),
      amount: Math.round(dS.amount + (uS?.amount || 0) * rate),
    });
  });
  usdMetrics.applicationsByStatus.forEach((uS) => {
    if (!seenStatuses.has(uS.status)) {
      applicationsByStatus.push({
        status: uS.status,
        label: uS.label,
        count: uS.count,
        amount: Math.round(uS.amount * rate),
      });
    }
  });

  // Merge recoveryByAgent converting USD amounts to DOP
  const agentMap = new Map<
    string,
    { agentId: string; agentName: string; recoveredAmount: number; paymentsCount: number }
  >();
  dopMetrics.recoveryByAgent.forEach((a) => {
    const key = a.agentId || a.agentName;
    agentMap.set(key, {
      agentId: a.agentId,
      agentName: a.agentName,
      recoveredAmount: a.recoveredAmount,
      paymentsCount: a.paymentsCount,
    });
  });
  usdMetrics.recoveryByAgent.forEach((a) => {
    const key = a.agentId || a.agentName;
    const prev = agentMap.get(key) ?? {
      agentId: a.agentId,
      agentName: a.agentName,
      recoveredAmount: 0,
      paymentsCount: 0,
    };
    agentMap.set(key, {
      agentId: prev.agentId || a.agentId,
      agentName: prev.agentName || a.agentName,
      recoveredAmount: prev.recoveredAmount + a.recoveredAmount * rate,
      paymentsCount: prev.paymentsCount + a.paymentsCount,
    });
  });
  const recoveryByAgent = Array.from(agentMap.values())
    .map((val) => ({
      agentId: val.agentId,
      agentName: val.agentName,
      recoveredAmount: Math.round(val.recoveredAmount),
      paymentsCount: val.paymentsCount,
    }))
    .sort((a, b) => b.recoveredAmount - a.recoveredAmount)
    .slice(0, 6);

  return {
    currency: 'DOP',
    activePortfolioCapital,
    activeLoansCount,
    disbursedPeriodTotal,
    disbursedPeriodCount,
    disbursedPrevTotal,
    disbursedDeltaPct,
    recoveryPeriodTotal,
    recoveryPrincipal,
    recoveryInterest,
    recoveryOther,
    recoveryPaymentsCount,
    recoveryPrevTotal,
    recoveryDeltaPct,
    par1Exposure,
    par30Exposure,
    par60Exposure,
    par90Exposure,
    par1Pct,
    par30Pct,
    par60Pct,
    par90Pct,
    pendingApplicationsCount,
    pendingEvaluationCount,
    pendingCommitteeCount,
    pendingFormalizationCount,
    dailyDueAmount,
    dailyDueCount,
    dailyConfirmedReceivedAmount,
    dailyConfirmedCount,
    brokenPromisesCount,
    brokenPromisesAmount,
    approvalsCount,
    approvalsDenominator,
    approvalsTotalReceived,
    approvalsRatePct,
    portfolioAtRiskBalance,
    portfolioAtRiskCount,
    portfolioEvolutionSeries,
    disbursementsVsRecoverySeries,
    delinquencyBuckets,
    applicationsByStatus,
    recoveryByAgent,
  };
}

export function buildOperationalDaySummary(params: {
  todayIso: string;
  applications: ApplicationRecord[];
  loanInstallments: LoanInstallmentRecord[];
  paymentPromises: PaymentPromiseRecord[];
  payments?: PaymentRecord[];
  reconciliationExceptions?: Array<{ status: string }>;
  collectionTasks?: Array<{ status: string }>;
  riskAlerts: RiskAlertRecord[];
  canAccessSection: (s: NavSectionId) => boolean;
  hasPermission: (p: CreditPermission) => boolean;
}): OperationalDayItem[] {
  const {
    todayIso,
    applications,
    loanInstallments,
    paymentPromises,
    payments = [],
    reconciliationExceptions = [],
    collectionTasks = [],
    riskAlerts,
    canAccessSection,
    hasPermission,
  } = params;

  const items: OperationalDayItem[] = [];

  if (canAccessSection('applications') || hasPermission('VIEW_INTERNAL_INBOX')) {
    const pendingApps = applications.filter((a) =>
      ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA', 'EN_COMITE', 'APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA'].includes(
        a.status
      )
    ).length;
    items.push({
      id: 'pending_apps',
      label: 'Solicitudes pendientes',
      count: pendingApps,
      detail: 'En bandeja de originación, evaluación o cierre',
      targetSection: 'applications',
      tone: pendingApps > 0 ? 'attention' : 'neutral',
    });
  }

  if (canAccessSection('evaluation') || hasPermission('VIEW_INTERNAL_INBOX')) {
    const evalPending = applications.filter((a) =>
      ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(a.status)
    ).length;
    items.push({
      id: 'eval_pending',
      label: 'Evaluaciones por completar',
      count: evalPending,
      detail: 'Por depurar o recalcular en Motor V2',
      targetSection: 'evaluation',
      tone: evalPending > 0 ? 'attention' : 'neutral',
    });
  }

  if (canAccessSection('committee') || hasPermission('VIEW_COMMITTEE_QUEUE')) {
    const inCommittee = applications.filter((a) => a.status === 'EN_COMITE').length;
    items.push({
      id: 'committee_pending',
      label: 'Decisiones de comité',
      count: inCommittee,
      detail: 'Expedientes esperando resolución colegiada',
      targetSection: 'committee',
      tone: inCommittee > 0 ? 'attention' : 'neutral',
    });
  }

  if (canAccessSection('disbursements') || hasPermission('EXECUTE_DISBURSEMENT')) {
    const readyDisb = applications.filter((a) => a.status === 'FORMALIZADA').length;
    items.push({
      id: 'disbursements_pending',
      label: 'Desembolsos autorizados pendientes',
      count: readyDisb,
      detail: 'Contratos formalizados listos para liquidar',
      targetSection: 'disbursements',
      tone: readyDisb > 0 ? 'positive' : 'neutral',
    });
  }

  if (canAccessSection('cobranza_daily') || hasPermission('VIEW_COLLECTIONS_PORTFOLIO')) {
    const dueToday = loanInstallments.filter(
      (i) => i.dueDate === todayIso && i.status !== 'PAGADA'
    ).length;
    items.push({
      id: 'due_today',
      label: 'Cuotas con vencimiento hoy',
      count: dueToday,
      detail: 'Vencimientos exigibles programados hoy',
      targetSection: canAccessSection('cobranza_daily') ? 'cobranza_daily' : 'cobranza_portfolio',
      tone: dueToday > 0 ? 'attention' : 'neutral',
    });

    const overduePromises = paymentPromises.filter(
      (p) => p.status === 'INCUMPLIDA' || (p.status === 'VIGENTE' && p.promisedDate <= todayIso)
    ).length;
    items.push({
      id: 'promises_overdue',
      label: 'Promesas de pago vencidas',
      count: overduePromises,
      detail: 'Compromisos vencidos o por vencer hoy',
      targetSection: canAccessSection('cobranza_promises') ? 'cobranza_promises' : 'cobranza_portfolio',
      tone: overduePromises > 0 ? 'attention' : 'neutral',
    });
  }

  if (
    canAccessSection('cobranza_reconciliation') ||
    canAccessSection('cobranza_payments') ||
    hasPermission('VERIFY_AND_APPLY_PAYMENTS') ||
    hasPermission('RECONCILE_BANK_TRANSACTIONS')
  ) {
    const unverifiedPayments = payments.filter((p) =>
      ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
    ).length;
    const openExceptions = reconciliationExceptions.filter((e) => e.status === 'ABIERTA').length;
    const totalToReconcile = unverifiedPayments + openExceptions;
    items.push({
      id: 'payments_to_reconcile',
      label: 'Pagos por conciliar',
      count: totalToReconcile,
      detail: `${unverifiedPayments} pago(s) por aplicar · ${openExceptions} excepción(es)`,
      targetSection: canAccessSection('cobranza_reconciliation')
        ? 'cobranza_reconciliation'
        : 'cobranza_payments',
      tone: totalToReconcile > 0 ? 'attention' : 'neutral',
    });
  }

  if (
    canAccessSection('cobranza_actions') ||
    canAccessSection('cobranza_my_actions') ||
    canAccessSection('cobranza_agenda') ||
    hasPermission('LOG_COLLECTION_ACTIONS')
  ) {
    const pendingTasks = collectionTasks.filter((t) =>
      ['PENDIENTE', 'EN_PROCESO'].includes(t.status)
    ).length;
    items.push({
      id: 'actions_pending',
      label: 'Gestiones pendientes',
      count: pendingTasks,
      detail: 'Tareas operativas en agenda de seguimiento',
      targetSection: canAccessSection('cobranza_agenda')
        ? 'cobranza_agenda'
        : canAccessSection('cobranza_actions')
        ? 'cobranza_actions'
        : 'cobranza_my_actions',
      tone: pendingTasks > 0 ? 'attention' : 'neutral',
    });
  }

  if (canAccessSection('cobranza_sentinel') || hasPermission('VIEW_COLLECTIONS_PORTFOLIO')) {
    const activeAlerts = riskAlerts.filter((a) => a.status === 'ACTIVA').length;
    if (canAccessSection('cobranza_sentinel')) {
      items.push({
        id: 'sentinel_active',
        label: 'Alertas de Centinela',
        count: activeAlerts,
        detail: 'Señales de riesgo operativo o mora',
        targetSection: 'cobranza_sentinel',
        tone: activeAlerts > 0 ? 'attention' : 'neutral',
      });
    }
  }

  return items;
}

export function buildRecentAuthorizedActivity(params: {
  auditLogs: AuditLogRecord[];
  hasPermission: (p: CreditPermission) => boolean;
  canAccessSection: (s: NavSectionId) => boolean;
  limit?: number;
}): RecentActivityItem[] {
  const { auditLogs, hasPermission, canAccessSection, limit = 10 } = params;
  const canViewCredit = hasPermission('VIEW_INTERNAL_INBOX') || hasPermission('VIEW_AUDIT_LOGS');
  const canViewCollections = hasPermission('VIEW_COLLECTIONS_PORTFOLIO') || hasPermission('VIEW_AUDIT_LOGS');

  const isCollectionEntity = (entityType: string) =>
    [
      'collection_accounts',
      'collection_actions',
      'payments',
      'payment_promises',
      'payment_agreements',
      'payment_reversals',
      'bank_transactions',
      'risk_alerts',
      'customer_disputes',
      'loans',
    ].includes(entityType);

  const resolveSection = (log: AuditLogRecord): NavSectionId => {
    if (log.entityType === 'applications' && canAccessSection('applications')) return 'applications';
    if (log.entityType === 'committee_decisions' && canAccessSection('committee')) return 'committee';
    if (log.entityType === 'formalizations' && canAccessSection('formalization')) return 'formalization';
    if (log.entityType === 'payments' && canAccessSection('cobranza_payments')) return 'cobranza_payments';
    if (log.entityType === 'loans' && canAccessSection('loans')) return 'loans';
    if (canAccessSection('audit')) return 'audit';
    if (canAccessSection('cobranza_audit')) return 'cobranza_audit';
    return 'dashboard';
  };

  return auditLogs
    .filter((log) => {
      if (log.entityType === 'users' && !hasPermission('MANAGE_POLICIES_AND_RBAC') && !hasPermission('VIEW_AUDIT_LOGS')) {
        return false;
      }
      if (isCollectionEntity(log.entityType)) {
        return canViewCollections;
      }
      return canViewCredit;
    })
    .map((log) => ({
      id: log.id,
      timestampDisplay: formatTimestamp(log.timestamp),
      timestampIso: extractIsoDateFromTimestamp(log.timestamp) || '',
      eventType: log.eventType,
      action: log.action,
      actor: log.userEmail || log.userId,
      entityType: log.entityType,
      entityId: log.entityId,
      targetSection: resolveSection(log),
      applicationId: log.entityType === 'applications' ? log.entityId : undefined,
      loanId: log.entityType === 'loans' ? log.entityId : undefined,
    }))
    .sort((a, b) => b.timestampDisplay.localeCompare(a.timestampDisplay))
    .slice(0, limit);
}

export function buildScopedAiContext(params: {
  userProfile: UserProfile;
  roleLabel: string;
  organizationName: string;
  periodLabel: string;
  currencyFilter: 'DOP' | 'USD' | 'SEPARATED';
  dopMetrics: ExecutiveCurrencyMetrics;
  usdMetrics: ExecutiveCurrencyMetrics;
  usdToDopRate?: number;
  operationalItems: OperationalDayItem[];
  recentActivity: RecentActivityItem[];
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  collectionActions: CollectionActionRecord[];
  riskAlerts: RiskAlertRecord[];
  hasPermission: (p: CreditPermission) => boolean;
}): Record<string, unknown> {
  const {
    userProfile,
    roleLabel,
    organizationName,
    periodLabel,
    currencyFilter,
    dopMetrics,
    usdMetrics,
    usdToDopRate,
    operationalItems,
    recentActivity,
    applications,
    loans,
    collectionActions,
    riskAlerts,
    hasPermission,
  } = params;

  const canSeeInbox = hasPermission('VIEW_INTERNAL_INBOX') || hasPermission('ORIGINATE_APPLICATION');
  const canSeeCollections = hasPermission('VIEW_COLLECTIONS_PORTFOLIO');
  const clock = getSantoDomingoClockInfo();

  const summarizeCurrency = (m: ExecutiveCurrencyMetrics) => ({
    currency: m.currency,
    carteraActiva: canSeeCollections || hasPermission('VIEW_REPORTS_AND_EXPORT') ? formatMoney(m.activePortfolioCapital, m.currency) : 'Restringido por RBAC',
    prestamosActivos: m.activeLoansCount,
    desembolsadoPeriodo: canSeeInbox || canSeeCollections ? formatMoney(m.disbursedPeriodTotal, m.currency) : 'Restringido',
    desembolsadoVariacionPct: m.disbursedDeltaPct,
    recuperacionPeriodo: canSeeCollections ? formatMoney(m.recoveryPeriodTotal, m.currency) : 'Restringido',
    recuperacionCapital: canSeeCollections ? formatMoney(m.recoveryPrincipal, m.currency) : 'Restringido',
    recuperacionInteres: canSeeCollections ? formatMoney(m.recoveryInterest, m.currency) : 'Restringido',
    par1Pct: canSeeCollections ? m.par1Pct : null,
    par30Pct: canSeeCollections ? m.par30Pct : null,
    par60Pct: canSeeCollections ? m.par60Pct : null,
    par90Pct: canSeeCollections ? m.par90Pct : null,
    solicitudesPendientes: canSeeInbox ? m.pendingApplicationsCount : null,
    cobrosExigiblesHoy: canSeeCollections ? formatMoney(m.dailyDueAmount, m.currency) : null,
    cobrosConfirmadosHoy: canSeeCollections ? formatMoney(m.dailyConfirmedReceivedAmount, m.currency) : null,
    promesasIncumplidasCantidad: canSeeCollections ? m.brokenPromisesCount : null,
    promesasIncumplidasMonto: canSeeCollections ? formatMoney(m.brokenPromisesAmount, m.currency) : null,
    aprobacionesCantidad: canSeeInbox ? m.approvalsCount : null,
    aprobacionesDenominador: canSeeInbox ? m.approvalsDenominator : null,
    aprobacionesTasaPct: canSeeInbox ? m.approvalsRatePct : null,
    carteraEnRiesgo: canSeeCollections ? formatMoney(m.portfolioAtRiskBalance, m.currency) : null,
    morosidadPorTramo: canSeeCollections ? m.delinquencyBuckets : [],
    recuperacionPorGestor: canSeeCollections ? m.recoveryByAgent : [],
  });

  return {
    organizacion: organizationName,
    zonaHoraria: SANTO_DOMINGO_TIMEZONE,
    fechaActual: clock.todayIso,
    periodoConsultado: periodLabel,
    monedaConsultada: currencyFilter,
    usuario: {
      nombre: userProfile.displayName,
      rol: roleLabel,
      permisosClave: {
        verInboxCredito: canSeeInbox,
        verCarteraCobranza: canSeeCollections,
        verAuditoria: hasPermission('VIEW_AUDIT_LOGS'),
      },
    },
    indicadoresPorMoneda: {
      ...(currencyFilter !== 'USD' ? { DOP: summarizeCurrency(dopMetrics) } : {}),
      ...(currencyFilter !== 'DOP' ? { USD: summarizeCurrency(usdMetrics) } : {}),
      ...(currencyFilter === 'SEPARATED' && usdToDopRate && usdToDopRate > 0
        ? {
            CONSOLIDADO_EN_DOP_BCRD: {
              tasaCambioBcrdUsdADop: usdToDopRate,
              ...summarizeCurrency(
                consolidateExecutiveMetricsToDop(dopMetrics, usdMetrics, usdToDopRate)
              ),
            },
          }
        : {}),
    },
    resumenOperativoHoy: operationalItems.map((i) => ({
      concepto: i.label,
      cantidad: i.count,
      ruta: i.targetSection,
    })),
    solicitudesRecientesMuestra: canSeeInbox
      ? applications.slice(0, 12).map((a) => ({
          numero: a.applicationNumber,
          solicitante: a.applicantDisplayName,
          estado: APPLICATION_STATUS_LABELS[a.status] || a.status,
          moneda: a.currency,
          monto: formatMoney(a.requestedAmount, a.currency),
          score: a.latestScore ?? null,
        }))
      : [],
    prestamosRecientesMuestra: canSeeCollections
      ? loans.slice(0, 12).map((l) => ({
          numero: l.loanNumber,
          cliente: l.applicantDisplayName,
          estado: l.status,
          moneda: l.currency,
          saldoCapital: formatMoney(l.currentPrincipalBalance, l.currency),
        }))
      : [],
    gestionesRecientesCount: canSeeCollections ? collectionActions.length : null,
    alertasCentinelaActivas: canSeeCollections
      ? riskAlerts.filter((a) => a.status === 'ACTIVA').length
      : null,
    actividadReciente: recentActivity.slice(0, 6).map((r) => ({
      fecha: r.timestampDisplay,
      evento: r.eventType,
      accion: r.action,
    })),
  };
}
