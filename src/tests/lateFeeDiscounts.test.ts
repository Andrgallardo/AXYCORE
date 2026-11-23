import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  evaluateLoanDelinquency,
} from '../engine/collections/delinquencyEngine';
import {
  computeLateFeeDiscountPlan,
  listLoansWithPendingLateFee,
} from '../engine/collections/lateFeeDiscountEngine';
import { allocatePaymentAcrossInstallments } from '../engine/collections/paymentsAndReconciliationEngine';
import { buildBreadcrumbsForSection } from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection } from '../engine/rbac';
import type {
  LoanInstallmentRecord,
  LoanRecord,
  PaymentRecord,
} from '../types/axycore';

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_mora_1',
    organizationId: 'org_axycore_main',
    loanNumber: 'PRE-2026-0091',
    applicationId: 'app_1',
    disbursementId: 'disb_1',
    customerId: 'cust_1',
    applicantDisplayName: 'Carlos Mendoza',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 100000,
    contractualRateMonthly: 3.5,
    termMonths: 12,
    frequency: 'MENSUAL',
    amortizationMethod: 'INTERES_FIJO',
    disbursementDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    maturityDate: '2027-01-01',
    totalContractualInterest: 42000,
    totalContractualPayable: 142000,
    status: 'VENCIDO',
    paidPrincipalTotal: 0,
    paidInterestTotal: 0,
    paidLateFeeTotal: 0,
    createdBy: 'u_admin',
    ...overrides,
  };
}

function makeInstallment(overrides: Partial<LoanInstallmentRecord> = {}): LoanInstallmentRecord {
  return {
    id: 'inst_1',
    organizationId: 'org_axycore_main',
    loanId: 'loan_mora_1',
    installmentNumber: 1,
    dueDate: '2026-02-01',
    principalAmount: 10000,
    interestAmount: 2000,
    otherCharges: 0,
    totalAmount: 12000,
    remainingPrincipalBalance: 90000,
    status: 'VENCIDA',
    paidPrincipal: 0,
    paidInterest: 0,
    paidOtherCharges: 0,
    paidLateFee: 0,
    accruedLateFee: 0,
    waivedLateFee: 0,
    ...overrides,
  };
}

describe('Cobros · Descuentos de Mora', () => {
  it('lists ONLY clients/loans with pending Mora > 0 and excludes up-to-date, paid, cancelled, and exempt loans', () => {
    const loanWithMora = makeLoan({
      id: 'loan_with_mora',
      loanNumber: 'PRE-001',
      applicantDisplayName: 'Ana con Mora',
    });
    const loanUpToDate = makeLoan({
      id: 'loan_clean',
      loanNumber: 'PRE-002',
      applicantDisplayName: 'Luis al Día',
      status: 'ACTIVO',
    });
    const loanExempt = makeLoan({
      id: 'loan_exempt',
      loanNumber: 'PRE-003',
      applicantDisplayName: 'María Exenta',
      lateFeeExempt: true,
    });
    const loanCancelled = makeLoan({
      id: 'loan_cancelled',
      loanNumber: 'PRE-004',
      applicantDisplayName: 'Pedro Cancelado',
      status: 'CANCELADO',
    });

    const installments: LoanInstallmentRecord[] = [
      makeInstallment({
        id: 'i_mora_1',
        loanId: 'loan_with_mora',
        dueDate: '2026-02-01',
        accruedLateFee: 500,
      }),
      makeInstallment({
        id: 'i_clean_1',
        loanId: 'loan_clean',
        dueDate: '2026-04-01',
        status: 'PENDIENTE',
        accruedLateFee: 0,
      }),
      makeInstallment({
        id: 'i_exempt_1',
        loanId: 'loan_exempt',
        dueDate: '2026-02-01',
        accruedLateFee: 800,
      }),
      makeInstallment({
        id: 'i_cancelled_1',
        loanId: 'loan_cancelled',
        dueDate: '2026-02-01',
        accruedLateFee: 400,
      }),
    ];

    const list = listLoansWithPendingLateFee({
      loans: [loanWithMora, loanUpToDate, loanExempt, loanCancelled],
      collectionAccounts: [],
      installments,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-03-10',
    });

    expect(list).toHaveLength(1);
    expect(list[0].loanId).toBe('loan_with_mora');
    expect(list[0].pendingLateFee).toBeGreaterThan(0);
  });

  it('applies a specific Mora discount across oldest overdue installments first and preserves the waiver on recalculation & payment allocation', () => {
    const loan = makeLoan({ id: 'loan_partial' });
    const inst1 = makeInstallment({
      id: 'inst_p_1',
      loanId: 'loan_partial',
      installmentNumber: 1,
      dueDate: '2026-02-01',
      accruedLateFee: 600,
    });
    const inst2 = makeInstallment({
      id: 'inst_p_2',
      loanId: 'loan_partial',
      installmentNumber: 2,
      dueDate: '2026-03-01',
      accruedLateFee: 400,
    });

    // Cutoff on 2026-03-03 (within grace days for inst2, so accrued stays 600 and 400 = 1000 total)
    const asOfDateIso = '2026-03-03';
    const plan = computeLateFeeDiscountPlan({
      loan,
      installments: [inst1, inst2],
      mode: 'SPECIFIC_AMOUNT',
      amount: 750,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso,
    });

    expect(plan.previousLateFee).toBe(1000);
    expect(plan.discountAmount).toBe(750);
    expect(plan.nextLateFee).toBe(250);
    expect(plan.nextLateFeeExempt).toBe(false);
    expect(plan.nextWaivedLateFeeTotal).toBe(750);
    expect(plan.installmentUpdates).toHaveLength(2);
    expect(plan.installmentUpdates[0].nextWaivedLateFee).toBe(600);
    expect(plan.installmentUpdates[0].remainingLateFeeAfter).toBe(0);
    expect(plan.installmentUpdates[1].nextWaivedLateFee).toBe(150);
    expect(plan.installmentUpdates[1].remainingLateFeeAfter).toBe(250);

    // Apply updates and re-evaluate delinquency — discounted Mora must NOT regenerate!
    const updatedInsts: LoanInstallmentRecord[] = [inst1, inst2].map((i) => {
      const upd = plan.installmentUpdates.find((u) => u.installmentId === i.id);
      return upd
        ? {
            ...i,
            accruedLateFee: upd.nextAccruedLateFee,
            waivedLateFee: upd.nextWaivedLateFee,
          }
        : i;
    });

    const reEvaluated = evaluateLoanDelinquency({
      loan: { ...loan, waivedLateFeeTotal: plan.nextWaivedLateFeeTotal },
      installments: updatedInsts,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso,
    });
    expect(reEvaluated.account.overdueLateFee).toBe(250);

    // Payment allocation must only charge the remaining 250 Mora (not 1000)
    const payment: PaymentRecord = {
      id: 'pay_1',
      organizationId: loan.organizationId,
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      customerId: loan.customerId,
      customerName: loan.applicantDisplayName,
      amount: 500,
      currency: 'DOP',
      paymentDate: asOfDateIso,
      method: 'TRANSFERENCIA',
      referenceNumber: 'REF-001',
      idempotencyKey: 'idem_pay_1',
      status: 'VERIFICADO',
      reportedByUserId: 'u_admin',
      reportedByName: 'Admin',
    };
    const alloc = allocatePaymentAcrossInstallments({
      payment,
      loan: { ...loan, waivedLateFeeTotal: plan.nextWaivedLateFeeTotal },
      installments: updatedInsts,
      asOfDateIso,
    });
    expect(alloc.appliedLateFeeTotal).toBe(0); // First installment had 0 remaining mora; payment went to inst1 interest/principal first
  });

  it('rejects a specific Mora discount greater than current pending Mora', () => {
    const loan = makeLoan({ id: 'loan_reject' });
    const inst = makeInstallment({
      id: 'inst_r_1',
      loanId: 'loan_reject',
      dueDate: '2026-03-01',
      accruedLateFee: 300,
    });

    expect(() =>
      computeLateFeeDiscountPlan({
        loan,
        installments: [inst],
        mode: 'SPECIFIC_AMOUNT',
        amount: 350,
        policy: DEFAULT_COLLECTION_POLICY_V1,
        asOfDateIso: '2026-03-03',
      })
    ).toThrow(/no puede superar la mora pendiente/i);
  });

  it('removes Mora permanently (PERMANENT_EXEMPT) and prevents future Mora accrual on later cutoffs', () => {
    const loan = makeLoan({ id: 'loan_perm' });
    const inst = makeInstallment({
      id: 'inst_perm_1',
      loanId: 'loan_perm',
      dueDate: '2026-01-15',
      accruedLateFee: 950,
    });

    const plan = computeLateFeeDiscountPlan({
      loan,
      installments: [inst],
      mode: 'PERMANENT_EXEMPT',
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-03-10',
    });

    expect(plan.nextLateFee).toBe(0);
    expect(plan.nextLateFeeExempt).toBe(true);
    expect(plan.discountAmount).toBeGreaterThanOrEqual(950);

    const exemptLoan: LoanRecord = {
      ...loan,
      lateFeeExempt: true,
      waivedLateFeeTotal: plan.nextWaivedLateFeeTotal,
    };
    const updatedInst: LoanInstallmentRecord = {
      ...inst,
      accruedLateFee: plan.installmentUpdates[0].nextAccruedLateFee,
      waivedLateFee: plan.installmentUpdates[0].nextWaivedLateFee,
    };

    // Simulate 90 days later — Mora must stay strictly 0!
    const futureEval = evaluateLoanDelinquency({
      loan: exemptLoan,
      installments: [updatedInst],
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-06-15',
    });

    expect(futureEval.account.overdueLateFee).toBe(0);
    expect(futureEval.account.lateFeeExempt).toBe(true);

    // Must no longer appear in the pending Mora list
    const remainingList = listLoansWithPendingLateFee({
      loans: [exemptLoan],
      collectionAccounts: [futureEval.account],
      installments: futureEval.updatedInstallments,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-06-15',
    });
    expect(remainingList).toHaveLength(0);
  });

  it('clears 100% of current Mora (CLEAR_CURRENT_KEEP_NORMAL) while generating Mora normally if the loan falls overdue again', () => {
    const loan = makeLoan({ id: 'loan_clear_normal' });
    const inst1 = makeInstallment({
      id: 'inst_cn_1',
      loanId: 'loan_clear_normal',
      installmentNumber: 1,
      dueDate: '2026-02-01',
      accruedLateFee: 0,
    });
    const inst2 = makeInstallment({
      id: 'inst_cn_2',
      loanId: 'loan_clear_normal',
      installmentNumber: 2,
      dueDate: '2026-04-01',
      status: 'PENDIENTE',
      accruedLateFee: 0,
    });

    const todayIso = '2026-03-10';
    const plan = computeLateFeeDiscountPlan({
      loan,
      installments: [inst1, inst2],
      mode: 'CLEAR_CURRENT_KEEP_NORMAL',
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: todayIso,
    });

    expect(plan.previousLateFee).toBeGreaterThan(0);
    expect(plan.discountAmount).toBe(plan.previousLateFee);
    expect(plan.nextLateFee).toBe(0);
    expect(plan.nextLateFeeExempt).toBe(false);

    const updatedLoan: LoanRecord = {
      ...loan,
      waivedLateFeeTotal: plan.nextWaivedLateFeeTotal,
      lateFeeExempt: false,
    };
    const updatedInsts: LoanInstallmentRecord[] = [inst1, inst2].map((i) => {
      const upd = plan.installmentUpdates.find((u) => u.installmentId === i.id);
      return upd
        ? {
            ...i,
            accruedLateFee: upd.nextAccruedLateFee,
            waivedLateFee: upd.nextWaivedLateFee,
          }
        : i;
    });

    // Today, Mora is 0 and client leaves the pending Mora list
    const sameDayEval = evaluateLoanDelinquency({
      loan: updatedLoan,
      installments: updatedInsts,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: todayIso,
    });
    expect(sameDayEval.account.overdueLateFee).toBe(0);
    expect(sameDayEval.account.lateFeeExempt).toBe(false);
    expect(
      listLoansWithPendingLateFee({
        loans: [updatedLoan],
        collectionAccounts: [sameDayEval.account],
        installments: sameDayEval.updatedInstallments,
        policy: DEFAULT_COLLECTION_POLICY_V1,
        asOfDateIso: todayIso,
      })
    ).toHaveLength(0);

    // Later, if the client pays inst1 and then falls overdue on inst2 (2026-04-20), normal Mora accrues again
    const instsAfterInst1Paid: LoanInstallmentRecord[] = updatedInsts.map((i) =>
      i.id === 'inst_cn_1'
        ? {
            ...i,
            paidPrincipal: i.principalAmount,
            paidInterest: i.interestAmount,
            status: 'PAGADA',
          }
        : i
    );
    const futureEval = evaluateLoanDelinquency({
      loan: updatedLoan,
      installments: instsAfterInst1Paid,
      policy: DEFAULT_COLLECTION_POLICY_V1,
      asOfDateIso: '2026-04-20',
    });
    expect(futureEval.account.overdueLateFee).toBeGreaterThan(0);
    expect(
      listLoansWithPendingLateFee({
        loans: [updatedLoan],
        collectionAccounts: [futureEval.account],
        installments: futureEval.updatedInstallments,
        policy: DEFAULT_COLLECTION_POLICY_V1,
        asOfDateIso: '2026-04-20',
      })
    ).toHaveLength(1);
  });

  it('registers Descuentos under Cobros breadcrumbs and authorized RBAC roles', () => {
    const crumbs = buildBreadcrumbsForSection({
      activeSection: 'cobranza_discounts',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(crumbs.map((c) => c.label)).toEqual(['Inicio', 'Cobros', 'Descuentos']);
    expect(canRoleAccessSection('ADMIN', 'cobranza_discounts')).toBe(true);
    expect(canRoleAccessSection('COLLECTION_COORDINATOR', 'cobranza_discounts')).toBe(true);
    expect(canRoleAccessSection('SUPERVISOR', 'cobranza_discounts')).toBe(true);
    expect(canRoleAccessSection('FINANCE', 'cobranza_discounts')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'cobranza_discounts')).toBe(false);
  });
});
