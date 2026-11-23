import type {
  ApplicationDocumentRecord,
  ApplicationRecord,
  AuditLogRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionDailySnapshotRecord,
  CollectionStage,
  CollectionTaskRecord,
  CollectorTargetRecord,
  CreditPermission,
  CurrencyCode,
  CustomerDisputeRecord,
  LoanInstallmentRecord,
  LoanRecord,
  NavSectionId,
  OperatingExpenseRecord,
  PaymentAgreementRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  ProductCode,
  ReconciliationExceptionRecord,
  RiskAlertRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';
import { extractIsoDateFromTimestamp, type ExecutiveCurrencyMetrics, type PeriodBounds } from './executiveAnalytics';
import { formatMoney, PRODUCT_LABELS } from '../utils/formatters';

export type PanoramaGranularity = 'DIARIO' | 'SEMANAL' | 'MENSUAL' | 'TRIMESTRAL' | 'ANUAL';

export type SmartAlertPriority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'INFORMATIVA';

export interface HomeSmartAlert {
  id: string;
  priority: SmartAlertPriority;
  category:
    | 'EVALUACION'
    | 'PROXIMO_VENCER'
    | 'CUOTAS_VENCIDAS'
    | 'PROMESAS_INCUMPLIDAS'
    | 'EXPEDIENTES'
    | 'APROBACIONES'
    | 'INCIDENCIAS';
  categoryLabel: string;
  title: string;
  detail: string;
  metricLabel: string;
  targetSection: NavSectionId;
  applicationId?: string;
  loanId?: string;
}

export interface PanoramaSeriesPoint {
  period: string;
  vigente: number;
  vencido: number;
  total: number;
  desembolsos: number;
  recuperacion: number;
}

export interface ProductDistributionItem {
  productCode: ProductCode;
  label: string;
  amount: number;
  count: number;
  sharePct: number;
}

export interface ExecutiveKpiEnhancements {
  portfolioGrowthPct: number | null;
  parVariationPts: number | null;
  recoveryTargetAmount: number | null;
  recoveryCompliancePct: number | null;
  recoveryTargetSourceLabel: string;
}

export interface InstitutionalPerformanceItem {
  id: string;
  label: string;
  pct: number | null;
  summary: string;
  countLabel: string;
  hasData: boolean;
  trendText: string;
}

export interface StageRecoveryItem {
  stage: Exclude<CollectionStage, 'CANCELADO'>;
  label: string;
  amount: number;
  paymentsCount: number;
  accountsCount: number;
}

export interface CollectionsOverviewSummary {
  dailyDueAmount: number;
  dailyConfirmedAmount: number;
  dailyTargetAmount: number | null;
  dailyTargetPct: number | null;
  contactedClientsCount: number;
  effectiveContactCount: number;
  activePromisesCount: number;
  activePromisesAmount: number;
  brokenPromisesCount: number;
  brokenPromisesAmount: number;
  recoveryByStage: StageRecoveryItem[];
}

export interface DepartmentProductivityItem {
  id: string;
  name: string;
  completedCount: number;
  pendingCount: number;
  efficiencyPct: number | null;
  summary: string;
  targetSection: NavSectionId;
}

export interface TeamProductivitySummary {
  canViewFullTeam: boolean;
  activeUsersCount: number;
  operationsCount: number;
  processedApplicationsCount: number;
  collectionActionsCount: number;
  pendingCasesCount: number;
  departments: DepartmentProductivityItem[];
}

export interface IntelligenceInsightItem {
  id: string;
  severity: 'CRITICA' | 'ATENCION' | 'OPORTUNIDAD' | 'OPTIMA';
  area: string;
  headline: string;
  detail: string;
  evidenceMetric: string;
  actionLabel?: string;
  targetSection?: NavSectionId;
}

export interface EnrichedActivityEntry {
  id: string;
  timestampDisplay: string;
  eventLabel: string;
  action: string;
  actorName: string;
  statusLabel: string;
  entityType: string;
  targetSection: NavSectionId;
  applicationId?: string;
  loanId?: string;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function getBucketRangeForGranularity(
  granularity: PanoramaGranularity,
  todayIso: string
): Array<{ key: string; label: string; startIso: string; endIso: string }> {
  const [y, m] = todayIso.slice(0, 7).split('-').map(Number);

  if (granularity === 'DIARIO') {
    const out: Array<{ key: string; label: string; startIso: string; endIso: string }> = [];
    for (let i = 13; i >= 0; i--) {
      const day = addDaysIso(todayIso, -i);
      out.push({
        key: day,
        label: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
        startIso: day,
        endIso: day,
      });
    }
    return out;
  }

  if (granularity === 'SEMANAL') {
    const out: Array<{ key: string; label: string; startIso: string; endIso: string }> = [];
    for (let i = 7; i >= 0; i--) {
      const end = addDaysIso(todayIso, -i * 7);
      const start = addDaysIso(end, -6);
      out.push({
        key: `w_${end}`,
        label: `Sem ${start.slice(8, 10)}/${start.slice(5, 7)}`,
        startIso: start,
        endIso: end,
      });
    }
    return out;
  }

  if (granularity === 'TRIMESTRAL') {
    const currentQ = Math.floor(((m || 1) - 1) / 3);
    const out: Array<{ key: string; label: string; startIso: string; endIso: string }> = [];
    for (let i = 3; i >= 0; i--) {
      const totalQ = y * 4 + currentQ - i;
      const qY = Math.floor(totalQ / 4);
      const qIdx = ((totalQ % 4) + 4) % 4;
      const startMonth = qIdx * 3 + 1;
      const endMonth = startMonth + 2;
      const startIso = `${qY}-${String(startMonth).padStart(2, '0')}-01`;
      const endDt = new Date(Date.UTC(qY, endMonth, 0));
      out.push({
        key: `${qY}-Q${qIdx + 1}`,
        label: `T${qIdx + 1} ${qY}`,
        startIso,
        endIso: endDt.toISOString().slice(0, 10),
      });
    }
    return out;
  }

  if (granularity === 'ANUAL') {
    const out: Array<{ key: string; label: string; startIso: string; endIso: string }> = [];
    for (let i = 2; i >= 0; i--) {
      const yr = y - i;
      out.push({
        key: `${yr}`,
        label: `${yr}`,
        startIso: `${yr}-01-01`,
        endIso: `${yr}-12-31`,
      });
    }
    return out;
  }

  // MENSUAL (default 6 months)
  const out: Array<{ key: string; label: string; startIso: string; endIso: string }> = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, (m || 1) - 1 - i, 1));
    const ym = dt.toISOString().slice(0, 7);
    const endDt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
    out.push({
      key: ym,
      label: ym,
      startIso: `${ym}-01`,
      endIso: endDt.toISOString().slice(0, 10),
    });
  }
  return out;
}

export function buildPanoramaSeriesAndKpis(params: {
  currency: CurrencyCode;
  consolidateUsdToDopRate?: number;
  granularity: PanoramaGranularity;
  todayIso: string;
  bounds: PeriodBounds;
  metrics: ExecutiveCurrencyMetrics;
  loans: LoanRecord[];
  payments: PaymentRecord[];
  loanInstallments: LoanInstallmentRecord[];
  collectorTargets: CollectorTargetRecord[];
  snapshots: CollectionDailySnapshotRecord[];
}): {
  series: PanoramaSeriesPoint[];
  productDistribution: ProductDistributionItem[];
  enhancements: ExecutiveKpiEnhancements;
} {
  const {
    currency,
    consolidateUsdToDopRate,
    granularity,
    todayIso,
    bounds,
    metrics,
    loans,
    payments,
    loanInstallments,
    collectorTargets,
    snapshots,
  } = params;

  const isConsolidated =
    currency === 'DOP' &&
    typeof consolidateUsdToDopRate === 'number' &&
    Number.isFinite(consolidateUsdToDopRate) &&
    consolidateUsdToDopRate > 0;
  const fxRate = isConsolidated ? consolidateUsdToDopRate : 1;
  const scaleMoney = (amount: number, recCurrency: CurrencyCode) =>
    isConsolidated && recCurrency === 'USD' ? amount * fxRate : amount;

  const currencyLoans = isConsolidated
    ? loans
    : loans.filter((l) => l.currency === currency);
  const activeLoans = currencyLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO');
  const appliedPayments = isConsolidated
    ? payments.filter((p) => p.status === 'APLICADO')
    : payments.filter((p) => p.currency === currency && p.status === 'APLICADO');
  const loanCurrencyById = new Map(currencyLoans.map((l) => [l.id, l.currency]));
  const buckets = getBucketRangeForGranularity(granularity, todayIso);

  const series: PanoramaSeriesPoint[] = buckets.map((b, idx) => {
    const isCurrentBucket = idx === buckets.length - 1;
    const disbInBucket = currencyLoans
      .filter((l) => {
        const dt = l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt) || '';
        return dt >= b.startIso && dt <= b.endIso;
      })
      .reduce((s, l) => s + scaleMoney(Number(l.approvedPrincipal || 0), l.currency), 0);

    const recInBucket = appliedPayments
      .filter((p) => {
        const dt = p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '';
        return dt >= b.startIso && dt <= b.endIso;
      })
      .reduce((s, p) => s + scaleMoney(Number(p.amount || 0), p.currency), 0);

    const issuedUpToEnd = currencyLoans
      .filter((l) => {
        const dt = l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt) || '9999-99-99';
        return dt <= b.endIso;
      })
      .reduce(
        (s, l) =>
          s + scaleMoney(Number(l.totalFinancedPrincipal || l.approvedPrincipal || 0), l.currency),
        0
      );

    const principalPaidUpToEnd = appliedPayments
      .filter((p) => {
        const dt = p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '9999-99-99';
        return dt <= b.endIso;
      })
      .reduce(
        (s, p) =>
          s + scaleMoney(Number(p.appliedBreakdown?.principal ?? p.amount ?? 0), p.currency),
        0
      );

    const total = isCurrentBucket
      ? Math.round(metrics.activePortfolioCapital)
      : Math.max(0, Math.round(issuedUpToEnd - principalPaidUpToEnd));

    const snapAtBucket = snapshots
      .filter((sn) => sn.cutoffDate <= b.endIso)
      .sort((a, b2) => b2.cutoffDate.localeCompare(a.cutoffDate))[0];

    const vencido = isCurrentBucket
      ? Math.round(metrics.par1Exposure)
      : snapAtBucket
      ? Math.round(
          isConsolidated
            ? Number(snapAtBucket.overdueAmountDop || 0) +
              Number(snapAtBucket.overdueAmountUsd || 0) * fxRate
            : currency === 'DOP'
            ? snapAtBucket.overdueAmountDop
            : snapAtBucket.overdueAmountUsd
        )
      : 0;

    return {
      period: b.label,
      vigente: Math.max(0, total - Math.min(total, vencido)),
      vencido: Math.min(total, vencido),
      total,
      desembolsos: Math.round(disbInBucket),
      recuperacion: Math.round(recInBucket),
    };
  });

  // Portfolio variation vs previous month bucket
  const monthlyBuckets = getBucketRangeForGranularity('MENSUAL', todayIso);
  const prevMonthEnd = monthlyBuckets[monthlyBuckets.length - 2]?.endIso || todayIso;
  const prevIssued = currencyLoans
    .filter((l) => (l.disbursementDate || extractIsoDateFromTimestamp(l.createdAt) || '9999-99-99') <= prevMonthEnd)
    .reduce(
      (s, l) =>
        s + scaleMoney(Number(l.totalFinancedPrincipal || l.approvedPrincipal || 0), l.currency),
      0
    );
  const prevPaid = appliedPayments
    .filter((p) => (p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '9999-99-99') <= prevMonthEnd)
    .reduce(
      (s, p) =>
        s + scaleMoney(Number(p.appliedBreakdown?.principal ?? p.amount ?? 0), p.currency),
      0
    );
  const prevMonthPortfolio = Math.max(0, prevIssued - prevPaid);
  const portfolioGrowthPct =
    prevMonthPortfolio > 0
      ? Number((((metrics.activePortfolioCapital - prevMonthPortfolio) / prevMonthPortfolio) * 100).toFixed(1))
      : null;

  // PAR variation vs most recent earlier snapshot
  const priorSnapshot = snapshots
    .filter((sn) => sn.cutoffDate < todayIso)
    .sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate))[0];
  let prevPar1: number | null = null;
  if (priorSnapshot) {
    if (isConsolidated) {
      const capDop = Math.max(0, Number(priorSnapshot.principalBalanceDop || 0));
      const capUsdInDop = Math.max(0, Number(priorSnapshot.principalBalanceUsd || 0)) * fxRate;
      const totalSnapCap = capDop + capUsdInDop;
      if (totalSnapCap > 0) {
        const par1ExpDop = (capDop * Number(priorSnapshot.par1Dop || 0)) / 100;
        const par1ExpUsdInDop = (capUsdInDop * Number(priorSnapshot.par1Usd || 0)) / 100;
        prevPar1 = Number((((par1ExpDop + par1ExpUsdInDop) / totalSnapCap) * 100).toFixed(2));
      }
    } else {
      prevPar1 = currency === 'DOP' ? priorSnapshot.par1Dop : priorSnapshot.par1Usd;
    }
  }
  const parVariationPts =
    metrics.par1Pct !== null && prevPar1 !== null
      ? Number((metrics.par1Pct - prevPar1).toFixed(2))
      : null;

  // Recovery Target: real collectorTargets for current month OR scheduled installments due in bounds
  const ym = todayIso.slice(0, 7);
  const activeTargetsSum = collectorTargets
    .filter((t) => t.active && t.periodYm === ym)
    .reduce(
      (s, t) =>
        s +
        (isConsolidated
          ? Number(t.targetAmountDop || 0) + Number(t.targetAmountUsd || 0) * fxRate
          : Number(currency === 'DOP' ? t.targetAmountDop : t.targetAmountUsd)),
      0
    );

  const activeLoanIds = new Set(activeLoans.map((l) => l.id));
  const scheduledInBounds = loanInstallments
    .filter((i) => activeLoanIds.has(i.loanId) && i.dueDate >= bounds.startIso && i.dueDate <= bounds.endIso)
    .reduce((s, i) => {
      const lCur = loanCurrencyById.get(i.loanId) ?? currency;
      return s + scaleMoney(Number(i.totalAmount || 0), lCur);
    }, 0);

  let recoveryTargetAmount: number | null = null;
  let recoveryTargetSourceLabel = 'Sin meta configurada en el período';
  if (activeTargetsSum > 0) {
    recoveryTargetAmount = activeTargetsSum;
    recoveryTargetSourceLabel = `Meta mensual asignada (${ym})`;
  } else if (scheduledInBounds > 0) {
    recoveryTargetAmount = scheduledInBounds;
    recoveryTargetSourceLabel = 'Cuotas exigibles en el período';
  }

  const recoveryCompliancePct =
    recoveryTargetAmount && recoveryTargetAmount > 0
      ? Number(((metrics.recoveryPeriodTotal / recoveryTargetAmount) * 100).toFixed(1))
      : null;

  // Distribution by product (active loans in currency or consolidated DOP)
  const totalCap = activeLoans.reduce(
    (s, l) => s + scaleMoney(Number(l.currentPrincipalBalance || 0), l.currency),
    0
  );
  const productMap = new Map<ProductCode, { amount: number; count: number }>();
  activeLoans.forEach((l) => {
    const cur = productMap.get(l.productCode) ?? { amount: 0, count: 0 };
    productMap.set(l.productCode, {
      amount: cur.amount + scaleMoney(Number(l.currentPrincipalBalance || 0), l.currency),
      count: cur.count + 1,
    });
  });

  const productDistribution: ProductDistributionItem[] = Array.from(productMap.entries())
    .map(([productCode, val]) => ({
      productCode,
      label: PRODUCT_LABELS[productCode] || productCode,
      amount: Math.round(val.amount),
      count: val.count,
      sharePct: totalCap > 0 ? Number(((val.amount / totalCap) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    series,
    productDistribution,
    enhancements: {
      portfolioGrowthPct,
      parVariationPts,
      recoveryTargetAmount,
      recoveryCompliancePct,
      recoveryTargetSourceLabel,
    },
  };
}

export function buildHomeSmartAlerts(params: {
  todayIso: string;
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  loanInstallments: LoanInstallmentRecord[];
  collectionAccounts: CollectionAccountRecord[];
  paymentPromises: PaymentPromiseRecord[];
  paymentAgreements: PaymentAgreementRecord[];
  documents: ApplicationDocumentRecord[];
  riskAlerts: RiskAlertRecord[];
  reconciliationExceptions: ReconciliationExceptionRecord[];
  customerDisputes: CustomerDisputeRecord[];
  operatingExpenses: OperatingExpenseRecord[];
  canAccessSection: (s: NavSectionId) => boolean;
  hasPermission: (p: CreditPermission) => boolean;
}): HomeSmartAlert[] {
  const {
    todayIso,
    applications,
    loans,
    loanInstallments,
    collectionAccounts,
    paymentPromises,
    paymentAgreements,
    documents,
    riskAlerts,
    reconciliationExceptions,
    customerDisputes,
    operatingExpenses,
    canAccessSection,
    hasPermission,
  } = params;

  const alerts: HomeSmartAlert[] = [];
  const upcomingCutoff = addDaysIso(todayIso, 5);
  const loanMap = new Map(loans.map((l) => [l.id, l]));

  const canSeeCredit =
    hasPermission('VIEW_INTERNAL_INBOX') ||
    canAccessSection('applications') ||
    canAccessSection('evaluation') ||
    canAccessSection('committee');
  const canSeeCollections =
    hasPermission('VIEW_COLLECTIONS_PORTFOLIO') ||
    canAccessSection('cobranza_portfolio') ||
    canAccessSection('cobranza_daily');

  // 1. Cuotas vencidas (DPD >= 1)
  if (canSeeCollections) {
    collectionAccounts
      .filter((a) => a.stage !== 'CANCELADO' && a.dpd >= 1)
      .sort((a, b) => b.dpd - a.dpd)
      .slice(0, 4)
      .forEach((acc) => {
        alerts.push({
          id: `al_overdue_${acc.loanId}`,
          priority: acc.dpd >= 31 ? 'CRITICA' : acc.dpd >= 6 ? 'ALTA' : 'MEDIA',
          category: 'CUOTAS_VENCIDAS',
          categoryLabel: 'Cuotas vencidas',
          title: `${acc.applicantDisplayName} · ${acc.loanNumber}`,
          detail: `${acc.overdueInstallmentsCount || 1} cuota(s) vencida(s) con ${acc.dpd} día(s) de atraso.`,
          metricLabel: formatMoney(acc.overdueTotalAmount, acc.currency),
          targetSection: acc.dpd >= 31 && canAccessSection('cobranza_legal')
            ? 'cobranza_legal'
            : acc.dpd >= 6 && canAccessSection('cobranza_urgent')
            ? 'cobranza_urgent'
            : 'cobranza_daily',
          loanId: acc.loanId,
        });
      });

    // 2. Promesas de pago incumplidas
    paymentPromises
      .filter((p) => p.status === 'INCUMPLIDA' || (p.status === 'VIGENTE' && p.promisedDate < todayIso))
      .slice(0, 3)
      .forEach((pr) => {
        alerts.push({
          id: `al_promise_${pr.id}`,
          priority: 'CRITICA',
          category: 'PROMESAS_INCUMPLIDAS',
          categoryLabel: 'Promesa incumplida',
          title: `${pr.customerName} · ${pr.loanNumber}`,
          detail: `Compromiso vencido desde ${pr.promisedDate} sin pago verificado.`,
          metricLabel: formatMoney(Math.max(0, pr.promisedAmount - (pr.fulfilledAmount || 0)), pr.currency),
          targetSection: canAccessSection('cobranza_agreements_broken')
            ? 'cobranza_agreements_broken'
            : 'cobranza_promises',
          loanId: pr.loanId,
        });
      });

    // 3. Préstamos próximos a vencer (en los próximos 5 días)
    const dueSoonMap = new Map<string, { inst: LoanInstallmentRecord; loan: LoanRecord }>();
    loanInstallments.forEach((inst) => {
      if (inst.status === 'PAGADA') return;
      if (inst.dueDate >= todayIso && inst.dueDate <= upcomingCutoff) {
        const ln = loanMap.get(inst.loanId);
        if (ln && (ln.status === 'ACTIVO' || ln.status === 'VENCIDO') && !dueSoonMap.has(inst.loanId)) {
          dueSoonMap.set(inst.loanId, { inst, loan: ln });
        }
      }
    });
    Array.from(dueSoonMap.values())
      .slice(0, 3)
      .forEach(({ inst, loan }) => {
        alerts.push({
          id: `al_due_soon_${inst.id}`,
          priority: inst.dueDate === todayIso ? 'ALTA' : 'INFORMATIVA',
          category: 'PROXIMO_VENCER',
          categoryLabel: 'Próximo a vencer',
          title: `${loan.applicantDisplayName} · ${loan.loanNumber}`,
          detail: `Cuota #${inst.installmentNumber} vence el ${inst.dueDate}.`,
          metricLabel: formatMoney(inst.totalAmount, loan.currency),
          targetSection: 'cobranza_daily',
          loanId: loan.id,
        });
      });
  }

  // 4. Solicitudes pendientes de evaluación
  if (canSeeCredit) {
    applications
      .filter((a) => ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(a.status))
      .slice(0, 3)
      .forEach((app) => {
        alerts.push({
          id: `al_eval_${app.id}`,
          priority: app.status === 'DEVUELTA' ? 'ALTA' : 'MEDIA',
          category: 'EVALUACION',
          categoryLabel: 'Pendiente evaluación',
          title: `${app.applicantDisplayName} · ${app.applicationNumber}`,
          detail:
            app.status === 'DEVUELTA'
              ? 'Solicitud devuelta requiere corrección y reevaluación.'
              : 'Esperando análisis crediticio y depuración.',
          metricLabel: formatMoney(app.requestedAmount, app.currency),
          targetSection: canAccessSection('evaluation') ? 'evaluation' : 'applications',
          applicationId: app.id,
        });
      });

    // 5. Operaciones pendientes de aprobación (Comité / Formalización)
    applications
      .filter((a) => a.status === 'EN_COMITE')
      .slice(0, 3)
      .forEach((app) => {
        alerts.push({
          id: `al_comm_${app.id}`,
          priority: 'ALTA',
          category: 'APROBACIONES',
          categoryLabel: 'Pendiente aprobación',
          title: `${app.applicantDisplayName} · ${app.applicationNumber}`,
          detail: 'Expediente en Comité de Crédito pendiente de votos.',
          metricLabel: formatMoney(app.recommendedAmount ?? app.requestedAmount, app.currency),
          targetSection: canAccessSection('committee') ? 'committee' : 'applications',
          applicationId: app.id,
        });
      });
  }

  // 6. Expedientes incompletos
  if (canSeeCredit || canAccessSection('documents')) {
    const docsByApp = new Map<string, ApplicationDocumentRecord[]>();
    documents.forEach((d) => {
      const list = docsByApp.get(d.applicationId) ?? [];
      list.push(d);
      docsByApp.set(d.applicationId, list);
    });

    applications
      .filter((a) => !['RECHAZADA', 'DESEMBOLSADA'].includes(a.status))
      .forEach((app) => {
        const appDocs = docsByApp.get(app.id) ?? [];
        const hasObserved = appDocs.some((d) => d.reviewStatus === 'OBSERVADO');
        const missingDeclared =
          !app.declaredDocumentsSummary?.hasIdentityDoc || !app.declaredDocumentsSummary?.hasIncomeEvidence;
        if (hasObserved || (missingDeclared && appDocs.length === 0)) {
          alerts.push({
            id: `al_doc_${app.id}`,
            priority: hasObserved ? 'ALTA' : 'MEDIA',
            category: 'EXPEDIENTES',
            categoryLabel: 'Expediente incompleto',
            title: `${app.applicantDisplayName} · ${app.fileNumber}`,
            detail: hasObserved
              ? 'Contiene documentos observados pendientes de reposición.'
              : 'Faltan soportes de identidad o ingresos en el expediente digital.',
            metricLabel: `${appDocs.length} doc(s)`,
            targetSection: canAccessSection('documents') ? 'documents' : 'applications',
            applicationId: app.id,
          });
        }
      });
  }

  // 7. Incidencias operativas (Centinela, Conciliación, Disputas, Gastos/Acuerdos pendientes)
  if (canSeeCollections || canAccessSection('cobranza_sentinel')) {
    riskAlerts
      .filter((ra) => ra.status === 'ACTIVA')
      .slice(0, 3)
      .forEach((ra) => {
        alerts.push({
          id: `al_sent_${ra.id}`,
          priority: ra.severity === 'CRITICA' ? 'CRITICA' : ra.severity === 'ALTA' ? 'ALTA' : 'MEDIA',
          category: 'INCIDENCIAS',
          categoryLabel: 'Incidencia operativa',
          title: `${ra.title} · ${ra.loanNumber}`,
          detail: ra.description,
          metricLabel: ra.metricValue || ra.severity,
          targetSection: canAccessSection('cobranza_sentinel') ? 'cobranza_sentinel' : 'cobranza_portfolio',
          loanId: ra.loanId,
        });
      });

    customerDisputes
      .filter((d) => d.status === 'ABIERTA' || d.status === 'EN_INVESTIGACION')
      .slice(0, 2)
      .forEach((d) => {
        alerts.push({
          id: `al_disp_${d.id}`,
          priority: 'ALTA',
          category: 'INCIDENCIAS',
          categoryLabel: 'Reclamación abierta',
          title: `${d.customerName} · ${d.loanNumber}`,
          detail: d.description,
          metricLabel: d.disputeType,
          targetSection: 'cobranza_portfolio',
          loanId: d.loanId,
        });
      });
  }

  if (canAccessSection('cobranza_reconciliation') || canAccessSection('cobranza_unidentified')) {
    reconciliationExceptions
      .filter((ex) => ex.status === 'ABIERTA')
      .slice(0, 2)
      .forEach((ex) => {
        alerts.push({
          id: `al_exc_${ex.id}`,
          priority: 'MEDIA',
          category: 'INCIDENCIAS',
          categoryLabel: 'Conciliación bancaria',
          title: `Excepción ${ex.exceptionType}`,
          detail: ex.detail,
          metricLabel: 'Abierta',
          targetSection: canAccessSection('cobranza_unidentified')
            ? 'cobranza_unidentified'
            : 'cobranza_reconciliation',
        });
      });
  }

  if (canAccessSection('cobranza_actions')) {
    paymentAgreements
      .filter((ag) => ag.status === 'PROPUESTO')
      .slice(0, 2)
      .forEach((ag) => {
        alerts.push({
          id: `al_agr_${ag.id}`,
          priority: 'MEDIA',
          category: 'APROBACIONES',
          categoryLabel: 'Acuerdo por aprobar',
          title: `${ag.customerName} · ${ag.loanNumber}`,
          detail: `Propuesta de ${ag.agreementType} por ${ag.installmentCount} cuota(s).`,
          metricLabel: formatMoney(ag.totalAgreedAmount, ag.currency),
          targetSection: 'cobranza_actions',
          loanId: ag.loanId,
        });
      });
  }

  if (canAccessSection('register_expense')) {
    const pendingExp = operatingExpenses.filter((e) => e.status === 'PENDIENTE');
    if (pendingExp.length > 0) {
      alerts.push({
        id: 'al_exp_pending',
        priority: 'INFORMATIVA',
        category: 'APROBACIONES',
        categoryLabel: 'Gastos operativos',
        title: `${pendingExp.length} gasto(s) pendiente(s) de aprobación`,
        detail: 'Requiere revisión administrativa o contable.',
        metricLabel: `${pendingExp.length} reg.`,
        targetSection: 'register_expense',
      });
    }
  }

  const priorityOrder: Record<SmartAlertPriority, number> = {
    CRITICA: 0,
    ALTA: 1,
    MEDIA: 2,
    INFORMATIVA: 3,
  };

  return alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

export function buildInstitutionalPerformance(params: {
  applications: ApplicationRecord[];
  documents: ApplicationDocumentRecord[];
  collectionTasks: CollectionTaskRecord[];
  collectionActions: CollectionActionRecord[];
  customerDisputes: CustomerDisputeRecord[];
  payments: PaymentRecord[];
  metrics: ExecutiveCurrencyMetrics;
}): InstitutionalPerformanceItem[] {
  const {
    applications,
    documents,
    collectionTasks,
    collectionActions,
    customerDisputes,
    payments,
    metrics,
  } = params;

  // 1. Evaluación de créditos
  const totalApps = applications.length;
  const evaluatedApps = applications.filter(
    (a) => !['RECIBIDA'].includes(a.status)
  ).length;
  const evalPct = totalApps > 0 ? Math.round((evaluatedApps / totalApps) * 100) : null;

  // 2. Gestión de negocios (Tasa de aprobación real o throughput de originación)
  const bizPct = metrics.approvalsRatePct;

  // 3. Recuperación de cartera (% de cartera vigente al día = 100 - PAR1)
  const healthyPct =
    metrics.par1Pct !== null ? Number(Math.max(0, 100 - metrics.par1Pct).toFixed(1)) : null;

  // 4. Servicio al cliente (Disputas resueltas + contacto efectivo en gestiones)
  const resolvedDisputes = customerDisputes.filter((d) =>
    d.status.startsWith('RESUELTA')
  ).length;
  const effectiveContacts = collectionActions.filter(
    (a) =>
      a.contactResult === 'CONTACTO_EFECTIVO_PROMESA' ||
      a.contactResult === 'COMPROMISO_PAGO_VERIFICADO' ||
      a.contactResult === 'CONTACTO_SIN_ACUERDO'
  ).length;
  const serviceTotal = customerDisputes.length + collectionActions.length;
  const servicePct =
    serviceTotal > 0
      ? Math.round(((resolvedDisputes + effectiveContacts) / serviceTotal) * 100)
      : null;

  // 5. Gestión documental (Documentos verificados / total subidos)
  const totalDocs = documents.length;
  const verifiedDocs = documents.filter((d) => d.reviewStatus === 'VERIFICADO').length;
  const docPct = totalDocs > 0 ? Math.round((verifiedDocs / totalDocs) * 100) : null;

  // 6. Productividad operativa (Tareas completadas + pagos aplicados)
  const nonCancelledTasks = collectionTasks.filter((t) => t.status !== 'CANCELADA');
  const completedTasks = nonCancelledTasks.filter((t) => t.status === 'COMPLETADA').length;
  const appliedPays = payments.filter((p) => p.status === 'APLICADO').length;
  const nonReversedPays = payments.filter((p) => p.status !== 'REVERTIDO' && p.status !== 'RECHAZADO').length;
  const prodDenom = nonCancelledTasks.length + nonReversedPays;
  const prodPct = prodDenom > 0 ? Math.round(((completedTasks + appliedPays) / prodDenom) * 100) : null;

  return [
    {
      id: 'perf_eval',
      label: 'Evaluación de créditos',
      pct: evalPct,
      hasData: totalApps > 0,
      countLabel: totalApps > 0 ? `${evaluatedApps} de ${totalApps} procesadas` : 'Sin solicitudes aún',
      summary: 'Avance de expedientes desde recepción hacia análisis y comité',
      trendText: metrics.pendingEvaluationCount > 0 ? `${metrics.pendingEvaluationCount} en cola` : 'Cola al día',
    },
    {
      id: 'perf_biz',
      label: 'Gestión de negocios',
      pct: bizPct,
      hasData: metrics.approvalsDenominator > 0,
      countLabel:
        metrics.approvalsDenominator > 0
          ? `${metrics.approvalsCount} de ${metrics.approvalsDenominator} decididas`
          : 'Sin resoluciones en el período',
      summary: 'Efectividad de aprobación sobre solicitudes decididas en el período',
      trendText: `${metrics.approvalsTotalReceived} recibida(s) en período`,
    },
    {
      id: 'perf_rec',
      label: 'Recuperación de cartera',
      pct: healthyPct,
      hasData: metrics.activeLoansCount > 0 && healthyPct !== null,
      countLabel:
        metrics.activeLoansCount > 0
          ? `${metrics.activeLoansCount - metrics.portfolioAtRiskCount} de ${metrics.activeLoansCount} al día`
          : 'Sin cartera activa',
      summary: 'Proporción del capital activo sin días de atraso (0 DPD)',
      trendText:
        metrics.recoveryDeltaPct !== null
          ? `Cobros ${metrics.recoveryDeltaPct >= 0 ? `+${metrics.recoveryDeltaPct}%` : `${metrics.recoveryDeltaPct}%`}`
          : `${metrics.recoveryPaymentsCount} pago(s) aplicado(s)`,
    },
    {
      id: 'perf_cs',
      label: 'Servicio al cliente',
      pct: servicePct,
      hasData: serviceTotal > 0,
      countLabel:
        serviceTotal > 0
          ? `${resolvedDisputes + effectiveContacts} de ${serviceTotal} atenciones`
          : 'Sin gestiones ni casos registrados',
      summary: 'Contactabilidad efectiva y resolución de reclamaciones',
      trendText: `${customerDisputes.filter((d) => d.status === 'ABIERTA').length} disputa(s) abierta(s)`,
    },
    {
      id: 'perf_docs',
      label: 'Gestión documental',
      pct: docPct,
      hasData: totalDocs > 0,
      countLabel: totalDocs > 0 ? `${verifiedDocs} de ${totalDocs} verificados` : 'Sin documentos cargados',
      summary: 'Expedientes digitales validados por cumplimiento y análisis',
      trendText: `${documents.filter((d) => d.reviewStatus === 'OBSERVADO').length} observado(s)`,
    },
    {
      id: 'perf_ops',
      label: 'Productividad operativa',
      pct: prodPct,
      hasData: prodDenom > 0,
      countLabel:
        prodDenom > 0
          ? `${completedTasks + appliedPays} de ${prodDenom} operaciones`
          : 'Sin tareas o pagos en cola',
      summary: 'Cumplimiento de tareas de seguimiento y aplicación de pagos',
      trendText: `${completedTasks} tarea(s) · ${appliedPays} pago(s)`,
    },
  ];
}

export function buildCollectionsOverviewSummary(params: {
  currency: CurrencyCode;
  consolidateUsdToDopRate?: number;
  todayIso: string;
  bounds: PeriodBounds;
  metrics: ExecutiveCurrencyMetrics;
  collectionAccounts: CollectionAccountRecord[];
  collectionActions: CollectionActionRecord[];
  paymentPromises: PaymentPromiseRecord[];
  payments: PaymentRecord[];
  collectorTargets: CollectorTargetRecord[];
}): CollectionsOverviewSummary {
  const {
    currency,
    consolidateUsdToDopRate,
    todayIso,
    bounds,
    metrics,
    collectionAccounts,
    collectionActions,
    paymentPromises,
    payments,
    collectorTargets,
  } = params;

  const isConsolidated =
    currency === 'DOP' &&
    typeof consolidateUsdToDopRate === 'number' &&
    Number.isFinite(consolidateUsdToDopRate) &&
    consolidateUsdToDopRate > 0;
  const fxRate = isConsolidated ? consolidateUsdToDopRate : 1;
  const scaleMoney = (amount: number, recCurrency: CurrencyCode) =>
    isConsolidated && recCurrency === 'USD' ? amount * fxRate : amount;

  const ym = todayIso.slice(0, 7);
  const monthlyTarget = collectorTargets
    .filter((t) => t.active && t.periodYm === ym)
    .reduce(
      (s, t) =>
        s +
        (isConsolidated
          ? Number(t.targetAmountDop || 0) + Number(t.targetAmountUsd || 0) * fxRate
          : Number(currency === 'DOP' ? t.targetAmountDop : t.targetAmountUsd)),
      0
    );

  // Meta diaria: cuotas exigibles hoy o meta mensual prorrateada a 22 días hábiles
  const dailyTargetAmount =
    metrics.dailyDueAmount > 0
      ? metrics.dailyDueAmount
      : monthlyTarget > 0
      ? Math.round(monthlyTarget / 22)
      : null;

  const dailyTargetPct =
    dailyTargetAmount && dailyTargetAmount > 0
      ? Number(((metrics.dailyConfirmedReceivedAmount / dailyTargetAmount) * 100).toFixed(1))
      : null;

  const periodActions = collectionActions.filter((a) => {
    const dt = extractIsoDateFromTimestamp(a.actionTimeIso) || todayIso;
    return dt >= bounds.startIso && dt <= bounds.endIso;
  });
  const contactedCustomers = new Set(periodActions.map((a) => a.customerId));
  const effectiveActions = periodActions.filter(
    (a) =>
      a.contactResult === 'CONTACTO_EFECTIVO_PROMESA' ||
      a.contactResult === 'COMPROMISO_PAGO_VERIFICADO' ||
      a.contactResult === 'CONTACTO_SIN_ACUERDO'
  );

  const activePromises = paymentPromises.filter(
    (p) =>
      (isConsolidated || p.currency === currency) &&
      (p.status === 'VIGENTE' || p.status === 'PENDIENTE_VERIFICACION')
  );
  const activePromisesAmount = Number(
    activePromises
      .reduce(
        (s, p) =>
          s +
          scaleMoney(
            Math.max(0, Number(p.promisedAmount || 0) - Number(p.fulfilledAmount || 0)),
            p.currency
          ),
        0
      )
      .toFixed(2)
  );

  const stageMeta: Array<{ stage: Exclude<CollectionStage, 'CANCELADO'>; label: string }> = [
    { stage: 'AL_DIA', label: 'Al día (0d)' },
    { stage: 'PREVENTIVA', label: 'Preventiva' },
    { stage: 'TEMPRANA', label: 'Temprana (1–30d)' },
    { stage: 'INTERMEDIA', label: 'Intermedia (31–60d)' },
    { stage: 'AVANZADA', label: 'Avanzada (61–90d)' },
    { stage: 'CRITICA', label: 'Crítica / Legal (90+d)' },
  ];

  const accountByLoan = new Map(
    collectionAccounts
      .filter((a) => isConsolidated || a.currency === currency)
      .map((a) => [a.loanId, a])
  );

  const periodAppliedPayments = payments.filter((p) => {
    if ((!isConsolidated && p.currency !== currency) || p.status !== 'APLICADO') return false;
    const dt = p.appliedDate || p.paymentDate || extractIsoDateFromTimestamp(p.createdAt) || '';
    return dt >= bounds.startIso && dt <= bounds.endIso;
  });

  const recoveryByStage: StageRecoveryItem[] = stageMeta.map(({ stage, label }) => {
    const accCount = Array.from(accountByLoan.values()).filter((a) => a.stage === stage).length;
    const matchedPays = periodAppliedPayments.filter((p) => {
      const acc = accountByLoan.get(p.loanId);
      const st = acc?.stage || 'AL_DIA';
      return st === stage;
    });
    return {
      stage,
      label,
      amount: Math.round(
        matchedPays.reduce((s, p) => s + scaleMoney(Number(p.amount || 0), p.currency), 0)
      ),
      paymentsCount: matchedPays.length,
      accountsCount: accCount,
    };
  });

  return {
    dailyDueAmount: metrics.dailyDueAmount,
    dailyConfirmedAmount: metrics.dailyConfirmedReceivedAmount,
    dailyTargetAmount,
    dailyTargetPct,
    contactedClientsCount: contactedCustomers.size,
    effectiveContactCount: effectiveActions.length,
    activePromisesCount: activePromises.length,
    activePromisesAmount,
    brokenPromisesCount: metrics.brokenPromisesCount,
    brokenPromisesAmount: metrics.brokenPromisesAmount,
    recoveryByStage,
  };
}

const MANAGER_ROLES_SET = new Set<UserRole>([
  'ADMIN',
  'MANAGEMENT',
  'RISK_OFFICER',
  'COLLECTION_COORDINATOR',
  'SUPERVISOR',
  'AUDITOR',
]);

export function buildTeamProductivitySummary(params: {
  role: UserRole;
  userId: string;
  bounds: PeriodBounds;
  usersList: UserProfile[];
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  payments: PaymentRecord[];
  collectionActions: CollectionActionRecord[];
  collectionTasks: CollectionTaskRecord[];
  documents: ApplicationDocumentRecord[];
  canAccessSection: (s: NavSectionId) => boolean;
}): TeamProductivitySummary {
  const {
    role,
    userId,
    bounds,
    usersList,
    applications,
    loans,
    payments,
    collectionActions,
    collectionTasks,
    documents,
    canAccessSection,
  } = params;

  const canViewFullTeam = MANAGER_ROLES_SET.has(role);

  const scopedActions = canViewFullTeam
    ? collectionActions
    : collectionActions.filter((a) => a.collectorId === userId);
  const periodActions = scopedActions.filter((a) => {
    const dt = extractIsoDateFromTimestamp(a.actionTimeIso) || '';
    return dt >= bounds.startIso && dt <= bounds.endIso;
  });

  const scopedApps = canViewFullTeam
    ? applications
    : applications.filter((a) => a.createdBy === userId || a.assignedTo === userId);
  const processedApps = scopedApps.filter((a) => a.status !== 'RECIBIDA').length;

  const scopedTasks = canViewFullTeam
    ? collectionTasks
    : collectionTasks.filter((t) => t.assignedToUserId === userId);
  const completedTasks = scopedTasks.filter((t) => t.status === 'COMPLETADA').length;
  const pendingTasks = scopedTasks.filter((t) => t.status === 'PENDIENTE' || t.status === 'EN_PROCESO').length;

  const scopedPayments = canViewFullTeam
    ? payments
    : payments.filter((p) => p.reportedByUserId === userId || p.appliedByUserId === userId);
  const appliedPays = scopedPayments.filter((p) => p.status === 'APLICADO').length;
  const pendingPays = scopedPayments.filter((p) =>
    ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
  ).length;

  const activeUsersCount = usersList.filter(
    (u) => u.status === 'ACTIVE' && u.role !== 'EXTERNAL_CLIENT'
  ).length;

  const pendingEval = applications.filter((a) => ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(a.status)).length;
  const pendingCommittee = applications.filter((a) => a.status === 'EN_COMITE').length;
  const pendingFormal = applications.filter((a) => ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA'].includes(a.status)).length;
  const verifiedDocs = documents.filter((d) => d.reviewStatus === 'VERIFICADO').length;
  const pendingDocs = documents.filter((d) => d.reviewStatus === 'PENDIENTE' || d.reviewStatus === 'OBSERVADO').length;

  const calcPct = (done: number, pend: number): number | null => {
    const total = done + pend;
    return total > 0 ? Math.round((done / total) * 100) : null;
  };

  const departments: DepartmentProductivityItem[] = [
    {
      id: 'dept_originacion',
      name: 'Originación y Negocios',
      completedCount: processedApps,
      pendingCount: applications.filter((a) => a.status === 'RECIBIDA').length,
      efficiencyPct: calcPct(processedApps, applications.filter((a) => a.status === 'RECIBIDA').length),
      summary: `${applications.length} solicitud(es) registradas en bandeja`,
      targetSection: canAccessSection('applications') ? 'applications' : 'dashboard',
    },
    {
      id: 'dept_riesgo',
      name: 'Análisis y Riesgo',
      completedCount: applications.filter((a) =>
        ['EN_COMITE', 'APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA', 'RECHAZADA'].includes(a.status)
      ).length,
      pendingCount: pendingEval,
      efficiencyPct: calcPct(
        applications.filter((a) =>
          ['EN_COMITE', 'APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA', 'RECHAZADA'].includes(a.status)
        ).length,
        pendingEval
      ),
      summary: `${pendingEval} expediente(s) en depuración / evaluación`,
      targetSection: canAccessSection('evaluation') ? 'evaluation' : 'applications',
    },
    {
      id: 'dept_comite_formal',
      name: 'Comité y Formalización',
      completedCount: loans.length,
      pendingCount: pendingCommittee + pendingFormal,
      efficiencyPct: calcPct(loans.length, pendingCommittee + pendingFormal),
      summary: `${pendingCommittee} en comité · ${pendingFormal} por formalizar/desembolsar`,
      targetSection: canAccessSection('committee') ? 'committee' : 'formalization',
    },
    {
      id: 'dept_cobros',
      name: 'Cobros y Recuperación',
      completedCount: periodActions.length + completedTasks,
      pendingCount: pendingTasks,
      efficiencyPct: calcPct(completedTasks, pendingTasks),
      summary: `${periodActions.length} gestión(es) en el período · ${completedTasks} tarea(s) cerrada(s)`,
      targetSection: canAccessSection('cobranza_actions') ? 'cobranza_actions' : 'cobranza_my_actions',
    },
    {
      id: 'dept_finanzas_docs',
      name: 'Finanzas, Caja y Expedientes',
      completedCount: appliedPays + verifiedDocs,
      pendingCount: pendingPays + pendingDocs,
      efficiencyPct: calcPct(appliedPays + verifiedDocs, pendingPays + pendingDocs),
      summary: `${appliedPays} pago(s) aplicado(s) · ${verifiedDocs} doc(s) verificados`,
      targetSection: canAccessSection('cobranza_payments') ? 'cobranza_payments' : 'documents',
    },
  ];

  const operationsCount = processedApps + loans.length + appliedPays + periodActions.length;
  const pendingCasesCount = pendingEval + pendingCommittee + pendingFormal + pendingTasks + pendingPays;

  return {
    canViewFullTeam,
    activeUsersCount: canViewFullTeam ? activeUsersCount : 1,
    operationsCount,
    processedApplicationsCount: processedApps,
    collectionActionsCount: periodActions.length,
    pendingCasesCount,
    departments,
  };
}

export function buildEnrichedRecentActivity(params: {
  auditLogs: AuditLogRecord[];
  usersList: UserProfile[];
  hasPermission: (p: CreditPermission) => boolean;
  canAccessSection: (s: NavSectionId) => boolean;
  limit?: number;
}): EnrichedActivityEntry[] {
  const { auditLogs, usersList, hasPermission, canAccessSection, limit = 10 } = params;
  const userNameMap = new Map(usersList.map((u) => [u.uid, u.displayName]));

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

  const eventLabelMap: Record<string, string> = {
    customers: 'Cliente registrado / actualizado',
    applications: 'Solicitud de crédito',
    committee_decisions: 'Resolución de comité',
    formalizations: 'Formalización contractual',
    disbursements: 'Desembolso',
    loans: 'Préstamo en cartera',
    payments: 'Pago registrado / aplicado',
    payment_promises: 'Promesa de pago',
    payment_agreements: 'Acuerdo de pago',
    documents: 'Expediente documental',
    collection_actions: 'Gestión de cobro',
    risk_alerts: 'Alerta Centinela',
  };

  const resolveSection = (log: AuditLogRecord): NavSectionId => {
    if (log.entityType === 'customers' && canAccessSection('customers')) return 'customers';
    if (log.entityType === 'applications' && canAccessSection('applications')) return 'applications';
    if (log.entityType === 'committee_decisions' && canAccessSection('committee')) return 'committee';
    if (log.entityType === 'formalizations' && canAccessSection('formalization')) return 'formalization';
    if (log.entityType === 'disbursements' && canAccessSection('disbursements')) return 'disbursements';
    if (log.entityType === 'documents' && canAccessSection('documents')) return 'documents';
    if (log.entityType === 'payments' && canAccessSection('cobranza_payments')) return 'cobranza_payments';
    if (log.entityType === 'payment_agreements' && canAccessSection('cobranza_actions')) return 'cobranza_actions';
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
      if (isCollectionEntity(log.entityType)) return canViewCollections;
      return canViewCredit;
    })
    .slice(0, limit)
    .map((log) => {
      const tsDisplay = extractIsoDateFromTimestamp(log.timestamp) || 'Reciente';
      return {
        id: log.id,
        timestampDisplay: tsDisplay,
        eventLabel: eventLabelMap[log.entityType] || log.eventType,
        action: log.action,
        actorName: userNameMap.get(log.userId) || log.userEmail || log.userId,
        statusLabel: log.newState || 'Registrado',
        entityType: log.entityType,
        targetSection: resolveSection(log),
        applicationId: log.entityType === 'applications' ? log.entityId : undefined,
        loanId: log.entityType === 'loans' ? log.entityId : undefined,
      };
    });
}

export function buildAxyCoreIntelligenceInsights(params: {
  currency: CurrencyCode;
  consolidateUsdToDopRate?: number;
  metrics: ExecutiveCurrencyMetrics;
  enhancements: ExecutiveKpiEnhancements;
  alerts: HomeSmartAlert[];
  teamProductivity: TeamProductivitySummary;
  documents: ApplicationDocumentRecord[];
  payments: PaymentRecord[];
  canAccessSection: (s: NavSectionId) => boolean;
}): IntelligenceInsightItem[] {
  const {
    currency,
    consolidateUsdToDopRate,
    metrics,
    enhancements,
    alerts,
    teamProductivity,
    documents,
    payments,
    canAccessSection,
  } = params;

  const isConsolidated =
    currency === 'DOP' &&
    typeof consolidateUsdToDopRate === 'number' &&
    Number.isFinite(consolidateUsdToDopRate) &&
    consolidateUsdToDopRate > 0;
  const scopeLabel = isConsolidated
    ? `DOP consolidado (incl. USD a RD$${consolidateUsdToDopRate!.toFixed(2)} BCRD)`
    : currency;

  const insights: IntelligenceInsightItem[] = [];

  // 1. Morosidad vs snapshot / estado de cartera en riesgo
  if (metrics.activeLoansCount === 0) {
    insights.push({
      id: 'int_empty_portfolio',
      severity: 'OPORTUNIDAD',
      area: 'Cartera Activa',
      headline: `Sin cartera activa desembolsada en ${scopeLabel}`,
      detail:
        'Aún no existen préstamos vigentes en esta vista para medir tendencias de morosidad. Al completar el primer desembolso el monitor calculará PAR 1/30/60/90 automáticamente.',
      evidenceMetric: `0 préstamos activos (${currency})`,
      actionLabel: canAccessSection('new_application') ? 'Originar solicitud' : undefined,
      targetSection: canAccessSection('new_application') ? 'new_application' : undefined,
    });
  } else if (enhancements.parVariationPts !== null) {
    const worsened = enhancements.parVariationPts > 0;
    insights.push({
      id: 'int_par_trend',
      severity: worsened ? 'CRITICA' : 'OPTIMA',
      area: 'Riesgo de Cartera',
      headline: worsened
        ? `Incremento de morosidad PAR 1 en +${enhancements.parVariationPts} pts`
        : `Mejora de morosidad PAR 1 en ${enhancements.parVariationPts} pts`,
      detail: worsened
        ? `La exposición vencida alcanza ${formatMoney(metrics.par1Exposure, currency)} (${metrics.par1Pct ?? 0}% de la cartera). Se sugiere priorizar cobros tempranos y acuerdos preventivos.`
        : `La morosidad temprana se redujo respecto al corte anterior, manteniendo PAR 30 en ${metrics.par30Pct ?? 0}%.`,
      evidenceMetric: `PAR 1: ${metrics.par1Pct ?? 0}% · PAR 30: ${metrics.par30Pct ?? 0}%`,
      actionLabel: canAccessSection('cobranza_urgent') ? 'Atender mora' : undefined,
      targetSection: canAccessSection('cobranza_urgent') ? 'cobranza_urgent' : undefined,
    });
  } else if ((metrics.par1Pct ?? 0) > 0) {
    insights.push({
      id: 'int_par_current',
      severity: (metrics.par30Pct ?? 0) >= 5 ? 'CRITICA' : 'ATENCION',
      area: 'Salud de Cartera',
      headline: `Cartera en riesgo detectada: ${metrics.portfolioAtRiskCount} cuenta(s)`,
      detail: `Se registran ${formatMoney(metrics.portfolioAtRiskBalance, currency)} en vigilancia o mora (${metrics.par1Pct ?? 0}% PAR 1). Aún no hay un snapshot de fecha previa para calcular variación inter-corte.`,
      evidenceMetric: `Exposición vencida: ${formatMoney(metrics.par1Exposure, currency)}`,
      actionLabel: canAccessSection('cobranza_portfolio') ? 'Ver cartera en cobros' : undefined,
      targetSection: canAccessSection('cobranza_portfolio') ? 'cobranza_portfolio' : undefined,
    });
  } else {
    insights.push({
      id: 'int_par_clean',
      severity: 'OPTIMA',
      area: 'Salud de Cartera',
      headline: `Cartera ${scopeLabel} 100% al día sin atrasos registrados`,
      detail: `Los ${metrics.activeLoansCount} préstamos vigentes suman ${formatMoney(metrics.activePortfolioCapital, currency)} con 0 días de atraso promedio.`,
      evidenceMetric: 'PAR 1: 0.00% · PAR 30: 0.00%',
    });
  }

  // 2. Departamentos con operaciones pendientes
  const busiestDept = [...teamProductivity.departments].sort((a, b) => b.pendingCount - a.pendingCount)[0];
  if (busiestDept && busiestDept.pendingCount > 0) {
    insights.push({
      id: 'int_dept_pending',
      severity: busiestDept.pendingCount >= 5 ? 'ATENCION' : 'OPORTUNIDAD',
      area: busiestDept.name,
      headline: `${busiestDept.name} concentra ${busiestDept.pendingCount} operación(es) pendiente(s)`,
      detail: `${busiestDept.summary}. Despejar esta cola agiliza el ciclo completo de originación y cierre.`,
      evidenceMetric: `${busiestDept.pendingCount} pendiente(s) · ${busiestDept.completedCount} completada(s)`,
      actionLabel: 'Ir al departamento',
      targetSection: busiestDept.targetSection,
    });
  }

  // 3. Variaciones relevantes en la recuperación
  if (metrics.recoveryDeltaPct !== null) {
    const drop = metrics.recoveryDeltaPct < -10;
    const gain = metrics.recoveryDeltaPct > 10;
    insights.push({
      id: 'int_recovery_delta',
      severity: drop ? 'ATENCION' : gain ? 'OPTIMA' : 'OPORTUNIDAD',
      area: 'Recuperación',
      headline: drop
        ? `Caída de ${metrics.recoveryDeltaPct}% en recuperación aplicada (${scopeLabel})`
        : gain
        ? `Crecimiento de +${metrics.recoveryDeltaPct}% en recuperación aplicada (${scopeLabel})`
        : `Recuperación estable (${metrics.recoveryDeltaPct >= 0 ? `+${metrics.recoveryDeltaPct}%` : `${metrics.recoveryDeltaPct}%`})`,
      detail: `Se han aplicado ${metrics.recoveryPaymentsCount} pago(s) por ${formatMoney(metrics.recoveryPeriodTotal, currency)} frente a ${formatMoney(metrics.recoveryPrevTotal, currency)} del período anterior.`,
      evidenceMetric: `Capital ${formatMoney(metrics.recoveryPrincipal, currency)} · Interés ${formatMoney(metrics.recoveryInterest, currency)}`,
      actionLabel: canAccessSection('cobranza_payments') ? 'Revisar pagos' : undefined,
      targetSection: canAccessSection('cobranza_payments') ? 'cobranza_payments' : undefined,
    });
  } else if (metrics.recoveryPeriodTotal > 0) {
    insights.push({
      id: 'int_recovery_no_prev',
      severity: 'OPORTUNIDAD',
      area: 'Recuperación',
      headline: `Recuperación acumulada del período: ${formatMoney(metrics.recoveryPeriodTotal, currency)}`,
      detail: `Correspondiente a ${metrics.recoveryPaymentsCount} pago(s) verificado(s). Sin cobros aplicados en el período previo equivalente para calcular variación porcentual.`,
      evidenceMetric: `${metrics.recoveryPaymentsCount} pago(s) aplicado(s)`,
    });
  }

  // 4. Solicitudes que requieren atención & procesos con retraso
  if (metrics.pendingEvaluationCount > 0 || metrics.pendingCommitteeCount > 0) {
    insights.push({
      id: 'int_apps_attention',
      severity: metrics.pendingCommitteeCount > 0 ? 'ATENCION' : 'OPORTUNIDAD',
      area: 'Originación y Comité',
      headline: `${metrics.pendingApplicationsCount} solicitud(es) activas en flujo de crédito`,
      detail: `Distribución actual: ${metrics.pendingEvaluationCount} en evaluación, ${metrics.pendingCommitteeCount} esperando votación en comité y ${metrics.pendingFormalizationCount} en formalización.`,
      evidenceMetric: `${metrics.pendingApplicationsCount} expediente(s) en curso`,
      actionLabel: canAccessSection('evaluation') ? 'Atender evaluación' : 'Ver solicitudes',
      targetSection: canAccessSection('evaluation') ? 'evaluation' : 'applications',
    });
  }

  // 5. Oportunidades operativas: pagos sin aplicar / documentos observados / promesas incumplidas
  const unappliedCount = payments.filter(
    (p) =>
      (isConsolidated || p.currency === currency) &&
      ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
  ).length;
  const observedDocs = documents.filter((d) => d.reviewStatus === 'OBSERVADO').length;
  const criticalAlertsCount = alerts.filter((a) => a.priority === 'CRITICA').length;

  if (unappliedCount > 0 || observedDocs > 0 || metrics.brokenPromisesCount > 0) {
    const parts: string[] = [];
    if (unappliedCount > 0) parts.push(`${unappliedCount} pago(s) por verificar/aplicar`);
    if (metrics.brokenPromisesCount > 0) parts.push(`${metrics.brokenPromisesCount} promesa(s) incumplida(s)`);
    if (observedDocs > 0) parts.push(`${observedDocs} documento(s) observado(s)`);

    insights.push({
      id: 'int_process_delays',
      severity: criticalAlertsCount > 0 || metrics.brokenPromisesCount > 0 ? 'ATENCION' : 'OPORTUNIDAD',
      area: 'Eficiencia de Procesos',
      headline: 'Oportunidad de desbloqueo operativo inmediato',
      detail: `Se detectaron ${parts.join(', ')}. Resolver estos pendientes mejora el flujo de caja reconocido y la calidad de los expedientes.`,
      evidenceMetric: `${criticalAlertsCount} alerta(s) crítica(s) activa(s)`,
      actionLabel: unappliedCount > 0 && canAccessSection('cobranza_payments')
        ? 'Aplicar pagos pendientes'
        : canAccessSection('documents')
        ? 'Revisar expedientes'
        : undefined,
      targetSection:
        unappliedCount > 0 && canAccessSection('cobranza_payments')
          ? 'cobranza_payments'
          : canAccessSection('documents')
          ? 'documents'
          : undefined,
    });
  }

  return insights.slice(0, 6);
}
