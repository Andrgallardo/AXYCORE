import { describe, expect, it } from 'vitest';
import {
  computeExecutiveCurrencyMetrics,
  consolidateExecutiveMetricsToDop,
  type PeriodBounds,
} from '../engine/executiveAnalytics';
import {
  buildCollectionsOverviewSummary,
  buildPanoramaSeriesAndKpis,
} from '../engine/homeDashboardEngine';
import { buildPerformanceOverviewData } from '../engine/performanceOverviewEngine';
import type {
  CollectionAccountRecord,
  LoanRecord,
  PaymentPromiseRecord,
  PaymentRecord,
} from '../types/axycore';

const TODAY_ISO = '2026-11-20';
const BOUNDS: PeriodBounds = {
  label: 'Mes actual',
  startIso: '2026-11-01',
  endIso: '2026-11-20',
  prevStartIso: '2026-10-01',
  prevEndIso: '2026-10-20',
};

const BCRD_RATE = 60.0;

function makeLoan(overrides: Partial<LoanRecord>): LoanRecord {
  return {
    id: 'loan_1',
    organizationId: 'org_test',
    loanNumber: 'PR-001',
    applicationId: 'app_1',
    customerId: 'cust_1',
    applicantDisplayName: 'Cliente Prueba',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 100000,
    monthlyInterestRate: 0.03,
    termMonths: 12,
    paymentFrequency: 'MENSUAL',
    amortizationMethod: 'CUOTA_NIVELADA',
    disbursementDate: '2026-11-05',
    firstPaymentDate: '2026-12-05',
    status: 'ACTIVO',
    createdAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
    ...overrides,
  } as LoanRecord;
}

function makeAccount(overrides: Partial<CollectionAccountRecord>): CollectionAccountRecord {
  return {
    loanId: 'loan_1',
    organizationId: 'org_test',
    loanNumber: 'PR-001',
    customerId: 'cust_1',
    applicantDisplayName: 'Cliente Prueba',
    currency: 'DOP',
    stage: 'AL_DIA',
    dpd: 0,
    totalOutstandingPrincipal: 100000,
    overdueTotalAmount: 0,
    overdueInstallmentsCount: 0,
    ...overrides,
  } as CollectionAccountRecord;
}

function makePayment(overrides: Partial<PaymentRecord>): PaymentRecord {
  return {
    id: 'pay_1',
    organizationId: 'org_test',
    loanId: 'loan_1',
    loanNumber: 'PR-001',
    customerId: 'cust_1',
    customerName: 'Cliente Prueba',
    currency: 'DOP',
    amount: 10000,
    status: 'APLICADO',
    method: 'TRANSFERENCIA',
    paymentDate: '2026-11-10',
    appliedDate: '2026-11-10',
    appliedBreakdown: {
      principal: 7000,
      interest: 2500,
      lateFee: 500,
      otherCharges: 0,
    },
    createdAt: '2026-11-10T10:00:00Z',
    ...overrides,
  } as PaymentRecord;
}

describe('Consolidación DOP + USD con tasa oficial BCRD', () => {
  const dopLoan = makeLoan({
    id: 'loan_dop',
    loanNumber: 'PR-DOP-1',
    currency: 'DOP',
    productCode: 'PERSONAL_DOP',
    approvedPrincipal: 2_000_000,
    totalFinancedPrincipal: 2_000_000,
    currentPrincipalBalance: 2_000_000,
    disbursementDate: '2026-11-05',
    status: 'ACTIVO',
  });

  const usdLoan = makeLoan({
    id: 'loan_usd',
    loanNumber: 'PR-USD-1',
    currency: 'USD',
    productCode: 'EMPRESARIAL_USD',
    approvedPrincipal: 100_000,
    totalFinancedPrincipal: 100_000,
    currentPrincipalBalance: 100_000,
    disbursementDate: '2026-11-10',
    status: 'VENCIDO',
  });

  const dopAccount = makeAccount({
    loanId: 'loan_dop',
    loanNumber: 'PR-DOP-1',
    currency: 'DOP',
    stage: 'AL_DIA',
    dpd: 0,
    totalOutstandingPrincipal: 2_000_000,
    overdueTotalAmount: 0,
  });

  const usdAccount = makeAccount({
    loanId: 'loan_usd',
    loanNumber: 'PR-USD-1',
    currency: 'USD',
    stage: 'INTERMEDIA',
    dpd: 45,
    totalOutstandingPrincipal: 100_000,
    overdueTotalAmount: 15_000,
    overdueInstallmentsCount: 2,
  });

  const dopPayment = makePayment({
    id: 'pay_dop',
    loanId: 'loan_dop',
    loanNumber: 'PR-DOP-1',
    currency: 'DOP',
    amount: 50_000,
    appliedBreakdown: { principal: 35_000, interest: 15_000, lateFee: 0, otherCharges: 0 },
  });

  const usdPayment = makePayment({
    id: 'pay_usd',
    loanId: 'loan_usd',
    loanNumber: 'PR-USD-1',
    currency: 'USD',
    amount: 2_000,
    appliedBreakdown: { principal: 1_500, interest: 400, lateFee: 100, otherCharges: 0 },
  });

  const loans = [dopLoan, usdLoan];
  const accounts = [dopAccount, usdAccount];
  const payments = [dopPayment, usdPayment];

  it('convierte todos los montos USD a DOP usando la tasa BCRD y recalcula PAR ponderado', () => {
    const dopMetrics = computeExecutiveCurrencyMetrics({
      currency: 'DOP',
      bounds: BOUNDS,
      todayIso: TODAY_ISO,
      applications: [],
      loans,
      loanInstallments: [],
      collectionAccounts: accounts,
      payments,
      paymentPromises: [],
      usersList: [],
    });

    const usdMetrics = computeExecutiveCurrencyMetrics({
      currency: 'USD',
      bounds: BOUNDS,
      todayIso: TODAY_ISO,
      applications: [],
      loans,
      loanInstallments: [],
      collectionAccounts: accounts,
      payments,
      paymentPromises: [],
      usersList: [],
    });

    const consolidated = consolidateExecutiveMetricsToDop(dopMetrics, usdMetrics, BCRD_RATE);

    // 2,000,000 DOP + (100,000 USD * 60) = 8,000,000 DOP (NOT 2,100,000!)
    expect(consolidated.currency).toBe('DOP');
    expect(consolidated.activePortfolioCapital).toBe(8_000_000);
    expect(consolidated.activeLoansCount).toBe(2);

    // Desembolsos: 2,000,000 + 100,000 * 60 = 8,000,000 DOP
    expect(consolidated.disbursedPeriodTotal).toBe(8_000_000);
    expect(consolidated.disbursedPeriodCount).toBe(2);

    // Recuperación: 50,000 + 2,000 * 60 = 170,000 DOP
    expect(consolidated.recoveryPeriodTotal).toBe(170_000);
    expect(consolidated.recoveryPrincipal).toBe(35_000 + 1_500 * BCRD_RATE);
    expect(consolidated.recoveryInterest).toBe(15_000 + 400 * BCRD_RATE);
    expect(consolidated.recoveryOther).toBe(100 * BCRD_RATE);

    // PAR 1 y PAR 30 ponderados sobre base consolidada de RD$8,000,000:
    // Exposición USD vencida (45 DPD) = 100,000 * 60 = 6,000,000 DOP => 6M / 8M = 75.00%
    expect(consolidated.par1Exposure).toBe(6_000_000);
    expect(consolidated.par30Exposure).toBe(6_000_000);
    expect(consolidated.par1Pct).toBe(75);
    expect(consolidated.par30Pct).toBe(75);

    // Tramo 31-60d debe reflejar RD$6,000,000 y 1 cuenta
    const bucket31to60 = consolidated.delinquencyBuckets.find((b) => b.bucket.includes('31'));
    expect(bucket31to60?.count).toBe(1);
    expect(bucket31to60?.exposure).toBe(6_000_000);
  });

  it('consolida series del Panorama Financiero, distribución por producto y Performance Overview en RD$', () => {
    const dopMetrics = computeExecutiveCurrencyMetrics({
      currency: 'DOP',
      bounds: BOUNDS,
      todayIso: TODAY_ISO,
      applications: [],
      loans,
      loanInstallments: [],
      collectionAccounts: accounts,
      payments,
      paymentPromises: [],
      usersList: [],
    });
    const usdMetrics = computeExecutiveCurrencyMetrics({
      currency: 'USD',
      bounds: BOUNDS,
      todayIso: TODAY_ISO,
      applications: [],
      loans,
      loanInstallments: [],
      collectionAccounts: accounts,
      payments,
      paymentPromises: [],
      usersList: [],
    });
    const consolidated = consolidateExecutiveMetricsToDop(dopMetrics, usdMetrics, BCRD_RATE);

    const panorama = buildPanoramaSeriesAndKpis({
      currency: 'DOP',
      consolidateUsdToDopRate: BCRD_RATE,
      granularity: 'MENSUAL',
      todayIso: TODAY_ISO,
      bounds: BOUNDS,
      metrics: consolidated,
      loans,
      payments,
      loanInstallments: [],
      collectorTargets: [],
      snapshots: [],
    });

    // Distribución por producto: EMPRESARIAL_USD = 6,000,000 (75%), PERSONAL_DOP = 2,000,000 (25%)
    const empresarialUsd = panorama.productDistribution.find((p) => p.productCode === 'EMPRESARIAL_USD');
    const personalDop = panorama.productDistribution.find((p) => p.productCode === 'PERSONAL_DOP');
    expect(empresarialUsd?.amount).toBe(6_000_000);
    expect(empresarialUsd?.sharePct).toBe(75);
    expect(personalDop?.amount).toBe(2_000_000);
    expect(personalDop?.sharePct).toBe(25);

    // Último punto de la serie mensual debe sumar desembolsos y recuperación convertidos
    const lastBucket = panorama.series[panorama.series.length - 1];
    expect(lastBucket.total).toBe(8_000_000);
    expect(lastBucket.desembolsos).toBe(8_000_000);
    expect(lastBucket.recuperacion).toBe(170_000);

    // PerformanceOverviewWidget en modo consolidado
    const perf = buildPerformanceOverviewData({
      currency: 'DOP',
      consolidateUsdToDopRate: BCRD_RATE,
      windowDays: 30,
      todayIso: TODAY_ISO,
      metrics: consolidated,
      applications: [],
      loans,
      collectionAccounts: accounts,
      collectionDailySnapshots: [],
    });
    expect(perf.dailyPlacement.windowTotalAmount).toBe(8_000_000);
    expect(perf.dailyPlacement.windowTotalCount).toBe(2);
    expect(perf.par30.currentPct).toBe(75);
    expect(perf.par30.currentExposure).toBe(6_000_000);
    expect(perf.par30.accountsCount).toBe(1);

    // Resumen de Cobros en modo consolidado
    const usdPromise: PaymentPromiseRecord = {
      id: 'pr_usd',
      organizationId: 'org_test',
      loanId: 'loan_usd',
      loanNumber: 'PR-USD-1',
      customerId: 'cust_1',
      customerName: 'Cliente USD',
      currency: 'USD',
      promisedAmount: 500,
      fulfilledAmount: 0,
      promisedDate: '2026-11-25',
      status: 'VIGENTE',
    } as PaymentPromiseRecord;

    const collSummary = buildCollectionsOverviewSummary({
      currency: 'DOP',
      consolidateUsdToDopRate: BCRD_RATE,
      todayIso: TODAY_ISO,
      bounds: BOUNDS,
      metrics: consolidated,
      collectionAccounts: accounts,
      collectionActions: [],
      paymentPromises: [usdPromise],
      payments,
      collectorTargets: [],
    });

    // Promesa vigente de US$500 -> RD$30,000
    expect(collSummary.activePromisesAmount).toBe(30_000);
    // Recuperación por etapa: AL_DIA = RD$50,000, INTERMEDIA = US$2,000 * 60 = RD$120,000
    const alDia = collSummary.recoveryByStage.find((s) => s.stage === 'AL_DIA');
    const intermedia = collSummary.recoveryByStage.find((s) => s.stage === 'INTERMEDIA');
    expect(alDia?.amount).toBe(50_000);
    expect(intermedia?.amount).toBe(120_000);
  });
});
