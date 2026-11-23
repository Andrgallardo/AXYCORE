import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import {
  buildDefaultImpulsaConfig,
  computeImpulsaCommercialMetrics,
  computeImpulsaInternalAlerts,
  detectImpulsaOpportunities,
  getLifecycleMacroStage,
  runDeterministicImpulsaQuery,
} from '../engine/impulsa/impulsaEngine';
import { buildPayoffQuoteMessage } from '../engine/collections/loanPayoffEngine';
import { buildPaymentReceiptViewData } from '../utils/paymentReceiptGenerator';
import type {
  ApplicationRecord,
  BusinessRecord,
  CollectionAccountRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentRecord,
  RiskAlertRecord,
  UserProfile,
} from '../types/axycore';

const ORG_ID = 'org_test_impulsa';
const NOW_ISO = '2026-11-23T14:00:00.000Z';
const TEST_POLICY: CreditPolicyRecord = {
  ...DEFAULT_POLICY_V2,
  createdBy: 'SYSTEM',
};

const STAFF_USERS: UserProfile[] = [
  {
    uid: 'usr_off_1',
    email: 'oficial1@axycore.test',
    displayName: 'María Comercial',
    role: 'BUSINESS_OFFICER',
    organizationId: ORG_ID,
    status: 'ACTIVE',
  },
  {
    uid: 'usr_off_2',
    email: 'oficial2@axycore.test',
    displayName: 'Carlos Negocios',
    role: 'BUSINESS_OFFICER',
    organizationId: ORG_ID,
    status: 'ACTIVE',
  },
];

function makeCustomer(id: string, firstName: string, lastName: string, province = 'Distrito Nacional'): CustomerRecord {
  return {
    id,
    organizationId: ORG_ID,
    documentType: 'CEDULA',
    documentNumber: `001-000000-${id.slice(-1)}`,
    documentKey: `001000000${id.slice(-1)}`,
    firstName,
    lastName,
    phone: '809-555-0100',
    province,
    createdBy: 'usr_off_1',
  };
}

describe('Impulsa Intelligent Credit Growth Engine', () => {
  it('detects Early Renewal, Excellent Behavior, Credit Growth, Early Payments, and Cross-Sell with policy & capacity validation', () => {
    const cust = makeCustomer('cust_1', 'Laura', 'Méndez', 'Santiago');
    const biz: BusinessRecord = {
      id: 'biz_1',
      organizationId: ORG_ID,
      rnc: '131999888',
      rncKey: '131999888',
      legalName: 'Méndez Comercial SRL',
      authorizedRepName: 'Laura Méndez',
      authorizedRepDoc: cust.documentNumber,
      createdBy: 'usr_off_1',
    };

    const app: ApplicationRecord = {
      id: 'app_1',
      organizationId: ORG_ID,
      applicationNumber: 'SOL-2026-001',
      fileNumber: 'EXP-2026-001',
      channel: 'INTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: cust.id,
      applicantDisplayName: 'Laura Méndez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 100000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      financialData: {
        incomeCurrency: 'DOP',
        primaryNetIncome: 120000,
        essentialExpenses: 35000,
        housingPayment: 10000,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        currentDebtPayments: 0,
      },
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'DESEMBOLSADA',
      latestScore: 86,
      assignedTo: 'usr_off_1',
      createdBy: 'usr_off_1',
    };

    const loan: LoanRecord = {
      id: 'loan_1',
      organizationId: ORG_ID,
      loanNumber: 'PR-2026-001',
      applicationId: app.id,
      disbursementId: 'disb_1',
      customerId: cust.id,
      applicantDisplayName: 'Laura Méndez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 100000,
      financedExpenses: 0,
      totalFinancedPrincipal: 100000,
      currentPrincipalBalance: 20000,
      contractualRateMonthly: 0.035,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-01-15',
      firstPaymentDate: '2026-02-15',
      maturityDate: '2027-01-15',
      totalContractualInterest: 24000,
      totalContractualPayable: 124000,
      status: 'ACTIVO',
      paidPrincipalTotal: 80000,
      createdBy: 'usr_off_1',
    };

    const installments: LoanInstallmentRecord[] = Array.from({ length: 12 }, (_, idx) => {
      const num = idx + 1;
      const isPaid = num <= 10;
      const month = String((num % 12) + 1).padStart(2, '0');
      const year = num <= 10 ? 2026 : 2027;
      return {
        id: `inst_1_${num}`,
        organizationId: ORG_ID,
        loanId: loan.id,
        installmentNumber: num,
        dueDate: `${year}-${month}-15`,
        principalAmount: 8333,
        interestAmount: 2000,
        otherCharges: 0,
        totalAmount: 10333,
        remainingPrincipalBalance: Math.max(0, 100000 - num * 8333),
        status: isPaid ? 'PAGADA' : 'PENDIENTE',
        paidAt: isPaid ? `${year}-${month}-08T10:00:00.000Z` : null, // 7 days early!
      };
    });

    const acc: CollectionAccountRecord = {
      id: loan.id,
      organizationId: ORG_ID,
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      applicationId: app.id,
      customerId: cust.id,
      applicantDisplayName: 'Laura Méndez',
      province: 'Santiago',
      productCode: loan.productCode,
      currency: 'DOP',
      dpd: 0,
      maxHistoricalDpd: 0,
      stage: 'AL_DIA',
      bucket: 'AL_DIA',
      priority: 'BAJA',
      priorityScore: 10,
      priorityReasons: [],
      overdueInstallmentsCount: 0,
      totalInstallmentsCount: 12,
      paidInstallmentsCount: 10,
      overduePrincipal: 0,
      overdueInterest: 0,
      overdueLateFee: 0,
      overdueCharges: 0,
      overdueTotalAmount: 0,
      totalOutstandingPrincipal: 20000,
      pendingVerificationAmount: 0,
      brokenPromisesCount: 0,
      behaviorScore: 95,
      behaviorBand: 'EXCELENTE',
      consentWhatsAppOptIn: true,
    };

    const res = detectImpulsaOpportunities({
      organizationId: ORG_ID,
      customers: [cust],
      businesses: [biz],
      loans: [loan],
      loanInstallments: installments,
      payments: [],
      applications: [app],
      collectionAccounts: [acc],
      riskAlerts: [],
      policy: TEST_POLICY,
      users: STAFF_USERS,
      existingOpportunities: [],
      config: buildDefaultImpulsaConfig(ORG_ID),
      nowIso: NOW_ISO,
    });

    const categories = new Set(res.opportunities.map((o) => o.category));
    expect(categories.has('RENOVACION_ANTICIPADA')).toBe(true);
    expect(categories.has('EXCELENTE_COMPORTAMIENTO')).toBe(true);
    expect(categories.has('CRECIMIENTO_CREDITICIO')).toBe(true);
    expect(categories.has('PAGO_ANTICIPADO')).toBe(true);
    expect(categories.has('NUEVO_PRODUCTO')).toBe(true);

    // Verify Growth respects policy and capacity
    const growth = res.opportunities.find((o) => o.category === 'CRECIMIENTO_CREDITICIO')!;
    expect(growth.suggestedAmount).toBeGreaterThan(100000);
    expect(growth.policyCompliant).toBe(true);
    expect(growth.assignedOfficerId).toBe('usr_off_1');

    // Verify anti-duplication on second run
    const res2 = detectImpulsaOpportunities({
      organizationId: ORG_ID,
      customers: [cust],
      businesses: [biz],
      loans: [loan],
      loanInstallments: installments,
      payments: [],
      applications: [app],
      collectionAccounts: [acc],
      riskAlerts: [],
      policy: TEST_POLICY,
      users: STAFF_USERS,
      existingOpportunities: res.opportunities,
      config: buildDefaultImpulsaConfig(ORG_ID),
      nowIso: NOW_ISO,
    });
    expect(res2.created.length).toBe(0);
    expect(res2.opportunities.length).toBe(res.opportunities.length);
  });

  it('detects Inactive Former Client and Responsible Refinancing while blocking chronic default & critical Centinela alerts', () => {
    const inactiveCust = makeCustomer('cust_2', 'Pedro', 'Gómez');
    const refiCust = makeCustomer('cust_3', 'Ana', 'Pérez');
    const blockedCust = makeCustomer('cust_4', 'Luis', 'Riesgo');

    const closedLoan: LoanRecord = {
      id: 'loan_closed',
      organizationId: ORG_ID,
      loanNumber: 'PR-2025-999',
      applicationId: 'app_2',
      disbursementId: 'disb_2',
      customerId: inactiveCust.id,
      applicantDisplayName: 'Pedro Gómez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 60000,
      financedExpenses: 0,
      totalFinancedPrincipal: 60000,
      currentPrincipalBalance: 0,
      contractualRateMonthly: 0.04,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2025-06-01',
      firstPaymentDate: '2025-07-01',
      maturityDate: '2026-06-01',
      totalContractualInterest: 16000,
      totalContractualPayable: 76000,
      status: 'PAGADO',
      paidPrincipalTotal: 60000,
      closedAt: '2026-06-01',
      createdBy: 'usr_off_2',
    };

    const refiLoan: LoanRecord = {
      id: 'loan_refi',
      organizationId: ORG_ID,
      loanNumber: 'PR-2026-200',
      applicationId: 'app_3',
      disbursementId: 'disb_3',
      customerId: refiCust.id,
      applicantDisplayName: 'Ana Pérez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 120000,
      financedExpenses: 0,
      totalFinancedPrincipal: 120000,
      currentPrincipalBalance: 72000,
      contractualRateMonthly: 0.04,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-03-01',
      firstPaymentDate: '2026-04-01',
      maturityDate: '2027-03-01',
      totalContractualInterest: 32000,
      totalContractualPayable: 152000,
      status: 'VENCIDO',
      paidPrincipalTotal: 48000,
      createdBy: 'usr_off_1',
    };

    const blockedLoan: LoanRecord = {
      ...refiLoan,
      id: 'loan_blocked',
      loanNumber: 'PR-2026-404',
      customerId: blockedCust.id,
      applicantDisplayName: 'Luis Riesgo',
      currentPrincipalBalance: 20000,
      paidPrincipalTotal: 100000,
      status: 'ACTIVO',
    };

    const refiAcc: CollectionAccountRecord = {
      id: refiLoan.id,
      organizationId: ORG_ID,
      loanId: refiLoan.id,
      loanNumber: refiLoan.loanNumber,
      applicationId: 'app_3',
      customerId: refiCust.id,
      applicantDisplayName: 'Ana Pérez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      dpd: 18,
      maxHistoricalDpd: 18,
      stage: 'INTERMEDIA',
      bucket: '16_30',
      priority: 'ALTA',
      priorityScore: 70,
      priorityReasons: [],
      overdueInstallmentsCount: 1,
      totalInstallmentsCount: 12,
      paidInstallmentsCount: 5,
      overduePrincipal: 10000,
      overdueInterest: 3000,
      overdueLateFee: 500,
      overdueCharges: 0,
      overdueTotalAmount: 13500,
      totalOutstandingPrincipal: 72000,
      pendingVerificationAmount: 0,
      brokenPromisesCount: 0,
      behaviorScore: 68,
      behaviorBand: 'ATENCION',
      consentWhatsAppOptIn: true,
    };

    const blockedAcc: CollectionAccountRecord = {
      ...refiAcc,
      id: blockedLoan.id,
      loanId: blockedLoan.id,
      loanNumber: blockedLoan.loanNumber,
      customerId: blockedCust.id,
      applicantDisplayName: 'Luis Riesgo',
      dpd: 0,
      maxHistoricalDpd: 0,
      stage: 'AL_DIA',
      bucket: 'AL_DIA',
    };

    const criticalCentinela: RiskAlertRecord = {
      id: 'alert_crit_1',
      organizationId: ORG_ID,
      loanId: blockedLoan.id,
      loanNumber: blockedLoan.loanNumber,
      customerId: blockedCust.id,
      customerName: 'Luis Riesgo',
      ruleCode: 'RECLAMACION_ABIERTA_URGENTE',
      severity: 'CRITICA',
      title: 'Reclamación crítica abierta',
      description: 'Caso bajo investigación de riesgo',
      metricValue: 'CRITICA',
      status: 'ACTIVA',
    };

    const refiApp: ApplicationRecord = {
      id: 'app_3',
      organizationId: ORG_ID,
      applicationNumber: 'SOL-2026-300',
      fileNumber: 'EXP-2026-300',
      channel: 'INTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: refiCust.id,
      applicantDisplayName: 'Ana Pérez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 120000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      financialData: {
        incomeCurrency: 'DOP',
        primaryNetIncome: 70000,
        essentialExpenses: 25000,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        currentDebtPayments: 0,
      },
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'DESEMBOLSADA',
      latestScore: 76,
      createdBy: 'usr_off_1',
    };

    const res = detectImpulsaOpportunities({
      organizationId: ORG_ID,
      customers: [inactiveCust, refiCust, blockedCust],
      businesses: [],
      loans: [closedLoan, refiLoan, blockedLoan],
      loanInstallments: [],
      payments: [] as PaymentRecord[],
      applications: [refiApp],
      collectionAccounts: [refiAcc, blockedAcc],
      riskAlerts: [criticalCentinela],
      policy: TEST_POLICY,
      users: STAFF_USERS,
      existingOpportunities: [],
      config: buildDefaultImpulsaConfig(ORG_ID),
      nowIso: NOW_ISO,
    });

    expect(
      res.opportunities.some(
        (o) => o.customerId === inactiveCust.id && o.category === 'CLIENTE_INACTIVO'
      )
    ).toBe(true);

    expect(
      res.opportunities.some(
        (o) => o.customerId === refiCust.id && o.category === 'REFINANCIAMIENTO_RESPONSABLE'
      )
    ).toBe(true);

    // Blocked customer with critical Centinela alert must NOT receive commercial offers
    expect(res.opportunities.some((o) => o.customerId === blockedCust.id)).toBe(false);
    expect(res.skippedByRiskCount).toBeGreaterThanOrEqual(1);
  });

  it('auto-reconciles linked application status to DESEMBOLSADA and calculates truthful commercial metrics & alerts', () => {
    const cust = makeCustomer('cust_5', 'Sofía', 'Castro');
    const cfg = buildDefaultImpulsaConfig(ORG_ID);
    const prevOpp = {
      ...detectImpulsaOpportunities({
        organizationId: ORG_ID,
        customers: [cust],
        businesses: [],
        loans: [
          {
            id: 'loan_5',
            organizationId: ORG_ID,
            loanNumber: 'PR-2025-500',
            applicationId: 'app_old_5',
            disbursementId: 'disb_old_5',
            customerId: cust.id,
            applicantDisplayName: 'Sofía Castro',
            productCode: 'PERSONAL_DOP',
            currency: 'DOP',
            approvedPrincipal: 50000,
            financedExpenses: 0,
            totalFinancedPrincipal: 50000,
            currentPrincipalBalance: 0,
            contractualRateMonthly: 0.04,
            termMonths: 12,
            frequency: 'MENSUAL',
            amortizationMethod: 'SALDO_INSOLUTO',
            disbursementDate: '2025-05-01',
            firstPaymentDate: '2025-06-01',
            maturityDate: '2026-05-01',
            totalContractualInterest: 14000,
            totalContractualPayable: 64000,
            status: 'PAGADO',
            paidPrincipalTotal: 50000,
            closedAt: '2026-05-01',
            createdBy: 'usr_off_1',
          },
        ],
        loanInstallments: [],
        payments: [],
        applications: [],
        collectionAccounts: [],
        riskAlerts: [],
        policy: TEST_POLICY,
        users: STAFF_USERS,
        existingOpportunities: [],
        config: cfg,
        nowIso: '2026-11-18T10:00:00.000Z',
      }).opportunities[0],
      status: 'CONVERTIDA_SOLICITUD' as const,
      linkedApplicationId: 'app_new_5',
      linkedApplicationNumber: 'SOL-2026-505',
      nextFollowUpDate: '2026-11-20',
    };

    const disbursedApp: ApplicationRecord = {
      id: 'app_new_5',
      organizationId: ORG_ID,
      applicationNumber: 'SOL-2026-505',
      fileNumber: 'EXP-2026-505',
      channel: 'INTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: cust.id,
      applicantDisplayName: 'Sofía Castro',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 75000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      financialData: { incomeCurrency: 'DOP', debtDeclarationStatus: 'NO_DEBTS_EXPLICIT' },
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'DESEMBOLSADA',
      createdBy: 'usr_off_1',
    };

    const newLoan: LoanRecord = {
      id: 'loan_new_5',
      organizationId: ORG_ID,
      loanNumber: 'PR-2026-505',
      applicationId: 'app_new_5',
      disbursementId: 'disb_new_5',
      customerId: cust.id,
      applicantDisplayName: 'Sofía Castro',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 75000,
      financedExpenses: 0,
      totalFinancedPrincipal: 75000,
      currentPrincipalBalance: 75000,
      contractualRateMonthly: 0.04,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-11-22',
      firstPaymentDate: '2026-12-22',
      maturityDate: '2027-11-22',
      totalContractualInterest: 20000,
      totalContractualPayable: 95000,
      status: 'ACTIVO',
      createdBy: 'usr_off_1',
    };

    const reconciled = detectImpulsaOpportunities({
      organizationId: ORG_ID,
      customers: [cust],
      businesses: [],
      loans: [newLoan],
      loanInstallments: [],
      payments: [],
      applications: [disbursedApp],
      collectionAccounts: [],
      riskAlerts: [],
      policy: TEST_POLICY,
      users: STAFF_USERS,
      existingOpportunities: [prevOpp],
      config: cfg,
      nowIso: NOW_ISO,
    });

    const syncedOpp = reconciled.opportunities.find((o) => o.id === prevOpp.id)!;
    expect(syncedOpp.status).toBe('DESEMBOLSADA');
    expect(syncedOpp.linkedLoanNumber).toBe('PR-2026-505');
    expect(syncedOpp.disbursedAmount).toBe(75000);

    const { metrics, charts } = computeImpulsaCommercialMetrics({
      opportunities: reconciled.opportunities,
      loans: [newLoan],
      applications: [disbursedApp],
      nowIso: NOW_ISO,
    });
    expect(metrics.disbursedCredits).toBe(1);
    expect(metrics.disbursedAmountDop).toBe(75000);
    expect(metrics.conversionRatePct).toBeGreaterThan(0);

    const alerts = computeImpulsaInternalAlerts([prevOpp], cfg, NOW_ISO);
    expect(alerts.some((a) => a.type === 'SEGUIMIENTO_HOY_O_VENCIDO')).toBe(true);

    const qRes = runDeterministicImpulsaQuery({
      question: '¿Cómo va la conversión por oficial?',
      opportunities: reconciled.opportunities,
      metrics,
      charts,
      alerts,
    });
    expect(qRes.content).toContain('conversión comercial');
  });

  it('maps Impulsa statuses to explicit 4-stage lifecycle macro stages cleanly', () => {
    expect(getLifecycleMacroStage('DETECTADA')).toBe('DETECTADA');
    expect(getLifecycleMacroStage('PENDIENTE_ASIGNACION')).toBe('DETECTADA');
    expect(getLifecycleMacroStage('ASIGNADA')).toBe('ASIGNADA');
    expect(getLifecycleMacroStage('PENDIENTE_CONTACTO')).toBe('ASIGNADA');
    expect(getLifecycleMacroStage('REPROGRAMADA')).toBe('ASIGNADA');
    expect(getLifecycleMacroStage('CONTACTADA')).toBe('CONTACTADA');
    expect(getLifecycleMacroStage('CLIENTE_INTERESADO')).toBe('CONTACTADA');
    expect(getLifecycleMacroStage('PENDIENTE_DOCUMENTACION')).toBe('CONTACTADA');
    expect(getLifecycleMacroStage('CONVERTIDA_SOLICITUD')).toBe('CONVERTIDA');
    expect(getLifecycleMacroStage('EN_EVALUACION')).toBe('CONVERTIDA');
    expect(getLifecycleMacroStage('APROBADA')).toBe('CONVERTIDA');
    expect(getLifecycleMacroStage('DESEMBOLSADA')).toBe('CONVERTIDA');
    expect(getLifecycleMacroStage('DESCARTADA')).toBe('CERRADA');
    expect(getLifecycleMacroStage('NO_INTERESADO')).toBe('CERRADA');
  });

  it('reflects institutional phone number alongside RNC in payment receipts and payoff quotes', () => {
    const viewData = buildPaymentReceiptViewData({
      receipt: {
        id: 'rec_1',
        organizationId: ORG_ID,
        receiptNumber: 'REC-2026-0001',
        paymentId: 'pay_1',
        loanId: 'loan_1',
        loanNumber: 'PR-2026-001',
        customerId: 'cust_1',
        customerName: 'Juan Pérez',
        currency: 'DOP',
        amount: 6250,
        paymentDate: '2026-11-23',
        referenceNumber: 'REF-001',
        appliedToPrincipal: 5000,
        appliedToInterest: 1250,
        appliedToLateFee: 0,
        appliedToCharges: 0,
        remainingPrincipalAfter: 15000,
        issuedBy: 'usr_off_1',
        issuedByName: 'María Comercial',
        issuedAt: NOW_ISO,
        status: 'EMITIDO',
      },
      organization: {
        id: ORG_ID,
        name: 'Su Gloria Mano Amiga',
        taxId: '131-98765-4',
        phone: '809-555-0199',
        primaryColor: '#0B1220',
        accentColor: '#2563EB',
      },
    });

    expect(viewData.institutionPhone).toBe('809-555-0199');
    expect(viewData.institutionSubtitle).toContain('RNC: 131-98765-4');
    expect(viewData.institutionSubtitle).toContain('Tel.: 809-555-0199');

    const quote = buildPayoffQuoteMessage({
      plan: {
        loanId: 'loan_1',
        loanNumber: 'PR-2026-001',
        applicantDisplayName: 'Juan Pérez',
        currency: 'DOP',
        asOfDateIso: '2026-11-23',
        mode: 'FULL_PAYOFF',
        remainingPrincipal: 15000,
        remainingInterest: 1000,
        remainingCharges: 0,
        remainingLateFee: 0,
        totalOwed: 16000,
        discountAmount: 0,
        discountPercent: 0,
        finalPayoffAmount: 16000,
        allocatedToPrincipal: 15000,
        allocatedToInterest: 1000,
        allocatedToCharges: 0,
        allocatedToLateFee: 0,
        waivedLateFeeInSettlement: 0,
        nextPaidPrincipalTotal: 15000,
        nextPaidInterestTotal: 1000,
        nextPaidLateFeeTotal: 0,
        nextWaivedLateFeeTotal: 0,
        installmentUpdates: [],
      },
      organizationName: 'Su Gloria Mano Amiga',
      organizationPhone: '809-555-0199',
      formatCurrency: (val) => `RD$${val.toFixed(2)}`,
    });

    expect(quote).toContain('Teléfono institucional: 809-555-0199');
  });
});
