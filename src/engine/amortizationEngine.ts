import type { AmortizationMethod, PaymentFrequency } from '../types/axycore';

export interface AmortizationInput {
  financedPrincipal: number;
  monthlyRate: number; // e.g., 0.04 for 4%
  termMonths: number;
  frequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  disbursementDate: string; // YYYY-MM-DD
  firstPaymentDate: string; // YYYY-MM-DD
  perInstallmentOtherCharges?: number;
}

export interface AmortizationRow {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  otherCharges: number;
  totalAmount: number;
  remainingPrincipalBalance: number;
}

export interface AmortizationScheduleResult {
  financedPrincipal: number;
  totalPrincipalScheduled: number;
  totalInterestScheduled: number;
  totalOtherCharges: number;
  totalContractualPayable: number;
  periodicInstallmentEstimate: number;
  maturityDate: string;
  rows: AmortizationRow[];
  isReconciled: boolean;
}

export function toCents(amount: number): number {
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100);
}

export function fromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function addMonthsPreservingAnchor(
  baseIsoDate: string,
  monthsToAdd: number,
  anchorDay?: number
): string {
  const parts = baseIsoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Fecha inválida para calendario financiero: ${baseIsoDate}`);
  }
  const [year, month1, day] = parts;
  const targetAnchor = anchorDay ?? day;
  const totalMonths = year * 12 + (month1 - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = totalMonths % 12;
  const maxDay = daysInMonth(targetYear, targetMonth0);
  const finalDay = Math.min(targetAnchor, maxDay);

  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(finalDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function addDaysIso(baseIsoDate: string, daysToAdd: number): string {
  const parts = baseIsoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Fecha inválida: ${baseIsoDate}`);
  }
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function calculateMonthlyInstallment(
  principal: number,
  monthlyRate: number,
  termMonths: number
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (monthlyRate <= 0) {
    return fromCents(Math.round(toCents(principal) / termMonths));
  }
  const factor = Math.pow(1 + monthlyRate, -termMonths);
  const raw = (principal * monthlyRate) / (1 - factor);
  return fromCents(toCents(raw));
}

export function generateAmortizationSchedule(input: AmortizationInput): AmortizationScheduleResult {
  const principalCents = toCents(input.financedPrincipal);
  if (principalCents <= 0) {
    throw new Error('El capital financiado debe ser mayor que cero.');
  }
  if (input.termMonths < 1 || !Number.isInteger(input.termMonths)) {
    throw new Error('El plazo debe ser un entero positivo en meses.');
  }
  if (input.monthlyRate < 0) {
    throw new Error('La tasa contractual no puede ser negativa.');
  }

  // Note: Per Section 8.2, automatic operational schedules currently enforce monthly declining balance;
  // biweekly/weekly & flat interest are structurally guarded if selected outside validated mode.
  const otherChargesCents = toCents(input.perInstallmentOtherCharges ?? 0);
  const anchorParts = input.firstPaymentDate.split('-').map(Number);
  const anchorDay = anchorParts.length === 3 ? anchorParts[2] : 1;

  let periods = input.termMonths;
  let periodRate = input.monthlyRate;
  let stepDays = 0;

  if (input.frequency === 'DIARIA') {
    periods = input.termMonths * 30;
    periodRate = input.monthlyRate / 30;
    stepDays = 1;
  } else if (input.frequency === 'QUINCENAL') {
    periods = input.termMonths * 2;
    periodRate = input.monthlyRate / 2;
    stepDays = 15;
  } else if (input.frequency === 'SEMANAL') {
    periods = input.termMonths * 4;
    periodRate = input.monthlyRate / 4;
    stepDays = 7;
  }

  let targetPeriodicPaymentCents = 0;
  if (input.amortizationMethod === 'SALDO_INSOLUTO') {
    if (periodRate === 0) {
      targetPeriodicPaymentCents = Math.round(principalCents / periods);
    } else {
      const factor = Math.pow(1 + periodRate, -periods);
      targetPeriodicPaymentCents = Math.round((principalCents * periodRate) / (1 - factor));
    }
  } else {
    // INTERES_FIJO (flat interest configuration)
    const totalFlatInterestCents = Math.round(principalCents * input.monthlyRate * input.termMonths);
    targetPeriodicPaymentCents = Math.round((principalCents + totalFlatInterestCents) / periods);
  }

  let remainingCents = principalCents;
  let totalPrincipalCents = 0;
  let totalInterestCents = 0;
  let totalChargesCents = 0;
  const rows: AmortizationRow[] = [];

  for (let i = 1; i <= periods; i++) {
    const dueDate =
      input.frequency === 'MENSUAL'
        ? addMonthsPreservingAnchor(input.firstPaymentDate, i - 1, anchorDay)
        : addDaysIso(input.firstPaymentDate, (i - 1) * stepDays);

    let interestCents = 0;
    let instPrincipalCents = 0;

    if (input.amortizationMethod === 'SALDO_INSOLUTO') {
      interestCents = Math.round(remainingCents * periodRate);
      if (i === periods) {
        instPrincipalCents = remainingCents;
      } else {
        instPrincipalCents = Math.min(
          remainingCents,
          Math.max(0, targetPeriodicPaymentCents - interestCents)
        );
      }
    } else {
      interestCents = Math.round(principalCents * periodRate);
      if (i === periods) {
        instPrincipalCents = remainingCents;
      } else {
        instPrincipalCents = Math.min(remainingCents, Math.round(principalCents / periods));
      }
    }

    remainingCents -= instPrincipalCents;
    const totalCents = instPrincipalCents + interestCents + otherChargesCents;

    totalPrincipalCents += instPrincipalCents;
    totalInterestCents += interestCents;
    totalChargesCents += otherChargesCents;

    rows.push({
      installmentNumber: i,
      dueDate,
      principalAmount: fromCents(instPrincipalCents),
      interestAmount: fromCents(interestCents),
      otherCharges: fromCents(otherChargesCents),
      totalAmount: fromCents(totalCents),
      remainingPrincipalBalance: fromCents(remainingCents),
    });
  }

  const isReconciled =
    totalPrincipalCents === principalCents &&
    rows.length === periods &&
    rows[rows.length - 1].remainingPrincipalBalance === 0;

  return {
    financedPrincipal: fromCents(principalCents),
    totalPrincipalScheduled: fromCents(totalPrincipalCents),
    totalInterestScheduled: fromCents(totalInterestCents),
    totalOtherCharges: fromCents(totalChargesCents),
    totalContractualPayable: fromCents(totalPrincipalCents + totalInterestCents + totalChargesCents),
    periodicInstallmentEstimate: rows.length > 0 ? rows[0].totalAmount : 0,
    maturityDate: rows.length > 0 ? rows[rows.length - 1].dueDate : input.firstPaymentDate,
    rows,
    isReconciled,
  };
}
