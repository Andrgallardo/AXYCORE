import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_V2, evaluateCreditDecisionV2 } from '../engine/decisionEngineV2';
import { generateAmortizationSchedule, addMonthsPreservingAnchor } from '../engine/amortizationEngine';
import {
  canExecuteDisbursement,
  canUserApproveCommittee,
  evaluateCollegialCommitteeVotes,
} from '../engine/workflowGuards';
import {
  canRoleAccessSection,
  getCreditWorkflowAccess,
  hasRolePermission,
} from '../engine/rbac';
import { buildCustomerStatusEmailPayload } from '../engine/emailTemplates';
import {
  buildApplicationCriticalPushPayload,
  buildFcmTokenDocId,
  buildInboxPushPayload,
  CRITICAL_APPLICATION_STATUSES,
  shouldTriggerApplicationCriticalPush,
  shouldTriggerInboxPush,
} from '../engine/pushPayload';
import {
  DEFAULT_FCM_VAPID_KEY,
  getConfiguredVapidKey,
  isVapidKeyConfigured,
} from '../firebase/messaging';
import {
  buildOcrDocumentNote,
  classifyAmountMatch,
  computeNumericVariancePct,
  isSupportedOcrMimeType,
  normalizeComparableIdNumber,
  normalizeComparableText,
  parseDataUrlForOcr,
} from '../engine/documentOcr';
import {
  buildRiskHeatmapMatrix,
  resolveCustomerProfile,
  resolveGeoZone,
} from '../engine/riskHeatmap';
import {
  DEFAULT_WORKFLOW_CONFIG,
  insertWorkflowStageAt,
  normalizeWorkflowThresholds,
  reorderWorkflowStages,
  simulateWorkflowRoute,
  syncRiskBandsWithAutoRejectThreshold,
} from '../engine/workflowBuilder';
import {
  buildBiometricAuditNote,
  calibrateBiometricVerdict,
  isSupportedSelfieMimeType,
} from '../engine/biometricVerification';
import {
  buildCriticalAuditEntryPayload,
  classifyCriticalAuditEvent,
  isConfidentialDocumentCategory,
  summarizeCriticalAuditLogs,
} from '../engine/criticalAudit';
import {
  buildOperationalDaySummary,
  buildScopedAiContext,
  computeExecutiveCurrencyMetrics,
  getSantoDomingoClockInfo,
  resolvePeriodBounds,
} from '../engine/executiveAnalytics';
import {
  applyMarkAsReadTransition,
  buildUnifiedNotificationCenterItems,
  buildUserNotificationDocId,
  buildUserNotificationPayload,
  computePendingNotificationsCount,
  getNotificationAlertVisualMeta,
  mergeFirestoreAndDerivedNotifications,
  NOTIFICATION_ALERT_VISUAL_META,
  summarizeNotificationsByAlertType,
} from '../engine/notificationCenterEngine';
import {
  AXYCORE_MODULE_CATALOG,
  buildNewCompanyRegistrationBundle,
  canUserAccessRecordByTenant,
  checkTenantApiAccess,
  checkTenantSectionAccess,
  filterRecordsByTenant,
  generateCorporateAccessCode,
  isOrganizationMembershipRecord,
  isOrganizationRecord,
  isSuperAdminUser,
  ORGANIZATION_MEMBERSHIPS_COLLECTION,
  ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA,
  ORGANIZATIONS_COLLECTION,
  ORGANIZATIONS_COLLECTION_SCHEMA,
  resolveOrganizationByCorporateCode,
  runControlledSuGloriaMigration,
  SU_GLORIA_MANO_AMIGA_ORG,
  SU_GLORIA_ORG_ID,
  switchUserOrganizationWorkspace,
  tenantService,
  TenantService,
  validateModuleToggle,
  validateOrganizationMembershipSchema,
  validateOrganizationSchema,
} from '../engine/multiTenantEngine';
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  derToRawEcdsaSignature,
  detectBiometricPlatformLabel,
  parseAuthenticatorData,
  verifyClientDataJson,
  verifyWebAuthnAssertionLocal,
} from '../services/biometricAuth';
import {
  buildCustomerDirectorySummaries,
  filterCustomerDirectory,
} from '../engine/customerDirectory';
import type {
  ApplicationRecord,
  AuditLogRecord,
  AxyCoreModuleCode,
  BiometricVerificationResult,
  CollectionAccountRecord,
  CreditEvaluationRecord,
  CreditPolicyRecord,
  CustomerRecord,
  DisbursementRecord,
  DocumentOcrResult,
  LoanInstallmentRecord,
  LoanRecord,
  NavSectionId,
  OrganizationMembershipRecord,
  OrganizationRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';

const BASE_POLICY: CreditPolicyRecord = {
  ...DEFAULT_POLICY_V2,
  createdBy: 'admin_1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_test_1',
    organizationId: 'org_axycore_main',
    documentType: 'CEDULA',
    documentNumber: '00112345678',
    documentKey: 'org_axycore_main_CEDULA_00112345678',
    firstName: 'Carlos',
    lastName: 'Ramírez',
    phone: '8095551234',
    email: 'carlos@example.com',
    address: 'Av. Winston Churchill 102, Santo Domingo',
    residenceMonths: 48,
    housingType: 'PROPIA',
    housingPayment: 0,
    socialMediaDeclared: 'YES',
    socialMediaHandle: '@carlosr',
    createdBy: 'officer_1',
    ...overrides,
  };
}

function makeApplication(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: 'app_test_1',
    organizationId: 'org_axycore_main',
    applicationNumber: 'SOL-2026-0001',
    fileNumber: 'EXP-2026-0001',
    channel: 'INTERNAL',
    applicantType: 'INDIVIDUAL',
    customerId: 'cust_test_1',
    applicantDisplayName: 'Carlos Ramírez',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    requestedAmount: 100000,
    requestedTermMonths: 12,
    paymentFrequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    loanPurpose: 'Capital de trabajo / mejora hogar',
    loanPurposeDescription: 'Remodelación parcial de vivienda familiar y compra de mobiliario.',
    financialData: {
      activityType: 'Empleado privado',
      employerOrBusinessName: 'Grupo Empresarial del Caribe',
      occupationOrRole: 'Ingeniero Senior',
      employmentMonths: 48,
      incomeSourceType: 'FIJA_RECURRENTE',
      primaryNetIncome: 180000,
      additionalIncomeStatus: 'EXPLICIT_NONE',
      additionalNetIncome: 0,
      declaredTotalMonthlyIncome: 180000,
      incomeCurrency: 'DOP',
      essentialExpenses: 40000,
      housingPayment: 0,
      housingIncludedInExpenses: false,
      debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      debtCount: 0,
      totalDebtBalance: 0,
      currentDebtPayments: 0,
    },
    references: [
      { name: 'Ana Pérez', relationship: 'Hermana', phone: '8095559988' },
      { name: 'Luis Gómez', relationship: 'Colega', phone: '8095557766' },
    ],
    declaredDocumentsSummary: {
      hasIdentityDoc: true,
      hasIncomeEvidence: true,
    },
    status: 'RECIBIDA',
    createdBy: 'officer_1',
    ...overrides,
  };
}

describe('Motor de Decisiones Crediticias AxyCore V2', () => {
  it('calcula score máximo exacto de 100 con suma de 22 indicadores y tasa 4.0%', () => {
    const res = evaluateCreditDecisionV2({
      application: makeApplication(),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });

    expect(res.indicatorDetails).toHaveLength(22);
    const sum = res.indicatorDetails.reduce((s, d) => s + d.awardedPoints, 0);
    const maxSum = res.indicatorDetails.reduce((s, d) => s + d.maxPoints, 0);
    expect(maxSum).toBe(100);
    expect(sum).toBe(100);
    expect(res.totalScore).toBe(100);
    expect(res.riskBand.code).toBe('MUY_BAJO');
    expect(res.recommendedRateMonthly).toBe(0.04);
    expect(res.status).toBe('PREOFERTA');
    expect(res.recommendedAmount).toBe(100000);
  });

  it('calcula score mínimo de 0 y estado SIN_OFERTA para score <= 49', () => {
    const res = evaluateCreditDecisionV2({
      application: makeApplication({
        requestedAmount: 50000,
        requestedTermMonths: 12,
        loanPurpose: '',
        loanPurposeDescription: '',
        references: [],
        declaredDocumentsSummary: { hasIdentityDoc: false, hasIncomeEvidence: false },
        financialData: {
          employerOrBusinessName: '',
          occupationOrRole: '',
          employmentMonths: 2,
          incomeSourceType: 'IRREGULAR',
          primaryNetIncome: 10000,
          additionalIncomeStatus: 'INCONSISTENT',
          additionalNetIncome: 0,
          declaredTotalMonthlyIncome: 25000,
          incomeCurrency: 'DOP',
          essentialExpenses: 9500,
          housingPayment: 4000,
          housingIncludedInExpenses: false,
          debtDeclarationStatus: 'HAS_DEBTS',
          debtCount: 5,
          totalDebtBalance: 100000,
          currentDebtPayments: 5000,
          bankDebtPayment: 1000,
        },
      }),
      customer: makeCustomer({
        phone: '123',
        address: '',
        email: '',
        residenceMonths: 0,
        housingType: 'NO_DECLARADA',
        housingPayment: 4000,
        socialMediaDeclared: 'UNANSWERED',
        socialMediaHandle: '',
      }),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });

    expect(res.totalScore).toBeLessThan(49);
    expect(res.status).toBe('SIN_OFERTA');
    expect(res.recommendedAmount).toBe(0);

    // Minimum possible score check (when all non-conditional fields score 0)
    const zeroApp = makeApplication({
      requestedAmount: 50000,
      requestedTermMonths: 12,
      paymentFrequency: undefined as unknown as 'MENSUAL',
      loanPurpose: '',
      loanPurposeDescription: '',
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: false, hasIncomeEvidence: false },
      financialData: {
        employerOrBusinessName: '',
        occupationOrRole: '',
        employmentMonths: 1,
        incomeSourceType: 'SIN_INGRESOS',
        primaryNetIncome: 0,
        additionalIncomeStatus: 'INCONSISTENT',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 10000,
        incomeCurrency: 'DOP',
        essentialExpenses: 5000,
        housingPayment: 2000,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'UNDECLARED',
        debtCount: null,
        totalDebtBalance: null,
        currentDebtPayments: null,
      },
    });
    const zeroRes = evaluateCreditDecisionV2({
      application: zeroApp,
      customer: makeCustomer({
        phone: '',
        address: '',
        email: '',
        residenceMonths: 0,
        housingType: 'NO_DECLARADA',
        housingPayment: 2000,
        socialMediaDeclared: 'UNANSWERED',
        socialMediaHandle: '',
      }),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(zeroRes.indicatorDetails.find((i) => i.number === 16)?.awardedPoints).toBe(0);
    expect(zeroRes.totalScore).toBeLessThanOrEqual(3); // only 3/4 requested conditions if currency/amount/term present
  });

  it('aplica tasa 4.0% en score >= 90, tasa 5.5% y plazo máximo 6 meses en score 50–59, y sin oferta en 49', () => {
    // Score in 50-59 (ALTO) with requestedTerm 12 -> capped to 6 months, rate 5.5%
    const altoRes = evaluateCreditDecisionV2({
      application: makeApplication({
        requestedAmount: 80000,
        requestedTermMonths: 12,
        loanPurpose: 'Consumo',
        loanPurposeDescription: '',
        references: [{ name: 'Pedro', relationship: 'Amigo', phone: '8095550001' }],
        declaredDocumentsSummary: { hasIdentityDoc: false, hasIncomeEvidence: false },
        financialData: {
          employerOrBusinessName: 'Tienda Local',
          occupationOrRole: '',
          employmentMonths: 14,
          incomeSourceType: 'MIXTA_RECURRENTE',
          primaryNetIncome: 50000,
          additionalIncomeStatus: 'PARTIAL',
          additionalNetIncome: 0,
          declaredTotalMonthlyIncome: 50000,
          incomeCurrency: 'DOP',
          essentialExpenses: 27000,
          housingPayment: 12000,
          housingIncludedInExpenses: true,
          debtDeclarationStatus: 'HAS_DEBTS',
          debtCount: 2,
          totalDebtBalance: 160000,
          currentDebtPayments: 12000,
        },
      }),
      customer: makeCustomer({
        email: '',
        residenceMonths: 8,
        housingType: 'ALQUILADA',
        housingPayment: 12000,
        socialMediaDeclared: 'UNANSWERED',
        socialMediaHandle: '',
      }),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });

    expect(altoRes.totalScore).toBeGreaterThanOrEqual(50);
    expect(altoRes.totalScore).toBeLessThanOrEqual(59);
    expect(altoRes.riskBand.code).toBe('ALTO');
    expect(altoRes.recommendedRateMonthly).toBe(0.055);
    expect(altoRes.recommendedTermMonths).toBe(6); // Capped to 6 months max!
  });

  it('respeta límites exactos por producto (Personal DOP, Empresarial DOP, Personal USD, Empresarial USD)', () => {
    const belowMin = evaluateCreditDecisionV2({
      application: makeApplication({ productCode: 'PERSONAL_DOP', currency: 'DOP', requestedAmount: 450 }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(belowMin.status).toBe('SOLICITUD_FUERA_POLITICA');

    const aboveMaxPersonal = evaluateCreditDecisionV2({
      application: makeApplication({ productCode: 'PERSONAL_DOP', currency: 'DOP', requestedAmount: 550000 }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(aboveMaxPersonal.status).toBe('SOLICITUD_FUERA_POLITICA');

    const empDop = evaluateCreditDecisionV2({
      application: makeApplication({
        applicantType: 'BUSINESS',
        productCode: 'EMPRESARIAL_DOP',
        currency: 'DOP',
        requestedAmount: 900000,
        requestedTermMonths: 12,
        businessFinancialData: {
          grossSales: 2000000,
          operatingCosts: 1200000,
          netMonthlyFlow: 800000,
          businessObligationsMonthly: 0,
          totalBusinessDebtBalance: 0,
          businessDebtCount: 0,
          operationsMonths: 48,
          incomeCurrency: 'DOP',
          debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(empDop.status).toBe('PREOFERTA');
    expect(empDop.recommendedAmount).toBe(900000);

    const personalUsdOutOfTerm = evaluateCreditDecisionV2({
      application: makeApplication({
        productCode: 'PERSONAL_USD',
        currency: 'USD',
        requestedAmount: 3000,
        requestedTermMonths: 24,
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(personalUsdOutOfTerm.status).toBe('SOLICITUD_FUERA_POLITICA');

    const empUsdMax = evaluateCreditDecisionV2({
      application: makeApplication({
        applicantType: 'BUSINESS',
        productCode: 'EMPRESARIAL_USD',
        currency: 'USD',
        requestedAmount: 5001,
        requestedTermMonths: 12,
        businessFinancialData: {
          grossSales: 40000,
          operatingCosts: 25000,
          netMonthlyFlow: 15000,
          operationsMonths: 48,
          incomeCurrency: 'USD',
          debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(empUsdMax.status).toBe('SOLICITUD_FUERA_POLITICA');
  });

  it('distingue ausencia de ingresos, ausencia de gastos, ausencia de deudas y cero deudas explícito', () => {
    const noIncome = evaluateCreditDecisionV2({
      application: makeApplication({
        financialData: { ...makeApplication().financialData, primaryNetIncome: null },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(noIncome.status).toBe('DATOS_INSUFICIENTES');

    const noExpenses = evaluateCreditDecisionV2({
      application: makeApplication({
        financialData: { ...makeApplication().financialData, essentialExpenses: null },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(noExpenses.status).toBe('DATOS_INSUFICIENTES');

    const undeclaredDebts = evaluateCreditDecisionV2({
      application: makeApplication({
        financialData: { ...makeApplication().financialData, debtDeclarationStatus: 'UNDECLARED' },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(undeclaredDebts.status).toBe('DATOS_INSUFICIENTES_DEUDA');

    const explicitZeroDebts = evaluateCreditDecisionV2({
      application: makeApplication(),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(explicitZeroDebts.indicatorDetails.find((i) => i.number === 22)?.awardedPoints).toBe(2);
  });

  it('evita doble descuento de vivienda y rechaza ventas brutas sin flujo neto en empresas', () => {
    const housingIncludedRes = evaluateCreditDecisionV2({
      application: makeApplication({
        financialData: {
          ...makeApplication().financialData,
          primaryNetIncome: 100000,
          essentialExpenses: 40000,
          housingPayment: 15000,
          housingIncludedInExpenses: true,
        },
      }),
      customer: makeCustomer({ housingType: 'ALQUILADA', housingPayment: 15000 }),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(housingIncludedRes.capacityResult.essentialExpenses).toBe(40000);
    expect(housingIncludedRes.indicatorDetails.find((i) => i.number === 13)?.awardedPoints).toBe(2);

    const bizGrossOnly = evaluateCreditDecisionV2({
      application: makeApplication({
        applicantType: 'BUSINESS',
        productCode: 'EMPRESARIAL_DOP',
        businessFinancialData: {
          grossSales: 800000,
          operatingCosts: null,
          netMonthlyFlow: null,
          incomeCurrency: 'DOP',
          debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(bizGrossOnly.status).toBe('DATOS_INSUFICIENTES');
  });

  it('maneja capacidad insuficiente, monedas sin tipo de cambio y datos opcionales (sin correo/redes/verificación previa)', () => {
    const lowCap = evaluateCreditDecisionV2({
      application: makeApplication({
        requestedAmount: 50000,
        requestedTermMonths: 6,
        financialData: {
          ...makeApplication().financialData,
          primaryNetIncome: 20000,
          essentialExpenses: 19900,
        },
      }),
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(lowCap.status).toBe('SIN_OFERTA_CAPACIDAD');

    const policyNoFx: CreditPolicyRecord = {
      ...BASE_POLICY,
      exchangeRateConfig: { ...BASE_POLICY.exchangeRateConfig, dopPerUsd: null },
    };
    const noFxRes = evaluateCreditDecisionV2({
      application: makeApplication({
        productCode: 'PERSONAL_USD',
        currency: 'USD',
        requestedAmount: 1000,
        requestedTermMonths: 6,
        financialData: { ...makeApplication().financialData, incomeCurrency: 'DOP' },
      }),
      customer: makeCustomer(),
      policy: policyNoFx,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(noFxRes.status).toBe('DATOS_INSUFICIENTES_CAMBIO');

    // Without email, without social media, and unverified references -> still produces PREOFERTA!
    const noEmailNoSocial = evaluateCreditDecisionV2({
      application: makeApplication(),
      customer: makeCustomer({ email: '', socialMediaDeclared: 'UNANSWERED', socialMediaHandle: '' }),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    expect(noEmailNoSocial.status).toBe('PREOFERTA');
    expect(noEmailNoSocial.indicatorDetails.find((i) => i.number === 16)?.isFairnessWatch).toBe(true);
  });

  it('recalcula ante cambios financieros preservando historial inmutable', () => {
    const app = makeApplication({ requestedAmount: 150000 });
    const exec1 = evaluateCreditDecisionV2({
      application: app,
      customer: makeCustomer(),
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'officer_1',
    });
    const appUpdated = {
      ...app,
      verifiedFinancialData: {
        ...app.financialData,
        primaryNetIncome: 50000,
        essentialExpenses: 35000,
      },
    };
    const exec2 = evaluateCreditDecisionV2({
      application: appUpdated,
      customer: makeCustomer(),
      policy: BASE_POLICY,
      useVerifiedData: true,
      executionTrigger: 'ANALYST_RECALC',
      executedBy: 'analyst_1',
    });
    expect(exec1.totalScore).toBe(100);
    expect(exec2.totalScore).toBeLessThan(exec1.totalScore);
    expect(exec1.id).not.toBe(exec2.id);
  });
});

describe('Motor de Amortización y Controles de Workflow', () => {
  it('genera tabla de amortización con precisión decimal exacta y fechas de meses distintos', () => {
    const schedule = generateAmortizationSchedule({
      financedPrincipal: 100000,
      monthlyRate: 0.04,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-01-31',
      firstPaymentDate: '2026-01-31',
    });

    expect(schedule.rows).toHaveLength(12);
    expect(schedule.isReconciled).toBe(true);
    expect(schedule.totalPrincipalScheduled).toBe(100000);
    expect(schedule.rows[11].remainingPrincipalBalance).toBe(0);
    // Feb 2026 has 28 days, Mar preserves anchor day 31!
    expect(schedule.rows[1].dueDate).toBe('2026-02-28');
    expect(schedule.rows[2].dueDate).toBe('2026-03-31');
    expect(addMonthsPreservingAnchor('2024-01-31', 1, 31)).toBe('2024-02-29'); // leap year
  });

  it('impide aprobaciones sin facultades y dobles desembolsos o desembolsos sin formalización', () => {
    const authFail = canUserApproveCommittee({
      userId: 'officer_1',
      userRole: 'BUSINESS_OFFICER',
      application: {
        createdBy: 'officer_1',
        productCode: 'PERSONAL_DOP',
        latestRiskBand: 'MUY_BAJO',
        status: 'EN_COMITE',
      },
      proposedAmount: 50000,
      policy: BASE_POLICY,
    });
    expect(authFail.allowed).toBe(false);

    const noApprovalDisb = canExecuteDisbursement({
      userRole: 'OPERATIONS',
      application: { status: 'RECIBIDA' },
      decision: null,
      formalization: null,
      existingDisbursementId: null,
    });
    expect(noApprovalDisb.allowed).toBe(false);

    const noFormalizationDisb = canExecuteDisbursement({
      userRole: 'OPERATIONS',
      application: { status: 'APROBADA' },
      decision: { decision: 'APROBADO', approvedAmount: 50000, conditionsFulfilled: true },
      formalization: null,
      existingDisbursementId: null,
    });
    expect(noFormalizationDisb.allowed).toBe(false);

    const doubleDisb = canExecuteDisbursement({
      userRole: 'OPERATIONS',
      application: { status: 'FORMALIZADA' },
      decision: { decision: 'APROBADO', approvedAmount: 50000, conditionsFulfilled: true },
      formalization: {
        status: 'LISTA_PARA_DESEMBOLSO',
        approvedCapital: 50000,
        legalReviewConfirmed: true,
        conditionsFulfilled: true,
        requiredDocsChecklist: [{ key: 'id', label: 'Cédula', completed: true }],
      },
      existingDisbursementId: 'app_test_1',
    });
    expect(doubleDisb.allowed).toBe(false);
  });
});

function makeUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: 'user_test_1',
    organizationId: 'org_axycore_main',
    email: 'user@axycore.local',
    displayName: 'Usuario Prueba',
    role: 'CREDIT_ANALYST',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('Control de Acceso Basado en Roles (RBAC) Crediticio', () => {
  it('separa responsabilidades entre Analista de Créditos, Oficial de Riesgo y Comité de Crédito', () => {
    // Analista: depuración financiera e informe técnico sí; dictamen de riesgo y decisión comité no
    expect(hasRolePermission('CREDIT_ANALYST', 'EDIT_VERIFIED_FINANCIALS')).toBe(true);
    expect(hasRolePermission('CREDIT_ANALYST', 'EDIT_EVALUATION_REPORT')).toBe(true);
    expect(hasRolePermission('CREDIT_ANALYST', 'RISK_SIGN_OFF')).toBe(false);
    expect(hasRolePermission('CREDIT_ANALYST', 'DECIDE_COMMITTEE')).toBe(false);

    // Oficial de Riesgo: dictamen de riesgo y auditoría sí; edición de cifras/informe analítico y decisión comité no
    expect(hasRolePermission('RISK_OFFICER', 'RISK_SIGN_OFF')).toBe(true);
    expect(hasRolePermission('RISK_OFFICER', 'RECALCULATE_SCORING_V2')).toBe(true);
    expect(hasRolePermission('RISK_OFFICER', 'VIEW_AUDIT_LOGS')).toBe(true);
    expect(hasRolePermission('RISK_OFFICER', 'EDIT_VERIFIED_FINANCIALS')).toBe(false);
    expect(hasRolePermission('RISK_OFFICER', 'EDIT_EVALUATION_REPORT')).toBe(false);
    expect(hasRolePermission('RISK_OFFICER', 'DECIDE_COMMITTEE')).toBe(false);

    // Comité: decisión de comité sí; depuración financiera y dictamen de riesgo no
    expect(hasRolePermission('COMMITTEE_MEMBER', 'DECIDE_COMMITTEE')).toBe(true);
    expect(hasRolePermission('COMMITTEE_MEMBER', 'EDIT_VERIFIED_FINANCIALS')).toBe(false);
    expect(hasRolePermission('COMMITTEE_MEMBER', 'RISK_SIGN_OFF')).toBe(false);
  });

  it('aplica segregación de funciones en Comité impidiendo decidir a originador, analista o sin facultades configuradas', () => {
    const appInCommittee = makeApplication({
      status: 'EN_COMITE',
      createdBy: 'originator_1',
      productCode: 'PERSONAL_DOP',
      latestRiskBand: 'MUY_BAJO',
      requestedAmount: 100000,
    });

    const committeePolicy: CreditPolicyRecord = {
      ...BASE_POLICY,
      approvalAuthorities: [
        {
          id: 'auth_cm_dop',
          role: 'COMMITTEE_MEMBER',
          productCode: 'PERSONAL_DOP',
          maxAmount: 300000,
          allowedRiskBands: ['MUY_BAJO', 'BAJO', 'MODERADO'],
          requiresCollegialApproval: false,
          minVotesRequired: 1,
          active: true,
        },
      ],
    };

    const sampleEval: CreditEvaluationRecord = {
      id: 'eval_1',
      organizationId: 'org_axycore_main',
      applicationId: appInCommittee.id,
      analystId: 'analyst_1',
      analystName: 'Analista Uno',
      declaredSnapshot: {},
      verifiedSnapshot: {},
      identityVerified: true,
      incomeVerified: true,
      obligationsVerified: true,
      referencesVerified: true,
      findings: 'Sin hallazgos negativos.',
      observations: 'Cliente estable.',
      technicalReport: 'Informe técnico completo.',
      recommendedDecision: 'APROBAR',
      status: 'COMPLETADA',
    };

    // Bloqueado si no hay facultades configuradas en la política base
    const unconfiguredBlocked = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'committee_1', role: 'COMMITTEE_MEMBER' }),
      application: appInCommittee,
      evaluation: sampleEval,
      policy: BASE_POLICY,
      proposedAmount: 100000,
    });
    expect(unconfiguredBlocked.canDecideCommittee.allowed).toBe(false);

    // Bloqueado si es el mismo originador
    const blockedOriginator = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'originator_1', role: 'COMMITTEE_MEMBER' }),
      application: appInCommittee,
      evaluation: sampleEval,
      policy: committeePolicy,
      proposedAmount: 100000,
    });
    expect(blockedOriginator.canDecideCommittee.allowed).toBe(false);

    // Bloqueado si el miembro del comité fue quien evaluó como analista
    const blockedAnalyst = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'analyst_1', role: 'COMMITTEE_MEMBER' }),
      application: appInCommittee,
      evaluation: sampleEval,
      policy: committeePolicy,
      proposedAmount: 100000,
    });
    expect(blockedAnalyst.canDecideCommittee.allowed).toBe(false);

    // Bloqueado si excede el monto máximo de su facultad
    const blockedOverLimit = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'committee_1', role: 'COMMITTEE_MEMBER' }),
      application: appInCommittee,
      evaluation: sampleEval,
      policy: committeePolicy,
      proposedAmount: 450000,
    });
    expect(blockedOverLimit.canDecideCommittee.allowed).toBe(false);

    // Permitido cuando es un tercero independiente y la política cubre monto y banda
    const allowedCommittee = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'committee_1', role: 'COMMITTEE_MEMBER' }),
      application: appInCommittee,
      evaluation: sampleEval,
      policy: committeePolicy,
      proposedAmount: 100000,
    });
    expect(allowedCommittee.canDecideCommittee.allowed).toBe(true);
  });

  it('mantiene al Auditor estrictamente en solo lectura y restringe vistas del Cliente Externo', () => {
    const appEval = makeApplication({ status: 'EN_EVALUACION', latestRiskBand: 'BAJO' });
    const auditorAccess = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'auditor_1', role: 'AUDITOR' }),
      application: appEval,
      policy: BASE_POLICY,
    });

    expect(hasRolePermission('AUDITOR', 'VIEW_AUDIT_LOGS')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'VIEW_REPORTS_AND_EXPORT')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'audit')).toBe(true);
    expect(auditorAccess.canEditVerifiedFinancials.allowed).toBe(false);
    expect(auditorAccess.canVerifyDocuments.allowed).toBe(false);
    expect(auditorAccess.canIssueRiskOpinion.allowed).toBe(false);
    expect(auditorAccess.canDecideCommittee.allowed).toBe(false);
    expect(auditorAccess.canFormalize.allowed).toBe(false);
    expect(auditorAccess.canDisburse.allowed).toBe(false);

    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'new_application')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'applications')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'loans')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'evaluation')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'committee')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'policies')).toBe(false);
  });

  it('deniega cualquier acción de flujo cuando el usuario está INACTIVO', () => {
    const inactiveAccess = getCreditWorkflowAccess({
      userProfile: makeUserProfile({ uid: 'risk_1', role: 'RISK_OFFICER', status: 'INACTIVE' }),
      application: makeApplication({ status: 'EN_EVALUACION' }),
      policy: BASE_POLICY,
    });

    expect(inactiveAccess.canVerifyDocuments.allowed).toBe(false);
    expect(inactiveAccess.canRecalculateScoring.allowed).toBe(false);
    expect(inactiveAccess.canIssueRiskOpinion.allowed).toBe(false);
    expect(inactiveAccess.canSubmitToCommittee.allowed).toBe(false);
  });
});

describe('Notificaciones Email Automáticas por Cambio de Estado', () => {
  it('genera asuntos y contenido HTML/texto para Aprobada, Rechazada, Condicionada y Pendiente de Firma', () => {
    const app = makeApplication({
      applicationNumber: 'SOL-2026-0099',
      fileNumber: 'EXP-2026-0099',
      requestedAmount: 150000,
      requestedTermMonths: 12,
    });

    const approved = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'APROBADA',
      recipientName: 'Carlos Ramírez',
      approvedAmount: 150000,
      approvedRateMonthly: 0.04,
      approvedTermMonths: 12,
    });
    expect(approved.subject).toContain('Aprobada');
    expect(approved.bodyText).toContain('150,000.00');
    expect(approved.bodyHtml).toContain('SOL-2026-0099');

    const rejected = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'RECHAZADA',
      recipientName: 'Carlos Ramírez',
      rejectionReason: 'Capacidad de pago insuficiente frente a obligaciones vigentes.',
    });
    expect(rejected.subject).toContain('SOL-2026-0099');
    expect(rejected.bodyText).toContain('Capacidad de pago insuficiente');

    const pendingSign = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'PENDIENTE_FIRMA',
      recipientName: 'Carlos Ramírez',
      approvedAmount: 150000,
      approvedRateMonthly: 0.04,
      approvedTermMonths: 12,
    });
    expect(pendingSign.subject).toContain('Pendiente de Firma');
    expect(pendingSign.bodyHtml).toContain('Pendientes de Firma');

    const conditional = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'APROBADA_CONDICIONADA',
      recipientName: 'Carlos <Test>',
      conditions: ['Presentar carta laboral actualizada'],
    });
    expect(conditional.bodyText).toContain('Presentar carta laboral actualizada');
    expect(conditional.bodyHtml).not.toContain('<Test>');
    expect(conditional.bodyHtml).toContain('&lt;Test&gt;');
  });
});

describe('Notificaciones Web Push FCM para Inbox y Cambios Críticos', () => {
  it('detecta transiciones hacia los 9 estados críticos mediante shouldTriggerApplicationCriticalPush', () => {
    // 9 estados críticos
    const allStatuses = [
      'RECIBIDA',
      'EN_EVALUACION',
      'EN_COMITE',
      'APROBADA',
      'APROBADA_CONDICIONADA',
      'DEVUELTA',
      'RECHAZADA',
      'FORMALIZADA',
      'DESEMBOLSADA',
    ] as const;

    expect(CRITICAL_APPLICATION_STATUSES.size).toBe(9);
    allStatuses.forEach((status) => {
      expect(CRITICAL_APPLICATION_STATUSES.has(status)).toBe(true);
      expect(shouldTriggerApplicationCriticalPush('BORRADOR', status)).toBe(true);
      // Estado sin cambio no dispara notificación repetida
      expect(shouldTriggerApplicationCriticalPush(status, status)).toBe(false);
    });

    // Caso nulo / vacío
    expect(shouldTriggerApplicationCriticalPush(null, null)).toBe(false);
    expect(shouldTriggerApplicationCriticalPush('RECIBIDA', null)).toBe(false);
    expect(shouldTriggerApplicationCriticalPush('RECIBIDA', 'BORRADOR')).toBe(false);

    // Compatibilidad retroactiva con shouldTriggerInboxPush
    expect(shouldTriggerInboxPush(null, 'RECIBIDA')).toBe(true);
    expect(shouldTriggerInboxPush('BORRADOR', 'RECIBIDA')).toBe(true);
    expect(shouldTriggerInboxPush('RECIBIDA', 'RECIBIDA')).toBe(false);
    expect(shouldTriggerInboxPush('EN_EVALUACION', 'DEVUELTA')).toBe(true);
    expect(shouldTriggerInboxPush('EN_EVALUACION', 'EN_COMITE')).toBe(true);
    expect(shouldTriggerInboxPush('RECIBIDA', 'EN_EVALUACION')).toBe(false);
    expect(shouldTriggerInboxPush('EN_COMITE', 'APROBADA')).toBe(false);
  });

  it('construye payloads FCM homogéneos con deep-link al expediente y ID determinístico válido', () => {
    const appExt = makeApplication({
      id: 'app_ext_42',
      applicationNumber: 'SOL-2026-0042',
      channel: 'EXTERNAL',
      applicantDisplayName: 'María Fernanda Pérez',
      requestedAmount: 250000,
      currency: 'DOP',
      status: 'RECIBIDA',
    });

    const payload = buildInboxPushPayload(appExt);
    expect(payload.eventType).toBe('NEW_INBOX_APPLICATION');
    expect(payload.priority).toBe('INMEDIATA');
    expect(payload.targetSection).toBe('applications');
    expect(payload.title).toContain('Canal Externo');
    expect(payload.body).toContain('SOL-2026-0042');
    expect(payload.body).toContain('250,000.00');
    expect(payload.data.clickAction).toBe('/?applicationId=app_ext_42&section=applications');

    const appComite = makeApplication({
      id: 'app_com_10',
      status: 'EN_COMITE',
    });
    const comitePayload = buildInboxPushPayload(appComite);
    expect(comitePayload.eventType).toBe('COMMITTEE_ESCALATION');
    expect(comitePayload.targetSection).toBe('committee');

    // Validación de transiciones críticas avanzadas
    const appAprobada = makeApplication({
      id: 'app_apr_20',
      status: 'APROBADA',
    });
    const aprPayload = buildApplicationCriticalPushPayload(appAprobada);
    expect(aprPayload.eventType).toBe('APPLICATION_APPROVED');
    expect(aprPayload.priority).toBe('INMEDIATA');
    expect(aprPayload.targetSection).toBe('formalization');
    expect(aprPayload.title).toContain('¡Crédito Aprobado');

    const appRechazada = makeApplication({
      id: 'app_rec_30',
      status: 'RECHAZADA',
    });
    const recPayload = buildApplicationCriticalPushPayload(appRechazada);
    expect(recPayload.eventType).toBe('APPLICATION_REJECTED');
    expect(recPayload.priority).toBe('ALTA');
    expect(recPayload.targetSection).toBe('applications');

    const appDesembolsada = makeApplication({
      id: 'app_des_40',
      status: 'DESEMBOLSADA',
    });
    const desPayload = buildApplicationCriticalPushPayload(appDesembolsada);
    expect(desPayload.eventType).toBe('APPLICATION_DISBURSED');
    expect(desPayload.priority).toBe('INMEDIATA');
    expect(desPayload.targetSection).toBe('loans');

    const tokenId1 = buildFcmTokenDocId('uid_analyst_1', 'fcm-token-abc:xyz1234567890abcdef');
    const tokenId2 = buildFcmTokenDocId('uid_analyst_1', 'fcm-token-abc:xyz1234567890abcdef');
    expect(tokenId1).toBe(tokenId2);
    expect(tokenId1).toMatch(/^[a-zA-Z0-9_\-]+$/);
    expect(tokenId1.length).toBeLessThanOrEqual(128);
  });

  it('verifica que el certificado VAPID key para Web Push FCM esté configurado y sea válido', () => {
    const vapidKey = getConfiguredVapidKey();
    expect(typeof vapidKey).toBe('string');
    expect(vapidKey.length).toBeGreaterThan(60);
    expect(vapidKey).toBe(DEFAULT_FCM_VAPID_KEY);
    expect(isVapidKeyConfigured()).toBe(true);
  });
});

describe('Verificador Automático de Documentos (Gemini OCR)', () => {
  it('parsea Data URLs válidas y filtra tipos MIME soportados', () => {
    const parsedImg = parseDataUrlForOcr('data:image/jpg;base64,SGVsbG8=');
    expect(parsedImg).toEqual({ mimeType: 'image/jpeg', base64Data: 'SGVsbG8=' });

    const parsedPdf = parseDataUrlForOcr('data:application/pdf;base64,JVBERi0xLjQ=');
    expect(parsedPdf).toEqual({ mimeType: 'application/pdf', base64Data: 'JVBERi0xLjQ=' });

    expect(parseDataUrlForOcr('not-a-data-url')).toBeNull();
    expect(isSupportedOcrMimeType('image/png')).toBe(true);
    expect(isSupportedOcrMimeType('application/pdf')).toBe(true);
    expect(isSupportedOcrMimeType('application/x-msdownload')).toBe(false);
  });

  it('clasifica variaciones de montos declarados vs OCR y normaliza identidades', () => {
    expect(computeNumericVariancePct(100000, 102000)).toBe(2);
    expect(classifyAmountMatch(100000, 103000).matchStatus).toBe('MATCH');
    expect(classifyAmountMatch(100000, 110000).matchStatus).toBe('MINOR_DIFF');
    expect(classifyAmountMatch(100000, 75000).matchStatus).toBe('MISMATCH');
    expect(classifyAmountMatch(100000, null).matchStatus).toBe('NOT_FOUND');

    expect(normalizeComparableText('Carlos José Ramírez')).toBe('CARLOS JOSE RAMIREZ');
    expect(normalizeComparableIdNumber('001-1234567-8')).toBe('00112345678');

    const longResult: DocumentOcrResult = {
      fileName: 'volante_nomina.pdf',
      category: 'COMPROBANTE_INGRESOS',
      modelUsed: 'gemini-4-hydrogen',
      overallVerdict: 'COINCIDE',
      confidenceScore: 96,
      detectedDocumentType: 'Volante de Nómina',
      summary: 'A'.repeat(600),
      extractedFields: {
        holderName: 'Carlos Ramírez',
        documentNumber: '00112345678',
        employerOrEntity: 'Grupo Caribe',
        currency: 'DOP',
        monthlyIncome: 180000,
        monthlyDeductionsOrExpenses: 0,
        monthlyDebtPayments: 0,
        documentDate: '2026-10-30',
        address: null,
        rawKeyLines: [],
      },
      comparisons: [],
      suggestedVerifiedFinancials: {
        primaryNetIncome: 180000,
        additionalNetIncome: null,
        essentialExpenses: null,
        currentDebtPayments: 0,
      },
      recommendedReviewStatus: 'VERIFICADO',
      analyzedAtIso: '2026-11-17T05:00:00Z',
    };
    const note = buildOcrDocumentNote(longResult);
    expect(note.length).toBeLessThanOrEqual(480);
    expect(note).toContain('Gemini OCR');
  });
});

describe('Mapa de Calor de Concentración de Riesgos (Zona × Perfil)', () => {
  it('resuelve zonas geográficas y perfiles de cliente según la dimensión seleccionada', () => {
    const cust = makeCustomer({
      province: 'Santiago',
      municipality: 'Tamboril',
      housingType: 'ALQUILADA',
    });
    const appBiz = makeApplication({
      applicantType: 'BUSINESS',
      productCode: 'EMPRESARIAL_DOP',
    });

    expect(resolveGeoZone(cust, 'PROVINCE')).toBe('Santiago');
    expect(resolveGeoZone(cust, 'MUNICIPALITY')).toBe('Tamboril');
    expect(resolveGeoZone(null, 'PROVINCE')).toBe('Sin provincia');

    expect(resolveCustomerProfile(appBiz, cust, 'INCOME_SEGMENT')).toBe('Empresarial / PyME');
    expect(resolveCustomerProfile(appBiz, cust, 'HOUSING_TENURE')).toBe('Vivienda Alquilada');
    expect(resolveCustomerProfile(appBiz, cust, 'PRODUCT')).toBe('Empresarial DOP');
  });

  it('calcula concentración de riesgo, exposición equivalente DOP y foco crítico correctamente', () => {
    const custStg = makeCustomer({
      id: 'cust_stg',
      province: 'Santiago',
      municipality: 'Santiago',
      housingType: 'PROPIA',
    });
    const custSdq = makeCustomer({
      id: 'cust_sdq',
      province: 'Santo Domingo',
      municipality: 'Distrito Nacional',
      housingType: 'ALQUILADA',
    });

    const apps: ApplicationRecord[] = [
      makeApplication({
        id: 'app_low',
        customerId: 'cust_stg',
        currency: 'DOP',
        requestedAmount: 200000,
        latestScore: 90,
        latestRiskBand: 'MUY_BAJO',
        status: 'APROBADA',
      }),
      makeApplication({
        id: 'app_high_usd',
        customerId: 'cust_sdq',
        applicantType: 'INDIVIDUAL',
        productCode: 'PERSONAL_USD',
        currency: 'USD',
        requestedAmount: 5000,
        latestScore: 30,
        latestRiskBand: 'ALTO',
        status: 'EN_EVALUACION',
        financialData: {
          ...makeApplication().financialData,
          incomeSourceType: 'IRREGULAR',
        },
      }),
    ];

    const matrix = buildRiskHeatmapMatrix({
      applications: apps,
      customers: [custStg, custSdq],
      loans: [],
      policy: BASE_POLICY,
      geoGranularity: 'PROVINCE',
      profileDimension: 'INCOME_SEGMENT',
      metricMode: 'RISK_INDEX',
    });

    expect(matrix.totalCount).toBe(2);
    expect(matrix.totalHighRiskCount).toBe(1);
    expect(matrix.overallHighRiskPct).toBe(50);
    // 200,000 DOP + (5,000 USD * 60) = 500,000 DOP
    expect(matrix.totalExposureDop).toBe(500000);

    // Santiago sorted below Santo Domingo because Santo Domingo has higher highRiskCount
    expect(matrix.zones[0]).toBe('Santo Domingo');
    expect(matrix.topConcentrationCell?.zone).toBe('Santo Domingo');
    expect(matrix.topConcentrationCell?.profile).toBe('Ingreso Irregular');
    // scoreRisk = 100 - 30 = 70; highRiskPct = 100 => 0.65*70 + 0.35*100 = 80.5 -> 81
    expect(matrix.topConcentrationCell?.riskIndex).toBe(81);
    expect(matrix.topConcentrationCell?.exposureSharePct).toBe(60);
  });
});

describe('Diseñador de Flujos de Trabajo (Workflow Builder) y Umbrales V2', () => {
  it('reordena e inserta etapas mediante drag-and-drop preservando inmutabilidad', () => {
    const baseStages = DEFAULT_WORKFLOW_CONFIG.stages;
    const initialLen = baseStages.length;

    const reordered = reorderWorkflowStages(baseStages, 3, 1);
    expect(reordered).toHaveLength(initialLen);
    expect(reordered[1].id).toBe(baseStages[3].id);
    expect(baseStages[1].id).not.toBe(baseStages[3].id); // no mutación

    const withWarrantyStage = insertWorkflowStageAt(reordered, 'INSPECCION_GARANTIAS', 2);
    expect(withWarrantyStage).toHaveLength(initialLen + 1);
    expect(withWarrantyStage[2].code).toBe('INSPECCION_GARANTIAS');
  });

  it('normaliza umbrales sin traslapes y sincroniza banda Crítico con rechazo automático', () => {
    const normalized = normalizeWorkflowThresholds({
      autoRejectMaxScore: 55,
      autoApproveMinScore: 58, // muy cercano, debe empujarse >= committeeReviewMinScore + 5
    });
    expect(normalized.autoRejectMaxScore).toBe(55);
    expect(normalized.committeeReviewMinScore).toBe(56);
    expect(normalized.autoApproveMinScore).toBeGreaterThanOrEqual(61);

    const syncedBands = syncRiskBandsWithAutoRejectThreshold(BASE_POLICY.riskBands, 54);
    expect(syncedBands.find((b) => b.code === 'CRITICO')?.maxScore).toBe(54);
    expect(syncedBands.find((b) => b.code === 'ALTO')?.minScore).toBe(55);
  });

  it('simula ruta Fast-Track, ruta Estándar condicional por monto y rechazo automático', () => {
    const wfFast = {
      ...DEFAULT_WORKFLOW_CONFIG,
      decisionThresholds: {
        ...DEFAULT_WORKFLOW_CONFIG.decisionThresholds,
        enableFastTrackAutoApproval: true,
        autoApproveMinScore: 88,
        maxAutoApproveAmountDop: 180000,
      },
    };

    const fastResult = simulateWorkflowRoute({
      workflowConfig: wfFast,
      score: 92,
      amount: 120000,
      currency: 'DOP',
      dopPerUsd: 60,
      projectedDtiPct: 24,
    });
    expect(fastResult.decisionRoute).toBe('PREOFERTA_FAST_TRACK');
    expect(fastResult.activeStages.some((s) => s.stage.code === 'COMITE_CREDITO')).toBe(false);
    expect(fastResult.skippedStages.some((s) => s.stage.code === 'COMITE_CREDITO')).toBe(true);

    const highAmountStd = simulateWorkflowRoute({
      workflowConfig: wfFast,
      score: 82,
      amount: 320000,
      currency: 'DOP',
      dopPerUsd: 60,
      projectedDtiPct: 29,
    });
    expect(highAmountStd.decisionRoute).toBe('EVALUACION_ESTANDAR');
    expect(highAmountStd.activeStages.some((s) => s.stage.code === 'PARECER_RIESGO')).toBe(true);

    const rejectRes = simulateWorkflowRoute({
      workflowConfig: wfFast,
      score: 42,
      amount: 80000,
      currency: 'DOP',
      dopPerUsd: 60,
      projectedDtiPct: 22,
    });
    expect(rejectRes.decisionRoute).toBe('RECHAZO_AUTOMATICO');
    expect(rejectRes.activeStages).toHaveLength(1);
  });

  it('aplica umbral de rechazo automático configurable en evaluateCreditDecisionV2', () => {
    const strictPolicy: CreditPolicyRecord = {
      ...BASE_POLICY,
      workflowConfig: {
        ...DEFAULT_WORKFLOW_CONFIG,
        decisionThresholds: {
          ...DEFAULT_WORKFLOW_CONFIG.decisionThresholds,
          autoRejectMaxScore: 65,
          committeeReviewMinScore: 66,
          autoApproveMinScore: 90,
        },
      },
    };

    const borderlineApp = makeApplication({
      requestedAmount: 80000,
      requestedTermMonths: 12,
      loanPurpose: 'Consumo',
      loanPurposeDescription: '',
      references: [{ name: 'Pedro', relationship: 'Amigo', phone: '8095550001' }],
      declaredDocumentsSummary: { hasIdentityDoc: false, hasIncomeEvidence: false },
      financialData: {
        employerOrBusinessName: 'Tienda Local',
        occupationOrRole: '',
        employmentMonths: 14,
        incomeSourceType: 'MIXTA_RECURRENTE',
        primaryNetIncome: 50000,
        additionalIncomeStatus: 'PARTIAL',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 50000,
        incomeCurrency: 'DOP',
        essentialExpenses: 27000,
        housingPayment: 12000,
        housingIncludedInExpenses: true,
        debtDeclarationStatus: 'HAS_DEBTS',
        debtCount: 2,
        totalDebtBalance: 160000,
        currentDebtPayments: 12000,
      },
    });

    const borderlineCustomer = makeCustomer({
      email: '',
      residenceMonths: 8,
      housingType: 'ALQUILADA',
      housingPayment: 12000,
      socialMediaDeclared: 'UNANSWERED',
      socialMediaHandle: '',
    });

    const baseRes = evaluateCreditDecisionV2({
      application: borderlineApp,
      customer: borderlineCustomer,
      policy: BASE_POLICY,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'admin_1',
    });
    expect(baseRes.totalScore).toBeGreaterThanOrEqual(50);
    expect(baseRes.totalScore).toBeLessThanOrEqual(59);

    const strictRes = evaluateCreditDecisionV2({
      application: borderlineApp,
      customer: borderlineCustomer,
      policy: strictPolicy,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'admin_1',
    });
    expect(strictRes.totalScore).toBeLessThanOrEqual(65);
    expect(strictRes.status).toBe('SIN_OFERTA');
  });
});

describe('Verificación de Identidad Biométrica (Cámara + Visión Artificial)', () => {
  it('valida tipos MIME permitidos para captura facial en vivo', () => {
    expect(isSupportedSelfieMimeType('image/jpeg')).toBe(true);
    expect(isSupportedSelfieMimeType('image/png')).toBe(true);
    expect(isSupportedSelfieMimeType('image/webp')).toBe(true);
    expect(isSupportedSelfieMimeType('application/pdf')).toBe(false);
    expect(isSupportedSelfieMimeType(null)).toBe(false);
  });

  it('calibra determinísticamente veredictos biométricos según detección facial y puntaje', () => {
    expect(
      calibrateBiometricVerdict({
        rawVerdict: 'COINCIDE',
        similarityScore: 95,
        idPhotoDetected: false,
        selfieFaceDetected: true,
      })
    ).toBe('NO_CONCLUYENTE');

    expect(
      calibrateBiometricVerdict({
        rawVerdict: 'COINCIDE',
        similarityScore: 86,
        idPhotoDetected: true,
        selfieFaceDetected: true,
      })
    ).toBe('COINCIDE');

    expect(
      calibrateBiometricVerdict({
        rawVerdict: 'COINCIDE',
        similarityScore: 65,
        idPhotoDetected: true,
        selfieFaceDetected: true,
      })
    ).toBe('REVISION_MANUAL');

    expect(
      calibrateBiometricVerdict({
        rawVerdict: 'NO_COINCIDE',
        similarityScore: 31,
        idPhotoDetected: true,
        selfieFaceDetected: true,
      })
    ).toBe('NO_COINCIDE');
  });

  it('construye nota de auditoría biométrica <= 480 caracteres compatible con firestore.rules', () => {
    const mockRes: BiometricVerificationResult = {
      verdict: 'COINCIDE',
      similarityScore: 91,
      livenessAssessment: 'APROBADA',
      idPhotoDetected: true,
      selfieFaceDetected: true,
      extractedDocName: 'CARLOS RAMIREZ',
      extractedDocNumber: '001-1234567-8',
      documentIntegrityNotes: 'Cédula nítida sin alteraciones.',
      comparisonRationale: 'Coincidencia facial robusta en geometría ocular y nasal. '.repeat(12),
      observations: ['Iluminación adecuada'],
      modelUsed: 'gemini-4-hydrogen',
      verifiedAtIso: '2026-11-17T05:25:00Z',
    };
    const note = buildBiometricAuditNote(mockRes);
    expect(note.length).toBeLessThanOrEqual(480);
    expect(note).toContain('Similitud 91%');
    expect(note).toContain('Doc OCR: 001-1234567-8');
  });
});

describe('Bitácora de Eventos Críticos y Cumplimiento Normativo', () => {
  it('detecta categorías documentales confidenciales (identidad, ingresos, biometría, contratos)', () => {
    expect(isConfidentialDocumentCategory('CEDULA_IDENTIDAD')).toBe(true);
    expect(isConfidentialDocumentCategory('Verificacion_Biometrica')).toBe(true);
    expect(isConfidentialDocumentCategory('COMPROBANTE_INGRESOS')).toBe(true);
    expect(isConfidentialDocumentCategory('CONTRATO_FIRMADO')).toBe(true);
    expect(isConfidentialDocumentCategory('PAGARE_FIRMADO')).toBe(true);
    expect(isConfidentialDocumentCategory('PUBLICO')).toBe(false);
  });

  it('clasifica automáticamente cambios de estado, decisiones de comité y accesos a documentos confidenciales', () => {
    const committeeRes = classifyCriticalAuditEvent({
      eventType: 'COMMITTEE_DECISION_IMMUTABLE',
      entityType: 'committee_decisions',
      action: 'Comité emitió APROBADO para SOL-2026-001',
      previousState: 'EN_COMITE',
      newState: 'APROBADA',
    });
    expect(committeeRes.isCritical).toBe(true);
    expect(committeeRes.category).toBe('COMMITTEE_APPROVAL');
    expect(committeeRes.severity).toBe('CRITICO');

    const docAccessRes = classifyCriticalAuditEvent({
      eventType: 'CONFIDENTIAL_DOCUMENT_DOWNLOADED',
      entityType: 'application_documents',
      action: 'Descarga de documento confidencial: [CEDULA_IDENTIDAD] cedula.jpg',
      previousState: 'VERIFICADO',
      newState: 'DOWNLOAD_AUDITADO',
    });
    expect(docAccessRes.isCritical).toBe(true);
    expect(docAccessRes.category).toBe('CONFIDENTIAL_DOC_ACCESS');
    expect(docAccessRes.severity).toBe('CRITICO');

    const docPreviewRes = classifyCriticalAuditEvent({
      eventType: 'CONFIDENTIAL_DOCUMENT_PREVIEWED',
      entityType: 'application_documents',
      action: 'Visualización de documento confidencial: [COMPROBANTE_INGRESOS] nomina.pdf',
      previousState: 'RECIBIDO',
      newState: 'PREVIEW_AUDITADO',
    });
    expect(docPreviewRes.isCritical).toBe(true);
    expect(docPreviewRes.category).toBe('CONFIDENTIAL_DOC_ACCESS');
    expect(docPreviewRes.severity).toBe('ALTO');

    const statusChangeRes = classifyCriticalAuditEvent({
      eventType: 'CREDIT_EVALUATION_RECALC',
      entityType: 'applications',
      action: 'Evaluación analítica -> EN_COMITE (Score 82/100)',
      previousState: 'RECIBIDA',
      newState: 'EN_COMITE',
    });
    expect(statusChangeRes.isCritical).toBe(true);
    expect(statusChangeRes.category).toBe('STATUS_CHANGE');
    expect(statusChangeRes.severity).toBe('ALTO');

    const standardRes = classifyCriticalAuditEvent({
      eventType: 'CUSTOMER_CREATED',
      entityType: 'customers',
      action: 'Registro de cliente Ana Pérez',
      newState: 'CEDULA: 001-0000000-1',
    });
    expect(standardRes.isCritical).toBe(false);
    expect(standardRes.category).toBeNull();
  });

  it('resume KPIs de bitácora crítica y acota payloads a los límites de firestore.rules', () => {
    const sampleLogs: AuditLogRecord[] = [
      {
        id: 'a1',
        organizationId: 'org_axycore_main',
        eventType: 'CREDIT_EVALUATION_RECALC',
        entityType: 'applications',
        entityId: 'app_1',
        action: 'Evaluación -> EN_COMITE',
        previousState: 'RECIBIDA',
        newState: 'EN_COMITE',
        transactionId: 'tx_1',
        userId: 'u_analyst',
        userEmail: 'analyst@axycore.local',
      },
      {
        id: 'a2',
        organizationId: 'org_axycore_main',
        eventType: 'COMMITTEE_DECISION_IMMUTABLE',
        entityType: 'committee_decisions',
        entityId: 'dec_1',
        action: 'Comité emitió APROBADO',
        previousState: 'EN_COMITE',
        newState: 'APROBADA',
        transactionId: 'tx_2',
        userId: 'u_committee',
        userEmail: 'committee@axycore.local',
      },
      {
        id: 'a3',
        organizationId: 'org_axycore_main',
        eventType: 'CONFIDENTIAL_DOCUMENT_PREVIEWED',
        entityType: 'application_documents',
        entityId: 'doc_1',
        action: 'Vista previa [CEDULA_IDENTIDAD]',
        transactionId: 'tx_3',
        userId: 'u_auditor',
        userEmail: 'auditor@axycore.local',
      },
      {
        id: 'a4',
        organizationId: 'org_axycore_main',
        eventType: 'CUSTOMER_CREATED',
        entityType: 'customers',
        entityId: 'cust_1',
        action: 'Registro cliente',
        transactionId: 'tx_4',
        userId: 'u_officer',
        userEmail: 'officer@axycore.local',
      },
    ];

    const summary = summarizeCriticalAuditLogs(sampleLogs);
    expect(summary.totalLogs).toBe(4);
    expect(summary.totalCritical).toBe(3);
    expect(summary.statusChangesCount).toBe(1);
    expect(summary.committeeApprovalsCount).toBe(1);
    expect(summary.confidentialDocAccessCount).toBe(1);
    expect(summary.uniqueActorsCount).toBe(3);

    const clamped = buildCriticalAuditEntryPayload({
      id: 'audit_clamp_1',
      organizationId: 'org_axycore_main',
      eventType: 'CONFIDENTIAL_DOCUMENT_DOWNLOADED',
      entityType: 'application_documents',
      entityId: 'doc_99',
      action: 'Descarga auditada '.repeat(30),
      justification: 'Cumplimiento Ley 172-13 '.repeat(80),
      transactionId: 'tx_clamp_1',
      userId: 'u_auditor',
      userEmail: 'auditor@axycore.local',
      userRole: 'AUDITOR',
    });
    expect(clamped.action.length).toBeLessThanOrEqual(200);
    expect((clamped.justification ?? '').length).toBeLessThanOrEqual(1000);
  });
});

describe('Dashboard Ejecutivo, Analítica Real multi-moneda (DOP/USD) y Contexto IA (Director & Bela)', () => {
  it('calcula saludo dinámico y límites de períodos con comparación simétrica', () => {
    const morningDate = new Date('2026-11-17T13:30:00Z'); // 09:30 AST (UTC-4)
    const clockMorning = getSantoDomingoClockInfo(morningDate);
    expect(clockMorning.greeting).toBe('Buenos días');
    expect(clockMorning.todayIso).toBe('2026-11-17');

    const eveningDate = new Date('2026-11-17T23:30:00Z'); // 19:30 AST
    const clockEvening = getSantoDomingoClockInfo(eveningDate);
    expect(clockEvening.greeting).toBe('Buenas noches');

    const bounds7d = resolvePeriodBounds('LAST_7D', undefined, undefined, '2026-11-17');
    expect(bounds7d.startIso).toBe('2026-11-11');
    expect(bounds7d.endIso).toBe('2026-11-17');
    expect(bounds7d.prevStartIso).toBe('2026-11-04');
    expect(bounds7d.prevEndIso).toBe('2026-11-10');
  });

  it('separa estrictamente DOP y USD en los 10 KPIs ejecutivos y 5 gráficos sin mezclar monedas', () => {
    const bounds = resolvePeriodBounds('CURRENT_MONTH', undefined, undefined, '2026-11-17');

    const loans: LoanRecord[] = [
      {
        id: 'loan_dop_1',
        organizationId: 'org_axycore_main',
        loanNumber: 'PRE-2026-0001',
        applicationId: 'app_1',
        disbursementId: 'disb_dop_1',
        customerId: 'cust_1',
        applicantDisplayName: 'Carlos Ramírez',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        approvedPrincipal: 200000,
        financedExpenses: 0,
        totalFinancedPrincipal: 200000,
        currentPrincipalBalance: 160000,
        contractualRateMonthly: 0.04,
        termMonths: 12,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-11-05',
        firstPaymentDate: '2026-11-17',
        maturityDate: '2027-10-17',
        totalContractualInterest: 55725.16,
        totalContractualPayable: 255725.16,
        status: 'ACTIVO',
        createdBy: 'ops_1',
      },
      {
        id: 'loan_usd_1',
        organizationId: 'org_axycore_main',
        loanNumber: 'PRE-2026-0002',
        applicationId: 'app_2',
        disbursementId: 'disb_usd_1',
        customerId: 'cust_2',
        applicantDisplayName: 'Inversiones Caribe SRL',
        productCode: 'EMPRESARIAL_USD',
        currency: 'USD',
        approvedPrincipal: 4000,
        financedExpenses: 0,
        totalFinancedPrincipal: 4000,
        currentPrincipalBalance: 3500,
        contractualRateMonthly: 0.035,
        termMonths: 12,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-11-10',
        firstPaymentDate: '2026-12-10',
        maturityDate: '2027-11-10',
        totalContractualInterest: 967.28,
        totalContractualPayable: 4967.28,
        status: 'ACTIVO',
        createdBy: 'ops_1',
      },
    ];

    const payments: PaymentRecord[] = [
      {
        id: 'pay_dop_applied',
        organizationId: 'org_axycore_main',
        loanId: 'loan_dop_1',
        loanNumber: 'PRE-2026-0001',
        customerId: 'cust_1',
        customerName: 'Carlos Ramírez',
        currency: 'DOP',
        amount: 21310.43,
        paymentDate: '2026-11-17',
        appliedDate: '2026-11-17',
        method: 'TRANSFERENCIA',
        referenceNumber: 'BHD-9988',
        idempotencyKey: 'idem_1',
        status: 'APLICADO',
        appliedBreakdown: {
          principal: 13310.43,
          interest: 8000,
          lateFee: 0,
          otherCharges: 0,
        },
        reportedByUserId: 'agent_1',
        reportedByName: 'Gestor Uno',
      },
      {
        id: 'pay_dop_pending',
        organizationId: 'org_axycore_main',
        loanId: 'loan_dop_1',
        loanNumber: 'PRE-2026-0001',
        customerId: 'cust_1',
        customerName: 'Carlos Ramírez',
        currency: 'DOP',
        amount: 99999,
        paymentDate: '2026-11-17',
        method: 'DEPOSITO',
        referenceNumber: 'PEND-1',
        idempotencyKey: 'idem_2',
        status: 'RECIBIDO_PENDIENTE_VERIFICACION',
        reportedByUserId: 'agent_1',
        reportedByName: 'Gestor Uno',
      },
    ];

    const collectionAccounts: CollectionAccountRecord[] = [
      {
        id: 'loan_dop_1',
        organizationId: 'org_axycore_main',
        loanId: 'loan_dop_1',
        loanNumber: 'PRE-2026-0001',
        applicationId: 'app_1',
        customerId: 'cust_1',
        applicantDisplayName: 'Carlos Ramírez',
        customerPhone: '8095551234',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        dpd: 35,
        maxHistoricalDpd: 35,
        bucket: '31_60',
        stage: 'TEMPRANA',
        priority: 'ALTA',
        priorityScore: 80,
        priorityReasons: ['DPD 35'],
        overdueInstallmentsCount: 1,
        totalInstallmentsCount: 12,
        paidInstallmentsCount: 1,
        overduePrincipal: 12000,
        overdueInterest: 4000,
        overdueLateFee: 500,
        overdueCharges: 0,
        overdueTotalAmount: 16500,
        totalOutstandingPrincipal: 160000,
        pendingVerificationAmount: 99999,
        assignedCollectorId: 'agent_1',
        assignedCollectorName: 'Gestor Uno',
        brokenPromisesCount: 1,
        behaviorScore: 68,
        behaviorBand: 'ATENCION',
        consentWhatsAppOptIn: true,
      },
    ];

    const loanInstallments: LoanInstallmentRecord[] = [
      {
        id: 'inst_dop_today',
        organizationId: 'org_axycore_main',
        loanId: 'loan_dop_1',
        installmentNumber: 1,
        dueDate: '2026-11-17',
        principalAmount: 13310.43,
        interestAmount: 8000,
        otherCharges: 0,
        totalAmount: 21310.43,
        remainingPrincipalBalance: 186689.57,
        status: 'PENDIENTE',
      },
    ];

    const paymentPromises: PaymentPromiseRecord[] = [
      {
        id: 'prom_broken_1',
        organizationId: 'org_axycore_main',
        loanId: 'loan_dop_1',
        loanNumber: 'PRE-2026-0001',
        customerId: 'cust_1',
        customerName: 'Carlos Ramírez',
        currency: 'DOP',
        promisedAmount: 15000,
        fulfilledAmount: 0,
        fulfilledPaymentIds: [],
        promisedDate: '2026-11-12',
        channel: 'LLAMADA',
        status: 'INCUMPLIDA',
        createdByUserId: 'agent_1',
        createdByUserName: 'Gestor Uno',
      },
    ];

    const dopMetrics = computeExecutiveCurrencyMetrics({
      currency: 'DOP',
      bounds,
      todayIso: '2026-11-17',
      applications: [
        makeApplication({ id: 'app_1', currency: 'DOP', status: 'APROBADA', createdAt: '2026-11-02T10:00:00Z' }),
        makeApplication({ id: 'app_3', currency: 'DOP', status: 'EN_COMITE', createdAt: '2026-11-15T10:00:00Z' }),
      ],
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList: [],
    });

    const usdMetrics = computeExecutiveCurrencyMetrics({
      currency: 'USD',
      bounds,
      todayIso: '2026-11-17',
      applications: [],
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList: [],
    });

    // DOP metrics never include the USD 3,500 loan
    expect(dopMetrics.activePortfolioCapital).toBe(160000);
    expect(dopMetrics.activeLoansCount).toBe(1);
    expect(dopMetrics.disbursedPeriodTotal).toBe(200000);
    expect(dopMetrics.disbursedDeltaPct).toBeNull(); // no previous period base -> null, never fabricated
    // Only APLICADO payment counts in recovery (not RECIBIDO_PENDIENTE_VERIFICACION)
    expect(dopMetrics.recoveryPeriodTotal).toBe(21310.43);
    expect(dopMetrics.recoveryPrincipal).toBe(13310.43);
    expect(dopMetrics.recoveryInterest).toBe(8000);
    expect(dopMetrics.par30Pct).toBe(100);
    expect(dopMetrics.pendingApplicationsCount).toBe(2);
    expect(dopMetrics.pendingCommitteeCount).toBe(1);
    expect(dopMetrics.dailyDueAmount).toBe(21310.43);
    expect(dopMetrics.dailyConfirmedReceivedAmount).toBe(21310.43);
    expect(dopMetrics.brokenPromisesCount).toBe(1);
    expect(dopMetrics.brokenPromisesAmount).toBe(15000);
    expect(dopMetrics.approvalsCount).toBe(1);
    expect(dopMetrics.approvalsRatePct).toBe(100);
    expect(dopMetrics.portfolioAtRiskBalance).toBe(160000);

    // USD metrics strictly isolated
    expect(usdMetrics.activePortfolioCapital).toBe(3500);
    expect(usdMetrics.activeLoansCount).toBe(1);
    expect(usdMetrics.disbursedPeriodTotal).toBe(4000);
    expect(usdMetrics.recoveryPeriodTotal).toBe(0);

    // Scoped AI Context & Operational Day Summary
    const adminProfile = makeUserProfile({ role: 'ADMIN', displayName: 'Directora General' });
    const daySummary = buildOperationalDaySummary({
      todayIso: '2026-11-17',
      applications: [makeApplication({ status: 'EN_COMITE' })],
      loanInstallments,
      paymentPromises,
      payments,
      reconciliationExceptions: [{ status: 'ABIERTA' }],
      collectionTasks: [{ status: 'PENDIENTE' }],
      riskAlerts: [],
      canAccessSection: (sec) => canRoleAccessSection('ADMIN', sec),
      hasPermission: (perm) => hasRolePermission('ADMIN', perm),
    });
    expect(daySummary.length).toBeGreaterThanOrEqual(7);
    expect(daySummary.find((i) => i.id === 'committee_pending')?.count).toBe(1);
    expect(daySummary.find((i) => i.id === 'payments_to_reconcile')?.count).toBe(2);

    const aiCtx = buildScopedAiContext({
      userProfile: adminProfile,
      roleLabel: 'Administrador',
      organizationName: 'AxyCore Financiera',
      periodLabel: bounds.label,
      currencyFilter: 'SEPARATED',
      dopMetrics,
      usdMetrics,
      operationalItems: daySummary,
      recentActivity: [],
      applications: [],
      loans,
      collectionActions: [],
      riskAlerts: [],
      hasPermission: (perm) => hasRolePermission('ADMIN', perm),
    });
    const indicadores = aiCtx.indicadoresPorMoneda as Record<string, { carteraActiva: string }>;
    expect(indicadores.DOP.carteraActiva).toContain('160,000.00');
    expect(indicadores.USD.carteraActiva).toContain('3,500.00');
    expect(canRoleAccessSection('ADMIN', 'director')).toBe(true);
    expect(canRoleAccessSection('ADMIN', 'bela')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'director')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'bela')).toBe(false);
  });

  it('conecta el Centro de Notificaciones (Comité pendiente, Promesa incumplida, etc.) con el historial real de eventos', () => {
    const committeeApp = makeApplication({
      id: 'app_com_99',
      applicationNumber: 'SOL-2026-0099',
      applicantDisplayName: 'Inversiones del Caribe SRL',
      status: 'EN_COMITE',
      currency: 'DOP',
      requestedAmount: 750000,
      movementHistory: [
        {
          timestamp: '2026-11-17T07:30:00.000Z',
          action: 'Remitido a Comité de Crédito tras dictamen de Riesgo',
          fromStatus: 'EN_EVALUACION',
          toStatus: 'EN_COMITE',
          userId: 'risk_1',
          userName: 'Oficial de Riesgo',
          note: 'Requiere aprobación colegiada por monto',
        },
      ],
    });

    const brokenPromise: PaymentPromiseRecord = {
      id: 'prom_broken_1',
      organizationId: 'org_default',
      loanId: 'loan_dop_1',
      loanNumber: 'PRE-2026-0001',
      customerId: 'cust_1',
      customerName: 'María Rodríguez',
      currency: 'DOP',
      promisedAmount: 25000,
      fulfilledAmount: 5000,
      fulfilledPaymentIds: [],
      promisedDate: '2026-11-14',
      channel: 'WHATSAPP',
      createdByUserId: 'col_1',
      createdByUserName: 'Gestor Cobranza',
      status: 'INCUMPLIDA',
    };

    const auditLogs: AuditLogRecord[] = [
      {
        id: 'log_com_1',
        organizationId: 'org_default',
        eventType: 'APPLICATION_STATUS_CHANGED',
        entityType: 'applications',
        entityId: 'app_com_99',
        action: 'Expediente SOL-2026-0099 escalado a Comité',
        previousState: 'EN_EVALUACION',
        newState: 'EN_COMITE',
        justification: 'Nivel de exposición requiere Comité',
        transactionId: 'tx_com_1',
        userId: 'risk_1',
        userEmail: 'riesgo@axycore.do',
        userRole: 'RISK_OFFICER',
        timestamp: '2026-11-17T07:31:00.000Z',
      },
      {
        id: 'log_prom_1',
        organizationId: 'org_default',
        eventType: 'PROMISE_MARKED_BROKEN',
        entityType: 'payment_promises',
        entityId: 'prom_broken_1',
        action: 'Promesa incumplida en préstamo PRE-2026-0001',
        previousState: 'VIGENTE',
        newState: 'INCUMPLIDA',
        transactionId: 'tx_prom_1',
        userId: 'system_cutoff',
        userEmail: 'motor@axycore.do',
        timestamp: '2026-11-17T06:00:00.000Z',
      },
    ];

    const notifications = buildUnifiedNotificationCenterItems({
      todayIso: '2026-11-17',
      applications: [committeeApp],
      loans: [],
      loanInstallments: [],
      paymentPromises: [brokenPromise],
      payments: [],
      reconciliationExceptions: [],
      riskAlerts: [],
      collectionActions: [
        {
          id: 'act_col_1',
          organizationId: 'org_default',
          loanId: 'loan_dop_1',
          loanNumber: 'PRE-2026-0001',
          customerId: 'cust_1',
          customerName: 'María Rodríguez',
          collectorId: 'col_1',
          collectorName: 'Gestor Cobranza',
          channel: 'WHATSAPP',
          contactResult: 'CONTACTO_EFECTIVO_PROMESA',
          notes: 'Cliente prometió abonar RD$25,000 el 14/11',
          dpdAtAction: 18,
          promiseCreatedId: 'prom_broken_1',
          isClosed: true,
          actionTimeIso: '2026-11-12T14:00:00.000Z',
        },
      ],
      committeeDecisions: [],
      auditLogs,
      acknowledgedKeys: new Set<string>(),
      canAccessSection: (sec) => canRoleAccessSection('ADMIN', sec),
      hasPermission: (perm) => hasRolePermission('ADMIN', perm),
    });

    const comiteAlert = notifications.find((n) => n.alertType === 'COMITE_PENDIENTE');
    const promesaAlert = notifications.find((n) => n.alertType === 'PROMESA_INCUMPLIDA');

    expect(comiteAlert).toBeDefined();
    expect(comiteAlert?.alertTypeLabel).toBe('Comité pendiente');
    expect(comiteAlert?.eventHistory.length).toBeGreaterThanOrEqual(2);
    expect(comiteAlert?.eventHistory.some((e) => e.source === 'MOVEMENT_HISTORY')).toBe(true);
    expect(comiteAlert?.eventHistory.some((e) => e.source === 'AUDIT_LOG')).toBe(true);

    expect(promesaAlert).toBeDefined();
    expect(promesaAlert?.alertTypeLabel).toBe('Promesa incumplida');
    expect(promesaAlert?.amountLabel).toContain('20,000.00');
    expect(promesaAlert?.eventHistory.some((e) => e.source === 'COLLECTION_ACTION')).toBe(true);
    expect(promesaAlert?.eventHistory.some((e) => e.source === 'AUDIT_LOG')).toBe(true);

    const summaries = summarizeNotificationsByAlertType(notifications);
    expect(summaries.some((s) => s.alertType === 'COMITE_PENDIENTE' && s.totalCount === 1)).toBe(true);
    expect(summaries.some((s) => s.alertType === 'PROMESA_INCUMPLIDA' && s.totalCount === 1)).toBe(true);

    // Prueba de sincronización, filtrado por currentUserId, contador de pendientes y marcado como leída en Firestore ('notifications')
    const currentUserId = 'uid_exec_director_01';
    const otherUserId = 'uid_other_analyst_99';

    const comitePayloadForCurrent = buildUserNotificationPayload({
      organizationId: 'org_default',
      userId: currentUserId,
      createdBy: currentUserId,
      item: comiteAlert!,
      read: false,
    });
    const promesaPayloadForCurrent = buildUserNotificationPayload({
      organizationId: 'org_default',
      userId: currentUserId,
      createdBy: currentUserId,
      item: promesaAlert!,
      read: false,
    });
    const otherUserDoc = buildUserNotificationPayload({
      organizationId: 'org_default',
      userId: otherUserId,
      createdBy: otherUserId,
      item: comiteAlert!,
      read: true,
      readAt: '2026-11-17T08:00:00.000Z',
    });

    expect(comitePayloadForCurrent.id).toBe(
      buildUserNotificationDocId(currentUserId, comiteAlert!.ackKey)
    );
    expect(comitePayloadForCurrent.id).not.toBe(otherUserDoc.id);

    // 1. Antes de hacer clic: 3 pendientes para currentUserId (el doc leído de otherUserId se ignora por filtro userId)
    const beforeClickMerged = mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications: [comitePayloadForCurrent, promesaPayloadForCurrent, otherUserDoc],
      derivedItems: notifications,
    });
    const pendingBeforeClick = beforeClickMerged.filter((n) => n.isUnread).length;
    expect(pendingBeforeClick).toBe(3);

    // 2. Después de hacer clic en una notificación: se marca read: true en Firestore y el contador de pendientes baja a 2
    const afterClickMerged = mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications: [
        {
          ...comitePayloadForCurrent,
          read: true,
          readAt: '2026-11-17T08:45:00.000Z',
        },
        promesaPayloadForCurrent,
        otherUserDoc,
      ],
      derivedItems: notifications,
    });
    const pendingAfterClick = afterClickMerged.filter((n) => n.isUnread).length;
    expect(pendingAfterClick).toBe(2);
    expect(afterClickMerged.find((n) => n.alertType === 'COMITE_PENDIENTE')?.isUnread).toBe(false);
    expect(afterClickMerged.find((n) => n.alertType === 'PROMESA_INCUMPLIDA')?.isUnread).toBe(true);

    // 3. Verifica íconos diferenciados por tipo de alerta (Comité, Promesa incumplida, etc.) y paleta Azul Noche (#0B1220) + Acentos Eléctricos
    const comiteVisual = getNotificationAlertVisualMeta('COMITE_PENDIENTE');
    const promesaVisual = getNotificationAlertVisualMeta('PROMESA_INCUMPLIDA');
    const centinelaVisual = getNotificationAlertVisualMeta('ALERTA_CENTINELA');
    const pagoVisual = getNotificationAlertVisualMeta('PAGO_POR_VERIFICAR');

    expect(comiteVisual.iconKey).toBe('gavel');
    expect(promesaVisual.iconKey).toBe('handshake');
    expect(centinelaVisual.iconKey).toBe('radar');
    expect(pagoVisual.iconKey).toBe('credit-card');
    expect(comiteVisual.iconKey).not.toBe(promesaVisual.iconKey);
    expect(comiteVisual.surfaceHex).toBe('#0B1220');
    expect(promesaVisual.surfaceHex).toBe('#0B1220');

    const allIconKeys = Object.values(NOTIFICATION_ALERT_VISUAL_META).map((m) => m.iconKey);
    expect(new Set(allIconKeys).size).toBe(Object.keys(NOTIFICATION_ALERT_VISUAL_META).length);

    // 4. Verifica que markAsRead (applyMarkAsReadTransition) actualice read: true en Firestore y reste del contador de pendientes
    const initialDocs = [comitePayloadForCurrent, promesaPayloadForCurrent, otherUserDoc];
    const initialMerged = mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications: initialDocs,
      derivedItems: notifications,
    });
    expect(computePendingNotificationsCount(initialMerged)).toBe(3);

    const markComiteResult = applyMarkAsReadTransition({
      firestoreNotifications: initialDocs,
      currentUserId,
      organizationId: 'org_default',
      targetItem: comiteAlert!,
      readAtIso: '2026-11-17T09:05:00.000Z',
    });
    expect(markComiteResult.existedInFirestore).toBe(true);
    expect(markComiteResult.updatedDoc.read).toBe(true);
    expect(markComiteResult.updatedDoc.readAt).toBe('2026-11-17T09:05:00.000Z');

    const mergedAfterFirstMark = mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications: markComiteResult.updatedFirestoreNotifications,
      derivedItems: notifications,
    });
    expect(computePendingNotificationsCount(mergedAfterFirstMark)).toBe(2);

    const markPromesaResult = applyMarkAsReadTransition({
      firestoreNotifications: markComiteResult.updatedFirestoreNotifications,
      currentUserId,
      organizationId: 'org_default',
      targetItem: promesaAlert!,
      readAtIso: '2026-11-17T09:06:00.000Z',
    });
    expect(markPromesaResult.updatedDoc.read).toBe(true);

    const mergedAfterSecondMark = mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications: markPromesaResult.updatedFirestoreNotifications,
      derivedItems: notifications,
    });
    expect(computePendingNotificationsCount(mergedAfterSecondMark)).toBe(1);
  });
});

describe('Arquitectura SaaS Multiempresa, Platform Control y Aislamiento (20 Pruebas Obligatorias)', () => {
  const superAdminProfile: UserProfile = {
    uid: 'superadmin_1',
    email: 'andrygallardo7@gmail.com',
    displayName: 'Andry Gallardo',
    role: 'ADMIN',
    organizationId: SU_GLORIA_ORG_ID,
    isSuperAdmin: true,
    status: 'ACTIVE',
  };

  it('Pruebas 1, 2, 3 y 4: Crear empresa nueva, crear su administrador, asignar módulos específicos y verificar que solo esos módulos aparezcan en el menú', () => {
    const selectedModules: AxyCoreModuleCode[] = [
      'clientes',
      'prestamos',
      'cobranza',
    ];

    const bundle = buildNewCompanyRegistrationBundle({
      companyName: 'Financiera Horizonte',
      tradeName: 'Financiera Horizonte',
      legalName: 'Financiera Horizonte, S.R.L.',
      rnc: '1-31-99887-2',
      country: 'República Dominicana',
      province: 'Santo Domingo',
      city: 'Distrito Nacional',
      address: 'Av. Abraham Lincoln #405',
      phone: '809-555-8899',
      corporateEmail: 'info@horizonte.com.do',
      currency: 'DOP',
      timezone: 'America/Santo_Domingo',
      planCode: 'PERSONALIZADO',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      maxUsers: 35,
      requestedModules: selectedModules,
      adminName: 'Roberto Méndez',
      adminEmail: 'rmendez@horizonte.com.do',
      adminPhone: '809-555-8800',
      status: 'ACTIVA',
      createdByUid: superAdminProfile.uid,
    });

    // 1. Empresa nueva creada con tenantId único y licencia activa
    expect(bundle.organization.tradeName).toBe('Financiera Horizonte');
    expect(bundle.organization.tenantId).toContain('financiera-horizonte-');
    expect(bundle.organization.status).toBe('ACTIVA');
    expect(bundle.license.status).toBe('ACTIVA');

    // 2. Administrador de la empresa creado mediante invitación segura sin contraseña genérica
    expect(bundle.adminMembership.role).toBe('ADMIN');
    expect(bundle.adminMembership.userEmail).toBe('rmendez@horizonte.com.do');
    expect(bundle.invitationLink).toContain('tenantInvite=');
    expect(bundle.invitationLink).not.toContain('password=');

    // 3. Módulos específicos asignados
    expect(bundle.organization.enabledModules).toEqual(selectedModules);

    // 4. Solo los módulos contratados aparecen/permiten acceso en el menú; los no contratados (ej. Comité, Conciliación, Director) se ocultan
    expect(
      checkTenantSectionAccess({
        section: 'customers',
        organization: bundle.organization,
        isSuperAdmin: false,
      }).allowed
    ).toBe(true);
    expect(
      checkTenantSectionAccess({
        section: 'loans',
        organization: bundle.organization,
        isSuperAdmin: false,
      }).allowed
    ).toBe(true);
    expect(
      checkTenantSectionAccess({
        section: 'committee',
        organization: bundle.organization,
        isSuperAdmin: false,
      }).allowed
    ).toBe(false);
    expect(
      checkTenantSectionAccess({
        section: 'cobranza_reconciliation',
        organization: bundle.organization,
        isSuperAdmin: false,
      }).allowed
    ).toBe(false);
    expect(
      checkTenantSectionAccess({
        section: 'director',
        organization: bundle.organization,
        isSuperAdmin: false,
      }).allowed
    ).toBe(false);
  });

  it('Pruebas 5, 6, 7 y 8: Desactivar un módulo, verificar bloqueo en menú/ruta/API, reactivar el módulo y verificar que reaparezca sin pérdida de datos', () => {
    const initialModules: AxyCoreModuleCode[] = [
      'clientes',
      'prestamos',
      'motor_decisiones',
    ];
    let org: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      id: 'org_test_feature_flags',
      name: 'CrediAvance',
      enabledModules: initialModules,
    };

    const historicalScoringRecords = [
      { id: 'score_1', organizationId: org.id, totalScore: 84 },
      { id: 'score_2', organizationId: org.id, totalScore: 76 },
    ];

    // 5. Desactivar módulo motor_decisiones
    const disableResult = validateModuleToggle({
      currentModules: org.enabledModules as AxyCoreModuleCode[],
      targetModule: 'motor_decisiones',
      enable: false,
    });
    expect(disableResult.allowed).toBe(true);
    org = { ...org, enabledModules: disableResult.updatedModules };

    // 6. Verificar que desaparezca del menú, se bloquee por ruta y se bloquee por API
    const routeCheckDisabled = checkTenantSectionAccess({
      section: 'decision_engine',
      organization: org,
      isSuperAdmin: false,
    });
    expect(routeCheckDisabled.allowed).toBe(false);
    expect(routeCheckDisabled.requiredModule).toBe('motor_decisiones');

    const apiCheckDisabled = checkTenantApiAccess({
      apiPath: '/api/engine/score',
      organization: org,
    });
    expect(apiCheckDisabled.allowed).toBe(false);
    expect(apiCheckDisabled.status).toBe(403);

    // 7. Reactivar el módulo motor_decisiones
    const reEnableResult = validateModuleToggle({
      currentModules: org.enabledModules as AxyCoreModuleCode[],
      targetModule: 'motor_decisiones',
      enable: true,
    });
    expect(reEnableResult.allowed).toBe(true);
    org = { ...org, enabledModules: reEnableResult.updatedModules };

    // 8. Verificar que reaparezca en el menú/API y que los datos históricos permanezcan intactos
    expect(
      checkTenantSectionAccess({
        section: 'decision_engine',
        organization: org,
        isSuperAdmin: false,
      }).allowed
    ).toBe(true);
    expect(
      checkTenantApiAccess({
        apiPath: '/api/engine/score',
        organization: org,
      }).allowed
    ).toBe(true);
    const preservedData = filterRecordsByTenant(historicalScoringRecords, org.id);
    expect(preservedData).toHaveLength(2);
    expect(preservedData[0].totalScore).toBe(84);
  });

  it('Pruebas 9 y 10: Crear un empleado con permisos limitados y verificar que no vea opciones administrativas ni de plataforma', () => {
    const limitedEmployee: UserProfile = {
      uid: 'emp_collector_1',
      email: 'gestor@sugloria.com.do',
      displayName: 'Pedro Gestor',
      role: 'COLLECTION_AGENT',
      organizationId: SU_GLORIA_ORG_ID,
      status: 'ACTIVE',
    };

    // 9 y 10: El empleado con rol limitado tiene acceso a cobranza operativa pero NO ve opciones administrativas ni Platform Control
    expect(canRoleAccessSection(limitedEmployee.role, 'cobranza_daily')).toBe(true);
    expect(canRoleAccessSection(limitedEmployee.role, 'admin_users')).toBe(false);
    expect(canRoleAccessSection(limitedEmployee.role, 'admin_roles')).toBe(false);
    expect(canRoleAccessSection(limitedEmployee.role, 'admin_settings')).toBe(false);
    expect(canRoleAccessSection(limitedEmployee.role, 'policies')).toBe(false);
    expect(hasRolePermission(limitedEmployee.role, 'MANAGE_POLICIES_AND_RBAC')).toBe(false);
    expect(isSuperAdminUser(limitedEmployee, true)).toBe(false);
  });

  it('Pruebas 11, 12 y 13: Verificar aislamiento estricto — Empresa A no puede ver clientes, préstamos ni pagos de Empresa B', () => {
    const orgA = 'org_empresa_a';
    const orgB = 'org_empresa_b';

    const userEmpresaA: UserProfile = {
      uid: 'user_a',
      email: 'analista@empresaa.com',
      displayName: 'Analista Empresa A',
      role: 'CREDIT_ANALYST',
      organizationId: orgA,
      status: 'ACTIVE',
    };

    const allCustomers: CustomerRecord[] = [
      makeCustomer({ id: 'cust_a1', organizationId: orgA, firstName: 'Cliente A' }),
      makeCustomer({ id: 'cust_b1', organizationId: orgB, firstName: 'Cliente B Secreto' }),
    ];

    const allLoans: LoanRecord[] = [
      {
        id: 'loan_a1',
        organizationId: orgA,
        loanNumber: 'PR-A-001',
        applicationId: 'app_a1',
        disbursementId: 'disb_a1',
        customerId: 'cust_a1',
        applicantDisplayName: 'Cliente A',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        approvedPrincipal: 100000,
        financedExpenses: 0,
        totalFinancedPrincipal: 100000,
        currentPrincipalBalance: 85000,
        contractualRateMonthly: 3,
        termMonths: 12,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-01-10',
        firstPaymentDate: '2026-02-10',
        maturityDate: '2027-01-10',
        totalContractualInterest: 18000,
        totalContractualPayable: 118000,
        status: 'ACTIVO',
        createdBy: 'user_a',
        createdAt: '2026-01-10T00:00:00Z',
      },
      {
        id: 'loan_b1',
        organizationId: orgB,
        loanNumber: 'PR-B-999',
        applicationId: 'app_b1',
        disbursementId: 'disb_b1',
        customerId: 'cust_b1',
        applicantDisplayName: 'Cliente B Secreto',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        approvedPrincipal: 500000,
        financedExpenses: 0,
        totalFinancedPrincipal: 500000,
        currentPrincipalBalance: 480000,
        contractualRateMonthly: 2.5,
        termMonths: 24,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-01-10',
        firstPaymentDate: '2026-02-10',
        maturityDate: '2028-01-10',
        totalContractualInterest: 90000,
        totalContractualPayable: 590000,
        status: 'ACTIVO',
        createdBy: 'user_b',
        createdAt: '2026-01-10T00:00:00Z',
      },
    ];

    const allPayments: PaymentRecord[] = [
      {
        id: 'pay_a1',
        organizationId: orgA,
        loanId: 'loan_a1',
        loanNumber: 'PR-A-001',
        customerId: 'cust_a1',
        customerName: 'Cliente A',
        currency: 'DOP',
        amount: 12500,
        paymentDate: '2026-02-10',
        method: 'TRANSFERENCIA',
        referenceNumber: 'REF-A-001',
        idempotencyKey: 'idem_a1',
        status: 'APLICADO',
        reportedByUserId: 'user_a',
        reportedByName: 'Analista Empresa A',
        createdAt: '2026-02-10T10:00:00Z',
      },
      {
        id: 'pay_b1',
        organizationId: orgB,
        loanId: 'loan_b1',
        loanNumber: 'PR-B-999',
        customerId: 'cust_b1',
        customerName: 'Cliente B Secreto',
        currency: 'DOP',
        amount: 45000,
        paymentDate: '2026-02-10',
        method: 'TRANSFERENCIA',
        referenceNumber: 'REF-B-999',
        idempotencyKey: 'idem_b1',
        status: 'APLICADO',
        reportedByUserId: 'user_b',
        reportedByName: 'Analista Empresa B',
        createdAt: '2026-02-10T10:00:00Z',
      },
    ];

    // 11. Empresa A no puede ver clientes de Empresa B
    const visibleCustomersA = filterRecordsByTenant(allCustomers, orgA);
    expect(visibleCustomersA).toHaveLength(1);
    expect(visibleCustomersA[0].id).toBe('cust_a1');
    expect(
      canUserAccessRecordByTenant({
        recordOrganizationId: allCustomers[1].organizationId,
        activeOrganizationId: orgA,
        userProfile: userEmpresaA,
      })
    ).toBe(false);

    // 12. Empresa A no puede ver préstamos de Empresa B
    const visibleLoansA = filterRecordsByTenant(allLoans, orgA);
    expect(visibleLoansA).toHaveLength(1);
    expect(visibleLoansA[0].loanNumber).toBe('PR-A-001');
    expect(
      canUserAccessRecordByTenant({
        recordOrganizationId: allLoans[1].organizationId,
        activeOrganizationId: orgA,
        userProfile: userEmpresaA,
      })
    ).toBe(false);

    // 13. Empresa A no puede ver pagos de Empresa B
    const visiblePaymentsA = filterRecordsByTenant(allPayments, orgA);
    expect(visiblePaymentsA).toHaveLength(1);
    expect(visiblePaymentsA[0].referenceNumber).toBe('REF-A-001');
    expect(
      canUserAccessRecordByTenant({
        recordOrganizationId: allPayments[1].organizationId,
        activeOrganizationId: orgA,
        userProfile: userEmpresaA,
      })
    ).toBe(false);
  });

  it('Pruebas 14 y 15: Verificar que Bela no responda con datos de otra empresa y que AxyCore Director no mezcle métricas de empresas distintas', () => {
    const orgA = 'org_empresa_a';
    const orgB = 'org_empresa_b';

    const loansMixed: LoanRecord[] = [
      {
        id: 'loan_a1',
        organizationId: orgA,
        loanNumber: 'PR-A-100',
        applicationId: 'app_a1',
        disbursementId: 'disb_a1',
        customerId: 'cust_a1',
        applicantDisplayName: 'Deudor Exclusivo Empresa A',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        approvedPrincipal: 150000,
        financedExpenses: 0,
        totalFinancedPrincipal: 150000,
        currentPrincipalBalance: 140000,
        contractualRateMonthly: 3,
        termMonths: 12,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-03-01',
        firstPaymentDate: '2026-04-01',
        maturityDate: '2027-03-01',
        totalContractualInterest: 25000,
        totalContractualPayable: 175000,
        status: 'ACTIVO',
        createdBy: 'admin_a',
        createdAt: '2026-03-01T10:00:00Z',
      },
      {
        id: 'loan_b1',
        organizationId: orgB,
        loanNumber: 'PR-B-999',
        applicationId: 'app_b1',
        disbursementId: 'disb_b1',
        customerId: 'cust_b1',
        applicantDisplayName: 'Deudor Confidencial Empresa B',
        productCode: 'PERSONAL_DOP',
        currency: 'DOP',
        approvedPrincipal: 900000,
        financedExpenses: 0,
        totalFinancedPrincipal: 900000,
        currentPrincipalBalance: 890000,
        contractualRateMonthly: 2.5,
        termMonths: 24,
        frequency: 'MENSUAL',
        amortizationMethod: 'SALDO_INSOLUTO',
        disbursementDate: '2026-03-01',
        firstPaymentDate: '2026-04-01',
        maturityDate: '2028-03-01',
        totalContractualInterest: 150000,
        totalContractualPayable: 1050000,
        status: 'ACTIVO',
        createdBy: 'admin_b',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ];

    const bounds = resolvePeriodBounds('CURRENT_MONTH', '', '', '2026-03-20');
    const scopedLoansA = filterRecordsByTenant(loansMixed, orgA);

    // 15. AxyCore Director calcula métricas únicamente con los registros de la Empresa A (RD$ 140,000, sin mezclar los RD$ 890,000 de Empresa B)
    const metricsEmpresaA = computeExecutiveCurrencyMetrics({
      currency: 'DOP',
      bounds,
      todayIso: '2026-03-20',
      applications: [],
      loans: scopedLoansA,
      loanInstallments: [],
      collectionAccounts: [],
      payments: [],
      paymentPromises: [],
      usersList: [],
    });
    expect(metricsEmpresaA.activePortfolioCapital).toBe(140000);

    // 14. El contexto enviado a Bela y Director para Empresa A contiene exclusivamente datos de Empresa A y nunca menciona a Empresa B
    const userA: UserProfile = {
      uid: 'admin_a',
      email: 'admin@empresaa.com',
      displayName: 'Admin A',
      role: 'ADMIN',
      organizationId: orgA,
      status: 'ACTIVE',
    };
    const aiContextA = buildScopedAiContext({
      userProfile: userA,
      roleLabel: 'Administrador',
      organizationName: 'Empresa A Financiera',
      periodLabel: bounds.label,
      currencyFilter: 'DOP',
      dopMetrics: metricsEmpresaA,
      usdMetrics: metricsEmpresaA,
      operationalItems: [],
      recentActivity: [],
      applications: [],
      loans: scopedLoansA,
      collectionActions: [],
      riskAlerts: [],
      hasPermission: () => true,
    });

    const serializedContextA = JSON.stringify(aiContextA);
    expect(serializedContextA).toContain('Empresa A Financiera');
    expect(serializedContextA).toContain('Deudor Exclusivo Empresa A');
    expect(serializedContextA).not.toContain('Deudor Confidencial Empresa B');
    expect(serializedContextA).not.toContain('PR-B-999');
  });

  it('Pruebas 16, 17 y 18: Bloqueo de Platform Control a clientes/empleados, bloqueo por licencia vencida y cambio de organización multiempresa autorizado', () => {
    const tenantAdmin: UserProfile = {
      uid: 'tenant_admin_1',
      email: 'admin@empresa-cliente.com',
      displayName: 'Admin Empresa Cliente',
      role: 'ADMIN',
      organizationId: 'org_cliente_1',
      status: 'ACTIVE',
    };

    const orgActiva: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      id: 'org_cliente_1',
      name: 'Empresa Cliente 1',
      status: 'ACTIVA',
      licenseStatus: 'ACTIVA',
      licenseEndDate: '2027-12-31',
    };

    // 16. Ni el Administrador de una empresa cliente ni un empleado pueden entrar a AxyCore Platform Control
    expect(isSuperAdminUser(tenantAdmin, true)).toBe(false);
    expect(
      checkTenantSectionAccess({
        section: 'platform_control',
        organization: orgActiva,
        isSuperAdmin: isSuperAdminUser(tenantAdmin, true),
      }).allowed
    ).toBe(false);
    // Mientras que el Superadministrador AxyCore sí tiene acceso
    expect(
      checkTenantSectionAccess({
        section: 'platform_control',
        organization: orgActiva,
        isSuperAdmin: isSuperAdminUser(superAdminProfile, true),
      }).allowed
    ).toBe(true);

    // 17. Una licencia vencida bloquea los módulos operativos restringidos pero permite ver el dashboard informativo de aviso
    const orgLicenciaVencida: OrganizationRecord = {
      ...orgActiva,
      licenseStatus: 'VENCIDA',
      licenseEndDate: '2024-01-01',
    };
    const expiredLoanAccess = checkTenantSectionAccess({
      section: 'loans',
      organization: orgLicenciaVencida,
      isSuperAdmin: false,
    });
    expect(expiredLoanAccess.allowed).toBe(false);
    expect(expiredLoanAccess.isLicenseBlocked).toBe(true);
    expect(expiredLoanAccess.reason).toContain('VENCIDA');

    // 18. Un usuario multiempresa puede cambiar de organización solo si tiene membresía activa en esa organización
    const orgB: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      id: 'org_cliente_2',
      name: 'Empresa Cliente 2',
      status: 'ACTIVA',
    };
    const orgCNoAutorizada: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      id: 'org_cliente_3',
      name: 'Empresa Cliente 3',
      status: 'ACTIVA',
    };
    const memberships: OrganizationMembershipRecord[] = [
      {
        id: 'mem_1',
        organizationId: 'org_cliente_1',
        organizationName: 'Empresa Cliente 1',
        userId: tenantAdmin.uid,
        userEmail: tenantAdmin.email,
        userDisplayName: tenantAdmin.displayName,
        role: 'ADMIN',
        status: 'ACTIVE',
        granularPermissions: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR'],
        invitedBy: 'superadmin_1',
      },
      {
        id: 'mem_2',
        organizationId: 'org_cliente_2',
        organizationName: 'Empresa Cliente 2',
        userId: tenantAdmin.uid,
        userEmail: tenantAdmin.email,
        userDisplayName: tenantAdmin.displayName,
        role: 'AUDITOR',
        status: 'ACTIVE',
        granularPermissions: ['CONSULTAR', 'EXPORTAR'],
        invitedBy: 'superadmin_1',
      },
    ];

    const switchAuthorized = switchUserOrganizationWorkspace({
      userProfile: tenantAdmin,
      targetOrganizationId: 'org_cliente_2',
      organizations: [orgActiva, orgB, orgCNoAutorizada],
      memberships,
      isSuperAdmin: false,
    });
    expect(switchAuthorized.allowed).toBe(true);
    expect(switchAuthorized.updatedProfile?.organizationId).toBe('org_cliente_2');
    expect(switchAuthorized.updatedProfile?.role).toBe('AUDITOR');

    const switchUnauthorized = switchUserOrganizationWorkspace({
      userProfile: tenantAdmin,
      targetOrganizationId: 'org_cliente_3',
      organizations: [orgActiva, orgB, orgCNoAutorizada],
      memberships,
      isSuperAdmin: false,
    });
    expect(switchUnauthorized.allowed).toBe(false);
  });

  it('Pruebas 19 y 20: Verificar que SU GLORIA MANO AMIGA conserve todos sus datos actuales y que ninguna migración duplique registros', () => {
    const existingCustomers = [
      makeCustomer({ id: 'cust_sg_1', organizationId: SU_GLORIA_ORG_ID, firstName: 'María' }),
      makeCustomer({ id: 'cust_sg_2', organizationId: 'org_default', firstName: 'José' }),
    ];
    const existingLoans = [
      { id: 'loan_sg_1', organizationId: SU_GLORIA_ORG_ID },
      { id: 'loan_sg_2', organizationId: SU_GLORIA_ORG_ID },
      { id: 'loan_sg_3', organizationId: undefined },
    ];
    const existingPayments = [{ id: 'pay_sg_1', organizationId: SU_GLORIA_ORG_ID }];

    // Primera ejecución de migración controlada
    const firstCustomerMigration = runControlledSuGloriaMigration(existingCustomers);
    const firstLoanMigration = runControlledSuGloriaMigration(existingLoans);
    const firstPaymentMigration = runControlledSuGloriaMigration(existingPayments);

    // Segunda ejecución idempotente de migración controlada
    const secondCustomerMigration = runControlledSuGloriaMigration(firstCustomerMigration.records);
    const secondLoanMigration = runControlledSuGloriaMigration(firstLoanMigration.records);
    const secondPaymentMigration = runControlledSuGloriaMigration(firstPaymentMigration.records);

    // 19. SU GLORIA MANO AMIGA conserva todos sus clientes, préstamos y pagos
    expect(SU_GLORIA_MANO_AMIGA_ORG.tradeName).toBe('SU GLORIA MANO AMIGA');
    expect(secondCustomerMigration.targetOrganizationId).toBe(SU_GLORIA_ORG_ID);
    expect(secondCustomerMigration.records).toHaveLength(2);
    expect(secondCustomerMigration.records.every((r) => r.organizationId === SU_GLORIA_ORG_ID)).toBe(true);
    expect(secondLoanMigration.records).toHaveLength(3);
    expect(secondLoanMigration.records.every((r) => r.organizationId === SU_GLORIA_ORG_ID)).toBe(true);
    expect(secondPaymentMigration.records).toHaveLength(1);

    // 20. Cero registros duplicados tras múltiples ejecuciones e idempotencia total
    expect(firstCustomerMigration.duplicateIdsDetected).toBe(0);
    expect(secondCustomerMigration.duplicateIdsDetected).toBe(0);
    expect(secondCustomerMigration.migratedToSuGloriaCount).toBe(0);
    expect(secondCustomerMigration.alreadyAssignedSuGloriaCount).toBe(2);
    expect(AXYCORE_MODULE_CATALOG.length).toBe(34);
  });

  it('Pruebas 21 y 22: Validar los esquemas y validadores de las colecciones organizations y organization_memberships', () => {
    // 21. Esquemas estructurados para 'organizations' y 'organization_memberships'
    expect(ORGANIZATIONS_COLLECTION).toBe('organizations');
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.collectionName).toBe('organizations');
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.primaryKey).toBe('id');
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.tenantKey).toBe('organizationId');
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.slugKey).toBe('tenant_id');
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.fields.tenant_id).toBeDefined();
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.fields.modulesEnabled).toBeDefined();
    expect(ORGANIZATIONS_COLLECTION_SCHEMA.fields.rnc).toBeDefined();

    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION).toBe('organization_memberships');
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.collectionName).toBe('organization_memberships');
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.primaryKey).toBe('id');
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.tenantKey).toBe('organizationId');
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.fields.tenant_id).toBeDefined();
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.fields.role).toBeDefined();
    expect(ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA.fields.granularPermissions).toBeDefined();

    // 22. Validación y sanitización estricta de esquemas
    const validOrgResult = validateOrganizationSchema({
      id: 'org_test_1',
      name: 'Financiera La Fe',
      tenant_id: 'financiera-la-fe',
      rnc: '1-32-45678-9',
      status: 'ACTIVA',
      planCode: 'EMPRESARIAL',
    });
    expect(validOrgResult.isValid).toBe(true);
    expect(validOrgResult.sanitized?.tenant_id).toBe('financiera-la-fe');
    expect(validOrgResult.sanitized?.organizationId).toBe('org_test_1');
    expect(isOrganizationRecord(validOrgResult.sanitized)).toBe(true);

    const invalidOrgResult = validateOrganizationSchema({
      id: 'invalid id with spaces!',
      name: '',
    });
    expect(invalidOrgResult.isValid).toBe(false);
    expect(invalidOrgResult.errors.length).toBeGreaterThan(0);

    const validMembershipResult = validateOrganizationMembershipSchema({
      id: 'mem_test_1',
      organizationId: 'org_test_1',
      tenant_id: 'financiera-la-fe',
      userId: 'usr_123',
      userEmail: 'analista@lafe.do',
      userDisplayName: 'Carlos Analista',
      role: 'CREDIT_ANALYST',
      status: 'ACTIVE',
      granularPermissions: ['CONSULTAR', 'CREAR', 'EDITAR'],
    });
    expect(validMembershipResult.isValid).toBe(true);
    expect(validMembershipResult.sanitized?.tenant_id).toBe('financiera-la-fe');
    expect(validMembershipResult.sanitized?.role).toBe('CREDIT_ANALYST');
    expect(isOrganizationMembershipRecord(validMembershipResult.sanitized)).toBe(true);

    const invalidMembershipResult = validateOrganizationMembershipSchema({
      id: '',
      organizationId: '',
      userId: '',
      userEmail: 'not-an-email',
      userDisplayName: '',
    });
    expect(invalidMembershipResult.isValid).toBe(false);
    expect(invalidMembershipResult.errors.length).toBeGreaterThan(0);
  });

  it('Pruebas 23 y 24: Validar el servicio tenantService para aislamiento estricto por tenant_id y auto-filtrado de consultas', () => {
    const customTenantService = new TenantService();

    // 23. Gestión de contexto por tenant_id y resolución canónica
    customTenantService.setContext({
      tenantId: 'su-gloria-mano-amiga',
      organizationId: SU_GLORIA_ORG_ID,
      user: {
        uid: 'usr_sg_admin',
        email: 'admin@sugloria.do',
        displayName: 'Admin Su Gloria',
        role: 'ADMIN',
        organizationId: SU_GLORIA_ORG_ID,
        status: 'ACTIVE',
      },
      organization: SU_GLORIA_MANO_AMIGA_ORG,
      memberships: [
        {
          id: 'mem_sg_1',
          organizationId: SU_GLORIA_ORG_ID,
          tenant_id: 'su-gloria-mano-amiga',
          userId: 'usr_sg_admin',
          userEmail: 'admin@sugloria.do',
          userDisplayName: 'Admin Su Gloria',
          role: 'ADMIN',
          status: 'ACTIVE',
          granularPermissions: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR'],
          invitedBy: 'platform',
          organizationName: 'SU GLORIA MANO AMIGA',
        },
      ],
    });

    expect(customTenantService.getActiveTenantId()).toBe('su-gloria-mano-amiga');
    expect(customTenantService.getActiveOrganizationId()).toBe(SU_GLORIA_ORG_ID);
    expect(customTenantService.canUserAccessTenant(SU_GLORIA_ORG_ID)).toBe(true);
    expect(customTenantService.canUserAccessTenant('su-gloria-mano-amiga')).toBe(true);
    expect(customTenantService.canUserAccessTenant('org_otra_empresa')).toBe(false);

    // Prevención de cruce de datos no autorizado
    expect(() => {
      customTenantService.assertTenantAccess('org_otra_empresa', 'lectura de préstamos');
    }).toThrow(/Violación de seguridad Multi-Tenant/);

    // Filtrado en memoria por tenant actual
    const multiTenantLoans = [
      { id: 'loan_sg_1', organizationId: SU_GLORIA_ORG_ID, tenant_id: 'su-gloria-mano-amiga' },
      { id: 'loan_sg_2', organizationId: SU_GLORIA_ORG_ID },
      { id: 'loan_other_1', organizationId: 'org_otra_empresa', tenant_id: 'otra-empresa' },
    ];
    const isolatedLoans = customTenantService.filterRecordsByTenant(multiTenantLoans);
    expect(isolatedLoans).toHaveLength(2);
    expect(isolatedLoans.map((l) => l.id)).toEqual(['loan_sg_1', 'loan_sg_2']);

    // 24. Auto-filtrado garantizado en consultas Firestore
    // buildTenantQuery añade automáticamente el filtro de organización del usuario actual
    const queryForCustomers = customTenantService.buildTenantQuery('customers');
    expect(queryForCustomers).toBeDefined();

    // Verificación con el singleton transversal tenantService
    expect(tenantService).toBeInstanceOf(TenantService);
  });

  it('Prueba 25: Validar disponibilidad de IntelligenceDashboardView en RBAC y mapeo de módulos', () => {
    // 1. Acceso por roles autorizados en RBAC
    expect(canRoleAccessSection('ADMIN', 'intelligence_dashboard')).toBe(true);
    expect(canRoleAccessSection('CREDIT_ANALYST', 'intelligence_dashboard')).toBe(true);
    expect(canRoleAccessSection('RISK_OFFICER', 'intelligence_dashboard')).toBe(true);
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'intelligence_dashboard')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'intelligence_dashboard')).toBe(false);

    // 2. Mapeo en el catálogo maestro de módulos de AxyCore
    const motorModule = AXYCORE_MODULE_CATALOG.find((m) => m.code === 'motor_decisiones');
    expect(motorModule).toBeDefined();
    expect(motorModule?.mappedSections).toContain('intelligence_dashboard');
    expect(motorModule?.mappedSections).toContain('decision_engine');
  });

  it('Prueba 26: Validar flujo criptográfico WebAuthn FaceID/TouchID (SPKI + flags UP/UV + challenge)', async () => {
    const sampleBytes = new Uint8Array([0, 15, 255, 128, 64, 32]);
    const b64u = bufferToBase64Url(sampleBytes);
    expect(Array.from(base64UrlToBuffer(b64u))).toEqual(Array.from(sampleBytes));

    expect(detectBiometricPlatformLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toBe(
      'FaceID / TouchID'
    );
    expect(detectBiometricPlatformLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(
      'Biometría / Huella'
    );
    expect(detectBiometricPlatformLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'Windows Hello'
    );

    // 1. Generar par real de claves ECDSA P-256 (WebAuthn ES256 / alg -7)
    const keyPair = await globalThis.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const spki = await globalThis.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const spkiB64u = bufferToBase64Url(spki);

    const challenge = 'axycore_test_challenge_12345';
    const origin = 'https://axycore.app';
    const clientDataBytes = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin })
    );
    const clientDataCheck = verifyClientDataJson(
      clientDataBytes,
      'webauthn.get',
      challenge,
      origin
    );
    expect(clientDataCheck.valid).toBe(true);

    // authenticatorData: 32 bytes rpIdHash + 1 byte flags (UP=0x01 | UV=0x04 = 0x05) + 4 bytes signCount (= 7)
    const authData = new Uint8Array(37);
    authData[32] = 0x05;
    authData[36] = 7;
    const parsedAuth = parseAuthenticatorData(authData);
    expect(parsedAuth.up).toBe(true);
    expect(parsedAuth.uv).toBe(true);
    expect(parsedAuth.signCount).toBe(7);

    // Firmar (authenticatorData || SHA-256(clientDataJSON))
    const clientDataHash = new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', clientDataBytes)
    );
    const payload = new Uint8Array(authData.length + clientDataHash.length);
    payload.set(authData, 0);
    payload.set(clientDataHash, authData.length);
    const rawSignature = new Uint8Array(
      await globalThis.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        payload
      )
    );
    expect(rawSignature.length).toBe(64);

    // Prueba de conversión ASN.1 DER -> 64 bytes
    const derMock = new Uint8Array([
      0x30,
      70,
      0x02,
      33,
      0x00,
      ...rawSignature.subarray(0, 32),
      0x02,
      33,
      0x00,
      ...rawSignature.subarray(32, 64),
    ]);
    expect(Array.from(derToRawEcdsaSignature(derMock))).toEqual(Array.from(rawSignature));

    // Verificación criptográfica completa exitosa
    const verified = await verifyWebAuthnAssertionLocal({
      clientDataJSON: clientDataBytes,
      authenticatorData: authData,
      signature: rawSignature,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      publicKeySpkiBase64Url: spkiB64u,
      publicKeyAlg: -7,
      previousSignCount: 6,
    });
    expect(verified.verified).toBe(true);
    expect(verified.cryptographicallyVerified).toBe(true);
    expect(verified.signCount).toBe(7);

    // Rechaza challenge alterado
    const tamperedChallenge = await verifyWebAuthnAssertionLocal({
      clientDataJSON: clientDataBytes,
      authenticatorData: authData,
      signature: rawSignature,
      expectedChallenge: 'otro_challenge_distinto',
      expectedOrigin: origin,
      publicKeySpkiBase64Url: spkiB64u,
    });
    expect(tamperedChallenge.verified).toBe(false);

    // Rechaza ausencia de bandera UV (User Verification)
    const noUvAuthData = new Uint8Array(authData);
    noUvAuthData[32] = 0x01; // Solo UP, sin UV
    const noUvResult = await verifyWebAuthnAssertionLocal({
      clientDataJSON: clientDataBytes,
      authenticatorData: noUvAuthData,
      signature: rawSignature,
      expectedChallenge: challenge,
      expectedOrigin: origin,
    });
    expect(noUvResult.verified).toBe(false);
  });

  it('Prueba 27: Validar generación y resolución de Código Corporativo para acceso multi-portal', () => {
    expect(SU_GLORIA_MANO_AMIGA_ORG.accessCode).toBe('SGMA-001');

    const generatedCode = generateCorporateAccessCode('Financiera Horizonte', '8k2p');
    expect(generatedCode).toBe('FHX-8K2P');

    const customOrg: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      id: 'org_horizonte_1',
      organizationId: 'org_horizonte_1',
      tenantId: 'financiera-horizonte-8k2p',
      accessCode: 'FHX-8K2P',
      name: 'Financiera Horizonte',
      tradeName: 'Financiera Horizonte',
    };

    const resolvedSg = resolveOrganizationByCorporateCode('sgma-001', [
      SU_GLORIA_MANO_AMIGA_ORG,
      customOrg,
    ]);
    expect(resolvedSg?.id).toBe(SU_GLORIA_ORG_ID);

    const resolvedHorizonte = resolveOrganizationByCorporateCode('FHX-8K2P', [
      SU_GLORIA_MANO_AMIGA_ORG,
      customOrg,
    ]);
    expect(resolvedHorizonte?.id).toBe('org_horizonte_1');

    const notFound = resolveOrganizationByCorporateCode('INEXISTENTE-999', [
      SU_GLORIA_MANO_AMIGA_ORG,
      customOrg,
    ]);
    expect(notFound).toBeNull();
  });

  it('Prueba 28: Validar quórum colegiado 2 de 3 en Comité de Crédito (aprobación, rechazo y deduplicación por UID)', () => {
    const v1 = evaluateCollegialCommitteeVotes(
      [
        {
          userId: 'cm_1',
          userName: 'Miembro Uno',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:00:00Z',
        },
      ],
      2,
      3
    );
    expect(v1.totalVotes).toBe(1);
    expect(v1.approveCount).toBe(1);
    expect(v1.resolvedDecision).toBeNull();
    expect(v1.hasUserVoted('cm_1')).toBe(true);

    // Intento duplicado del mismo UID no debe sumar 2/3
    const dupVote = evaluateCollegialCommitteeVotes(
      [
        {
          userId: 'cm_1',
          userName: 'Miembro Uno',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:00:00Z',
        },
        {
          userId: 'cm_1',
          userName: 'Miembro Uno',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:01:00Z',
        },
      ],
      2,
      3
    );
    expect(dupVote.totalVotes).toBe(1);
    expect(dupVote.resolvedDecision).toBeNull();

    // 2 votos aprobatorios distintos -> resuelve APROBADO
    const approved = evaluateCollegialCommitteeVotes(
      [
        {
          userId: 'cm_1',
          userName: 'Miembro Uno',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:00:00Z',
        },
        {
          userId: 'cm_2',
          userName: 'Miembro Dos',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:05:00Z',
        },
      ],
      2,
      3
    );
    expect(approved.totalVotes).toBe(2);
    expect(approved.approveCount).toBe(2);
    expect(approved.resolvedDecision).toBe('APROBADO');

    // 2 votos de rechazo -> resuelve RECHAZADO
    const rejected = evaluateCollegialCommitteeVotes(
      [
        {
          userId: 'cm_1',
          userName: 'Miembro Uno',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-18T10:00:00Z',
        },
        {
          userId: 'cm_2',
          userName: 'Miembro Dos',
          role: 'COMMITTEE_MEMBER',
          vote: 'RECHAZADO',
          votedAt: '2026-11-18T10:05:00Z',
        },
        {
          userId: 'cm_3',
          userName: 'Miembro Tres',
          role: 'COMMITTEE_MEMBER',
          vote: 'RECHAZADO',
          votedAt: '2026-11-18T10:10:00Z',
        },
      ],
      2,
      3
    );
    expect(rejected.totalVotes).toBe(3);
    expect(rejected.rejectCount).toBe(2);
    expect(rejected.resolvedDecision).toBe('RECHAZADO');
  });

  it('Prueba 29: Validar envío automático de Tabla de Amortización en APROBADA y confirmación bancaria en DESEMBOLSADA', () => {
    const app = makeApplication({
      applicationNumber: 'SOL-2026-0888',
      requestedAmount: 120000,
      requestedTermMonths: 6,
    });
    const schedule = generateAmortizationSchedule({
      financedPrincipal: 120000,
      monthlyRate: 0.04,
      termMonths: 6,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-11-18',
      firstPaymentDate: '2026-12-18',
    });

    const approvedEmail = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'APROBADA',
      recipientName: 'Carlos Ramírez',
      approvedAmount: 120000,
      approvedRateMonthly: 0.04,
      approvedTermMonths: 6,
      paymentFrequency: 'MENSUAL',
      firstPaymentDate: '2026-12-18',
      amortizationSchedule: schedule.rows,
    });
    expect(approvedEmail.bodyText).toContain('Tabla de Amortización (6 cuotas):');
    expect(approvedEmail.bodyHtml).toContain('Tabla de Amortización Contractual (6 cuotas)');
    expect(approvedEmail.bodyText).toContain('2026-12-18');

    const disbursedEmail = buildCustomerStatusEmailPayload({
      application: app,
      eventCode: 'DESEMBOLSADA',
      recipientName: 'Carlos Ramírez',
      approvedAmount: 120000,
      disbursementBank: 'Banco Popular Dominicano',
      disbursementAccountMasked: '****3456',
      disbursementRef: 'LBTR-2026-99102',
    });
    expect(disbursedEmail.bodyText).toContain('ya se encuentra en su cuenta de banco');
    expect(disbursedEmail.bodyHtml).toContain('ya se encuentra en su cuenta de banco');
    expect(disbursedEmail.bodyText).toContain('Banco Popular Dominicano');
  });

  it('Prueba 30: Clasificación y filtrado de Clientes Activos vs Inactivos (préstamos cancelados) vs Todos', () => {
    const activeCust = makeCustomer({ id: 'cust_active', firstName: 'Laura', lastName: 'Méndez' });
    const inactiveCust = makeCustomer({
      id: 'cust_inactive',
      firstName: 'Pedro',
      lastName: 'Gómez',
      documentNumber: '00199988877',
    });
    const prospectCust = makeCustomer({
      id: 'cust_prospect',
      firstName: 'Sofía',
      lastName: 'Núñez',
      documentNumber: '00177766655',
    });

    const baseLoan: LoanRecord = {
      id: 'loan_1',
      organizationId: 'org_axycore_main',
      loanNumber: 'PRE-2026-0001',
      applicationId: 'app_1',
      disbursementId: 'disb_1',
      customerId: activeCust.id,
      applicantDisplayName: 'Laura Méndez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 100000,
      financedExpenses: 0,
      totalFinancedPrincipal: 100000,
      currentPrincipalBalance: 75000,
      contractualRateMonthly: 0.04,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-09-01',
      firstPaymentDate: '2026-10-01',
      maturityDate: '2027-09-01',
      totalContractualInterest: 24000,
      totalContractualPayable: 124000,
      status: 'ACTIVO',
      createdBy: 'ops_1',
    };

    const loans: LoanRecord[] = [
      // Laura tuvo un préstamo cancelado previo y tiene uno activo -> sigue siendo ACTIVA
      {
        ...baseLoan,
        id: 'loan_laura_old',
        loanNumber: 'PRE-2025-0010',
        currentPrincipalBalance: 0,
        status: 'CANCELADO',
        closedAt: '2026-08-15',
      },
      baseLoan,
      // Pedro solo tiene préstamos cancelados/pagados -> INACTIVO
      {
        ...baseLoan,
        id: 'loan_pedro_1',
        loanNumber: 'PRE-2025-0022',
        customerId: inactiveCust.id,
        applicantDisplayName: 'Pedro Gómez',
        currentPrincipalBalance: 0,
        status: 'CANCELADO',
        closedAt: '2026-10-20',
      },
    ];

    const summaries = buildCustomerDirectorySummaries({
      customers: [activeCust, inactiveCust, prospectCust],
      loans,
    });

    const allFiltered = filterCustomerDirectory(summaries, 'ALL');
    const activeFiltered = filterCustomerDirectory(summaries, 'ACTIVO');
    const inactiveFiltered = filterCustomerDirectory(summaries, 'INACTIVO');

    expect(allFiltered).toHaveLength(3);
    expect(activeFiltered.map((s) => s.customer.id)).toEqual(['cust_active']);
    expect(activeFiltered[0].activeLoansCount).toBe(1);
    expect(activeFiltered[0].canceledLoansCount).toBe(1);
    expect(inactiveFiltered.map((s) => s.customer.id)).toEqual(['cust_inactive']);
    expect(inactiveFiltered[0].canceledLoansCount).toBe(1);
    expect(filterCustomerDirectory(summaries, 'INACTIVO', 'Pedro')).toHaveLength(1);
    expect(filterCustomerDirectory(summaries, 'INACTIVO', 'Laura')).toHaveLength(0);
  });

  it('Prueba 31: Validar RBAC y aislamiento por módulo para Clientes (Todos, Activos, Inactivos y Actualizar Datos)', () => {
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'customers')).toBe(true);
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'customers_active')).toBe(true);
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'customers_inactive')).toBe(true);
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'customers_update')).toBe(true);

    // Auditor puede consultar activos/inactivos pero no actualizar datos
    expect(canRoleAccessSection('AUDITOR', 'customers_active')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'customers_inactive')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'customers_update')).toBe(false);

    // Cliente externo no accede al directorio interno
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'customers')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'customers_update')).toBe(false);

    // Control de licenciamiento del módulo 'clientes'
    const orgWithoutClientes: OrganizationRecord = {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      enabledModules: [],
      modulesEnabled: [],
    };
    expect(
      checkTenantSectionAccess({
        section: 'customers_active',
        organization: orgWithoutClientes,
        isSuperAdmin: false,
      }).allowed
    ).toBe(false);
    expect(
      checkTenantSectionAccess({
        section: 'customers_update',
        organization: SU_GLORIA_MANO_AMIGA_ORG,
        isSuperAdmin: false,
      }).allowed
    ).toBe(true);
  });

  it('valida requisitos de roles y estado en el flujo de invitaciones de usuarios', () => {
    // 1. Roles permitidos en la plataforma
    const validRoles: UserRole[] = [
      'ADMIN', 'BUSINESS_OFFICER', 'CREDIT_ANALYST', 'RISK_OFFICER',
      'COMMITTEE_MEMBER', 'FORMALIZATION', 'OPERATIONS', 'FINANCE',
      'AUDITOR', 'COLLECTION_AGENT', 'SUPERVISOR', 'COLLECTION_COORDINATOR',
      'CASHIER', 'MANAGEMENT', 'EXTERNAL_CLIENT'
    ];
    expect(validRoles.includes('ADMIN')).toBe(true);

    // 2. Solo rol ADMIN puede gestionar usuarios y políticas
    expect(hasRolePermission('ADMIN', 'MANAGE_POLICIES_AND_RBAC')).toBe(true);
    expect(hasRolePermission('BUSINESS_OFFICER', 'MANAGE_POLICIES_AND_RBAC')).toBe(false);
    expect(hasRolePermission('EXTERNAL_CLIENT', 'MANAGE_POLICIES_AND_RBAC')).toBe(false);

    // 3. Estructura de usuario con estado de invitación
    const invitedAdminProfile: UserProfile = {
      uid: 'usr_new_admin_su_gloria',
      email: 'admin2@sugloria.com',
      displayName: 'Nuevo Administrador',
      role: 'ADMIN',
      organizationId: SU_GLORIA_MANO_AMIGA_ORG.id,
      status: 'ACTIVE',
      invitationStatus: 'INVITACION_ENVIADA',
      invitedBy: 'usr_andry_admin',
      invitedAt: new Date().toISOString(),
    };

    expect(invitedAdminProfile.role).toBe('ADMIN');
    expect(invitedAdminProfile.invitationStatus).toBe('INVITACION_ENVIADA');
    expect(invitedAdminProfile.status).toBe('ACTIVE');

    // 4. Transición a confirmado al iniciar sesión
    const confirmedProfile: UserProfile = {
      ...invitedAdminProfile,
      invitationStatus: 'CONFIRMADA',
    };
    expect(confirmedProfile.invitationStatus).toBe('CONFIRMADA');
  });
});






