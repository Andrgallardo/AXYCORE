import { describe, expect, it } from 'vitest';
import {
  buildPayoffQuoteMessage,
  computeLoanPayoffPlan,
  listAllClientsForPayoff,
} from '../engine/collections/loanPayoffEngine';
import { buildBreadcrumbsForSection } from '../engine/navigationBreadcrumbs';
import type { CustomerRecord, LoanInstallmentRecord, LoanRecord } from '../types/axycore';

const ORG_ID = 'org_axycore_main';

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_1',
    organizationId: ORG_ID,
    documentType: 'CEDULA',
    documentNumber: '001-1234567-8',
    documentKey: `${ORG_ID}_CEDULA_00112345678`,
    firstName: 'Carlos',
    lastName: 'Ramírez',
    phone: '809-555-0101',
    email: 'carlos@example.com',
    createdBy: 'admin_1',
    ...overrides,
  };
}

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_1',
    organizationId: ORG_ID,
    loanNumber: 'PRE-2026-0100',
    applicationId: 'app_1',
    disbursementId: 'app_1',
    customerId: 'cust_1',
    applicantDisplayName: 'Carlos Ramírez',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 50000,
    financedExpenses: 0,
    totalFinancedPrincipal: 50000,
    currentPrincipalBalance: 50000,
    contractualRateMonthly: 0.04,
    termMonths: 2,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    maturityDate: '2026-03-01',
    totalContractualInterest: 3000,
    totalContractualPayable: 53000,
    paidPrincipalTotal: 0,
    paidInterestTotal: 0,
    paidLateFeeTotal: 0,
    waivedLateFeeTotal: 0,
    status: 'ACTIVO',
    createdBy: 'admin_1',
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<LoanInstallmentRecord> = {}): LoanInstallmentRecord {
  return {
    id: 'inst_1',
    organizationId: ORG_ID,
    loanId: 'loan_1',
    installmentNumber: 1,
    dueDate: '2026-02-01',
    principalAmount: 25000,
    interestAmount: 2000,
    otherCharges: 0,
    totalAmount: 27000,
    remainingPrincipalBalance: 25000,
    status: 'VENCIDA',
    paidPrincipal: 0,
    paidInterest: 0,
    paidOtherCharges: 0,
    paidLateFee: 0,
    accruedLateFee: 1000,
    waivedLateFee: 0,
    ...overrides,
  };
}

describe('Cobros › Descuentos › Saldos (loanPayoffEngine)', () => {
  it('lists ALL clients including customers without active loans, sorted by balance descending', () => {
    const customers = [
      makeCustomer({ id: 'cust_1', firstName: 'Carlos', lastName: 'Ramírez' }),
      makeCustomer({
        id: 'cust_2',
        firstName: 'Ana',
        lastName: 'Pérez',
        documentNumber: '001-9999999-1',
        documentKey: `${ORG_ID}_CEDULA_00199999991`,
      }),
    ];
    const loans = [makeLoan()];
    const installments = [
      makeInstallment({ id: 'inst_1', installmentNumber: 1, principalAmount: 25000, interestAmount: 2000, accruedLateFee: 1000 }),
      makeInstallment({
        id: 'inst_2',
        installmentNumber: 2,
        dueDate: '2026-03-01',
        principalAmount: 25000,
        interestAmount: 1000,
        accruedLateFee: 0,
        status: 'PENDIENTE',
      }),
    ];

    const list = listAllClientsForPayoff({
      customers,
      loans,
      collectionAccounts: [],
      installments,
      asOfDateIso: '2026-02-15',
    });

    expect(list).toHaveLength(2);
    expect(list[0].customerId).toBe('cust_1');
    expect(list[0].totalOwed).toBeGreaterThan(50000);
    expect(list[1].customerId).toBe('cust_2');
    expect(list[1].hasLoan).toBe(false);
    expect(list[1].status).toBe('SIN_PRESTAMO');
    expect(list[1].totalOwed).toBe(0);
  });

  it('computes FULL_PAYOFF, DISCOUNT_PERCENT, and CUSTOM_AMOUNT plans with exact cent-safe allocation', () => {
    const list = listAllClientsForPayoff({
      customers: [makeCustomer()],
      loans: [makeLoan()],
      collectionAccounts: [],
      installments: [
        makeInstallment({ id: 'inst_1', installmentNumber: 1, dueDate: '2026-02-20', principalAmount: 25000, interestAmount: 2000, accruedLateFee: 0, status: 'PENDIENTE' }),
        makeInstallment({ id: 'inst_2', installmentNumber: 2, dueDate: '2026-03-20', principalAmount: 25000, interestAmount: 1000, accruedLateFee: 0, status: 'PENDIENTE' }),
      ],
      asOfDateIso: '2026-02-15',
    });

    const item = list[0];
    expect(item.totalOwed).toBe(53000);

    // 1. Full Payoff
    const full = computeLoanPayoffPlan({ item, mode: 'FULL_PAYOFF', asOfDateIso: '2026-02-15' });
    expect(full.discountAmount).toBe(0);
    expect(full.finalPayoffAmount).toBe(53000);
    expect(full.installmentUpdates).toHaveLength(2);
    expect(full.installmentUpdates.every((u) => u.nextStatus === 'PAGADA')).toBe(true);

    // 2. Discount Percent (10%)
    const pctPlan = computeLoanPayoffPlan({
      item,
      mode: 'DISCOUNT_PERCENT',
      discountPercent: 10,
      asOfDateIso: '2026-02-15',
    });
    expect(pctPlan.discountAmount).toBe(5300);
    expect(pctPlan.finalPayoffAmount).toBe(47700);
    expect(pctPlan.discountPercent).toBe(10);

    // 3. Custom Payoff Amount (45,000)
    const customPlan = computeLoanPayoffPlan({
      item,
      mode: 'CUSTOM_AMOUNT',
      customPayoffAmount: 45000,
      asOfDateIso: '2026-02-15',
    });
    expect(customPlan.finalPayoffAmount).toBe(45000);
    expect(customPlan.discountAmount).toBe(8000);
    expect(customPlan.discountPercent).toBeCloseTo(15.09, 2);

    const msg = buildPayoffQuoteMessage({
      plan: customPlan,
      organizationName: 'SU GLORIA MANO AMIGA',
      formatCurrency: (v) => `RD$${v.toFixed(2)}`,
    });
    expect(msg).toContain('SU GLORIA MANO AMIGA');
    expect(msg).toContain('SALDO TOTAL A PAGAR: RD$45000.00');
  });

  it('builds nested breadcrumbs Cobros › Descuentos › Mora / Saldos with sibling navigation', () => {
    const moraTrail = buildBreadcrumbsForSection({ activeSection: 'cobranza_discounts_mora' });
    expect(moraTrail.map((s) => s.label)).toEqual(['Inicio', 'Cobros', 'Descuentos', 'Mora']);
    expect(moraTrail[moraTrail.length - 1].siblings?.map((s) => s.sectionId)).toEqual([
      'cobranza_discounts_mora',
      'cobranza_discounts_payoff',
    ]);

    const payoffTrail = buildBreadcrumbsForSection({ activeSection: 'cobranza_discounts_payoff' });
    expect(payoffTrail.map((s) => s.label)).toEqual(['Inicio', 'Cobros', 'Descuentos', 'Saldos']);
  });
});
