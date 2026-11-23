import type {
  CurrencyCode,
  PaymentFrequency,
  ProductCode,
  UserRole,
} from './axycore';

export type ImpulsaOpportunityCategory =
  | 'RENOVACION_ANTICIPADA'
  | 'EXCELENTE_COMPORTAMIENTO'
  | 'CRECIMIENTO_CREDITICIO'
  | 'PAGO_ANTICIPADO'
  | 'CLIENTE_INACTIVO'
  | 'NUEVO_PRODUCTO'
  | 'REFINANCIAMIENTO_RESPONSABLE';

export const IMPULSA_CATEGORY_LABELS: Record<ImpulsaOpportunityCategory, string> = {
  RENOVACION_ANTICIPADA: 'Renovación Anticipada',
  EXCELENTE_COMPORTAMIENTO: 'Excelente Comportamiento',
  CRECIMIENTO_CREDITICIO: 'Crecimiento Crediticio',
  PAGO_ANTICIPADO: 'Pagos Anticipados',
  CLIENTE_INACTIVO: 'Cliente Antiguo Inactivo',
  NUEVO_PRODUCTO: 'Nuevo Producto',
  REFINANCIAMIENTO_RESPONSABLE: 'Refinanciamiento Responsable',
};

export type ImpulsaPriority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export const IMPULSA_PRIORITY_LABELS: Record<ImpulsaPriority, string> = {
  CRITICA: 'Crítica',
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};

export type ImpulsaOpportunityStatus =
  | 'DETECTADA'
  | 'PENDIENTE_ASIGNACION'
  | 'ASIGNADA'
  | 'PENDIENTE_CONTACTO'
  | 'CONTACTADA'
  | 'CLIENTE_INTERESADO'
  | 'NO_INTERESADO'
  | 'PENDIENTE_DOCUMENTACION'
  | 'CONVERTIDA_SOLICITUD'
  | 'EN_EVALUACION'
  | 'APROBADA'
  | 'DESEMBOLSADA'
  | 'DESCARTADA'
  | 'REPROGRAMADA';

export const IMPULSA_ALL_STATUSES: ImpulsaOpportunityStatus[] = [
  'DETECTADA',
  'PENDIENTE_ASIGNACION',
  'ASIGNADA',
  'PENDIENTE_CONTACTO',
  'CONTACTADA',
  'CLIENTE_INTERESADO',
  'NO_INTERESADO',
  'PENDIENTE_DOCUMENTACION',
  'CONVERTIDA_SOLICITUD',
  'EN_EVALUACION',
  'APROBADA',
  'DESEMBOLSADA',
  'DESCARTADA',
  'REPROGRAMADA',
];

export const IMPULSA_STATUS_LABELS: Record<ImpulsaOpportunityStatus, string> = {
  DETECTADA: 'Detectada',
  PENDIENTE_ASIGNACION: 'Pendiente de asignación',
  ASIGNADA: 'Asignada',
  PENDIENTE_CONTACTO: 'Pendiente de contacto',
  CONTACTADA: 'Contactada',
  CLIENTE_INTERESADO: 'Cliente interesado',
  NO_INTERESADO: 'No interesado',
  PENDIENTE_DOCUMENTACION: 'Pendiente documentación',
  CONVERTIDA_SOLICITUD: 'Convertida a solicitud',
  EN_EVALUACION: 'En evaluación',
  APROBADA: 'Aprobada',
  DESEMBOLSADA: 'Desembolsada',
  DESCARTADA: 'Descartada',
  REPROGRAMADA: 'Reprogramada',
};

export type ImpulsaContactChannel =
  | 'LLAMADA'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'VISITA_OFICINA'
  | 'VISITA_CAMPO'
  | 'INTERNO';

export interface ImpulsaEvidenceMetric {
  label: string;
  value: string;
  source: string;
}

export interface ImpulsaRiskSignal {
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  source: 'CENTINELA' | 'COBRANZA' | 'POLITICA' | 'CAPACIDAD' | 'SOLICITUD';
  detail: string;
}

export interface ImpulsaFollowUpEntry {
  id: string;
  timestampIso: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  channel: ImpulsaContactChannel;
  previousStatus: ImpulsaOpportunityStatus;
  newStatus: ImpulsaOpportunityStatus;
  outcome: string;
  comment: string;
  nextFollowUpDate?: string | null;
}

export interface ImpulsaOpportunityRecord {
  id: string;
  organizationId: string;
  opportunityCode: string;
  sourceKey: string; // Deterministic dedup key
  customerId: string;
  customerName: string;
  customerDocument?: string;
  customerPhone?: string;
  customerEmail?: string;
  branchOrProvince: string;
  category: ImpulsaOpportunityCategory;
  priority: ImpulsaPriority;
  priorityScore: number; // 0..100 comercial priority
  commercialConversionProbability: number; // 0..100 (explicitly NOT credit approval probability)
  confidenceScore: number; // 0..100 data completeness confidence
  status: ImpulsaOpportunityStatus;

  // Source loan / history context
  sourceLoanId?: string | null;
  sourceLoanNumber?: string | null;
  sourceProductCode?: ProductCode | null;
  currency: CurrencyCode;
  currentLoanBalance: number;
  previousPrincipalAmount: number;
  paidPrincipalAmount: number;
  remainingInstallments: number;
  totalInstallments: number;
  estimatedMaturityDate?: string | null;
  currentDpd: number;
  maxHistoricalDpd: number;
  earlyPaymentsCount: number;
  completedLoansCount: number;
  daysSinceLastClosedLoan?: number | null;
  latestBehaviorScore?: number | null;
  latestOriginationScore?: number | null;

  // Explainable recommendation (respecting active policy & capacity)
  recommendedProductCode: ProductCode;
  recommendedProductLabel: string;
  suggestedAmount: number;
  suggestedTermMonths: number;
  suggestedFrequency: PaymentFrequency;
  estimatedMonthlyRatePct: number;
  estimatedInstallment: number;
  estimatedNetProfit: number; // Estimated gross interest margin over term
  estimatedPaymentCapacity: number; // Monthly available flow
  estimatedCurrentDtiPct?: number | null;
  estimatedProjectedDtiPct?: number | null;
  policyCompliant: boolean;
  policyNotes: string[];

  // Explainability dossier
  summaryReason: string;
  detailedReasons: string[];
  evidenceMetrics: ImpulsaEvidenceMetric[];
  risksIdentified: ImpulsaRiskSignal[];
  centinelaAlertsCount: number;
  nextRecommendedAction: string;
  creditApprovalDisclaimer: string;

  // CRM Management & Ownership
  assignedOfficerId?: string | null;
  assignedOfficerName?: string | null;
  assignedAtIso?: string | null;
  assignedBy?: string | null;
  assignmentLockReason?: string | null;
  lastContactAtIso?: string | null;
  lastOutcome?: string | null;
  nextFollowUpDate?: string | null; // YYYY-MM-DD
  windowExpiresAtIso?: string | null; // Commercial opportunity window
  followUpHistory: ImpulsaFollowUpEntry[];

  // Real AxyCore Application / Loan linkage
  linkedApplicationId?: string | null;
  linkedApplicationNumber?: string | null;
  linkedApplicationStatus?: string | null;
  linkedLoanId?: string | null;
  linkedLoanNumber?: string | null;
  disbursedAmount?: number | null;
  convertedAtIso?: string | null;
  convertedBy?: string | null;

  detectedAtIso: string;
  lastEvaluatedAtIso: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ImpulsaAutomationFrequency = 'MANUAL' | 'DIARIA' | 'SEMANAL' | 'QUINCENAL';

export type ImpulsaAssignmentStrategy =
  | 'MANUAL_ONLY'
  | 'LOAN_OWNER_FIRST'
  | 'ROUND_ROBIN_OFFICERS';

export interface ImpulsaEngineRunLog {
  id: string;
  executedAtIso: string;
  trigger: 'MANUAL' | 'PROGRAMADO';
  actorId: string;
  actorName: string;
  customersAnalyzed: number;
  loansAnalyzed: number;
  detectedTotal: number;
  createdCount: number;
  updatedCount: number;
  reconciledCount: number;
  autoAssignedCount: number;
  skippedByRiskCount: number;
  durationMs: number;
}

export interface ImpulsaEngineConfig {
  id: string; // organizationId
  organizationId: string;
  enabled: boolean;
  frequency: ImpulsaAutomationFrequency;
  assignmentStrategy: ImpulsaAssignmentStrategy;
  // Detection thresholds
  earlyRenewalMaxRemainingInstallments: number; // default 3
  earlyRenewalMinPaidRatioPct: number; // default 65
  earlyRenewalMaxDpd: number; // default 5
  excellentBehaviorMinPaidInstallments: number; // default 3
  excellentBehaviorMaxHistoricalDpd: number; // default 5
  growthMinPaidRatioPct: number; // default 40
  growthMaxIncreaseFactor: number; // default 1.35 (35% max step-up bounded by capacity & policy)
  earlyPaymentMinCount: number; // default 2
  inactiveMinDaysSinceClose: number; // default 20
  inactiveMaxHistoricalDpd: number; // default 15
  refinancingMinDpd: number; // default 1
  refinancingMaxDpd: number; // default 45 (never mask chronic default)
  refinancingMinPaidRatioPct: number; // default 20
  // Operational SLA & Alerts
  unmanagedAlertHours: number; // default 48
  opportunityWindowDays: number; // default 30
  blockCommercialOffersOnCriticalCentinela: boolean; // default true
  notifyInternalAlerts: boolean; // default true
  requireExplicitConsentForExternalContact: boolean; // always true
  lastRunAtIso?: string | null;
  recentRuns: ImpulsaEngineRunLog[];
  updatedBy: string;
  updatedByName?: string;
  updatedAt?: unknown;
}

export interface ImpulsaInternalAlert {
  id: string;
  opportunityId: string;
  opportunityCode: string;
  customerName: string;
  severity: 'CRITICA' | 'ALTA' | 'MEDIA';
  type:
    | 'NUEVA_OPORTUNIDAD'
    | 'SIN_GESTIONAR_SLA'
    | 'VENTANA_POR_VENCER'
    | 'SEGUIMIENTO_HOY_O_VENCIDO'
    | 'ALERTA_CENTINELA_ACTIVA';
  title: string;
  detail: string;
  assignedOfficerName?: string | null;
  dueDate?: string | null;
}

export interface ImpulsaCommercialMetrics {
  totalOpportunities: number;
  newOpportunities: number;
  pendingManagement: number;
  contactedOpportunities: number;
  interestedClients: number;
  applicationsGenerated: number;
  applicationsInEvaluation: number;
  approvedCredits: number;
  disbursedCredits: number;
  discardedOrNotInterested: number;
  potentialPlacementAmountDop: number;
  disbursedAmountDop: number;
  conversionRatePct: number; // Disbursed / Total actionable
  applicationConversionRatePct: number; // Converted to application / Total
  estimatedProfitabilityDop: number;
  averageTicketDop: number;
  activeCriticalCount: number;
  activeHighCount: number;
  unassignedCount: number;
  overdueFollowUpsCount: number;
}

export interface ImpulsaChartDatasets {
  evolutionByMonth: Array<{
    month: string;
    detectadas: number;
    solicitudes: number;
    desembolsadas: number;
    montoPotencial: number;
    montoDesembolsado: number;
  }>;
  conversionByPeriod: Array<{
    period: string;
    total: number;
    convertidas: number;
    desembolsadas: number;
    tasaConversionPct: number;
  }>;
  byProduct: Array<{
    productCode: string;
    productLabel: string;
    count: number;
    potentialAmount: number;
    disbursedAmount: number;
  }>;
  byBranch: Array<{
    branch: string;
    count: number;
    potentialAmount: number;
    disbursedAmount: number;
  }>;
  byOfficer: Array<{
    officerId: string;
    officerName: string;
    assigned: number;
    contacted: number;
    converted: number;
    disbursed: number;
    potentialAmount: number;
    disbursedAmount: number;
    conversionRatePct: number;
  }>;
  byCategory: Array<{
    category: ImpulsaOpportunityCategory;
    label: string;
    count: number;
    potentialAmount: number;
  }>;
  renewalsVsNewClients: Array<{
    segment: string;
    count: number;
    amount: number;
  }>;
  impulsaPlacementsShare: {
    totalPortfolioLoansCount: number;
    impulsaGeneratedLoansCount: number;
    totalPortfolioAmountDop: number;
    impulsaGeneratedAmountDop: number;
    shareByAmountPct: number;
  };
}

export interface ImpulsaAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestampIso: string;
  modelUsed?: string;
  keyFindings?: string[];
  recommendedActions?: string[];
  citedOpportunities?: Array<{
    id: string;
    code: string;
    customerName: string;
    category: string;
    suggestedAmount: number;
    currency: CurrencyCode;
  }>;
  missingData?: string[];
  isDeterministicFallback?: boolean;
}
