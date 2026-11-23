import React, { useMemo } from 'react';
import { Calculator, CheckCircle2, Info, Sparkles } from 'lucide-react';
import {
  computeInstallmentCountFromMonths,
  mapLegalFeeModeToCalculator,
  PAYMENT_FREQUENCY_LABELS,
} from '../engine/integratedCreditEngine';
import {
  calculateLoanSimulation,
  getSantoDomingoTodayIso,
  mapAmortizationMethodToCalculator,
  mapPaymentFrequencyToCalculator,
  suggestLoanConditions,
  type CalculatorSimulationResult,
} from '../engine/loanCalculatorEngine';
import type {
  AmortizationMethod,
  CurrencyCode,
  LegalFeeApplicationMode,
  PaymentFrequency,
} from '../types/axycore';
import { formatMoney } from '../utils/formatters';

export interface LoanConditionDraft {
  requestedAmount: number;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  legalFeeMode: LegalFeeApplicationMode;
}

export interface ComputedPolicyPreview {
  policyRatePct: number;
  policyRateDecimal: number;
  policyLegalFees: number;
  installmentCount: number;
  simulation: CalculatorSimulationResult | null;
  error: string | null;
}

export function computeLoanConditionPreview(
  currency: CurrencyCode,
  draft: LoanConditionDraft,
  exchangeRate: number | null | undefined = 60
): ComputedPolicyPreview {
  const safeAmount = Number(draft.requestedAmount);
  const safeTermMonths = Math.max(1, Math.round(Number(draft.termMonths) || 1));
  const installmentCount = computeInstallmentCountFromMonths(
    safeTermMonths,
    draft.paymentFrequency
  );

  if (!Number.isFinite(safeAmount) || safeAmount < 1) {
    return {
      policyRatePct: 0,
      policyRateDecimal: 0,
      policyLegalFees: 0,
      installmentCount,
      simulation: null,
      error: 'Ingrese un monto válido mayor a 0.',
    };
  }

  try {
    const sug = suggestLoanConditions(currency, safeAmount);
    const safeFx =
      typeof exchangeRate === 'number' && Number.isFinite(exchangeRate) && exchangeRate > 0
        ? exchangeRate
        : 60;
    const simulation = calculateLoanSimulation({
      moneda: currency,
      monto: safeAmount,
      frecuencia: mapPaymentFrequencyToCalculator(draft.paymentFrequency),
      plazo: installmentCount,
      fecha: getSantoDomingoTodayIso(),
      usarSugerida: true,
      tipo: mapAmortizationMethodToCalculator(draft.amortizationMethod),
      modalidadPago: 'Normal',
      cuotasSoloInteres: 0,
      gastos: mapLegalFeeModeToCalculator(draft.legalFeeMode),
      tasaCambio: currency === 'USD' ? safeFx : null,
    });

    return {
      policyRatePct: sug.tasa,
      policyRateDecimal: Number((sug.tasa / 100).toFixed(6)),
      policyLegalFees: sug.gastosLegales,
      installmentCount,
      simulation,
      error: null,
    };
  } catch (err) {
    return {
      policyRatePct: 0,
      policyRateDecimal: 0,
      policyLegalFees: 0,
      installmentCount,
      simulation: null,
      error: err instanceof Error ? err.message : 'No se pudo calcular la simulación.',
    };
  }
}

interface LoanConditionsEditorProps {
  currency: CurrencyCode;
  value: LoanConditionDraft;
  onChange: (next: LoanConditionDraft) => void;
  suggestedAmount?: number | null;
  exchangeRate?: number | null;
  disabled?: boolean;
  variant?: 'default' | 'stacked';
  footerAction?: React.ReactNode;
}

const FREQUENCIES: PaymentFrequency[] = ['DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL'];
const QUICK_TERMS = [6, 12, 18, 24, 36];

export function LoanConditionsEditor({
  currency,
  value,
  onChange,
  suggestedAmount,
  exchangeRate = 60,
  disabled = false,
  variant = 'default',
  footerAction,
}: LoanConditionsEditorProps) {
  const preview = useMemo(
    () => computeLoanConditionPreview(currency, value, exchangeRate),
    [currency, value, exchangeRate]
  );

  const updateField = <K extends keyof LoanConditionDraft>(
    key: K,
    nextVal: LoanConditionDraft[K]
  ) => {
    onChange({ ...value, [key]: nextVal });
  };

  const currencySymbol = currency === 'USD' ? 'US$' : 'RD$';
  const showSuggestedBtn =
    !disabled &&
    typeof suggestedAmount === 'number' &&
    suggestedAmount > 0 &&
    Math.abs(suggestedAmount - value.requestedAmount) >= 1;

  const rateOptions = [
    {
      id: 'SALDO_INSOLUTO' as AmortizationMethod,
      title: 'Saldo Insoluto',
      desc: 'Interés decreciente sobre el balance pendiente (cuota nivelada).',
    },
    {
      id: 'INTERES_FIJO' as AmortizationMethod,
      title: 'Interés Fijo',
      desc: 'Interés constante sobre el monto financiado durante todo el plazo.',
    },
  ] as const;

  const legalFeeOptions = [
    {
      id: 'DESCONTAR_DESEMBOLSO' as LegalFeeApplicationMode,
      title: 'Descontar del desembolso',
      desc: preview.simulation
        ? `Se descuentan al entregar · Cliente recibe ${formatMoney(
            Math.max(0, value.requestedAmount - preview.policyLegalFees),
            currency
          )}`
        : 'Se descuentan del monto entregado al cliente.',
    },
    {
      id: 'FINANCIAR' as LegalFeeApplicationMode,
      title: 'Agregar al préstamo (Financiar)',
      desc: preview.simulation
        ? `Se suman al capital · Capital financiado: ${formatMoney(
            value.requestedAmount + preview.policyLegalFees,
            currency
          )}`
        : 'Se agregan al monto financiado del préstamo.',
    },
  ] as const;

  if (variant === 'stacked') {
    return (
      <div className="space-y-3.5">
        {/* Grupo de Tarjetas Apiladas (1 col móvil -> 2x2 escritorio) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
          {/* Tarjeta 1: Monto */}
          <div className="axy-surface rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <label
                    htmlFor="eval-loan-amount"
                    className="block text-sm font-bold text-slate-950 dark:text-white"
                  >
                    Monto del Préstamo
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Moneda {currency} · Capital base para escala de política
                  </p>
                </div>
                {showSuggestedBtn && (
                  <button
                    type="button"
                    onClick={() => updateField('requestedAmount', Math.round(suggestedAmount))}
                    className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Usar {formatMoney(suggestedAmount, currency)}
                  </button>
                )}
              </div>

              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-bold text-slate-500 dark:text-slate-400">
                  {currencySymbol}
                </span>
                <input
                  id="eval-loan-amount"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="any"
                  disabled={disabled}
                  value={value.requestedAmount || ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateField('requestedAmount', raw === '' ? 0 : Math.max(0, Number(raw)));
                  }}
                  className="axy-input w-full min-h-[48px] pl-12 pr-3.5 py-2.5 text-lg font-mono font-bold tabular-nums text-slate-950 dark:text-white disabled:opacity-60"
                />
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Tasa según escala vigente</span>
              <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                {!preview.error && preview.policyRatePct > 0
                  ? `${preview.policyRatePct}% mensual`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Tarjeta 2: Plazo y Frecuencia */}
          <div className="axy-surface rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <label
                    htmlFor="eval-loan-term"
                    className="block text-sm font-bold text-slate-950 dark:text-white"
                  >
                    Plazo y Frecuencia
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Duración en meses y periodicidad de cobro
                  </p>
                </div>
                <span className="text-xs font-mono font-semibold tabular-nums text-[#0052CC] dark:text-[#00D1FF]">
                  {preview.installmentCount}{' '}
                  {preview.installmentCount === 1 ? 'cuota' : 'cuotas'}
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="relative">
                  <input
                    id="eval-loan-term"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={120}
                    disabled={disabled}
                    value={value.termMonths || ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      updateField(
                        'termMonths',
                        raw === '' ? 1 : Math.max(1, Math.min(120, Math.round(Number(raw))))
                      );
                    }}
                    className="axy-input w-full min-h-[48px] pl-3.5 pr-16 py-2.5 text-lg font-mono font-bold tabular-nums text-slate-950 dark:text-white disabled:opacity-60"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    meses
                  </span>
                </div>

                {!disabled && (
                  <div className="grid grid-cols-5 gap-1.5">
                    {QUICK_TERMS.map((m) => {
                      const active = value.termMonths === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateField('termMonths', m)}
                          className={`min-h-[40px] px-2 rounded-xl text-xs font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-[#0066FF] text-white'
                              : 'bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/[0.12]'
                          }`}
                        >
                          {m}m
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-200/80 dark:border-white/10 space-y-1.5">
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Frecuencia de Pago
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {FREQUENCIES.map((freq) => {
                  const active = value.paymentFrequency === freq;
                  return (
                    <button
                      key={freq}
                      type="button"
                      disabled={disabled}
                      onClick={() => updateField('paymentFrequency', freq)}
                      className={`min-h-[44px] px-2.5 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 ${
                        active
                          ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF]'
                          : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/25'
                      }`}
                    >
                      {PAYMENT_FREQUENCY_LABELS[freq]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tarjeta 3: Tipo de Tasa */}
          <div className="axy-surface rounded-2xl p-4 sm:p-5 space-y-3">
            <div>
              <span className="block text-sm font-bold text-slate-950 dark:text-white">
                Tipo de Tasa
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Define cómo se calcula el interés durante el plazo
              </p>
            </div>

            <div className="space-y-2">
              {rateOptions.map((opt) => {
                const active = value.amortizationMethod === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateField('amortizationMethod', opt.id)}
                    className={`w-full min-h-[60px] p-3.5 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-60 ${
                      active
                        ? 'border-[#0066FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/15'
                        : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-bold ${
                          active
                            ? 'text-[#0052CC] dark:text-[#00D1FF]'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {opt.title}
                      </span>
                      {active && (
                        <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tarjeta 4: Gastos Legales */}
          <div className="axy-surface rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="block text-sm font-bold text-slate-950 dark:text-white">
                  Gastos Legales
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Aplicación según política institucional
                </p>
              </div>
              <span className="text-xs font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                {formatMoney(preview.policyLegalFees, currency)}
              </span>
            </div>

            <div className="space-y-2">
              {legalFeeOptions.map((opt) => {
                const active = value.legalFeeMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateField('legalFeeMode', opt.id)}
                    className={`w-full min-h-[60px] p-3.5 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-60 ${
                      active
                        ? 'border-[#0066FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/15'
                        : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-bold ${
                          active
                            ? 'text-[#0052CC] dark:text-[#00D1FF]'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {opt.title}
                      </span>
                      {active && (
                        <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tarjeta 5: Resumen Financiero en Vivo + Acción */}
        {preview.error ? (
          <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
            {preview.error}
          </div>
        ) : preview.simulation ? (
          <div className="axy-surface rounded-2xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                <Calculator className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                Resumen según Política Institucional
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Tasa y gastos legales automáticos por escala vigente
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 pt-3 border-t border-slate-200/80 dark:border-white/10">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Cuota {PAYMENT_FREQUENCY_LABELS[value.paymentFrequency]}
                </p>
                <p className="text-base sm:text-lg font-mono font-bold tabular-nums text-[#0052CC] dark:text-[#00D1FF] mt-0.5">
                  {formatMoney(preview.simulation.cuotaInicial, currency)}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {preview.installmentCount} cuotas ·{' '}
                  {value.amortizationMethod === 'INTERES_FIJO' ? 'Fija' : 'Insoluta'}
                </p>
              </div>

              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Tasa Política (Mensual)
                </p>
                <p className="text-base sm:text-lg font-mono font-bold tabular-nums text-slate-950 dark:text-white mt-0.5">
                  {preview.policyRatePct}%
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {preview.simulation.tasaPeriodicaPorcentaje}% por período
                </p>
              </div>

              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Gastos Legales
                </p>
                <p className="text-base sm:text-lg font-mono font-bold tabular-nums text-slate-950 dark:text-white mt-0.5">
                  {formatMoney(preview.policyLegalFees, currency)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {value.legalFeeMode === 'FINANCIAR' ? 'Agregados al préstamo' : 'Descontados'}
                </p>
              </div>

              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Neto a Desembolsar
                </p>
                <p className="text-base sm:text-lg font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                  {formatMoney(preview.simulation.montoNetoRecibir, currency)}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Financiado: {formatMoney(preview.simulation.montoFinanciado, currency)}
                </p>
              </div>
            </div>

            {footerAction && (
              <div className="pt-3 border-t border-slate-200/80 dark:border-white/10">
                {footerAction}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Row 1: Monto + Plazo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Monto del Préstamo ({currency})
            </label>
            {showSuggestedBtn && (
              <button
                type="button"
                onClick={() => updateField('requestedAmount', Math.round(suggestedAmount))}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                Usar sugerido ({formatMoney(suggestedAmount, currency)})
              </button>
            )}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {currencySymbol}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              disabled={disabled}
              value={value.requestedAmount || ''}
              onChange={(e) => {
                const raw = e.target.value;
                updateField('requestedAmount', raw === '' ? 0 : Math.max(0, Number(raw)));
              }}
              className="axy-input w-full min-h-[44px] pl-11 pr-3 py-2 text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Plazo (Meses)
            </label>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {preview.installmentCount}{' '}
              {preview.installmentCount === 1 ? 'cuota' : 'cuotas'} (
              {PAYMENT_FREQUENCY_LABELS[value.paymentFrequency].toLowerCase()})
            </span>
          </div>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            disabled={disabled}
            value={value.termMonths || ''}
            onChange={(e) => {
              const raw = e.target.value;
              updateField('termMonths', raw === '' ? 1 : Math.max(1, Math.min(120, Math.round(Number(raw)))));
            }}
            className="axy-input w-full min-h-[44px] px-3 py-2 text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white disabled:opacity-60"
          />
          {!disabled && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {QUICK_TERMS.map((m) => {
                const active = value.termMonths === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateField('termMonths', m)}
                    className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold tabular-nums transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0066FF] text-white'
                        : 'bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/[0.12]'
                    }`}
                  >
                    {m}m
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Frecuencia de Pago */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
          Frecuencia de Pago
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FREQUENCIES.map((freq) => {
            const active = value.paymentFrequency === freq;
            return (
              <button
                key={freq}
                type="button"
                disabled={disabled}
                onClick={() => updateField('paymentFrequency', freq)}
                className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] shadow-xs'
                    : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/25'
                }`}
              >
                {PAYMENT_FREQUENCY_LABELS[freq]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 3: Forma de la Tasa (Saldo Insoluto vs Interés Fijo) */}
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
          Forma de la Tasa (Tipo de Interés)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {rateOptions.map((opt) => {
            const active = value.amortizationMethod === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => updateField('amortizationMethod', opt.id)}
                className={`min-h-[56px] p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? 'border-[#0066FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/15'
                    : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-bold ${
                      active
                        ? 'text-[#0052CC] dark:text-[#00D1FF]'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {opt.title}
                  </span>
                  {active && (
                    <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 4: Gastos Legales según Política (Descontados vs Agregados) */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            ¿Cómo se aplicarán los Gastos Legales?
          </label>
          <span className="text-xs font-mono font-bold tabular-nums text-slate-900 dark:text-white">
            Política vigente: {formatMoney(preview.policyLegalFees, currency)}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {legalFeeOptions.map((opt) => {
            const active = value.legalFeeMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => updateField('legalFeeMode', opt.id)}
                className={`min-h-[56px] p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? 'border-[#0066FF] bg-[#0066FF]/10 dark:bg-[#0066FF]/15'
                    : 'border-slate-200 dark:border-white/12 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-bold ${
                      active
                        ? 'text-[#0052CC] dark:text-[#00D1FF]'
                        : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {opt.title}
                  </span>
                  {active && (
                    <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Row 5: Tasa de Política + Resumen Financiero en Vivo */}
      {preview.error ? (
        <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          {preview.error}
        </div>
      ) : preview.simulation ? (
        <div className="rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50/80 dark:bg-[#06122A]/70 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
              <Calculator className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
              Cálculo automático según política institucional
            </span>
            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Info className="w-3 h-3" />
              Tasa y gastos legales determinados por escala vigente
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-slate-200/80 dark:border-white/10">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cuota {PAYMENT_FREQUENCY_LABELS[value.paymentFrequency]}
              </p>
              <p className="text-base font-mono font-bold tabular-nums text-[#0052CC] dark:text-[#00D1FF] mt-0.5">
                {formatMoney(preview.simulation.cuotaInicial, currency)}
              </p>
              <p className="text-[10px] text-slate-500 tabular-nums">
                {preview.installmentCount} cuotas ·{' '}
                {value.amortizationMethod === 'INTERES_FIJO' ? 'Fija' : 'Insoluta'}
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Tasa Política (Mensual)
              </p>
              <p className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {preview.policyRatePct}%
              </p>
              <p className="text-[10px] text-slate-500 tabular-nums">
                {preview.simulation.tasaPeriodicaPorcentaje}% por período
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Gastos Legales
              </p>
              <p className="text-base font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {formatMoney(preview.policyLegalFees, currency)}
              </p>
              <p className="text-[10px] text-slate-500">
                {value.legalFeeMode === 'FINANCIAR' ? 'Agregados al préstamo' : 'Descontados'}
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Neto a Desembolsar
              </p>
              <p className="text-base font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                {formatMoney(preview.simulation.montoNetoRecibir, currency)}
              </p>
              <p className="text-[10px] text-slate-500 tabular-nums">
                Financiado: {formatMoney(preview.simulation.montoFinanciado, currency)}
              </p>
            </div>
          </div>

          {footerAction && (
            <div className="pt-2.5 border-t border-slate-200/80 dark:border-white/10">
              {footerAction}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
