import type {
  ClientPortalMessageCategory,
  ClientPortalMessageRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentFrequency,
} from '../types/axycore';

export type LoanHealthLevel =
  | 'AL_DIA'
  | 'PROXIMO_VENCIMIENTO'
  | 'ATRASO_MODERADO'
  | 'MORA_CRITICA'
  | 'CANCELADO';

export interface LoanHealthAnalysis {
  loanId: string;
  loanNumber: string;
  paidPrincipalPct: number;
  paidInstallmentsCount: number;
  totalInstallmentsCount: number;
  remainingInstallmentsCount: number;
  overdueInstallmentsCount: number;
  overdueAmount: number;
  accruedLateFeeTotal: number;
  amountToCatchUp: number;
  estimatedPayoffTotal: number;
  maxDaysPastDue: number;
  daysUntilNextDue: number | null;
  nextDueInstallment: LoanInstallmentRecord | null;
  nextDueRemainingAmount: number;
  healthLevel: LoanHealthLevel;
  healthLabel: string;
  healthHeadline: string;
  healthDescription: string;
  needsHardshipAssistance: boolean;
  isCriticalArrears: boolean;
  renewalEligible: boolean;
  renewalGuidance: string;
}

export interface ClientRenewalSimulationResult {
  requestedAmount: number;
  estimatedPayoff: number;
  estimatedNetDisbursement: number;
  estimatedInstallment: number;
  totalPayable: number;
  totalInterest: number;
  periodCount: number;
  monthlyRateUsed: number;
  coversPayoff: boolean;
}

export interface ClientMessageThreadSummary {
  clientUid: string;
  clientName: string;
  clientEmail: string;
  customerId?: string | null;
  latestLoanNumber?: string | null;
  latestCategory: ClientPortalMessageCategory;
  latestMessage: ClientPortalMessageRecord;
  latestTimestampMs: number;
  messages: ClientPortalMessageRecord[];
  unreadByStaffCount: number;
  unreadByClientCount: number;
}

export interface HardshipReliefOption {
  id: 'ACUERDO_CUOTAS' | 'PRORROGA_GRACIA' | 'REESTRUCTURACION_PLAZO' | 'DESCUENTO_MORA';
  title: string;
  subtitle: string;
  description: string;
  recommendedFor: string;
}

export const HARDSHIP_RELIEF_OPTIONS: HardshipReliefOption[] = [
  {
    id: 'ACUERDO_CUOTAS',
    title: 'Acuerdo de Pago Escalonado',
    subtitle: 'Divide tu atraso en abonos accesibles',
    description:
      'Convierte las cuotas vencidas en un plan de pagos parciales ajustado a tu flujo actual para recuperar el estatus al día sin presión inmediata.',
    recommendedFor: 'Atrasos acumulados de 1 a 3 cuotas',
  },
  {
    id: 'PRORROGA_GRACIA',
    title: 'Prórroga Temporal / Período de Gracia',
    subtitle: 'Respiro de 15 a 30 días para reorganizarte',
    description:
      'Solicita mover temporalmente tu próxima fecha de pago mientras resuelves una eventualidad laboral, médica o familiar.',
    recommendedFor: 'Imprevistos puntuales de liquidez',
  },
  {
    id: 'REESTRUCTURACION_PLAZO',
    title: 'Reestructuración de Plazo y Cuota',
    subtitle: 'Reduce el monto de tu cuota mensual',
    description:
      'Evalúa extender el plazo restante de tu crédito para disminuir el valor de cada cuota y devolverle estabilidad a tu presupuesto.',
    recommendedFor: 'Mora crítica o reducción sostenida de ingresos',
  },
  {
    id: 'DESCUENTO_MORA',
    title: 'Evaluación de Descuento de Mora',
    subtitle: 'Ponerse al día con alivio en recargos',
    description:
      'Si puedes realizar un pago de regularización, solicita la evaluación institucional de una rebaja o condonación parcial de la mora acumulada.',
    recommendedFor: 'Regularización con pago parcial o total del atraso',
  },
];

export const CLIENT_MESSAGE_CATEGORY_LABELS: Record<ClientPortalMessageCategory, string> = {
  CONSULTA_GENERAL: 'Consulta General',
  PAGOS_Y_CUOTAS: 'Pagos y Cuotas',
  RENOVACION: 'Renovación / Reenganche',
  AYUDA_ATRASO: 'Ayuda por Atraso',
  DOCUMENTOS: 'Cartas y Documentos',
};

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function parseIsoDateUtc(dateStr?: string | null): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim().slice(0, 10);
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Date.UTC(y, m - 1, d);
}

export function extractTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const t = Date.parse(val);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof val === 'object' && val !== null) {
    const maybeTs = val as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTs.toMillis === 'function') {
      try {
        return maybeTs.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof maybeTs.seconds === 'number') {
      return maybeTs.seconds * 1000;
    }
  }
  return 0;
}

export function getInstallmentRemainingComponents(inst: LoanInstallmentRecord): {
  remainingPrincipal: number;
  remainingInterest: number;
  remainingOther: number;
  remainingLateFee: number;
  remainingBase: number;
  remainingTotalWithLateFee: number;
} {
  const remainingPrincipal = Math.max(0, round2((inst.principalAmount || 0) - (inst.paidPrincipal || 0)));
  const remainingInterest = Math.max(0, round2((inst.interestAmount || 0) - (inst.paidInterest || 0)));
  const remainingOther = Math.max(0, round2((inst.otherCharges || 0) - (inst.paidOtherCharges || 0)));
  const remainingLateFee = Math.max(
    0,
    round2((inst.accruedLateFee || 0) - (inst.paidLateFee || 0) - (inst.waivedLateFee || 0))
  );
  const remainingBase = round2(remainingPrincipal + remainingInterest + remainingOther);
  const remainingTotalWithLateFee = round2(remainingBase + remainingLateFee);

  return {
    remainingPrincipal,
    remainingInterest,
    remainingOther,
    remainingLateFee,
    remainingBase,
    remainingTotalWithLateFee,
  };
}

export function analyzeLoanHealth(
  loan: LoanRecord,
  installments: LoanInstallmentRecord[],
  referenceDateIso?: string
): LoanHealthAnalysis {
  const todayIso = (referenceDateIso || new Date().toISOString()).slice(0, 10);
  const todayUtc = parseIsoDateUtc(todayIso) ?? Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  const sorted = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);

  const originalPrincipal = Math.max(
    1,
    Number(loan.totalFinancedPrincipal || loan.approvedPrincipal || 0)
  );
  const currentBalance = Math.max(0, Number(loan.currentPrincipalBalance || 0));
  const paidPrincipalPct = Math.min(
    100,
    Math.max(0, Math.round(((originalPrincipal - currentBalance) / originalPrincipal) * 100))
  );

  const paidInstallmentsCount = sorted.filter((i) => i.status === 'PAGADA').length;
  const totalInstallmentsCount = sorted.length;
  const remainingInstallmentsCount = Math.max(0, totalInstallmentsCount - paidInstallmentsCount);

  let overdueInstallmentsCount = 0;
  let overdueAmount = 0;
  let accruedLateFeeTotal = 0;
  let maxDaysPastDue = 0;
  let overdueInterestOnly = 0;

  for (const inst of sorted) {
    const comp = getInstallmentRemainingComponents(inst);
    accruedLateFeeTotal = round2(accruedLateFeeTotal + comp.remainingLateFee);

    if (inst.status === 'PAGADA' || comp.remainingBase <= 0.01) continue;

    const dueUtc = parseIsoDateUtc(inst.dueDate);
    const diffDays = dueUtc !== null ? Math.floor((todayUtc - dueUtc) / 86400000) : 0;
    const isOverdue = inst.status === 'VENCIDA' || diffDays > 0;

    if (isOverdue) {
      overdueInstallmentsCount += 1;
      overdueAmount = round2(overdueAmount + comp.remainingBase);
      overdueInterestOnly = round2(overdueInterestOnly + comp.remainingInterest);
      if (diffDays > maxDaysPastDue) {
        maxDaysPastDue = diffDays;
      }
    }
  }

  const nextDueInstallment =
    sorted.find((i) => {
      if (i.status === 'PAGADA') return false;
      const comp = getInstallmentRemainingComponents(i);
      return comp.remainingTotalWithLateFee > 0.01;
    }) ?? null;

  const nextDueRemainingAmount = nextDueInstallment
    ? getInstallmentRemainingComponents(nextDueInstallment).remainingTotalWithLateFee
    : 0;

  let daysUntilNextDue: number | null = null;
  if (nextDueInstallment) {
    const nextUtc = parseIsoDateUtc(nextDueInstallment.dueDate);
    if (nextUtc !== null) {
      daysUntilNextDue = Math.floor((nextUtc - todayUtc) / 86400000);
    }
  }

  const amountToCatchUp =
    overdueInstallmentsCount > 0 || accruedLateFeeTotal > 0
      ? round2(overdueAmount + accruedLateFeeTotal)
      : round2(nextDueRemainingAmount);

  const estimatedPayoffTotal = round2(currentBalance + overdueInterestOnly + accruedLateFeeTotal);

  const isClosed =
    loan.status === 'PAGADO' ||
    loan.status === 'CANCELADO' ||
    loan.status === 'CANCELADO_POR_RENOVACION' ||
    currentBalance <= 0.01;

  let healthLevel: LoanHealthLevel = 'AL_DIA';
  let healthLabel = 'Al Día';
  let healthHeadline = 'Tu crédito se mantiene en excelente estado';
  let healthDescription =
    'Continúa con tus pagos puntuales para fortalecer tu historial y acceder a mejores condiciones de renovación.';

  if (isClosed) {
    healthLevel = 'CANCELADO';
    healthLabel = loan.status === 'CANCELADO_POR_RENOVACION' ? 'Renovado' : 'Saldado';
    healthHeadline = 'Crédito liquidado satisfactoriamente';
    healthDescription = 'Este crédito ya no tiene balance pendiente. Puedes descargar tu historial o solicitar un nuevo financiamiento.';
  } else if (maxDaysPastDue >= 15 || overdueInstallmentsCount >= 2 || (loan.status === 'VENCIDO' && maxDaysPastDue >= 15)) {
    healthLevel = 'MORA_CRITICA';
    healthLabel = 'Atraso Crítico · Alivio Disponible';
    healthHeadline = 'Tu crédito presenta un atraso elevado — estamos aquí para ayudarte';
    healthDescription =
      'Podemos diseñar un acuerdo de pago, prórroga o reestructuración adaptado a tu realidad actual. Solicita alivio financiero hoy mismo.';
  } else if (overdueInstallmentsCount > 0 || maxDaysPastDue > 0 || loan.status === 'VENCIDO') {
    healthLevel = 'ATRASO_MODERADO';
    healthLabel = 'Con Atraso';
    healthHeadline = 'Tienes cuotas vencidas pendientes de regularización';
    healthDescription =
      'Ponte al día con un clic o solicita una prórroga temporal desde el Centro de Alivio Financiero para evitar recargos adicionales.';
  } else if (daysUntilNextDue !== null && daysUntilNextDue >= 0 && daysUntilNextDue <= 5) {
    healthLevel = 'PROXIMO_VENCIMIENTO';
    healthLabel = daysUntilNextDue === 0 ? 'Vence Hoy' : `Vence en ${daysUntilNextDue}d`;
    healthHeadline =
      daysUntilNextDue === 0
        ? 'Tu próxima cuota vence hoy'
        : `Tu próxima cuota vence en ${daysUntilNextDue} ${daysUntilNextDue === 1 ? 'día' : 'días'}`;
    healthDescription =
      'Reporta tu transferencia o depósito desde el portal para mantener tu historial impecable sin cargos por mora.';
  }

  const needsHardshipAssistance =
    healthLevel === 'MORA_CRITICA' || healthLevel === 'ATRASO_MODERADO';
  const isCriticalArrears = healthLevel === 'MORA_CRITICA';

  const renewalEligible = !isClosed && !isCriticalArrears && paidPrincipalPct >= 25;
  let renewalGuidance = 'Pre-elegible para solicitar renovación en línea.';
  if (isClosed) {
    renewalGuidance = 'Crédito cerrado. Puedes gestionar un nuevo financiamiento desde tu portal.';
  } else if (isCriticalArrears) {
    renewalGuidance =
      'Recomendamos regularizar el atraso o solicitar un plan de alivio antes de iniciar una renovación.';
  } else if (paidPrincipalPct < 25) {
    renewalGuidance = `Llevas ${paidPrincipalPct}% de capital amortizado. Al superar 25% podrás acceder a renovaciones más ágiles (aún puedes enviar tu solicitud para evaluación).`;
  } else {
    renewalGuidance = `Excelente avance (${paidPrincipalPct}% amortizado). Puedes simular tu renovación y ver cuánto recibirías neto.`;
  }

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    paidPrincipalPct,
    paidInstallmentsCount,
    totalInstallmentsCount,
    remainingInstallmentsCount,
    overdueInstallmentsCount,
    overdueAmount,
    accruedLateFeeTotal,
    amountToCatchUp,
    estimatedPayoffTotal,
    maxDaysPastDue,
    daysUntilNextDue,
    nextDueInstallment,
    nextDueRemainingAmount,
    healthLevel,
    healthLabel,
    healthHeadline,
    healthDescription,
    needsHardshipAssistance,
    isCriticalArrears,
    renewalEligible,
    renewalGuidance,
  };
}

export function simulateClientRenewal(params: {
  baseLoan: LoanRecord;
  installments: LoanInstallmentRecord[];
  requestedAmount: number;
  requestedTermMonths: number;
  frequency: PaymentFrequency;
  monthlyRate?: number;
  referenceDateIso?: string;
}): ClientRenewalSimulationResult {
  const health = analyzeLoanHealth(params.baseLoan, params.installments, params.referenceDateIso);
  const estimatedPayoff = health.estimatedPayoffTotal;
  const requestedAmount = Math.max(0, round2(params.requestedAmount));
  const months = Math.max(1, Math.round(params.requestedTermMonths || 1));
  const monthlyRateUsed =
    typeof params.monthlyRate === 'number' && params.monthlyRate > 0
      ? params.monthlyRate
      : Number(params.baseLoan.contractualRateMonthly || 0.03);

  const periodsPerMonthMap: Record<PaymentFrequency, number> = {
    DIARIA: 30,
    SEMANAL: 4,
    QUINCENAL: 2,
    MENSUAL: 1,
  };
  const periodsPerMonth = periodsPerMonthMap[params.frequency] || 1;
  const periodCount = Math.max(1, Math.round(months * periodsPerMonth));
  const periodicRate = monthlyRateUsed / periodsPerMonth;

  let estimatedInstallment = 0;
  if (requestedAmount > 0) {
    if (periodicRate <= 0) {
      estimatedInstallment = round2(requestedAmount / periodCount);
    } else if (params.baseLoan.amortizationMethod === 'INTERES_FIJO') {
      const totalInt = requestedAmount * monthlyRateUsed * months;
      estimatedInstallment = round2((requestedAmount + totalInt) / periodCount);
    } else {
      const factor = Math.pow(1 + periodicRate, periodCount);
      estimatedInstallment = round2((requestedAmount * periodicRate * factor) / (factor - 1));
    }
  }

  const totalPayable = round2(estimatedInstallment * periodCount);
  const totalInterest = Math.max(0, round2(totalPayable - requestedAmount));
  const estimatedNetDisbursement = round2(requestedAmount - estimatedPayoff);

  return {
    requestedAmount,
    estimatedPayoff,
    estimatedNetDisbursement,
    estimatedInstallment,
    totalPayable,
    totalInterest,
    periodCount,
    monthlyRateUsed,
    coversPayoff: requestedAmount > estimatedPayoff,
  };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildAmortizationCsv(
  loan: LoanRecord,
  installments: LoanInstallmentRecord[]
): string {
  const sorted = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);
  const headers = [
    'Prestamo',
    'Moneda',
    'Cuota #',
    'Fecha Vencimiento',
    'Capital',
    'Interes',
    'Otros Cargos',
    'Mora Pendiente',
    'Total Cuota',
    'Monto Pagado',
    'Saldo Capital',
    'Estado',
  ];

  const rows = sorted.map((inst) => {
    const comp = getInstallmentRemainingComponents(inst);
    const totalPaid = round2(
      (inst.paidPrincipal || 0) +
        (inst.paidInterest || 0) +
        (inst.paidOtherCharges || 0) +
        (inst.paidLateFee || 0)
    );
    return [
      loan.loanNumber,
      loan.currency,
      inst.installmentNumber,
      inst.dueDate,
      round2(inst.principalAmount || 0).toFixed(2),
      round2(inst.interestAmount || 0).toFixed(2),
      round2(inst.otherCharges || 0).toFixed(2),
      comp.remainingLateFee.toFixed(2),
      round2(inst.totalAmount || 0).toFixed(2),
      totalPaid.toFixed(2),
      round2(inst.remainingPrincipalBalance || 0).toFixed(2),
      inst.status,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return `\uFEFF${headers.map(escapeCsvCell).join(',')}\n${rows.join('\n')}`;
}

export function groupClientMessageThreads(
  messages: ClientPortalMessageRecord[]
): ClientMessageThreadSummary[] {
  const byClient = new Map<string, ClientPortalMessageRecord[]>();

  for (const msg of messages) {
    if (!msg.clientUid) continue;
    const list = byClient.get(msg.clientUid) ?? [];
    list.push(msg);
    byClient.set(msg.clientUid, list);
  }

  const threads: ClientMessageThreadSummary[] = [];

  for (const [clientUid, list] of byClient.entries()) {
    const sortedAsc = [...list].sort(
      (a, b) => extractTimestampMs(a.createdAt) - extractTimestampMs(b.createdAt)
    );
    const latestMessage = sortedAsc[sortedAsc.length - 1];
    const unreadByStaffCount = sortedAsc.filter(
      (m) => m.senderRole === 'CLIENT' && !m.readByStaff
    ).length;
    const unreadByClientCount = sortedAsc.filter(
      (m) => m.senderRole === 'ADMIN_STAFF' && !m.readByClient
    ).length;

    const latestWithLoan = [...sortedAsc].reverse().find((m) => Boolean(m.loanNumber));

    threads.push({
      clientUid,
      clientName: latestMessage.clientName,
      clientEmail: latestMessage.clientEmail,
      customerId: latestMessage.customerId ?? null,
      latestLoanNumber: latestWithLoan?.loanNumber ?? null,
      latestCategory: latestMessage.category,
      latestMessage,
      latestTimestampMs: extractTimestampMs(latestMessage.createdAt),
      messages: sortedAsc,
      unreadByStaffCount,
      unreadByClientCount,
    });
  }

  return threads.sort((a, b) => b.latestTimestampMs - a.latestTimestampMs);
}

export interface PrincipalDonutSegment {
  key: 'PAID' | 'PENDING';
  name: string;
  value: number;
  pct: number;
  description: string;
}

export interface PrincipalDonutData {
  totalFinancedPrincipal: number;
  paidPrincipal: number;
  pendingPrincipal: number;
  paidPct: number;
  pendingPct: number;
  segments: PrincipalDonutSegment[];
}

export function buildPrincipalDonutSegments(loan: LoanRecord): PrincipalDonutData {
  const totalFinancedPrincipal = Math.max(
    0,
    round2(Number(loan.totalFinancedPrincipal || loan.approvedPrincipal || 0))
  );
  const rawPending = Math.max(0, round2(Number(loan.currentPrincipalBalance || 0)));
  const pendingPrincipal =
    totalFinancedPrincipal > 0 ? Math.min(totalFinancedPrincipal, rawPending) : rawPending;
  const paidPrincipal = Math.max(0, round2(totalFinancedPrincipal - pendingPrincipal));

  const denominator = Math.max(totalFinancedPrincipal, paidPrincipal + pendingPrincipal);
  const paidPct =
    denominator > 0 ? Math.min(100, Math.max(0, round2((paidPrincipal / denominator) * 100))) : 0;
  const pendingPct = denominator > 0 ? Math.max(0, round2(100 - paidPct)) : 0;

  return {
    totalFinancedPrincipal: denominator,
    paidPrincipal,
    pendingPrincipal,
    paidPct,
    pendingPct,
    segments: [
      {
        key: 'PAID',
        name: 'Capital pagado',
        value: paidPrincipal,
        pct: paidPct,
        description: 'Capital amortizado acumulado',
      },
      {
        key: 'PENDING',
        name: 'Capital pendiente',
        value: pendingPrincipal,
        pct: pendingPct,
        description: 'Saldo de capital por pagar',
      },
    ],
  };
}

