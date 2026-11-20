import type {
  AmortizationMethod,
  ApplicationDecisionHistoryRecord,
  ApplicationRecord,
  ApplicationStatus,
  CreditConditionsSnapshot,
  CreditPolicyRecord,
  CurrencyCode,
  CustomerRecord,
  DecisionQualificationStatus,
  DecisionRuleEvaluationItem,
  ExchangeRateAuditMetadata,
  FinancialAnalysisInstallmentPreviewRow,
  FinancialAnalysisInstallmentRecord,
  FinancialAnalysisRecord,
  FinancialAnalysisStatus,
  FinancialAnalysisType,
  InstallmentStageCode,
  LegalFeeApplicationMode,
  PaymentFrequency,
  RiskBandCode,
  ScoringExecutionRecord,
  UserRole,
} from '../types/axycore';
import {
  DEFAULT_POLICY_V2,
  evaluateCreditDecisionV2,
  type EngineEvaluationInput,
} from './decisionEngineV2';
import {
  calculateLoanSimulation,
  DEFAULT_CALCULATOR_CONFIG,
  getSantoDomingoTodayIso,
  mapAmortizationMethodToCalculator,
  mapPaymentFrequencyToCalculator,
  suggestLoanConditions,
  type CalculatorConfig,
  type CalculatorExpensesMode,
  type CalculatorSimulationResult,
} from './loanCalculatorEngine';

export const HUMAN_REEVALUATION_ALLOWED_ROLES: ReadonlySet<UserRole> = new Set([
  'ADMIN',
  'CREDIT_ANALYST',
  'RISK_OFFICER',
  'BUSINESS_OFFICER',
  'COMMITTEE_MEMBER',
  'MANAGEMENT',
]);

export const RATE_AND_FEE_OVERRIDE_ROLES: ReadonlySet<UserRole> = new Set([
  'ADMIN',
  'CREDIT_ANALYST',
  'RISK_OFFICER',
  'COMMITTEE_MEMBER',
  'MANAGEMENT',
]);

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  QUINCENAL: 'Quincenal',
  MENSUAL: 'Mensual',
};

export const AMORTIZATION_METHOD_LABELS: Record<AmortizationMethod, string> = {
  SALDO_INSOLUTO: 'Interés sobre Saldo Insoluto',
  INTERES_FIJO: 'Interés Fijo',
};

export const LEGAL_FEE_MODE_LABELS: Record<LegalFeeApplicationMode, string> = {
  DESCONTAR_DESEMBOLSO: 'Descontar del desembolso',
  FINANCIAR: 'Financiar junto al capital',
};

export function canUserAccessInternalFinancialTools(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return role !== 'EXTERNAL_CLIENT';
}

export function canUserExecuteHumanReevaluation(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return HUMAN_REEVALUATION_ALLOWED_ROLES.has(role);
}

export function canUserOverrideRateOrFees(role: UserRole | null | undefined): boolean {
  if (!role) return false;
  return RATE_AND_FEE_OVERRIDE_ROLES.has(role);
}

export function getFrequencyDivisor(freq: PaymentFrequency): number {
  switch (freq) {
    case 'DIARIA':
      return 30;
    case 'SEMANAL':
      return 4;
    case 'QUINCENAL':
      return 2;
    case 'MENSUAL':
    default:
      return 1;
  }
}

export function computeInstallmentCountFromMonths(
  termMonths: number,
  frequency: PaymentFrequency
): number {
  const safeMonths = Math.max(1, Math.round(Number(termMonths) || 1));
  return Math.min(
    DEFAULT_CALCULATOR_CONFIG.maxCuotas,
    Math.max(1, safeMonths * getFrequencyDivisor(frequency))
  );
}

export function computeEquivalentMonthsFromInstallments(
  installmentCount: number,
  frequency: PaymentFrequency
): number {
  const safeCount = Math.max(1, Math.round(Number(installmentCount) || 1));
  const divisor = getFrequencyDivisor(frequency);
  return Math.max(1, Math.round(safeCount / divisor));
}

export function mapLegalFeeModeToCalculator(
  mode: LegalFeeApplicationMode
): CalculatorExpensesMode {
  return mode === 'FINANCIAR' ? 'Financiar' : 'Descontar';
}

export function mapStageToCode(etapa: 'Solo intereses' | 'Amortización'): InstallmentStageCode {
  return etapa === 'Solo intereses' ? 'SOLO_INTERESES' : 'NORMAL';
}

function stableFingerprintHash(input: string): string {
  // Deterministic 32-bit FNV-1a hex hash (safe for browser & Node without node:crypto)
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeIdPart(raw: string, maxLen = 40): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(0, maxLen) || 'id';
}

export interface AlternativeConditionsOverrideInput {
  requestedAmount?: number;
  termMonths?: number;
  installmentCount?: number;
  paymentFrequency?: PaymentFrequency;
  amortizationMethod?: AmortizationMethod;
  useSuggestedRate?: boolean;
  customMonthlyRatePct?: number | null;
  legalFeeMode?: LegalFeeApplicationMode;
  customLegalFeesAmount?: number | null;
  interestOnlyPeriods?: number;
  disbursementDate?: string;
  manualExchangeRate?: number | null;
}

export interface IntegratedCreditEvaluationInput {
  application: EngineEvaluationInput['application'] & {
    status?: ApplicationStatus;
    originalRequestedConditions?: CreditConditionsSnapshot | null;
    decisionQualificationStatus?: DecisionQualificationStatus | null;
    legalFeeMode?: LegalFeeApplicationMode;
    interestOnlyPeriods?: number;
    installmentCount?: number;
  };
  customer: EngineEvaluationInput['customer'] & { organizationId?: string };
  policy: CreditPolicyRecord | typeof DEFAULT_POLICY_V2;
  calculatorConfig?: CalculatorConfig;
  analysisType: FinancialAnalysisType;
  version?: number;
  useVerifiedData?: boolean;
  alternativeConditions?: AlternativeConditionsOverrideInput | null;
  exchangeRateMeta?: ExchangeRateAuditMetadata | null;
  justification?: string | null;
  actor: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
  intent?: 'EVALUATE_ONLY' | 'SEND_TO_EVALUATION';
}

export interface IntegratedCreditEvaluationResult {
  scoring: Omit<ScoringExecutionRecord, 'executedAt'>;
  analysis: Omit<FinancialAnalysisRecord, 'calculatedAt' | 'updatedAt'>;
  installments: Array<Omit<FinancialAnalysisInstallmentRecord, 'createdAt'>>;
  decisionHistory: Omit<ApplicationDecisionHistoryRecord, 'createdAt'>;
  simulation: CalculatorSimulationResult | null;
  calculatorError: string | null;
  recommendedTargetStatus: ApplicationStatus;
  decisionQualificationStatus: DecisionQualificationStatus;
  requiresHumanIntervention: boolean;
  canAutoAdvanceToEvaluation: boolean;
  canSendToEvaluation: boolean;
  sendToEvaluationBlockedReasons: string[];
}

export function buildOriginalRequestedConditions(
  application: IntegratedCreditEvaluationInput['application'],
  calculatorConfig: CalculatorConfig = DEFAULT_CALCULATOR_CONFIG,
  disbursementDate: string = getSantoDomingoTodayIso()
): CreditConditionsSnapshot {
  if (application.originalRequestedConditions) {
    return { ...application.originalRequestedConditions };
  }

  const currency: CurrencyCode = application.currency === 'USD' ? 'USD' : 'DOP';
  const requestedAmount = Math.max(0, Number(application.requestedAmount) || 0);
  const paymentFrequency: PaymentFrequency =
    application.paymentFrequency === 'DIARIA' ||
    application.paymentFrequency === 'SEMANAL' ||
    application.paymentFrequency === 'QUINCENAL' ||
    application.paymentFrequency === 'MENSUAL'
      ? application.paymentFrequency
      : 'MENSUAL';
  const amortizationMethod: AmortizationMethod =
    application.amortizationMethod === 'INTERES_FIJO' ? 'INTERES_FIJO' : 'SALDO_INSOLUTO';
  const termMonths = Math.max(1, Math.round(Number(application.requestedTermMonths) || 1));
  const installmentCount =
    application.installmentCount && application.installmentCount > 0
      ? Math.round(application.installmentCount)
      : computeInstallmentCountFromMonths(termMonths, paymentFrequency);
  const legalFeeMode: LegalFeeApplicationMode =
    application.legalFeeMode === 'FINANCIAR' ? 'FINANCIAR' : 'DESCONTAR_DESEMBOLSO';
  const interestOnlyPeriods = Math.max(0, Math.round(Number(application.interestOnlyPeriods) || 0));

  let monthlyRatePct = 5;
  let legalFeesAmount = 0;
  if (requestedAmount >= 1) {
    try {
      const suggestion = suggestLoanConditions(currency, requestedAmount, calculatorConfig);
      monthlyRatePct = suggestion.tasa;
      legalFeesAmount = suggestion.gastosLegales;
    } catch {
      monthlyRatePct = 5;
      legalFeesAmount = 0;
    }
  }

  return {
    currency,
    requestedAmount,
    termMonths,
    installmentCount,
    paymentFrequency,
    amortizationMethod,
    monthlyRatePct,
    monthlyRateDecimal: Number((monthlyRatePct / 100).toFixed(6)),
    rateSource: 'AUTOMATICA_ESCALA',
    legalFeesAmount,
    legalFeeMode,
    interestOnlyPeriods,
    disbursementDate,
  };
}

export function buildFinancialAnalysisIdempotencyKey(params: {
  organizationId: string;
  applicationId: string;
  analysisType: FinancialAnalysisType;
  version: number;
  conditions: CreditConditionsSnapshot;
  exchangeRate?: number | null;
}): string {
  const payload = [
    params.organizationId,
    params.applicationId,
    params.analysisType,
    String(params.version),
    params.conditions.currency,
    params.conditions.requestedAmount.toFixed(2),
    String(params.conditions.installmentCount),
    params.conditions.paymentFrequency,
    params.conditions.amortizationMethod,
    params.conditions.monthlyRatePct.toFixed(4),
    params.conditions.legalFeesAmount.toFixed(2),
    params.conditions.legalFeeMode,
    String(params.conditions.interestOnlyPeriods),
    params.conditions.disbursementDate,
    params.exchangeRate ? params.exchangeRate.toFixed(4) : 'NOFX',
  ].join('|');

  const hash = stableFingerprintHash(payload);
  return `idem_${sanitizeIdPart(params.applicationId, 28)}_v${params.version}_${hash}`.slice(
    0,
    120
  );
}

export function buildConditionsDiff(
  original: CreditConditionsSnapshot,
  evaluated: CreditConditionsSnapshot
): Array<{ field: string; label: string; before: string; after: string }> {
  const diffs: Array<{ field: string; label: string; before: string; after: string }> = [];
  const prefix = original.currency === 'USD' ? 'US$' : 'RD$';
  const fmtAmt = (n: number) =>
    `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (Math.abs(original.requestedAmount - evaluated.requestedAmount) > 0.009) {
    diffs.push({
      field: 'requestedAmount',
      label: 'Monto',
      before: fmtAmt(original.requestedAmount),
      after: fmtAmt(evaluated.requestedAmount),
    });
  }
  if (original.installmentCount !== evaluated.installmentCount) {
    diffs.push({
      field: 'installmentCount',
      label: 'Cantidad de cuotas',
      before: `${original.installmentCount} cuotas`,
      after: `${evaluated.installmentCount} cuotas`,
    });
  }
  if (original.paymentFrequency !== evaluated.paymentFrequency) {
    diffs.push({
      field: 'paymentFrequency',
      label: 'Frecuencia de pago',
      before: PAYMENT_FREQUENCY_LABELS[original.paymentFrequency],
      after: PAYMENT_FREQUENCY_LABELS[evaluated.paymentFrequency],
    });
  }
  if (original.amortizationMethod !== evaluated.amortizationMethod) {
    diffs.push({
      field: 'amortizationMethod',
      label: 'Modalidad de interés',
      before: AMORTIZATION_METHOD_LABELS[original.amortizationMethod],
      after: AMORTIZATION_METHOD_LABELS[evaluated.amortizationMethod],
    });
  }
  if (Math.abs(original.monthlyRatePct - evaluated.monthlyRatePct) > 0.0001) {
    diffs.push({
      field: 'monthlyRatePct',
      label: 'Tasa mensual',
      before: `${original.monthlyRatePct.toFixed(2)}%`,
      after: `${evaluated.monthlyRatePct.toFixed(2)}%`,
    });
  }
  if (original.legalFeeMode !== evaluated.legalFeeMode) {
    diffs.push({
      field: 'legalFeeMode',
      label: 'Modalidad gastos legales',
      before: LEGAL_FEE_MODE_LABELS[original.legalFeeMode],
      after: LEGAL_FEE_MODE_LABELS[evaluated.legalFeeMode],
    });
  }
  if (Math.abs(original.legalFeesAmount - evaluated.legalFeesAmount) > 0.009) {
    diffs.push({
      field: 'legalFeesAmount',
      label: 'Gastos legales',
      before: fmtAmt(original.legalFeesAmount),
      after: fmtAmt(evaluated.legalFeesAmount),
    });
  }
  if (original.interestOnlyPeriods !== evaluated.interestOnlyPeriods) {
    diffs.push({
      field: 'interestOnlyPeriods',
      label: 'Cuotas solo intereses',
      before: String(original.interestOnlyPeriods),
      after: String(evaluated.interestOnlyPeriods),
    });
  }

  return diffs;
}

export function runIntegratedDecisionAndCalculation(
  input: IntegratedCreditEvaluationInput
): IntegratedCreditEvaluationResult {
  const {
    application,
    customer,
    policy,
    calculatorConfig = DEFAULT_CALCULATOR_CONFIG,
    analysisType,
    version = 1,
    useVerifiedData = false,
    alternativeConditions = null,
    exchangeRateMeta = null,
    justification = null,
    actor,
    intent = 'EVALUATE_ONLY',
  } = input;

  // Enforce multi-tenant isolation at engine level too
  if (
    customer.organizationId &&
    application.organizationId &&
    customer.organizationId !== application.organizationId
  ) {
    throw new Error(
      'Violación de aislamiento Multi-Tenant: solicitud y cliente pertenecen a organizaciones distintas.'
    );
  }

  // Enforce RBAC for human re-evaluation / adjustments
  if (
    (analysisType === 'REEVALUACION_HUMANA' || analysisType === 'AJUSTE_EVALUACION') &&
    !canUserExecuteHumanReevaluation(actor.role)
  ) {
    throw new Error(
      `Acceso denegado: el rol ${actor.role} no está autorizado para ejecutar reevaluación humana ni modificar condiciones financieras.`
    );
  }

  const todayIso = getSantoDomingoTodayIso();
  const originalRequestedConditions = buildOriginalRequestedConditions(
    application,
    calculatorConfig,
    todayIso
  );

  // Build target conditions (original for SOLICITUD_INICIAL, or overridden for REEVALUACION_HUMANA / AJUSTE_EVALUACION)
  const currency: CurrencyCode = application.currency === 'USD' ? 'USD' : 'DOP';
  const targetFrequency: PaymentFrequency =
    alternativeConditions?.paymentFrequency ?? originalRequestedConditions.paymentFrequency;
  const targetMethod: AmortizationMethod =
    alternativeConditions?.amortizationMethod ?? originalRequestedConditions.amortizationMethod;
  const targetAmount =
    alternativeConditions?.requestedAmount !== undefined
      ? Math.max(0, Number(alternativeConditions.requestedAmount) || 0)
      : originalRequestedConditions.requestedAmount;

  let targetInstallmentCount: number;
  let targetTermMonths: number;
  if (
    alternativeConditions?.installmentCount !== undefined &&
    alternativeConditions.installmentCount > 0
  ) {
    targetInstallmentCount = Math.round(alternativeConditions.installmentCount);
    targetTermMonths =
      alternativeConditions.termMonths && alternativeConditions.termMonths > 0
        ? Math.round(alternativeConditions.termMonths)
        : computeEquivalentMonthsFromInstallments(targetInstallmentCount, targetFrequency);
  } else if (
    alternativeConditions?.termMonths !== undefined &&
    alternativeConditions.termMonths > 0
  ) {
    targetTermMonths = Math.round(alternativeConditions.termMonths);
    targetInstallmentCount = computeInstallmentCountFromMonths(targetTermMonths, targetFrequency);
  } else {
    targetTermMonths = originalRequestedConditions.termMonths;
    targetInstallmentCount =
      alternativeConditions?.paymentFrequency &&
      alternativeConditions.paymentFrequency !== originalRequestedConditions.paymentFrequency
        ? computeInstallmentCountFromMonths(targetTermMonths, targetFrequency)
        : originalRequestedConditions.installmentCount;
  }

  const targetLegalFeeMode: LegalFeeApplicationMode =
    alternativeConditions?.legalFeeMode ?? originalRequestedConditions.legalFeeMode;
  const targetInterestOnlyPeriods = Math.max(
    0,
    Math.round(
      alternativeConditions?.interestOnlyPeriods ?? originalRequestedConditions.interestOnlyPeriods
    )
  );
  const targetDisbursementDate =
    alternativeConditions?.disbursementDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(alternativeConditions.disbursementDate)
      ? alternativeConditions.disbursementDate
      : originalRequestedConditions.disbursementDate;

  // Resolve rate & legal fees from configured scale (based on target requested amount, NOT financed principal)
  let suggestedRatePct = 5;
  let suggestedLegalFees = 0;
  if (targetAmount >= 1) {
    try {
      const sug = suggestLoanConditions(currency, targetAmount, calculatorConfig);
      suggestedRatePct = sug.tasa;
      suggestedLegalFees = sug.gastosLegales;
    } catch {
      suggestedRatePct = 5;
      suggestedLegalFees = 0;
    }
  }

  const wantsCustomRate =
    alternativeConditions?.useSuggestedRate === false &&
    alternativeConditions.customMonthlyRatePct !== undefined &&
    alternativeConditions.customMonthlyRatePct !== null;
  const wantsCustomLegalFees =
    alternativeConditions?.customLegalFeesAmount !== undefined &&
    alternativeConditions?.customLegalFeesAmount !== null;

  if ((wantsCustomRate || wantsCustomLegalFees) && !canUserOverrideRateOrFees(actor.role)) {
    throw new Error(
      `El rol ${actor.role} no tiene autorización para personalizar tasa o gastos legales fuera de la escala configurada.`
    );
  }

  const appliedRatePct = wantsCustomRate
    ? Math.max(0, Number(alternativeConditions!.customMonthlyRatePct))
    : suggestedRatePct;
  const appliedRateSource: CreditConditionsSnapshot['rateSource'] = wantsCustomRate
    ? 'PERSONALIZADA'
    : 'AUTOMATICA_ESCALA';

  const appliedLegalFees = wantsCustomLegalFees
    ? Math.max(0, Number(alternativeConditions!.customLegalFeesAmount))
    : suggestedLegalFees;

  const calculatedConditions: CreditConditionsSnapshot = {
    currency,
    requestedAmount: targetAmount,
    termMonths: targetTermMonths,
    installmentCount: targetInstallmentCount,
    paymentFrequency: targetFrequency,
    amortizationMethod: targetMethod,
    monthlyRatePct: appliedRatePct,
    monthlyRateDecimal: Number((appliedRatePct / 100).toFixed(6)),
    rateSource: appliedRateSource,
    legalFeesAmount: appliedLegalFees,
    legalFeeMode: targetLegalFeeMode,
    interestOnlyPeriods: targetInterestOnlyPeriods,
    disbursementDate: targetDisbursementDate,
  };

  // Resolve effective FX rate for USD (BCRD automatic, fallback, or authorized manual)
  let effectiveExchangeMeta: ExchangeRateAuditMetadata | null = null;
  let effectiveUsdRate: number | null = null;
  if (currency === 'USD') {
    if (
      alternativeConditions?.manualExchangeRate &&
      alternativeConditions.manualExchangeRate > 0 &&
      canUserOverrideRateOrFees(actor.role)
    ) {
      effectiveUsdRate = Number(alternativeConditions.manualExchangeRate);
      effectiveExchangeMeta = {
        applied: true,
        currencyPair: 'USD/DOP',
        sellRate: effectiveUsdRate,
        source: 'Ajuste manual autorizado',
        rateDate: todayIso,
        obtainedAtIso: new Date().toISOString(),
        isAutomaticBcrd: false,
        isFallback: false,
        fallbackReason: null,
        manualOverrideBy: actor.uid,
        manualOverrideByName: actor.displayName,
      };
    } else if (exchangeRateMeta && exchangeRateMeta.sellRate > 0) {
      effectiveUsdRate = exchangeRateMeta.sellRate;
      effectiveExchangeMeta = { ...exchangeRateMeta, applied: true };
    } else {
      const policyFx =
        policy.exchangeRateConfig.dopPerUsd && policy.exchangeRateConfig.dopPerUsd > 0
          ? policy.exchangeRateConfig.dopPerUsd
          : 60.0;
      effectiveUsdRate = policyFx;
      effectiveExchangeMeta = {
        applied: true,
        currencyPair: 'USD/DOP',
        sellRate: policyFx,
        source: policy.exchangeRateConfig.source || 'Respaldo de política institucional',
        rateDate: policy.exchangeRateConfig.rateDate || todayIso,
        obtainedAtIso: new Date().toISOString(),
        isAutomaticBcrd: false,
        isFallback: true,
        fallbackReason: 'Tasa oficial BCRD no disponible en tiempo real; aplicado respaldo parametrizado.',
        manualOverrideBy: null,
        manualOverrideByName: null,
      };
    }
  }

  // Run Decision Engine V2 using target conditions and effective FX rate
  const effectivePolicy: CreditPolicyRecord | typeof DEFAULT_POLICY_V2 =
    currency === 'USD' && effectiveUsdRate
      ? {
          ...policy,
          exchangeRateConfig: {
            ...policy.exchangeRateConfig,
            dopPerUsd: effectiveUsdRate,
            rateDate: effectiveExchangeMeta?.rateDate || policy.exchangeRateConfig.rateDate,
            source: effectiveExchangeMeta?.source || policy.exchangeRateConfig.source,
          },
        }
      : policy;

  const executionTrigger: EngineEvaluationInput['executionTrigger'] =
    analysisType === 'SOLICITUD_INICIAL'
      ? 'INITIAL_SUBMIT'
      : analysisType === 'AJUSTE_EVALUACION'
      ? 'ANALYST_RECALC'
      : 'MANUAL_RERUN';

  const scoring = evaluateCreditDecisionV2({
    application: {
      ...application,
      requestedAmount: calculatedConditions.requestedAmount,
      requestedTermMonths: calculatedConditions.termMonths,
      paymentFrequency: calculatedConditions.paymentFrequency,
      amortizationMethod: calculatedConditions.amortizationMethod,
    },
    customer,
    policy: effectivePolicy,
    useVerifiedData,
    executionTrigger,
    executedBy: actor.uid,
    executedByName: actor.displayName,
  });

  // Run Financial Calculation Engine (reusing loanCalculatorEngine.ts — zero duplicated math!)
  let simulation: CalculatorSimulationResult | null = null;
  let calculatorError: string | null = null;

  try {
    simulation = calculateLoanSimulation(
      {
        moneda: calculatedConditions.currency,
        monto: calculatedConditions.requestedAmount,
        frecuencia: mapPaymentFrequencyToCalculator(calculatedConditions.paymentFrequency),
        plazo: calculatedConditions.installmentCount,
        fecha: calculatedConditions.disbursementDate,
        usarSugerida: !wantsCustomRate,
        tasaPersonalizada: wantsCustomRate ? calculatedConditions.monthlyRatePct : undefined,
        tipo: mapAmortizationMethodToCalculator(calculatedConditions.amortizationMethod),
        modalidadPago:
          calculatedConditions.interestOnlyPeriods > 0 ? 'SoloInteresesInicial' : 'Normal',
        cuotasSoloInteres: calculatedConditions.interestOnlyPeriods,
        gastos: mapLegalFeeModeToCalculator(calculatedConditions.legalFeeMode),
        gastoLegalPersonalizado: wantsCustomLegalFees
          ? calculatedConditions.legalFeesAmount
          : undefined,
        tasaCambio: currency === 'USD' ? effectiveUsdRate : undefined,
      },
      calculatorConfig
    );
  } catch (err) {
    calculatorError =
      err instanceof Error ? err.message : 'Error en el Motor de Cálculo Financiero.';
  }

  // Evaluate structured policy rules (explicit rulesPassed & rulesFailed)
  const product = effectivePolicy.products[application.productCode];
  const rules: DecisionRuleEvaluationItem[] = [];
  const freqDivisor = getFrequencyDivisor(calculatedConditions.paymentFrequency);

  const dataIncomplete =
    scoring.missingData.length > 0 ||
    scoring.status === 'DATOS_INSUFICIENTES' ||
    scoring.status === 'DATOS_INSUFICIENTES_DEUDA' ||
    scoring.status === 'DATOS_INSUFICIENTES_CAMBIO';

  rules.push({
    code: 'DATA_COMPLETENESS',
    label: 'Completitud de datos financieros y deudas',
    passed: !dataIncomplete,
    severity: 'BLOCKING',
    detail: dataIncomplete
      ? `Faltan datos obligatorios: ${scoring.missingData.join('; ') || scoring.status}`
      : 'Ingresos, gastos, declaración de deudas y moneda completos.',
  });

  if (product) {
    const currencyMatches = product.currency === calculatedConditions.currency;
    rules.push({
      code: 'PRODUCT_CURRENCY_MATCH',
      label: 'Coincidencia moneda y producto',
      passed: currencyMatches,
      severity: 'BLOCKING',
      detail: currencyMatches
        ? `Moneda ${calculatedConditions.currency} coincide con ${product.label}.`
        : `La moneda ${calculatedConditions.currency} no coincide con el producto (${product.currency}).`,
    });

    const amountInProductRange =
      calculatedConditions.requestedAmount >= product.minAmount &&
      calculatedConditions.requestedAmount <= product.maxAmount;
    rules.push({
      code: 'AMOUNT_LIMITS',
      label: 'Monto dentro de límites del producto',
      passed: amountInProductRange,
      severity: 'BLOCKING',
      detail: amountInProductRange
        ? `Monto ${calculatedConditions.requestedAmount.toLocaleString('en-US')} ${currency} dentro del rango permitido (${product.minAmount.toLocaleString('en-US')} – ${product.maxAmount.toLocaleString('en-US')}).`
        : `Monto ${calculatedConditions.requestedAmount.toLocaleString('en-US')} ${currency} fuera del rango del producto (${product.minAmount.toLocaleString('en-US')} – ${product.maxAmount.toLocaleString('en-US')}).`,
    });

    const bandEligible =
      scoring.riskBand.code !== 'CRITICO' &&
      scoring.riskBand.monthlyRate !== null &&
      scoring.status !== 'SIN_OFERTA';
    rules.push({
      code: 'RISK_BAND_ELIGIBILITY',
      label: 'Score crediticio y banda de riesgo elegible',
      passed: bandEligible,
      severity: 'BLOCKING',
      detail: bandEligible
        ? `Score ${scoring.totalScore}/100 en banda ${scoring.riskBand.label} elegible para crédito.`
        : `Score ${scoring.totalScore}/100 en banda ${scoring.riskBand.label} no elegible automáticamente.`,
    });

    const bandCap = product.bandCaps[scoring.riskBand.code as RiskBandCode] ?? 0;
    const withinBandCap = bandCap > 0 && calculatedConditions.requestedAmount <= bandCap;
    rules.push({
      code: 'BAND_AMOUNT_CAP',
      label: `Tope de monto para banda ${scoring.riskBand.label}`,
      passed: withinBandCap,
      severity: 'BLOCKING',
      detail: withinBandCap
        ? `Monto dentro del tope autorizado por banda (${bandCap.toLocaleString('en-US')} ${currency}).`
        : bandCap > 0
        ? `El monto (${calculatedConditions.requestedAmount.toLocaleString('en-US')} ${currency}) excede el tope de la banda ${scoring.riskBand.label} (${bandCap.toLocaleString('en-US')} ${currency}).`
        : `La banda ${scoring.riskBand.label} no dispone de cupo automático.`,
    });

    const maxTermEffective =
      scoring.riskBand.maxTermMonths > 0
        ? Math.min(product.maxTermMonths, scoring.riskBand.maxTermMonths)
        : product.maxTermMonths;
    const termInPolicy =
      calculatedConditions.termMonths >= product.minTermMonths &&
      calculatedConditions.termMonths <= maxTermEffective;
    rules.push({
      code: 'TERM_LIMITS',
      label: 'Plazo dentro de límites de política y banda',
      passed: termInPolicy,
      severity: 'BLOCKING',
      detail: termInPolicy
        ? `Plazo equivalente de ${calculatedConditions.termMonths} meses (${calculatedConditions.installmentCount} cuotas) dentro de ${product.minTermMonths}–${maxTermEffective} meses.`
        : `Plazo equivalente (${calculatedConditions.termMonths} meses / ${calculatedConditions.installmentCount} cuotas) fuera del rango permitido (${product.minTermMonths}–${maxTermEffective} meses).`,
    });

    // Monthly-equivalent installment check using the highest scheduled installment (handles Solo Intereses Inicial properly!)
    const maxScheduledInstallment = simulation
      ? Math.max(...simulation.cuotas.map((c) => c.cuota))
      : 0;
    const monthlyEquivalentInstallment = Number((maxScheduledInstallment * freqDivisor).toFixed(2));
    const eligibleIncome = scoring.capacityResult.eligibleIncome;
    const currentDebt = scoring.capacityResult.currentDebtPayments;
    const projectedDti =
      eligibleIncome > 0 ? (currentDebt + monthlyEquivalentInstallment) / eligibleIncome : 1;
    const maxInstAllowed = scoring.capacityResult.maxInstallmentAllowed;
    const capacityOk =
      !dataIncomplete &&
      maxInstAllowed > 0 &&
      monthlyEquivalentInstallment > 0 &&
      monthlyEquivalentInstallment <= maxInstAllowed + 0.01 &&
      projectedDti <= effectivePolicy.capacityConfig.maxProjectedDti + 0.0001;

    rules.push({
      code: 'PAYMENT_CAPACITY_AND_DTI',
      label: 'Capacidad de pago, cobertura y DTI proyectado',
      passed: capacityOk,
      severity: 'BLOCKING',
      detail: capacityOk
        ? `Cuota mensual equiv. ${monthlyEquivalentInstallment.toLocaleString('en-US', { minimumFractionDigits: 2 })} ≤ máx. ${maxInstAllowed.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency} · DTI proyectado ${(projectedDti * 100).toFixed(2)}% ≤ ${(effectivePolicy.capacityConfig.maxProjectedDti * 100).toFixed(0)}%.`
        : `Capacidad insuficiente: cuota mensual equiv. ${monthlyEquivalentInstallment.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency} vs máx. permitido ${maxInstAllowed.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency} (DTI proyectado ${(projectedDti * 100).toFixed(2)}%, máx. ${(effectivePolicy.capacityConfig.maxProjectedDti * 100).toFixed(0)}%).`,
    });

    const freqAllowed = product.allowedFrequencies.includes(calculatedConditions.paymentFrequency);
    rules.push({
      code: 'FREQUENCY_ALLOWED',
      label: 'Frecuencia de pago permitida por política',
      passed: freqAllowed,
      severity: 'BLOCKING',
      detail: freqAllowed
        ? `Frecuencia ${PAYMENT_FREQUENCY_LABELS[calculatedConditions.paymentFrequency]} permitida por política.`
        : `Frecuencia ${PAYMENT_FREQUENCY_LABELS[calculatedConditions.paymentFrequency]} no habilitada en política vigente (permitidas: ${product.allowedFrequencies.join(', ')}).`,
    });

    const methodAllowed = product.allowedAmortizationMethods.includes(
      calculatedConditions.amortizationMethod
    );
    rules.push({
      code: 'AMORTIZATION_METHOD_ALLOWED',
      label: 'Modalidad de interés permitida por política',
      passed: methodAllowed,
      severity: 'BLOCKING',
      detail: methodAllowed
        ? `Modalidad ${AMORTIZATION_METHOD_LABELS[calculatedConditions.amortizationMethod]} permitida por política.`
        : `Modalidad ${AMORTIZATION_METHOD_LABELS[calculatedConditions.amortizationMethod]} no habilitada en política vigente (permitidas: ${product.allowedAmortizationMethods.join(', ')}).`,
    });
  } else {
    rules.push({
      code: 'PRODUCT_CONFIG_FOUND',
      label: 'Configuración de producto crediticio',
      passed: false,
      severity: 'BLOCKING',
      detail: `Producto ${application.productCode} no existe en la política activa.`,
    });
  }

  if (scoring.currencyStressResults?.applied) {
    const stressPassed = scoring.currencyStressResults.scenarios.every((s) => s.remainsSustainable);
    rules.push({
      code: 'USD_FX_STRESS',
      label: 'Prueba de estrés cambiario USD (+15% / +25%)',
      passed: stressPassed || !effectivePolicy.exchangeRateConfig.blockUsdOnStressFailure,
      severity: 'BLOCKING',
      detail: stressPassed
        ? 'Capacidad de pago sostenible bajo depreciación DOP +15% y +25%.'
        : 'Capacidad USD cae por debajo del mínimo sostenible ante depreciación DOP (+15% / +25%).',
    });
  }

  // Schedule reconciliation verification
  const sumPrincipal = simulation
    ? Number(simulation.cuotas.reduce((acc, r) => acc + r.capital, 0).toFixed(2))
    : 0;
  const finalBalance =
    simulation && simulation.cuotas.length > 0
      ? simulation.cuotas[simulation.cuotas.length - 1].balance
      : -1;
  const scheduleReconciled = Boolean(
    simulation &&
      !calculatorError &&
      simulation.cuotas.length === calculatedConditions.installmentCount &&
      simulation.montoNetoRecibir > 0 &&
      Math.abs(finalBalance) < 0.005 &&
      Math.abs(sumPrincipal - simulation.montoFinanciado) < 0.01
  );

  rules.push({
    code: 'SCHEDULE_RECONCILED',
    label: 'Cálculo financiero y conciliación de tabla de amortización',
    passed: scheduleReconciled,
    severity: 'BLOCKING',
    detail: scheduleReconciled
      ? `Tabla de ${simulation!.numeroCuotas} cuotas conciliada (capital ${simulation!.totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2 })}, balance final 0.00).`
      : calculatorError || 'No se pudo completar o conciliar la tabla de amortización.',
  });

  const rulesPassed = rules.filter((r) => r.passed);
  const rulesFailed = rules.filter((r) => !r.passed);
  const blockingFailed = rulesFailed.filter((r) => r.severity === 'BLOCKING');
  const failureReasons = blockingFailed.map((r) => `${r.label}: ${r.detail}`);

  const qualifiesForCalculated =
    blockingFailed.length === 0 &&
    scoring.status === 'PREOFERTA' &&
    scoring.recommendedAmount >= calculatedConditions.requestedAmount - 0.01 &&
    scheduleReconciled;

  const isOriginalEvaluation = analysisType === 'SOLICITUD_INICIAL';
  const qualifiesForRequested = isOriginalEvaluation
    ? qualifiesForCalculated
    : Boolean(
        application.decisionQualificationStatus === 'CALIFICA_AUTO_EVALUACION'
      );

  // Build recommended alternative when it does not qualify automatically
  let recommendedAlternative: FinancialAnalysisRecord['decisionSummary']['recommendedAlternative'] =
    null;
  if (!qualifiesForCalculated && product && scoring.recommendedAmount >= product.minAmount) {
    const recFreq: PaymentFrequency = product.allowedFrequencies[0] ?? 'MENSUAL';
    const recMethod: AmortizationMethod = product.allowedAmortizationMethods[0] ?? 'SALDO_INSOLUTO';
    const recTermMonths = Math.max(
      product.minTermMonths,
      scoring.recommendedTermMonths || product.minTermMonths
    );
    const recInstallments = computeInstallmentCountFromMonths(recTermMonths, recFreq);
    let recRatePct = Number(((scoring.recommendedRateMonthly || 0.05) * 100).toFixed(4));
    try {
      recRatePct = suggestLoanConditions(currency, scoring.recommendedAmount, calculatorConfig).tasa;
    } catch {
      // keep band rate
    }
    recommendedAlternative = {
      amount: scoring.recommendedAmount,
      termMonths: recTermMonths,
      installmentCount: recInstallments,
      monthlyRatePct: recRatePct,
      frequency: recFreq,
      amortizationMethod: recMethod,
      estimatedInstallment: scoring.recommendedInstallment,
    };
  }

  // Determine workflow routing & ENVIAR A EVALUACIÓN eligibility
  const canAutoAdvanceToEvaluation = isOriginalEvaluation && qualifiesForCalculated;
  const requiresHumanIntervention = !qualifiesForCalculated;

  const sendToEvaluationBlockedReasons: string[] = [];
  if (!canUserExecuteHumanReevaluation(actor.role) && !isOriginalEvaluation) {
    sendToEvaluationBlockedReasons.push(
      `El rol ${actor.role} no está autorizado para enviar solicitudes reevaluadas a Evaluación.`
    );
  }
  if (!qualifiesForCalculated) {
    sendToEvaluationBlockedReasons.push(
      ...failureReasons.slice(0, 6)
    );
  }
  if (!scheduleReconciled || !simulation) {
    sendToEvaluationBlockedReasons.push(
      'La tabla de amortización debe estar completamente calculada y conciliada (balance final = 0.00).'
    );
  }
  if (intent === 'SEND_TO_EVALUATION' && (!justification || justification.trim().length < 10)) {
    sendToEvaluationBlockedReasons.push(
      'Debe registrar una justificación de al menos 10 caracteres para enviar la solicitud reevaluada a Evaluación.'
    );
  }

  const canSendToEvaluation =
    (isOriginalEvaluation ? qualifiesForCalculated : canUserExecuteHumanReevaluation(actor.role)) &&
    qualifiesForCalculated &&
    scheduleReconciled &&
    sendToEvaluationBlockedReasons.length === 0;

  let recommendedTargetStatus: ApplicationStatus = application.status ?? 'RECIBIDA';
  let decisionQualificationStatus: DecisionQualificationStatus;
  let analysisStatus: FinancialAnalysisStatus;

  if (isOriginalEvaluation) {
    if (canAutoAdvanceToEvaluation) {
      recommendedTargetStatus = 'EN_EVALUACION';
      decisionQualificationStatus = 'CALIFICA_AUTO_EVALUACION';
      analysisStatus = 'APROBADO_EVALUACION';
    } else {
      recommendedTargetStatus = 'RECIBIDA';
      decisionQualificationStatus = dataIncomplete
        ? 'DATOS_INSUFICIENTES'
        : 'REQUIERE_INTERVENCION_HUMANA';
      analysisStatus = 'VIGENTE';
    }
  } else if (analysisType === 'REEVALUACION_HUMANA') {
    if (intent === 'SEND_TO_EVALUATION' && canSendToEvaluation) {
      recommendedTargetStatus = 'EN_EVALUACION';
      decisionQualificationStatus = 'REEVALUADA_APROBADA_EVALUACION';
      analysisStatus = 'APROBADO_EVALUACION';
    } else {
      recommendedTargetStatus = application.status === 'DEVUELTA' ? 'DEVUELTA' : 'RECIBIDA';
      decisionQualificationStatus = dataIncomplete
        ? 'DATOS_INSUFICIENTES'
        : 'REQUIERE_INTERVENCION_HUMANA';
      analysisStatus = 'VIGENTE';
    }
  } else {
    recommendedTargetStatus = application.status ?? 'EN_EVALUACION';
    decisionQualificationStatus = qualifiesForCalculated
      ? 'REEVALUADA_APROBADA_EVALUACION'
      : 'REQUIERE_INTERVENCION_HUMANA';
    analysisStatus = 'VIGENTE';
  }

  const verdict = qualifiesForCalculated
    ? isOriginalEvaluation
      ? 'CALIFICA AUTOMÁTICAMENTE — ENVÍO AUTOMÁTICO A EVALUACIÓN'
      : 'CALIFICA CON CONDICIONES ALTERNATIVAS — HABILITADA PARA EVALUACIÓN'
    : dataIncomplete
    ? 'DATOS INSUFICIENTES — REQUIERE INTERVENCIÓN HUMANA'
    : 'NO CALIFICA PARA CONDICIONES SOLICITADAS — REQUIERE INTERVENCIÓN HUMANA';

  const explanation = qualifiesForCalculated
    ? `Cumple las ${rulesPassed.length} reglas activas de política crediticia (Score ${scoring.totalScore}/100, Banda ${scoring.riskBand.label}) con tabla de amortización conciliada de ${simulation?.numeroCuotas ?? 0} cuotas.`
    : `No cumple ${blockingFailed.length} regla(s) obligatoria(s) de política: ${failureReasons.slice(0, 3).join(' | ')}.`;

  // Deterministic IDs for strict idempotency (zero duplicates on retry)
  const idempotencyKey = buildFinancialAnalysisIdempotencyKey({
    organizationId: application.organizationId,
    applicationId: application.id,
    analysisType,
    version,
    conditions: calculatedConditions,
    exchangeRate: effectiveUsdRate,
  });
  const shortHash = idempotencyKey.slice(-8);
  const analysisId = `fa_${sanitizeIdPart(application.id, 36)}_v${version}_${shortHash}`.slice(
    0,
    120
  );

  const financialSummary: FinancialAnalysisRecord['financialSummary'] = simulation
    ? {
        currency: simulation.moneda,
        requestedAmount: simulation.montoSolicitado,
        legalFeesAmount: simulation.gastosLegales,
        legalFeeMode: calculatedConditions.legalFeeMode,
        financedPrincipal: simulation.montoFinanciado,
        netDisbursementAmount: simulation.montoNetoRecibir,
        monthlyRatePct: simulation.tasaAplicada,
        periodicRatePct: Number(simulation.tasaPeriodicaPorcentaje.toFixed(6)),
        paymentFrequency: calculatedConditions.paymentFrequency,
        amortizationMethod: calculatedConditions.amortizationMethod,
        installmentCount: simulation.numeroCuotas,
        interestOnlyPeriods: simulation.cuotasSoloInteres,
        amortizationPeriods: simulation.cuotasAmortizacion,
        initialInstallment: simulation.cuotaInicial,
        finalInstallment: simulation.cuotaFinal,
        equalInstallments: simulation.cuotasIguales,
        totalPrincipal: simulation.totalCapital,
        totalInterest: simulation.totalIntereses,
        totalPayable: simulation.totalAPagar,
        totalCostIncludingFees: simulation.costoTotalIncluyendoGastos,
        disbursementDate: simulation.fechaDesembolso,
        firstDueDate: simulation.cuotas[0]?.fecha ?? simulation.fechaDesembolso,
        lastDueDate:
          simulation.cuotas[simulation.cuotas.length - 1]?.fecha ?? simulation.fechaDesembolso,
        finalBalance:
          simulation.cuotas[simulation.cuotas.length - 1]?.balance ?? 0,
        isReconciled: scheduleReconciled,
        dopEquivalentSummary: simulation.equivalenteDOP
          ? {
              requestedAmount: simulation.equivalenteDOP.montoSolicitado,
              legalFeesAmount: simulation.equivalenteDOP.gastosLegales,
              financedPrincipal: simulation.equivalenteDOP.montoFinanciado,
              netDisbursementAmount: simulation.equivalenteDOP.montoNetoRecibir,
              initialInstallment: simulation.equivalenteDOP.cuotaInicial,
              finalInstallment: simulation.equivalenteDOP.cuotaFinal,
              totalPrincipal: simulation.equivalenteDOP.totalCapital,
              totalInterest: simulation.equivalenteDOP.totalIntereses,
              totalPayable: simulation.equivalenteDOP.totalAPagar,
              totalCostIncludingFees: simulation.equivalenteDOP.costoTotalIncluyendoGastos,
            }
          : null,
      }
    : null;

  // Build individual persisted installment records (deterministic IDs per analysis + installmentNumber)
  const installments: Array<Omit<FinancialAnalysisInstallmentRecord, 'createdAt'>> = simulation
    ? simulation.cuotas.map((row, idx) => {
        const dopRow = simulation!.cuotasDOP?.[idx] ?? null;
        return {
          id: `${analysisId}_q_${String(row.numero).padStart(4, '0')}`.slice(0, 128),
          analysisId,
          applicationId: application.id,
          organizationId: application.organizationId,
          installmentNumber: row.numero,
          dueDate: row.fecha,
          stage: mapStageToCode(row.etapa),
          principalAmount: row.capital,
          interestAmount: row.interes,
          totalAmount: row.cuota,
          remainingBalance: row.balance,
          dopEquivalent: dopRow
            ? {
                capital: dopRow.capital,
                interes: dopRow.interes,
                cuota: dopRow.cuota,
                balance: dopRow.balance,
              }
            : null,
        };
      })
    : [];

  // Keep a bounded preview (up to 60 rows) inside the parent analysis document so initial render is instant
  // while the complete schedule lives in `financial_analysis_installments` without risking 1MB Firestore limits.
  const installmentsPreview: FinancialAnalysisInstallmentPreviewRow[] = installments
    .slice(0, 60)
    .map((inst) => ({
      numero: inst.installmentNumber,
      fecha: inst.dueDate,
      etapa: inst.stage,
      capital: inst.principalAmount,
      interes: inst.interestAmount,
      cuota: inst.totalAmount,
      balance: inst.remainingBalance,
      dopCuota: inst.dopEquivalent?.cuota ?? null,
    }));

  const analysis: Omit<FinancialAnalysisRecord, 'calculatedAt' | 'updatedAt'> = {
    id: analysisId,
    organizationId: application.organizationId,
    applicationId: application.id,
    scoringExecutionId: scoring.id,
    idempotencyKey,
    version,
    analysisType,
    status: analysisStatus,
    originalRequestedConditions,
    calculatedConditions,
    decisionSummary: {
      score: scoring.totalScore,
      riskBandCode: scoring.riskBand.code,
      riskBandLabel: scoring.riskBand.label,
      scoringStatus: scoring.status,
      qualifiesForRequested,
      qualifiesForCalculated,
      requiresHumanIntervention,
      verdict,
      explanation,
      rulesPassed,
      rulesFailed,
      failureReasons,
      missingData: scoring.missingData,
      recommendedAlternative,
    },
    financialSummary,
    exchangeRateMeta: effectiveExchangeMeta,
    installmentsCount: installments.length,
    installmentsPreview,
    canSendToEvaluation,
    sendToEvaluationBlockedReasons,
    justification: justification?.trim() ? justification.trim().slice(0, 1000) : null,
    calculatedBy: actor.uid,
    calculatedByName: actor.displayName.slice(0, 160),
    calculatedByRole: actor.role,
  };

  const historyEventType: ApplicationDecisionHistoryRecord['eventType'] =
    analysisType === 'SOLICITUD_INICIAL'
      ? 'INITIAL_AUTO_EVALUATION'
      : analysisType === 'REEVALUACION_HUMANA' && intent === 'SEND_TO_EVALUATION'
      ? 'SENT_TO_EVALUATION_AFTER_REEVALUATION'
      : analysisType === 'REEVALUACION_HUMANA'
      ? 'HUMAN_REEVALUATION_SIMULATION'
      : 'EVALUATION_CONDITIONS_ADJUSTED';

  const historyId = `dh_${sanitizeIdPart(application.id, 32)}_v${version}_${shortHash}`.slice(
    0,
    120
  );

  const decisionHistory: Omit<ApplicationDecisionHistoryRecord, 'createdAt'> = {
    id: historyId,
    organizationId: application.organizationId,
    applicationId: application.id,
    analysisId,
    scoringExecutionId: scoring.id,
    eventType: historyEventType,
    originalConditions: originalRequestedConditions,
    evaluatedConditions: calculatedConditions,
    previousStatus: application.status ?? 'RECIBIDA',
    newStatus: recommendedTargetStatus,
    qualifies: qualifiesForCalculated,
    requiresHumanIntervention,
    rulesPassedCount: rulesPassed.length,
    rulesFailedCount: rulesFailed.length,
    unmetReasons: failureReasons,
    changesSummary: buildConditionsDiff(originalRequestedConditions, calculatedConditions),
    justification: justification?.trim() ? justification.trim().slice(0, 1000) : null,
    actorId: actor.uid,
    actorName: actor.displayName.slice(0, 160),
    actorRole: actor.role,
  };

  return {
    scoring,
    analysis,
    installments,
    decisionHistory,
    simulation,
    calculatorError,
    recommendedTargetStatus,
    decisionQualificationStatus,
    requiresHumanIntervention,
    canAutoAdvanceToEvaluation,
    canSendToEvaluation,
    sendToEvaluationBlockedReasons,
  };
}
