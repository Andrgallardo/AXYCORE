import { describe, expect, it } from 'vitest';
import {
  analyzeLoanHealth,
  buildAmortizationCsv,
  buildPrincipalDonutSegments,
  groupClientMessageThreads,
  simulateClientRenewal,
} from '../engine/clientPortalHealthEngine';
import type {
  ClientPortalMessageRecord,
  LoanInstallmentRecord,
  LoanRecord,
} from '../types/axycore';

function makeLoan(overrides: Partial<LoanRecord> = {}): LoanRecord {
  return {
    id: 'loan_001',
    organizationId: 'org_axycore_main',
    loanNumber: 'PR-2026-0001',
    applicationId: 'app_001',
    disbursementId: 'disb_001',
    customerId: 'cust_001',
    applicantDisplayName: 'María González',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    approvedPrincipal: 100000,
    financedExpenses: 0,
    totalFinancedPrincipal: 100000,
    currentPrincipalBalance: 60000,
    contractualRateMonthly: 0.03,
    termMonths: 12,
    frequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    disbursementDate: '2026-01-01',
    firstPaymentDate: '2026-02-01',
    maturityDate: '2027-01-01',
    totalContractualInterest: 20554,
    totalContractualPayable: 120554,
    status: 'ACTIVO',
    createdBy: 'uid_client_1',
    ...overrides,
  };
}

function makeInstallment(
  num: number,
  dueDate: string,
  status: LoanInstallmentRecord['status'],
  extra: Partial<LoanInstallmentRecord> = {}
): LoanInstallmentRecord {
  return {
    id: `inst_${num}`,
    organizationId: 'org_axycore_main',
    loanId: 'loan_001',
    installmentNumber: num,
    dueDate,
    principalAmount: 8000,
    interestAmount: 2000,
    otherCharges: 0,
    totalAmount: 10000,
    remainingPrincipalBalance: Math.max(0, 100000 - num * 8000),
    status,
    paidPrincipal: status === 'PAGADA' ? 8000 : 0,
    paidInterest: status === 'PAGADA' ? 2000 : 0,
    paidOtherCharges: 0,
    paidLateFee: 0,
    accruedLateFee: 0,
    waivedLateFee: 0,
    ...extra,
  };
}

describe('clientPortalHealthEngine', () => {
  it('classifies an up-to-date loan as AL_DIA and renewal eligible at >=25% paid', () => {
    const loan = makeLoan({ currentPrincipalBalance: 60000 });
    const installments = [
      makeInstallment(1, '2026-02-01', 'PAGADA'),
      makeInstallment(2, '2026-03-01', 'PAGADA'),
      makeInstallment(3, '2026-05-20', 'PENDIENTE'),
    ];

    const health = analyzeLoanHealth(loan, installments, '2026-05-01');
    expect(health.healthLevel).toBe('AL_DIA');
    expect(health.paidPrincipalPct).toBe(40);
    expect(health.needsHardshipAssistance).toBe(false);
    expect(health.renewalEligible).toBe(true);
    expect(health.daysUntilNextDue).toBe(19);
    expect(health.nextDueInstallment?.installmentNumber).toBe(3);
  });

  it('flags PROXIMO_VENCIMIENTO when next installment is due within 5 days', () => {
    const loan = makeLoan();
    const installments = [
      makeInstallment(1, '2026-02-01', 'PAGADA'),
      makeInstallment(2, '2026-05-04', 'PENDIENTE'),
    ];

    const health = analyzeLoanHealth(loan, installments, '2026-05-01');
    expect(health.healthLevel).toBe('PROXIMO_VENCIMIENTO');
    expect(health.daysUntilNextDue).toBe(3);
    expect(health.needsHardshipAssistance).toBe(false);
  });

  it('flags MORA_CRITICA and enables hardship assistance when multiple installments or >=15 days overdue', () => {
    const loan = makeLoan({ status: 'VENCIDO', currentPrincipalBalance: 80000 });
    const installments = [
      makeInstallment(1, '2026-03-01', 'VENCIDA', { accruedLateFee: 850 }),
      makeInstallment(2, '2026-04-01', 'VENCIDA', { accruedLateFee: 450 }),
      makeInstallment(3, '2026-05-15', 'PENDIENTE'),
    ];

    const health = analyzeLoanHealth(loan, installments, '2026-05-01');
    expect(health.healthLevel).toBe('MORA_CRITICA');
    expect(health.isCriticalArrears).toBe(true);
    expect(health.needsHardshipAssistance).toBe(true);
    expect(health.overdueInstallmentsCount).toBe(2);
    expect(health.overdueAmount).toBe(20000);
    expect(health.accruedLateFeeTotal).toBe(1300);
    expect(health.amountToCatchUp).toBe(21300);
    expect(health.maxDaysPastDue).toBeGreaterThanOrEqual(60);
    expect(health.renewalEligible).toBe(false);
  });

  it('simulates client renewal payoff deduction and net cash disbursement accurately', () => {
    const loan = makeLoan({ currentPrincipalBalance: 45000, contractualRateMonthly: 0.03 });
    const installments = [
      makeInstallment(1, '2026-06-01', 'PENDIENTE'),
    ];

    const sim = simulateClientRenewal({
      baseLoan: loan,
      installments,
      requestedAmount: 100000,
      requestedTermMonths: 12,
      frequency: 'MENSUAL',
      referenceDateIso: '2026-05-01',
    });

    expect(sim.coversPayoff).toBe(true);
    expect(sim.estimatedPayoff).toBe(45000);
    expect(sim.estimatedNetDisbursement).toBe(55000);
    expect(sim.periodCount).toBe(12);
    expect(sim.estimatedInstallment).toBeGreaterThan(9500);
    expect(sim.estimatedInstallment).toBeLessThan(10500);
  });

  it('generates UTF-8 BOM CSV for amortization download', () => {
    const loan = makeLoan();
    const installments = [
      makeInstallment(1, '2026-02-01', 'PAGADA'),
      makeInstallment(2, '2026-03-01', 'PENDIENTE', { accruedLateFee: 250 }),
    ];

    const csv = buildAmortizationCsv(loan, installments);
    expect(csv.startsWith('\uFEFFPrestamo,Moneda,Cuota #')).toBe(true);
    expect(csv).toContain('PR-2026-0001,DOP,1,2026-02-01');
    expect(csv).toContain('250.00');
  });

  it('groups client portal messages into per-client threads sorted by latest timestamp with unread counts', () => {
    const msgs: ClientPortalMessageRecord[] = [
      {
        id: 'm1',
        organizationId: 'org_1',
        clientUid: 'client_a',
        clientEmail: 'ana@example.com',
        clientName: 'Ana Pérez',
        senderUid: 'client_a',
        senderName: 'Ana Pérez',
        senderRole: 'CLIENT',
        category: 'PAGOS_Y_CUOTAS',
        body: 'Hola, subí mi comprobante',
        readByClient: true,
        readByStaff: false,
        createdAt: 1000,
      },
      {
        id: 'm2',
        organizationId: 'org_1',
        clientUid: 'client_b',
        clientEmail: 'luis@example.com',
        clientName: 'Luis Mejía',
        loanNumber: 'PR-2026-0099',
        senderUid: 'client_b',
        senderName: 'Luis Mejía',
        senderRole: 'CLIENT',
        category: 'AYUDA_ATRASO',
        body: 'Necesito un acuerdo de pago por favor',
        readByClient: true,
        readByStaff: false,
        createdAt: 3000,
      },
      {
        id: 'm3',
        organizationId: 'org_1',
        clientUid: 'client_a',
        clientEmail: 'ana@example.com',
        clientName: 'Ana Pérez',
        senderUid: 'admin_1',
        senderName: 'Admin Org',
        senderRole: 'ADMIN_STAFF',
        category: 'PAGOS_Y_CUOTAS',
        body: 'Recibido Ana, ya fue validado.',
        readByClient: false,
        readByStaff: true,
        createdAt: 2000,
      },
    ];

    const threads = groupClientMessageThreads(msgs);
    expect(threads).toHaveLength(2);
    expect(threads[0].clientUid).toBe('client_b');
    expect(threads[0].unreadByStaffCount).toBe(1);
    expect(threads[0].latestLoanNumber).toBe('PR-2026-0099');
    expect(threads[1].clientUid).toBe('client_a');
    expect(threads[1].messages.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(threads[1].unreadByClientCount).toBe(1);
  });

  it('builds accurate Capital pagado vs. Capital pendiente donut segments across repayment states', () => {
    const partialLoan = makeLoan({
      totalFinancedPrincipal: 100000,
      currentPrincipalBalance: 62500,
    });
    const partial = buildPrincipalDonutSegments(partialLoan);
    expect(partial.paidPrincipal).toBe(37500);
    expect(partial.pendingPrincipal).toBe(62500);
    expect(partial.paidPct).toBe(37.5);
    expect(partial.pendingPct).toBe(62.5);
    expect(partial.segments.map((s) => s.name)).toEqual(['Capital pagado', 'Capital pendiente']);

    const fullyPaidLoan = makeLoan({
      totalFinancedPrincipal: 80000,
      currentPrincipalBalance: 0,
      status: 'PAGADO',
    });
    const settled = buildPrincipalDonutSegments(fullyPaidLoan);
    expect(settled.paidPrincipal).toBe(80000);
    expect(settled.pendingPrincipal).toBe(0);
    expect(settled.paidPct).toBe(100);
    expect(settled.pendingPct).toBe(0);
  });
});
