import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  computeLateFeeForInstallment,
  evaluateLoanDelinquency,
} from '../engine/collections/delinquencyEngine';
import {
  buildCobrosDelDiaQueue,
  buildCobrosLegalQueue,
  buildCobrosUrgentesQueue,
  buildDailyCollectionsQueue,
  buildUrgentCollectionsQueue,
  generateAutomatedCollectionTasks,
} from '../engine/collections/priorityAndTasksEngine';
import {
  canApprovePaymentAgreement,
  classifyAgreementsForManagement,
  evaluatePromiseFulfillment,
  validateActionEditAttempt,
  validateContactPermission,
} from '../engine/collections/promisesAndActionsEngine';
import {
  allocatePaymentAcrossInstallments,
  buildBankTxIdempotencyHash,
  buildOfficialReceipt,
  classifyAndMatchBankTransaction,
  computePaymentReversal,
  parseBankStatementText,
} from '../engine/collections/paymentsAndReconciliationEngine';
import {
  buildAnticipateProjections,
  buildAutoAssignmentPlan,
  buildReproducibleDailySnapshot,
  computeContactCenterKpis,
  computeParAndPortfolioMetrics,
  evaluateBotDispatchEligibility,
  processSafeBotConversationTurn,
  reconstructAccountsAtCutoffDate,
  runSentinelAlertScan,
} from '../engine/collections/botAndSentinelEngine';
import { validateLoanCancellationEligibility } from '../engine/collections/botAndSentinelEngine';
import {
  ALL_COBRANZA_SECTIONS,
  canRoleAccessSection,
  hasRolePermission,
} from '../engine/rbac';
import { buildCsvContent } from '../utils/reportExporter';
import type {
  BankTransactionRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionPolicyVersionRecord,
  CustomerDisputeRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  MessageEventRecord,
  MessageTemplateRecord,
  PaymentAgreementRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  ReconciliationExceptionRecord,
  UserProfile,
} from '../types/axycore';

const ORG_ID = 'org_axycore_main';

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_col_1',
    organizationId: ORG_ID,
    documentType: 'CEDULA',
    documentNumber: '00112345678',
    documentKey: `${ORG_ID}_CEDULA_00112345678`,
    firstName: 'María',
    lastName: 'Valdez',
    phone: '8095551122',
    email: 'maria@example.com',
    address: 'Av. 27 de Febrero 44, Santo Domingo',
    province: 'Santo Domingo',
    municipality: 'Distrito Nacional',
    residenceMonths: 36,
    housingType: 'PROPIA',
    housingPayment: 0,
    socialMediaDeclared: 'NO_MEDIA',
    createdBy: 'officer_1',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_col_1',
    organizationId: ORG_ID,
    loanNumber: 'PRE-2026-0001',
    applicationId: 'app_col_1',
    disbursementId: 'app_col_1',
    customerId: 'cust_col_1',
    applicantDisplayName: 'María Valdez',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 100000,
    contractualRateMonthly: 0.04,
    termMonths: 3,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    maturityDate: '2026-04-01',
    totalContractualInterest: 8000,
    totalContractualPayable: 108000,
    paidPrincipalTotal: 0,
    paidInterestTotal: 0,
    paidLateFeeTotal: 0,
    status: 'ACTIVO',
    createdBy: 'ops_1',
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<LoanInstallmentRecord> = {}): LoanInstallmentRecord {
  return {
    id: 'inst_col_1_001',
    organizationId: ORG_ID,
    loanId: 'loan_col_1',
    installmentNumber: 1,
    dueDate: '2026-02-01',
    principalAmount: 32000,
    interestAmount: 4000,
    otherCharges: 0,
    totalAmount: 36000,
    remainingPrincipalBalance: 68000,
    paidPrincipal: 0,
    paidInterest: 0,
    paidOtherCharges: 0,
    accruedLateFee: 0,
    paidLateFee: 0,
    status: 'PENDIENTE',
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 'pay_col_1',
    organizationId: ORG_ID,
    loanId: 'loan_col_1',
    loanNumber: 'PRE-2026-0001',
    customerId: 'cust_col_1',
    customerName: 'María Valdez',
    currency: 'DOP',
    amount: 36000,
    paymentDate: '2026-02-01',
    method: 'TRANSFERENCIA',
    referenceNumber: 'TRF-9001',
    idempotencyKey: 'idem_pay_col_1',
    status: 'REPORTADO',
    reportedByUserId: 'agent_1',
    reportedByName: 'Gestor Uno',
    ...overrides,
  };
}

function makePromise(overrides: Partial<PaymentPromiseRecord> = {}): PaymentPromiseRecord {
  return {
    id: 'prom_col_1',
    organizationId: ORG_ID,
    loanId: 'loan_col_1',
    loanNumber: 'PRE-2026-0001',
    customerId: 'cust_col_1',
    customerName: 'María Valdez',
    currency: 'DOP',
    promisedAmount: 36000,
    promisedDate: '2026-02-10',
    channel: 'LLAMADA',
    status: 'VIGENTE',
    fulfilledAmount: 0,
    fulfilledPaymentIds: [],
    createdByUserId: 'agent_1',
    createdByUserName: 'Gestor Uno',
    createdAt: '2026-02-05T10:00:00Z',
    ...overrides,
  };
}

function makeAction(overrides: Partial<CollectionActionRecord> = {}): CollectionActionRecord {
  return {
    id: 'act_col_1',
    organizationId: ORG_ID,
    loanId: 'loan_col_1',
    loanNumber: 'PRE-2026-0001',
    customerId: 'cust_col_1',
    customerName: 'María Valdez',
    collectorId: 'agent_1',
    collectorName: 'Gestor Uno',
    channel: 'LLAMADA',
    contactResult: 'CONTACTO_EFECTIVO_PROMESA',
    dpdAtAction: 4,
    actionTimeIso: '2026-02-05T14:00:00Z',
    notes: 'Cliente confirma depósito para el viernes.',
    isClosed: true,
    ...overrides,
  };
}

function makeCollectorUser(uid: string, name: string, role: UserProfile['role'] = 'COLLECTION_AGENT'): UserProfile {
  return {
    uid,
    organizationId: ORG_ID,
    email: `${uid}@axycore.local`,
    displayName: name,
    role,
    status: 'ACTIVE',
  };
}

describe('Módulo Integral de Cobranza y Recuperación de Cartera (30 escenarios)', () => {
  it('1. Sincronización sin duplicación desde préstamos desembolsados hacia collection_accounts', () => {
    const loan = makeLoan({ id: 'loan_sync_1', status: 'ACTIVO' });
    const insts = [
      makeInstallment({ id: 'i1', loanId: 'loan_sync_1', installmentNumber: 1, dueDate: '2026-03-01' }),
    ];
    const eval1 = evaluateLoanDelinquency({
      loan,
      installments: insts,
      customer: makeCustomer(),
      asOfDateIso: '2026-02-15',
    });
    expect(eval1.account.id).toBe(loan.id);
    expect(eval1.account.loanId).toBe(loan.id);
    expect(eval1.account.dpd).toBe(0);
    expect(eval1.account.stage).toBe('AL_DIA');
    expect(eval1.derivedLoanStatus).toBe('ACTIVO');
  });

  it('2. Cálculo exacto de DPD, días de gracia y mora devengada', () => {
    const inst = makeInstallment({
      dueDate: '2026-02-01',
      principalAmount: 30000,
      interestAmount: 6000,
    });
    // Dentro de días de gracia (3 días): 2026-02-04 -> 0 mora
    const feeWithinGrace = computeLateFeeForInstallment({
      installment: inst,
      asOfDateIso: '2026-02-04',
      graceDays: 3,
      lateFeeRateMonthlyPct: 5,
    });
    expect(feeWithinGrace).toBe(0);

    // 13 días vencida (10 días efectivos tras gracia): 36,000 * (0.05/30) * 10 = 600.00
    const loan = makeLoan();
    const res = evaluateLoanDelinquency({
      loan,
      installments: [inst],
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-02-14',
    });
    expect(res.account.dpd).toBe(13);
    expect(res.account.bucket).toBe('6_15');
    expect(res.account.stage).toBe('TEMPRANA');
    expect(res.account.overdueLateFee).toBe(600);
    expect(res.derivedLoanStatus).toBe('VENCIDO');
  });

  it('3. Colas Cobros del Día y Cobros Urgentes sin duplicación y con explicación de prioridad', () => {
    const accToday = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_today', loanNumber: 'PRE-01' }),
      installments: [makeInstallment({ id: 'it1', loanId: 'l_today', dueDate: '2026-02-10' })],
      asOfDateIso: '2026-02-10',
    }).account;
    const accMora = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_mora', loanNumber: 'PRE-02' }),
      installments: [makeInstallment({ id: 'im1', loanId: 'l_mora', dueDate: '2026-02-07' })],
      asOfDateIso: '2026-02-10',
    }).account;

    const daily = buildDailyCollectionsQueue({
      accounts: [accToday, accMora],
      installments: [
        makeInstallment({ id: 'it1', loanId: 'l_today', dueDate: '2026-02-10' }),
        makeInstallment({ id: 'im1', loanId: 'l_mora', dueDate: '2026-02-07' }),
      ],
      promises: [makePromise({ id: 'p_today', loanId: 'l_today', promisedDate: '2026-02-10' })],
      tasks: [],
      asOfDateIso: '2026-02-10',
    });
    // l_today tiene VENCE_HOY + PROMESA_HOY pero aparece una sola vez
    const entryToday = daily.find((d) => d.loanId === 'l_today');
    expect(daily.filter((d) => d.loanId === 'l_today')).toHaveLength(1);
    expect(entryToday?.categories).toContain('VENCE_HOY');
    expect(entryToday?.categories).toContain('PROMESA_HOY');
    expect(entryToday?.priorityEval.reasons.length).toBeGreaterThan(0);

    const urgent = buildUrgentCollectionsQueue({
      accounts: [accMora, accMora, accToday],
      promises: [],
      asOfDateIso: '2026-02-10',
    });
    expect(urgent.filter((u) => u.loanId === 'l_mora')).toHaveLength(1);
    expect(urgent[0].loanId).toBe('l_mora');
  });

  it('4. Generación idempotente de tareas automáticas en Agenda mediante sourceEventKey', () => {
    const accMora = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_task_1' }),
      installments: [makeInstallment({ loanId: 'l_task_1', dueDate: '2026-02-07' })],
      asOfDateIso: '2026-02-10',
    }).account;

    const firstRun = generateAutomatedCollectionTasks({
      organizationId: ORG_ID,
      accounts: [accMora],
      promises: [],
      alerts: [],
      existingTasks: [],
      asOfDateIso: '2026-02-10',
      fallbackAssigneeId: 'agent_1',
      fallbackAssigneeName: 'Gestor Uno',
    });
    expect(firstRun.length).toBe(1);
    expect(firstRun[0].taskType).toBe('MORA_TEMPRANA_1_5');

    const secondRun = generateAutomatedCollectionTasks({
      organizationId: ORG_ID,
      accounts: [accMora],
      promises: [],
      alerts: [],
      existingTasks: firstRun,
      asOfDateIso: '2026-02-10',
      fallbackAssigneeId: 'agent_1',
      fallbackAssigneeName: 'Gestor Uno',
    });
    expect(secondRun).toHaveLength(0);
  });

  it('5. Inmutabilidad de gestiones cerradas permitiendo solo gestión correctiva vinculada', () => {
    const closedAction = makeAction({ id: 'act_closed', isClosed: true });
    const editAttempt = validateActionEditAttempt(closedAction);
    expect(editAttempt.allowed).toBe(false);
    expect(editAttempt.reason).toContain('inmutables');

    const correctiveAction = makeAction({
      id: 'act_corrective',
      correctsActionId: closedAction.id,
      notes: 'Corrección: teléfono alterno actualizado.',
    });
    expect(correctiveAction.correctsActionId).toBe(closedAction.id);
  });

  it('6. Promesa NO pasa a CUMPLIDA con pago REPORTADO/VERIFICADO; solo con pago APLICADO', () => {
    const promise = makePromise({ promisedAmount: 36000, promisedDate: '2026-02-10' });

    const reportedOnly = evaluatePromiseFulfillment({
      promise,
      payments: [makePayment({ amount: 36000, status: 'REPORTADO', paymentDate: '2026-02-09' })],
      asOfDateIso: '2026-02-10',
    });
    expect(reportedOnly.promise.status).toBe('PENDIENTE_VERIFICACION');
    expect(reportedOnly.promise.fulfilledAmount).toBe(0);

    const verifiedOnly = evaluatePromiseFulfillment({
      promise,
      payments: [makePayment({ amount: 36000, status: 'VERIFICADO', paymentDate: '2026-02-09' })],
      asOfDateIso: '2026-02-10',
    });
    expect(verifiedOnly.promise.status).toBe('PENDIENTE_VERIFICACION');

    const applied = evaluatePromiseFulfillment({
      promise,
      payments: [makePayment({ amount: 36000, status: 'APLICADO', paymentDate: '2026-02-09' })],
      asOfDateIso: '2026-02-10',
    });
    expect(applied.promise.status).toBe('CUMPLIDA');
    expect(applied.promise.fulfilledAmount).toBe(36000);
  });

  it('7. Controles anti-hostigamiento: horario, domingos, tope diario y reclamación abierta', () => {
    // Domingo en Santo Domingo (UTC 15:00 = 11:00 AST Domingo)
    const sundayDate = new Date('2026-02-15T15:00:00Z');
    const sundayBlocked = validateContactPermission({
      loanId: 'loan_col_1',
      actions: [],
      referenceDate: sundayDate,
    });
    expect(sundayBlocked.allowed).toBe(false);

    // Lunes 21:30 AST -> UTC 2026-02-17T01:30:00Z (fuera de horario 8–20)
    const lateMonday = new Date('2026-02-17T01:30:00Z');
    const nightBlocked = validateContactPermission({
      loanId: 'loan_col_1',
      actions: [],
      referenceDate: lateMonday,
    });
    expect(nightBlocked.allowed).toBe(false);

    // Lunes 11:00 AST -> 2026-02-16T15:00:00Z con 3 acciones previas hoy (límite 3)
    const mondayOk = new Date('2026-02-16T15:00:00Z');
    const capBlocked = validateContactPermission({
      loanId: 'loan_col_1',
      actions: [
        makeAction({ id: 'a1', actionTimeIso: '2026-02-16T09:00:00Z' }),
        makeAction({ id: 'a2', actionTimeIso: '2026-02-16T10:00:00Z' }),
        makeAction({ id: 'a3', actionTimeIso: '2026-02-16T11:00:00Z' }),
      ],
      referenceDate: mondayOk,
    });
    expect(capBlocked.allowed).toBe(false);

    // Reclamación abierta pausa bot automático
    const dispute: CustomerDisputeRecord = {
      id: 'disp_1',
      organizationId: ORG_ID,
      loanId: 'loan_col_1',
      loanNumber: 'PRE-2026-0001',
      customerId: 'cust_col_1',
      customerName: 'María Valdez',
      disputeType: 'ERROR_SALDO',
      description: 'Cliente objeta cálculo de interés.',
      status: 'ABIERTA',
      pauseAutomatedMessages: true,
      openedBy: 'agent_1',
      openedByName: 'Gestor Uno',
    };
    const botBlocked = validateContactPermission({
      loanId: 'loan_col_1',
      actions: [],
      disputes: [dispute],
      isAutomatedBot: true,
      referenceDate: mondayOk,
    });
    expect(botBlocked.allowed).toBe(false);
    expect(botBlocked.hasOpenDisputePause).toBe(true);
  });

  it('8. Transiciones de estado de cuota (PENDIENTE -> VENCIDA -> PARCIAL -> PAGADA)', () => {
    const instPendiente = makeInstallment({ dueDate: '2026-02-10', principalAmount: 1000, interestAmount: 200 });
    const overdueEval = evaluateLoanDelinquency({
      loan: makeLoan({ currentPrincipalBalance: 1000 }),
      installments: [instPendiente],
      asOfDateIso: '2026-02-15',
    });
    expect(overdueEval.updatedInstallments[0].status).toBe('VENCIDA');

    // Pago parcial antes de vencimiento -> PARCIAL
    const instFuture = makeInstallment({ id: 'inst_f', dueDate: '2026-03-10', principalAmount: 1000, interestAmount: 200 });
    const partialAlloc = allocatePaymentAcrossInstallments({
      payment: makePayment({ amount: 500, paymentDate: '2026-02-15' }),
      loan: makeLoan({ currentPrincipalBalance: 1000 }),
      installments: [instFuture],
      asOfDateIso: '2026-02-15',
    });
    expect(partialAlloc.updatedInstallments[0].status).toBe('PARCIAL');

    // Pago del saldo restante -> PAGADA
    const finalAlloc = allocatePaymentAcrossInstallments({
      payment: makePayment({ id: 'pay_col_2', amount: 700, paymentDate: '2026-02-16' }),
      loan: makeLoan({ currentPrincipalBalance: partialAlloc.nextLoanPrincipalBalance }),
      installments: partialAlloc.updatedInstallments,
      asOfDateIso: '2026-02-16',
    });
    expect(finalAlloc.updatedInstallments[0].status).toBe('PAGADA');
    expect(finalAlloc.nextLoanPrincipalBalance).toBe(0);
    expect(finalAlloc.nextLoanStatus).toBe('PAGADO');
  });

  it('9. Aplicación de pago múltiple y sobrepago/abono extraordinario a capital con precisión de centavos', () => {
    const loan = makeLoan({ currentPrincipalBalance: 60000, totalFinancedPrincipal: 60000 });
    const insts = [
      makeInstallment({ id: 'i1', installmentNumber: 1, dueDate: '2026-02-01', principalAmount: 20000, interestAmount: 2000 }),
      makeInstallment({ id: 'i2', installmentNumber: 2, dueDate: '2026-03-01', principalAmount: 20000, interestAmount: 1500 }),
      makeInstallment({ id: 'i3', installmentNumber: 3, dueDate: '2026-04-01', principalAmount: 20000, interestAmount: 1000 }),
    ];

    // Pago de 50,000 cubre i1 (22,000), i2 (21,500) y parte de i3 (1,000 interés + 5,500 capital)
    const alloc = allocatePaymentAcrossInstallments({
      payment: makePayment({ amount: 50000, paymentDate: '2026-02-05' }),
      loan,
      installments: insts,
      asOfDateIso: '2026-02-05',
    });
    expect(alloc.updatedInstallments[0].status).toBe('PAGADA');
    expect(alloc.updatedInstallments[1].status).toBe('PAGADA');
    expect(alloc.updatedInstallments[2].status).toBe('PARCIAL');
    expect(alloc.appliedInterestTotal).toBe(4500);
    expect(alloc.appliedPrincipalTotal).toBe(45500);
    expect(alloc.nextLoanPrincipalBalance).toBe(14500);
  });

  it('10. Orden de imputación configurable (MORA>CARGOS>INTERES>CAPITAL vs CAPITAL primero)', () => {
    const loan = makeLoan({ currentPrincipalBalance: 10000 });
    const inst = makeInstallment({
      principalAmount: 1000,
      interestAmount: 500,
      otherCharges: 100,
      accruedLateFee: 200,
    });

    const defaultOrder = allocatePaymentAcrossInstallments({
      payment: makePayment({ amount: 600 }),
      loan,
      installments: [inst],
      imputationOrder: ['MORA', 'CARGOS', 'INTERES', 'CAPITAL'],
    });
    expect(defaultOrder.appliedLateFeeTotal).toBe(200);
    expect(defaultOrder.appliedChargesTotal).toBe(100);
    expect(defaultOrder.appliedInterestTotal).toBe(300);
    expect(defaultOrder.appliedPrincipalTotal).toBe(0);

    const capitalFirstOrder = allocatePaymentAcrossInstallments({
      payment: makePayment({ amount: 600 }),
      loan,
      installments: [inst],
      imputationOrder: ['CAPITAL', 'INTERES', 'MORA', 'CARGOS'],
    });
    expect(capitalFirstOrder.appliedPrincipalTotal).toBe(600);
    expect(capitalFirstOrder.appliedLateFeeTotal).toBe(0);
  });

  it('11. Emisión de recibo oficial estrictamente bloqueada si el pago no está APLICADO', () => {
    const loan = makeLoan();
    const reportedPay = makePayment({ status: 'REPORTADO' });
    expect(() =>
      buildOfficialReceipt({
        payment: reportedPay,
        loan,
        allocations: [],
        remainingPrincipalAfter: 100000,
        issuedBy: 'fin_1',
        issuedByName: 'Finanzas',
      })
    ).toThrow(/APLICADO/);

    const appliedPay = makePayment({ status: 'APLICADO' });
    const alloc = allocatePaymentAcrossInstallments({
      payment: makePayment({ status: 'VERIFICADO', amount: 36000 }),
      loan,
      installments: [makeInstallment()],
    });
    const receipt = buildOfficialReceipt({
      payment: appliedPay,
      loan,
      allocations: alloc.allocations,
      remainingPrincipalAfter: alloc.nextLoanPrincipalBalance,
      issuedBy: 'fin_1',
      issuedByName: 'Finanzas',
    });
    expect(receipt.status).toBe('EMITIDO');
    expect(receipt.receiptNumber).toContain('REC-');
  });

  it('12. Reverso autorizado de pago aplicado restaura saldos y cuotas exactas', () => {
    const loan = makeLoan({ currentPrincipalBalance: 100000, totalFinancedPrincipal: 100000 });
    const inst = makeInstallment({ dueDate: '2026-02-01', principalAmount: 32000, interestAmount: 4000 });
    const verifiedPay = makePayment({ status: 'VERIFICADO', amount: 36000, paymentDate: '2026-02-05' });

    const applied = allocatePaymentAcrossInstallments({
      payment: verifiedPay,
      loan,
      installments: [inst],
      asOfDateIso: '2026-02-05',
    });
    expect(applied.nextLoanPrincipalBalance).toBe(68000);
    expect(applied.updatedInstallments[0].status).toBe('PAGADA');

    const reversed = computePaymentReversal({
      payment: { ...verifiedPay, status: 'APLICADO' },
      loan: {
        ...loan,
        currentPrincipalBalance: applied.nextLoanPrincipalBalance,
        paidPrincipalTotal: applied.appliedPrincipalTotal,
        paidInterestTotal: applied.appliedInterestTotal,
      },
      installments: applied.updatedInstallments,
      allocations: applied.allocations,
      asOfDateIso: '2026-02-05',
    });
    expect(reversed.restoredLoanPrincipalBalance).toBe(100000);
    expect(reversed.updatedInstallments[0].status).toBe('VENCIDA');
    expect(reversed.updatedInstallments[0].paidPrincipal).toBe(0);
    expect(reversed.restoredLoanStatus).toBe('VENCIDO');
  });

  it('13. Parseo CSV/TSV de extracto bancario y hash determinístico contra duplicados', () => {
    const csv = [
      'Fecha,Referencia,Descripcion,Monto,Moneda,Banco',
      '2026-02-05,REF-1001,Transferencia cliente Maria,36000.00,DOP,Banco Popular',
      '2026-02-06,REF-1002,"Pago cuota USD",250.50,USD,Banreservas',
    ].join('\n');

    const parsed = parseBankStatementText({ rawText: csv });
    expect(parsed).toHaveLength(2);
    expect(parsed[0].amount).toBe(36000);
    expect(parsed[1].currency).toBe('USD');

    const h1 = buildBankTxIdempotencyHash({
      organizationId: ORG_ID,
      bankName: parsed[0].bankName,
      transactionDate: parsed[0].transactionDate,
      referenceNumber: parsed[0].referenceNumber,
      amount: parsed[0].amount,
      currency: parsed[0].currency,
    });
    const h2 = buildBankTxIdempotencyHash({
      organizationId: ORG_ID,
      bankName: '  banco popular ',
      transactionDate: '2026-02-05',
      referenceNumber: 'ref-1001',
      amount: 36000,
      currency: 'DOP',
    });
    expect(h1).toBe(h2);
  });

  it('14. Conciliación bancaria: coincidencia EXACTA con autoApplyExactBankMatch activo', () => {
    const bankTx: BankTransactionRecord = {
      id: 'btx_1',
      organizationId: ORG_ID,
      batchId: 'batch_1',
      bankName: 'Banco Popular',
      transactionDate: '2026-02-05',
      referenceNumber: 'TRF-9001',
      description: 'Deposito',
      amount: 36000,
      currency: 'DOP',
      idempotencyHash: 'hash_1',
      status: 'PENDIENTE',
      createdBy: 'fin_1',
    };
    const policyAuto: CollectionPolicyVersionRecord = {
      ...DEFAULT_COLLECTION_POLICY_V1,
      autoApplyExactBankMatch: true,
    };
    const matchRes = classifyAndMatchBankTransaction({
      bankTx,
      payments: [makePayment({ referenceNumber: 'TRF-9001', amount: 36000, paymentDate: '2026-02-04' })],
      policy: policyAuto,
    });
    expect(matchRes.confidence).toBe('EXACTA');
    expect(matchRes.shouldAutoApply).toBe(true);
    expect(matchRes.exceptionType).toBeNull();
  });

  it('15. Conciliación bancaria: EXACTA sin autoApply, diferencia de monto y ambigüedad', () => {
    const bankTx: BankTransactionRecord = {
      id: 'btx_2',
      organizationId: ORG_ID,
      batchId: 'batch_1',
      bankName: 'Banco Popular',
      transactionDate: '2026-02-05',
      referenceNumber: 'TRF-9001',
      description: 'Deposito',
      amount: 35000,
      currency: 'DOP',
      idempotencyHash: 'hash_2',
      status: 'PENDIENTE',
      createdBy: 'fin_1',
    };

    const exactManual = classifyAndMatchBankTransaction({
      bankTx: { ...bankTx, amount: 36000 },
      payments: [makePayment({ referenceNumber: 'TRF-9001', amount: 36000, paymentDate: '2026-02-05' })],
      policy: { ...DEFAULT_COLLECTION_POLICY_V1, autoApplyExactBankMatch: false },
    });
    expect(exactManual.confidence).toBe('EXACTA');
    expect(exactManual.shouldAutoApply).toBe(false);

    const diffAmt = classifyAndMatchBankTransaction({
      bankTx,
      payments: [makePayment({ referenceNumber: 'TRF-9001', amount: 36000, paymentDate: '2026-02-05' })],
    });
    expect(diffAmt.confidence).toBe('DIFERENCIA_MONTO');
    expect(diffAmt.exceptionType).toBe('DIFERENCIA_MONTO');
    expect(diffAmt.amountDiff).toBe(-1000);

    const ambiguous = classifyAndMatchBankTransaction({
      bankTx: { ...bankTx, amount: 36000 },
      payments: [
        makePayment({ id: 'p1', referenceNumber: 'TRF-9001', amount: 36000 }),
        makePayment({ id: 'p2', referenceNumber: 'TRF-9001', amount: 36000 }),
      ],
    });
    expect(ambiguous.confidence).toBe('AMBIGUA');
    expect(ambiguous.exceptionType).toBe('MULTIPLES_CANDIDATOS');
  });

  it('16. Depósito bancario sin coincidencia enrutable a Pagos por Identificar (SIN_COINCIDENCIA)', () => {
    const bankTx: BankTransactionRecord = {
      id: 'btx_unid',
      organizationId: ORG_ID,
      batchId: 'batch_1',
      bankName: 'Banreservas',
      transactionDate: '2026-02-05',
      referenceNumber: 'DESCONOCIDA-88',
      description: 'Transferencia sin detalle',
      amount: 12450,
      currency: 'DOP',
      idempotencyHash: 'hash_unid',
      status: 'PENDIENTE',
      createdBy: 'fin_1',
    };
    const res = classifyAndMatchBankTransaction({
      bankTx,
      payments: [makePayment({ referenceNumber: 'TRF-9001', amount: 36000 })],
    });
    expect(res.confidence).toBe('SIN_COINCIDENCIA');
    expect(res.exceptionType).toBe('SIN_COINCIDENCIA');
    expect(res.matchedPayment).toBeNull();
  });

  it('17. Separación estricta de métricas DOP y USD sin mezclar monedas', () => {
    const accDop: CollectionAccountRecord = {
      ...evaluateLoanDelinquency({
        loan: makeLoan({ id: 'ldop', currency: 'DOP', currentPrincipalBalance: 100000 }),
        installments: [makeInstallment({ loanId: 'ldop', dueDate: '2026-02-01' })],
        asOfDateIso: '2026-02-15',
      }).account,
    };
    const accUsd: CollectionAccountRecord = {
      ...evaluateLoanDelinquency({
        loan: makeLoan({ id: 'lusd', currency: 'USD', productCode: 'PERSONAL_USD', currentPrincipalBalance: 2000 }),
        installments: [makeInstallment({ loanId: 'lusd', dueDate: '2026-03-15', principalAmount: 500, interestAmount: 50 })],
        asOfDateIso: '2026-02-15',
      }).account,
    };

    const par = computeParAndPortfolioMetrics([accDop, accUsd]);
    expect(par.DOP.totalOutstandingPrincipal).toBe(100000);
    expect(par.USD.totalOutstandingPrincipal).toBe(2000);
    expect(par.DOP.activeLoansCount).toBe(1);
    expect(par.USD.activeLoansCount).toBe(1);
  });

  it('18. Cálculos exactos de PAR 1, PAR 30, PAR 60 y PAR 90 sobre saldo de capital', () => {
    const mk = (id: string, bal: number, dueDate: string) =>
      evaluateLoanDelinquency({
        loan: makeLoan({ id, currentPrincipalBalance: bal }),
        installments: [makeInstallment({ id: `i_${id}`, loanId: id, dueDate })],
        asOfDateIso: '2026-05-01',
      }).account;

    const accounts = [
      mk('a_cur', 50000, '2026-06-01'), // 0 DPD
      mk('a_p15', 20000, '2026-04-16'), // 15 DPD (>=1)
      mk('a_p45', 20000, '2026-03-17'), // 45 DPD (>=1, >=30)
      mk('a_p95', 10000, '2026-01-26'), // 95 DPD (>=1, >=30, >=60, >=90)
    ];

    const par = computeParAndPortfolioMetrics(accounts);
    expect(par.DOP.totalOutstandingPrincipal).toBe(100000);
    expect(par.DOP.par1Pct).toBe(50);
    expect(par.DOP.par30Pct).toBe(30);
    expect(par.DOP.par60Pct).toBe(10);
    expect(par.DOP.par90Pct).toBe(10);
  });

  it('19. Reconstrucción histórica reproducible a cutoffDate y snapshot diario', () => {
    const loanEarly = makeLoan({ id: 'l_early', disbursementDate: '2026-01-10', currentPrincipalBalance: 80000 });
    const loanFuture = makeLoan({ id: 'l_future', disbursementDate: '2026-03-01', currentPrincipalBalance: 50000 });
    const cutoffAccounts = reconstructAccountsAtCutoffDate({
      loans: [loanEarly, loanFuture],
      installments: [makeInstallment({ loanId: 'l_early', dueDate: '2026-02-01' })],
      payments: [],
      cutoffDateIso: '2026-02-15',
    });
    // Préstamo desembolsado en marzo no existe en corte de febrero
    expect(cutoffAccounts).toHaveLength(1);
    expect(cutoffAccounts[0].loanId).toBe('l_early');

    const snapshot = buildReproducibleDailySnapshot({
      organizationId: ORG_ID,
      accounts: cutoffAccounts,
      cutoffDateIso: '2026-02-15',
      policyVersion: 'cobranza-v1.0',
      createdBy: 'fin_1',
    });
    expect(snapshot.cutoffDate).toBe('2026-02-15');
    expect(snapshot.totalActiveLoans).toBe(1);
    expect(snapshot.principalBalanceDop).toBe(80000);
  });

  it('20. Segregación RBAC: Gestor/Caja no aplican ni revierten pagos; Auditor es solo lectura', () => {
    expect(hasRolePermission('COLLECTION_AGENT', 'REPORT_PAYMENTS')).toBe(true);
    expect(hasRolePermission('COLLECTION_AGENT', 'VERIFY_AND_APPLY_PAYMENTS')).toBe(false);
    expect(hasRolePermission('COLLECTION_AGENT', 'REVERSE_PAYMENTS')).toBe(false);

    expect(hasRolePermission('CASHIER', 'REPORT_PAYMENTS')).toBe(true);
    expect(hasRolePermission('CASHIER', 'VERIFY_AND_APPLY_PAYMENTS')).toBe(false);
    expect(hasRolePermission('CASHIER', 'REVERSE_PAYMENTS')).toBe(false);

    expect(hasRolePermission('FINANCE', 'VERIFY_AND_APPLY_PAYMENTS')).toBe(true);
    expect(hasRolePermission('FINANCE', 'REVERSE_PAYMENTS')).toBe(true);

    expect(hasRolePermission('AUDITOR', 'VIEW_COLLECTIONS_PORTFOLIO')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'LOG_COLLECTION_ACTIONS')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'VERIFY_AND_APPLY_PAYMENTS')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'CLOSE_CANCEL_LOAN')).toBe(false);
  });

  it('21. Auto-asignación equitativa de cartera entre gestores activos', () => {
    const accounts = ['l1', 'l2', 'l3', 'l4'].map((id, idx) =>
      evaluateLoanDelinquency({
        loan: makeLoan({ id, loanNumber: `PRE-0${idx + 1}` }),
        installments: [makeInstallment({ id: `i_${id}`, loanId: id, dueDate: '2026-02-01' })],
        asOfDateIso: '2026-02-10',
      }).account
    );
    const collectors = [
      makeCollectorUser('g1', 'Gestor 1'),
      makeCollectorUser('g2', 'Gestor 2'),
    ];
    const plan = buildAutoAssignmentPlan({ accounts, collectors, onlyUnassigned: true });
    expect(plan).toHaveLength(4);
    expect(plan.filter((p) => p.newCollectorId === 'g1')).toHaveLength(2);
    expect(plan.filter((p) => p.newCollectorId === 'g2')).toHaveLength(2);
  });

  it('22. Segregación entre proponente y aprobador en acuerdos/reestructuraciones', () => {
    const restructuring: PaymentAgreementRecord = {
      id: 'agr_1',
      organizationId: ORG_ID,
      loanId: 'loan_col_1',
      loanNumber: 'PRE-2026-0001',
      customerId: 'cust_col_1',
      customerName: 'María Valdez',
      currency: 'DOP',
      agreementType: 'REESTRUCTURACION',
      totalAgreedAmount: 85000,
      downPaymentAmount: 10000,
      installmentCount: 6,
      firstDueDate: '2026-03-01',
      notes: 'Reducción de ingresos comprobada.',
      status: 'PROPUESTO',
      proposedBy: 'sup_1',
      proposedByName: 'Supervisor Uno',
    };

    const sameUserBlocked = canApprovePaymentAgreement({
      userId: 'sup_1',
      userRole: 'SUPERVISOR',
      agreement: restructuring,
    });
    expect(sameUserBlocked.allowed).toBe(false);

    const agentBlocked = canApprovePaymentAgreement({
      userId: 'agent_1',
      userRole: 'COLLECTION_AGENT',
      agreement: restructuring,
    });
    expect(agentBlocked.allowed).toBe(false);

    const coordAllowed = canApprovePaymentAgreement({
      userId: 'coord_1',
      userRole: 'COLLECTION_COORDINATOR',
      agreement: restructuring,
    });
    expect(coordAllowed.allowed).toBe(true);
  });

  it('23. Validación de cierre/cancelación formal bloquea saldos/disputas y habilita al cumplir todo', () => {
    const loanOpen = makeLoan({ currentPrincipalBalance: 5000, status: 'ACTIVO' });
    const blocked = validateLoanCancellationEligibility({
      loan: loanOpen,
      installments: [makeInstallment({ status: 'PENDIENTE' })],
      payments: [makePayment({ status: 'REPORTADO' })],
      disputes: [],
      exceptions: [],
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reasons.length).toBeGreaterThanOrEqual(3);

    const loanZero = makeLoan({ currentPrincipalBalance: 0, status: 'PAGADO' });
    const ready = validateLoanCancellationEligibility({
      loan: loanZero,
      installments: [makeInstallment({ status: 'PAGADA' })],
      payments: [makePayment({ status: 'APLICADO' })],
      disputes: [],
      exceptions: [],
    });
    expect(ready.allowed).toBe(true);
    expect(ready.certificateNumber).toContain('CERT-CIERRE-');
  });

  it('24. Bloqueo estricto de pagos posteriores sobre préstamo CANCELADO', () => {
    const canceledLoan = makeLoan({ status: 'CANCELADO', currentPrincipalBalance: 0 });
    expect(() =>
      allocatePaymentAcrossInstallments({
        payment: makePayment({ status: 'VERIFICADO', amount: 1000 }),
        loan: canceledLoan,
        installments: [makeInstallment({ status: 'PAGADA' })],
      })
    ).toThrow(/CANCELADO/);
  });

  it('25. Bot AxyRecovery Seguro: exige 4 últimos dígitos, respeta STOP y no baja saldo al reportar pago', () => {
    const acc = evaluateLoanDelinquency({
      loan: makeLoan({ currentPrincipalBalance: 100000 }),
      installments: [makeInstallment({ dueDate: '2026-02-01' })],
      asOfDateIso: '2026-02-10',
    }).account;

    const noAuth = processSafeBotConversationTurn({
      inboundText: 'Cuál es mi saldo',
      account: acc,
      customerDocumentLast4: '5678',
      identityAlreadyVerified: false,
    });
    expect(noAuth.verifiedIdentity).toBe(false);
    expect(noAuth.detectedIntent).toBe('VERIFICACION_PENDIENTE');
    expect(noAuth.replyText).not.toContain('100000');

    const verifiedTurn = processSafeBotConversationTurn({
      inboundText: '5678',
      account: acc,
      customerDocumentLast4: '5678',
      identityAlreadyVerified: false,
    });
    expect(verifiedTurn.verifiedIdentity).toBe(true);
    expect(verifiedTurn.replyText).toContain('100000');

    const payReport = processSafeBotConversationTurn({
      inboundText: 'Ya pagué con comprobante ref 9912',
      account: acc,
      customerDocumentLast4: '5678',
      identityAlreadyVerified: true,
    });
    expect(payReport.shouldCreatePaymentIntent).toBe(true);
    expect(payReport.replyText).toContain('PENDIENTE DE VERIFICACIÓN');

    const optOut = processSafeBotConversationTurn({
      inboundText: 'STOP',
      account: acc,
      customerDocumentLast4: '5678',
      identityAlreadyVerified: true,
    });
    expect(optOut.shouldOptOut).toBe(true);
    expect(optOut.detectedIntent).toBe('OPT_OUT');
  });

  it('26. Elegibilidad de envío Bot bloquea Opt-Out, plantilla no aprobada, horario y tope semanal', () => {
    const acc = evaluateLoanDelinquency({
      loan: makeLoan(),
      installments: [makeInstallment()],
      asOfDateIso: '2026-02-16',
    }).account;

    const approvedTpl: MessageTemplateRecord = {
      id: 'tpl_1',
      organizationId: ORG_ID,
      code: 'REC_TEMP_01',
      name: 'Recordatorio',
      stageTarget: 'TEMPRANA',
      channel: 'WHATSAPP',
      bodyTemplate: 'Hola {{cliente}}',
      variables: ['cliente'],
      approvalStatus: 'APROBADA',
      updatedBy: 'coord_1',
    };
    const mondayOk = new Date('2026-02-16T15:00:00Z'); // Lunes 11:00 AST

    const optOutBlocked = evaluateBotDispatchEligibility({
      account: { ...acc, consentWhatsAppOptIn: false },
      template: approvedTpl,
      messageEvents: [],
      disputes: [],
      referenceDate: mondayOk,
    });
    expect(optOutBlocked.eligible).toBe(false);
    expect(optOutBlocked.deliveryStatusOnBlocked).toBe('BLOQUEADO_OPT_OUT');

    const draftBlocked = evaluateBotDispatchEligibility({
      account: acc,
      template: { ...approvedTpl, approvalStatus: 'BORRADOR' },
      messageEvents: [],
      disputes: [],
      referenceDate: mondayOk,
    });
    expect(draftBlocked.eligible).toBe(false);

    const pastMsgs: MessageEventRecord[] = [1, 2, 3, 4].map((n) => ({
      id: `m_${n}`,
      organizationId: ORG_ID,
      loanId: acc.loanId,
      loanNumber: acc.loanNumber,
      customerId: acc.customerId,
      direction: 'OUTBOUND',
      channel: 'WHATSAPP',
      recipientMasked: '****1122',
      messagePreview: 'msg',
      deliveryStatus: 'INTEGRACION_PENDIENTE',
      consentVerified: true,
      createdBy: 'coord_1',
      createdAt: '2026-02-15T14:00:00Z',
    }));
    const weeklyBlocked = evaluateBotDispatchEligibility({
      account: acc,
      template: approvedTpl,
      messageEvents: pastMsgs,
      disputes: [],
      referenceDate: mondayOk,
    });
    expect(weeklyBlocked.eligible).toBe(false);
    expect(weeklyBlocked.deliveryStatusOnBlocked).toBe('BLOQUEADO_FRECUENCIA');
  });

  it('27. Contact Center KPIs separan recaudo real APLICADO vs monto pendiente de verificación', () => {
    const acc = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_kpi' }),
      installments: [makeInstallment({ loanId: 'l_kpi', dueDate: '2026-02-01' })],
      asOfDateIso: '2026-02-10',
    }).account;
    acc.assignedCollectorId = 'agent_1';
    acc.assignedCollectorName = 'Gestor Uno';

    const kpis = computeContactCenterKpis({
      accounts: [acc],
      actions: [
        makeAction({ loanId: 'l_kpi', contactResult: 'CONTACTO_EFECTIVO_PROMESA' }),
        makeAction({ id: 'a2', loanId: 'l_kpi', contactResult: 'NO_CONTESTA' }),
      ],
      promises: [
        makePromise({ id: 'p1', loanId: 'l_kpi', status: 'CUMPLIDA' }),
        makePromise({ id: 'p2', loanId: 'l_kpi', status: 'INCUMPLIDA' }),
      ],
      payments: [
        makePayment({ id: 'pay1', loanId: 'l_kpi', amount: 15000, status: 'APLICADO', currency: 'DOP' }),
        makePayment({ id: 'pay2', loanId: 'l_kpi', amount: 25000, status: 'REPORTADO', currency: 'DOP' }),
      ],
    });
    expect(kpis.contactabilityPct).toBe(50);
    expect(kpis.promiseFulfillmentPct).toBe(50);
    expect(kpis.recoveredAppliedDop).toBe(15000);
    expect(kpis.pendingVerificationDop).toBe(25000);
  });

  it('28. Centinela genera alertas determinísticas ante riesgos críticos y duplicidades', () => {
    const accZeroPending = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_zero', currentPrincipalBalance: 0, status: 'ACTIVO' }),
      installments: [makeInstallment({ id: 'iz', loanId: 'l_zero', status: 'PAGADA', paidPrincipal: 32000, paidInterest: 4000 })],
      asOfDateIso: '2026-02-15',
    }).account;
    accZeroPending.stage = 'AL_DIA';

    const accDup = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_dup', currentPrincipalBalance: 80000 }),
      installments: [makeInstallment({ id: 'idup', loanId: 'l_dup', dueDate: '2026-02-01' })],
      promises: [
        makePromise({ id: 'pr1', loanId: 'l_dup', status: 'INCUMPLIDA' }),
        makePromise({ id: 'pr2', loanId: 'l_dup', status: 'INCUMPLIDA' }),
      ],
      asOfDateIso: '2026-02-15',
    }).account;

    const alerts = runSentinelAlertScan({
      organizationId: ORG_ID,
      accounts: [accZeroPending, accDup],
      installments: [],
      promises: [
        makePromise({ id: 'pr1', loanId: 'l_dup', status: 'INCUMPLIDA' }),
        makePromise({ id: 'pr2', loanId: 'l_dup', status: 'INCUMPLIDA' }),
      ],
      payments: [
        makePayment({ id: 'pd1', loanId: 'l_dup', amount: 10000, paymentDate: '2026-02-10', status: 'REPORTADO' }),
        makePayment({ id: 'pd2', loanId: 'l_dup', amount: 10000, paymentDate: '2026-02-10', status: 'VERIFICADO' }),
      ],
      disputes: [],
      exceptions: [
        {
          id: 'exc_1',
          organizationId: ORG_ID,
          bankTransactionId: 'btx_x',
          exceptionType: 'SIN_COINCIDENCIA',
          detail: 'Depósito sin referencia',
          status: 'ABIERTA',
        } as ReconciliationExceptionRecord,
      ],
      existingAlerts: [],
      asOfDateIso: '2026-02-15',
    });

    const rules = new Set(alerts.map((a) => a.ruleCode));
    expect(rules.has('SALDO_CERO_SIN_CIERRE')).toBe(true);
    expect(rules.has('PROMESAS_INCUMPLIDAS_REITERADAS')).toBe(true);
    expect(rules.has('POSIBLE_PAGO_DUPLICADO')).toBe(true);
    expect(rules.has('EXCEPCION_CONCILIACION_ANTIGUA')).toBe(true);
  });

  it('29. Proyecciones Anticípate 30 / 60 / 90 días separan DOP y USD con escenario base y estrés', () => {
    const loans = [
      makeLoan({ id: 'l_dop', currency: 'DOP', currentPrincipalBalance: 60000 }),
      makeLoan({ id: 'l_usd', currency: 'USD', productCode: 'PERSONAL_USD', currentPrincipalBalance: 1000 }),
    ];
    const insts = [
      makeInstallment({ id: 'i_d30', loanId: 'l_dop', dueDate: '2026-02-20', principalAmount: 10000, interestAmount: 2000 }),
      makeInstallment({ id: 'i_d75', loanId: 'l_dop', dueDate: '2026-04-05', principalAmount: 10000, interestAmount: 1500 }),
      makeInstallment({ id: 'i_u20', loanId: 'l_usd', dueDate: '2026-02-25', principalAmount: 200, interestAmount: 20 }),
    ];
    const projections = buildAnticipateProjections({
      loans,
      installments: insts,
      accounts: [],
      asOfDateIso: '2026-02-01',
    });
    expect(projections).toHaveLength(3);
    expect(projections[0].horizonDays).toBe(30);
    expect(projections[0].scheduledDueDop).toBe(12000);
    expect(projections[0].scheduledDueUsd).toBe(220);
    expect(projections[2].horizonDays).toBe(90);
    expect(projections[2].scheduledDueDop).toBe(23500);
    expect(projections[2].expectedStressDop).toBeLessThanOrEqual(projections[2].expectedBaseDop);
  });

  it('30. Cobertura RBAC completa de los 24 submódulos cobranza_* y exportación CSV sin mezcla de monedas', () => {
    expect(ALL_COBRANZA_SECTIONS).toHaveLength(24);
    ALL_COBRANZA_SECTIONS.forEach((sec) => {
      expect(canRoleAccessSection('ADMIN', sec)).toBe(true);
      expect(canRoleAccessSection('AUDITOR', sec)).toBe(true);
      expect(canRoleAccessSection('COLLECTION_COORDINATOR', sec)).toBe(true);
      expect(canRoleAccessSection('EXTERNAL_CLIENT', sec)).toBe(false);
    });

    const csv = buildCsvContent({
      reportId: 'cartera_mora_tramos',
      reportTitle: 'Morosidad por Tramos (DOP y USD Separados)',
      reportSubtitle: 'Corte 2026-02-15',
      organizationName: 'AxyCore Demo',
      policyVersion: 'cobranza-v1.0',
      filtersSummary: 'Corte: 2026-02-15',
      generatedBy: 'Tester',
      columns: ['Préstamo', 'Moneda', 'Saldo Capital'],
      rows: [
        ['PRE-2026-0001', 'DOP', 100000],
        ['PRE-2026-0002', 'USD', 2000],
      ],
      financialSummary: {
        totalSubmitted: 2,
        approvedCount: 2,
        rejectedCount: 0,
        approvalRatePct: 100,
        averageScore: null,
        requestedDop: 100000,
        requestedUsd: 2000,
        approvedDop: 100000,
        approvedUsd: 2000,
        disbursedDop: 100000,
        disbursedUsd: 2000,
        activePrincipalDop: 100000,
        activePrincipalUsd: 2000,
      },
    });
    expect(csv).toContain('PRE-2026-0001,DOP,100000');
    expect(csv).toContain('PRE-2026-0002,USD,2000');
  });

  it('31. Tramos de Cobros por DPD: Cobros del día (1-5d), Cobros Urgentes (6-30d) y Cobros en Legal (31+d)', () => {
    const mk = (id: string, dueDate: string, status: LoanRecord['status'] = 'ACTIVO') =>
      evaluateLoanDelinquency({
        loan: makeLoan({ id, loanNumber: `PRE-${id}`, status }),
        installments: [makeInstallment({ id: `inst_${id}`, loanId: id, dueDate })],
        asOfDateIso: '2026-05-01',
      }).account;

    const accDay0 = mk('d0', '2026-05-10'); // 0 DPD
    const accDay1 = mk('d1', '2026-04-30'); // 1 DPD
    const accDay5 = mk('d5', '2026-04-26'); // 5 DPD
    const accDay6 = mk('d6', '2026-04-25'); // 6 DPD
    const accDay30 = mk('d30', '2026-04-01'); // 30 DPD
    const accDay31 = mk('d31', '2026-03-31'); // 31 DPD
    const accCanceled = mk('canc', '2026-03-01', 'CANCELADO');

    const allAccounts = [accDay0, accDay1, accDay5, accDay6, accDay30, accDay31, accCanceled];

    const daily = buildCobrosDelDiaQueue({ accounts: allAccounts, asOfDateIso: '2026-05-01' });
    const urgent = buildCobrosUrgentesQueue({ accounts: allAccounts, asOfDateIso: '2026-05-01' });
    const legal = buildCobrosLegalQueue({ accounts: allAccounts, asOfDateIso: '2026-05-01' });

    expect(daily.map((q) => q.loanId)).toEqual(['d5', 'd1']);
    expect(urgent.map((q) => q.loanId)).toEqual(['d30', 'd6']);
    expect(legal.map((q) => q.loanId)).toEqual(['d31']);
  });

  it('32. Clasificación de Acuerdos para Gestiones de Cobros: Acuerdos del día e Incumplidos', () => {
    const acc1 = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_agr_1', loanNumber: 'PRE-AGR-1' }),
      installments: [makeInstallment({ id: 'i_agr_1', loanId: 'l_agr_1', dueDate: '2026-04-20' })],
      asOfDateIso: '2026-05-01',
    }).account;
    const acc2 = evaluateLoanDelinquency({
      loan: makeLoan({ id: 'l_agr_2', loanNumber: 'PRE-AGR-2' }),
      installments: [makeInstallment({ id: 'i_agr_2', loanId: 'l_agr_2', dueDate: '2026-04-10' })],
      asOfDateIso: '2026-05-01',
    }).account;

    const mkAgreement = (overrides: Partial<PaymentAgreementRecord>): PaymentAgreementRecord => ({
      id: 'agr_default',
      organizationId: ORG_ID,
      loanId: 'l_agr_1',
      loanNumber: 'PRE-AGR-1',
      customerId: 'cust_col_1',
      customerName: 'María Valdez',
      currency: 'DOP',
      agreementType: 'ACUERDO_PAGO',
      totalAgreedAmount: 30000,
      downPaymentAmount: 10000,
      installmentCount: 3,
      firstDueDate: '2026-05-01',
      notes: 'Acuerdo registrado',
      status: 'ACTIVO',
      proposedBy: 'agent_1',
      proposedByName: 'Gestor 1',
      createdAt: '2026-04-25T10:00:00Z',
      ...overrides,
    });

    const dueToday = mkAgreement({ id: 'agr_today', loanId: 'l_agr_1', firstDueDate: '2026-05-01', status: 'ACTIVO' });
    const overdueUnpaid = mkAgreement({ id: 'agr_overdue', loanId: 'l_agr_2', firstDueDate: '2026-04-28', status: 'ACTIVO' });
    const explicitlyBroken = mkAgreement({ id: 'agr_broken', loanId: 'l_agr_2', firstDueDate: '2026-05-05', status: 'INCUMPLIDO' });
    const futureActive = mkAgreement({ id: 'agr_future', loanId: 'l_agr_1', firstDueDate: '2026-05-12', status: 'ACTIVO' });
    const closedFulfilled = mkAgreement({ id: 'agr_done', loanId: 'l_agr_1', firstDueDate: '2026-04-20', status: 'CUMPLIDO' });

    const classification = classifyAgreementsForManagement({
      agreements: [dueToday, overdueUnpaid, explicitlyBroken, futureActive, closedFulfilled],
      accounts: [acc1, acc2],
      payments: [],
      asOfDateIso: '2026-05-01',
    });

    expect(classification.acuerdosDelDia.map((x) => x.agreement.id)).toEqual(['agr_today']);
    expect(classification.acuerdosIncumplidos.map((x) => x.agreement.id)).toEqual(['agr_overdue', 'agr_broken']);
    expect(classification.vigentesFuturos.map((x) => x.agreement.id)).toEqual(['agr_future']);
    expect(classification.historicos.map((x) => x.agreement.id)).toEqual(['agr_done']);
  });
});
