import { describe, expect, it } from 'vitest';
import { computeFinancialStatements } from '../engine/accountingEngine';
import { evaluateLoanDelinquency, reconcileLiveCollectionAccounts } from '../engine/collections/delinquencyEngine';
import { allocatePaymentAcrossInstallments } from '../engine/collections/paymentsAndReconciliationEngine';
import { buildCobrosDelDiaQueue } from '../engine/collections/priorityAndTasksEngine';
import { canRoleAccessSection } from '../engine/rbac';
import {
  formatEvidenceFileSize,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
} from '../utils/paymentEvidence';
import type {
  CollectionAccountRecord,
  CollectionReceiptRecord,
  CustomerRecord,
  DisbursementRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentRecord,
} from '../types/axycore';

describe('Cobros -> Contabilidad Pagos para Validación Flow', () => {
  const baseLoan: LoanRecord = {
    id: 'loan_val_1',
    organizationId: 'org_sgma',
    loanNumber: 'LN-2026-VAL-01',
    applicationId: 'app_val_1',
    disbursementId: 'disb_val_1',
    customerId: 'cust_val_1',
    applicantDisplayName: 'María Rodríguez',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 100000,
    contractualRateMonthly: 2.5,
    termMonths: 10,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-10',
    firstPaymentDate: '2026-02-10',
    maturityDate: '2026-11-10',
    totalContractualInterest: 14000,
    totalContractualPayable: 114000,
    status: 'ACTIVO',
    createdBy: 'admin_1',
  };

  const baseDisbursement: DisbursementRecord = {
    id: 'disb_val_1',
    organizationId: 'org_sgma',
    disbursementNumber: 'DES-VAL-01',
    applicationId: 'app_val_1',
    loanId: 'loan_val_1',
    customerId: 'cust_val_1',
    approvedAmount: 100000,
    totalFinanced: 100000,
    expenses: 0,
    netDeliveredAmount: 100000,
    disbursementDate: '2026-01-10',
    paymentMethod: 'TRANSFERENCIA',
    financialEntity: 'Banco Popular',
    destinationAccountMasked: '****1122',
    referenceNumber: 'TRF-DES-01',
    idempotencyKey: 'idem_val_1',
    responsibleUserId: 'admin_1',
    responsibleUserName: 'Admin',
    authorizerUserId: 'admin_1',
    authorizerUserName: 'Admin',
    status: 'CONFIRMADO',
  };

  const baseInstallments: LoanInstallmentRecord[] = [
    {
      id: 'inst_val_1',
      organizationId: 'org_sgma',
      loanId: 'loan_val_1',
      installmentNumber: 1,
      dueDate: '2026-02-10',
      principalAmount: 9500,
      interestAmount: 2500,
      otherCharges: 0,
      totalAmount: 12000,
      remainingPrincipalBalance: 90500,
      status: 'PENDIENTE',
      paidPrincipal: 0,
      paidInterest: 0,
      paidOtherCharges: 0,
      accruedLateFee: 0,
      paidLateFee: 0,
    },
    {
      id: 'inst_val_2',
      organizationId: 'org_sgma',
      loanId: 'loan_val_1',
      installmentNumber: 2,
      dueDate: '2026-03-10',
      principalAmount: 9737.5,
      interestAmount: 2262.5,
      otherCharges: 0,
      totalAmount: 12000,
      remainingPrincipalBalance: 80762.5,
      status: 'PENDIENTE',
      paidPrincipal: 0,
      paidInterest: 0,
      paidOtherCharges: 0,
      accruedLateFee: 0,
      paidLateFee: 0,
    },
  ];

  it('grants RBAC access to Contabilidad Pagos para Validación only to authorized roles', () => {
    expect(canRoleAccessSection('ADMIN', 'accounting_payment_validation')).toBe(true);
    expect(canRoleAccessSection('FINANCE', 'accounting_payment_validation')).toBe(true);
    expect(canRoleAccessSection('OPERATIONS', 'accounting_payment_validation')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'accounting_payment_validation')).toBe(true);
    expect(canRoleAccessSection('MANAGEMENT', 'accounting_payment_validation')).toBe(true);

    expect(canRoleAccessSection('COLLECTION_AGENT', 'accounting_payment_validation')).toBe(false);
    expect(canRoleAccessSection('CASHIER', 'accounting_payment_validation')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'accounting_payment_validation')).toBe(false);
  });

  it('classifies pending validation statuses and formats comprobante helpers cleanly', () => {
    expect(isPaymentPendingValidation('RECIBIDO_PENDIENTE_VERIFICACION')).toBe(true);
    expect(isPaymentPendingValidation('REPORTADO')).toBe(true);
    expect(isPaymentPendingValidation('APLICADO')).toBe(false);
    expect(isPaymentPendingValidation('RECHAZADO')).toBe(false);
    expect(isPaymentPendingValidation('REVERTIDO')).toBe(false);

    expect(getPaymentValidationStatusLabel('RECIBIDO_PENDIENTE_VERIFICACION')).toBe('Pendiente de Validación');
    expect(getPaymentValidationStatusLabel('APLICADO')).toBe('Validado y Aplicado');
    expect(getPaymentValidationStatusLabel('RECHAZADO')).toBe('Rechazado');

    expect(formatEvidenceFileSize(850)).toBe('850 B');
    expect(formatEvidenceFileSize(4096)).toBe('4.0 KB');
    expect(formatEvidenceFileSize(2 * 1024 * 1024)).toBe('2.00 MB');
  });

  it('does NOT affect client balance, installments, or accounting statements until Contabilidad validates the payment', () => {
    const pendingPayment: PaymentRecord = {
      id: 'pay_pending_1',
      organizationId: 'org_sgma',
      loanId: baseLoan.id,
      loanNumber: baseLoan.loanNumber,
      customerId: baseLoan.customerId,
      customerName: baseLoan.applicantDisplayName,
      paymentDate: '2026-02-10',
      currency: 'DOP',
      amount: 12000,
      method: 'TRANSFERENCIA',
      bankName: 'Banco Popular',
      referenceNumber: 'TRF-2026-0001',
      idempotencyKey: 'pay_val_idem_1',
      receiptEvidenceName: 'comprobante_maria.jpg',
      receiptEvidenceMimeType: 'image/jpeg',
      receiptEvidenceSizeBytes: 120_400,
      receiptEvidenceDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      status: 'RECIBIDO_PENDIENTE_VERIFICACION',
      reportedByUserId: 'collector_1',
      reportedByName: 'Gestor Cobros',
    };

    // 1. Before clicking "Validar" in Contabilidad: zero impact on statements and balances
    const beforeValidation = computeFinancialStatements({
      currency: 'DOP',
      year: 2026,
      loans: [baseLoan],
      disbursements: [baseDisbursement],
      collectionReceipts: [],
      payments: [pendingPayment],
      operatingExpenses: [],
      investors: [],
      investorTransactions: [],
    });

    expect(beforeValidation.cumulativeAllYearsColumn.incomeStatement.totalRevenue).toBe(0);
    expect(beforeValidation.cumulativeAllYearsColumn.balanceSheet.loanPortfolioReceivable).toBe(100000);
    expect(beforeValidation.cumulativeAllYearsColumn.balanceSheet.cashAndBanks).toBe(-100000);
    expect(beforeValidation.cumulativeAllYearsColumn.balanceSheet.balanceDiff).toBe(0);
    expect(baseLoan.currentPrincipalBalance).toBe(100000);

    // 2. Contabilidad clicks "Validar" -> allocate payment across installments & emit receipt
    const allocation = allocatePaymentAcrossInstallments({
      payment: pendingPayment,
      loan: baseLoan,
      installments: baseInstallments,
      asOfDateIso: '2026-02-10',
    });

    expect(allocation.appliedPrincipalTotal).toBe(9500);
    expect(allocation.appliedInterestTotal).toBe(2500);
    expect(allocation.appliedLateFeeTotal).toBe(0);
    expect(allocation.nextLoanPrincipalBalance).toBe(90500);
    expect(allocation.updatedInstallments[0].status).toBe('PAGADA');
    expect(allocation.updatedInstallments[1].status).toBe('PENDIENTE');

    const validatedLoan: LoanRecord = {
      ...baseLoan,
      currentPrincipalBalance: allocation.nextLoanPrincipalBalance,
      status: allocation.nextLoanStatus,
    };

    const validatedPayment: PaymentRecord = {
      ...pendingPayment,
      status: 'APLICADO',
      verifiedByUserId: 'finance_1',
      verifiedByName: 'Contabilidad SGMA',
      appliedAt: '2026-02-10T15:00:00.000Z',
    };

    const emittedReceipt: CollectionReceiptRecord = {
      id: 'rec_val_1',
      organizationId: 'org_sgma',
      receiptNumber: 'REC-2026-0001',
      paymentId: validatedPayment.id,
      loanId: validatedLoan.id,
      loanNumber: validatedLoan.loanNumber,
      customerId: validatedLoan.customerId,
      customerName: validatedLoan.applicantDisplayName,
      paymentDate: validatedPayment.paymentDate,
      currency: 'DOP',
      amount: validatedPayment.amount,
      appliedToCharges: allocation.appliedChargesTotal,
      appliedToLateFee: allocation.appliedLateFeeTotal,
      appliedToInterest: allocation.appliedInterestTotal,
      appliedToPrincipal: allocation.appliedPrincipalTotal,
      remainingPrincipalAfter: allocation.nextLoanPrincipalBalance,
      referenceNumber: validatedPayment.referenceNumber,
      status: 'EMITIDO',
      issuedBy: 'finance_1',
      issuedByName: 'Contabilidad SGMA',
      issuedAt: '2026-02-10T15:00:00.000Z',
    };

    // 3. After clicking "Validar" in Contabilidad: exact impact on loan balance, portfolio receivable, revenue, and cash
    const afterValidation = computeFinancialStatements({
      currency: 'DOP',
      year: 2026,
      loans: [validatedLoan],
      disbursements: [baseDisbursement],
      collectionReceipts: [emittedReceipt],
      payments: [validatedPayment],
      operatingExpenses: [],
      investors: [],
      investorTransactions: [],
    });

    expect(afterValidation.cumulativeAllYearsColumn.incomeStatement.totalRevenue).toBe(2500);
    expect(afterValidation.cumulativeAllYearsColumn.balanceSheet.loanPortfolioReceivable).toBe(90500);
    expect(afterValidation.cumulativeAllYearsColumn.balanceSheet.cashAndBanks).toBe(-88000);
    expect(afterValidation.cumulativeAllYearsColumn.balanceSheet.balanceDiff).toBe(0);
    expect(validatedLoan.currentPrincipalBalance).toBe(90500);
  });

  it('immediately removes a client from Cobros del día once their overdue installment is paid even if the stored collection_accounts snapshot is stale', () => {
    const staleStoredAccount: CollectionAccountRecord = {
      id: baseLoan.id,
      organizationId: baseLoan.organizationId,
      loanId: baseLoan.id,
      loanNumber: baseLoan.loanNumber,
      applicationId: baseLoan.applicationId,
      customerId: baseLoan.customerId,
      applicantDisplayName: 'José Manuel García',
      customerPhone: '809-555-0101',
      customerEmail: 'jgarcia@example.com',
      province: 'Santo Domingo',
      municipality: 'Distrito Nacional',
      productCode: baseLoan.productCode,
      currency: 'DOP',
      dpd: 3,
      maxHistoricalDpd: 3,
      stage: 'TEMPRANA',
      bucket: '1_5',
      priority: 'MEDIA',
      priorityScore: 25,
      priorityReasons: ['Mora de 1 a 5 días (Cobro del Día)'],
      overdueInstallmentsCount: 1,
      totalInstallmentsCount: 2,
      paidInstallmentsCount: 0,
      overduePrincipal: 9500,
      overdueInterest: 2500,
      overdueLateFee: 0,
      overdueCharges: 0,
      overdueTotalAmount: 12000,
      totalOutstandingPrincipal: 100000,
      nextDueDate: '2026-02-10',
      nextDueAmount: 12000,
      pendingVerificationAmount: 0,
      assignedCollectorId: 'collector_1',
      assignedCollectorName: 'Gestor Cobros',
      brokenPromisesCount: 0,
      behaviorScore: 780,
      behaviorBand: 'BUENO',
      consentWhatsAppOptIn: true,
      cutoffDate: '2026-02-13',
    };

    // Before payment is applied: 3 days past due -> appears in Cobros del día
    const beforeAccounts = reconcileLiveCollectionAccounts({
      loans: [{ ...baseLoan, applicantDisplayName: 'José Manuel García' }],
      installments: baseInstallments,
      existingAccounts: [staleStoredAccount],
      asOfDateIso: '2026-02-13',
    });
    expect(beforeAccounts[0].dpd).toBe(3);
    expect(buildCobrosDelDiaQueue({ accounts: beforeAccounts, asOfDateIso: '2026-02-13' })).toHaveLength(1);

    // Full payment applied on installment #1 (marks it PAGADA), while staleStoredAccount still has dpd=3
    const appliedPayment: PaymentRecord = {
      id: 'pay_jmg_1',
      organizationId: baseLoan.organizationId,
      loanId: baseLoan.id,
      loanNumber: baseLoan.loanNumber,
      customerId: baseLoan.customerId,
      customerName: 'José Manuel García',
      paymentDate: '2026-02-13',
      currency: 'DOP',
      amount: 12000,
      method: 'TRANSFERENCIA',
      referenceNumber: 'TRF-JMG-001',
      idempotencyKey: 'idem_jmg_1',
      status: 'VERIFICADO',
      reportedByUserId: 'collector_1',
      reportedByName: 'Gestor Cobros',
    };
    const alloc = allocatePaymentAcrossInstallments({
      payment: appliedPayment,
      loan: baseLoan,
      installments: baseInstallments,
      asOfDateIso: '2026-02-13',
    });

    const liveAccountsAfterFullPay = reconcileLiveCollectionAccounts({
      loans: [
        {
          ...baseLoan,
          applicantDisplayName: 'José Manuel García',
          currentPrincipalBalance: alloc.nextLoanPrincipalBalance,
          status: alloc.nextLoanStatus,
        },
      ],
      installments: alloc.updatedInstallments,
      existingAccounts: [staleStoredAccount],
      payments: [{ ...appliedPayment, status: 'APLICADO' }],
      asOfDateIso: '2026-02-13',
    });

    expect(liveAccountsAfterFullPay[0].dpd).toBe(0);
    expect(liveAccountsAfterFullPay[0].overdueTotalAmount).toBe(0);
    expect(liveAccountsAfterFullPay[0].stage).toBe('AL_DIA');
    expect(liveAccountsAfterFullPay[0].assignedCollectorId).toBe('collector_1');
    expect(
      buildCobrosDelDiaQueue({ accounts: liveAccountsAfterFullPay, asOfDateIso: '2026-02-13' })
    ).toHaveLength(0);

    // Partial payment (RD$ 5,000 of RD$ 12,000): still owes RD$ 7,000 overdue -> remains in Cobros del día with exact reduced overdue amount
    const partialAlloc = allocatePaymentAcrossInstallments({
      payment: { ...appliedPayment, id: 'pay_jmg_partial', amount: 5000 },
      loan: baseLoan,
      installments: baseInstallments,
      asOfDateIso: '2026-02-13',
    });
    const liveAccountsAfterPartial = reconcileLiveCollectionAccounts({
      loans: [
        {
          ...baseLoan,
          applicantDisplayName: 'José Manuel García',
          currentPrincipalBalance: partialAlloc.nextLoanPrincipalBalance,
        },
      ],
      installments: partialAlloc.updatedInstallments,
      existingAccounts: [staleStoredAccount],
      asOfDateIso: '2026-02-13',
    });
    expect(liveAccountsAfterPartial[0].dpd).toBe(3);
    expect(liveAccountsAfterPartial[0].overdueTotalAmount).toBe(7000);
    expect(
      buildCobrosDelDiaQueue({ accounts: liveAccountsAfterPartial, asOfDateIso: '2026-02-13' })
    ).toHaveLength(1);
  });

  it('Preserves migrated PAGADO & VENCIDO loans and synthesizes CollectionAccountRecord when installments or collection_accounts are absent', () => {
    const migratedCustomer: CustomerRecord = {
      id: 'cust_migrated_1',
      organizationId: 'org_axycore_main',
      documentType: 'CEDULA',
      documentNumber: '00112345678',
      documentKey: 'CEDULA_00112345678',
      firstName: 'Ana',
      lastName: 'Polanco',
      birthDate: '1988-05-10',
      nationality: 'Dominicana',
      maritalStatus: 'Soltera',
      phone: '8095559988',
      email: 'ana.polanco@example.com',
      address: 'Av. Duarte #10',
      municipality: 'Santo Domingo',
      province: 'Distrito Nacional',
      residenceMonths: 36,
      housingType: 'ALQUILADA',
      housingPayment: 12000,
      socialMediaDeclared: 'NO_MEDIA',
      createdBy: 'uid_admin',
    };

    const migratedActiveLoan: LoanRecord = {
      ...baseLoan,
      id: 'loan_mig_active',
      organizationId: 'org_axycore_main',
      loanNumber: 'LN-MIG-001',
      customerId: migratedCustomer.id,
      applicantDisplayName: 'Ana Polanco',
      status: 'ACTIVO',
      currentPrincipalBalance: 45000,
      firstPaymentDate: '2026-03-01',
    };

    const migratedOverdueLoan: LoanRecord = {
      ...baseLoan,
      id: 'loan_mig_overdue',
      organizationId: 'org_axycore_main',
      loanNumber: 'LN-MIG-002',
      customerId: migratedCustomer.id,
      applicantDisplayName: 'Ana Polanco',
      status: 'VENCIDO',
      currentPrincipalBalance: 28000,
      firstPaymentDate: '2026-02-01',
    };

    const migratedPaidLoan: LoanRecord = {
      ...baseLoan,
      id: 'loan_mig_paid',
      organizationId: 'org_axycore_main',
      loanNumber: 'LN-MIG-003',
      customerId: migratedCustomer.id,
      applicantDisplayName: 'Ana Polanco',
      status: 'PAGADO',
      currentPrincipalBalance: 0,
      firstPaymentDate: '2025-10-01',
    };

    // evaluateLoanDelinquency must NEVER downgrade PAGADO or VENCIDO to ACTIVO when installments = []
    const evalPaid = evaluateLoanDelinquency({
      loan: migratedPaidLoan,
      installments: [],
      customer: migratedCustomer,
      asOfDateIso: '2026-02-13',
    });
    expect(evalPaid.derivedLoanStatus).toBe('PAGADO');
    expect(evalPaid.account.stage).toBe('CANCELADO');
    expect(evalPaid.account.dpd).toBe(0);

    const evalOverdue = evaluateLoanDelinquency({
      loan: migratedOverdueLoan,
      installments: [],
      customer: migratedCustomer,
      asOfDateIso: '2026-02-13',
    });
    expect(evalOverdue.derivedLoanStatus).toBe('VENCIDO');
    expect(evalOverdue.account.dpd).toBe(12);
    expect(evalOverdue.account.overdueTotalAmount).toBe(28000);

    // reconcileLiveCollectionAccounts surfaces all 3 loans even with zero collection_accounts & zero installments
    const accounts = reconcileLiveCollectionAccounts({
      loans: [migratedActiveLoan, migratedOverdueLoan, migratedPaidLoan],
      installments: [],
      existingAccounts: [],
      customers: [migratedCustomer],
      asOfDateIso: '2026-02-13',
    });

    expect(accounts).toHaveLength(3);
    expect(accounts.find((a) => a.loanId === 'loan_mig_active')?.customerPhone).toBe('8095559988');
    expect(accounts.find((a) => a.loanId === 'loan_mig_overdue')?.dpd).toBe(12);
    expect(accounts.find((a) => a.loanId === 'loan_mig_paid')?.stage).toBe('CANCELADO');
  });
});

