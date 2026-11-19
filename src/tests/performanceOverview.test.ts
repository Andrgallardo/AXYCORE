import { describe, expect, it } from 'vitest';
import { buildPerformanceOverviewData } from '../engine/performanceOverviewEngine';
import {
  getRoleDashboardPolicy,
  sanitizeDashboardWidgetConfig,
} from '../engine/dashboardWidgetConfig';
import { canRoleAccessSection, hasRolePermission } from '../engine/rbac';
import type { ExecutiveCurrencyMetrics } from '../engine/executiveAnalytics';
import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CollectionDailySnapshotRecord,
  LoanRecord,
} from '../types/axycore';

function makeBaseMetrics(overrides: Partial<ExecutiveCurrencyMetrics> = {}): ExecutiveCurrencyMetrics {
  return {
    currency: 'DOP',
    activePortfolioCapital: 1_000_000,
    activeLoansCount: 10,
    disbursedPeriodTotal: 250_000,
    disbursedPrevTotal: 200_000,
    disbursedDeltaPct: 25,
    disbursedPeriodCount: 3,
    recoveryPeriodTotal: 120_000,
    recoveryPrincipal: 90_000,
    recoveryInterest: 30_000,
    recoveryOther: 0,
    recoveryPrevTotal: 100_000,
    recoveryDeltaPct: 20,
    recoveryPaymentsCount: 5,
    par1Pct: 12.5,
    par30Pct: 6.4,
    par60Pct: 2.0,
    par90Pct: 0.5,
    par1Exposure: 125_000,
    par30Exposure: 64_000,
    par60Exposure: 20_000,
    par90Exposure: 5_000,
    pendingApplicationsCount: 2,
    pendingEvaluationCount: 1,
    pendingCommitteeCount: 1,
    pendingFormalizationCount: 0,
    dailyDueAmount: 15_000,
    dailyDueCount: 2,
    dailyConfirmedReceivedAmount: 10_000,
    dailyConfirmedCount: 1,
    brokenPromisesCount: 0,
    brokenPromisesAmount: 0,
    approvalsCount: 3,
    approvalsDenominator: 4,
    approvalsTotalReceived: 6,
    approvalsRatePct: 75,
    portfolioAtRiskBalance: 125_000,
    portfolioAtRiskCount: 2,
    portfolioEvolutionSeries: [],
    disbursementsVsRecoverySeries: [],
    delinquencyBuckets: [],
    applicationsByStatus: [],
    recoveryByAgent: [],
    ...overrides,
  };
}

describe('Executive Performance Overview Engine (Approval Rate, Daily Placement, PAR 30)', () => {
  it('computes accurate daily placement volume, approval rate delta, and PAR 30 health status from real records', () => {
    const todayIso = '2026-11-19';
    const applications: ApplicationRecord[] = [
      // Previous 7-day window (2026-11-06 .. 2026-11-12): 1 approved, 1 rejected => 50%
      {
        id: 'app_prev_1',
        currency: 'DOP',
        status: 'APROBADA',
        createdAt: '2026-11-08T10:00:00Z',
        updatedAt: '2026-11-08T12:00:00Z',
      } as ApplicationRecord,
      {
        id: 'app_prev_2',
        currency: 'DOP',
        status: 'RECHAZADA',
        createdAt: '2026-11-10T10:00:00Z',
        updatedAt: '2026-11-10T12:00:00Z',
      } as ApplicationRecord,
      // Current 7-day window (2026-11-13 .. 2026-11-19): 3 approved, 1 rejected => 75% (+25 pts)
      {
        id: 'app_cur_1',
        currency: 'DOP',
        status: 'DESEMBOLSADA',
        createdAt: '2026-11-14T10:00:00Z',
        updatedAt: '2026-11-14T12:00:00Z',
      } as ApplicationRecord,
      {
        id: 'app_cur_2',
        currency: 'DOP',
        status: 'APROBADA',
        createdAt: '2026-11-16T10:00:00Z',
        updatedAt: '2026-11-16T12:00:00Z',
      } as ApplicationRecord,
      {
        id: 'app_cur_3',
        currency: 'DOP',
        status: 'RECHAZADA',
        createdAt: '2026-11-17T10:00:00Z',
        updatedAt: '2026-11-17T12:00:00Z',
      } as ApplicationRecord,
      {
        id: 'app_cur_4',
        currency: 'DOP',
        status: 'FORMALIZADA',
        createdAt: '2026-11-19T09:00:00Z',
        updatedAt: '2026-11-19T10:00:00Z',
      } as ApplicationRecord,
      // Pending pipeline
      {
        id: 'app_pending',
        currency: 'DOP',
        status: 'EN_EVALUACION',
        createdAt: '2026-11-19T11:00:00Z',
        updatedAt: '2026-11-19T11:00:00Z',
      } as ApplicationRecord,
      // Different currency must be excluded
      {
        id: 'app_usd',
        currency: 'USD',
        status: 'RECHAZADA',
        createdAt: '2026-11-19T11:00:00Z',
        updatedAt: '2026-11-19T11:00:00Z',
      } as ApplicationRecord,
    ];

    const loans: LoanRecord[] = [
      // Previous 7-day window placement: 100,000
      {
        id: 'loan_prev',
        currency: 'DOP',
        status: 'ACTIVO',
        disbursementDate: '2026-11-09',
        approvedPrincipal: 100_000,
        totalFinancedPrincipal: 100_000,
        currentPrincipalBalance: 95_000,
      } as LoanRecord,
      // Current 7-day window placements: 80,000 + 120,000 = 200,000 (+100%)
      {
        id: 'loan_cur_1',
        currency: 'DOP',
        status: 'ACTIVO',
        disbursementDate: '2026-11-15',
        approvedPrincipal: 80_000,
        totalFinancedPrincipal: 80_000,
        currentPrincipalBalance: 80_000,
      } as LoanRecord,
      {
        id: 'loan_cur_2',
        currency: 'DOP',
        status: 'ACTIVO',
        disbursementDate: '2026-11-19',
        approvedPrincipal: 120_000,
        totalFinancedPrincipal: 120_000,
        currentPrincipalBalance: 120_000,
      } as LoanRecord,
    ];

    const snapshots: CollectionDailySnapshotRecord[] = [
      {
        id: 'snap_1',
        organizationId: 'org_axycore_main',
        cutoffDate: '2026-11-13',
        policyVersion: '2.0',
        totalActiveLoans: 10,
        overdueLoansCount: 1,
        principalBalanceDop: 900_000,
        principalBalanceUsd: 0,
        par1Dop: 8.0,
        par30Dop: 4.2,
        par60Dop: 1.0,
        par90Dop: 0,
        par1Usd: 0,
        par30Usd: 0,
        par60Usd: 0,
        par90Usd: 0,
        overdueAmountDop: 37_800,
        overdueAmountUsd: 0,
        createdBy: 'sys',
      },
    ];

    const collectionAccounts: CollectionAccountRecord[] = [
      {
        loanId: 'loan_delinq_1',
        currency: 'DOP',
        stage: 'MORA_MEDIA',
        dpd: 45,
        totalOutstandingPrincipal: 64_000,
      } as unknown as CollectionAccountRecord,
    ];

    const result = buildPerformanceOverviewData({
      currency: 'DOP',
      windowDays: 7,
      todayIso,
      metrics: makeBaseMetrics({ par30Pct: 6.4, par30Exposure: 64_000 }),
      applications,
      loans,
      collectionAccounts,
      collectionDailySnapshots: snapshots,
    });

    expect(result.series).toHaveLength(7);
    expect(result.startIso).toBe('2026-11-13');
    expect(result.endIso).toBe('2026-11-19');

    // Approval Rate
    expect(result.approvalRate.currentPct).toBe(75);
    expect(result.approvalRate.deltaPts).toBe(25);
    expect(result.approvalRate.approvedCount).toBe(3);
    expect(result.approvalRate.rejectedCount).toBe(1);
    expect(result.approvalRate.pendingCount).toBe(1);

    // Daily Placement
    expect(result.dailyPlacement.todayAmount).toBe(120_000);
    expect(result.dailyPlacement.todayCount).toBe(1);
    expect(result.dailyPlacement.windowTotalAmount).toBe(200_000);
    expect(result.dailyPlacement.windowTotalCount).toBe(2);
    expect(result.dailyPlacement.deltaPct).toBe(100);
    expect(result.dailyPlacement.peakDayAmount).toBe(120_000);

    // PAR 30 anchored on live metrics today & snapshot on day 1
    expect(result.par30.currentPct).toBe(6.4);
    expect(result.par30.status).toBe('VIGILANCIA');
    expect(result.par30.accountsCount).toBe(1);
    expect(result.series[0].par30Pct).toBe(4.2);
    expect(result.series[6].par30Pct).toBe(6.4);
    expect(result.par30.deltaPts).toBeCloseTo(2.2, 2);

    // Deterministic fallback when no daily snapshots exist
    const fallbackResult = buildPerformanceOverviewData({
      currency: 'DOP',
      windowDays: 7,
      todayIso,
      metrics: makeBaseMetrics({ par30Pct: 6.4, par30Exposure: 64_000 }),
      applications,
      loans: [
        ...loans,
        {
          id: 'loan_delinq_1',
          currency: 'DOP',
          status: 'VENCIDO',
          disbursementDate: '2026-08-01',
          approvedPrincipal: 64_000,
          totalFinancedPrincipal: 64_000,
          currentPrincipalBalance: 64_000,
        } as LoanRecord,
      ],
      collectionAccounts,
      collectionDailySnapshots: [],
    });
    expect(fallbackResult.series[0].par30Exposure).toBe(64_000);
    expect(fallbackResult.series[0].par30Pct).toBeGreaterThan(0);
  });

  it('handles empty portfolios cleanly without synthetic data and promotes performanceOverview in existing saved configs', () => {
    const empty = buildPerformanceOverviewData({
      currency: 'USD',
      windowDays: 14,
      todayIso: '2026-11-19',
      metrics: makeBaseMetrics({
        currency: 'USD',
        activePortfolioCapital: 0,
        activeLoansCount: 0,
        par1Pct: 0,
        par30Pct: 0,
        par30Exposure: 0,
        approvalsRatePct: null,
      }),
      applications: [],
      loans: [],
      collectionAccounts: [],
      collectionDailySnapshots: [],
    });

    expect(empty.series).toHaveLength(14);
    expect(empty.hasPlacementData).toBe(false);
    expect(empty.hasApprovalData).toBe(false);
    expect(empty.hasParData).toBe(false);
    expect(empty.approvalRate.currentPct).toBeNull();
    expect(empty.par30.status).toBe('OPTIMO');

    // Verify existing saved config automatically promotes performanceOverview right after executiveSummary
    const adminPolicy = getRoleDashboardPolicy({
      role: 'ADMIN',
      hasPermission: (p) => hasRolePermission('ADMIN', p),
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    const migrated = sanitizeDashboardWidgetConfig(
      {
        sectionOrder: [
          'executiveSummary',
          'panorama',
          'intelligence',
          'alertsAndActivity',
          'performance',
          'collections',
          'teamProductivity',
          'shortcuts',
        ],
        hiddenSections: [],
      },
      adminPolicy,
      { organizationId: 'org_axycore_main', userId: 'u_admin' }
    );
    expect(migrated.sectionOrder[0]).toBe('executiveSummary');
    expect(migrated.sectionOrder[1]).toBe('performanceOverview');
  });
});
