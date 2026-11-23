import { describe, expect, it } from 'vitest';
import {
  ACTIVE_IN_FLIGHT_RENEWAL_STATUSES,
  buildCustomerRenewalChains,
  buildRenewalAccountingJournalEntry,
  calculateRenewalNetDisbursement,
  computeRenewalExecutiveMetrics,
  computeRenewalPayoffBreakdown,
  evaluateLoanRenewalEligibility,
  isRenewalTransitionAllowed,
} from '../engine/renewalEngine';
import { canExecuteDisbursement } from '../engine/workflowGuards';
import { isClosedLoanStatus } from '../utils/formatters';
import type {
  CreditRenewalRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
} from '../types/axycore';

const ORG_ID = 'org_axycore_main';

function makeCustomer(): CustomerRecord {
  return {
    id: 'cust_001',
    organizationId: ORG_ID,
    firstName: 'María',
    lastName: 'Rodríguez',
    documentType: 'CEDULA',
    documentNumber: '001-1234567-8',
    documentKey: 'CEDULA:00112345678',
    phone: '809-555-0101',
    email: 'maria@example.com',
    address: 'Av. Winston Churchill #45',
    municipality: 'Distrito Nacional',
    province: 'Santo Domingo',
    housingType: 'PROPIA',
    residenceMonths: 60,
    createdBy: 'officer_1',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  };
}

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_001',
    organizationId: ORG_ID,
    loanNumber: 'PRE-001',
    applicationId: 'app_001',
    disbursementId: 'disb_001',
    customerId: 'cust_001',
    applicantDisplayName: 'María Rodríguez',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 35000,
    contractualRateMonthly: 0.035,
    termMonths: 12,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-15',
    firstPaymentDate: '2026-02-15',
    maturityDate: '2027-01-15',
    totalContractualInterest: 24000,
    totalContractualPayable: 124000,
    paidPrincipalTotal: 65000,
    paidInterestTotal: 18000,
    paidLateFeeTotal: 0,
    status: 'ACTIVO',
    createdBy: 'officer_1',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-09-15T10:00:00Z',
    ...overrides,
  };
}

function makeOriginInstallmentsWithPayoff35k(loanId = 'loan_001'): LoanInstallmentRecord[] {
  return [
    {
      id: `${loanId}_1`,
      organizationId: ORG_ID,
      loanId,
      installmentNumber: 1,
      dueDate: '2026-02-15',
      principalAmount: 65000,
      interestAmount: 18000,
      otherCharges: 0,
      totalAmount: 83000,
      remainingPrincipalBalance: 35000,
      paidPrincipal: 65000,
      paidInterest: 18000,
      paidOtherCharges: 0,
      paidLateFee: 0,
      status: 'PAGADA',
    },
    {
      id: `${loanId}_2`,
      organizationId: ORG_ID,
      loanId,
      installmentNumber: 2,
      dueDate: '2026-12-15',
      principalAmount: 35000,
      interestAmount: 0,
      otherCharges: 0,
      totalAmount: 35000,
      remainingPrincipalBalance: 0,
      paidPrincipal: 0,
      paidInterest: 0,
      paidOtherCharges: 0,
      paidLateFee: 0,
      status: 'PENDIENTE',
    },
  ];
}

function makeRenewalRecord(overrides: Partial<CreditRenewalRecord> = {}): CreditRenewalRecord {
  const basePayoff = {
    asOfDateIso: '2026-10-15',
    remainingPrincipal: 35000,
    remainingInterest: 0,
    remainingCharges: 0,
    remainingLateFee: 0,
    adjustmentsAmount: 0,
    totalPayoffAmount: 35000,
    unpaidInstallmentsCount: 1,
    overdueInstallmentsCount: 0,
    totalInstallmentsCount: 2,
    dpd: 0,
    paidPrincipalTotal: 65000,
    paidInterestTotal: 18000,
    paidLateFeeTotal: 0,
    paymentsCount: 8,
  };
  return {
    id: 'ren_001',
    organizationId: ORG_ID,
    renewalNumber: 'REN-2026-0001',
    customerId: 'cust_001',
    customerName: 'María Rodríguez',
    originLoanId: 'loan_001',
    originLoanNumber: 'PRE-001',
    originProductCode: 'PERSONAL_DOP',
    originCurrency: 'DOP',
    originAmount: 100000,
    originRateMonthly: 0.035,
    originTermMonths: 12,
    originFrequency: 'MENSUAL',
    originAmortizationMethod: 'SALDO_INSOLUTO',
    currency: 'DOP',
    applicationId: 'app_ren_001',
    applicationNumber: 'SOL-REN-0001',
    modality: 'MISMAS_CONDICIONES',
    status: 'PENDIENTE_COMITE',
    requestedAmount: 100000,
    requestedTermMonths: 12,
    requestedFrequency: 'MENSUAL',
    requestedRateMonthly: 0.035,
    requestedAmortizationMethod: 'SALDO_INSOLUTO',
    originConditions: {
      productCode: 'PERSONAL_DOP',
      principal: 100000,
      rateMonthly: 0.035,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      installmentAmount: 10300,
    },
    requestedConditions: {
      productCode: 'PERSONAL_DOP',
      amount: 100000,
      rateMonthly: 0.035,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      installmentAmount: 10300,
    },
    payoffSnapshot: basePayoff,
    initialPayoffBreakdown: basePayoff,
    netDisbursementAmount: 65000,
    initiatedBy: 'officer_1',
    initiatedByName: 'Carlos Méndez',
    idempotencyKey: 'idem_ren_001',
    createdAt: '2026-10-15T10:00:00Z',
    updatedAt: '2026-10-15T10:00:00Z',
    ...overrides,
  };
}

describe('Sistema Integral de Renovaciones y Reenganche de Créditos – AxyCore (7 Pruebas Obligatorias)', () => {
  it('PRUEBA 1: Renovación con las mismas condiciones (RD$100k, saldo RD$35k -> directo a Comité, neto RD$65k, asiento cuadrado)', () => {
    const customer = makeCustomer();
    const originLoan = makeLoan();
    const installments = makeOriginInstallmentsWithPayoff35k(originLoan.id);

    const { breakdown } = computeRenewalPayoffBreakdown({
      loan: originLoan,
      installments,
      customer,
      asOfDateIso: '2026-10-15',
    });
    expect(breakdown.remainingPrincipal).toBe(35000);
    expect(breakdown.totalPayoffAmount).toBe(35000);

    const eligibility = evaluateLoanRenewalEligibility({
      loan: originLoan,
      installments,
      customer,
      existingRenewals: [],
      existingApplications: [],
      asOfDateIso: '2026-10-15',
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.blockingReasons).toHaveLength(0);

    // MISMAS_CONDICIONES goes straight from RENOVACION_INICIADA -> PENDIENTE_COMITE (skips ordinary Evaluation)
    expect(
      isRenewalTransitionAllowed({
        from: 'RENOVACION_INICIADA',
        to: 'PENDIENTE_COMITE',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);
    expect(
      isRenewalTransitionAllowed({
        from: 'PENDIENTE_COMITE',
        to: 'APROBADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);
    expect(
      isRenewalTransitionAllowed({
        from: 'APROBADA',
        to: 'PENDIENTE_FORMALIZACION',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);
    expect(
      isRenewalTransitionAllowed({
        from: 'PENDIENTE_FORMALIZACION',
        to: 'PENDIENTE_DESEMBOLSO',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);
    expect(
      isRenewalTransitionAllowed({
        from: 'PENDIENTE_DESEMBOLSO',
        to: 'DESEMBOLSADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);

    // Net disbursement calculation: 100,000 - 35,000 - 0 = 65,000
    const netCalc = calculateRenewalNetDisbursement({
      grossApprovedAmount: 100000,
      payoffAmount: 35000,
      otherAuthorizedDiscounts: 0,
    });
    expect(netCalc.valid).toBe(true);
    expect(netCalc.netDisbursementAmount).toBe(65000);

    // Disbursement guard approves execution
    const guard = canExecuteDisbursement({
      userRole: 'FINANCE',
      application: { status: 'FORMALIZADA', isRenewal: true },
      decision: { decision: 'APROBADO', approvedAmount: 100000, conditionsFulfilled: true },
      formalization: {
        status: 'LISTA_PARA_DESEMBOLSO',
        approvedCapital: 100000,
        deductedExpenses: 0,
        netDisbursementAmount: 65000,
        legalReviewConfirmed: true,
        conditionsFulfilled: true,
        requiredDocsChecklist: [{ key: 'PAGARE', label: 'Pagaré', completed: true }],
        isRenewal: true,
        renewalPayoffAmount: 35000,
      },
      existingDisbursementId: null,
      liveRenewalPayoffAmount: 35000,
    });
    expect(guard.allowed).toBe(true);

    // Double-entry accounting journal entry strictly balanced
    const entry = buildRenewalAccountingJournalEntry({
      entryId: 'je_ren_001',
      organizationId: ORG_ID,
      entryDate: '2026-10-15',
      currency: 'DOP',
      renewalNumber: 'REN-2026-0001',
      originLoanNumber: 'PRE-001',
      targetLoanNumber: 'PRE-002',
      disbursementId: 'disb_002',
      disbursementNumber: 'DES-2026-0002',
      customerName: 'María Rodríguez',
      totalFinancedNewLoan: 100000,
      financedExpenses: 0,
      deductedExpenses: 0,
      settledPrincipal: 35000,
      settledInterest: 0,
      settledLateFee: 0,
      settledCharges: 0,
      netDisbursementDelivered: 65000,
      idempotencyKey: 'idem_001',
      userId: 'fin_01',
      userName: 'Tesorero',
    });
    expect(entry.totalDebit).toBe(100000);
    expect(entry.totalCredit).toBe(100000);
    expect(entry.lines.find((l) => l.accountCode === '1201' && l.debit > 0)?.debit).toBe(100000);
    expect(entry.lines.find((l) => l.accountCode === '1201' && l.credit > 0)?.credit).toBe(35000);
    expect(entry.lines.find((l) => l.accountCode === '1102' && l.credit > 0)?.credit).toBe(65000);
  });

  it('PRUEBA 2: Renovación con aumento o modificación (RD$100k -> RD$150k, saldo RD$35k -> exige Evaluación, neto RD$115k)', () => {
    // Direct skip to Committee MUST be blocked for AUMENTO_O_MODIFICACION
    const directToCommittee = isRenewalTransitionAllowed({
      from: 'RENOVACION_INICIADA',
      to: 'PENDIENTE_COMITE',
      modality: 'AUMENTO_O_MODIFICACION',
    });
    expect(directToCommittee.allowed).toBe(false);
    expect(directToCommittee.reason).toContain('Evaluación');

    // Authorized full sequence: Iniciada -> Pendiente Eval -> En Eval -> Pendiente Comité -> Aprobada -> Formalización -> Desembolso -> Desembolsada
    const steps: Array<[CreditRenewalRecord['status'], CreditRenewalRecord['status']]> = [
      ['RENOVACION_INICIADA', 'PENDIENTE_EVALUACION'],
      ['PENDIENTE_EVALUACION', 'EN_EVALUACION'],
      ['EN_EVALUACION', 'PENDIENTE_COMITE'],
      ['PENDIENTE_COMITE', 'APROBADA'],
      ['APROBADA', 'PENDIENTE_FORMALIZACION'],
      ['PENDIENTE_FORMALIZACION', 'PENDIENTE_DESEMBOLSO'],
      ['PENDIENTE_DESEMBOLSO', 'DESEMBOLSADA'],
    ];
    for (const [from, to] of steps) {
      expect(
        isRenewalTransitionAllowed({ from, to, modality: 'AUMENTO_O_MODIFICACION' }).allowed
      ).toBe(true);
    }

    const netCalc = calculateRenewalNetDisbursement({
      grossApprovedAmount: 150000,
      payoffAmount: 35000,
      otherAuthorizedDiscounts: 0,
    });
    expect(netCalc.valid).toBe(true);
    expect(netCalc.netDisbursementAmount).toBe(115000);

    const entry = buildRenewalAccountingJournalEntry({
      entryId: 'je_ren_002',
      organizationId: ORG_ID,
      entryDate: '2026-10-16',
      currency: 'DOP',
      renewalNumber: 'REN-2026-0002',
      originLoanNumber: 'PRE-001',
      targetLoanNumber: 'PRE-002',
      disbursementId: 'disb_003',
      disbursementNumber: 'DES-2026-0003',
      customerName: 'María Rodríguez',
      totalFinancedNewLoan: 150000,
      financedExpenses: 0,
      deductedExpenses: 0,
      settledPrincipal: 35000,
      settledInterest: 0,
      settledLateFee: 0,
      settledCharges: 0,
      netDisbursementDelivered: 115000,
      idempotencyKey: 'idem_002',
      userId: 'fin_01',
      userName: 'Tesorero',
    });
    expect(entry.totalDebit).toBe(150000);
    expect(entry.totalCredit).toBe(150000);
    expect(entry.lines.find((l) => l.accountCode === '1102')?.credit).toBe(115000);
  });

  it('PRUEBA 3: Rechazo en Comité deja préstamo anterior intacto (ACTIVO) y bloquea desembolso', () => {
    expect(
      isRenewalTransitionAllowed({
        from: 'PENDIENTE_COMITE',
        to: 'RECHAZADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);

    // Terminal state: cannot transition out of RECHAZADA
    expect(
      isRenewalTransitionAllowed({
        from: 'RECHAZADA',
        to: 'APROBADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(false);
    expect(
      isRenewalTransitionAllowed({
        from: 'RECHAZADA',
        to: 'DESEMBOLSADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(false);

    // Disbursement blocked on RECHAZADO decision
    const disbGuard = canExecuteDisbursement({
      userRole: 'FINANCE',
      application: { status: 'RECHAZADA', isRenewal: true },
      decision: { decision: 'RECHAZADO', approvedAmount: null, conditionsFulfilled: false },
      formalization: null,
      existingDisbursementId: null,
    });
    expect(disbGuard.allowed).toBe(false);

    // Origin loan remains ACTIVO with full balance and can later start a fresh renewal once rejected
    const originLoan = makeLoan({ status: 'ACTIVO', currentPrincipalBalance: 35000 });
    expect(isClosedLoanStatus(originLoan.status)).toBe(false);
    const rejectedRenewal = makeRenewalRecord({ status: 'RECHAZADA' });
    expect(ACTIVE_IN_FLIGHT_RENEWAL_STATUSES.has('RECHAZADA')).toBe(false);

    const eligAfterReject = evaluateLoanRenewalEligibility({
      loan: originLoan,
      installments: makeOriginInstallmentsWithPayoff35k(originLoan.id),
      existingRenewals: [rejectedRenewal],
      asOfDateIso: '2026-10-15',
    });
    expect(eligAfterReject.eligible).toBe(true);
  });

  it('PRUEBA 4: Error durante el desembolso registra ERROR_EJECUCION sin cancelar préstamo origen y permite reintento seguro', () => {
    expect(
      isRenewalTransitionAllowed({
        from: 'PENDIENTE_DESEMBOLSO',
        to: 'ERROR_EJECUCION',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);

    // Retry allowed after fixing the root cause
    expect(
      isRenewalTransitionAllowed({
        from: 'ERROR_EJECUCION',
        to: 'PENDIENTE_DESEMBOLSO',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);
    expect(
      isRenewalTransitionAllowed({
        from: 'ERROR_EJECUCION',
        to: 'DESEMBOLSADA',
        modality: 'MISMAS_CONDICIONES',
      }).allowed
    ).toBe(true);

    // While in ERROR_EJECUCION, concurrency protection prevents opening a second overlapping renewal
    expect(ACTIVE_IN_FLIGHT_RENEWAL_STATUSES.has('ERROR_EJECUCION')).toBe(true);
    const originLoan = makeLoan({ status: 'ACTIVO', currentPrincipalBalance: 35000 });
    const erroredRenewal = makeRenewalRecord({
      status: 'ERROR_EJECUCION',
      errorMessage: 'Fallo de red simulado durante transacción',
    });
    const eligDuringError = evaluateLoanRenewalEligibility({
      loan: originLoan,
      installments: makeOriginInstallmentsWithPayoff35k(originLoan.id),
      existingRenewals: [erroredRenewal],
      asOfDateIso: '2026-10-15',
    });
    expect(eligDuringError.eligible).toBe(false);
    expect(eligDuringError.blockingReasons[0]).toContain('ERROR_EJECUCION');
  });

  it('PRUEBA 5: Bloqueo estricto por saldo insuficiente (neto <= 0) en cálculo financiero y en guardia de desembolso', () => {
    // Negative net: 100,000 - 90,000 - 15,000 = -5,000
    const negCalc = calculateRenewalNetDisbursement({
      grossApprovedAmount: 100000,
      payoffAmount: 90000,
      otherAuthorizedDiscounts: 15000,
    });
    expect(negCalc.valid).toBe(false);
    expect(negCalc.netDisbursementAmount).toBe(-5000);
    expect(negCalc.reason).toContain('Desembolso bloqueado');

    // Exact zero net: 100,000 - 100,000 = 0 (also blocked)
    const zeroCalc = calculateRenewalNetDisbursement({
      grossApprovedAmount: 100000,
      payoffAmount: 100000,
      otherAuthorizedDiscounts: 0,
    });
    expect(zeroCalc.valid).toBe(false);
    expect(zeroCalc.netDisbursementAmount).toBe(0);

    // Disbursement guard blocks even if formalization had stale payoff but live payoff increased
    const guardLiveBlocked = canExecuteDisbursement({
      userRole: 'FINANCE',
      application: { status: 'FORMALIZADA', isRenewal: true },
      decision: { decision: 'APROBADO', approvedAmount: 100000, conditionsFulfilled: true },
      formalization: {
        status: 'LISTA_PARA_DESEMBOLSO',
        approvedCapital: 100000,
        deductedExpenses: 5000,
        netDisbursementAmount: 15000,
        legalReviewConfirmed: true,
        conditionsFulfilled: true,
        requiredDocsChecklist: [{ key: 'PAGARE', label: 'Pagaré', completed: true }],
        isRenewal: true,
        renewalPayoffAmount: 80000,
      },
      existingDisbursementId: null,
      liveRenewalPayoffAmount: 96000, // 100,000 - 96,000 - 5,000 = -1,000
    });
    expect(guardLiveBlocked.allowed).toBe(false);
    expect(guardLiveBlocked.reason).toContain('Bloqueo de renovación');
  });

  it('PRUEBA 6: Prevención de duplicidad, concurrencia e idempotencia de desembolso', () => {
    const originLoan = makeLoan();
    const installments = makeOriginInstallmentsWithPayoff35k(originLoan.id);
    const activeRenewal = makeRenewalRecord({ status: 'PENDIENTE_COMITE' });

    // Second concurrent renewal on same origin loan MUST be blocked
    const dupEligibility = evaluateLoanRenewalEligibility({
      loan: originLoan,
      installments,
      existingRenewals: [activeRenewal],
      asOfDateIso: '2026-10-15',
    });
    expect(dupEligibility.eligible).toBe(false);
    expect(dupEligibility.blockingReasons[0]).toContain('No se permiten dos renovaciones simultáneas');

    // Already closed loan (CANCELADO_POR_RENOVACION) MUST be blocked
    const closedLoan = makeLoan({
      status: 'CANCELADO_POR_RENOVACION',
      currentPrincipalBalance: 0,
      renewedToLoanId: 'loan_002',
      renewedToLoanNumber: 'PRE-002',
    });
    expect(isClosedLoanStatus(closedLoan.status)).toBe(true);
    const closedEligibility = evaluateLoanRenewalEligibility({
      loan: closedLoan,
      installments,
      asOfDateIso: '2026-10-15',
    });
    expect(closedEligibility.eligible).toBe(false);
    expect(closedEligibility.blockingReasons.length).toBeGreaterThanOrEqual(2);

    // Duplicate disbursement blocked by idempotency guard
    const dupDisb = canExecuteDisbursement({
      userRole: 'FINANCE',
      application: { status: 'FORMALIZADA', isRenewal: true },
      decision: { decision: 'APROBADO', approvedAmount: 100000, conditionsFulfilled: true },
      formalization: {
        status: 'LISTA_PARA_DESEMBOLSO',
        approvedCapital: 100000,
        deductedExpenses: 0,
        netDisbursementAmount: 65000,
        legalReviewConfirmed: true,
        conditionsFulfilled: true,
        requiredDocsChecklist: [{ key: 'PAGARE', label: 'Pagaré', completed: true }],
        isRenewal: true,
        renewalPayoffAmount: 35000,
      },
      existingDisbursementId: 'disb_existing_001',
      liveRenewalPayoffAmount: 35000,
    });
    expect(dupDisb.allowed).toBe(false);
    expect(dupDisb.reason).toContain('idempotencia');
  });

  it('PRUEBA 7: Cadena Histórica (PRE-001 -> PRE-002 -> PRE-003) y Reporte Gerencial con separación contable exacta', () => {
    const loan1 = makeLoan({
      id: 'loan_001',
      loanNumber: 'PRE-001',
      status: 'CANCELADO_POR_RENOVACION',
      currentPrincipalBalance: 0,
      disbursementDate: '2026-01-15',
      renewedToLoanId: 'loan_002',
      renewedToLoanNumber: 'PRE-002',
      renewalPayoffAmount: 35000,
    });
    const loan2 = makeLoan({
      id: 'loan_002',
      loanNumber: 'PRE-002',
      status: 'CANCELADO_POR_RENOVACION',
      approvedPrincipal: 100000,
      totalFinancedPrincipal: 100000,
      currentPrincipalBalance: 0,
      disbursementDate: '2026-06-15',
      isRenewal: true,
      originLoanId: 'loan_001',
      originLoanNumber: 'PRE-001',
      renewedToLoanId: 'loan_003',
      renewedToLoanNumber: 'PRE-003',
      payoffSettledAmount: 35000,
      netDisbursementDelivered: 63000,
    });
    const loan3 = makeLoan({
      id: 'loan_003',
      loanNumber: 'PRE-003',
      status: 'ACTIVO',
      approvedPrincipal: 150000,
      totalFinancedPrincipal: 150000,
      currentPrincipalBalance: 150000,
      disbursementDate: '2026-10-15',
      isRenewal: true,
      originLoanId: 'loan_002',
      originLoanNumber: 'PRE-002',
      payoffSettledAmount: 40000,
      netDisbursementDelivered: 107000,
    });

    const ren1 = makeRenewalRecord({
      id: 'ren_001',
      renewalNumber: 'REN-2026-0001',
      originLoanId: 'loan_001',
      originLoanNumber: 'PRE-001',
      targetLoanId: 'loan_002',
      targetLoanNumber: 'PRE-002',
      modality: 'MISMAS_CONDICIONES',
      status: 'DESEMBOLSADA',
      requestedAmount: 100000,
      approvedAmount: 100000,
      settledPayoffAmount: 35000,
      otherDeductionsAmount: 2000,
      netDisbursementAmount: 63000,
      disbursedAt: '2026-06-15T14:00:00Z',
      initiatedBy: 'off_1',
      initiatedByName: 'Oficial Uno',
    });
    const ren2 = makeRenewalRecord({
      id: 'ren_002',
      renewalNumber: 'REN-2026-0002',
      originLoanId: 'loan_002',
      originLoanNumber: 'PRE-002',
      targetLoanId: 'loan_003',
      targetLoanNumber: 'PRE-003',
      modality: 'AUMENTO_O_MODIFICACION',
      status: 'DESEMBOLSADA',
      requestedAmount: 150000,
      approvedAmount: 150000,
      settledPayoffAmount: 40000,
      otherDeductionsAmount: 3000,
      netDisbursementAmount: 107000,
      disbursedAt: '2026-10-15T14:00:00Z',
      initiatedBy: 'off_2',
      initiatedByName: 'Oficial Dos',
    });
    const ren3Rejected = makeRenewalRecord({
      id: 'ren_003',
      renewalNumber: 'REN-2026-0003',
      originLoanId: 'loan_009',
      originLoanNumber: 'PRE-009',
      modality: 'AUMENTO_O_MODIFICACION',
      status: 'RECHAZADA',
      requestedAmount: 200000,
      createdAt: '2026-10-16T10:00:00Z',
    });
    const ren4Committee = makeRenewalRecord({
      id: 'ren_004',
      renewalNumber: 'REN-2026-0004',
      originLoanId: 'loan_010',
      originLoanNumber: 'PRE-010',
      modality: 'MISMAS_CONDICIONES',
      status: 'PENDIENTE_COMITE',
      requestedAmount: 80000,
      createdAt: '2026-10-17T10:00:00Z',
    });
    const ren5Eval = makeRenewalRecord({
      id: 'ren_005',
      renewalNumber: 'REN-2026-0005',
      originLoanId: 'loan_011',
      originLoanNumber: 'PRE-011',
      modality: 'AUMENTO_O_MODIFICACION',
      status: 'EN_EVALUACION',
      requestedAmount: 120000,
      createdAt: '2026-10-18T10:00:00Z',
    });

    // Historical chain verification
    const chains = buildCustomerRenewalChains({
      customerLoans: [loan3, loan1, loan2], // intentionally unordered input
      customerRenewals: [ren1, ren2],
    });
    expect(chains).toHaveLength(1);
    expect(chains[0].renewalsCount).toBe(2);
    expect(chains[0].nodes.map((n) => n.loanNumber)).toEqual(['PRE-001', 'PRE-002', 'PRE-003']);

    // Executive report metrics (all 15 KPIs + strict separation of Gross / Payoff / Other Discounts / Net New Cash)
    const metrics = computeRenewalExecutiveMetrics({
      renewals: [ren1, ren2, ren3Rejected, ren4Committee, ren5Eval],
      currency: 'DOP',
    });
    expect(metrics.totalInitiated).toBe(5);
    expect(metrics.totalApproved).toBe(2);
    expect(metrics.totalDisbursed).toBe(2);
    expect(metrics.totalRejected).toBe(1);
    expect(metrics.totalPendingCommittee).toBe(1);
    expect(metrics.totalInEvaluation).toBe(1);
    expect(metrics.totalPendingDisbursement).toBe(0);

    // Strict financial separation: NEVER mix Gross vs Payoff vs Net
    expect(metrics.grossRenewedAmount).toBe(250000);
    expect(metrics.totalPriorPayoffSettled).toBe(75000);
    expect(metrics.totalOtherDiscounts).toBe(5000);
    expect(metrics.totalNetNewCashDelivered).toBe(170000);
    expect(metrics.averageNetDisbursement).toBe(85000);
    expect(
      metrics.grossRenewedAmount - metrics.totalPriorPayoffSettled - metrics.totalOtherDiscounts
    ).toBe(metrics.totalNetNewCashDelivered);

    // Modality, officer, product, and period breakdowns
    expect(metrics.modalityBreakdown.mismasCondicionesDisbursed).toBe(1);
    expect(metrics.modalityBreakdown.mismasCondicionesNet).toBe(63000);
    expect(metrics.modalityBreakdown.aumentoDisbursed).toBe(1);
    expect(metrics.modalityBreakdown.aumentoNet).toBe(107000);
    expect(metrics.byProduct).toHaveLength(1);
    expect(metrics.byOfficer.length).toBeGreaterThanOrEqual(2);
    expect(metrics.byPeriod.map((p) => p.period)).toEqual(['2026-10', '2026-06']);
  });
});
