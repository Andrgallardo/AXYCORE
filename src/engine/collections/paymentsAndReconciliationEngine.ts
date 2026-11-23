import type {
  BankTransactionRecord,
  CollectionPolicyVersionRecord,
  CollectionReceiptRecord,
  CurrencyCode,
  LoanInstallmentRecord,
  LoanRecord,
  MatchConfidenceType,
  PaymentAllocationRecord,
  PaymentComponentKey,
  PaymentRecord,
  ReconciliationExceptionRecord,
  ReconciliationMatchRecord,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  diffCalendarDays,
  fromCents,
  toCents,
} from './delinquencyEngine';

export interface AllocationComputationResult {
  allocations: PaymentAllocationRecord[];
  updatedInstallments: LoanInstallmentRecord[];
  nextLoanPrincipalBalance: number;
  appliedPrincipalTotal: number;
  appliedInterestTotal: number;
  appliedLateFeeTotal: number;
  appliedChargesTotal: number;
  extraPrincipalPrepayment: number;
  unappliedSurplus: number;
  nextLoanStatus: LoanRecord['status'];
}

export function allocatePaymentAcrossInstallments(params: {
  payment: PaymentRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  imputationOrder?: PaymentComponentKey[];
  asOfDateIso?: string;
}): AllocationComputationResult {
  const {
    payment,
    loan,
    installments,
    imputationOrder = DEFAULT_COLLECTION_POLICY_V1.imputationOrder,
    asOfDateIso = payment.paymentDate,
  } = params;

  if (loan.status === 'CANCELADO' || loan.status === 'CANCELADO_POR_RENOVACION') {
    throw new Error('No se pueden aplicar pagos a un préstamo CANCELADO o liquidado por renovación.');
  }
  if (payment.currency !== loan.currency) {
    throw new Error(
      `Moneda incompatible: el pago está en ${payment.currency} y el préstamo en ${loan.currency}.`
    );
  }
  const paymentCents = toCents(payment.amount);
  if (paymentCents <= 0) {
    throw new Error('El monto del pago debe ser mayor que cero.');
  }
  if (payment.status === 'APLICADO') {
    throw new Error('Idempotencia: este pago ya fue aplicado previamente.');
  }
  if (payment.status === 'REVERTIDO' || payment.status === 'RECHAZADO') {
    throw new Error(`No se puede aplicar un pago en estado ${payment.status}.`);
  }

  let remainingCents = paymentCents;
  const sortedInsts = [...installments].sort(
    (a, b) => a.installmentNumber - b.installmentNumber
  );

  const allocations: PaymentAllocationRecord[] = [];
  let totalAppliedPrincipalCents = 0;
  let totalAppliedInterestCents = 0;
  let totalAppliedLateFeeCents = 0;
  let totalAppliedChargesCents = 0;

  const updatedInstallments = sortedInsts.map((inst) => {
    if (remainingCents <= 0 || inst.status === 'PAGADA') {
      return inst;
    }

    let dueMora = loan.lateFeeExempt
      ? 0
      : Math.max(
          0,
          toCents(inst.accruedLateFee ?? 0) -
            toCents(inst.paidLateFee ?? 0) -
            toCents(inst.waivedLateFee ?? 0)
        );
    let dueCharges = Math.max(0, toCents(inst.otherCharges) - toCents(inst.paidOtherCharges ?? 0));
    let dueInterest = Math.max(0, toCents(inst.interestAmount) - toCents(inst.paidInterest ?? 0));
    let duePrincipal = Math.max(0, toCents(inst.principalAmount) - toCents(inst.paidPrincipal ?? 0));

    if (dueMora + dueCharges + dueInterest + duePrincipal === 0) {
      return { ...inst, status: 'PAGADA' as const };
    }

    let addMora = 0;
    let addCharges = 0;
    let addInterest = 0;
    let addPrincipal = 0;

    for (const component of imputationOrder) {
      if (remainingCents <= 0) break;
      if (component === 'MORA' && dueMora > 0) {
        const take = Math.min(remainingCents, dueMora);
        addMora += take;
        dueMora -= take;
        remainingCents -= take;
      } else if (component === 'CARGOS' && dueCharges > 0) {
        const take = Math.min(remainingCents, dueCharges);
        addCharges += take;
        dueCharges -= take;
        remainingCents -= take;
      } else if (component === 'INTERES' && dueInterest > 0) {
        const take = Math.min(remainingCents, dueInterest);
        addInterest += take;
        dueInterest -= take;
        remainingCents -= take;
      } else if (component === 'CAPITAL' && duePrincipal > 0) {
        const take = Math.min(remainingCents, duePrincipal);
        addPrincipal += take;
        duePrincipal -= take;
        remainingCents -= take;
      }
    }

    const totalForInstCents = addMora + addCharges + addInterest + addPrincipal;
    if (totalForInstCents > 0) {
      totalAppliedLateFeeCents += addMora;
      totalAppliedChargesCents += addCharges;
      totalAppliedInterestCents += addInterest;
      totalAppliedPrincipalCents += addPrincipal;

      allocations.push({
        id: `alloc_${payment.id}_c${String(inst.installmentNumber).padStart(3, '0')}`,
        organizationId: payment.organizationId,
        paymentId: payment.id,
        loanId: loan.id,
        installmentId: inst.id,
        installmentNumber: inst.installmentNumber,
        currency: loan.currency,
        appliedToLateFee: fromCents(addMora),
        appliedToCharges: fromCents(addCharges),
        appliedToInterest: fromCents(addInterest),
        appliedToPrincipal: fromCents(addPrincipal),
        totalAllocated: fromCents(totalForInstCents),
        reversed: false,
      });
    }

    const fullyCleared = dueMora === 0 && dueCharges === 0 && dueInterest === 0 && duePrincipal === 0;
    const paidAny =
      toCents(inst.paidPrincipal ?? 0) +
        addPrincipal +
        toCents(inst.paidInterest ?? 0) +
        addInterest +
        toCents(inst.paidOtherCharges ?? 0) +
        addCharges +
        toCents(inst.paidLateFee ?? 0) +
        addMora >
      0;

    let nextStatus: LoanInstallmentRecord['status'] = inst.status;
    if (fullyCleared) {
      nextStatus = 'PAGADA';
    } else if (inst.dueDate < asOfDateIso) {
      nextStatus = 'VENCIDA';
    } else if (paidAny) {
      nextStatus = 'PARCIAL';
    }

    return {
      ...inst,
      paidLateFee: fromCents(toCents(inst.paidLateFee ?? 0) + addMora),
      paidOtherCharges: fromCents(toCents(inst.paidOtherCharges ?? 0) + addCharges),
      paidInterest: fromCents(toCents(inst.paidInterest ?? 0) + addInterest),
      paidPrincipal: fromCents(toCents(inst.paidPrincipal ?? 0) + addPrincipal),
      status: nextStatus,
      paidAt: fullyCleared ? payment.paymentDate : inst.paidAt ?? null,
    };
  });

  // Any remaining cents after scheduled installments reduce remaining principal balance (prepayment)
  const currentLoanPrincipalCents = toCents(loan.currentPrincipalBalance);
  const remainingPrincipalAfterInstsCents = Math.max(
    0,
    currentLoanPrincipalCents - totalAppliedPrincipalCents
  );

  let extraPrincipalPrepaymentCents = 0;
  let unappliedSurplusCents = 0;
  if (remainingCents > 0) {
    if (remainingPrincipalAfterInstsCents > 0) {
      extraPrincipalPrepaymentCents = Math.min(remainingCents, remainingPrincipalAfterInstsCents);
      totalAppliedPrincipalCents += extraPrincipalPrepaymentCents;
      remainingCents -= extraPrincipalPrepaymentCents;
    } else if (allocations.length === 0 && totalAppliedPrincipalCents === 0) {
      // Fallback for migrated/open loans whose scheduled installments were already marked PAGADA or balance was 0
      extraPrincipalPrepaymentCents = remainingCents;
      totalAppliedPrincipalCents += extraPrincipalPrepaymentCents;
      remainingCents = 0;
    }
    unappliedSurplusCents = remainingCents;
  }

  // Ensure at least one valid PaymentAllocationRecord exists whenever payment amount > 0
  if (allocations.length === 0 && paymentCents > 0) {
    const appliedCapCents =
      totalAppliedPrincipalCents > 0 ? totalAppliedPrincipalCents : paymentCents;
    if (totalAppliedPrincipalCents === 0) {
      totalAppliedPrincipalCents = appliedCapCents;
    }
    const fallbackInst = sortedInsts[sortedInsts.length - 1];
    const fallbackInstNumber = fallbackInst?.installmentNumber ?? 1;
    allocations.push({
      id: `alloc_${payment.id}_c${String(fallbackInstNumber).padStart(3, '0')}`,
      organizationId: payment.organizationId,
      paymentId: payment.id,
      loanId: loan.id,
      installmentId: fallbackInst?.id ?? `${loan.id}_cuota_001`,
      installmentNumber: fallbackInstNumber,
      currency: loan.currency,
      appliedToLateFee: 0,
      appliedToCharges: 0,
      appliedToInterest: 0,
      appliedToPrincipal: fromCents(appliedCapCents),
      totalAllocated: fromCents(appliedCapCents),
      reversed: false,
    });
  }

  const nextLoanPrincipalBalanceCents = Math.max(
    0,
    currentLoanPrincipalCents - totalAppliedPrincipalCents
  );

  const anyOverdueRemaining = updatedInstallments.some(
    (i) => i.status !== 'PAGADA' && i.dueDate < asOfDateIso
  );
  const allPaid =
    nextLoanPrincipalBalanceCents === 0 &&
    updatedInstallments.every((i) => i.status === 'PAGADA');

  const nextLoanStatus: LoanRecord['status'] = allPaid
    ? 'PAGADO'
    : anyOverdueRemaining
    ? 'VENCIDO'
    : 'ACTIVO';

  return {
    allocations,
    updatedInstallments,
    nextLoanPrincipalBalance: fromCents(nextLoanPrincipalBalanceCents),
    appliedPrincipalTotal: fromCents(totalAppliedPrincipalCents),
    appliedInterestTotal: fromCents(totalAppliedInterestCents),
    appliedLateFeeTotal: fromCents(totalAppliedLateFeeCents),
    appliedChargesTotal: fromCents(totalAppliedChargesCents),
    extraPrincipalPrepayment: fromCents(extraPrincipalPrepaymentCents),
    unappliedSurplus: fromCents(unappliedSurplusCents),
    nextLoanStatus,
  };
}

export interface ReversalComputationResult {
  updatedInstallments: LoanInstallmentRecord[];
  restoredLoanPrincipalBalance: number;
  restoredLoanStatus: LoanRecord['status'];
  restoredPaidPrincipalTotal: number;
  restoredPaidInterestTotal: number;
  restoredPaidLateFeeTotal: number;
}

export function computePaymentReversal(params: {
  payment: PaymentRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  allocations: PaymentAllocationRecord[];
  asOfDateIso: string;
}): ReversalComputationResult {
  const { payment, loan, installments, allocations, asOfDateIso } = params;

  if (payment.status !== 'APLICADO') {
    throw new Error('Solo pagos en estado APLICADO pueden ser revertidos.');
  }
  const activeAllocations = allocations.filter(
    (a) => a.paymentId === payment.id && !a.reversed
  );

  const allocByInstId = new Map(activeAllocations.map((a) => [a.installmentId, a]));

  let reversedPrincipalCents = 0;
  let reversedInterestCents = 0;
  let reversedLateFeeCents = 0;

  const updatedInstallments = installments.map((inst) => {
    const alloc = allocByInstId.get(inst.id);
    if (!alloc) return inst;

    const pCents = toCents(alloc.appliedToPrincipal);
    const iCents = toCents(alloc.appliedToInterest);
    const cCents = toCents(alloc.appliedToCharges);
    const mCents = toCents(alloc.appliedToLateFee);

    reversedPrincipalCents += pCents;
    reversedInterestCents += iCents;
    reversedLateFeeCents += mCents;

    const nextPaidP = Math.max(0, toCents(inst.paidPrincipal ?? 0) - pCents);
    const nextPaidI = Math.max(0, toCents(inst.paidInterest ?? 0) - iCents);
    const nextPaidC = Math.max(0, toCents(inst.paidOtherCharges ?? 0) - cCents);
    const nextPaidM = Math.max(0, toCents(inst.paidLateFee ?? 0) - mCents);
    const paidSum = nextPaidP + nextPaidI + nextPaidC + nextPaidM;

    const nextStatus: LoanInstallmentRecord['status'] =
      inst.dueDate < asOfDateIso ? 'VENCIDA' : paidSum > 0 ? 'PARCIAL' : 'PENDIENTE';

    return {
      ...inst,
      paidPrincipal: fromCents(nextPaidP),
      paidInterest: fromCents(nextPaidI),
      paidOtherCharges: fromCents(nextPaidC),
      paidLateFee: fromCents(nextPaidM),
      status: nextStatus,
      paidAt: null,
    };
  });

  // Fallback if there was extra prepayment beyond allocations
  const totalAllocatedCents = activeAllocations.reduce(
    (acc, a) => acc + toCents(a.totalAllocated),
    0
  );
  const extraPrepaymentCents = Math.max(0, toCents(payment.amount) - totalAllocatedCents);
  reversedPrincipalCents += extraPrepaymentCents;

  const restoredBalanceCents = Math.min(
    toCents(loan.totalFinancedPrincipal),
    toCents(loan.currentPrincipalBalance) + reversedPrincipalCents
  );

  const anyOverdue = updatedInstallments.some(
    (i) => i.status !== 'PAGADA' && i.dueDate < asOfDateIso
  );

  return {
    updatedInstallments,
    restoredLoanPrincipalBalance: fromCents(restoredBalanceCents),
    restoredLoanStatus: anyOverdue ? 'VENCIDO' : 'ACTIVO',
    restoredPaidPrincipalTotal: fromCents(
      Math.max(0, toCents(loan.paidPrincipalTotal ?? 0) - reversedPrincipalCents)
    ),
    restoredPaidInterestTotal: fromCents(
      Math.max(0, toCents(loan.paidInterestTotal ?? 0) - reversedInterestCents)
    ),
    restoredPaidLateFeeTotal: fromCents(
      Math.max(0, toCents(loan.paidLateFeeTotal ?? 0) - reversedLateFeeCents)
    ),
  };
}

export function buildOfficialReceipt(params: {
  payment: PaymentRecord;
  loan: LoanRecord;
  allocations: PaymentAllocationRecord[];
  remainingPrincipalAfter: number;
  issuedBy: string;
  issuedByName: string;
}): CollectionReceiptRecord {
  const { payment, loan, allocations, remainingPrincipalAfter, issuedBy, issuedByName } = params;
  if (payment.status !== 'APLICADO') {
    throw new Error(
      'Segregación y control: solo se puede emitir un recibo oficial después de que el pago esté APLICADO.'
    );
  }

  const pAlloc = allocations.filter((a) => a.paymentId === payment.id && !a.reversed);
  const sumP = pAlloc.reduce((s, a) => s + toCents(a.appliedToPrincipal), 0);
  const sumI = pAlloc.reduce((s, a) => s + toCents(a.appliedToInterest), 0);
  const sumM = pAlloc.reduce((s, a) => s + toCents(a.appliedToLateFee), 0);
  const sumC = pAlloc.reduce((s, a) => s + toCents(a.appliedToCharges), 0);

  const receiptNumber =
    payment.receiptNumber || `REC-${loan.loanNumber.replace(/^PRE-/, '')}-${payment.id.slice(-6).toUpperCase()}`;

  return {
    id: `rec_${payment.id}`,
    organizationId: payment.organizationId,
    receiptNumber,
    paymentId: payment.id,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.applicantDisplayName,
    currency: payment.currency,
    amount: payment.amount,
    appliedToPrincipal: fromCents(sumP),
    appliedToInterest: fromCents(sumI),
    appliedToLateFee: fromCents(sumM),
    appliedToCharges: fromCents(sumC),
    remainingPrincipalAfter,
    paymentDate: payment.paymentDate,
    referenceNumber: payment.referenceNumber,
    issuedBy,
    issuedByName,
    issuedAt: new Date().toISOString(),
    status: 'EMITIDO',
  };
}

export interface ParsedBankLineInput {
  transactionDate: string;
  valueDate?: string;
  bankName: string;
  referenceNumber: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
}

function normalizeCsvAmount(raw: string): number {
  const cleaned = raw.replace(/RD\$|US\$|\$|\s/gi, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeCurrency(raw: string, fallback: CurrencyCode = 'DOP'): CurrencyCode {
  const up = raw.toUpperCase();
  if (up.includes('USD') || up.includes('US$')) return 'USD';
  if (up.includes('DOP') || up.includes('RD$')) return 'DOP';
  return fallback;
}

export function buildBankTxIdempotencyHash(params: {
  organizationId: string;
  bankName: string;
  transactionDate: string;
  referenceNumber: string;
  amount: number;
  currency: CurrencyCode;
}): string {
  const cleanRef = params.referenceNumber.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const cleanBank = params.bankName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return `${params.organizationId}_${cleanBank}_${params.transactionDate}_${cleanRef}_${toCents(params.amount)}_${params.currency}`;
}

export function parseBankStatementText(params: {
  rawText: string;
  defaultBankName?: string;
  defaultCurrency?: CurrencyCode;
}): ParsedBankLineInput[] {
  const { rawText, defaultBankName = 'Banco Popular', defaultCurrency = 'DOP' } = params;
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const sample = lines[0];
  const delimiter = sample.includes('\t') ? '\t' : sample.includes(';') ? ';' : ',';

  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  };

  const firstCells = splitRow(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCells.some(
    (c) =>
      c.includes('fecha') ||
      c.includes('date') ||
      c.includes('monto') ||
      c.includes('amount') ||
      c.includes('referencia')
  );

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const colIdx = (names: string[], fallbackIdx: number) => {
    if (!hasHeader) return fallbackIdx;
    const found = firstCells.findIndex((h) => names.some((n) => h.includes(n)));
    return found >= 0 ? found : fallbackIdx;
  };

  const dateCol = colIdx(['fecha', 'date'], 0);
  const refCol = colIdx(['referencia', 'ref'], 1);
  const descCol = colIdx(['descripcion', 'concepto', 'desc', 'detalle'], 2);
  const amtCol = colIdx(['monto', 'amount', 'credito', 'valor'], 3);
  const currCol = colIdx(['moneda', 'curr', 'divisa'], 4);
  const bankCol = colIdx(['banco', 'bank', 'entidad'], 5);

  const parsed: ParsedBankLineInput[] = [];
  for (const rowLine of dataLines) {
    const cols = splitRow(rowLine);
    const rawDate = (cols[dateCol] || '').slice(0, 10);
    const rawRef = (cols[refCol] || '').trim();
    const desc = (cols[descCol] || 'Movimiento bancario').trim();
    const amount = normalizeCsvAmount(cols[amtCol] || '0');
    const currency = normalizeCurrency(cols[currCol] || cols[amtCol] || '', defaultCurrency);
    const bankName = (cols[bankCol] || defaultBankName).trim();

    if (!rawDate || amount <= 0) continue;
    parsed.push({
      transactionDate: rawDate,
      bankName,
      referenceNumber: rawRef || `SINREF_${rawDate}_${toCents(amount)}`,
      description: desc,
      amount,
      currency,
    });
  }
  return parsed;
}

export interface BankReconciliationEvaluation {
  confidence: MatchConfidenceType;
  matchedPayment: PaymentRecord | null;
  candidatePayments: PaymentRecord[];
  amountDiff: number;
  score: number;
  reason: string;
  shouldAutoApply: boolean;
  exceptionType: ReconciliationExceptionRecord['exceptionType'] | null;
}

export function classifyAndMatchBankTransaction(params: {
  bankTx: BankTransactionRecord;
  payments: PaymentRecord[];
  existingBankTransactions?: BankTransactionRecord[];
  policy?: CollectionPolicyVersionRecord;
}): BankReconciliationEvaluation {
  const {
    bankTx,
    payments,
    existingBankTransactions = [],
    policy = DEFAULT_COLLECTION_POLICY_V1,
  } = params;

  const bankRefNorm = bankTx.referenceNumber.trim().toUpperCase();
  const bankCents = toCents(bankTx.amount);

  if (bankTx.status === 'CONCILIADA' && bankTx.matchedPaymentId) {
    return {
      confidence: 'YA_CONCILIADA',
      matchedPayment: payments.find((p) => p.id === bankTx.matchedPaymentId) ?? null,
      candidatePayments: [],
      amountDiff: 0,
      score: 100,
      reason: 'Transacción bancaria ya conciliada previamente.',
      shouldAutoApply: false,
      exceptionType: 'YA_CONCILIADO',
    };
  }

  // Check duplicate reference in bank statement history
  const duplicateBankRef = existingBankTransactions.some(
    (other) =>
      other.id !== bankTx.id &&
      other.referenceNumber.trim().toUpperCase() === bankRefNorm &&
      other.currency === bankTx.currency &&
      toCents(other.amount) === bankCents &&
      other.status !== 'IGNORADA'
  );
  if (duplicateBankRef) {
    return {
      confidence: 'REFERENCIA_DUPLICADA',
      matchedPayment: null,
      candidatePayments: [],
      amountDiff: 0,
      score: 0,
      reason: `Referencia duplicada (${bankTx.referenceNumber}) detectada en extractos bancarios.`,
      shouldAutoApply: false,
      exceptionType: 'REFERENCIA_DUPLICADA',
    };
  }

  const sameCurrencyPayments = payments.filter(
    (p) => p.currency === bankTx.currency && p.status !== 'RECHAZADO' && p.status !== 'REVERTIDO'
  );

  // 1. Exact reference matches
  const refMatches = sameCurrencyPayments.filter(
    (p) => p.referenceNumber.trim().toUpperCase() === bankRefNorm && bankRefNorm.length >= 3
  );

  if (refMatches.length > 0) {
    // Already applied & reconciled?
    const alreadyReconciled = refMatches.find((p) => p.reconciliationMatchId);
    if (alreadyReconciled && refMatches.length === 1) {
      return {
        confidence: 'YA_CONCILIADA',
        matchedPayment: alreadyReconciled,
        candidatePayments: refMatches,
        amountDiff: fromCents(bankCents - toCents(alreadyReconciled.amount)),
        score: 100,
        reason: `El pago ${alreadyReconciled.id} ya cuenta con conciliación confirmada.`,
        shouldAutoApply: false,
        exceptionType: 'YA_CONCILIADO',
      };
    }

    const pendingOrOpenRefMatches = refMatches.filter((p) => !p.reconciliationMatchId);
    const exactAmtMatches = pendingOrOpenRefMatches.filter((p) => toCents(p.amount) === bankCents);

    if (exactAmtMatches.length === 1) {
      const winner = exactAmtMatches[0];
      const dateGap = Math.abs(diffCalendarDays(winner.paymentDate, bankTx.transactionDate));
      if (dateGap <= 5) {
        return {
          confidence: 'EXACTA',
          matchedPayment: winner,
          candidatePayments: [winner],
          amountDiff: 0,
          score: 100,
          reason: `Coincidencia exacta por referencia (${bankTx.referenceNumber}), monto y moneda (${bankTx.currency}).`,
          shouldAutoApply: Boolean(policy.autoApplyExactBankMatch && winner.status !== 'APLICADO'),
          exceptionType: null,
        };
      }
      return {
        confidence: 'PROBABLE',
        matchedPayment: winner,
        candidatePayments: [winner],
        amountDiff: 0,
        score: 85,
        reason: `Referencia y monto coinciden con desfase de fecha (${dateGap} días). Requiere confirmación.`,
        shouldAutoApply: false,
        exceptionType: null,
      };
    }

    if (exactAmtMatches.length > 1) {
      return {
        confidence: 'AMBIGUA',
        matchedPayment: null,
        candidatePayments: exactAmtMatches,
        amountDiff: 0,
        score: 50,
        reason: `Múltiples pagos (${exactAmtMatches.length}) coinciden con la misma referencia y monto.`,
        shouldAutoApply: false,
        exceptionType: 'MULTIPLES_CANDIDATOS',
      };
    }

    // Reference matches, amount differs
    const first = pendingOrOpenRefMatches[0] ?? refMatches[0];
    const diff = fromCents(bankCents - toCents(first.amount));
    return {
      confidence: 'DIFERENCIA_MONTO',
      matchedPayment: first,
      candidatePayments: pendingOrOpenRefMatches,
      amountDiff: diff,
      score: 60,
      reason: `Referencia coincide pero difiere el monto (banco ${bankTx.amount.toFixed(2)} vs reportado ${first.amount.toFixed(2)}).`,
      shouldAutoApply: false,
      exceptionType: 'DIFERENCIA_MONTO',
    };
  }

  // 2. Fallback heuristic without reference match: exact amount + currency + close date (±3 days)
  const amountCandidates = sameCurrencyPayments.filter(
    (p) =>
      !p.reconciliationMatchId &&
      toCents(p.amount) === bankCents &&
      Math.abs(diffCalendarDays(p.paymentDate, bankTx.transactionDate)) <= 3
  );

  if (amountCandidates.length === 1) {
    const candidate = amountCandidates[0];
    return {
      confidence: 'PROBABLE',
      matchedPayment: candidate,
      candidatePayments: [candidate],
      amountDiff: 0,
      score: 75,
      reason: `Coincidencia probable por monto exacto (${bankTx.amount.toFixed(2)} ${bankTx.currency}) y fecha cercana, sin referencia idéntica.`,
      shouldAutoApply: false,
      exceptionType: null,
    };
  }

  if (amountCandidates.length > 1) {
    return {
      confidence: 'AMBIGUA',
      matchedPayment: null,
      candidatePayments: amountCandidates,
      amountDiff: 0,
      score: 45,
      reason: `Múltiples pagos candidatos (${amountCandidates.length}) por el mismo monto (${bankTx.amount.toFixed(2)} ${bankTx.currency}).`,
      shouldAutoApply: false,
      exceptionType: 'MULTIPLES_CANDIDATOS',
    };
  }

  return {
    confidence: 'SIN_COINCIDENCIA',
    matchedPayment: null,
    candidatePayments: [],
    amountDiff: 0,
    score: 0,
    reason: 'Sin coincidencia contra pagos reportados; enviado a Pagos por Identificar.',
    shouldAutoApply: false,
    exceptionType: 'SIN_COINCIDENCIA',
  };
}
