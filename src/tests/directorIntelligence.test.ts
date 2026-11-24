import { describe, expect, it } from 'vitest';
import {
  buildScopedAiContext,
  computeExecutiveCurrencyMetrics,
  resolvePeriodBounds,
} from '../engine/executiveAnalytics';
import { hasRolePermission } from '../engine/rbac';
import {
  normalizeGeminiError,
  sanitizeFocusMode,
  sanitizeTargetSection,
} from '../../server/geminiAssistant';
import type {
  ApplicationRecord,
  CollectionAccountRecord,
  LoanRecord,
  PaymentRecord,
  RiskAlertRecord,
  UserProfile,
} from '../types/axycore';

const adminProfile: UserProfile = {
  uid: 'admin_test_1',
  email: 'admin@axycore.test',
  displayName: 'Director Ejecutivo',
  role: 'ADMIN',
  organizationId: 'org_axycore_main',
  status: 'ACTIVE',
};

const sampleLoans: LoanRecord[] = [
  {
    id: 'loan_1',
    organizationId: 'org_axycore_main',
    loanNumber: 'PRE-2026-001',
    applicationId: 'app_1',
    customerId: 'cust_1',
    applicantDisplayName: 'Inversiones Jucar',
    currency: 'DOP',
    approvedPrincipal: 2100000,
    currentPrincipalBalance: 1950000,
    interestRateAnnualPct: 24,
    termMonths: 24,
    paymentFrequency: 'MENSUAL',
    disbursementDate: '2026-06-12',
    status: 'VENCIDO',
  } as unknown as LoanRecord,
  {
    id: 'loan_2',
    organizationId: 'org_axycore_main',
    loanNumber: 'PRE-2026-002',
    applicationId: 'app_2',
    customerId: 'cust_2',
    applicantDisplayName: 'María Pérez',
    currency: 'USD',
    approvedPrincipal: 10000,
    currentPrincipalBalance: 8500,
    interestRateAnnualPct: 14,
    termMonths: 18,
    paymentFrequency: 'MENSUAL',
    disbursementDate: '2026-09-01',
    status: 'ACTIVO',
  } as unknown as LoanRecord,
];

const sampleAccounts: CollectionAccountRecord[] = [
  {
    id: 'loan_1',
    organizationId: 'org_axycore_main',
    loanId: 'loan_1',
    loanNumber: 'PRE-2026-001',
    applicationId: 'app_1',
    customerId: 'cust_1',
    applicantDisplayName: 'Inversiones Jucar',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    dpd: 45,
    maxHistoricalDpd: 45,
    stage: 'INTERMEDIA',
    bucket: '31_60',
    priority: 'ALTA',
    priorityScore: 82,
    priorityReasons: ['Mora 31-60 días'],
    overdueInstallmentsCount: 2,
    totalInstallmentsCount: 24,
    paidInstallmentsCount: 4,
    overduePrincipal: 250000,
    overdueInterest: 42000,
    overdueLateFee: 12000,
    overdueCharges: 0,
    overdueTotalAmount: 304000,
    totalOutstandingPrincipal: 1950000,
    pendingVerificationAmount: 0,
    assignedCollectorName: 'Carlos Gestor',
    brokenPromisesCount: 1,
    behaviorScore: 42,
    behaviorBand: 'RIESGO_ALTO',
    consentWhatsAppOptIn: true,
  },
];

const sampleApplications: ApplicationRecord[] = [
  {
    id: 'app_3',
    organizationId: 'org_axycore_main',
    applicationNumber: 'SOL-2026-101',
    applicantDisplayName: 'Luis Rodríguez',
    currency: 'DOP',
    requestedAmount: 160000,
    status: 'EN_COMITE',
    createdAt: '2026-11-20T12:00:00.000Z',
  } as unknown as ApplicationRecord,
];

const samplePayments: PaymentRecord[] = [
  {
    id: 'pay_1',
    organizationId: 'org_axycore_main',
    loanId: 'loan_1',
    loanNumber: 'PRE-2026-001',
    customerId: 'cust_1',
    customerName: 'Inversiones Jucar',
    currency: 'DOP',
    amount: 55000,
    status: 'RECIBIDO_PENDIENTE_VERIFICACION',
    paymentDate: '2026-11-23',
    method: 'TRANSFERENCIA',
    referenceNumber: 'REF-001',
    idempotencyKey: 'idem_1',
    reportedByUserId: 'col_1',
    reportedByName: 'Carlos Gestor',
  },
];

const sampleAlerts: RiskAlertRecord[] = [
  {
    id: 'alert_1',
    organizationId: 'org_axycore_main',
    loanId: 'loan_1',
    loanNumber: 'PRE-2026-001',
    customerId: 'cust_1',
    customerName: 'Inversiones Jucar',
    ruleCode: 'DESPLAZAMIENTO_TRAMO_MORA',
    severity: 'ALTA',
    title: 'Concentración elevada en mora 31-60 días',
    description: 'Préstamo con 45 días de atraso y saldo vencido significativo.',
    metricValue: '45 DPD · RD$304,000',
    status: 'ACTIVA',
  },
];

describe('AxyCore Director Intelligence — Audit & Resilience', () => {
  it('enriquece buildScopedAiContext con embudo, mora prioritaria, concentración y alertas respetando RBAC', () => {
    const bounds = resolvePeriodBounds('CURRENT_MONTH', undefined, undefined, '2026-11-24');
    const dopMetrics = computeExecutiveCurrencyMetrics({
      currency: 'DOP',
      bounds,
      todayIso: '2026-11-24',
      applications: sampleApplications,
      loans: sampleLoans,
      loanInstallments: [],
      collectionAccounts: sampleAccounts,
      payments: samplePayments,
      paymentPromises: [],
      usersList: [adminProfile],
    });
    const usdMetrics = computeExecutiveCurrencyMetrics({
      currency: 'USD',
      bounds,
      todayIso: '2026-11-24',
      applications: sampleApplications,
      loans: sampleLoans,
      loanInstallments: [],
      collectionAccounts: sampleAccounts,
      payments: samplePayments,
      paymentPromises: [],
      usersList: [adminProfile],
    });

    const ctx = buildScopedAiContext({
      userProfile: adminProfile,
      roleLabel: 'Administrador',
      organizationName: 'SU GLORIA MANO AMIGA',
      periodLabel: bounds.label,
      currencyFilter: 'SEPARATED',
      dopMetrics,
      usdMetrics,
      usdToDopRate: 60.2,
      operationalItems: [],
      recentActivity: [],
      applications: sampleApplications,
      loans: sampleLoans,
      collectionActions: [],
      riskAlerts: sampleAlerts,
      collectionAccounts: sampleAccounts,
      payments: samplePayments,
      paymentPromises: [],
      reconciliationExceptionsCount: 3,
      customersCount: 84,
      hasPermission: (p) => hasRolePermission('ADMIN', p),
    });

    const structural = ctx.resumenEstructuralCartera as Record<string, unknown>;
    expect(structural.totalClientesRegistrados).toBe(84);
    expect(structural.pagosPendientesValidacion).toBe(1);
    expect(structural.excepcionesConciliacionAbiertas).toBe(3);

    const topOverdue = ctx.topCuentasEnMora as Array<{ prestamo: string; diasAtraso: number }>;
    expect(topOverdue.length).toBe(1);
    expect(topOverdue[0].prestamo).toBe('PRE-2026-001');
    expect(topOverdue[0].diasAtraso).toBe(45);

    const topConc = ctx.topConcentracionCartera as Array<{ numero: string }>;
    expect(topConc.length).toBe(2);
    expect(topConc[0].numero).toBe('PRE-2026-001');

    const alertsDetail = ctx.alertasCentinelaDetalle as Array<{ titulo: string; regla: string }>;
    expect(alertsDetail.length).toBe(1);
    expect(alertsDetail[0].titulo).toContain('Concentración');
    expect(alertsDetail[0].regla).toBe('DESPLAZAMIENTO_TRAMO_MORA');

    // Verify strict RBAC isolation when user is EXTERNAL_CLIENT
    const restrictedCtx = buildScopedAiContext({
      userProfile: { ...adminProfile, role: 'EXTERNAL_CLIENT' },
      roleLabel: 'Cliente Externo',
      organizationName: 'SU GLORIA MANO AMIGA',
      periodLabel: bounds.label,
      currencyFilter: 'DOP',
      dopMetrics,
      usdMetrics,
      operationalItems: [],
      recentActivity: [],
      applications: sampleApplications,
      loans: sampleLoans,
      collectionActions: [],
      riskAlerts: sampleAlerts,
      collectionAccounts: sampleAccounts,
      payments: samplePayments,
      hasPermission: (p) => hasRolePermission('EXTERNAL_CLIENT', p),
    });
    expect(restrictedCtx.topCuentasEnMora).toEqual([]);
    expect(restrictedCtx.alertasCentinelaDetalle).toEqual([]);
    expect(restrictedCtx.embudoSolicitudesPorEstado).toBeNull();
  });

  it('normaliza errores 503/429/403/504 de Gemini a mensajes ejecutivos claros sin exponer JSON crudo', () => {
    const highDemand = normalizeGeminiError(
      new Error(
        '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'
      )
    );
    expect(highDemand.status).toBe(503);
    expect(highDemand.message).toContain('alta demanda temporal');
    expect(highDemand.message).not.toContain('{"error"');

    const quota = normalizeGeminiError(new Error('RESOURCE_EXHAUSTED 429 quota exceeded'));
    expect(quota.status).toBe(429);
    expect(quota.message).toContain('cuota');

    const invalidKey = normalizeGeminiError(new Error('API_KEY_INVALID 403'));
    expect(invalidKey.status).toBe(403);
    expect(invalidKey.message).toContain('Settings > Secrets');
  });

  it('sanitiza rutas de navegación ampliadas y modos de enfoque de AxyCore Director', () => {
    expect(sanitizeTargetSection('accounting_payment_validation')).toBe('accounting_payment_validation');
    expect(sanitizeTargetSection('cobranza_legal')).toBe('cobranza_legal');
    expect(sanitizeTargetSection('intelligence_altera')).toBe('intelligence_altera');
    expect(sanitizeTargetSection('regula')).toBe('regula');
    expect(sanitizeTargetSection('ruta_invalida_xyz')).toBeUndefined();

    expect(sanitizeFocusMode('RIESGO_MORA')).toBe('RIESGO_MORA');
    expect(sanitizeFocusMode('ESCENARIOS_STRESS')).toBe('ESCENARIOS_STRESS');
    expect(sanitizeFocusMode('INVALID_MODE')).toBe('INTEGRAL');
  });
});
