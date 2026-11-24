import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  HeartHandshake,
  Landmark,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { LoanHealthAnalysis } from '../../engine/clientPortalHealthEngine';
import type { LoanRecord } from '../../types/axycore';
import { formatMoney, formatRatePct } from '../../utils/formatters';
import { ClientPrincipalProgressDonut } from './ClientPrincipalProgressDonut';

interface ClientCreditHealthHeroProps {
  loans: LoanRecord[];
  selectedLoan: LoanRecord;
  health: LoanHealthAnalysis;
  onSelectLoan: (loanId: string) => void;
  onPayNextInstallment: (amount: number, note: string) => void;
  onOpenRenewal: () => void;
  onOpenHardshipRelief: () => void;
  onOpenMessages: () => void;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const HEALTH_THEME = {
  AL_DIA: {
    ringStroke: '#10B981',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    surfaceTint: 'border-emerald-500/25 bg-emerald-500/[0.06]',
    barFill: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  PROXIMO_VENCIMIENTO: {
    ringStroke: '#E2B35E',
    accentText: 'text-amber-600 dark:text-[#E2B35E]',
    surfaceTint: 'border-amber-500/25 bg-amber-500/[0.06]',
    barFill: 'bg-amber-500',
    icon: CalendarClock,
  },
  ATRASO_MODERADO: {
    ringStroke: '#F59E0B',
    accentText: 'text-amber-600 dark:text-amber-400',
    surfaceTint: 'border-amber-500/35 bg-amber-500/[0.08]',
    barFill: 'bg-amber-500',
    icon: AlertTriangle,
  },
  MORA_CRITICA: {
    ringStroke: '#F43F5E',
    accentText: 'text-rose-600 dark:text-rose-400',
    surfaceTint: 'border-rose-500/35 bg-rose-500/[0.08]',
    barFill: 'bg-rose-500',
    icon: AlertTriangle,
  },
  CANCELADO: {
    ringStroke: '#00B8FF',
    accentText: 'text-[#0066FF] dark:text-[#00D1FF]',
    surfaceTint: 'border-[#00B8FF]/25 bg-[#00B8FF]/[0.06]',
    barFill: 'bg-[#00B8FF]',
    icon: ShieldCheck,
  },
} as const;

export function ClientCreditHealthHero({
  loans,
  selectedLoan,
  health,
  onSelectLoan,
  onPayNextInstallment,
  onOpenRenewal,
  onOpenHardshipRelief,
  onOpenMessages,
}: ClientCreditHealthHeroProps) {
  const theme = HEALTH_THEME[health.healthLevel];
  const StatusIcon = theme.icon;

  const primaryPayAmount = health.needsHardshipAssistance
    ? health.amountToCatchUp
    : health.nextDueRemainingAmount;
  const primaryPayNote = health.needsHardshipAssistance
    ? `Regularización de atraso (${health.overdueInstallmentsCount} cuota(s) vencida(s)) · ${selectedLoan.loanNumber}`
    : health.nextDueInstallment
    ? `Pago Cuota #${health.nextDueInstallment.installmentNumber} · ${selectedLoan.loanNumber}`
    : `Abono a préstamo ${selectedLoan.loanNumber}`;

  return (
    <div className="space-y-4">
      {/* Multi-Loan Selector Strip (shown when client has more than 1 loan) */}
      {loans.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {loans.map((loan) => {
            const active = loan.id === selectedLoan.id;
            return (
              <button
                key={loan.id}
                type="button"
                onClick={() => onSelectLoan(loan.id)}
                className={`shrink-0 text-left px-4 py-3 rounded-xl border transition-all cursor-pointer min-w-[210px] ${
                  active
                    ? 'bg-[#040C1E] dark:bg-[#0B1B3B] border-[#00B8FF]/60 text-white shadow-md'
                    : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/15 text-slate-800 dark:text-slate-200 hover:border-[#0066FF]/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold tracking-tight">
                    {loan.loanNumber}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider ${
                      loan.status === 'VENCIDO'
                        ? active
                          ? 'text-rose-300'
                          : 'text-rose-600 dark:text-rose-400'
                        : loan.status === 'PAGADO'
                        ? active
                          ? 'text-emerald-300'
                          : 'text-emerald-600 dark:text-emerald-400'
                        : active
                        ? 'text-[#00D1FF]'
                        : 'text-[#0066FF] dark:text-[#00D1FF]'
                    }`}
                  >
                    {loan.status}
                  </span>
                </div>
                <p
                  className={`mt-1.5 font-mono tabular-nums text-sm font-bold ${
                    active ? 'text-white' : 'text-slate-950 dark:text-white'
                  }`}
                >
                  {formatMoney(loan.currentPrincipalBalance, loan.currency)}
                </p>
                <p
                  className={`text-[11px] ${
                    active ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Saldo capital · {loan.termMonths}m · {loan.frequency}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Empathetic Arrears Relief Alert Banner (when overdue or critical) */}
      {health.needsHardshipAssistance && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 ${
            health.isCriticalArrears
              ? 'border-rose-500/40 bg-rose-500/[0.08] dark:bg-rose-950/35'
              : 'border-amber-500/40 bg-amber-500/[0.08] dark:bg-amber-950/25'
          }`}
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${
                health.isCriticalArrears
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
              }`}
            >
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p
                className={`text-[11px] font-bold uppercase tracking-[0.14em] ${
                  health.isCriticalArrears
                    ? 'text-rose-700 dark:text-rose-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {health.isCriticalArrears
                  ? `Atención Prioritaria · ${health.maxDaysPastDue} días de atraso · ${health.overdueInstallmentsCount} cuota(s) vencida(s)`
                  : `Cuota vencida detectada · ${health.maxDaysPastDue} día(s) de atraso`}
              </p>
              <h3 className="font-display text-base sm:text-lg font-bold text-slate-950 dark:text-white">
                {health.healthHeadline}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                {health.healthDescription} Monto para ponerse al día:{' '}
                <strong className="font-mono tabular-nums text-slate-950 dark:text-white">
                  {formatMoney(health.amountToCatchUp, selectedLoan.currency)}
                </strong>
                {health.accruedLateFeeTotal > 0
                  ? ` (incluye ${formatMoney(health.accruedLateFeeTotal, selectedLoan.currency)} de mora acumulada).`
                  : '.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenHardshipRelief}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-sm transition-colors"
            >
              <HeartHandshake className="w-4 h-4" />
              <span>Solicitar Ayuda / Plan de Alivio</span>
            </button>
            <button
              type="button"
              onClick={() => onPayNextInstallment(primaryPayAmount, primaryPayNote)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#08132B] hover:bg-slate-50 dark:hover:bg-[#0E1E42] border border-slate-300 dark:border-white/20 text-slate-900 dark:text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <CreditCard className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
              <span>Ponerse al Día Ahora</span>
            </button>
          </div>
        </div>
      )}

      {/* Primary Credit Status & Amortization Progress Card */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden shadow-xs">
        <div className="p-5 sm:p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 items-center">
          {/* Left: Interactive Recharts Principal Donut + Status Narrative */}
          <div className="xl:col-span-5 flex flex-col sm:flex-row items-center sm:items-center gap-5">
            <ClientPrincipalProgressDonut
              loan={selectedLoan}
              healthLevel={health.healthLevel}
            />

            <div className="min-w-0 text-center sm:text-left space-y-2">
              <div className="inline-flex items-center gap-1.5">
                <StatusIcon className={`w-4 h-4 ${theme.accentText}`} />
                <span
                  className={`text-xs font-bold uppercase tracking-[0.12em] ${theme.accentText}`}
                >
                  {health.healthLabel}
                </span>
              </div>

              <div>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {selectedLoan.loanNumber} · {selectedLoan.currency} · {selectedLoan.frequency}
                </p>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white mt-0.5 leading-tight">
                  {formatMoney(selectedLoan.currentPrincipalBalance, selectedLoan.currency)}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Saldo de capital actual de{' '}
                  <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                    {formatMoney(
                      selectedLoan.totalFinancedPrincipal || selectedLoan.approvedPrincipal,
                      selectedLoan.currency
                    )}
                  </span>{' '}
                  financiados
                </p>
              </div>

              <div className="pt-1 flex flex-wrap justify-center sm:justify-start gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  Cuotas:{' '}
                  <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {health.paidInstallmentsCount}/{health.totalInstallmentsCount || selectedLoan.termMonths}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Tasa:{' '}
                  <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {formatRatePct(selectedLoan.contractualRateMonthly)}/mes
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Vence:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {formatShortDate(selectedLoan.maturityDate)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* Right: Live Financial Metrics & Instant Self-Service Actions */}
          <div className="xl:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 p-3.5">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {health.needsHardshipAssistance ? 'Monto para Ponerse al Día' : 'Próxima Cuota'}
                </p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
                  {primaryPayAmount > 0
                    ? formatMoney(primaryPayAmount, selectedLoan.currency)
                    : '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {health.needsHardshipAssistance
                    ? `${health.overdueInstallmentsCount} cuota(s) vencida(s)`
                    : health.nextDueInstallment
                    ? `Cuota #${health.nextDueInstallment.installmentNumber} · ${formatShortDate(
                        health.nextDueInstallment.dueDate
                      )}`
                    : 'Sin cuotas pendientes'}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 p-3.5">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {health.accruedLateFeeTotal > 0 ? 'Mora Acumulada' : 'Total Pagado a la Fecha'}
                </p>
                <p
                  className={`mt-1 font-mono tabular-nums text-lg font-bold ${
                    health.accruedLateFeeTotal > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {health.accruedLateFeeTotal > 0
                    ? formatMoney(health.accruedLateFeeTotal, selectedLoan.currency)
                    : formatMoney(
                        (selectedLoan.paidPrincipalTotal || 0) +
                          (selectedLoan.paidInterestTotal || 0),
                        selectedLoan.currency
                      )}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {health.accruedLateFeeTotal > 0
                    ? `${health.maxDaysPastDue} días de atraso máx.`
                    : `Capital pagado: ${formatMoney(
                        selectedLoan.paidPrincipalTotal || 0,
                        selectedLoan.currency
                      )}`}
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 p-3.5">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Saldo Estimado de Cancelación
                </p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
                  {formatMoney(health.estimatedPayoffTotal, selectedLoan.currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {health.daysUntilNextDue !== null && health.daysUntilNextDue >= 0
                    ? health.daysUntilNextDue === 0
                      ? 'Próximo vencimiento: hoy'
                      : `Próximo pago en ${health.daysUntilNextDue} día(s)`
                    : `Desembolso: ${formatShortDate(selectedLoan.disbursementDate)}`}
                </p>
              </div>
            </div>

            {/* Renewal Guidance + Quick Action Buttons */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 min-w-0">
                <TrendingUp className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                <span className="truncate">{health.renewalGuidance}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {primaryPayAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => onPayNextInstallment(primaryPayAmount, primaryPayNote)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-xs transition-all"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{health.needsHardshipAssistance ? 'Pagar Atraso' : 'Pagar Próxima Cuota'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenRenewal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#040C1E] hover:bg-slate-200 dark:hover:bg-[#0B1C3D] border border-slate-200 dark:border-[#00B8FF]/25 text-slate-900 dark:text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                  <span>Simular Renovación</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenMessages}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#040C1E] hover:bg-slate-200 dark:hover:bg-[#0B1C3D] border border-slate-200 dark:border-white/15 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Escribir a Admin</span>
                  <ArrowUpRight className="w-3 h-3 opacity-70" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
