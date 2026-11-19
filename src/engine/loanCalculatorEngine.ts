/* AxyCore — Motor de Simulación de Préstamos integrado (BigInt precisión en centavos).
 * No crea operaciones reales (préstamos, solicitudes, clientes ni desembolsos).
 * Tasas expresadas como porcentaje MENSUAL (5 significa 5%).
 * Conversión de frecuencia: diaria /30, semanal /4, quincenal /2, mensual /1.
 * Insoluta: cuota nivelada con ajuste final de centavos; Fija: capital uniforme e interés fijo.
 * Los límites inferiores son exclusivos salvo el mínimo 1: no quedan huecos para montos con centavos.
 */

import type {
  AmortizationMethod,
  CreditPolicyRecord,
  PaymentFrequency,
  ProductCode,
  ProductLimitConfig,
  RiskBandCode,
  ScoringExecutionRecord,
} from '../types/axycore';
import {
  DEFAULT_POLICY_V2,
  evaluateCreditDecisionV2,
  type EngineEvaluationInput,
} from './decisionEngineV2';

export type CalculatorCurrency = 'DOP' | 'USD';
export type CalculatorFrequencyKey = 'Diaria' | 'Semanal' | 'Quincenal' | 'Mensual';
export type CalculatorInterestType = 'Fija' | 'Insoluta';
export type CalculatorPaymentMode = 'Normal' | 'SoloInteresesInicial';
export type CalculatorExpensesMode = 'Descontar' | 'Financiar';

export interface CalculatorRateTier {
  hasta: number | null;
  tasa: number;
  gasto?: number;
  gastoPorcentaje?: number;
}

export interface CalculatorFrequencyConfig {
  divisor: number;
  dias?: number;
  meses?: number;
  unidad: string;
}

export interface CalculatorConfig {
  DOP: CalculatorRateTier[];
  USD: CalculatorRateTier[];
  frecuencias: Record<CalculatorFrequencyKey, CalculatorFrequencyConfig>;
  maxCuotas: number;
  tasaCambioPredeterminada?: number;
  tasaCambioFuente?: string;
  tasaCambioFecha?: string;
  tasaCambioAutomatica?: boolean;
  tasaCambioRespaldo?: boolean;
}

export interface CalculatorInput {
  moneda: CalculatorCurrency | string;
  monto: number | string;
  frecuencia: CalculatorFrequencyKey | string;
  plazo: number;
  fecha: string;
  usarSugerida: boolean;
  tasaPersonalizada?: number | string;
  tipo: CalculatorInterestType | string;
  modalidadPago?: CalculatorPaymentMode | string;
  cuotasSoloInteres?: number | string;
  gastos: CalculatorExpensesMode | string;
  tasaCambio?: number | string | null;
}

export interface CalculatorSuggestionResult {
  tasa: number;
  gastosLegales: number;
}

export interface CalculatorInstallmentRow {
  numero: number;
  fecha: string;
  etapa: 'Solo intereses' | 'Amortización';
  capital: number;
  interes: number;
  cuota: number;
  balance: number;
}

export interface CalculatorDopInstallmentRow {
  numero: number;
  fecha: string;
  etapa: 'Solo intereses' | 'Amortización';
  capital: number;
  interes: number;
  cuota: number;
  balance: number;
}

export interface CalculatorDopSummary {
  montoSolicitado: number;
  gastosLegales: number;
  montoFinanciado: number;
  montoNetoRecibir: number;
  cuotaInicial: number;
  cuotaFinal: number;
  totalCapital: number;
  totalIntereses: number;
  totalGastosLegales: number;
  totalAPagar: number;
  costoTotalIncluyendoGastos: number;
}

export interface CalculatorSimulationResult {
  moneda: CalculatorCurrency;
  montoSolicitado: number;
  frecuencia: CalculatorFrequencyKey;
  plazo: number;
  unidadPlazo: string;
  numeroCuotas: number;
  fechaDesembolso: string;
  tasaSugerida: number;
  tasaAplicada: number;
  tasaBase: 'Mensual';
  tasaPeriodicaPorcentaje: number;
  origenTasa: 'Automática' | 'Personalizada';
  tipo: CalculatorInterestType;
  modalidadPago: CalculatorPaymentMode;
  cuotasSoloInteres: number;
  cuotasAmortizacion: number;
  esquema: string;
  gastosLegales: number;
  modalidadGastos: CalculatorExpensesMode;
  montoFinanciado: number;
  montoNetoRecibir: number;
  cuotaInicial: number;
  cuotaFinal: number;
  cuotasIguales: boolean;
  totalCapital: number;
  totalIntereses: number;
  totalGastosLegales: number;
  totalAPagar: number;
  costoTotalIncluyendoGastos: number;
  cuotas: CalculatorInstallmentRow[];
  tasaCambio?: number;
  equivalenteDOP?: CalculatorDopSummary;
  cuotasDOP?: CalculatorDopInstallmentRow[];
}

export interface CalculatorComparisonResult {
  fija: CalculatorSimulationResult;
  insoluta: CalculatorSimulationResult;
}

export interface CalculatorParameterRow {
  ID_PARAMETRO: string;
  ACTIVO: boolean | string | number;
  VALOR_TEXTO: string;
}

export interface BcrdExchangeRateResult {
  venta: number;
  fecha: string;
  fuente: string;
  obtenidaEn?: string;
  desdeCache?: boolean;
  respaldo?: boolean;
  motivoRespaldo?: string;
  automatica?: boolean;
}

export const DEFAULT_CALCULATOR_CONFIG: CalculatorConfig = {
  DOP: [
    { hasta: 30000, tasa: 5, gasto: 1000 },
    { hasta: 150000, tasa: 4.5, gasto: 1500 },
    { hasta: null, tasa: 4, gastoPorcentaje: 3 },
  ],
  USD: [
    { hasta: 1000, tasa: 5, gasto: 20 },
    { hasta: 1500, tasa: 5, gasto: 25 },
    { hasta: 2000, tasa: 4.5, gasto: 35 },
    { hasta: 3000, tasa: 4, gasto: 50 },
    { hasta: 5000, tasa: 4, gasto: 75 },
    { hasta: null, tasa: 4, gastoPorcentaje: 3 },
  ],
  frecuencias: {
    Diaria: { divisor: 30, dias: 1, unidad: 'días' },
    Semanal: { divisor: 4, dias: 7, unidad: 'semanas' },
    Quincenal: { divisor: 2, dias: 15, unidad: 'quincenas' },
    Mensual: { divisor: 1, meses: 1, unidad: 'meses' },
  },
  maxCuotas: 10000,
};

function exigir(ok: unknown, mensaje: string): asserts ok {
  if (!ok) {
    throw new Error(mensaje);
  }
}

function enteroDecimal(
  valor: number | string | null | undefined,
  precision: number,
  nombre: string
): bigint {
  exigir(typeof valor === 'number' || typeof valor === 'string', `${nombre} requerido`);
  const texto = String(valor).trim();
  exigir(/^\d+(?:\.\d+)?$/.test(texto), `${nombre} debe ser un número no negativo`);
  const partes = texto.split('.');
  const decimales = partes[1] || '';
  exigir(decimales.length <= precision, `${nombre} excede la precisión admitida`);
  return BigInt(partes[0] + decimales.padEnd(precision, '0'));
}

function dividirRedondeando(n: bigint, d: bigint): bigint {
  return (n + d / BigInt(2)) / d;
}

function importe(centavos: bigint): number {
  exigir(centavos <= BigInt(Number.MAX_SAFE_INTEGER), 'Monto fuera del límite de precisión');
  return Number(centavos) / 100;
}

function fechaISO(texto: string): Date {
  exigir(
    typeof texto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(texto),
    'Fecha requerida en formato AAAA-MM-DD'
  );
  const d = new Date(`${texto}T12:00:00Z`);
  exigir(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === texto, 'Fecha inválida');
  return d;
}

function vencimiento(fecha: Date, numero: number, frecuencia: CalculatorFrequencyConfig): string {
  const d = new Date(fecha.getTime());
  if (frecuencia.meses) {
    const dia = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + numero * frecuencia.meses);
    const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dia, ultimo));
  } else {
    d.setUTCDate(d.getUTCDate() + numero * (frecuencia.dias || 1));
  }
  exigir(Number.isFinite(d.getTime()), 'Fecha de vencimiento fuera de rango');
  return d.toISOString().slice(0, 10);
}

function regla(
  moneda: CalculatorCurrency,
  monto: bigint,
  config: CalculatorConfig
): CalculatorRateTier {
  const reglas = config[moneda];
  exigir(Array.isArray(reglas) && reglas.length > 0, 'Moneda sin configuración');
  let anterior = BigInt(0);
  for (let i = 0; i < reglas.length; i++) {
    const r = reglas[i];
    if (r.hasta === null) {
      exigir(i === reglas.length - 1, 'El rango abierto debe ser el último');
      return r;
    }
    const limite = enteroDecimal(r.hasta, 2, 'Límite');
    exigir(limite > anterior, 'Rangos desordenados o duplicados');
    anterior = limite;
    if (monto <= limite) {
      return r;
    }
  }
  throw new Error('Monto sin regla configurada');
}

function gastoLegal(p: bigint, r: CalculatorRateTier): bigint {
  return r.gastoPorcentaje !== undefined
    ? dividirRedondeando(
        p * enteroDecimal(r.gastoPorcentaje, 6, 'Porcentaje de gastos'),
        BigInt(100000000)
      )
    : enteroDecimal(r.gasto, 2, 'Gasto legal');
}

export function suggestLoanConditions(
  moneda: CalculatorCurrency | string,
  monto: number | string,
  config: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG
): CalculatorSuggestionResult {
  exigir(moneda === 'DOP' || moneda === 'USD', 'Seleccione moneda');
  const p = enteroDecimal(monto, 2, 'Monto');
  exigir(p >= BigInt(100), 'Monto mínimo: 1 en la moneda seleccionada');
  importe(p);
  const r = regla(moneda, p, config);
  return { tasa: r.tasa, gastosLegales: importe(gastoLegal(p, r)) };
}

export function calculateLoanSimulation(
  datos: CalculatorInput,
  config: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG
): CalculatorSimulationResult {
  exigir(datos && typeof datos === 'object', 'Datos del préstamo requeridos');
  exigir(datos.moneda === 'DOP' || datos.moneda === 'USD', 'Seleccione moneda');

  const p = enteroDecimal(datos.monto, 2, 'Monto');
  exigir(p >= BigInt(100), 'Monto mínimo: 1 en la moneda seleccionada');
  importe(p);

  const freqKey = datos.frecuencia as CalculatorFrequencyKey;
  const f = config.frecuencias[freqKey];
  exigir(Boolean(f), 'Seleccione frecuencia');
  exigir(Number.isSafeInteger(f.divisor) && f.divisor > 0, 'Conversión de frecuencia inválida');

  exigir(
    typeof datos.plazo === 'number' && Number.isSafeInteger(datos.plazo) && datos.plazo > 0,
    'El plazo debe ser un número entero de cuotas mayor que cero'
  );
  exigir(datos.plazo <= config.maxCuotas, 'Plazo superior al máximo parametrizado');

  exigir(datos.tipo === 'Fija' || datos.tipo === 'Insoluta', 'Seleccione tipo de interés');

  const modalidadPago = (datos.modalidadPago || 'Normal') as CalculatorPaymentMode;
  exigir(
    modalidadPago === 'Normal' || modalidadPago === 'SoloInteresesInicial',
    'Seleccione modalidad de pago'
  );
  const cuotasSoloInteres =
    modalidadPago === 'SoloInteresesInicial' ? Number(datos.cuotasSoloInteres || 0) : 0;
  exigir(
    Number.isSafeInteger(cuotasSoloInteres) && cuotasSoloInteres >= 0,
    'Las cuotas de solo intereses deben ser un número entero no negativo'
  );
  exigir(
    cuotasSoloInteres < datos.plazo,
    'Las cuotas de solo intereses deben ser menores que el plazo total'
  );
  const cuotasAmortizacion = datos.plazo - cuotasSoloInteres;

  exigir(
    datos.gastos === 'Descontar' || datos.gastos === 'Financiar',
    'Seleccione tratamiento de gastos'
  );
  exigir(
    typeof datos.usarSugerida === 'boolean',
    'Indique si desea utilizar la tasa sugerida'
  );

  const fecha = fechaISO(datos.fecha);
  const r = regla(datos.moneda, p, config);
  const tasa = enteroDecimal(datos.usarSugerida ? r.tasa : datos.tasaPersonalizada, 6, 'Tasa');
  const divisor = BigInt(100000000) * BigInt(f.divisor);
  const gasto = gastoLegal(p, r);
  const financiado = p + (datos.gastos === 'Financiar' ? gasto : BigInt(0));
  const neto = p - (datos.gastos === 'Descontar' ? gasto : BigInt(0));

  exigir(neto > BigInt(0), 'Los gastos descontados deben ser inferiores al monto solicitado');
  importe(financiado);

  const cambio =
    datos.moneda === 'USD' ? enteroDecimal(datos.tasaCambio, 6, 'Tasa de cambio') : null;
  if (cambio !== null) {
    exigir(cambio > BigInt(0), 'La tasa de cambio debe ser mayor que cero');
  }

  let balance = financiado;
  let interesTotal = BigInt(0);
  const cuotas: CalculatorInstallmentRow[] = [];
  const n = datos.plazo;
  const capitalFijo = financiado / BigInt(cuotasAmortizacion);
  const interesFijo = dividirRedondeando(financiado * tasa, divisor);
  let nivelada: bigint | null = null;

  if (datos.tipo === 'Insoluta' && tasa > BigInt(0)) {
    const periodica = Number(tasa) / Number(divisor);
    const calculo =
      (Number(financiado) * periodica) /
      -Math.expm1(-cuotasAmortizacion * Math.log1p(periodica));
    exigir(Number.isFinite(calculo) && calculo <= Number.MAX_SAFE_INTEGER, 'Cuota fuera de rango');
    nivelada = BigInt(Math.round(calculo));
  }

  for (let k = 1; k <= n; k++) {
    const soloInteres = k <= cuotasSoloInteres;
    const interes =
      datos.tipo === 'Fija' ? interesFijo : dividirRedondeando(balance * tasa, divisor);
    let capital = BigInt(0);
    if (!soloInteres) {
      capital =
        datos.tipo === 'Fija' || tasa === BigInt(0)
          ? capitalFijo
          : (nivelada as bigint) - interes;
      exigir(
        capital >= BigInt(0),
        'La precisión monetaria produce una cuota insuficiente para cubrir el interés'
      );
      if (k === n || capital > balance) {
        capital = balance;
      }
    }
    balance -= capital;
    interesTotal += interes;
    cuotas.push({
      numero: k,
      fecha: vencimiento(fecha, k, f),
      etapa: soloInteres ? 'Solo intereses' : 'Amortización',
      capital: importe(capital),
      interes: importe(interes),
      cuota: importe(capital + interes),
      balance: importe(balance),
    });
  }

  exigir(balance === BigInt(0), 'El plan no liquida el capital');

  const total = financiado + interesTotal;
  const salida: CalculatorSimulationResult = {
    moneda: datos.moneda,
    montoSolicitado: importe(p),
    frecuencia: freqKey,
    plazo: n,
    unidadPlazo: f.unidad,
    numeroCuotas: n,
    fechaDesembolso: datos.fecha,
    tasaSugerida: r.tasa,
    tasaAplicada: Number(tasa) / 1000000,
    tasaBase: 'Mensual',
    tasaPeriodicaPorcentaje: Number(tasa) / 1000000 / f.divisor,
    origenTasa: datos.usarSugerida ? 'Automática' : 'Personalizada',
    tipo: datos.tipo,
    modalidadPago,
    cuotasSoloInteres,
    cuotasAmortizacion,
    esquema:
      datos.tipo === 'Fija'
        ? 'Capital e interés fijos; ajuste final de centavos'
        : 'Cuota nivelada con interés sobre balance; ajuste final de centavos',
    gastosLegales: importe(gasto),
    modalidadGastos: datos.gastos,
    montoFinanciado: importe(financiado),
    montoNetoRecibir: importe(neto),
    cuotaInicial: cuotas[0].cuota,
    cuotaFinal: cuotas[n - 1].cuota,
    cuotasIguales: cuotas.every((c) => c.cuota === cuotas[0].cuota),
    totalCapital: importe(financiado),
    totalIntereses: importe(interesTotal),
    totalGastosLegales: importe(gasto),
    totalAPagar: importe(total),
    costoTotalIncluyendoGastos: importe(
      total + (datos.gastos === 'Descontar' ? gasto : BigInt(0))
    ),
    cuotas,
  };

  if (cambio !== null) {
    salida.tasaCambio = Number(cambio) / 1000000;
    const dopSummary: Record<string, number> = {};
    const summaryKeys: (keyof CalculatorDopSummary)[] = [
      'montoSolicitado',
      'gastosLegales',
      'montoFinanciado',
      'montoNetoRecibir',
      'cuotaInicial',
      'cuotaFinal',
      'totalCapital',
      'totalIntereses',
      'totalGastosLegales',
      'totalAPagar',
      'costoTotalIncluyendoGastos',
    ];
    for (const campo of summaryKeys) {
      const val = salida[campo] as number;
      dopSummary[campo] = importe(
        dividirRedondeando(enteroDecimal(val.toFixed(2), 2, campo) * cambio, BigInt(1000000))
      );
    }
    salida.equivalenteDOP = dopSummary as unknown as CalculatorDopSummary;

    salida.cuotasDOP = cuotas.map((c) => {
      const row: CalculatorDopInstallmentRow = {
        numero: c.numero,
        fecha: c.fecha,
        etapa: c.etapa,
        capital: importe(
          dividirRedondeando(
            enteroDecimal(c.capital.toFixed(2), 2, 'capital') * cambio,
            BigInt(1000000)
          )
        ),
        interes: importe(
          dividirRedondeando(
            enteroDecimal(c.interes.toFixed(2), 2, 'interes') * cambio,
            BigInt(1000000)
          )
        ),
        cuota: importe(
          dividirRedondeando(
            enteroDecimal(c.cuota.toFixed(2), 2, 'cuota') * cambio,
            BigInt(1000000)
          )
        ),
        balance: importe(
          dividirRedondeando(
            enteroDecimal(c.balance.toFixed(2), 2, 'balance') * cambio,
            BigInt(1000000)
          )
        ),
      };
      return row;
    });
  }

  return salida;
}

export function compareLoanSimulations(
  datos: CalculatorInput,
  config: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG
): CalculatorComparisonResult {
  return {
    fija: calculateLoanSimulation({ ...datos, tipo: 'Fija' }, config),
    insoluta: calculateLoanSimulation({ ...datos, tipo: 'Insoluta' }, config),
  };
}

export function calculateLoanWithParameters(
  datos: CalculatorInput,
  filas: CalculatorParameterRow[]
): CalculatorSimulationResult {
  exigir(Array.isArray(filas), 'PARAMETROS no disponible');
  const registros = filas.filter(
    (f) =>
      f.ID_PARAMETRO === 'CALCULADORA_CONFIG_V1' &&
      (f.ACTIVO === true || /^(true|sí|si|yes|y|1|on)$/i.test(String(f.ACTIVO)))
  );
  exigir(registros.length === 1, 'Debe existir una única configuración activa de calculadora');
  return calculateLoanSimulation(datos, JSON.parse(registros[0].VALOR_TEXTO) as CalculatorConfig);
}

/** Extrae la tasa de VENTA desde la página pública oficial del BCRD. */
export function extractBcrdExchangeRate(html: string): BcrdExchangeRateResult {
  if (typeof html !== 'string' || !html) {
    throw new Error('Respuesta vacía del BCRD.');
  }

  const texto = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const pos = texto.toLowerCase().indexOf('tipo de cambio');
  if (pos < 0) {
    throw new Error('No se encontró el bloque de tipo de cambio del BCRD.');
  }

  const bloque = texto.slice(pos, pos + 1500);
  const venta = bloque.match(/\bVenta\s*(?:RD\$?\s*)?([0-9]{1,3}(?:[.,][0-9]{2,6})?)/i);
  if (!venta) {
    throw new Error('No se encontró la tasa de venta del BCRD.');
  }

  const valor = Number(venta[1].replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0 || valor > 500) {
    throw new Error('Tasa de venta BCRD fuera de rango.');
  }

  const fecha = bloque.match(/(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+(?:de\s+)?\d{4})/i);

  return {
    venta: valor,
    fecha: fecha ? fecha[1] : 'Última publicada',
    fuente: 'Banco Central de la República Dominicana (BCRD)',
  };
}

export function getSantoDomingoTodayIso(referenceDate: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(referenceDate);
  const getPart = (type: string) => parts.find((x) => x.type === type)?.value || '01';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

export function createAxyCalculatorEngine() {
  return {
    configuracion: DEFAULT_CALCULATOR_CONFIG,
    sugerir: suggestLoanConditions,
    calcular: calculateLoanSimulation,
    comparar: compareLoanSimulations,
    calcularConParametros: calculateLoanWithParameters,
  };
}

// ============================================================================
// Integración con Política y Parámetros del Motor de Decisiones Crediticias V2
// ============================================================================

export function mapPaymentFrequencyToCalculator(freq: PaymentFrequency): CalculatorFrequencyKey {
  if (freq === 'QUINCENAL') return 'Quincenal';
  if (freq === 'SEMANAL') return 'Semanal';
  return 'Mensual';
}

export function mapCalculatorToPaymentFrequency(
  freq: CalculatorFrequencyKey
): PaymentFrequency | null {
  if (freq === 'Mensual') return 'MENSUAL';
  if (freq === 'Quincenal') return 'QUINCENAL';
  if (freq === 'Semanal') return 'SEMANAL';
  return null;
}

export function mapAmortizationMethodToCalculator(
  method: AmortizationMethod
): CalculatorInterestType {
  return method === 'INTERES_FIJO' ? 'Fija' : 'Insoluta';
}

export function mapCalculatorToAmortizationMethod(
  tipo: CalculatorInterestType
): AmortizationMethod {
  return tipo === 'Fija' ? 'INTERES_FIJO' : 'SALDO_INSOLUTO';
}

export interface MotorV2CalculatorConfigResult {
  config: CalculatorConfig;
  product: ProductLimitConfig;
  appliedMonthlyRatePct: number;
  rateSourceLabel: string;
  effectiveExchangeRate: number;
  bandCap: number | null;
  bandMaxTermMonths: number | null;
  minAmount: number;
  maxAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
}

export function buildMotorV2CalculatorConfig(params: {
  policy: CreditPolicyRecord | typeof DEFAULT_POLICY_V2;
  productCode: ProductCode;
  riskBandCode?: RiskBandCode | 'REFERENCIA';
  overrideExchangeRate?: number | null;
}): MotorV2CalculatorConfigResult {
  const { policy, productCode, riskBandCode = 'REFERENCIA', overrideExchangeRate } = params;
  const product = policy.products[productCode];
  if (!product) {
    throw new Error(`Producto ${productCode} no configurado en la política Motor V2.`);
  }

  const matchedBand =
    riskBandCode !== 'REFERENCIA'
      ? policy.riskBands.find((b) => b.code === riskBandCode)
      : undefined;

  const useBandRate = matchedBand && matchedBand.monthlyRate !== null;
  const rawRateDecimal = useBandRate
    ? (matchedBand.monthlyRate as number)
    : policy.capacityConfig.referenceSimulationMonthlyRate;

  const appliedMonthlyRatePct = Number((rawRateDecimal * 100).toFixed(6));
  const rateSourceLabel = useBandRate
    ? `Banda ${matchedBand.label} (${matchedBand.minScore}–${matchedBand.maxScore} pts · Motor V2 v${policy.version})`
    : `Tasa de referencia capacidad (Motor V2 v${policy.version})`;

  const effectiveExchangeRate: number =
    overrideExchangeRate && Number.isFinite(overrideExchangeRate) && overrideExchangeRate > 0
      ? Number(overrideExchangeRate.toFixed(6))
      : policy.exchangeRateConfig.dopPerUsd && policy.exchangeRateConfig.dopPerUsd > 0
      ? policy.exchangeRateConfig.dopPerUsd
      : 60.0;

  const config: CalculatorConfig = {
    DOP: DEFAULT_CALCULATOR_CONFIG.DOP.map((tier) => ({
      ...tier,
      tasa: appliedMonthlyRatePct,
    })),
    USD: DEFAULT_CALCULATOR_CONFIG.USD.map((tier) => ({
      ...tier,
      tasa: appliedMonthlyRatePct,
    })),
    frecuencias: { ...DEFAULT_CALCULATOR_CONFIG.frecuencias },
    maxCuotas: DEFAULT_CALCULATOR_CONFIG.maxCuotas,
    tasaCambioPredeterminada: effectiveExchangeRate,
    tasaCambioFuente: policy.exchangeRateConfig.source,
    tasaCambioFecha: policy.exchangeRateConfig.rateDate,
    tasaCambioAutomatica: true,
    tasaCambioRespaldo: false,
  };

  return {
    config,
    product,
    appliedMonthlyRatePct,
    rateSourceLabel,
    effectiveExchangeRate,
    bandCap:
      riskBandCode !== 'REFERENCIA' ? (product.bandCaps[riskBandCode] ?? null) : null,
    bandMaxTermMonths:
      matchedBand && matchedBand.maxTermMonths > 0 ? matchedBand.maxTermMonths : null,
    minAmount: product.minAmount,
    maxAmount: product.maxAmount,
    minTermMonths: product.minTermMonths,
    maxTermMonths: product.maxTermMonths,
  };
}

export interface MotorV2ComplianceCheck {
  key: 'amount' | 'band_cap' | 'term' | 'capacity' | 'frequency' | 'method' | 'fx_stress';
  label: string;
  passed: boolean;
  detail: string;
}

export interface OriginationMotorV2SimulationOutput {
  scoring: Omit<ScoringExecutionRecord, 'executedAt'>;
  motorConfig: MotorV2CalculatorConfigResult;
  comparison: CalculatorComparisonResult | null;
  selectedSimulation: CalculatorSimulationResult | null;
  calculatorError: string | null;
  installmentCount: number;
  monthlyEquivalentInstallment: number;
  projectedDtiWithSimulation: number;
  complianceChecks: MotorV2ComplianceCheck[];
}

export function simulateOriginationWithMotorV2(params: {
  application: EngineEvaluationInput['application'];
  customer: EngineEvaluationInput['customer'];
  policy: CreditPolicyRecord | typeof DEFAULT_POLICY_V2;
  interestType?: CalculatorInterestType;
  frequencyOverride?: CalculatorFrequencyKey;
  modalidadPago?: CalculatorPaymentMode;
  cuotasSoloInteres?: number;
  gastos?: CalculatorExpensesMode;
  usarTasaMotorV2?: boolean;
  tasaPersonalizada?: number | string;
  fechaDesembolso?: string;
  overrideExchangeRate?: number | null;
  executedBy?: string;
}): OriginationMotorV2SimulationOutput {
  const {
    application,
    customer,
    policy,
    interestType,
    frequencyOverride,
    modalidadPago = 'Normal',
    cuotasSoloInteres = 0,
    gastos = 'Descontar',
    usarTasaMotorV2 = true,
    tasaPersonalizada,
    fechaDesembolso = getSantoDomingoTodayIso(),
    overrideExchangeRate,
    executedBy = 'origination_simulator',
  } = params;

  const scoring = evaluateCreditDecisionV2({
    application,
    customer,
    policy,
    useVerifiedData: false,
    executionTrigger: 'INITIAL_SUBMIT',
    executedBy,
    executedByName: 'Simulador Integrado de Originación',
  });

  const evaluatedBandForRate: RiskBandCode | 'REFERENCIA' =
    scoring.riskBand.monthlyRate !== null ? scoring.riskBand.code : 'REFERENCIA';

  const motorConfig = buildMotorV2CalculatorConfig({
    policy,
    productCode: application.productCode,
    riskBandCode: evaluatedBandForRate,
    overrideExchangeRate,
  });

  const calcFreq =
    frequencyOverride ?? mapPaymentFrequencyToCalculator(application.paymentFrequency);
  const calcTipo =
    interestType ?? mapAmortizationMethodToCalculator(application.amortizationMethod);
  const freqMeta = DEFAULT_CALCULATOR_CONFIG.frecuencias[calcFreq];

  const termMonths = Math.max(1, Math.round(Number(application.requestedTermMonths) || 1));
  const rawInstallments = termMonths * freqMeta.divisor;
  const installmentCount = Math.min(
    DEFAULT_CALCULATOR_CONFIG.maxCuotas,
    Math.max(1, rawInstallments)
  );

  let comparison: CalculatorComparisonResult | null = null;
  let selectedSimulation: CalculatorSimulationResult | null = null;
  let calculatorError: string | null = null;

  try {
    comparison = compareLoanSimulations(
      {
        moneda: application.currency,
        monto: Number(application.requestedAmount),
        frecuencia: calcFreq,
        plazo: installmentCount,
        fecha: fechaDesembolso,
        usarSugerida: usarTasaMotorV2,
        tasaPersonalizada: usarTasaMotorV2 ? undefined : tasaPersonalizada,
        tipo: calcTipo,
        modalidadPago,
        cuotasSoloInteres: modalidadPago === 'SoloInteresesInicial' ? cuotasSoloInteres : 0,
        gastos,
        tasaCambio:
          application.currency === 'USD' ? motorConfig.effectiveExchangeRate : undefined,
      },
      motorConfig.config
    );
    selectedSimulation = calcTipo === 'Insoluta' ? comparison.insoluta : comparison.fija;
  } catch (err) {
    calculatorError =
      err instanceof Error ? err.message : 'Verifique los datos ingresados para simular.';
  }

  const product = motorConfig.product;
  const reqAmount = Number(application.requestedAmount) || 0;
  const reqTerm = Number(application.requestedTermMonths) || 0;
  const bandCap = product.bandCaps[scoring.riskBand.code] ?? 0;
  const maxTermEffective =
    scoring.riskBand.maxTermMonths > 0
      ? Math.min(product.maxTermMonths, scoring.riskBand.maxTermMonths)
      : product.maxTermMonths;

  const monthlyEquivalentInstallment = selectedSimulation
    ? Number((selectedSimulation.cuotaInicial * freqMeta.divisor).toFixed(2))
    : 0;

  const eligibleIncome = scoring.capacityResult.eligibleIncome;
  const currentDebt = scoring.capacityResult.currentDebtPayments;
  const projectedDtiWithSimulation =
    eligibleIncome > 0 ? (currentDebt + monthlyEquivalentInstallment) / eligibleIncome : 1;

  const mappedPaymentFreq = mapCalculatorToPaymentFrequency(calcFreq);
  const mappedMethod = mapCalculatorToAmortizationMethod(calcTipo);

  const complianceChecks: MotorV2ComplianceCheck[] = [
    {
      key: 'amount',
      label: 'Límite del producto',
      passed: reqAmount >= product.minAmount && reqAmount <= product.maxAmount,
      detail: `Rango permitido: ${product.minAmount.toLocaleString('en-US')} – ${product.maxAmount.toLocaleString('en-US')} ${product.currency}`,
    },
    {
      key: 'band_cap',
      label: `Tope Banda ${scoring.riskBand.label}`,
      passed: bandCap > 0 && reqAmount <= bandCap,
      detail:
        bandCap > 0
          ? `Tope por score (${scoring.totalScore}/100): ${bandCap.toLocaleString('en-US')} ${product.currency}`
          : 'Banda Crítica sin cupo automático',
    },
    {
      key: 'term',
      label: 'Plazo permitido',
      passed: reqTerm >= product.minTermMonths && reqTerm <= maxTermEffective,
      detail: `Permitido para ${scoring.riskBand.label}: ${product.minTermMonths}–${maxTermEffective} meses`,
    },
    {
      key: 'capacity',
      label: 'Capacidad de pago y DTI',
      passed:
        scoring.capacityResult.maxInstallmentAllowed > 0 &&
        monthlyEquivalentInstallment > 0 &&
        monthlyEquivalentInstallment <= scoring.capacityResult.maxInstallmentAllowed &&
        projectedDtiWithSimulation <= policy.capacityConfig.maxProjectedDti,
      detail:
        scoring.capacityResult.maxInstallmentAllowed > 0
          ? `Cuota máx. política: ${scoring.capacityResult.maxInstallmentAllowed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${product.currency}/mes · DTI máx. ${(policy.capacityConfig.maxProjectedDti * 100).toFixed(0)}%`
          : 'Complete ingreso principal y gastos en Paso 2 para validar capacidad',
    },
    {
      key: 'frequency',
      label: 'Frecuencia autorizada',
      passed:
        mappedPaymentFreq !== null && product.allowedFrequencies.includes(mappedPaymentFreq),
      detail: `Política admite: ${product.allowedFrequencies.join(', ')}`,
    },
    {
      key: 'method',
      label: 'Esquema autorizado',
      passed: product.allowedAmortizationMethods.includes(mappedMethod),
      detail: `Política admite: ${product.allowedAmortizationMethods.join(', ')}`,
    },
  ];

  if (scoring.currencyStressResults?.applied) {
    const stressPassed = scoring.currencyStressResults.scenarios.every((s) => s.remainsSustainable);
    complianceChecks.push({
      key: 'fx_stress',
      label: 'Estrés cambiario USD/DOP',
      passed: stressPassed,
      detail: stressPassed
        ? 'Capacidad sostenible bajo depreciación +15% y +25%'
        : 'Capacidad USD cae bajo mínimo ante depreciación DOP (+15%/+25%)',
    });
  }

  return {
    scoring,
    motorConfig,
    comparison,
    selectedSimulation,
    calculatorError,
    installmentCount,
    monthlyEquivalentInstallment,
    projectedDtiWithSimulation,
    complianceChecks,
  };
}
