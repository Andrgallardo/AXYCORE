import { describe, expect, it } from 'vitest';
import { computeFinancialStatements } from '../engine/accountingEngine';
import { canRoleAccessSection } from '../engine/rbac';
import type {
  CollectionReceiptRecord,
  DisbursementRecord,
  InvestorRecord,
  InvestorTransactionRecord,
  LoanRecord,
  OperatingExpenseRecord,
  PaymentRecord,
} from '../types/axycore';

describe('Accounting Engine & General Operations RBAC', () => {
  const sampleLoans: LoanRecord[] = [
    {
      id: 'loan_1',
      organizationId: 'org_1',
      loanNumber: 'LN-2025-001',
      applicationId: 'app_1',
      disbursementId: 'disb_1',
      customerId: 'cust_1',
      applicantDisplayName: 'Juan Pérez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 100000,
      financedExpenses: 0,
      totalFinancedPrincipal: 100000,
      currentPrincipalBalance: 80000,
      contractualRateMonthly: 2.5,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2025-02-10',
      firstPaymentDate: '2025-03-10',
      maturityDate: '2026-02-10',
      totalContractualInterest: 16984.52,
      totalContractualPayable: 116984.52,
      status: 'ACTIVO',
      createdBy: 'u1',
    },
    {
      id: 'loan_2',
      organizationId: 'org_1',
      loanNumber: 'LN-2026-002',
      applicationId: 'app_2',
      disbursementId: 'disb_2',
      customerId: 'cust_2',
      applicantDisplayName: 'Ana Gómez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      approvedPrincipal: 50000,
      financedExpenses: 0,
      totalFinancedPrincipal: 50000,
      currentPrincipalBalance: 50000,
      contractualRateMonthly: 2.5,
      termMonths: 10,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-01-15',
      firstPaymentDate: '2026-02-15',
      maturityDate: '2026-11-15',
      totalContractualInterest: 7129,
      totalContractualPayable: 57129,
      status: 'ACTIVO',
      createdBy: 'u1',
    },
    {
      id: 'loan_usd',
      organizationId: 'org_1',
      loanNumber: 'LN-2026-USD',
      applicationId: 'app_3',
      disbursementId: 'disb_3',
      customerId: 'cust_3',
      businessId: 'biz_1',
      applicantDisplayName: 'Importadora Sol',
      productCode: 'EMPRESARIAL_USD',
      currency: 'USD',
      approvedPrincipal: 10000,
      financedExpenses: 0,
      totalFinancedPrincipal: 10000,
      currentPrincipalBalance: 10000,
      contractualRateMonthly: 1.5,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementDate: '2026-01-20',
      firstPaymentDate: '2026-02-20',
      maturityDate: '2027-01-20',
      totalContractualInterest: 1001.6,
      totalContractualPayable: 11001.6,
      status: 'ACTIVO',
      createdBy: 'u1',
    },
  ];

  const sampleDisbursements: DisbursementRecord[] = [
    {
      id: 'disb_1',
      organizationId: 'org_1',
      disbursementNumber: 'DES-001',
      applicationId: 'app_1',
      loanId: 'loan_1',
      customerId: 'cust_1',
      approvedAmount: 100000,
      totalFinanced: 100000,
      expenses: 0,
      netDeliveredAmount: 100000,
      disbursementDate: '2025-02-10',
      paymentMethod: 'TRANSFERENCIA',
      financialEntity: 'Banco Popular',
      destinationAccountMasked: '****4321',
      referenceNumber: 'TRF-001',
      idempotencyKey: 'idem_1',
      responsibleUserId: 'u1',
      responsibleUserName: 'Admin',
      authorizerUserId: 'u1',
      authorizerUserName: 'Admin',
      status: 'CONFIRMADO',
    },
  ];

  const sampleReceipts: CollectionReceiptRecord[] = [
    {
      id: 'rec_1',
      organizationId: 'org_1',
      receiptNumber: 'REC-001',
      paymentId: 'pay_1',
      loanId: 'loan_1',
      loanNumber: 'LN-2025-001',
      customerId: 'cust_1',
      customerName: 'Juan Pérez',
      paymentDate: '2025-03-10',
      currency: 'DOP',
      amount: 25000,
      appliedToCharges: 200,
      appliedToLateFee: 800,
      appliedToInterest: 4000,
      appliedToPrincipal: 20000,
      remainingPrincipalAfter: 80000,
      referenceNumber: 'TRF-R1',
      status: 'EMITIDO',
      issuedBy: 'u1',
      issuedByName: 'Cajero',
      issuedAt: '2025-03-10T12:00:00Z',
    },
    {
      id: 'rec_2',
      organizationId: 'org_1',
      receiptNumber: 'REC-002',
      paymentId: 'pay_2',
      loanId: 'loan_2',
      loanNumber: 'LN-2026-002',
      customerId: 'cust_2',
      customerName: 'Ana Gómez',
      paymentDate: '2026-02-15',
      currency: 'DOP',
      amount: 7500,
      appliedToCharges: 0,
      appliedToLateFee: 500,
      appliedToInterest: 2000,
      appliedToPrincipal: 5000,
      remainingPrincipalAfter: 45000,
      referenceNumber: 'CAJA-R2',
      status: 'EMITIDO',
      issuedBy: 'u1',
      issuedByName: 'Cajero',
      issuedAt: '2026-02-15T12:00:00Z',
    },
  ];

  const samplePayments: PaymentRecord[] = [];

  const sampleExpenses: OperatingExpenseRecord[] = [
    {
      id: 'exp_1',
      organizationId: 'org_1',
      expenseNumber: 'GST-202502-001',
      expenseDate: '2025-02-28',
      category: 'NOMINA',
      concept: 'Nómina Febrero',
      vendorName: 'Equipo Axy',
      currency: 'DOP',
      amount: 12000,
      paymentMethod: 'TRANSFERENCIA',
      status: 'PAGADO',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
    {
      id: 'exp_2',
      organizationId: 'org_1',
      expenseNumber: 'GST-202602-002',
      expenseDate: '2026-02-20',
      category: 'ALQUILER',
      concept: 'Alquiler Oficina Febrero',
      vendorName: 'Inmobiliaria Norte',
      currency: 'DOP',
      amount: 3500,
      paymentMethod: 'TRANSFERENCIA',
      status: 'PENDIENTE',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
    {
      id: 'exp_void',
      organizationId: 'org_1',
      expenseNumber: 'GST-202602-VOID',
      expenseDate: '2026-02-22',
      category: 'OTROS',
      concept: 'Gasto duplicado',
      vendorName: 'Proveedor X',
      currency: 'DOP',
      amount: 99999,
      paymentMethod: 'EFECTIVO',
      status: 'ANULADO',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
    {
      id: 'exp_usd',
      organizationId: 'org_1',
      expenseNumber: 'GST-202601-USD',
      expenseDate: '2026-01-10',
      category: 'TECNOLOGIA',
      concept: 'Servidores Cloud',
      vendorName: 'Cloud Inc',
      currency: 'USD',
      amount: 400,
      paymentMethod: 'TARJETA',
      status: 'PAGADO',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
  ];

  const sampleInvestors: InvestorRecord[] = [
    {
      id: 'inv_1',
      organizationId: 'org_1',
      investorCode: 'INV-001',
      fullName: 'Fondo Capital Caribe',
      investorType: 'PERSONA_JURIDICA',
      documentNumber: '130-00001-1',
      phone: '809-555-0199',
      currency: 'DOP',
      annualReturnRatePct: 12,
      joinDate: '2025-01-05',
      currentInvestedBalance: 180000,
      totalContributed: 200000,
      totalWithdrawn: 20000,
      totalReturnsPaid: 5000,
      status: 'ACTIVO',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
  ];

  const sampleInvestorTxs: InvestorTransactionRecord[] = [
    {
      id: 'itx_1',
      organizationId: 'org_1',
      investorId: 'inv_1',
      investorName: 'Fondo Capital Caribe',
      transactionType: 'APORTE_CAPITAL',
      transactionDate: '2025-01-05',
      currency: 'DOP',
      amount: 200000,
      paymentMethod: 'TRANSFERENCIA',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
    {
      id: 'itx_2',
      organizationId: 'org_1',
      investorId: 'inv_1',
      investorName: 'Fondo Capital Caribe',
      transactionType: 'RETIRO_CAPITAL',
      transactionDate: '2026-03-01',
      currency: 'DOP',
      amount: 20000,
      paymentMethod: 'TRANSFERENCIA',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
    {
      id: 'itx_3',
      organizationId: 'org_1',
      investorId: 'inv_1',
      investorName: 'Fondo Capital Caribe',
      transactionType: 'PAGO_RENDIMIENTO',
      transactionDate: '2026-03-05',
      currency: 'DOP',
      amount: 5000,
      paymentMethod: 'TRANSFERENCIA',
      createdBy: 'u1',
      createdByName: 'Admin',
    },
  ];

  it('computes 12 monthly columns + multi-year cumulative columns with exact balance sheet identity', () => {
    const report = computeFinancialStatements({
      currency: 'DOP',
      year: 2026,
      loans: sampleLoans,
      disbursements: sampleDisbursements,
      collectionReceipts: sampleReceipts,
      payments: samplePayments,
      operatingExpenses: sampleExpenses,
      investors: sampleInvestors,
      investorTransactions: sampleInvestorTxs,
    });

    expect(report.monthlyColumns).toHaveLength(12);
    expect(report.availableYears).toEqual([2025, 2026]);
    expect(report.annualColumns).toHaveLength(2);

    // Every single column (12 months, year total, 2 annual, 1 cumulative) must satisfy Assets === Liabilities + Equity
    const allCols = [
      ...report.monthlyColumns,
      report.yearTotalColumn,
      ...report.annualColumns,
      report.cumulativeAllYearsColumn,
    ];
    for (const col of allCols) {
      expect(col.balanceSheet.balanceDiff).toBe(0);
      expect(col.cashFlow.endingCashBalance).toBe(col.balanceSheet.cashAndBanks);
    }

    // 2026 Feb income statement: interest=2000, lateFee=500 -> revenue 2500, expense 3500 (pending), netIncome = -1000
    const feb2026 = report.monthlyColumns[1];
    expect(feb2026.incomeStatement.totalRevenue).toBe(2500);
    expect(feb2026.incomeStatement.operatingExpensesTotal).toBe(3500);
    expect(feb2026.incomeStatement.netIncome).toBe(-1000);
    // Annulled expense (99,999) must not be included
    expect(feb2026.incomeStatement.expensesByCategory.OTROS).toBe(0);

    // Cumulative 2025+2026:
    // Revenue = (4000+800+200) + (2000+500) = 7500
    // OpEx = 12000 + 3500 = 15500
    // Yield cost = 5000
    // Net income = 7500 - 15500 - 5000 = -13000
    const cum = report.cumulativeAllYearsColumn;
    expect(cum.incomeStatement.totalRevenue).toBe(7500);
    expect(cum.incomeStatement.operatingExpensesTotal).toBe(15500);
    expect(cum.incomeStatement.investorYieldCost).toBe(5000);
    expect(cum.incomeStatement.netIncome).toBe(-13000);

    // Loan portfolio receivable = (100,000 + 50,000) disbursed - (20,000 + 5,000) recovered = 125,000
    expect(cum.balanceSheet.loanPortfolioReceivable).toBe(125000);
    // Investor capital payable = 200,000 contributed - 20,000 withdrawn = 180,000
    expect(cum.balanceSheet.investorCapitalPayable).toBe(180000);
    // Accounts payable = 3,500 pending expense
    expect(cum.balanceSheet.accountsPayableExpenses).toBe(3500);
    // Cash = +200,000 - 20,000 - 5,000 (financing=175,000) + 25,000 - 150,000 (investing=-125,000) + 7,500 - 12,000 (operating=-4,500) = 45,500
    expect(cum.balanceSheet.cashAndBanks).toBe(45500);
    // Total Assets = 45,500 + 125,000 = 170,500; Liabilities+Equity = 183,500 - 13,000 = 170,500
    expect(cum.balanceSheet.totalAssets).toBe(170500);
    expect(cum.balanceSheet.totalLiabilitiesAndEquity).toBe(170500);
  });

  it('isolates USD financial statements from DOP transactions', () => {
    const usdReport = computeFinancialStatements({
      currency: 'USD',
      year: 2026,
      loans: sampleLoans,
      disbursements: sampleDisbursements,
      collectionReceipts: sampleReceipts,
      payments: samplePayments,
      operatingExpenses: sampleExpenses,
      investors: sampleInvestors,
      investorTransactions: sampleInvestorTxs,
    });

    const cum = usdReport.cumulativeAllYearsColumn;
    expect(cum.balanceSheet.loanPortfolioReceivable).toBe(10000);
    expect(cum.incomeStatement.operatingExpensesTotal).toBe(400);
    expect(cum.balanceSheet.investorCapitalPayable).toBe(0);
    expect(cum.balanceSheet.balanceDiff).toBe(0);
  });

  it('enforces RBAC access for Operaciones Generales sections', () => {
    expect(canRoleAccessSection('ADMIN', 'accounting')).toBe(true);
    expect(canRoleAccessSection('FINANCE', 'accounting_statements')).toBe(true);
    expect(canRoleAccessSection('OPERATIONS', 'register_expense')).toBe(true);
    expect(canRoleAccessSection('MANAGEMENT', 'register_investor')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'accounting_statements')).toBe(true);

    expect(canRoleAccessSection('CASHIER', 'register_payment')).toBe(true);
    expect(canRoleAccessSection('CASHIER', 'register_expense')).toBe(false);
    expect(canRoleAccessSection('CASHIER', 'register_investor')).toBe(false);

    expect(canRoleAccessSection('COLLECTION_AGENT', 'register_payment')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'accounting')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'register_payment')).toBe(false);
  });
});
