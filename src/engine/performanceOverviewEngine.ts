import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CollectionDailySnapshotRecord,
  CurrencyCode,
  LoanRecord,
} from '../types/axycore';
import {
  extractIsoDateFromTimestamp,
  type ExecutiveCurrencyMetrics,
} from './executiveAnalytics';

export type PerformanceWindowDays = 7 | 14 | 30;

export type Par30HealthStatus = 'OPTIMO' | 'VIGILANCIA' | 'ALERTA';

export interface PerformanceDailyPoint {
  dateIso: string;
  label: string;
  fullDateLabel: string;
  dailyApprovedCount: number;
  dailyRejectedCount: number;
  dailyDecidedCount: number;
  approvalRatePct: number | null;
  dailyApprovalRatePct: number | null;
  dailyPlacementAmount: number;
  dailyPlacementCount: number;
  cumulativePlacementAmount: number;
  par30Pct: number;
  par30Exposure: number;
  par1Pct: number;
  activeCapital: number;
}

export interface PerformanceOverviewSummary {
  currency: CurrencyCode;
  windowDays: PerformanceWindowDays;
  startIso: string;
  endIso: string;
  approvalRate: {
    currentPct: number | null;
    windowPct: number | null;
    cumulativePct: number | null;
    deltaPts: number | null;
    approvedCount: number;
    rejectedCount: number;
    decidedCount: number;
    pendingCount: number;
    scopeLabel: string;
  };
  dailyPlacement: {
    todayAmount: number;
    todayCount: number;
    windowTotalAmount: number;
    windowTotalCount: number;
    dailyAverageAmount: number;
    peakDayAmount: number;
    peakDayLabel: string | null;
    deltaPct: number | null;
  };
  par30: {
    currentPct: number;
    currentExposure: number;
    accountsCount: number;
    par1Pct: number;
    healthyPct: number;
    deltaPts: number | null;
    status: Par30HealthStatus;
    statusLabel: string;
  };
  series: PerformanceDailyPoint[];
  hasPlacementData: boolean;
  hasApprovalData: boolean;
  hasParData: boolean;
}

const APPROVED_STATUSES = new Set([
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'FORMALIZADA',
  'DESEMBOLSADA',
]);

const REJECTED_STATUSES = new Set(['RECHAZADA']);

const PENDING_PIPELINE_STATUSES = new Set([
  'RECIBIDA',
  'EN_EVALUACION',
  'EN_COMITE',
  'DEVUELTA',
]);

const MONTHS_ES_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function diffDaysIso(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(`${fromIso}T00:00:00Z`);
  const toMs = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function formatDayShort(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

function formatDayFull(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const mon = MONTHS_ES_SHORT[(m || 1) - 1] ?? isoDate.slice(5, 7);
  return `${String(d || 1).padStart(2, '0')} ${mon} ${y || 2026}`;
}

function round1(val: number): number {
  return Number(val.toFixed(1));
}

function round2(val: number): number {
  return Number(val.toFixed(2));
}

function classifyPar30Status(par30Pct: number): {
  status: Par30HealthStatus;
  statusLabel: string;
} {
  if (par30Pct < 5) {
    return { status: 'OPTIMO', statusLabel: 'Saludable (< 5%)' };
  }
  if (par30Pct <= 8) {
    return { status: 'VIGILANCIA', statusLabel: 'En vigilancia (5–8%)' };
  }
  return { status: 'ALERTA', statusLabel: 'Alerta crítica (> 8%)' };
}

function resolveLoanPlacementDate(loan: LoanRecord): string | null {
  if (loan.disbursementDate && /^\d{4}-\d{2}-\d{2}/.test(loan.disbursementDate)) {
    return loan.disbursementDate.slice(0, 10);
  }
  return extractIsoDateFromTimestamp(loan.createdAt);
}

function resolveLoanPlacementAmount(loan: LoanRecord): number {
  const amount = Number(loan.approvedPrincipal ?? loan.totalFinancedPrincipal ?? 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function resolveApplicationDecisionDate(app: ApplicationRecord): string | null {
  return (
    extractIsoDateFromTimestamp(app.updatedAt) ||
    extractIsoDateFromTimestamp(app.createdAt)
  );
}

export function buildPerformanceOverviewData(params: {
  currency: CurrencyCode;
  consolidateUsdToDopRate?: number;
  windowDays: PerformanceWindowDays;
  todayIso: string;
  metrics: ExecutiveCurrencyMetrics;
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  collectionAccounts: CollectionAccountRecord[];
  collectionDailySnapshots: CollectionDailySnapshotRecord[];
}): PerformanceOverviewSummary {
  const {
    currency,
    consolidateUsdToDopRate,
    windowDays,
    todayIso,
    metrics,
    applications,
    loans,
    collectionAccounts,
    collectionDailySnapshots,
  } = params;

  const isConsolidated =
    currency === 'DOP' &&
    typeof consolidateUsdToDopRate === 'number' &&
    Number.isFinite(consolidateUsdToDopRate) &&
    consolidateUsdToDopRate > 0;
  const fxRate = isConsolidated ? consolidateUsdToDopRate : 1;
  const scaleMoney = (amount: number, recCurrency: CurrencyCode) =>
    isConsolidated && recCurrency === 'USD' ? amount * fxRate : amount;

  const startIso = addDaysIso(todayIso, -(windowDays - 1));
  const endIso = todayIso;
  const prevStartIso = addDaysIso(startIso, -windowDays);
  const prevEndIso = addDaysIso(startIso, -1);

  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    dates.push(addDaysIso(todayIso, -i));
  }

  // 1. Applications scoped to currency (or consolidated DOP+USD, excluding drafts)
  const currencyApps = applications.filter(
    (a) => (isConsolidated || a.currency === currency) && a.status !== 'BORRADOR'
  );
  const pendingCount = currencyApps.filter((a) =>
    PENDING_PIPELINE_STATUSES.has(a.status)
  ).length;

  const decidedRecords = currencyApps
    .filter((a) => APPROVED_STATUSES.has(a.status) || REJECTED_STATUSES.has(a.status))
    .map((a) => ({
      approved: APPROVED_STATUSES.has(a.status),
      dateIso: resolveApplicationDecisionDate(a) || startIso,
    }));

  const dailyApprovedMap = new Map<string, number>();
  const dailyRejectedMap = new Map<string, number>();
  let priorApprovedCount = 0;
  let priorRejectedCount = 0;
  let prevWindowApproved = 0;
  let prevWindowRejected = 0;
  let windowApproved = 0;
  let windowRejected = 0;

  for (const rec of decidedRecords) {
    if (rec.dateIso < startIso) {
      if (rec.approved) priorApprovedCount++;
      else priorRejectedCount++;
    }
    if (rec.dateIso >= prevStartIso && rec.dateIso <= prevEndIso) {
      if (rec.approved) prevWindowApproved++;
      else prevWindowRejected++;
    }
    if (rec.dateIso >= startIso && rec.dateIso <= endIso) {
      if (rec.approved) {
        windowApproved++;
        dailyApprovedMap.set(rec.dateIso, (dailyApprovedMap.get(rec.dateIso) ?? 0) + 1);
      } else {
        windowRejected++;
        dailyRejectedMap.set(rec.dateIso, (dailyRejectedMap.get(rec.dateIso) ?? 0) + 1);
      }
    }
  }

  const totalApprovedAll = decidedRecords.filter((r) => r.approved).length;
  const totalDecidedAll = decidedRecords.length;
  const cumulativePct =
    totalDecidedAll > 0 ? round1((totalApprovedAll / totalDecidedAll) * 100) : null;

  const windowDecided = windowApproved + windowRejected;
  const windowPct =
    windowDecided > 0 ? round1((windowApproved / windowDecided) * 100) : null;

  const prevWindowDecided = prevWindowApproved + prevWindowRejected;
  const prevWindowPct =
    prevWindowDecided > 0 ? round1((prevWindowApproved / prevWindowDecided) * 100) : null;

  const approvalDeltaPts =
    windowPct !== null && prevWindowPct !== null
      ? round1(windowPct - prevWindowPct)
      : null;

  const effectiveApprovalPct =
    windowPct !== null ? windowPct : cumulativePct ?? metrics.approvalsRatePct;
  const effectiveApprovedCount = windowDecided > 0 ? windowApproved : totalApprovedAll;
  const effectiveRejectedCount =
    windowDecided > 0 ? windowRejected : totalDecidedAll - totalApprovedAll;
  const effectiveDecidedCount = windowDecided > 0 ? windowDecided : totalDecidedAll;
  const approvalScopeLabel =
    windowDecided > 0
      ? `Últimos ${windowDays} días`
      : totalDecidedAll > 0
      ? 'Acumulado histórico'
      : 'Sin decisiones registradas';

  // 2. Loans / Daily Placement Volume scoped to currency (converting USD -> DOP when consolidated)
  const currencyLoans = isConsolidated
    ? loans
    : loans.filter((l) => l.currency === currency);
  const loanMeta = currencyLoans.map((l) => ({
    loan: l,
    dateIso: resolveLoanPlacementDate(l),
    amount: scaleMoney(resolveLoanPlacementAmount(l), l.currency),
    currentBalance: scaleMoney(
      Math.max(0, Number(l.currentPrincipalBalance || 0)),
      l.currency
    ),
    isActive: l.status === 'ACTIVO' || l.status === 'VENCIDO',
  }));

  const dailyPlacementAmtMap = new Map<string, number>();
  const dailyPlacementCountMap = new Map<string, number>();
  let windowPlacementTotal = 0;
  let windowPlacementCount = 0;
  let prevWindowPlacementTotal = 0;

  for (const item of loanMeta) {
    if (!item.dateIso) continue;
    if (item.dateIso >= startIso && item.dateIso <= endIso) {
      windowPlacementTotal += item.amount;
      windowPlacementCount += 1;
      dailyPlacementAmtMap.set(
        item.dateIso,
        (dailyPlacementAmtMap.get(item.dateIso) ?? 0) + item.amount
      );
      dailyPlacementCountMap.set(
        item.dateIso,
        (dailyPlacementCountMap.get(item.dateIso) ?? 0) + 1
      );
    } else if (item.dateIso >= prevStartIso && item.dateIso <= prevEndIso) {
      prevWindowPlacementTotal += item.amount;
    }
  }

  const todayPlacementAmount = dailyPlacementAmtMap.get(todayIso) ?? 0;
  const todayPlacementCount = dailyPlacementCountMap.get(todayIso) ?? 0;
  const dailyAverageAmount =
    windowDays > 0 ? round2(windowPlacementTotal / windowDays) : 0;
  const placementDeltaPct =
    prevWindowPlacementTotal > 0
      ? round1(
          ((windowPlacementTotal - prevWindowPlacementTotal) /
            prevWindowPlacementTotal) *
            100
        )
      : null;

  // 3. PAR 30 daily snapshots & deterministic fallback reconstruction
  const snapshotsSorted = [...collectionDailySnapshots]
    .filter((s) => Boolean(s.cutoffDate))
    .sort((a, b) => a.cutoffDate.localeCompare(b.cutoffDate));

  const snapshotByDate = new Map<string, CollectionDailySnapshotRecord>();
  for (const snap of snapshotsSorted) {
    snapshotByDate.set(snap.cutoffDate.slice(0, 10), snap);
  }

  const loanDisbDateById = new Map<string, string>();
  for (const item of loanMeta) {
    if (item.dateIso) loanDisbDateById.set(item.loan.id, item.dateIso);
  }

  const activeCollectionAccounts = collectionAccounts.filter(
    (a) => (isConsolidated || a.currency === currency) && a.stage !== 'CANCELADO'
  );
  const currentPar30AccountsCount = activeCollectionAccounts.filter(
    (a) => a.dpd >= 30
  ).length;
  const currentPar30Pct = round2(metrics.par30Pct ?? 0);
  const currentPar1Pct = round2(metrics.par1Pct ?? 0);
  const currentPar30Exposure = Math.max(0, Number(metrics.par30Exposure || 0));

  const readSnapshotMetrics = (snap: CollectionDailySnapshotRecord) => {
    if (isConsolidated) {
      const capDop = Math.max(0, Number(snap.principalBalanceDop || 0));
      const capUsdInDop = Math.max(0, Number(snap.principalBalanceUsd || 0)) * fxRate;
      const activeCapital = round2(capDop + capUsdInDop);
      const par30ExpDop = (capDop * Math.max(0, Number(snap.par30Dop || 0))) / 100;
      const par30ExpUsdInDop =
        (capUsdInDop * Math.max(0, Number(snap.par30Usd || 0))) / 100;
      const par1ExpDop = (capDop * Math.max(0, Number(snap.par1Dop || 0))) / 100;
      const par1ExpUsdInDop =
        (capUsdInDop * Math.max(0, Number(snap.par1Usd || 0))) / 100;
      const par30Exposure = round2(par30ExpDop + par30ExpUsdInDop);
      const par30Pct =
        activeCapital > 0 ? round2((par30Exposure / activeCapital) * 100) : 0;
      const par1Pct =
        activeCapital > 0
          ? round2(((par1ExpDop + par1ExpUsdInDop) / activeCapital) * 100)
          : 0;
      return { activeCapital, par30Pct, par1Pct, par30Exposure };
    }
    const activeCapital =
      currency === 'USD'
        ? Math.max(0, Number(snap.principalBalanceUsd || 0))
        : Math.max(0, Number(snap.principalBalanceDop || 0));
    const par30Pct = round2(
      currency === 'USD'
        ? Math.max(0, Number(snap.par30Usd || 0))
        : Math.max(0, Number(snap.par30Dop || 0))
    );
    const par1Pct = round2(
      currency === 'USD'
        ? Math.max(0, Number(snap.par1Usd || 0))
        : Math.max(0, Number(snap.par1Dop || 0))
    );
    const par30Exposure =
      activeCapital > 0 ? round2((activeCapital * par30Pct) / 100) : 0;
    return { activeCapital, par30Pct, par1Pct, par30Exposure };
  };

  // Build day-by-day series
  let runningApproved = priorApprovedCount;
  let runningRejected = priorRejectedCount;
  let cumulativePlacement = 0;
  let peakDayAmount = 0;
  let peakDayLabel: string | null = null;

  const series: PerformanceDailyPoint[] = dates.map((dateIso) => {
    const dailyApprovedCount = dailyApprovedMap.get(dateIso) ?? 0;
    const dailyRejectedCount = dailyRejectedMap.get(dateIso) ?? 0;
    const dailyDecidedCount = dailyApprovedCount + dailyRejectedCount;
    runningApproved += dailyApprovedCount;
    runningRejected += dailyRejectedCount;
    const runningDecided = runningApproved + runningRejected;

    const approvalRatePct =
      runningDecided > 0 ? round1((runningApproved / runningDecided) * 100) : null;
    const dailyApprovalRatePct =
      dailyDecidedCount > 0
        ? round1((dailyApprovedCount / dailyDecidedCount) * 100)
        : null;

    const dailyPlacementAmount = round2(dailyPlacementAmtMap.get(dateIso) ?? 0);
    const dailyPlacementCount = dailyPlacementCountMap.get(dateIso) ?? 0;
    cumulativePlacement = round2(cumulativePlacement + dailyPlacementAmount);

    if (dailyPlacementAmount > peakDayAmount) {
      peakDayAmount = dailyPlacementAmount;
      peakDayLabel = formatDayFull(dateIso);
    }

    // PAR 30 on dateIso
    let activeCapital = 0;
    let par30Pct = 0;
    let par1Pct = 0;
    let par30Exposure = 0;

    if (dateIso === todayIso) {
      activeCapital = Math.max(0, Number(metrics.activePortfolioCapital || 0));
      par30Pct = currentPar30Pct;
      par1Pct = currentPar1Pct;
      par30Exposure = currentPar30Exposure;
    } else {
      const exactSnap = snapshotByDate.get(dateIso);
      if (exactSnap) {
        const parsed = readSnapshotMetrics(exactSnap);
        activeCapital = parsed.activeCapital;
        par30Pct = parsed.par30Pct;
        par1Pct = parsed.par1Pct;
        par30Exposure = parsed.par30Exposure;
      } else {
        // Carry forward the latest snapshot strictly prior to dateIso if available
        let priorSnap: CollectionDailySnapshotRecord | null = null;
        for (const s of snapshotsSorted) {
          const sDate = s.cutoffDate.slice(0, 10);
          if (sDate <= dateIso) priorSnap = s;
          else break;
        }
        if (priorSnap) {
          const parsed = readSnapshotMetrics(priorSnap);
          activeCapital = parsed.activeCapital;
          par30Pct = parsed.par30Pct;
          par1Pct = parsed.par1Pct;
          par30Exposure = parsed.par30Exposure;
        } else {
          // Deterministic historical reconstruction from real active loans & current DPD
          const daysAgo = Math.max(0, diffDaysIso(dateIso, todayIso));
          activeCapital = round2(
            loanMeta
              .filter(
                (item) =>
                  item.isActive && (!item.dateIso || item.dateIso <= dateIso)
              )
              .reduce((acc, item) => acc + item.currentBalance, 0)
          );
          if (activeCapital > 0) {
            let par30Exp = 0;
            let par1Exp = 0;
            for (const acct of activeCollectionAccounts) {
              const disbDate = loanDisbDateById.get(acct.loanId);
              if (disbDate && disbDate > dateIso) continue;
              const projectedDpd = Math.max(0, (acct.dpd || 0) - daysAgo);
              const exp = scaleMoney(
                Math.max(0, Number(acct.totalOutstandingPrincipal || 0)),
                acct.currency
              );
              if (projectedDpd >= 30) par30Exp += exp;
              if (projectedDpd >= 1) par1Exp += exp;
            }
            par30Exposure = round2(par30Exp);
            par30Pct = round2(Math.min(100, (par30Exp / activeCapital) * 100));
            par1Pct = round2(Math.min(100, (par1Exp / activeCapital) * 100));
          }
        }
      }
    }

    return {
      dateIso,
      label: formatDayShort(dateIso),
      fullDateLabel: formatDayFull(dateIso),
      dailyApprovedCount,
      dailyRejectedCount,
      dailyDecidedCount,
      approvalRatePct,
      dailyApprovalRatePct,
      dailyPlacementAmount,
      dailyPlacementCount,
      cumulativePlacementAmount: cumulativePlacement,
      par30Pct,
      par30Exposure,
      par1Pct,
      activeCapital,
    };
  });

  const firstPoint = series[0];
  const lastPoint = series[series.length - 1];
  const hasParData =
    metrics.activePortfolioCapital > 0 ||
    series.some((pt) => pt.activeCapital > 0 || pt.par30Pct > 0 || pt.par1Pct > 0);

  const par30DeltaPts =
    hasParData && firstPoint && lastPoint
      ? round2(lastPoint.par30Pct - firstPoint.par30Pct)
      : null;

  const parStatus = classifyPar30Status(currentPar30Pct);

  return {
    currency,
    windowDays,
    startIso,
    endIso,
    approvalRate: {
      currentPct: effectiveApprovalPct,
      windowPct,
      cumulativePct,
      deltaPts: approvalDeltaPts,
      approvedCount: effectiveApprovedCount,
      rejectedCount: effectiveRejectedCount,
      decidedCount: effectiveDecidedCount,
      pendingCount,
      scopeLabel: approvalScopeLabel,
    },
    dailyPlacement: {
      todayAmount: todayPlacementAmount,
      todayCount: todayPlacementCount,
      windowTotalAmount: round2(windowPlacementTotal),
      windowTotalCount: windowPlacementCount,
      dailyAverageAmount,
      peakDayAmount: round2(peakDayAmount),
      peakDayLabel,
      deltaPct: placementDeltaPct,
    },
    par30: {
      currentPct: currentPar30Pct,
      currentExposure: currentPar30Exposure,
      accountsCount: currentPar30AccountsCount,
      par1Pct: currentPar1Pct,
      healthyPct: round2(Math.max(0, 100 - currentPar30Pct)),
      deltaPts: par30DeltaPts,
      status: parStatus.status,
      statusLabel: parStatus.statusLabel,
    },
    series,
    hasPlacementData: windowPlacementTotal > 0,
    hasApprovalData: series.some((pt) => pt.approvalRatePct !== null),
    hasParData,
  };
}
