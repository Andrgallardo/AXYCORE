import { describe, expect, it } from 'vitest';
import {
  buildAlteraPortfolioSummary,
  buildClientFinancialDna,
  buildCreditDigitalTwin,
  buildDefaultAlteraConfig,
  buildPreventivePlanBSignals,
} from '../engine/altera/alteraTwinAndDnaEngine';
import {
  answerAlteraNaturalQuery,
  evaluateOutcomeLearning,
  simulateAlternativeUniverses,
} from '../engine/altera/alteraSimulationEngine';
import { checkTenantSectionAccess } from '../engine/multiTenantEngine';
import { canRoleAccessSection, hasRolePermission } from '../engine/rbac';
import type {
  ApplicationRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  OrganizationRecord,
} from '../types/axycore';
import type { PaymentPromiseRecord, PaymentRecord } from '../types/collections';
import type { AlteraRecommendationRecord } from '../types/altera';

const ORG_ID = 'org_altera_test';

const TEST_ORG: OrganizationRecord = {
  id: ORG_ID,
  name: 'Financiera Demo',
  rnc: '131984212',
  currency: 'DOP',
  enabledModules: ['clientes', 'prestamos', 'cobranza', 'motor_decisiones', 'altera'],
};

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_1',
    organizationId: ORG_ID,
    documentType: 'CEDULA',
    documentNumber: '00112345678',
    documentKey: '00112345678',
    firstName: 'María',
    lastName: 'Ramírez',
    phone: '8095550101',
    createdBy: 'usr_1',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_1',
    organizationId: ORG_ID,
    loanNumber: 'AX-2026-0001',
    applicationId: 'app_1',
    disbursementId: 'disb_1',
    customerId: 'cust_1',
    applicantDisplayName: 'María Ramírez',
    productCode: 'EMPRESARIAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 60000,
    contractualRateMonthly: 0.04,
    termMonths: 12,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    maturityDate: '2027-01-01',
    totalContractualInterest: 28000,
    totalContractualPayable: 128000,
    status: 'ACTIVO',
    createdBy: 'usr_1',
    ...overrides,
  };
}

function makeInstallments(): LoanInstallmentRecord[] {
  return [
    {
      id: 'inst_1',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      installmentNumber: 1,
      dueDate: '2026-02-01',
      principalAmount: 10000,
      interestAmount: 4000,
      otherCharges: 0,
      totalAmount: 14000,
      remainingPrincipalBalance: 90000,
      status: 'PAGADA',
      paidPrincipal: 10000,
      paidInterest: 4000,
      paidAt: '2026-02-01',
    },
    {
      id: 'inst_2',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      installmentNumber: 2,
      dueDate: '2026-03-01',
      principalAmount: 10000,
      interestAmount: 3600,
      otherCharges: 0,
      totalAmount: 13600,
      remainingPrincipalBalance: 80000,
      status: 'PAGADA',
      paidPrincipal: 10000,
      paidInterest: 3600,
      paidAt: '2026-03-02',
    },
    {
      id: 'inst_3',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      installmentNumber: 3,
      dueDate: '2026-04-01',
      principalAmount: 10000,
      interestAmount: 3200,
      otherCharges: 0,
      totalAmount: 13200,
      remainingPrincipalBalance: 70000,
      status: 'PAGADA',
      paidPrincipal: 10000,
      paidInterest: 3200,
      paidAt: '2026-04-09',
    },
    {
      id: 'inst_4',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      installmentNumber: 4,
      dueDate: '2026-05-01',
      principalAmount: 10000,
      interestAmount: 2800,
      otherCharges: 0,
      totalAmount: 12800,
      remainingPrincipalBalance: 60000,
      status: 'VENCIDA',
      paidPrincipal: 0,
      paidInterest: 0,
      accruedLateFee: 640,
    },
    {
      id: 'inst_5',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      installmentNumber: 5,
      dueDate: '2026-06-01',
      principalAmount: 10000,
      interestAmount: 2400,
      otherCharges: 0,
      totalAmount: 12400,
      remainingPrincipalBalance: 50000,
      status: 'PENDIENTE',
    },
  ];
}

function makePayments(): PaymentRecord[] {
  return [
    {
      id: 'pay_1',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      loanNumber: 'AX-2026-0001',
      customerId: 'cust_1',
      customerName: 'María Ramírez',
      currency: 'DOP',
      amount: 14000,
      paymentDate: '2026-02-01',
      method: 'TRANSFERENCIA',
      referenceNumber: 'REF-1',
      idempotencyKey: 'idem_1',
      status: 'APLICADO',
      reportedByUserId: 'usr_1',
      reportedByName: 'Cajero',
    },
    {
      id: 'pay_2',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      loanNumber: 'AX-2026-0001',
      customerId: 'cust_1',
      customerName: 'María Ramírez',
      currency: 'DOP',
      amount: 13200,
      paymentDate: '2026-04-09',
      method: 'TRANSFERENCIA',
      referenceNumber: 'REF-2',
      idempotencyKey: 'idem_2',
      status: 'APLICADO',
      reportedByUserId: 'usr_1',
      reportedByName: 'Cajero',
    },
  ];
}

describe('ALTERA Engine — Gemelo Digital, ADN Financiero, Universos Alternativos & RBAC', () => {
  it('1. Construye Gemelo Digital Crediticio detectando cambio conductual reciente y mora real', () => {
    const loan = makeLoan();
    const installments = makeInstallments();
    const payments = makePayments();
    const config = buildDefaultAlteraConfig(ORG_ID);

    const twin = buildCreditDigitalTwin({
      loan,
      installments,
      payments,
      customer: makeCustomer(),
      alteraConfig: config,
      asOfDateIso: '2026-05-15',
    });

    expect(twin.loanId).toBe('loan_1');
    expect(twin.contractualRateMonthlyPct).toBe(4);
    expect(twin.dpdCurrent).toBe(14);
    expect(twin.deteriorationScore).toBeGreaterThanOrEqual(20);
    expect(twin.timelineSeries).toHaveLength(5);
    expect(twin.explainability.whatWasDetected.length).toBeGreaterThan(10);
    expect(twin.explainability.confidencePct).toBeGreaterThan(0);
  });

  it('2. ADN Financiero no inventa ingresos ni gastos cuando faltan solicitudes con datos financieros', () => {
    const customer = makeCustomer();
    const loan = makeLoan();
    const installments = makeInstallments();
    const twin = buildCreditDigitalTwin({
      loan,
      installments,
      payments: makePayments(),
      customer,
      asOfDateIso: '2026-05-15',
    });

    const dnaWithoutIncome = buildClientFinancialDna({
      customer,
      loans: [loan],
      twins: [twin],
      payments: makePayments(),
      promises: [],
      agreements: [],
      disputes: [],
      applications: [],
      evaluations: [],
    });

    expect(dnaWithoutIncome.incomeDataAvailable).toBe(false);
    expect(dnaWithoutIncome.verifiedMonthlyIncome).toBeNull();
    expect(dnaWithoutIncome.estimatedDebtServiceRatioPct).toBeNull();
    expect(dnaWithoutIncome.dataLimitations.some((l) => l.includes('no disponibles'))).toBe(true);

    const appWithIncome: Partial<ApplicationRecord> = {
      id: 'app_1',
      organizationId: ORG_ID,
      customerId: 'cust_1',
      currency: 'DOP',
      financialData: {
        primaryNetIncome: 55000,
        additionalNetIncome: 5000,
        declaredTotalMonthlyIncome: 60000,
        essentialExpenses: 20000,
        housingPayment: 8000,
        currentDebtPayments: 5000,
        incomeCurrency: 'DOP',
      } as ApplicationRecord['financialData'],
    };

    const dnaWithIncome = buildClientFinancialDna({
      customer,
      loans: [loan],
      twins: [twin],
      payments: makePayments(),
      promises: [],
      agreements: [],
      disputes: [],
      applications: [appWithIncome as ApplicationRecord],
      evaluations: [],
    });

    expect(dnaWithIncome.incomeDataAvailable).toBe(true);
    expect(dnaWithIncome.verifiedMonthlyIncome).toBe(65000);
    expect(dnaWithIncome.estimatedDebtServiceRatioPct).not.toBeNull();
  });

  it('3. Simula Universos Alternativos (3 vías) sin mutar el préstamo real y validando política', () => {
    const loan = makeLoan();
    const loanSnapshotBefore = JSON.stringify(loan);
    const installments = makeInstallments();
    const twin = buildCreditDigitalTwin({
      loan,
      installments,
      payments: makePayments(),
      customer: makeCustomer(),
      asOfDateIso: '2026-05-15',
    });
    const config = buildDefaultAlteraConfig(ORG_ID);

    const sim = simulateAlternativeUniverses({
      loan,
      twin,
      parameters: {
        interventionType: 'ABONO_EXTRAORDINARIO',
        extraordinaryPaymentAmount: 20000,
      },
      alteraConfig: config,
      asOfDateIso: '2026-05-15',
    });

    expect(sim.universes).toHaveLength(3);
    expect(sim.universes[0].universeCode).toBe('ACTUAL_SIN_INTERVENCION');
    expect(sim.universes[1].universeCode).toBe('PREVENTIVO_ANTICIPADO');
    expect(sim.universes[2].universeCode).toBe('ALTERNATIVO_CONDICIONES');
    expect(sim.universes[2].policyCompliant).toBe(true);
    expect(sim.universes[2].projectedTotalPayable).toBeLessThan(
      sim.universes[0].projectedTotalPayable
    );

    // Violación de política al exceder corrimiento máximo de fecha
    const outOfPolicy = simulateAlternativeUniverses({
      loan,
      twin,
      parameters: {
        interventionType: 'CAMBIO_FECHA_PAGO',
        dueDateShiftDays: config.maxDueDateShiftDays + 15,
      },
      alteraConfig: config,
      asOfDateIso: '2026-05-15',
    });
    expect(outOfPolicy.universes[2].policyCompliant).toBe(false);
    expect(outOfPolicy.universes[2].policyViolations.length).toBeGreaterThan(0);

    // Garantía no destructiva sobre contrato real
    expect(JSON.stringify(loan)).toBe(loanSnapshotBefore);
  });

  it('4. Plan B Preventivo, Aprendizaje de Resultados y Consulta a ALTERA producen salidas fundamentadas', () => {
    const customer = makeCustomer();
    const loan = makeLoan();
    const installments = makeInstallments();
    const payments = makePayments();
    const brokenPromise: PaymentPromiseRecord = {
      id: 'prom_1',
      organizationId: ORG_ID,
      loanId: 'loan_1',
      loanNumber: 'AX-2026-0001',
      customerId: 'cust_1',
      customerName: 'María Ramírez',
      promisedAmount: 12800,
      promisedDate: '2026-05-10',
      currency: 'DOP',
      channel: 'WHATSAPP',
      status: 'INCUMPLIDA',
      fulfilledAmount: 0,
      fulfilledPaymentIds: [],
      createdByUserId: 'usr_1',
      createdByUserName: 'Cobrador',
    };

    const twin = buildCreditDigitalTwin({
      loan,
      installments,
      payments,
      promises: [brokenPromise],
      customer,
      asOfDateIso: '2026-05-15',
    });
    const dna = buildClientFinancialDna({
      customer,
      loans: [loan],
      twins: [twin],
      payments,
      promises: [brokenPromise],
      agreements: [],
      disputes: [],
      applications: [],
      evaluations: [],
    });

    const signals = buildPreventivePlanBSignals({
      twins: [twin],
      dnas: [dna],
      collectionAccounts: [],
      collectionActions: [],
      riskAlerts: [],
      asOfDateIso: '2026-05-15',
    });

    expect(signals.length).toBe(1);
    expect(signals[0].loanId).toBe('loan_1');
    expect(signals[0].evidenceUsed.length).toBeGreaterThanOrEqual(3);

    const summary = buildAlteraPortfolioSummary({
      twins: [twin],
      dnas: [dna],
      preventiveSignals: signals,
      recommendations: [],
      savedScenarios: [],
      outcomes: [],
      asOfDateIso: '2026-05-15',
    });

    const queryRes = answerAlteraNaturalQuery({
      queryText: '¿Qué clientes están mostrando señales tempranas de deterioro?',
      portfolio: summary,
      twins: [twin],
      dnas: [dna],
      signals,
      loans: [loan],
      asOfDateIso: '2026-05-15',
    });
    expect(queryRes.evidenceItems.length).toBeGreaterThan(0);
    expect(queryRes.narrative).toContain('AX-2026-0001');

    const rec: AlteraRecommendationRecord = {
      id: 'rec_1',
      organizationId: ORG_ID,
      code: 'ALT-260501-0001',
      createdAtIso: '2026-04-01T10:00:00.000Z',
      customerId: 'cust_1',
      customerName: 'María Ramírez',
      loanId: 'loan_1',
      loanNumber: 'AX-2026-0001',
      currency: 'DOP',
      category: 'PLAN_B_PREVENTIVO',
      interventionType: 'REDUCCION_TEMPORAL_CUOTA',
      priority: 'ALTA',
      status: 'APROBADA',
      evidenceSummary: 'DPD 14d',
      diagnosis: 'Estrés temprano',
      proposedAlternative: 'Alivio 2 meses',
      expectedImpact: '+12% recup',
      expectedRecoveryDeltaPct: 12,
      expectedBalanceAtHorizon: 50000,
      confidencePct: 82,
      policyCompliant: true,
      suggestedFollowUpDate: '2026-05-20',
      explainability: twin.explainability,
      followUpHistory: [],
      createdBy: 'usr_1',
      createdByName: 'Analista',
    };

    const outcome = evaluateOutcomeLearning({
      recommendation: rec,
      loan,
      twin,
      installments,
      payments,
      promises: [brokenPromise],
      asOfDateIso: '2026-05-15',
    });

    expect(outcome.effectivenessScore).toBeGreaterThanOrEqual(5);
    expect(outcome.effectivenessScore).toBeLessThanOrEqual(100);
    expect(outcome.learningConclusion.length).toBeGreaterThan(15);
  });

  it('5. RBAC y acceso multiempresa protegen ALTERA y mantienen AUDITOR en solo lectura', () => {
    const access = checkTenantSectionAccess({
      organization: TEST_ORG,
      section: 'intelligence_altera',
      isSuperAdmin: false,
    });
    expect(access.allowed).toBe(true);

    expect(canRoleAccessSection('AUDITOR', 'intelligence_altera')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'VIEW_ALTERA')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'SIMULATE_ALTERA')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'PROPOSE_ALTERA_INTERVENTION')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'APPROVE_ALTERA_INTERVENTION')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'MANAGE_ALTERA_CONFIG')).toBe(false);

    expect(hasRolePermission('RISK_OFFICER', 'APPROVE_ALTERA_INTERVENTION')).toBe(true);
    expect(hasRolePermission('RISK_OFFICER', 'MANAGE_ALTERA_CONFIG')).toBe(true);
    expect(hasRolePermission('EXTERNAL_CLIENT', 'VIEW_ALTERA')).toBe(false);
  });
});
