import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CustomerRecord,
  LoanRecord,
} from '../types/axycore';

export type CustomerPortfolioStatus = 'ACTIVO' | 'INACTIVO' | 'SIN_PRESTAMOS';
export type CustomerDirectoryFilter = 'ALL' | 'ACTIVO' | 'INACTIVO';

export interface CustomerDirectorySummary {
  customer: CustomerRecord;
  portfolioStatus: CustomerPortfolioStatus;
  activeLoansCount: number;
  canceledLoansCount: number;
  totalLoansCount: number;
  totalActiveBalanceDop: number;
  totalActiveBalanceUsd: number;
  applicationsCount: number;
  lastLoanNumber: string | null;
  lastClosedAt: string | null;
}

export function isLoanCanceledOrPaidOff(
  loan: Pick<LoanRecord, 'status' | 'currentPrincipalBalance'>,
  collectionAccount?: Pick<CollectionAccountRecord, 'stage'>
): boolean {
  if (
    loan.status === 'CANCELADO' ||
    loan.status === 'CANCELADO_POR_RENOVACION' ||
    loan.status === 'PAGADO'
  ) {
    return true;
  }
  if (collectionAccount?.stage === 'CANCELADO') {
    return true;
  }
  return false;
}

export function classifyCustomerPortfolioStatus(params: {
  customerLoans: LoanRecord[];
  collectionAccountsByLoanId?: Map<string, CollectionAccountRecord>;
}): {
  portfolioStatus: CustomerPortfolioStatus;
  activeLoansCount: number;
  canceledLoansCount: number;
  totalLoansCount: number;
  totalActiveBalanceDop: number;
  totalActiveBalanceUsd: number;
  lastLoanNumber: string | null;
  lastClosedAt: string | null;
} {
  const { customerLoans, collectionAccountsByLoanId } = params;
  let activeLoansCount = 0;
  let canceledLoansCount = 0;
  let totalActiveBalanceDop = 0;
  let totalActiveBalanceUsd = 0;
  let lastLoanNumber: string | null = null;
  let lastClosedAt: string | null = null;

  for (const loan of customerLoans) {
    lastLoanNumber = loan.loanNumber || lastLoanNumber;
    const acc = collectionAccountsByLoanId?.get(loan.id);
    if (isLoanCanceledOrPaidOff(loan, acc)) {
      canceledLoansCount += 1;
      if (loan.closedAt && (!lastClosedAt || loan.closedAt > lastClosedAt)) {
        lastClosedAt = loan.closedAt;
      }
    } else {
      activeLoansCount += 1;
      const balance = Number(loan.currentPrincipalBalance || 0);
      if (loan.currency === 'USD') {
        totalActiveBalanceUsd += balance;
      } else {
        totalActiveBalanceDop += balance;
      }
    }
  }

  let portfolioStatus: CustomerPortfolioStatus = 'SIN_PRESTAMOS';
  if (activeLoansCount > 0) {
    portfolioStatus = 'ACTIVO';
  } else if (canceledLoansCount > 0) {
    portfolioStatus = 'INACTIVO';
  }

  return {
    portfolioStatus,
    activeLoansCount,
    canceledLoansCount,
    totalLoansCount: customerLoans.length,
    totalActiveBalanceDop,
    totalActiveBalanceUsd,
    lastLoanNumber,
    lastClosedAt,
  };
}

export function buildCustomerDirectorySummaries(params: {
  customers: CustomerRecord[];
  loans: LoanRecord[];
  applications?: ApplicationRecord[];
  collectionAccounts?: CollectionAccountRecord[];
}): CustomerDirectorySummary[] {
  const { customers, loans, applications = [], collectionAccounts = [] } = params;

  const accByLoanId = new Map<string, CollectionAccountRecord>();
  for (const acc of collectionAccounts) {
    accByLoanId.set(acc.loanId, acc);
  }

  const loansByCustomerId = new Map<string, LoanRecord[]>();
  for (const loan of loans) {
    const existing = loansByCustomerId.get(loan.customerId) ?? [];
    existing.push(loan);
    loansByCustomerId.set(loan.customerId, existing);
  }

  const appsByCustomerId = new Map<string, number>();
  for (const app of applications) {
    appsByCustomerId.set(app.customerId, (appsByCustomerId.get(app.customerId) ?? 0) + 1);
  }

  return customers.map((customer) => {
    const customerLoans = (loansByCustomerId.get(customer.id) ?? []).filter(
      (l) => !customer.organizationId || l.organizationId === customer.organizationId
    );
    const metrics = classifyCustomerPortfolioStatus({
      customerLoans,
      collectionAccountsByLoanId: accByLoanId,
    });

    return {
      customer,
      ...metrics,
      applicationsCount: appsByCustomerId.get(customer.id) ?? 0,
    };
  });
}

export function filterCustomerDirectory(
  summaries: CustomerDirectorySummary[],
  filter: CustomerDirectoryFilter,
  searchQuery = ''
): CustomerDirectorySummary[] {
  const q = searchQuery.trim().toLowerCase();

  return summaries.filter((item) => {
    if (filter === 'ACTIVO' && item.portfolioStatus !== 'ACTIVO') {
      return false;
    }
    if (filter === 'INACTIVO' && item.portfolioStatus !== 'INACTIVO') {
      return false;
    }
    if (!q) return true;

    const c = item.customer;
    const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
    return (
      fullName.includes(q) ||
      (c.documentNumber || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.altPhone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.province || '').toLowerCase().includes(q) ||
      (c.municipality || '').toLowerCase().includes(q)
    );
  });
}
