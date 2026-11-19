import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  getSantoDomingoTodayIso,
  mapCalculatorToPaymentFrequency,
  mapPaymentFrequencyToCalculator,
  simulateOriginationWithMotorV2,
  type CalculatorCurrency,
  type CalculatorExpensesMode,
  type CalculatorFrequencyKey,
  type CalculatorInterestType,
  type CalculatorPaymentMode,
} from '../engine/loanCalculatorEngine';
import type { EngineEvaluationInput } from '../engine/decisionEngineV2';
import type {
  AmortizationMethod,
  CreditPolicyRecord,
  PaymentFrequency,
} from '../types/axycore';
import { SCORING_STATUS_LABELS } from '../utils/formatters';

interface OriginationLoanSimulatorProps {
  policy: CreditPolicyRecord;
  draftApplication: EngineEvaluationInput['application'];
  draftCustomer: EngineEvaluationInput['customer'];
  onApplyConditions: (updates: {
    requestedAmount?: number;
    requestedTermMonths?: number;
    paymentFrequency?: PaymentFrequency;
    amortizationMethod?: AmortizationMethod;
  }) => void;
}

function fmtMoney(amount: number, currency: CalculatorCurrency): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return (
    prefix +
    Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtPct(value: number): string {
  return (
    Number(value).toLocaleString('es-DO', {
      maximumFractionDigits: 4,
    }) + '%'
  );
}

function fmtDateDisplay(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function OriginationLoanSimulator({
  policy,
  draftApplication,
  draftCustomer,
  onApplyConditions,
}: OriginationLoanSimulatorProps) {
  const [interestType, setInterestType] = useState<CalculatorInterestType>(() =>
    draftApplication.amortizationMethod === 'INTERES_FIJO' ? 'Fija' : 'Insoluta'
  );
  const [gastosMode, setGastosMode] = useState<CalculatorExpensesMode>('Descontar');
  const [modalidadPago, setModalidadPago] = useState<CalculatorPaymentMode>('Normal');
  const [cuotasSoloInteres, setCuotasSoloInteres] = useState<string>('1');
  const [usarTasaMotorV2, setUsarTasaMotorV2] = useState<boolean>(true);
  const [tasaPersonalizada, setTasaPersonalizada] = useState<string>('');
  const [fechaDesembolso, setFechaDesembolso] = useState<string>(() => getSantoDomingoTodayIso());
  const [freqSim, setFreqSim] = useState<CalculatorFrequencyKey>(() =>
    mapPaymentFrequencyToCalculator(draftApplication.paymentFrequency)
  );
  const [customFxRate, setCustomFxRate] = useState<string>('');
  const [loadingBcrd, setLoadingBcrd] = useState<boolean>(false);
  const [bcrdNote, setBcrdNote] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<'NONE' | 'COMPARISON' | 'SCHEDULE'>('NONE');
  const [scheduleCurrencyView, setScheduleCurrencyView] = useState<'original' | 'DOP'>('original');

  const parsedCustomFx = useMemo(() => {
    const num = Number(customFxRate);
    return customFxRate.trim() !== '' && Number.isFinite(num) && num > 0 ? num : null;
  }, [customFxRate]);

  const simulation = useMemo(
    () =>
      simulateOriginationWithMotorV2({
        application: draftApplication,
        customer: draftCustomer,
        policy,
        interestType,
        frequencyOverride: freqSim,
        modalidadPago,
        cuotasSoloInteres: Number(cuotasSoloInteres || 0),
        gastos: gastosMode,
        usarTasaMotorV2,
        tasaPersonalizada,
        fechaDesembolso,
        overrideExchangeRate: parsedCustomFx,
        executedBy: 'origination_panel_simulator',
      }),
    [
      draftApplication,
      draftCustomer,
      policy,
      interestType,
      freqSim,
      modalidadPago,
      cuotasSoloInteres,
      gastosMode,
      usarTasaMotorV2,
      tasaPersonalizada,
      fechaDesembolso,
      parsedCustomFx,
    ]
  );

  const handleLoadBcrdFx = async () => {
    setLoadingBcrd(true);
    setBcrdNote(null);
    try {
      const resp = await fetch('/api/exchange-rate/bcrd');
      if (!resp.ok) throw new Error('No disponible');
      const data = await resp.json();
      if (data?.ok && typeof data.venta === 'number' && data.venta > 0) {
        setCustomFxRate(String(data.venta));
        setBcrdNote(`BCRD: RD$${data.venta.toFixed(4)} (${data.fecha || 'Oficial'})`);
      } else {
        setBcrdNote('BCRD no disponible; usando tasa Motor V2.');
      }
    } catch {
      setBcrdNote('BCRD no disponible; usando tasa Motor V2.');
    } finally {
      setLoadingBcrd(false);
    }
  };

  const {
    scoring,
    motorConfig,
    comparison,
    selectedSimulation,
    calculatorError,
    projectedDtiWithSimulation,
    complianceChecks,
  } = simulation;

  const currency = draftApplication.currency as CalculatorCurrency;
  const maxDtiPct = Number((policy.capacityConfig.maxProjectedDti * 100).toFixed(1));
  const projectedDtiPct = Number((projectedDtiWithSimulation * 100).toFixed(1));
  const failedChecksCount = complianceChecks.filter((c) => !c.passed).length;

  const canApplyRecommended =
    scoring.recommendedAmount > 0 &&
    (scoring.recommendedAmount !== draftApplication.requestedAmount ||
      (scoring.recommendedTermMonths > 0 &&
        scoring.recommendedTermMonths !== draftApplication.requestedTermMonths));

  const handleExportCsv = () => {
    if (!selectedSimulation) return;
    const isDopView =
      selectedSimulation.moneda === 'USD' &&
      scheduleCurrencyView === 'DOP' &&
      Boolean(selectedSimulation.cuotasDOP);
    const rows =
      isDopView && selectedSimulation.cuotasDOP
        ? selectedSimulation.cuotasDOP
        : selectedSimulation.cuotas;
    const currCode = isDopView ? 'DOP' : selectedSimulation.moneda;
    const lines = [
      [
        '# Cuota',
        'Fecha',
        'Etapa',
        `Capital (${currCode})`,
        `Interes (${currCode})`,
        `Cuota (${currCode})`,
        `Balance (${currCode})`,
      ].join(','),
      ...rows.map((r) =>
        [
          r.numero,
          r.fecha,
          `"${r.etapa}"`,
          r.capital.toFixed(2),
          r.interes.toFixed(2),
          r.cuota.toFixed(2),
          r.balance.toFixed(2),
        ].join(',')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `axycore-originacion-${selectedSimulation.moneda}-${selectedSimulation.tipo.toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#091020] p-4 sm:p-5 space-y-4">
      {/* Simulator Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-[#e7f0ff] dark:bg-[#0A1D3D] border border-[#c8dcfa] dark:border-[#1D4ED8]/40 text-[#175cb9] dark:text-[#60A5FA] grid place-items-center shrink-0">
            <Calculator className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Simulador Integrado · Parámetros Motor V2
              </h3>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300">
                <Cpu className="w-3 h-3 text-[#175cb9] dark:text-[#38BDF8]" />
                v{policy.version} · {policy.status}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {motorConfig.product.label} · Rango {fmtMoney(motorConfig.minAmount, currency)} –{' '}
              {fmtMoney(motorConfig.maxAmount, currency)} · Plazo {motorConfig.minTermMonths}–
              {motorConfig.maxTermMonths} meses · {motorConfig.rateSourceLabel}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-700 font-mono tabular-nums">
            <span className="text-slate-500 dark:text-slate-400 mr-1.5">Score Vivo:</span>
            <strong className="text-slate-900 dark:text-slate-100">
              {scoring.totalScore}/100
            </strong>
            <span className="mx-1.5 text-slate-300 dark:text-slate-700">|</span>
            <span className="font-sans font-semibold text-[#175cb9] dark:text-[#60A5FA]">
              {scoring.riskBand.label}
            </span>
          </div>
        </div>
      </div>

      {/* Simulation Parameter Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label
            htmlFor="orig-sim-freq"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Frecuencia simulada
          </label>
          <select
            id="orig-sim-freq"
            value={freqSim}
            onChange={(e) => {
              const next = e.target.value as CalculatorFrequencyKey;
              setFreqSim(next);
              const mapped = mapCalculatorToPaymentFrequency(next);
              if (mapped && motorConfig.product.allowedFrequencies.includes(mapped)) {
                onApplyConditions({ paymentFrequency: mapped });
              }
            }}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="Mensual">Mensual (×1 cuota/mes)</option>
            <option value="Quincenal">Quincenal (×2 cuotas/mes)</option>
            <option value="Semanal">Semanal (×4 cuotas/mes)</option>
            <option value="Diaria">Diaria (×30 cuotas/mes)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="orig-sim-tipo"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Esquema de interés
          </label>
          <select
            id="orig-sim-tipo"
            value={interestType}
            onChange={(e) => {
              const next = e.target.value as CalculatorInterestType;
              setInterestType(next);
              onApplyConditions({
                amortizationMethod: next === 'Fija' ? 'INTERES_FIJO' : 'SALDO_INSOLUTO',
              });
            }}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="Insoluta">Insoluta (Política Motor V2)</option>
            <option value="Fija">Fija (Comparativa)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="orig-sim-gastos"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Gastos legales
          </label>
          <select
            id="orig-sim-gastos"
            value={gastosMode}
            onChange={(e) => setGastosMode(e.target.value as CalculatorExpensesMode)}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="Descontar">Descontar del desembolso</option>
            <option value="Financiar">Financiar gastos legales</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="orig-sim-modalidad"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Modalidad de pago
          </label>
          <select
            id="orig-sim-modalidad"
            value={modalidadPago}
            onChange={(e) => setModalidadPago(e.target.value as CalculatorPaymentMode)}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="Normal">Normal</option>
            <option value="SoloInteresesInicial">Por período (solo intereses inicio)</option>
          </select>
        </div>
      </div>

      {/* Secondary Row: Rate Mode, Interest-Only Periods, Disbursement Date, FX */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div>
          <label
            htmlFor="orig-sim-rate-mode"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Origen de tasa mensual
          </label>
          <select
            id="orig-sim-rate-mode"
            value={usarTasaMotorV2 ? 'AUTO' : 'CUSTOM'}
            onChange={(e) => {
              const auto = e.target.value === 'AUTO';
              setUsarTasaMotorV2(auto);
              if (!auto && !tasaPersonalizada) {
                setTasaPersonalizada(String(motorConfig.appliedMonthlyRatePct));
              }
            }}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="AUTO">
              Motor V2 ({fmtPct(motorConfig.appliedMonthlyRatePct)}/mes)
            </option>
            <option value="CUSTOM">Tasa personalizada (%)</option>
          </select>
        </div>

        {!usarTasaMotorV2 && (
          <div>
            <label
              htmlFor="orig-sim-custom-rate"
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
            >
              Tasa personalizada mensual (%)
            </label>
            <input
              id="orig-sim-custom-rate"
              type="number"
              min="0"
              step="0.01"
              value={tasaPersonalizada}
              onChange={(e) => setTasaPersonalizada(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
        )}

        {modalidadPago === 'SoloInteresesInicial' && (
          <div>
            <label
              htmlFor="orig-sim-solo-int"
              className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
            >
              Cuotas iniciales solo intereses
            </label>
            <input
              id="orig-sim-solo-int"
              type="number"
              min="1"
              max={Math.max(1, simulation.installmentCount - 1)}
              step="1"
              value={cuotasSoloInteres}
              onChange={(e) => setCuotasSoloInteres(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="orig-sim-fecha"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
          >
            Fecha estimada de desembolso
          </label>
          <input
            id="orig-sim-fecha"
            type="date"
            value={fechaDesembolso}
            onChange={(e) => setFechaDesembolso(e.target.value)}
            className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
          />
        </div>

        {currency === 'USD' && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label
                htmlFor="orig-sim-fx"
                className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
              >
                Tasa USD/DOP
              </label>
              <button
                type="button"
                onClick={handleLoadBcrdFx}
                disabled={loadingBcrd}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#175cb9] dark:text-[#38BDF8] hover:underline cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${loadingBcrd ? 'animate-spin' : ''}`} />
                <span>Cargar BCRD</span>
              </button>
            </div>
            <input
              id="orig-sim-fx"
              type="number"
              min="0.0001"
              step="0.01"
              placeholder={String(policy.exchangeRateConfig.dopPerUsd)}
              value={customFxRate}
              onChange={(e) => setCustomFxRate(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] px-2.5 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
            />
            {bcrdNote && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{bcrdNote}</p>
            )}
          </div>
        )}
      </div>

      {/* Calculator Validation Error if e.g. amount < legal fee */}
      {calculatorError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{calculatorError}</span>
        </div>
      )}

      {/* Key Metrics Grid */}
      {selectedSimulation && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-[#103b78] text-white p-3.5">
            <div className="text-[11px] font-medium text-[#d2e5ff]">
              {selectedSimulation.cuotasIguales ? 'Cuota simulada' : 'Cuota inicial'}
            </div>
            <div className="text-xl font-extrabold font-mono tabular-nums mt-0.5">
              {fmtMoney(selectedSimulation.cuotaInicial, currency)}
            </div>
            <div className="text-[11px] text-[#d8e9ff] mt-0.5 font-mono tabular-nums">
              {selectedSimulation.numeroCuotas} cuotas ({fmtPct(selectedSimulation.tasaAplicada)}/mes)
              {selectedSimulation.equivalenteDOP
                ? ` · ${fmtMoney(selectedSimulation.equivalenteDOP.cuotaInicial, 'DOP')}`
                : ''}
            </div>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Neto a recibir ({selectedSimulation.modalidadGastos})
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
              {fmtMoney(selectedSimulation.montoNetoRecibir, currency)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
              Gastos legales: {fmtMoney(selectedSimulation.gastosLegales, currency)}
            </div>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Total intereses / Total a pagar
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {fmtMoney(selectedSimulation.totalAPagar, currency)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
              Interés: {fmtMoney(selectedSimulation.totalIntereses, currency)}
            </div>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Capacidad Motor V2 / DTI
            </div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {scoring.capacityResult.maxInstallmentAllowed > 0
                ? fmtMoney(scoring.capacityResult.maxInstallmentAllowed, currency)
                : 'Sin datos'}
            </div>
            <div
              className={`text-[11px] mt-0.5 font-mono tabular-nums ${
                projectedDtiPct <= maxDtiPct
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              DTI proy.: {scoring.capacityResult.eligibleIncome > 0 ? `${projectedDtiPct}%` : '—'} (máx. {maxDtiPct}%)
            </div>
          </div>
        </div>
      )}

      {/* Motor V2 Sustainable Recommendation Callout */}
      {scoring.recommendedAmount > 0 && (
        <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-sky-200 dark:border-sky-900/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
              <Sparkles className="w-3.5 h-3.5 text-[#175cb9] dark:text-[#38BDF8]" />
              <span>
                Precalificación Motor V2: {SCORING_STATUS_LABELS[scoring.status]}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
              Monto sostenible: {fmtMoney(scoring.recommendedAmount, currency)} · Plazo:{' '}
              {scoring.recommendedTermMonths} meses · Tasa:{' '}
              {fmtPct(scoring.recommendedRateMonthly * 100)}/mes · Cuota est.:{' '}
              {fmtMoney(scoring.recommendedInstallment, currency)}
            </p>
          </div>
          {canApplyRecommended && (
            <button
              type="button"
              onClick={() =>
                onApplyConditions({
                  requestedAmount: scoring.recommendedAmount,
                  requestedTermMonths: scoring.recommendedTermMonths,
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#175cb9] hover:bg-[#104f9e] text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors shrink-0"
            >
              <span>Aplicar condiciones recomendadas</span>
            </button>
          )}
        </div>
      )}

      {/* Compliance Checks Grid */}
      <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Validación contra Política Crediticia Motor V2
          </span>
          <span
            className={`text-[11px] font-semibold ${
              failedChecksCount === 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {failedChecksCount === 0
              ? 'Todas las condiciones cumplen la política'
              : `${failedChecksCount} observación(es) de política`}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {complianceChecks.map((chk) => (
            <div
              key={chk.key}
              className={`rounded-lg border px-3 py-2 text-[11px] flex items-start gap-2 ${
                chk.passed
                  ? 'border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/25'
              }`}
            >
              {chk.passed ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 dark:text-slate-200">{chk.label}</div>
                <div className="text-slate-500 dark:text-slate-400 leading-snug">{chk.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Comparison & Full Amortization Schedule Controls */}
      {selectedSimulation && comparison && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setDetailsTab((prev) => (prev === 'COMPARISON' ? 'NONE' : 'COMPARISON'))
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>Comparar Fija vs. Insoluta</span>
                {detailsTab === 'COMPARISON' ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setDetailsTab((prev) => (prev === 'SCHEDULE' ? 'NONE' : 'SCHEDULE'))
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0D1628] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>Ver Tabla de Amortización ({selectedSimulation.numeroCuotas} cuotas)</span>
                {detailsTab === 'SCHEDULE' ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Simulación no transaccional · No crea operaciones hasta enviar la solicitud
            </span>
          </div>

          {detailsTab === 'COMPARISON' && (
            <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-4 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3 text-left font-semibold">Concepto</th>
                    <th className="py-2 px-3 text-right font-semibold">Fija</th>
                    <th className="py-2 px-3 text-right font-semibold">Insoluta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(
                    [
                      ['Monto financiado', 'montoFinanciado'],
                      ['Monto neto a recibir', 'montoNetoRecibir'],
                      ['Cuota inicial', 'cuotaInicial'],
                      ['Cuota final', 'cuotaFinal'],
                      ['Total de intereses', 'totalIntereses'],
                      ['Total a pagar', 'totalAPagar'],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key}>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                        {label}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          interestType === 'Fija'
                            ? 'bg-[#eef4ff] dark:bg-[#0A1D3D] font-bold text-[#175cb9] dark:text-[#60A5FA]'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {fmtMoney(comparison.fija[key], currency)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          interestType === 'Insoluta'
                            ? 'bg-[#eef4ff] dark:bg-[#0A1D3D] font-bold text-[#175cb9] dark:text-[#60A5FA]'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {fmtMoney(comparison.insoluta[key], currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailsTab === 'SCHEDULE' && (
            <div className="rounded-xl bg-white dark:bg-[#0D1628] border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Calendario proyectado ({selectedSimulation.tipo} · {selectedSimulation.numeroCuotas} cuotas)
                </span>
                <div className="flex items-center gap-2">
                  {selectedSimulation.moneda === 'USD' && (
                    <select
                      aria-label="Moneda de tabla de amortización"
                      value={scheduleCurrencyView}
                      onChange={(e) =>
                        setScheduleCurrencyView(e.target.value as 'original' | 'DOP')
                      }
                      className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#091020] px-2 text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      <option value="original">USD</option>
                      <option value="DOP">Equivalente DOP</option>
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#eaf1fc] hover:bg-[#dce9fc] dark:bg-[#0A1D3D] dark:hover:bg-[#102952] text-[#175cb9] dark:text-[#7CE4FF] text-xs font-semibold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              <div className="overflow-auto max-h-72 rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse whitespace-nowrap text-xs">
                  <thead>
                    <tr className="bg-[#eaf1fc] dark:bg-[#0A1D3D] text-[#214e84] dark:text-[#93C5FD] border-b border-slate-200 dark:border-slate-800">
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-left font-bold">
                        #
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-left font-bold">
                        Fecha
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-left font-bold">
                        Etapa
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-right font-bold">
                        Capital
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-right font-bold">
                        Interés
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-right font-bold">
                        Cuota
                      </th>
                      <th className="sticky top-0 bg-[#eaf1fc] dark:bg-[#0A1D3D] py-2 px-3 text-right font-bold">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(selectedSimulation.moneda === 'USD' &&
                    scheduleCurrencyView === 'DOP' &&
                    selectedSimulation.cuotasDOP
                      ? selectedSimulation.cuotasDOP
                      : selectedSimulation.cuotas
                    ).map((row) => {
                      const displayCurr: CalculatorCurrency =
                        selectedSimulation.moneda === 'USD' && scheduleCurrencyView === 'DOP'
                          ? 'DOP'
                          : selectedSimulation.moneda;
                      return (
                        <tr key={row.numero}>
                          <td className="py-2 px-3 font-mono tabular-nums">{row.numero}</td>
                          <td className="py-2 px-3 font-mono tabular-nums">
                            {fmtDateDisplay(row.fecha)}
                          </td>
                          <td className="py-2 px-3">{row.etapa}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {fmtMoney(row.capital, displayCurr)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {fmtMoney(row.interes, displayCurr)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                            {fmtMoney(row.cuota, displayCurr)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {fmtMoney(row.balance, displayCurr)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
