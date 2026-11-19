import {
  ApplicantType,
  ApplicationRecord,
  BusinessFinancialInput,
  CapacityResult,
  CreditPolicyRecord,
  CurrencyCode,
  CurrencyStressScenarioResult,
  CustomerRecord,
  IndicatorDetailResult,
  ProductCode,
  ProductLimitConfig,
  RiskBandCode,
  RiskBandConfig,
  ScoringExecutionRecord,
  ScoringStatus,
} from '../types/axycore';
import { calculateMonthlyInstallment, fromCents, toCents } from './amortizationEngine';
import { DEFAULT_WORKFLOW_CONFIG, normalizeWorkflowThresholds } from './workflowBuilder';

export const DEFAULT_POLICY_V2: Omit<CreditPolicyRecord, 'createdBy' | 'createdAt' | 'updatedAt'> = {
  id: 'policy_v2_0_0_propuesta',
  organizationId: 'org_axycore_main',
  version: '2.0.0-propuesta',
  name: 'Política Crediticia AxyCore V2 (Propuesta en Pruebas)',
  description:
    'Especificación propuesta del Motor de Decisiones Crediticias V2 con 22 indicadores deterministas. Mantenida en entorno de pruebas pendiente de validación y autorización comercial.',
  status: 'EN_PRUEBAS',
  riskBands: [
    {
      code: 'MUY_BAJO',
      label: 'Muy bajo',
      minScore: 90,
      maxScore: 100,
      monthlyRate: 0.04,
      minTermMonths: 3,
      maxTermMonths: 18,
    },
    {
      code: 'BAJO',
      label: 'Bajo',
      minScore: 80,
      maxScore: 89,
      monthlyRate: 0.044,
      minTermMonths: 3,
      maxTermMonths: 18,
    },
    {
      code: 'MODERADO',
      label: 'Moderado',
      minScore: 70,
      maxScore: 79,
      monthlyRate: 0.048,
      minTermMonths: 3,
      maxTermMonths: 15,
    },
    {
      code: 'MEDIO_ALTO',
      label: 'Medio-alto',
      minScore: 60,
      maxScore: 69,
      monthlyRate: 0.052,
      minTermMonths: 3,
      maxTermMonths: 12,
    },
    {
      code: 'ALTO',
      label: 'Alto',
      minScore: 50,
      maxScore: 59,
      monthlyRate: 0.055,
      minTermMonths: 3,
      maxTermMonths: 6,
    },
    {
      code: 'CRITICO',
      label: 'Crítico',
      minScore: 0,
      maxScore: 49,
      monthlyRate: null,
      minTermMonths: 0,
      maxTermMonths: 0,
    },
  ],
  products: {
    PERSONAL_DOP: {
      productCode: 'PERSONAL_DOP',
      label: 'Préstamo Personal DOP',
      currency: 'DOP',
      minAmount: 500,
      maxAmount: 500000,
      minTermMonths: 3,
      maxTermMonths: 18,
      bandCaps: {
        MUY_BAJO: 500000,
        BAJO: 300000,
        MODERADO: 150000,
        MEDIO_ALTO: 75000,
        ALTO: 25000,
        CRITICO: 0,
      },
      allowedFrequencies: ['MENSUAL'],
      allowedAmortizationMethods: ['SALDO_INSOLUTO'],
    },
    EMPRESARIAL_DOP: {
      productCode: 'EMPRESARIAL_DOP',
      label: 'Préstamo Empresarial DOP',
      currency: 'DOP',
      minAmount: 500,
      maxAmount: 1000000,
      minTermMonths: 3,
      maxTermMonths: 18,
      bandCaps: {
        MUY_BAJO: 1000000,
        BAJO: 600000,
        MODERADO: 300000,
        MEDIO_ALTO: 150000,
        ALTO: 50000,
        CRITICO: 0,
      },
      allowedFrequencies: ['MENSUAL'],
      allowedAmortizationMethods: ['SALDO_INSOLUTO'],
    },
    PERSONAL_USD: {
      productCode: 'PERSONAL_USD',
      label: 'Préstamo Personal USD',
      currency: 'USD',
      minAmount: 300,
      maxAmount: 5000,
      minTermMonths: 3,
      maxTermMonths: 18,
      bandCaps: {
        MUY_BAJO: 5000,
        BAJO: 3500,
        MODERADO: 2500,
        MEDIO_ALTO: 1500,
        ALTO: 750,
        CRITICO: 0,
      },
      allowedFrequencies: ['MENSUAL'],
      allowedAmortizationMethods: ['SALDO_INSOLUTO'],
    },
    EMPRESARIAL_USD: {
      productCode: 'EMPRESARIAL_USD',
      label: 'Préstamo Empresarial USD',
      currency: 'USD',
      minAmount: 300,
      maxAmount: 5000,
      minTermMonths: 3,
      maxTermMonths: 18,
      bandCaps: {
        MUY_BAJO: 5000,
        BAJO: 3500,
        MODERADO: 2500,
        MEDIO_ALTO: 1500,
        ALTO: 750,
        CRITICO: 0,
      },
      allowedFrequencies: ['MENSUAL'],
      allowedAmortizationMethods: ['SALDO_INSOLUTO'],
    },
  },
  capacityConfig: {
    additionalIncomeFactor: 0.7,
    maxNewInstallmentRatio: 0.2,
    maxProjectedDti: 0.35,
    minCoverageRatio: 1.25,
    referenceSimulationMonthlyRate: 0.055,
  },
  exchangeRateConfig: {
    dopPerUsd: 60.0,
    rateDate: '2026-11-17',
    source: 'Parámetro de pruebas configurable (pendiente validación tesorería)',
    stressDepreciations: [0.15, 0.25],
    blockUsdOnStressFailure: true,
  },
  approvalAuthorities: [],
  workflowConfig: DEFAULT_WORKFLOW_CONFIG,
  allowedExpenses: ['Gastos legales de formalización', 'Comisión de cierre configurada'],
  documentRequirements: ['Cédula o Pasaporte vigente', 'Evidencia de ingresos o estados financieros'],
};

export interface EngineEvaluationInput {
  application: Pick<
    ApplicationRecord,
    | 'id'
    | 'organizationId'
    | 'applicantType'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'requestedTermMonths'
    | 'paymentFrequency'
    | 'amortizationMethod'
    | 'loanPurpose'
    | 'loanPurposeDescription'
    | 'financialData'
    | 'businessFinancialData'
    | 'verifiedFinancialData'
    | 'verifiedBusinessFinancialData'
    | 'references'
    | 'declaredDocumentsSummary'
  >;
  customer: Pick<
    CustomerRecord,
    | 'phone'
    | 'address'
    | 'email'
    | 'residenceMonths'
    | 'housingType'
    | 'housingPayment'
    | 'socialMediaDeclared'
    | 'socialMediaHandle'
  >;
  policy: CreditPolicyRecord | typeof DEFAULT_POLICY_V2;
  useVerifiedData?: boolean;
  executionTrigger: 'INITIAL_SUBMIT' | 'ANALYST_RECALC' | 'MANUAL_RERUN';
  executedBy: string;
  executedByName?: string;
}

function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  dopPerUsd: number | null
): number | null {
  if (fromCurrency === toCurrency) return amount;
  if (!dopPerUsd || dopPerUsd <= 0) return null;
  if (fromCurrency === 'DOP' && toCurrency === 'USD') {
    return amount / dopPerUsd;
  }
  if (fromCurrency === 'USD' && toCurrency === 'DOP') {
    return amount * dopPerUsd;
  }
  return null;
}

function findRiskBand(score: number, bands: RiskBandConfig[]): RiskBandConfig {
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  const found = sorted.find((b) => score >= b.minScore && score <= b.maxScore);
  return (
    found ??
    sorted[sorted.length - 1] ?? {
      code: 'CRITICO',
      label: 'Crítico',
      minScore: 0,
      maxScore: 49,
      monthlyRate: null,
      minTermMonths: 0,
      maxTermMonths: 0,
    }
  );
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMoney(amount: number, currency: CurrencyCode): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function evaluateCreditDecisionV2(
  input: EngineEvaluationInput
): Omit<ScoringExecutionRecord, 'executedAt'> {
  const { application, customer, policy } = input;
  const fin =
    input.useVerifiedData && application.verifiedFinancialData
      ? application.verifiedFinancialData
      : application.financialData;
  const bizFin: BusinessFinancialInput | null | undefined =
    input.useVerifiedData && application.verifiedBusinessFinancialData
      ? application.verifiedBusinessFinancialData
      : application.businessFinancialData;

  const product: ProductLimitConfig = policy.products[application.productCode as ProductCode];
  const loanCurrency = application.currency;
  const isBusiness: boolean = application.applicantType === ('BUSINESS' as ApplicantType);
  const incomeCurrency: CurrencyCode = isBusiness && bizFin ? bizFin.incomeCurrency : fin.incomeCurrency;

  const alerts: string[] = [];
  const missingData: string[] = [];
  const favorableFactors: string[] = [];

  // Policy status reminder
  if (policy.status === 'PROPUESTA' || policy.status === 'EN_PRUEBAS') {
    alerts.push(
      `Política ${policy.version} ejecutada en estado ${policy.status} (pendiente de validación y autorización comercial).`
    );
  }

  // Validate product vs currency
  if (!product) {
    return buildErrorResult(input, 'Producto crediticio no configurado en la política.');
  }
  if (product.currency !== loanCurrency) {
    alerts.push(`La moneda solicitada (${loanCurrency}) no coincide con la moneda del producto (${product.currency}).`);
  }

  // Exchange rate check when incomeCurrency !== loanCurrency
  const dopPerUsd = policy.exchangeRateConfig.dopPerUsd;
  const needsFx = incomeCurrency !== loanCurrency;
  if (needsFx && (!dopPerUsd || dopPerUsd <= 0)) {
    missingData.push(`Tipo de cambio válido para convertir ${incomeCurrency} a ${loanCurrency}`);
  }

  // Extract raw financial fields & distinguish 0 vs missing/null
  let primaryIncomeOrig: number | null | undefined = fin.primaryNetIncome;
  let additionalIncomeOrig: number = fin.additionalNetIncome ?? 0;
  let employmentMonths: number | null | undefined = fin.employmentMonths;
  let debtStatus = fin.debtDeclarationStatus;
  let debtCount = fin.debtCount;
  let totalDebtBalanceOrig = fin.totalDebtBalance;
  let currentDebtPaymentsOrig = fin.currentDebtPayments;

  if (isBusiness) {
    if (!bizFin) {
      missingData.push('Información financiera empresarial');
    } else {
      // CRITICAL RULE (Section 5.3 & 21): Never confuse grossSales with netMonthlyFlow
      if (bizFin.grossSales !== null && bizFin.grossSales !== undefined && bizFin.grossSales > 0) {
        if (bizFin.netMonthlyFlow === null || bizFin.netMonthlyFlow === undefined) {
          missingData.push('Flujo neto mensual disponible del negocio (ventas brutas no equivalen a flujo neto)');
          alerts.push(
            'El solicitante empresarial declaró ventas brutas pero no registró flujo neto mensual disponible.'
          );
        }
      }
      primaryIncomeOrig = bizFin.netMonthlyFlow;
      additionalIncomeOrig = fin.additionalNetIncome ?? 0;
      employmentMonths = bizFin.operationsMonths ?? fin.employmentMonths;
      debtStatus = bizFin.debtDeclarationStatus ?? fin.debtDeclarationStatus;
      if (bizFin.businessDebtCount !== undefined && bizFin.businessDebtCount !== null) {
        debtCount = bizFin.businessDebtCount;
      }
      if (bizFin.totalBusinessDebtBalance !== undefined && bizFin.totalBusinessDebtBalance !== null) {
        totalDebtBalanceOrig = bizFin.totalBusinessDebtBalance;
      }
      if (bizFin.businessObligationsMonthly !== undefined && bizFin.businessObligationsMonthly !== null) {
        currentDebtPaymentsOrig = bizFin.businessObligationsMonthly;
      }
    }
  }

  // Missing essential financials check (do NOT invent results!)
  if (primaryIncomeOrig === null || primaryIncomeOrig === undefined) {
    missingData.push('Ingreso principal neto mensual');
  } else if (primaryIncomeOrig <= 0) {
    missingData.push('Ingreso neto positivo');
  }

  if (fin.essentialExpenses === null || fin.essentialExpenses === undefined) {
    missingData.push('Gastos esenciales mensuales');
  }

  let debtDataMissing = false;
  if (debtStatus === 'UNDECLARED') {
    debtDataMissing = true;
    missingData.push('Declaración expresa de deudas actuales (o confirmación de cero deudas)');
  } else if (debtStatus === 'HAS_DEBTS') {
    if (
      debtCount === null ||
      debtCount === undefined ||
      totalDebtBalanceOrig === null ||
      totalDebtBalanceOrig === undefined ||
      currentDebtPaymentsOrig === null ||
      currentDebtPaymentsOrig === undefined
    ) {
      debtDataMissing = true;
      missingData.push('Detalle cuantificado de cantidad, saldo y cuotas de deudas');
    }
  } else if (debtStatus === 'NO_DEBTS_EXPLICIT') {
    debtCount = 0;
    totalDebtBalanceOrig = 0;
    currentDebtPaymentsOrig = 0;
  }

  // Housing payment (avoid double deduction!)
  const housingPaymentOrig =
    fin.housingPayment !== null && fin.housingPayment !== undefined
      ? fin.housingPayment
      : customer.housingPayment ?? 0;
  const housingIncluded = Boolean(fin.housingIncludedInExpenses);

  // Convert normalized values to loanCurrency
  const fxFactor = needsFx ? dopPerUsd : 1;
  const normPrimaryIncome =
    primaryIncomeOrig !== null && primaryIncomeOrig !== undefined
      ? convertCurrency(primaryIncomeOrig, incomeCurrency, loanCurrency, fxFactor) ?? 0
      : 0;
  const normAdditionalIncome =
    convertCurrency(additionalIncomeOrig, incomeCurrency, loanCurrency, fxFactor) ?? 0;
  const normEssentialBase =
    fin.essentialExpenses !== null && fin.essentialExpenses !== undefined
      ? convertCurrency(fin.essentialExpenses, incomeCurrency, loanCurrency, fxFactor) ?? 0
      : 0;
  const normHousingPayment =
    convertCurrency(housingPaymentOrig, incomeCurrency, loanCurrency, fxFactor) ?? 0;
  const normCurrentDebtPayments =
    currentDebtPaymentsOrig !== null && currentDebtPaymentsOrig !== undefined
      ? convertCurrency(currentDebtPaymentsOrig, incomeCurrency, loanCurrency, fxFactor) ?? 0
      : 0;
  const normTotalDebtBalance =
    totalDebtBalanceOrig !== null && totalDebtBalanceOrig !== undefined
      ? convertCurrency(totalDebtBalanceOrig, incomeCurrency, loanCurrency, fxFactor) ?? 0
      : 0;

  // Capacity math (Section 8)
  const additionalFactor = policy.capacityConfig.additionalIncomeFactor; // 0.70
  const eligibleIncome = fromCents(
    toCents(normPrimaryIncome + additionalFactor * normAdditionalIncome)
  );
  // Avoid double deduction of housing
  const essentialExpensesTotal = fromCents(
    toCents(normEssentialBase + (housingIncluded ? 0 : normHousingPayment))
  );
  const currentDebtPayments = fromCents(toCents(normCurrentDebtPayments));
  const availableFlow = fromCents(
    Math.max(0, toCents(eligibleIncome) - toCents(essentialExpensesTotal) - toCents(currentDebtPayments))
  );

  const currentDti = eligibleIncome > 0 ? currentDebtPayments / eligibleIncome : 1;
  const maxInstallmentAllowed = fromCents(
    Math.max(
      0,
      toCents(
        Math.min(
          policy.capacityConfig.maxNewInstallmentRatio * eligibleIncome,
          policy.capacityConfig.maxProjectedDti * eligibleIncome - currentDebtPayments,
          (1 / policy.capacityConfig.minCoverageRatio) * availableFlow
        )
      )
    )
  );

  // Step 1 & 2 (Section 8.1): Simulate initial installment at 5.5% reference monthly rate
  const refRate = policy.capacityConfig.referenceSimulationMonthlyRate; // 0.055
  const reqAmount = application.requestedAmount > 0 ? application.requestedAmount : 0;
  const reqTerm = application.requestedTermMonths > 0 ? application.requestedTermMonths : 1;
  const simulatedRefInstallment =
    reqAmount > 0 ? calculateMonthlyInstallment(reqAmount, refRate, reqTerm) : 0;
  const simulatedRefCoverage =
    simulatedRefInstallment > 0 ? availableFlow / simulatedRefInstallment : 0;

  // --- Compute all 22 Indicators (Total Max = 100) ---
  const indicators: IndicatorDetailResult[] = [];

  // 01. Capacidad disponible / ingreso elegible (16 pts)
  const capRatio = eligibleIncome > 0 ? availableFlow / eligibleIncome : 0;
  const p1 = capRatio >= 0.4 ? 16 : capRatio >= 0.3 ? 12 : capRatio >= 0.2 ? 8 : capRatio >= 0.1 ? 4 : 0;
  indicators.push({
    number: 1,
    key: 'available_capacity_ratio',
    name: 'Capacidad económica disponible',
    maxPoints: 16,
    awardedPoints: p1,
    usedValue: `${pct(capRatio)} (${fmtMoney(availableFlow, loanCurrency)} / ${fmtMoney(eligibleIncome, loanCurrency)})`,
    explanation: 'Relación flujo disponible mensual (F = I - E - D) entre ingreso elegible (I).',
  });

  // 02. Endeudamiento mensual actual (12 pts)
  const p2 =
    eligibleIncome <= 0
      ? 0
      : currentDti <= 0.1
      ? 12
      : currentDti <= 0.2
      ? 9
      : currentDti <= 0.3
      ? 6
      : currentDti <= 0.35
      ? 3
      : 0;
  indicators.push({
    number: 2,
    key: 'current_dti',
    name: 'Endeudamiento mensual actual',
    maxPoints: 12,
    awardedPoints: p2,
    usedValue: pct(currentDti),
    explanation: 'Cuotas mensuales actuales de deuda (D) sobre ingreso elegible (I).',
  });

  // 03. Cuota simulada / ingreso elegible (8 pts)
  const simInstallmentRatio = eligibleIncome > 0 ? simulatedRefInstallment / eligibleIncome : 1;
  const p3 =
    eligibleIncome <= 0 || simulatedRefInstallment <= 0
      ? 0
      : simInstallmentRatio <= 0.1
      ? 8
      : simInstallmentRatio <= 0.15
      ? 6
      : simInstallmentRatio <= 0.2
      ? 3
      : 0;
  indicators.push({
    number: 3,
    key: 'simulated_installment_ratio',
    name: 'Cuota solicitada / ingreso',
    maxPoints: 8,
    awardedPoints: p3,
    usedValue: `${pct(simInstallmentRatio)} (${fmtMoney(simulatedRefInstallment, loanCurrency)} ref. 5.5%)`,
    explanation: 'Cuota simulada a tasa de referencia 5.5% mensual entre ingreso elegible.',
  });

  // 04. Cobertura disponible / cuota simulada (6 pts)
  const p4 =
    simulatedRefCoverage >= 2.0
      ? 6
      : simulatedRefCoverage >= 1.5
      ? 4
      : simulatedRefCoverage >= 1.25
      ? 2
      : 0;
  indicators.push({
    number: 4,
    key: 'simulated_coverage',
    name: 'Cobertura de cuota solicitada',
    maxPoints: 6,
    awardedPoints: p4,
    usedValue: `${simulatedRefCoverage.toFixed(2)}x`,
    explanation: 'Veces que el flujo disponible cubre la cuota simulada al 5.5% mensual.',
  });

  // 05. Gastos esenciales / ingreso (4 pts)
  const expRatio = eligibleIncome > 0 ? essentialExpensesTotal / eligibleIncome : 1;
  const p5 =
    eligibleIncome <= 0
      ? 0
      : expRatio <= 0.4
      ? 4
      : expRatio <= 0.55
      ? 3
      : expRatio <= 0.7
      ? 1
      : 0;
  indicators.push({
    number: 5,
    key: 'essential_expenses_ratio',
    name: 'Gastos mensuales / ingreso',
    maxPoints: 4,
    awardedPoints: p5,
    usedValue: `${pct(expRatio)}${housingIncluded ? ' (vivienda incluida sin duplicar)' : ''}`,
    explanation: 'Gastos esenciales totales sin duplicación de vivienda sobre ingreso elegible.',
  });

  // 06. Saldo total de deudas / ingreso mensual (2 pts)
  const debtToIncomeMultiple = eligibleIncome > 0 ? normTotalDebtBalance / eligibleIncome : 99;
  const p6 =
    debtStatus === 'UNDECLARED' || eligibleIncome <= 0
      ? 0
      : debtToIncomeMultiple <= 3
      ? 2
      : debtToIncomeMultiple <= 6
      ? 1
      : 0;
  indicators.push({
    number: 6,
    key: 'total_debt_to_income_multiple',
    name: 'Saldo total de deudas / ingreso',
    maxPoints: 2,
    awardedPoints: p6,
    usedValue: debtStatus === 'UNDECLARED' ? 'No declarado' : `${debtToIncomeMultiple.toFixed(2)}x`,
    explanation: 'Saldo total adeudado dividido entre ingreso elegible mensual.',
  });

  // 07. Cantidad de deudas (2 pts)
  const dCount = debtCount ?? -1;
  const p7 = debtStatus === 'UNDECLARED' || dCount < 0 ? 0 : dCount <= 1 ? 2 : dCount <= 3 ? 1 : 0;
  indicators.push({
    number: 7,
    key: 'debt_count',
    name: 'Cantidad de deudas',
    maxPoints: 2,
    awardedPoints: p7,
    usedValue: debtStatus === 'UNDECLARED' || dCount < 0 ? 'No declarado' : `${dCount} obligaciones`,
    explanation: 'Número total de obligaciones activas declaradas.',
  });

  // 08. Antigüedad laboral o comercial (10 pts)
  const empMonths = employmentMonths ?? -1;
  const p8 =
    empMonths >= 36 ? 10 : empMonths >= 24 ? 8 : empMonths >= 12 ? 6 : empMonths >= 6 ? 3 : 0;
  indicators.push({
    number: 8,
    key: 'employment_tenure',
    name: 'Antigüedad laboral o comercial',
    maxPoints: 10,
    awardedPoints: p8,
    usedValue: empMonths >= 0 ? `${empMonths} meses` : 'No declarada',
    explanation: 'Meses continuos en empleo actual o actividad comercial.',
  });

  // 09. Tipo de fuente de ingresos (5 pts)
  const incType = fin.incomeSourceType ?? 'SIN_INGRESOS';
  const p9 =
    incType === 'FIJA_RECURRENTE' ? 5 : incType === 'MIXTA_RECURRENTE' ? 4 : incType === 'IRREGULAR' ? 2 : 0;
  indicators.push({
    number: 9,
    key: 'income_source_type',
    name: 'Tipo de fuente de ingresos',
    maxPoints: 5,
    awardedPoints: p9,
    usedValue: incType,
    explanation: 'Estabilidad estructural de la fuente principal de ingresos.',
  });

  // 10. Ingresos adicionales declarados (3 pts)
  const addStatus = fin.additionalIncomeStatus ?? (additionalIncomeOrig > 0 ? 'QUANTIFIED' : 'EXPLICIT_NONE');
  let p10 = 0;
  if (
    (addStatus === 'EXPLICIT_NONE' && additionalIncomeOrig === 0) ||
    (addStatus === 'QUANTIFIED' && additionalIncomeOrig > 0)
  ) {
    p10 = 3;
  } else if (addStatus === 'PARTIAL') {
    p10 = 1;
  } else {
    p10 = 0;
  }
  indicators.push({
    number: 10,
    key: 'additional_income',
    name: 'Ingresos adicionales declarados',
    maxPoints: 3,
    awardedPoints: p10,
    usedValue: `${addStatus} (${fmtMoney(normAdditionalIncome, loanCurrency)})`,
    explanation: 'Claridad y cuantificación de ingresos adicionales (ponderados al 70% en I).',
  });

  // 11. Identificación laboral/comercial (2 pts)
  const hasEntityName = Boolean(fin.employerOrBusinessName && fin.employerOrBusinessName.trim().length > 1);
  const hasRole = Boolean(fin.occupationOrRole && fin.occupationOrRole.trim().length > 1);
  const p11 = hasEntityName && hasRole ? 2 : hasEntityName || hasRole ? 1 : 0;
  indicators.push({
    number: 11,
    key: 'work_identification',
    name: 'Identificación laboral o comercial',
    maxPoints: 2,
    awardedPoints: p11,
    usedValue: hasEntityName && hasRole ? 'Completa' : hasEntityName || hasRole ? 'Parcial' : 'Ausente',
    explanation: 'Registro de empresa/negocio y cargo u ocupación.',
  });

  // 12. Antigüedad residencial (4 pts)
  const resMonths = customer.residenceMonths ?? 0;
  const p12 = resMonths >= 36 ? 4 : resMonths >= 12 ? 3 : resMonths >= 6 ? 2 : resMonths >= 1 ? 1 : 0;
  indicators.push({
    number: 12,
    key: 'residence_tenure',
    name: 'Antigüedad de residencia',
    maxPoints: 4,
    awardedPoints: p12,
    usedValue: resMonths > 0 ? `${resMonths} meses` : 'Ausente',
    explanation: 'Tiempo de permanencia en el domicilio actual.',
  });

  // 13. Tipo de vivienda (3 pts)
  const hType = customer.housingType ?? 'NO_DECLARADA';
  const p13 = hType === 'PROPIA' ? 3 : hType === 'ALQUILADA' || hType === 'FAMILIAR' ? 2 : hType === 'OTRA' ? 1 : 0;
  indicators.push({
    number: 13,
    key: 'housing_type',
    name: 'Tipo de vivienda',
    maxPoints: 3,
    awardedPoints: p13,
    usedValue: hType,
    explanation: 'Régimen de tenencia de la vivienda declarada.',
  });

  // 14. Pago de vivienda / ingreso (3 pts)
  const housingRatio = eligibleIncome > 0 ? normHousingPayment / eligibleIncome : 1;
  const p14 =
    eligibleIncome <= 0
      ? 0
      : housingRatio <= 0.15
      ? 3
      : housingRatio <= 0.25
      ? 2
      : housingRatio <= 0.35
      ? 1
      : 0;
  indicators.push({
    number: 14,
    key: 'housing_payment_ratio',
    name: 'Pago de vivienda / ingreso',
    maxPoints: 3,
    awardedPoints: p14,
    usedValue: `${pct(housingRatio)} (${fmtMoney(normHousingPayment, loanCurrency)})`,
    explanation: 'Carga de alquiler o hipoteca residencial respecto al ingreso elegible.',
  });

  // 15. Referencias completas (3 pts) — No exigir llamada previa!
  const completeRefs = (application.references ?? []).filter(
    (r) => r.name?.trim() && r.relationship?.trim() && r.phone?.trim()
  ).length;
  const p15 = completeRefs >= 2 ? 3 : completeRefs === 1 ? 1 : 0;
  indicators.push({
    number: 15,
    key: 'references_complete',
    name: 'Referencias completas',
    maxPoints: 3,
    awardedPoints: p15,
    usedValue: `${completeRefs} referencias completas`,
    explanation: 'Referencias declaradas con nombre, relación y teléfono (sin requerir confirmación telefónica previa).',
  });

  // 16. Redes sociales declaradas (2 pts) — Equity watch variable!
  const smStatus = customer.socialMediaDeclared ?? 'UNANSWERED';
  const hasSmHandle = Boolean(customer.socialMediaHandle && customer.socialMediaHandle.trim().length > 0);
  const p16 = smStatus === 'YES' && hasSmHandle ? 2 : smStatus === 'NO_MEDIA' ? 1 : 0;
  indicators.push({
    number: 16,
    key: 'social_media_declared',
    name: 'Redes sociales declaradas',
    maxPoints: 2,
    awardedPoints: p16,
    usedValue: smStatus === 'YES' && hasSmHandle ? 'Declarada con identificador' : smStatus === 'NO_MEDIA' ? 'Declara no tener' : 'No responde',
    explanation:
      'Variable de equidad pendiente de revisión y posible eliminación del modelo; no bloquea la solicitud por sí sola.',
    isFairnessWatch: true,
  });

  // 17. Información de contacto (3 pts) — No email does NOT block!
  const hasPhone = Boolean(customer.phone && customer.phone.trim().length >= 7);
  const hasAddress = Boolean(customer.address && customer.address.trim().length >= 4);
  const hasEmail = Boolean(customer.email && customer.email.trim().includes('@'));
  const p17 = hasPhone && hasAddress && hasEmail ? 3 : hasPhone && hasAddress ? 2 : hasPhone ? 1 : 0;
  indicators.push({
    number: 17,
    key: 'contact_info',
    name: 'Información de contacto',
    maxPoints: 3,
    awardedPoints: p17,
    usedValue: [hasPhone ? 'Teléfono' : null, hasAddress ? 'Dirección' : null, hasEmail ? 'Correo' : null]
      .filter(Boolean)
      .join(' + ') || 'Incompleta',
    explanation: 'Completitud de datos de contacto (la ausencia de correo no bloquea la solicitud).',
  });

  // 18. Documentos suministrados (3 pts) — Supplied != Verified
  const docsSummary = application.declaredDocumentsSummary ?? {
    hasIdentityDoc: false,
    hasIncomeEvidence: false,
  };
  const p18 =
    docsSummary.hasIdentityDoc && docsSummary.hasIncomeEvidence
      ? 3
      : docsSummary.hasIdentityDoc
      ? 2
      : docsSummary.hasIncomeEvidence
      ? 1
      : 0;
  indicators.push({
    number: 18,
    key: 'documents_supplied',
    name: 'Documentos suministrados',
    maxPoints: 3,
    awardedPoints: p18,
    usedValue:
      p18 === 3
        ? 'Identidad + Evidencia de ingresos'
        : p18 === 2
        ? 'Solo identidad'
        : p18 === 1
        ? 'Solo evidencia de ingresos'
        : 'Ninguno',
    explanation: 'Evidencia documental adjuntada al expediente (distinto de verificación analítica).',
  });

  // 19. Destino del préstamo (2 pts)
  const hasPurpose = Boolean(application.loanPurpose && application.loanPurpose.trim().length > 1);
  const hasPurposeDesc = Boolean(
    application.loanPurposeDescription && application.loanPurposeDescription.trim().length > 3
  );
  const p19 = hasPurpose && hasPurposeDesc ? 2 : hasPurpose ? 1 : 0;
  indicators.push({
    number: 19,
    key: 'loan_purpose',
    name: 'Destino del préstamo',
    maxPoints: 2,
    awardedPoints: p19,
    usedValue: hasPurpose && hasPurposeDesc ? 'Destino y descripción' : hasPurpose ? 'Solo destino' : 'No declarado',
    explanation: 'Claridad en el destino y descripción del financiamiento.',
  });

  // 20. Condiciones solicitadas completas (3 pts)
  const condCount = [
    application.requestedAmount > 0,
    application.requestedTermMonths > 0,
    Boolean(application.paymentFrequency),
    Boolean(application.currency),
  ].filter(Boolean).length;
  const p20 = condCount === 4 ? 3 : condCount === 3 ? 2 : condCount === 2 ? 1 : 0;
  indicators.push({
    number: 20,
    key: 'requested_conditions_complete',
    name: 'Condiciones solicitadas completas',
    maxPoints: 3,
    awardedPoints: p20,
    usedValue: `${condCount}/4 parámetros`,
    explanation: 'Monto, plazo, frecuencia y moneda completos en la solicitud.',
  });

  // 21. Coherencia de ingresos (2 pts)
  let p21 = 0;
  let incomeCoherenceMsg = 'Sin datos suficientes';
  if (primaryIncomeOrig !== null && primaryIncomeOrig !== undefined && primaryIncomeOrig > 0) {
    if (isBusiness && bizFin) {
      const sales = bizFin.grossSales ?? null;
      const costs = bizFin.operatingCosts ?? null;
      const net = bizFin.netMonthlyFlow ?? null;
      if (sales !== null && costs !== null && net !== null && sales > 0) {
        const expectedNet = sales - costs;
        const diffPct = Math.abs(expectedNet - net) / Math.max(1, sales);
        p21 = diffPct <= 0.01 ? 2 : diffPct <= 0.05 ? 1 : 0;
        incomeCoherenceMsg = `Diferencia flujo vs ventas-costos: ${pct(diffPct)}`;
      } else if (net !== null && net > 0) {
        p21 = 1;
        incomeCoherenceMsg = 'Flujo neto declarado sin desglose completo de ventas/costos';
      }
    } else {
      const sumDecl = primaryIncomeOrig + additionalIncomeOrig;
      const totDecl = fin.declaredTotalMonthlyIncome ?? sumDecl;
      if (totDecl > 0) {
        const diffPct = Math.abs(sumDecl - totDecl) / totDecl;
        p21 = diffPct <= 0.01 ? 2 : diffPct <= 0.05 ? 1 : 0;
        incomeCoherenceMsg = `Diferencia aritmética: ${pct(diffPct)}`;
      }
    }
  }
  indicators.push({
    number: 21,
    key: 'income_coherence',
    name: 'Coherencia de ingresos',
    maxPoints: 2,
    awardedPoints: p21,
    usedValue: incomeCoherenceMsg,
    explanation: 'Consistencia aritmética entre partidas de ingreso declaradas.',
  });

  // 22. Coherencia de deudas (2 pts)
  let p22 = 0;
  let debtCoherenceMsg = 'Sin declaración de deudas';
  if (debtStatus === 'NO_DEBTS_EXPLICIT') {
    if ((debtCount ?? 0) === 0 && (totalDebtBalanceOrig ?? 0) === 0 && (currentDebtPaymentsOrig ?? 0) === 0) {
      p22 = 2;
      debtCoherenceMsg = 'Declaración expresa de cero deudas consistente';
    } else {
      p22 = 0;
      debtCoherenceMsg = 'Declara cero deudas pero registra saldos o cuotas';
      alerts.push('Inconsistencia: declaró cero deudas pero existen saldos o cuotas mayores a cero.');
    }
  } else if (debtStatus === 'HAS_DEBTS' && !debtDataMissing) {
    const breakdownParts = [
      fin.bankDebtPayment,
      fin.financeDebtPayment,
      fin.cardDebtPayment,
      fin.informalDebtPayment,
      fin.otherDebtPayment,
    ];
    const hasBreakdown = breakdownParts.some((v) => v !== null && v !== undefined);
    const totalPay = currentDebtPaymentsOrig ?? 0;
    if ((debtCount ?? 0) > 0 && (totalDebtBalanceOrig ?? 0) === 0 && totalPay === 0) {
      p22 = 0;
      debtCoherenceMsg = 'Cantidad de deudas > 0 con saldo y cuotas en cero';
    } else if ((debtCount ?? 0) === 0 && ((totalDebtBalanceOrig ?? 0) > 0 || totalPay > 0)) {
      p22 = 0;
      debtCoherenceMsg = 'Cantidad de deudas en 0 pero declara saldo o cuotas';
    } else if (hasBreakdown && totalPay > 0) {
      const sumBreakdown = breakdownParts.reduce<number>((acc, v) => acc + (v ?? 0), 0);
      const diffPct = Math.abs(sumBreakdown - totalPay) / totalPay;
      p22 = diffPct <= 0.01 ? 2 : diffPct <= 0.05 ? 1 : 0;
      debtCoherenceMsg = `Diferencia desglose vs cuota total: ${pct(diffPct)}`;
      if (p22 === 0) {
        alerts.push(`Inconsistencia en deudas (${pct(diffPct)} diferencia entre desglose y cuota total).`);
      }
    } else {
      p22 = 2;
      debtCoherenceMsg = 'Totales de deuda consistentes';
    }
  }
  indicators.push({
    number: 22,
    key: 'debt_coherence',
    name: 'Coherencia de deudas',
    maxPoints: 2,
    awardedPoints: p22,
    usedValue: debtCoherenceMsg,
    explanation: 'Conciliación aritmética de obligaciones declaradas o declaración expresa de cero deudas.',
  });

  // Total Score (exact sum of 22 indicators)
  const totalScore = indicators.reduce((sum, item) => sum + item.awardedPoints, 0);
  const riskBand = findRiskBand(totalScore, policy.riskBands);

  // Build favorable factors
  if (p1 >= 12) favorableFactors.push('Sólida capacidad económica disponible respecto al ingreso elegible.');
  if (p2 >= 9) favorableFactors.push('Bajo nivel de endeudamiento mensual actual.');
  if (p8 >= 8) favorableFactors.push('Alta estabilidad laboral o comercial (>= 24 meses).');
  if (p15 === 3) favorableFactors.push('Dos referencias completas registradas.');
  if (p22 === 2 && debtStatus === 'NO_DEBTS_EXPLICIT') {
    favorableFactors.push('Declaración expresa sin obligaciones financieras activas.');
  }

  // Stress test for USD loans backed by DOP income (Section 8.3)
  let currencyStressResults: ScoringExecutionRecord['currencyStressResults'] = null;
  let stressFailed = false;
  if (loanCurrency === 'USD' && incomeCurrency === 'DOP' && dopPerUsd && dopPerUsd > 0) {
    const scenarios: CurrencyStressScenarioResult[] = [];
    for (const dep of policy.exchangeRateConfig.stressDepreciations) {
      const stressedRate = Number((dopPerUsd * (1 + dep)).toFixed(4));
      const stressedInc = fromCents(
        toCents(
          ((primaryIncomeOrig ?? 0) + additionalFactor * additionalIncomeOrig) / stressedRate
        )
      );
      const stressedExp = fromCents(
        toCents((normEssentialBase * (dopPerUsd / stressedRate)) + (housingIncluded ? 0 : normHousingPayment * (dopPerUsd / stressedRate)))
      );
      const stressedDebt = fromCents(toCents(normCurrentDebtPayments * (dopPerUsd / stressedRate)));
      const stressedFlow = fromCents(
        Math.max(0, toCents(stressedInc) - toCents(stressedExp) - toCents(stressedDebt))
      );
      const stressedMaxInst = fromCents(
        Math.max(
          0,
          toCents(
            Math.min(
              policy.capacityConfig.maxNewInstallmentRatio * stressedInc,
              policy.capacityConfig.maxProjectedDti * stressedInc - stressedDebt,
              (1 / policy.capacityConfig.minCoverageRatio) * stressedFlow
            )
          )
        )
      );
      const bandRate = riskBand.monthlyRate ?? refRate;
      const effTerm = riskBand.maxTermMonths > 0 ? Math.min(reqTerm, riskBand.maxTermMonths) : reqTerm;
      const stressedPCap =
        stressedMaxInst > 0 && effTerm > 0
          ? fromCents(
              toCents(
                (stressedMaxInst * (1 - Math.pow(1 + bandRate, -effTerm))) / bandRate
              )
            )
          : 0;
      const remainsSustainable = stressedPCap >= product.minAmount;
      if (!remainsSustainable) {
        stressFailed = true;
      }
      scenarios.push({
        depreciationPct: dep,
        stressedExchangeRate: stressedRate,
        stressedEligibleIncome: stressedInc,
        stressedAvailableFlow: stressedFlow,
        stressedMaxInstallment: stressedMaxInst,
        stressedSustainablePrincipal: stressedPCap,
        remainsSustainable,
      });
    }
    currencyStressResults = { applied: true, scenarios };
    if (stressFailed) {
      alerts.push(
        'Prueba de estrés cambiario (depreciación 15% / 25% DOP): capacidad en USD cae por debajo del mínimo sostenible.'
      );
    }
  }

  // --- Determine Final Pre-qualification Status & Sustainable Offer ---
  let status: ScoringStatus = 'PREOFERTA';
  let recommendedAmount = 0;
  let recommendedRateMonthly = riskBand.monthlyRate ?? 0;
  let recommendedTermMonths = 0;
  let recommendedInstallment = 0;
  let sustainablePrincipalAtBandRate = 0;

  if (needsFx && (!dopPerUsd || dopPerUsd <= 0)) {
    status = 'DATOS_INSUFICIENTES_CAMBIO';
    alerts.push('No existe tipo de cambio configurado válido para normalizar ingresos a la moneda del crédito.');
  } else if (debtDataMissing) {
    status = 'DATOS_INSUFICIENTES_DEUDA';
    alerts.push('Falta declaración o detalle cuantificado de obligaciones de deuda.');
  } else if (
    primaryIncomeOrig === null ||
    primaryIncomeOrig === undefined ||
    primaryIncomeOrig <= 0 ||
    fin.essentialExpenses === null ||
    fin.essentialExpenses === undefined ||
    (isBusiness && (!bizFin || bizFin.netMonthlyFlow === null || bizFin.netMonthlyFlow === undefined))
  ) {
    status = 'DATOS_INSUFICIENTES';
    alerts.push('Faltan datos financieros esenciales para determinar la capacidad de pago.');
  } else if (
    application.requestedAmount < product.minAmount ||
    application.requestedAmount > product.maxAmount ||
    application.requestedTermMonths < product.minTermMonths ||
    application.requestedTermMonths > product.maxTermMonths ||
    product.currency !== loanCurrency
  ) {
    status = 'SOLICITUD_FUERA_POLITICA';
    if (application.requestedAmount < product.minAmount) {
      alerts.push(`Monto solicitado (${fmtMoney(application.requestedAmount, loanCurrency)}) es inferior al mínimo del producto (${fmtMoney(product.minAmount, loanCurrency)}).`);
    }
    if (application.requestedAmount > product.maxAmount) {
      alerts.push(`Monto solicitado (${fmtMoney(application.requestedAmount, loanCurrency)}) supera el máximo absoluto del producto (${fmtMoney(product.maxAmount, loanCurrency)}).`);
    }
    if (
      application.requestedTermMonths < product.minTermMonths ||
      application.requestedTermMonths > product.maxTermMonths
    ) {
      alerts.push(
        `Plazo solicitado (${application.requestedTermMonths} meses) está fuera del rango permitido (${product.minTermMonths}–${product.maxTermMonths} meses).`
      );
    }
  } else if (
    riskBand.code === 'CRITICO' ||
    riskBand.monthlyRate === null ||
    totalScore <=
      normalizeWorkflowThresholds(policy.workflowConfig?.decisionThresholds).autoRejectMaxScore
  ) {
    const autoRejectMax = normalizeWorkflowThresholds(
      policy.workflowConfig?.decisionThresholds
    ).autoRejectMaxScore;
    status = 'SIN_OFERTA';
    alerts.push(
      `Score ${totalScore}/100 dentro del umbral de rechazo automático (≤ ${autoRejectMax} pts) o banda Crítico: sin oferta automática.`
    );
  } else if (loanCurrency === 'USD' && incomeCurrency === 'DOP' && stressFailed && policy.exchangeRateConfig.blockUsdOnStressFailure) {
    status = 'SIN_OFERTA_CAPACIDAD';
    alerts.push('Preoferta automática USD bloqueada por insuficiencia bajo escenario de estrés cambiario.');
  } else {
    // Score >= 50 and within product limits: Step 6 — Recalculate sustainable offer at band rate
    // Never increase requested term! Cap at band maxTermMonths if requestedTerm > band.maxTermMonths.
    recommendedTermMonths = Math.min(application.requestedTermMonths, riskBand.maxTermMonths);
    if (application.requestedTermMonths > riskBand.maxTermMonths) {
      alerts.push(
        `Plazo solicitado (${application.requestedTermMonths} meses) ajustado al máximo de la banda ${riskBand.label} (${riskBand.maxTermMonths} meses).`
      );
    }
    const r = riskBand.monthlyRate;
    const n = recommendedTermMonths;
    sustainablePrincipalAtBandRate =
      maxInstallmentAllowed > 0 && n > 0
        ? fromCents(Math.floor(toCents((maxInstallmentAllowed * (1 - Math.pow(1 + r, -n))) / r)))
        : 0;

    const bandCap = product.bandCaps[riskBand.code as RiskBandCode] ?? 0;
    const rawRecommended = Math.min(
      application.requestedAmount,
      bandCap,
      product.maxAmount,
      sustainablePrincipalAtBandRate
    );
    recommendedAmount = fromCents(Math.floor(toCents(rawRecommended)));

    if (recommendedAmount < product.minAmount || maxInstallmentAllowed <= 0) {
      status = 'SIN_OFERTA_CAPACIDAD';
      recommendedAmount = 0;
      recommendedInstallment = 0;
      alerts.push(
        `Capital sostenible (${fmtMoney(sustainablePrincipalAtBandRate, loanCurrency)}) es inferior al mínimo del producto (${fmtMoney(product.minAmount, loanCurrency)}).`
      );
    } else {
      status = 'PREOFERTA';
      recommendedInstallment = calculateMonthlyInstallment(recommendedAmount, r, n);
      if (recommendedAmount < application.requestedAmount) {
        alerts.push(
          `Monto recomendado ajustado a ${fmtMoney(recommendedAmount, loanCurrency)} por límite de capacidad de pago o tope de banda.`
        );
      }
      const wfThresholds = normalizeWorkflowThresholds(policy.workflowConfig?.decisionThresholds);
      const maxFastTrackAmt =
        loanCurrency === 'USD'
          ? wfThresholds.maxAutoApproveAmountUsd
          : wfThresholds.maxAutoApproveAmountDop;
      if (
        wfThresholds.enableFastTrackAutoApproval &&
        totalScore >= wfThresholds.autoApproveMinScore &&
        recommendedAmount <= maxFastTrackAmt
      ) {
        favorableFactors.push(
          `Elegible para flujo Fast-Track / Pre-Aprobación Directa (Score ${totalScore} ≥ ${wfThresholds.autoApproveMinScore} pts).`
        );
      }
    }
  }

  const projectedDti =
    eligibleIncome > 0
      ? (currentDebtPayments + recommendedInstallment) / eligibleIncome
      : 1;

  const capacityResult: CapacityResult = {
    eligibleIncome,
    essentialExpenses: essentialExpensesTotal,
    currentDebtPayments,
    availableFlow,
    currentDti,
    projectedDti,
    maxInstallmentAllowed,
    simulatedReferenceInstallment: simulatedRefInstallment,
    simulatedReferenceCoverage: Number(simulatedRefCoverage.toFixed(4)),
    sustainablePrincipalAtBandRate,
    incomeCurrency,
    loanCurrency,
    exchangeRateUsed: needsFx ? dopPerUsd : 1,
  };

  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    organizationId: application.organizationId,
    applicationId: application.id,
    policyId: policy.id,
    policyVersion: policy.version,
    policyStatus: policy.status,
    executionTrigger: input.executionTrigger,
    inputSnapshot: {
      applicantType: application.applicantType,
      productCode: application.productCode,
      currency: application.currency,
      requestedAmount: application.requestedAmount,
      requestedTermMonths: application.requestedTermMonths,
      financialData: fin,
      businessFinancialData: bizFin ?? null,
      useVerifiedData: Boolean(input.useVerifiedData),
    },
    capacityResult,
    totalScore,
    riskBand,
    status,
    recommendedAmount,
    recommendedRateMonthly,
    recommendedTermMonths,
    recommendedInstallment,
    favorableFactors,
    alerts,
    missingData,
    currencyStressResults,
    indicatorDetails: indicators,
    executedBy: input.executedBy,
    executedByName: input.executedByName ?? input.executedBy,
  };
}

function buildErrorResult(
  input: EngineEvaluationInput,
  message: string
): Omit<ScoringExecutionRecord, 'executedAt'> {
  return {
    id: `exec_err_${Date.now()}`,
    organizationId: input.application.organizationId,
    applicationId: input.application.id,
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    policyStatus: input.policy.status,
    executionTrigger: input.executionTrigger,
    inputSnapshot: {},
    capacityResult: {
      eligibleIncome: 0,
      essentialExpenses: 0,
      currentDebtPayments: 0,
      availableFlow: 0,
      currentDti: 0,
      projectedDti: 0,
      maxInstallmentAllowed: 0,
      simulatedReferenceInstallment: 0,
      simulatedReferenceCoverage: 0,
      sustainablePrincipalAtBandRate: 0,
      incomeCurrency: input.application.financialData.incomeCurrency,
      loanCurrency: input.application.currency,
      exchangeRateUsed: null,
    },
    totalScore: 0,
    riskBand: {
      code: 'CRITICO',
      label: 'Crítico',
      minScore: 0,
      maxScore: 49,
      monthlyRate: null,
      minTermMonths: 0,
      maxTermMonths: 0,
    },
    status: 'ERROR_CALCULO',
    recommendedAmount: 0,
    recommendedRateMonthly: 0,
    recommendedTermMonths: 0,
    recommendedInstallment: 0,
    favorableFactors: [],
    alerts: [message],
    missingData: [],
    currencyStressResults: null,
    indicatorDetails: [],
    executedBy: input.executedBy,
    executedByName: input.executedByName ?? input.executedBy,
  };
}
