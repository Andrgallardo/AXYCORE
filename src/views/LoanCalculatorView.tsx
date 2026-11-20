import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  Cpu,
  Download,
  RefreshCw,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  buildMotorV2CalculatorConfig,
  compareLoanSimulations,
  DEFAULT_CALCULATOR_CONFIG,
  getSantoDomingoTodayIso,
  mapCalculatorToAmortizationMethod,
  mapCalculatorToPaymentFrequency,
  suggestLoanConditions,
  type CalculatorComparisonResult,
  type CalculatorCurrency,
  type CalculatorExpensesMode,
  type CalculatorFrequencyKey,
  type CalculatorInterestType,
  type CalculatorPaymentMode,
  type CalculatorSimulationResult,
} from '../engine/loanCalculatorEngine';
import type { ProductCode, RiskBandCode } from '../types/axycore';
import { PRODUCT_LABELS } from '../utils/formatters';

interface BcrdRateMeta {
  fuente?: string;
  fecha?: string;
  respaldo?: boolean;
  automatica?: boolean;
}

const FREQ_PLURAL: Record<CalculatorFrequencyKey, string> = {
  Diaria: 'diarias',
  Semanal: 'semanales',
  Quincenal: 'quincenales',
  Mensual: 'mensuales',
};

function formatMoneyCalc(amount: number, moneda: CalculatorCurrency): string {
  const prefix = moneda === 'USD' ? 'US$' : 'RD$';
  return (
    prefix +
    Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatPercentCalc(value: number): string {
  return (
    Number(value).toLocaleString('es-DO', {
      maximumFractionDigits: 6,
    }) + '%'
  );
}

function formatDateDisplay(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function LoanCalculatorView() {
  const {
    organization,
    externalPortalMode,
    rbac,
    setActiveSection,
    activeOrTestPolicy,
  } = useAxyCore();
  const isClientPortalUser = externalPortalMode || rbac.role === 'EXTERNAL_CLIENT';
  const canOriginate = rbac.hasPermission('ORIGINATE_APPLICATION');

  // Form inputs (matching exact initial defaults of the reference calculator)
  const [moneda, setMoneda] = useState<CalculatorCurrency>('DOP');
  const [paramSource, setParamSource] = useState<'STANDARD' | 'MOTOR_V2'>('STANDARD');
  const [motorProductCode, setMotorProductCode] = useState<ProductCode>('PERSONAL_DOP');
  const [motorRiskBand, setMotorRiskBand] = useState<RiskBandCode | 'REFERENCIA'>('BAJO');
  const [tasaCambio, setTasaCambio] = useState<string>('');
  const [bcrdMeta, setBcrdMeta] = useState<BcrdRateMeta>({});
  const [bcrdLoading, setBcrdLoading] = useState(false);
  const [manualExchangeEdited, setManualExchangeEdited] = useState(false);

  const [monto, setMonto] = useState<string>('');
  const [frecuencia, setFrecuencia] = useState<CalculatorFrequencyKey>('Mensual');
  const [plazo, setPlazo] = useState<string>('12');
  const [fecha, setFecha] = useState<string>(() => getSantoDomingoTodayIso());

  const [usarSugerida, setUsarSugerida] = useState<boolean>(true);
  const [tasaPersonalizada, setTasaPersonalizada] = useState<string>('');
  const [tipo, setTipo] = useState<CalculatorInterestType>('Fija');
  const [modalidadPago, setModalidadPago] = useState<CalculatorPaymentMode>('Normal');
  const [cuotasSoloInteres, setCuotasSoloInteres] = useState<string>('1');
  const [gastos, setGastos] = useState<CalculatorExpensesMode>('Descontar');

  // Calculation state
  const [comparison, setComparison] = useState<CalculatorComparisonResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [tablaMoneda, setTablaMoneda] = useState<'original' | 'DOP'>('original');

  const fetchBcrdRate = useCallback(
    async (forceRefresh = false, overwriteInput = false) => {
      setBcrdLoading(true);
      try {
        const res = await fetch(
          forceRefresh ? '/api/exchange-rate/bcrd?refresh=1' : '/api/exchange-rate/bcrd'
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data?.ok && typeof data.venta === 'number' && data.venta > 0) {
          setBcrdMeta({
            fuente: `${data.fuente || 'Banco Central de la República Dominicana (BCRD)'} · Tasa de venta`,
            fecha: data.fecha || undefined,
            respaldo: Boolean(data.respaldo),
            automatica: true,
          });
          if (overwriteInput || !manualExchangeEdited) {
            setTasaCambio((prev) => (overwriteInput || !prev ? String(data.venta) : prev));
          }
        } else {
          setBcrdMeta({
            fuente: 'Manual',
            automatica: false,
            respaldo: false,
          });
        }
      } catch {
        setBcrdMeta({
          fuente: 'Manual',
          automatica: false,
          respaldo: false,
        });
      } finally {
        setBcrdLoading(false);
      }
    },
    [manualExchangeEdited]
  );

  useEffect(() => {
    void fetchBcrdRate(false, false);
  }, [fetchBcrdRate]);

  const motorV2Resolved = useMemo(() => {
    try {
      return buildMotorV2CalculatorConfig({
        policy: activeOrTestPolicy,
        productCode: motorProductCode,
        riskBandCode: motorRiskBand,
        overrideExchangeRate: Number(tasaCambio) > 0 ? Number(tasaCambio) : null,
      });
    } catch {
      return null;
    }
  }, [activeOrTestPolicy, motorProductCode, motorRiskBand, tasaCambio]);

  const activeCalculatorConfig = useMemo(() => {
    if (paramSource === 'MOTOR_V2' && motorV2Resolved) {
      return motorV2Resolved.config;
    }
    return DEFAULT_CALCULATOR_CONFIG;
  }, [paramSource, motorV2Resolved]);

  // Derived condition preview (always reflects live form state)
  const freqConfig = activeCalculatorConfig.frecuencias[frecuencia];
  const plazoNum = Number(plazo);

  const liveSuggestion = useMemo(() => {
    const montoNum = Number(monto);
    if (!monto || !Number.isFinite(montoNum) || montoNum < 1) {
      return null;
    }
    try {
      return suggestLoanConditions(moneda, monto, activeCalculatorConfig);
    } catch {
      return null;
    }
  }, [moneda, monto, activeCalculatorConfig]);

  const appliedLiveRate = useMemo(() => {
    if (!liveSuggestion) return NaN;
    return usarSugerida ? liveSuggestion.tasa : Number(tasaPersonalizada);
  }, [liveSuggestion, usarSugerida, tasaPersonalizada]);

  const motorV2Alerts = useMemo(() => {
    if (paramSource !== 'MOTOR_V2' || !motorV2Resolved) return [];
    const alerts: string[] = [];
    const mNum = Number(monto);
    const pNum = Number(plazo);
    const monthsEquiv =
      Number.isFinite(pNum) && pNum > 0 ? Math.round((pNum / freqConfig.divisor) * 10) / 10 : 0;

    if (monto && Number.isFinite(mNum) && mNum > 0) {
      if (mNum < motorV2Resolved.minAmount) {
        alerts.push(
          `Monto inferior al mínimo de ${motorV2Resolved.product.label} (${formatMoneyCalc(
            motorV2Resolved.minAmount,
            moneda
          )}).`
        );
      }
      if (mNum > motorV2Resolved.maxAmount) {
        alerts.push(
          `Monto supera el máximo del producto (${formatMoneyCalc(motorV2Resolved.maxAmount, moneda)}).`
        );
      }
      if (motorV2Resolved.bandCap !== null && mNum > motorV2Resolved.bandCap) {
        alerts.push(
          `Monto excede el tope de la banda seleccionada (${formatMoneyCalc(
            motorV2Resolved.bandCap,
            moneda
          )}).`
        );
      }
    }

    const maxTermBand =
      motorV2Resolved.bandMaxTermMonths !== null
        ? Math.min(motorV2Resolved.maxTermMonths, motorV2Resolved.bandMaxTermMonths)
        : motorV2Resolved.maxTermMonths;

    if (plazo && monthsEquiv > 0) {
      if (monthsEquiv < motorV2Resolved.minTermMonths || monthsEquiv > maxTermBand) {
        alerts.push(
          `Plazo equivalente (${monthsEquiv} meses) fuera del rango Motor V2 para esta banda (${motorV2Resolved.minTermMonths}–${maxTermBand} meses).`
        );
      }
    }
    return alerts;
  }, [paramSource, motorV2Resolved, monto, plazo, freqConfig.divisor, moneda]);

  const cambioHelpText = useMemo(() => {
    const fxNum = Number(tasaCambio);
    if (moneda === 'USD' && Number.isFinite(fxNum) && fxNum > 0) {
      const fuenteTxt = bcrdMeta.fuente ? ` · Fuente: ${bcrdMeta.fuente}` : '';
      const fechaTxt = bcrdMeta.fecha ? ` · ${bcrdMeta.fecha}` : '';
      const respaldoTxt = bcrdMeta.respaldo ? ' · Última tasa oficial disponible' : '';
      return `1 USD = ${formatMoneyCalc(fxNum, 'DOP')}${fuenteTxt}${fechaTxt}${respaldoTxt} · Editable`;
    }
    return 'Se carga automáticamente desde el BCRD; puede editarla si necesita otra tasa.';
  }, [moneda, tasaCambio, bcrdMeta]);

  const actual: CalculatorSimulationResult | null = useMemo(() => {
    if (!comparison) return null;
    return tipo === 'Insoluta' ? comparison.insoluta : comparison.fija;
  }, [comparison, tipo]);

  const buildInputPayload = useCallback(
    (overrideTipo?: CalculatorInterestType) => ({
      moneda,
      monto,
      frecuencia,
      plazo: Number(plazo),
      fecha,
      usarSugerida,
      tasaPersonalizada,
      tipo: overrideTipo ?? tipo,
      modalidadPago,
      cuotasSoloInteres: Number(cuotasSoloInteres || 0),
      gastos,
      tasaCambio,
    }),
    [
      moneda,
      monto,
      frecuencia,
      plazo,
      fecha,
      usarSugerida,
      tasaPersonalizada,
      tipo,
      modalidadPago,
      cuotasSoloInteres,
      gastos,
      tasaCambio,
    ]
  );

  const runCalculation = useCallback(
    (overrideTipo?: CalculatorInterestType) => {
      try {
        const result = compareLoanSimulations(
          buildInputPayload(overrideTipo),
          activeCalculatorConfig
        );
        setComparison(result);
        setErrorMsg(null);
        setIsStale(false);
        if (moneda !== 'USD') {
          setTablaMoneda('original');
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Verifique los datos ingresados.');
        if (comparison) {
          setIsStale(true);
        }
      }
    },
    [buildInputPayload, activeCalculatorConfig, comparison, moneda]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runCalculation();
  };

  const markStale = () => {
    if (comparison) setIsStale(true);
  };

  const handleTransferToOrigination = () => {
    if (!actual || typeof window === 'undefined') return;
    const targetProduct: ProductCode =
      paramSource === 'MOTOR_V2'
        ? motorProductCode
        : actual.moneda === 'USD'
        ? 'PERSONAL_USD'
        : 'PERSONAL_DOP';
    const monthsEst = Math.max(
      1,
      Math.round(actual.plazo / activeCalculatorConfig.frecuencias[actual.frecuencia].divisor)
    );
    const seed = {
      productCode: targetProduct,
      requestedAmount: actual.montoSolicitado,
      requestedTermMonths: monthsEst,
      paymentFrequency: mapCalculatorToPaymentFrequency(actual.frecuencia) ?? 'MENSUAL',
      amortizationMethod: mapCalculatorToAmortizationMethod(actual.tipo),
    };
    window.sessionStorage.setItem('axycore_calculator_origination_seed', JSON.stringify(seed));
    setActiveSection('new_application');
  };

  const handleExportScheduleCsv = () => {
    if (!actual) return;
    const isDopView = actual.moneda === 'USD' && tablaMoneda === 'DOP' && actual.cuotasDOP;
    const rows = isDopView && actual.cuotasDOP ? actual.cuotasDOP : actual.cuotas;
    const currencyCode = isDopView ? 'DOP' : actual.moneda;
    const header = [
      '# Cuota',
      'Fecha',
      'Etapa',
      `Capital (${currencyCode})`,
      `Interes (${currencyCode})`,
      `Cuota (${currencyCode})`,
      `Balance (${currencyCode})`,
    ];
    const csvLines = [
      header.join(','),
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
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `axycore-simulacion-${actual.moneda}-${actual.tipo.toLowerCase()}-${actual.numeroCuotas}cuotas.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const esDOPSchedule =
    actual !== null && actual.moneda === 'USD' && tablaMoneda === 'DOP' && Boolean(actual.cuotasDOP);
  const scheduleRows = useMemo(() => {
    if (!actual) return [];
    return esDOPSchedule && actual.cuotasDOP ? actual.cuotasDOP : actual.cuotas;
  }, [actual, esDOPSchedule]);

  const scheduleCurrency: CalculatorCurrency = esDOPSchedule ? 'DOP' : actual?.moneda ?? 'DOP';

  const scheduleTotals = useMemo(() => {
    const capCents = scheduleRows.reduce((acc, r) => acc + Math.round(r.capital * 100), 0);
    const intCents = scheduleRows.reduce((acc, r) => acc + Math.round(r.interes * 100), 0);
    const cuotaCents = scheduleRows.reduce((acc, r) => acc + Math.round(r.cuota * 100), 0);
    return {
      capital: capCents / 100,
      interes: intCents / 100,
      cuota: cuotaCents / 100,
      balance: 0,
    };
  }, [scheduleRows]);

  const soloInteresInt = Number(cuotasSoloInteres || 0);
  const maxSoloInteres = Math.max(1, (Number.isFinite(plazoNum) ? plazoNum : 12) - 1);
  const amortizanRestantes = Math.max(0, (Number.isFinite(plazoNum) ? plazoNum : 0) - soloInteresInt);

  const dEq = actual?.equivalenteDOP;

  return (
    <div className="space-y-6 pb-8">
      {/* Header Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 p-5 sm:p-6 text-white shadow-sm">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-12 w-12 rounded-xl bg-white p-1.5 shadow-sm flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/image_aea21874.png"
                alt="AxyCore"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Calculadora de Préstamos
                </h1>
                <span className="inline-flex items-center rounded-md border border-[#00B8FF]/35 bg-[#00B8FF]/15 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-[#7CE4FF]">
                  SIMULACIÓN · Sin crear operaciones
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                Condiciones claras. Cálculos precisos en DOP y USD para {organization.tradeName || organization.name}.
              </p>
            </div>
          </div>

          {isClientPortalUser && (
            <button
              type="button"
              onClick={() => setActiveSection('dashboard')}
              className="inline-flex items-center gap-2 self-start lg:self-auto px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white whitespace-nowrap cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver al Portal</span>
            </button>
          )}
        </div>
      </section>

      {/* Main Two-Column Calculator Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,435px)_minmax(0,1fr)] gap-6 items-start">
        {/* Left Form Column */}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Card 1: Datos del préstamo */}
          <section className="rounded-2xl axy-surface p-5 sm:p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <span className="h-7 w-7 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0052CC] dark:text-[#00D1FF] text-xs font-bold grid place-items-center shrink-0">
                1
              </span>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Datos del préstamo
              </h2>
            </div>

            <div className="space-y-4">
              {/* Moneda */}
              <div>
                <label
                  htmlFor="calc-moneda"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Moneda
                </label>
                <select
                  id="calc-moneda"
                  value={moneda}
                  onChange={(e) => {
                    const nextMoneda = e.target.value as CalculatorCurrency;
                    setMoneda(nextMoneda);
                    setMotorProductCode((prev) => {
                      const isBiz = prev.startsWith('EMPRESARIAL');
                      if (nextMoneda === 'USD') {
                        return isBiz ? 'EMPRESARIAL_USD' : 'PERSONAL_USD';
                      }
                      return isBiz ? 'EMPRESARIAL_DOP' : 'PERSONAL_DOP';
                    });
                    markStale();
                    if (nextMoneda === 'USD' && !tasaCambio) {
                      if (paramSource === 'MOTOR_V2') {
                        setTasaCambio(String(activeOrTestPolicy.exchangeRateConfig.dopPerUsd));
                      } else {
                        void fetchBcrdRate(false, false);
                      }
                    }
                  }}
                  className="axy-input w-full h-11 px-3 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="DOP">Peso Dominicano (DOP / RD$)</option>
                  <option value="USD">Dólar Estadounidense (USD / US$)</option>
                </select>
              </div>

              {/* Tasa de cambio USD/DOP */}
              {moneda === 'USD' && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label
                      htmlFor="calc-cambio"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      Tasa de cambio USD/DOP
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setManualExchangeEdited(false);
                        void fetchBcrdRate(true, true);
                      }}
                      disabled={bcrdLoading}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${bcrdLoading ? 'animate-spin' : ''}`} />
                      <span>{bcrdLoading ? 'Consultando BCRD...' : 'Actualizar BCRD'}</span>
                    </button>
                  </div>
                  <input
                    id="calc-cambio"
                    type="number"
                    inputMode="decimal"
                    step="0.000001"
                    min="0.000001"
                    placeholder="Ej.: 63.50"
                    value={tasaCambio}
                    onChange={(e) => {
                      setManualExchangeEdited(true);
                      setTasaCambio(e.target.value);
                      markStale();
                    }}
                    className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    {cambioHelpText}
                  </p>
                </div>
              )}

              {/* Monto solicitado */}
              <div>
                <label
                  htmlFor="calc-monto"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Monto solicitado ({moneda === 'USD' ? 'US$' : 'RD$'})
                </label>
                <input
                  id="calc-monto"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                  placeholder={moneda === 'USD' ? 'Ej.: 2000.00' : 'Ej.: 100000.00'}
                  value={monto}
                  onChange={(e) => {
                    setMonto(e.target.value);
                    markStale();
                  }}
                  className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Frecuencia + Plazo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="calc-frecuencia"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Frecuencia de pago
                  </label>
                  <select
                    id="calc-frecuencia"
                    value={frecuencia}
                    onChange={(e) => {
                      setFrecuencia(e.target.value as CalculatorFrequencyKey);
                      markStale();
                    }}
                    className="axy-input w-full h-11 px-3 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(DEFAULT_CALCULATOR_CONFIG.frecuencias) as CalculatorFrequencyKey[]).map(
                      (freq) => (
                        <option key={freq} value={freq}>
                          {freq}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="calc-plazo"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Plazo ({freqConfig.unidad})
                  </label>
                  <input
                    id="calc-plazo"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={DEFAULT_CALCULATOR_CONFIG.maxCuotas}
                    step="1"
                    required
                    value={plazo}
                    onChange={(e) => {
                      setPlazo(e.target.value);
                      markStale();
                    }}
                    className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1">
                {plazo || '—'} {freqConfig.unidad} = {plazo || '—'} cuotas {FREQ_PLURAL[frecuencia]}.
              </p>

              {/* Fecha de desembolso */}
              <div>
                <label
                  htmlFor="calc-fecha"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Fecha estimada de desembolso
                </label>
                <input
                  id="calc-fecha"
                  type="date"
                  required
                  value={fecha}
                  onChange={(e) => {
                    setFecha(e.target.value);
                    markStale();
                  }}
                  className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </section>

          {/* Card 2: Condiciones */}
          <section className="rounded-2xl axy-surface p-5 sm:p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <span className="h-7 w-7 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0052CC] dark:text-[#00D1FF] text-xs font-bold grid place-items-center shrink-0">
                2
              </span>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Condiciones
              </h2>
            </div>

            <div className="space-y-4">
              {/* Fuente de Parámetros: Tarifario Estándar vs Motor V2 */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Parámetros de tasa y límites
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl axy-surface-tonal">
                  <button
                    type="button"
                    onClick={() => {
                      setParamSource('STANDARD');
                      markStale();
                    }}
                    className={`py-2 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      paramSource === 'STANDARD'
                        ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    Tarifario Estándar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParamSource('MOTOR_V2');
                      markStale();
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      paramSource === 'MOTOR_V2'
                        ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>Motor V2 v{activeOrTestPolicy.version}</span>
                  </button>
                </div>
              </div>

              {paramSource === 'MOTOR_V2' && (
                <div className="rounded-xl axy-surface-tonal p-3.5 space-y-3">
                  <div>
                    <label
                      htmlFor="calc-motor-product"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Producto Motor V2
                    </label>
                    <select
                      id="calc-motor-product"
                      value={motorProductCode}
                      onChange={(e) => {
                        const nextProd = e.target.value as ProductCode;
                        setMotorProductCode(nextProd);
                        const nextCurr: CalculatorCurrency = nextProd.endsWith('USD') ? 'USD' : 'DOP';
                        setMoneda(nextCurr);
                        if (nextCurr === 'USD' && !tasaCambio) {
                          setTasaCambio(String(activeOrTestPolicy.exchangeRateConfig.dopPerUsd));
                        }
                        markStale();
                      }}
                      className="axy-input w-full h-10 px-2.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {(Object.keys(PRODUCT_LABELS) as ProductCode[]).map((code) => (
                        <option key={code} value={code}>
                          {PRODUCT_LABELS[code]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="calc-motor-band"
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Banda de Riesgo / Tasa Política
                    </label>
                    <select
                      id="calc-motor-band"
                      value={motorRiskBand}
                      onChange={(e) => {
                        setMotorRiskBand(e.target.value as RiskBandCode | 'REFERENCIA');
                        markStale();
                      }}
                      className="axy-input w-full h-10 px-2.5 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {activeOrTestPolicy.riskBands
                        .filter((b) => b.monthlyRate !== null)
                        .map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.label} ({b.minScore}–{b.maxScore} pts) ·{' '}
                            {((b.monthlyRate ?? 0) * 100).toFixed(2)}%/mes · Tope{' '}
                            {formatMoneyCalc(
                              activeOrTestPolicy.products[motorProductCode].bandCaps[b.code] ?? 0,
                              moneda
                            )}
                          </option>
                        ))}
                      <option value="REFERENCIA">
                        Tasa de Referencia Capacidad ·{' '}
                        {(
                          activeOrTestPolicy.capacityConfig.referenceSimulationMonthlyRate * 100
                        ).toFixed(2)}
                        %/mes
                      </option>
                    </select>
                  </div>

                  {motorV2Alerts.length > 0 && (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/35 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200 space-y-0.5">
                      {motorV2Alerts.map((msg) => (
                        <div key={msg}>{msg}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Live Suggestion Box */}
              <div className="axy-surface-ai rounded-xl p-3.5">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {paramSource === 'MOTOR_V2' && motorV2Resolved
                    ? motorV2Resolved.rateSourceLabel
                    : 'Tasa sugerida'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-[#0052CC] dark:text-[#00D1FF]">
                  {paramSource === 'MOTOR_V2' && motorV2Resolved
                    ? `${formatPercentCalc(motorV2Resolved.appliedMonthlyRatePct)} mensual`
                    : liveSuggestion
                    ? `${formatPercentCalc(liveSuggestion.tasa)} mensual`
                    : '—'}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300/90 mt-1">
                  {liveSuggestion && Number.isFinite(appliedLiveRate)
                    ? `Tasa ${frecuencia.toLowerCase()}: ${formatPercentCalc(
                        appliedLiveRate / freqConfig.divisor
                      )} · ${usarSugerida ? 'Automática' : 'Personalizada'}`
                    : 'Indique el monto para consultar la tasa.'}
                </p>
              </div>

              {/* ¿Desea utilizar la tasa sugerida? */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  ¿Desea utilizar la tasa sugerida?
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl axy-surface-tonal cursor-pointer text-sm font-medium text-slate-800 dark:text-slate-200">
                    <input
                      type="radio"
                      name="usarSugerida"
                      checked={usarSugerida}
                      onChange={() => {
                        setUsarSugerida(true);
                        markStale();
                      }}
                      className="h-4 w-4 accent-[#0066FF]"
                    />
                    <span>Sí</span>
                  </label>
                  <label className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl axy-surface-tonal cursor-pointer text-sm font-medium text-slate-800 dark:text-slate-200">
                    <input
                      type="radio"
                      name="usarSugerida"
                      checked={!usarSugerida}
                      onChange={() => {
                        setUsarSugerida(false);
                        markStale();
                      }}
                      className="h-4 w-4 accent-[#0066FF]"
                    />
                    <span>No</span>
                  </label>
                </div>
              </div>

              {/* Tasa personalizada mensual */}
              {!usarSugerida && (
                <div>
                  <label
                    htmlFor="calc-personal"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Tasa personalizada mensual (%)
                  </label>
                  <input
                    id="calc-personal"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.000001"
                    placeholder="Ej.: 3.5"
                    value={tasaPersonalizada}
                    onChange={(e) => {
                      setTasaPersonalizada(e.target.value);
                      markStale();
                    }}
                    className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Reemplaza la tasa sugerida solamente en esta simulación.
                  </p>
                </div>
              )}

              {/* Tipo de interés */}
              <div>
                <label
                  htmlFor="calc-tipo"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Tipo de interés
                </label>
                <select
                  id="calc-tipo"
                  value={tipo}
                  onChange={(e) => {
                    const nextTipo = e.target.value as CalculatorInterestType;
                    setTipo(nextTipo);
                    if (comparison) {
                      runCalculation(nextTipo);
                    }
                  }}
                  className="axy-input w-full h-11 px-3 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="Fija">Fija</option>
                  <option value="Insoluta">Insoluta</option>
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  {tipo === 'Fija'
                    ? 'Capital uniforme e interés fijo sobre el monto financiado.'
                    : 'Cuota nivelada; interés sobre el saldo pendiente de cada período.'}
                </p>
              </div>

              {/* Modalidad de pago */}
              <div>
                <label
                  htmlFor="calc-modalidad"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Modalidad de pago
                </label>
                <select
                  id="calc-modalidad"
                  value={modalidadPago}
                  onChange={(e) => {
                    setModalidadPago(e.target.value as CalculatorPaymentMode);
                    markStale();
                  }}
                  className="axy-input w-full h-11 px-3 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="Normal">Normal</option>
                  <option value="SoloInteresesInicial">Por período</option>
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  Permite pagar solo intereses al inicio y amortizar el capital en las cuotas restantes.
                </p>
              </div>

              {/* Cuotas iniciales solo intereses */}
              {modalidadPago === 'SoloInteresesInicial' && (
                <div>
                  <label
                    htmlFor="calc-solo-intereses"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Cantidad de cuotas iniciales pagando solo intereses
                  </label>
                  <input
                    id="calc-solo-intereses"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={maxSoloInteres}
                    step="1"
                    value={cuotasSoloInteres}
                    onChange={(e) => {
                      setCuotasSoloInteres(e.target.value);
                      markStale();
                    }}
                    className="axy-input w-full h-11 px-3 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Primeras {soloInteresInt} cuotas: solo intereses. Las {amortizanRestantes} cuotas restantes amortizarán el capital.
                  </p>
                </div>
              )}

              {/* Gastos legales automáticos */}
              <div className="pt-1">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gastos legales automáticos
                </div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {liveSuggestion ? formatMoneyCalc(liveSuggestion.gastosLegales, moneda) : '—'}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Se calculan sobre el monto original solicitado.
                </p>
              </div>

              {/* Aplicación de gastos legales */}
              <div>
                <label
                  htmlFor="calc-gastos"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  ¿Cómo desea aplicar los gastos legales?
                </label>
                <select
                  id="calc-gastos"
                  value={gastos}
                  onChange={(e) => {
                    setGastos(e.target.value as CalculatorExpensesMode);
                    markStale();
                  }}
                  className="axy-input w-full h-11 px-3 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="Descontar">Descontar del desembolso</option>
                  <option value="Financiar">Financiar los gastos legales</option>
                </select>
              </div>
            </div>
          </section>

          {/* Error banner */}
          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs sm:text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submit CTA */}
          <button
            type="submit"
            className="axy-btn-primary w-full py-3.5 px-5 text-sm tracking-wide cursor-pointer"
          >
            CALCULAR PRÉSTAMO
          </button>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed px-1">
            El plazo representa directamente la cantidad de cuotas. Los resultados no crean préstamos, solicitudes, clientes ni desembolsos.
          </p>
        </form>

        {/* Right Result Column */}
        <div className="space-y-5">
          {!actual || !comparison ? (
            <section className="rounded-2xl axy-surface p-10 sm:p-16 text-center">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl axy-surface-tonal border border-[#0066FF]/20 dark:border-[#00B8FF]/25 grid place-items-center text-[#0052CC] dark:text-[#00D1FF]">
                <Calculator className="w-7 h-7" />
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                Su préstamo, en detalle
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                Complete los datos y pulse <strong className="text-slate-700 dark:text-slate-200">Calcular préstamo</strong> para ver las cuotas, los intereses y el monto neto a recibir.
              </p>
            </section>
          ) : (
            <>
              {/* Card 3: Resultado */}
              <section className="rounded-2xl axy-surface p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0052CC] dark:text-[#00D1FF] text-xs font-bold grid place-items-center shrink-0">
                      3
                    </span>
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Resultado
                    </h2>
                    <span className="inline-flex items-center rounded-md border border-[#0066FF]/25 dark:border-[#00B8FF]/30 bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 px-2.5 py-0.5 text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">
                      {actual.tipo}
                    </span>
                  </div>
                  {canOriginate && (
                    <button
                      type="button"
                      onClick={handleTransferToOrigination}
                      className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold cursor-pointer"
                    >
                      <span>Llevar a Nueva Solicitud</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Stale inputs alert */}
                {isStale && (
                  <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-xs font-medium text-amber-900 dark:text-amber-200">
                    Los datos cambiaron. Pulse <strong>CALCULAR PRÉSTAMO</strong> para actualizar el resultado.
                  </div>
                )}

                {/* Hero installment box */}
                <div className="rounded-xl axy-brand-gradient text-white p-5 mb-5 shadow-md">
                  <div className="text-xs font-semibold text-white/80 mb-1">
                    {actual.cuotasIguales ? 'Valor de cada cuota' : 'Cuota inicial'}
                  </div>
                  <div className="text-3xl sm:text-4xl font-extrabold font-mono tabular-nums tracking-tight">
                    {formatMoneyCalc(actual.cuotaInicial, actual.moneda)}
                  </div>
                  <div className="text-xs sm:text-sm text-white/90 mt-1.5">
                    {actual.cuotasIguales
                      ? `${actual.numeroCuotas} cuotas ${FREQ_PLURAL[actual.frecuencia]}`
                      : `Cuota final: ${formatMoneyCalc(actual.cuotaFinal, actual.moneda)} · ${actual.numeroCuotas} cuotas`}
                  </div>
                  {actual.moneda === 'USD' && dEq && (
                    <div className="text-xs sm:text-sm font-mono tabular-nums text-white/85 mt-2">
                      {formatMoneyCalc(dEq.cuotaInicial, 'DOP')}
                      {actual.cuotasIguales ? '' : ` · Final: ${formatMoneyCalc(dEq.cuotaFinal, 'DOP')}`}
                    </div>
                  )}
                </div>

                {/* 6 Core Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {(
                    [
                      ['Monto solicitado', 'montoSolicitado'],
                      ['Gastos legales', 'gastosLegales'],
                      ['Monto financiado', 'montoFinanciado'],
                      ['Total de intereses', 'totalIntereses'],
                      ['Total de capital', 'totalCapital'],
                      ['Total general a pagar', 'totalAPagar'],
                    ] as const
                  ).map(([label, key]) => (
                    <div
                      key={key}
                      className="rounded-xl axy-surface-tonal p-3.5"
                    >
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                        {label}
                      </div>
                      <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatMoneyCalc(actual[key], actual.moneda)}
                      </div>
                      {actual.moneda === 'USD' && dEq && (
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1">
                          {formatMoneyCalc(dEq[key], 'DOP')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Net disbursement bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/50 px-4 py-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200 mb-5">
                  <span className="font-medium">Monto neto que recibe el cliente</span>
                  <strong className="font-mono tabular-nums font-bold">
                    {formatMoneyCalc(actual.montoNetoRecibir, actual.moneda)}
                    {actual.moneda === 'USD' && dEq
                      ? ` / ${formatMoneyCalc(dEq.montoNetoRecibir, 'DOP')}`
                      : ''}
                  </strong>
                </div>

                {/* Summary Key-Value Detail Table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <tbody className="divide-y divide-[var(--axy-border)]">
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">Moneda</td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {actual.moneda === 'USD'
                            ? 'Dólar Estadounidense (USD)'
                            : 'Peso Dominicano (DOP)'}
                        </td>
                      </tr>
                      {actual.moneda === 'USD' && actual.tasaCambio !== undefined && dEq && (
                        <>
                          <tr>
                            <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                              Tasa de cambio
                            </td>
                            <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              1 USD = {formatMoneyCalc(actual.tasaCambio, 'DOP')}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                              Equivalente solicitado DOP
                            </td>
                            <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {formatMoneyCalc(dEq.montoSolicitado, 'DOP')}
                            </td>
                          </tr>
                        </>
                      )}
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">Frecuencia</td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {actual.frecuencia}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">Plazo</td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {actual.plazo} {actual.unidadPlazo}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Número total de cuotas
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {actual.numeroCuotas}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Fecha de desembolso
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatDateDisplay(actual.fechaDesembolso)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Tasa aplicada mensual
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatPercentCalc(actual.tasaAplicada)} · {actual.origenTasa}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Tasa por período
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatPercentCalc(actual.tasaPeriodicaPorcentaje)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Tipo de interés
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {actual.tipo} · {actual.esquema}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Modalidad de pago
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {actual.modalidadPago === 'SoloInteresesInicial'
                            ? 'Por período'
                            : 'Normal'}
                        </td>
                      </tr>
                      {actual.modalidadPago === 'SoloInteresesInicial' && (
                        <>
                          <tr>
                            <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                              Cuotas solo intereses
                            </td>
                            <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {actual.cuotasSoloInteres}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                              Cuotas amortizando capital
                            </td>
                            <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {actual.cuotasAmortizacion}
                            </td>
                          </tr>
                        </>
                      )}
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Modalidad de gastos
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {actual.modalidadGastos === 'Financiar' ? 'Financiados' : 'Descontados'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          {actual.modalidadGastos === 'Financiar'
                            ? 'Monto solicitado'
                            : 'Monto aprobado'}
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoneyCalc(actual.montoSolicitado, actual.moneda)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          {actual.modalidadGastos === 'Financiar'
                            ? '(+) Gastos legales'
                            : '(−) Gastos legales'}
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoneyCalc(actual.gastosLegales, actual.moneda)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          {actual.modalidadGastos === 'Financiar'
                            ? '= Monto total financiado'
                            : '= Monto neto a recibir'}
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoneyCalc(
                            actual.modalidadGastos === 'Financiar'
                              ? actual.montoFinanciado
                              : actual.montoNetoRecibir,
                            actual.moneda
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-4 text-slate-500 dark:text-slate-400">
                          Total de gastos legales
                        </td>
                        <td className="py-2.5 text-right font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {formatMoneyCalc(actual.totalGastosLegales, actual.moneda)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-3.5">
                  {actual.modalidadGastos === 'Financiar'
                    ? 'Monto solicitado + gastos legales = monto financiado. Los gastos están incluidos en el capital y no se suman otra vez al total a pagar.'
                    : 'Monto aprobado − gastos legales = monto neto a recibir. El total general corresponde a las cuotas; los gastos se descuentan una sola vez del desembolso.'}
                </p>
              </section>

              {/* Fija vs. Insoluta Side-by-Side Comparison */}
              <section className="rounded-2xl axy-surface p-5 sm:p-6">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mb-3.5">
                  Fija vs. Insoluta
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3 text-left font-medium">Concepto</th>
                        <th className="py-2.5 px-3 text-right font-medium">Fija</th>
                        <th className="py-2.5 px-3 text-right font-medium">Insoluta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['Cuota inicial', 'cuotaInicial'],
                          ['Cuota final', 'cuotaFinal'],
                          ['Total de intereses', 'totalIntereses'],
                          ['Total a pagar', 'totalAPagar'],
                        ] as const
                      ).map(([label, key]) => (
                        <tr key={key} className="axy-table-row">
                          <td className="py-3 px-3 text-slate-700 dark:text-slate-300 font-medium">
                            {label}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums ${
                              actual.tipo === 'Fija'
                                ? 'bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 font-bold text-[#0052CC] dark:text-[#00D1FF]'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {formatMoneyCalc(comparison.fija[key], actual.moneda)}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums ${
                              actual.tipo === 'Insoluta'
                                ? 'bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 font-bold text-[#0052CC] dark:text-[#00D1FF]'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {formatMoneyCalc(comparison.insoluta[key], actual.moneda)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-3.5">
                  Cambie el tipo de interés para recalcular conservando los datos. Insoluta utiliza cuota nivelada: el interés disminuye y el capital aumenta; la última cuota ajusta el redondeo.
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Full-Width Card 4: Amortization Schedule */}
      {actual && (
        <section className="rounded-2xl axy-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="h-7 w-7 rounded-lg bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0052CC] dark:text-[#00D1FF] text-xs font-bold grid place-items-center shrink-0">
                4
              </span>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Tabla de amortización
              </h2>
              <span className="inline-flex items-center rounded-md border border-[#0066FF]/25 dark:border-[#00B8FF]/30 bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 px-2.5 py-0.5 text-xs font-bold font-mono tabular-nums text-[#0052CC] dark:text-[#00D1FF]">
                {actual.numeroCuotas} cuotas
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {actual.moneda === 'USD' && (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="calc-tabla-moneda"
                    className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    Mostrar en
                  </label>
                  <select
                    id="calc-tabla-moneda"
                    value={tablaMoneda}
                    onChange={(e) => setTablaMoneda(e.target.value as 'original' | 'DOP')}
                    className="axy-input h-9 px-2.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    <option value="original">USD</option>
                    <option value="DOP">Equivalente DOP</option>
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={handleExportScheduleCsv}
                className="axy-btn-secondary inline-flex items-center gap-1.5 h-9 px-3 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            {esDOPSchedule
              ? 'Equivalencias referenciales a la tasa indicada; cada importe se redondea de forma independiente. Las obligaciones y el cierre del capital se calculan en USD.'
              : `Valores en ${actual.moneda}. El balance termina en cero y la última cuota absorbe la diferencia de redondeo.`}
          </p>

          <div className="mt-4 overflow-auto max-h-[580px] rounded-xl border border-[var(--axy-border)]">
            <table className="w-full border-collapse whitespace-nowrap text-xs sm:text-sm">
              <thead>
                <tr className="axy-table-head text-[#041B4E] dark:text-[#00D1FF]">
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-left font-bold">
                    # Cuota
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-left font-bold">
                    Fecha
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-left font-bold">
                    Etapa
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-right font-bold">
                    Capital
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-right font-bold">
                    Interés
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-right font-bold">
                    Cuota
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--axy-surface-tonal)] py-3 px-4 text-right font-bold">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row) => (
                  <tr
                    key={row.numero}
                    className="axy-table-row even:bg-[var(--axy-surface-tonal)]/60"
                  >
                    <td className="py-2.5 px-4 text-left font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {row.numero}
                    </td>
                    <td className="py-2.5 px-4 text-left font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatDateDisplay(row.fecha)}
                    </td>
                    <td className="py-2.5 px-4 text-left text-slate-700 dark:text-slate-300">
                      {row.etapa || 'Amortización'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoneyCalc(row.capital, scheduleCurrency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoneyCalc(row.interes, scheduleCurrency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatMoneyCalc(row.cuota, scheduleCurrency)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatMoneyCalc(row.balance, scheduleCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--axy-surface-tonal)] font-bold text-slate-900 dark:text-slate-100 border-t border-[var(--axy-border-strong)]">
                  <td className="py-3 px-4 text-left">Total</td>
                  <td className="py-3 px-4" />
                  <td className="py-3 px-4" />
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatMoneyCalc(scheduleTotals.capital, scheduleCurrency)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatMoneyCalc(scheduleTotals.interes, scheduleCurrency)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatMoneyCalc(scheduleTotals.cuota, scheduleCurrency)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">
                    {formatMoneyCalc(scheduleTotals.balance, scheduleCurrency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* Footer matching reference branding */}
      <footer className="text-center pt-2 pb-4 text-xs text-slate-500 dark:text-slate-400 space-y-1">
        <div className="font-bold text-slate-700 dark:text-slate-300">
          AxyCore · Calculadora de Préstamos
        </div>
        <div className="font-semibold text-[#0052CC] dark:text-[#00D1FF]">
          Mano Amiga · Distribuidor oficial
        </div>
      </footer>
    </div>
  );
}
