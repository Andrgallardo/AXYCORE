import type {
  AmortizationMethod,
  CurrencyCode,
  LoanRecord,
  PaymentFrequency,
  RiskBandCode,
} from './axycore';
import type { CollectionPriority, CollectionStage } from './collections';

export type AlteraSectionTab =
  | 'home'
  | 'credit_intelligence'
  | 'financial_dna'
  | 'digital_twin'
  | 'alternative_universes'
  | 'preventive_plan_b'
  | 'intervention_lab'
  | 'scenario_simulator'
  | 'recommendations'
  | 'outcome_learning'
  | 'analysis_history'
  | 'config_params';

export type AlteraPriority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export type AlteraRecommendationStatus =
  | 'GENERADA'
  | 'PENDIENTE_REVISION'
  | 'APROBADA'
  | 'RECHAZADA'
  | 'EN_EJECUCION'
  | 'EJECUTADA'
  | 'CERRADA';

export type AlteraInterventionType =
  | 'ABONO_EXTRAORDINARIO'
  | 'CAMBIO_FECHA_PAGO'
  | 'REESTRUCTURACION_PLAZO'
  | 'REDUCCION_TEMPORAL_CUOTA'
  | 'ESTRATEGIA_COBRANZA_PREVENTIVA'
  | 'PAGO_PARCIAL_CONTROLADO';

export type AlteraDeteriorationTrend =
  | 'ESTABLE_SALUDABLE'
  | 'SENAL_TEMPRANA'
  | 'DETERIORO_MODERADO'
  | 'DETERIORO_ACELERADO'
  | 'RECUPERACION_EN_CURSO';

export interface AlteraExplainabilityBlock {
  whatWasDetected: string;
  dataUsed: string[];
  whyRiskOrOpportunityExists: string;
  variablesConsidered: Array<{
    label: string;
    value: string;
    weightOrImpact: string;
  }>;
  alternativesEvaluated: string[];
  whyRecommended: string;
  expectedOutcomeIfNoAction: string;
  confidencePct: number; // 0 - 100
  dataLimitations: string[];
}

export interface AlteraInstallmentPatternSummary {
  totalInstallments: number;
  paidCount: number;
  paidOnTimeCount: number;
  paidLateCount: number;
  partialCount: number;
  overdueCount: number;
  pendingCount: number;
  punctualityRatePct: number;
  avgDelayDaysOnPaid: number;
  maxHistoricalDelayDays: number;
  recent3InstallmentsAvgDelayDays: number;
  previousInstallmentsAvgDelayDays: number;
  behavioralShiftDeltaDays: number; // positivo = empeoramiento reciente
}

export interface AlteraCreditDigitalTwin {
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  productCode: LoanRecord['productCode'];
  loanStatus: LoanRecord['status'];
  collectionStage: CollectionStage;
  dpdCurrent: number;
  principalOriginal: number;
  currentPrincipalBalance: number;
  overduePrincipal: number;
  overdueInterest: number;
  overdueLateFee: number;
  overdueCharges: number;
  totalOverdue: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  contractualRateMonthlyPct: number;
  remainingTermInstallments: number;
  frequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  maturityDate: string;
  disbursementDate: string;
  lastPaymentDate: string | null;
  lastPaymentAmount: number;
  patterns: AlteraInstallmentPatternSummary;
  deteriorationScore: number; // 0 (sano) -> 100 (deterioro severo)
  recoveryProbabilityPct: number; // 0 -> 100
  projected30DayDpd: number;
  projected60DayBalanceAtRisk: number;
  trend: AlteraDeteriorationTrend;
  priority: AlteraPriority;
  signalsDetected: string[];
  recentvsHistoricalSummary: string;
  timelineSeries: Array<{
    periodLabel: string;
    installmentNumber: number;
    scheduledAmount: number;
    paidAmount: number;
    delayDays: number;
    remainingPrincipal: number;
    status: string;
  }>;
  explainability: AlteraExplainabilityBlock;
}

export interface AlteraFinancialDna {
  customerId: string;
  customerName: string;
  documentNumberMasked: string;
  totalLoansCount: number;
  activeLoansCount: number;
  closedLoansCount: number;
  currenciesPresent: CurrencyCode[];
  totalOriginalPrincipalDop: number;
  totalCurrentBalanceDop: number;
  totalPaidAppliedDop: number;
  totalOriginalPrincipalUsd: number;
  totalCurrentBalanceUsd: number;
  totalPaidAppliedUsd: number;
  historicalPunctualityPct: number;
  totalOverdueEpisodes: number;
  brokenPromisesCount: number;
  fulfilledPromisesCount: number;
  agreementsOrRestructuresCount: number;
  openDisputesCount: number;
  // Financial capacity strictly from real Application/Evaluation records (never fabricated)
  incomeDataAvailable: boolean;
  verifiedIncomeCurrency: CurrencyCode | null;
  verifiedMonthlyIncome: number | null;
  verifiedMonthlyExpenses: number | null;
  verifiedExternalDebts: number | null;
  currentScheduledInstallmentsTotal: number;
  estimatedDebtServiceRatioPct: number | null;
  lastOriginationScore: number | null;
  lastOriginationRiskBand: RiskBandCode | null;
  dnaClassification:
    | 'CUMPLIDOR_CONSISTENTE'
    | 'ESTACIONAL_SENSIBLE'
    | 'ESTRÉS_LIQUIDEZ_TEMPRANO'
    | 'REINCIDENTE_RECUPERABLE'
    | 'CRITICO_ALTA_EXPOSICION';
  adaptiveScore: number; // 0-100 salud adaptativa del cliente
  behavioralSignature: string[];
  interpretativeProfile: string;
  dataLimitations: string[];
}

export interface AlteraUniverseParameters {
  interventionType: AlteraInterventionType;
  combineVariables?: boolean;
  extraordinaryPaymentAmount?: number;
  extraordinaryApplyMode?: 'REDUCIR_CUOTA' | 'REDUCIR_PLAZO';
  dueDateShiftDays?: number;
  restructuredTermMonths?: number;
  restructuredMonthlyRatePct?: number;
  temporaryReductionPct?: number;
  temporaryReductionMonths?: number;
  partialPaymentAmount?: number;
  preventiveContactChannel?: 'WHATSAPP' | 'LLAMADA' | 'VISITA_CAMPO' | 'EMAIL';
  includeGraceDaysAdjustment?: number;
}

export interface AlteraUniverseProjectionPoint {
  periodIndex: number;
  label: string;
  remainingBalance: number;
  cumulativePaid: number;
  expectedRecoveryPct: number;
  estimatedRiskScore: number;
  installmentAmount?: number;
  principalPaid?: number;
  interestPaid?: number;
}

export interface AlteraUniverseOutcome {
  universeCode: 'ACTUAL_SIN_INTERVENCION' | 'PREVENTIVO_ANTICIPADO' | 'ALTERNATIVO_CONDICIONES';
  title: string;
  subtitle: string;
  interventionTypeLabel: string;
  conditionsConsidered: string[];
  policyCompliant: boolean;
  policyViolations: string[];
  projectedInstallmentAmount: number;
  projectedTotalPayable: number;
  projectedTotalInterest: number;
  projectedBalanceAtHorizon: number;
  balanceDeltaVsCurrent: number;
  installmentDeltaVsCurrent?: number;
  interestDeltaVsCurrent?: number;
  totalPayableDeltaVsCurrent?: number;
  monthsDeltaVsCurrent?: number;
  projectedNextDueDateIso?: string | null;
  projectedPayoffDateIso?: string;
  projectedRecoveryPct: number;
  recoveryDeltaVsCurrentPct: number;
  estimatedDelinquencyRiskPct: number;
  riskReductionPct: number;
  projectedMonthsToPayoff: number;
  benefits: string[];
  disadvantages: string[];
  projectionSeries: AlteraUniverseProjectionPoint[];
  isAlteraRecommended: boolean;
}

export interface AlteraUniverseComparison {
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  asOfDateIso: string;
  currentBalance: number;
  currentInstallment: number;
  currentMonthlyRatePct: number;
  remainingPeriods: number;
  universes: [AlteraUniverseOutcome, AlteraUniverseOutcome, AlteraUniverseOutcome];
  recommendedUniverseCode: AlteraUniverseOutcome['universeCode'];
  alteraRecommendationHeadline: string;
  alteraRecommendationDetail: string;
  explainability: AlteraExplainabilityBlock;
}

export interface AlteraPreventiveSignal {
  id: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  situationDetected: string;
  evidenceUsed: string[];
  priority: AlteraPriority;
  detectedRisk: string;
  recommendedAction: string;
  suggestedInterventionType: AlteraInterventionType;
  suggestedParams: AlteraUniverseParameters;
  suggestedAssigneeId: string | null;
  suggestedAssigneeName: string;
  suggestedFollowUpDate: string;
  expectedImpactSummary: string;
  deteriorationScore: number;
  confidencePct: number;
  explainability: AlteraExplainabilityBlock;
}

export interface AlteraSavedScenarioRecord {
  id: string;
  organizationId: string;
  title: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  interventionType: AlteraInterventionType;
  parameters: AlteraUniverseParameters;
  recommendedUniverseCode: AlteraUniverseOutcome['universeCode'];
  projectedRecoveryPct: number;
  projectedBalanceDelta: number;
  riskReductionPct: number;
  policyCompliant: boolean;
  confidencePct: number;
  summaryText: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AlteraRecommendationFollowUp {
  timestampIso: string;
  userId: string;
  userName: string;
  userRole: string;
  fromStatus: AlteraRecommendationStatus | 'NUEVA';
  toStatus: AlteraRecommendationStatus;
  notes: string;
}

export interface AlteraRecommendationRecord {
  id: string;
  organizationId: string;
  code: string;
  createdAtIso: string;
  customerId: string;
  customerName: string;
  loanId: string;
  loanNumber: string;
  currency: CurrencyCode;
  category:
    | 'PLAN_B_PREVENTIVO'
    | 'REESTRUCTURACION'
    | 'ABONO_CAPITAL'
    | 'AJUSTE_VENCIMIENTO'
    | 'CONTENCION_COBRANZA'
    | 'OPTIMIZACION_CARTERA';
  interventionType: AlteraInterventionType;
  proposedParams?: AlteraUniverseParameters;
  priority: AlteraPriority;
  status: AlteraRecommendationStatus;
  evidenceSummary: string;
  diagnosis: string;
  proposedAlternative: string;
  expectedImpact: string;
  expectedRecoveryDeltaPct: number;
  expectedBalanceAtHorizon: number;
  confidencePct: number;
  policyCompliant: boolean;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  suggestedFollowUpDate: string;
  decisionByUserId?: string | null;
  decisionByUserName?: string | null;
  decisionNotes?: string | null;
  explainability: AlteraExplainabilityBlock;
  followUpHistory: AlteraRecommendationFollowUp[];
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AlteraOutcomeRecord {
  id: string;
  organizationId: string;
  recommendationId: string;
  recommendationCode: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  interventionType: AlteraInterventionType;
  evaluatedAtIso: string;
  projectedRecoveryPct: number;
  actualRecoveryPct: number;
  projectedBalanceAfter: number;
  actualBalanceAfter: number;
  projectedDaysToRegularize: number;
  actualDaysToRegularize: number;
  commitmentFulfilled: boolean;
  effectivenessScore: number; // 0-100
  calibrationDeltaPct: number;
  learningConclusion: string;
  recommendedWeightAdjustment: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AlteraAnalysisLogRecord {
  id: string;
  organizationId: string;
  analysisType:
    | 'CONSULTA_ALTERA'
    | 'GEMELO_DIGITAL'
    | 'ADN_FINANCIERO'
    | 'UNIVERSOS_ALTERNATIVOS'
    | 'PLAN_B_PREVENTIVO'
    | 'CALIBRACION_RESULTADOS';
  loanId?: string | null;
  loanNumber?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  queryText?: string | null;
  summary: string;
  confidencePct: number;
  actorUid: string;
  actorName: string;
  actorRole: string;
  createdAtIso: string;
  createdAt?: unknown;
}

export interface AlteraConfigRecord {
  id: string; // altera_cfg_${organizationId}
  organizationId: string;
  earlyDeteriorationDelayThresholdDays: number;
  minPunctualityPctForHealthy: number;
  maxRestructureExtensionMonths: number;
  maxTemporaryReductionPct: number;
  maxTemporaryReductionMonths: number;
  maxDueDateShiftDays: number;
  minConfidenceForPriorityAlertPct: number;
  preventiveHorizonDays: number;
  deteriorationWeights: {
    delayTrendWeight: number;
    brokenPromisesWeight: number;
    overdueRatioWeight: number;
    behavioralShiftWeight: number;
  };
  calibrationFactorPct: number; // Ajuste transparente basado en Outcome Learning
  requireHumanApprovalForAllInterventions: true;
  updatedBy: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AlteraQueryEvidenceItem {
  loanId?: string;
  loanNumber?: string;
  customerId?: string;
  customerName?: string;
  metricLabel: string;
  metricValue: string;
  severity: AlteraPriority | 'INFO';
}

export interface AlteraQueryResponse {
  query: string;
  interpretedIntent: string;
  headline: string;
  narrative: string;
  evidenceItems: AlteraQueryEvidenceItem[];
  recommendedNextTab: AlteraSectionTab;
  targetLoanId?: string;
  targetCustomerId?: string;
  explainability: AlteraExplainabilityBlock;
  generatedAtIso: string;
}

export interface AlteraPortfolioIntelligenceSummary {
  asOfDateIso: string;
  totalAnalyzedLoans: number;
  totalAnalyzedCustomers: number;
  activeExposureDop: number;
  activeExposureUsd: number;
  preventiveSignalsCount: number;
  criticalAlertsCount: number;
  pendingRecommendationsCount: number;
  approvedOrExecutingCount: number;
  successfulInterventionsCount: number;
  savedScenariosCount: number;
  averageDeteriorationScore: number;
  averageRecoveryProbabilityPct: number;
  deteriorationDistribution: Array<{
    band: string;
    count: number;
    color: string;
  }>;
  stageExposureSummary: Array<{
    stage: CollectionStage;
    loansCount: number;
    exposureDop: number;
    exposureUsd: number;
    avgDeteriorationScore: number;
  }>;
  dataLimitations: string[];
}
