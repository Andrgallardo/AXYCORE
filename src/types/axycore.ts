export type UserRole =
  | 'ADMIN'
  | 'BUSINESS_OFFICER'
  | 'CREDIT_ANALYST'
  | 'RISK_OFFICER'
  | 'COMMITTEE_MEMBER'
  | 'FORMALIZATION'
  | 'OPERATIONS'
  | 'FINANCE'
  | 'AUDITOR'
  | 'COLLECTION_AGENT'
  | 'SUPERVISOR'
  | 'COLLECTION_COORDINATOR'
  | 'CASHIER'
  | 'MANAGEMENT'
  | 'EXTERNAL_CLIENT';

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  BUSINESS_OFFICER: 'Oficial de Negocios',
  CREDIT_ANALYST: 'Analista de Créditos',
  RISK_OFFICER: 'Oficial de Riesgo',
  COMMITTEE_MEMBER: 'Miembro del Comité',
  FORMALIZATION: 'Formalización',
  OPERATIONS: 'Operaciones',
  FINANCE: 'Finanzas',
  AUDITOR: 'Auditor',
  COLLECTION_AGENT: 'Gestor de Cobranza',
  SUPERVISOR: 'Supervisor de Cobranza',
  COLLECTION_COORDINATOR: 'Coordinador de Cobranza',
  CASHIER: 'Caja',
  MANAGEMENT: 'Gerencia',
  EXTERNAL_CLIENT: 'Cliente Externo',
};

export type NavSectionId =
  | 'dashboard'
  | 'system_guide'
  | 'credit_dashboard'
  | 'intelligence_dashboard'
  | 'director'
  | 'bela'
  | 'new_application'
  | 'loan_calculator'
  | 'applications'
  | 'decision_engine'
  | 'evaluation'
  | 'committee'
  | 'formalization'
  | 'disbursements'
  | 'loans'
  | 'customers'
  | 'customers_active'
  | 'customers_inactive'
  | 'customers_update'
  | 'documents'
  | 'reports'
  | 'policies'
  | 'audit'
  | 'admin_users'
  | 'admin_roles'
  | 'admin_settings'
  | 'admin_risk_bands'
  | 'admin_product_limits'
  | 'admin_approval_matrix'
  | 'admin_workflow'
  | 'intelligence_altera'
  | 'intelligence_impulsa'
  | 'regula'
  | 'system_sitemap'
  | 'cobranza_dashboard'
  | 'cobranza_anticipate'
  | 'cobranza_portfolio'
  | 'cobranza_daily'
  | 'cobranza_urgent'
  | 'cobranza_legal'
  | 'cobranza_my_actions'
  | 'cobranza_actions'
  | 'cobranza_agreements_today'
  | 'cobranza_agreements_broken'
  | 'cobranza_promises'
  | 'cobranza_agenda'
  | 'cobranza_payments'
  | 'cobranza_reconciliation'
  | 'cobranza_unidentified'
  | 'cobranza_contact_center'
  | 'cobranza_bot'
  | 'cobranza_sentinel'
  | 'cobranza_assignment'
  | 'cobranza_reports'
  | 'cobranza_params'
  | 'cobranza_audit'
  | 'accounting'
  | 'accounting_chart_of_accounts'
  | 'accounting_journal_entries'
  | 'accounting_daily_book'
  | 'accounting_general_ledger'
  | 'accounting_receivables'
  | 'accounting_payables'
  | 'accounting_taxes'
  | 'accounting_payment_validation'
  | 'accounting_statements'
  | 'ecf_dashboard'
  | 'ecf_emit'
  | 'ecf_issued'
  | 'ecf_received'
  | 'ecf_credit_notes'
  | 'ecf_debit_notes'
  | 'ecf_dgii_status'
  | 'ecf_void'
  | 'ecf_customers'
  | 'ecf_products'
  | 'ecf_sequences'
  | 'ecf_certificates'
  | 'ecf_config'
  | 'ecf_sandbox'
  | 'ecf_reports'
  | 'ecf_audit'
  | 'register_payment'
  | 'register_expense'
  | 'register_investor'
  | 'platform_control';

export type CreditPermission =
  | 'ORIGINATE_APPLICATION'
  | 'VIEW_INTERNAL_INBOX'
  | 'RUN_SCORING_SIMULATION'
  | 'VERIFY_DOCUMENTS'
  | 'EDIT_VERIFIED_FINANCIALS'
  | 'VERIFY_EVALUATION_CHECKLIST'
  | 'RECALCULATE_SCORING_V2'
  | 'EDIT_EVALUATION_REPORT'
  | 'RISK_SIGN_OFF'
  | 'SUBMIT_TO_COMMITTEE'
  | 'RETURN_APPLICATION_FROM_EVALUATION'
  | 'VIEW_COMMITTEE_QUEUE'
  | 'DECIDE_COMMITTEE'
  | 'FORMALIZE_LOAN'
  | 'EXECUTE_DISBURSEMENT'
  | 'VIEW_REPORTS_AND_EXPORT'
  | 'VIEW_AUDIT_LOGS'
  | 'MANAGE_POLICIES_AND_RBAC'
  | 'VIEW_COLLECTIONS_PORTFOLIO'
  | 'LOG_COLLECTION_ACTIONS'
  | 'MANAGE_PROMISES'
  | 'REPORT_PAYMENTS'
  | 'VERIFY_AND_APPLY_PAYMENTS'
  | 'RECONCILE_BANK_TRANSACTIONS'
  | 'REVERSE_PAYMENTS'
  | 'ASSIGN_COLLECTIONS_PORTFOLIO'
  | 'MANAGE_COLLECTION_BOT'
  | 'RESOLVE_DISPUTES_AND_AGREEMENTS'
  | 'CLOSE_CANCEL_LOAN'
  | 'MANAGE_COLLECTION_POLICIES'
  | 'VIEW_ECF'
  | 'EMIT_ECF'
  | 'VOID_ECF'
  | 'MANAGE_ECF_SEQUENCES'
  | 'MANAGE_ECF_CERTIFICATES'
  | 'MANAGE_DGII_CONFIG'
  | 'VALIDATE_RECEIVED_ECF'
  | 'EXPORT_FISCAL_REPORTS'
  | 'VIEW_ALTERA'
  | 'SIMULATE_ALTERA'
  | 'PROPOSE_ALTERA_INTERVENTION'
  | 'APPROVE_ALTERA_INTERVENTION'
  | 'MANAGE_ALTERA_CONFIG'
  | 'VIEW_REGULA'
  | 'MANAGE_REGULA'
  | 'APPROVE_REGULA'
  | 'CONFIGURE_REGULA'
  | 'USE_REGULA_AI';

export type RiskOpinionStatus = 'PENDIENTE' | 'CONFORME' | 'CON_OBSERVACIONES' | 'RECHAZO_RIESGO';

export type CurrencyCode = 'DOP' | 'USD';
export type ProductCode = 'PERSONAL_DOP' | 'EMPRESARIAL_DOP' | 'PERSONAL_USD' | 'EMPRESARIAL_USD';
export type ChannelType = 'INTERNAL' | 'EXTERNAL';
export type ApplicantType = 'INDIVIDUAL' | 'BUSINESS';
export type PaymentFrequency = 'DIARIA' | 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';
export type AmortizationMethod = 'SALDO_INSOLUTO' | 'INTERES_FIJO';
export type LegalFeeApplicationMode = 'DESCONTAR_DESEMBOLSO' | 'FINANCIAR';
export type FinancialAnalysisStatus = 'VIGENTE' | 'HISTORICO' | 'APROBADO_EVALUACION' | 'RECHAZADO';
export type FinancialAnalysisType =
  | 'SOLICITUD_INICIAL'
  | 'REEVALUACION_HUMANA'
  | 'AJUSTE_EVALUACION'
  | 'ACTUALIZACION_DATOS';
export type DecisionQualificationStatus =
  | 'CALIFICA_AUTO_EVALUACION'
  | 'REQUIERE_INTERVENCION_HUMANA'
  | 'REEVALUADA_APROBADA_EVALUACION'
  | 'DATOS_INSUFICIENTES';
export type InstallmentStageCode = 'SOLO_INTERESES' | 'NORMAL';

export type ApplicationStatus =
  | 'BORRADOR'
  | 'RECIBIDA'
  | 'EN_EVALUACION'
  | 'EN_COMITE'
  | 'APROBADA'
  | 'APROBADA_CONDICIONADA'
  | 'DEVUELTA'
  | 'RECHAZADA'
  | 'FORMALIZADA'
  | 'DESEMBOLSADA';

export type ScoringStatus =
  | 'PREOFERTA'
  | 'SIN_OFERTA'
  | 'SIN_OFERTA_CAPACIDAD'
  | 'DATOS_INSUFICIENTES'
  | 'DATOS_INSUFICIENTES_DEUDA'
  | 'DATOS_INSUFICIENTES_CAMBIO'
  | 'SOLICITUD_FUERA_POLITICA'
  | 'ERROR_CALCULO';

export type RiskBandCode = 'MUY_BAJO' | 'BAJO' | 'MODERADO' | 'MEDIO_ALTO' | 'ALTO' | 'CRITICO';

export type HousingType = 'PROPIA' | 'ALQUILADA' | 'FAMILIAR' | 'OTRA' | 'NO_DECLARADA';
export type IncomeSourceType = 'FIJA_RECURRENTE' | 'MIXTA_RECURRENTE' | 'IRREGULAR' | 'SIN_INGRESOS';
export type AdditionalIncomeStatus = 'EXPLICIT_NONE' | 'QUANTIFIED' | 'PARTIAL' | 'INCONSISTENT';
export type DebtDeclarationStatus = 'HAS_DEBTS' | 'NO_DEBTS_EXPLICIT' | 'UNDECLARED';
export type SocialMediaStatus = 'YES' | 'NO_MEDIA' | 'UNANSWERED';

export type TenantStatus =
  | 'ACTIVA'
  | 'SUSPENDIDA'
  | 'INACTIVA'
  | 'PRUEBA'
  | 'EN_REVISION'
  | 'DESACTIVADA'
  | 'PENDIENTE';

export type LicenseStatus =
  | 'PENDIENTE'
  | 'ACTIVA'
  | 'PROXIMA_A_VENCER'
  | 'VENCIDA'
  | 'SUSPENDIDA'
  | 'CANCELADA';

export type CommercialPlanCode =
  | 'BASICO'
  | 'PROFESIONAL'
  | 'EMPRESARIAL'
  | 'CORPORATIVO'
  | 'PERSONALIZADO';

export type GranularActionPermission =
  | 'CONSULTAR'
  | 'CREAR'
  | 'EDITAR'
  | 'APROBAR'
  | 'ELIMINAR'
  | 'EXPORTAR'
  | 'ADMINISTRAR';

export type AxyCoreModuleCategory =
  | 'FINANCIEROS'
  | 'EMPRESARIALES'
  | 'INTELIGENCIA_AUTOMATIZACION';

export type AxyCoreModuleCode =
  // MÓDULOS FINANCIEROS (13)
  | 'clientes'
  | 'prestamos'
  | 'motor_decisiones'
  | 'evaluacion_crediticia'
  | 'comite_credito'
  | 'formalizacion'
  | 'desembolsos'
  | 'cobranza'
  | 'pagos'
  | 'conciliacion_bancaria'
  | 'finanzas'
  | 'contabilidad'
  | 'facturacion_electronica'
  // MÓDULOS EMPRESARIALES (11)
  | 'crm'
  | 'ventas'
  | 'inventario'
  | 'compras'
  | 'proveedores'
  | 'facturacion'
  | 'recursos_humanos'
  | 'gestion_documental'
  | 'proyectos'
  | 'servicios'
  | 'contact_center'
  // INTELIGENCIA Y AUTOMATIZACIÓN (10)
  | 'axycore_director'
  | 'bela'
  | 'axyrecovery_bot'
  | 'centinela'
  | 'anticipate'
  | 'impulsa'
  | 'altera'
  | 'regula'
  | 'analitica_reportes'
  | 'automatizaciones'
  | 'inteligencia_artificial';

export type PortalAccessMode = 'axycore_admin' | 'corporate' | 'client';

export interface OrganizationRecord {
  id: string;
  organizationId?: string;
  tenantId?: string;
  tenant_id?: string;
  accessCode?: string;
  name: string;
  legalName?: string;
  tradeName?: string;
  taxId?: string;
  rnc?: string;
  logoUrl?: string;
  country?: string;
  province?: string;
  city?: string;
  address?: string;
  phone?: string;
  corporateEmail?: string;
  currency?: CurrencyCode;
  timezone?: string;
  status?: TenantStatus;
  onboardingDate?: string;
  planCode?: CommercialPlanCode;
  licenseId?: string;
  licenseStatus?: LicenseStatus;
  licenseStartDate?: string;
  licenseEndDate?: string;
  maxUsers?: number;
  enabledModules?: AxyCoreModuleCode[];
  modulesEnabled?: AxyCoreModuleCode[];
  primaryAdminUid?: string;
  primaryAdminName?: string;
  primaryAdminEmail?: string;
  primaryAdminPhone?: string;
  notes?: string;
  primaryColor?: string;
  accentColor?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'INVITED';
export type InvitationStatus = 'INVITACION_ENVIADA' | 'ENVIADA' | 'CONFIRMADA' | 'PENDIENTE';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string;
  status: UserStatus;
  isSuperAdmin?: boolean;
  invitationId?: string;
  invitationStatus?: InvitationStatus;
  invitedBy?: string;
  invitedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type UserInvitationRecordStatus = 'INVITACION_ENVIADA' | 'ACCEPTED' | 'REVOKED';

export interface UserInvitationRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string;
  organizationName?: string;
  accessCode?: string;
  status: UserInvitationRecordStatus;
  invitedBy: string;
  invitedByEmail?: string;
  invitedAt: string;
  invitationLink?: string;
  authStatus?: string;
  emailDeliveryChannel?: string;
  acceptedUid?: string;
  acceptedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CustomerRecord {
  id: string;
  organizationId: string;
  documentType: 'CEDULA' | 'PASAPORTE';
  documentNumber: string;
  documentKey: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  nationality?: string;
  maritalStatus?: string;
  phone: string;
  altPhone?: string;
  email?: string;
  address?: string;
  municipality?: string;
  province?: string;
  residenceMonths?: number;
  housingType?: HousingType;
  housingPayment?: number;
  socialMediaDeclared?: SocialMediaStatus;
  socialMediaHandle?: string;
  altContactName?: string;
  altContactPhone?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BusinessRecord {
  id: string;
  organizationId: string;
  rnc: string;
  rncKey: string;
  legalName: string;
  tradeName?: string;
  companyType?: string;
  economicActivity?: string;
  operationsStartDate?: string;
  authorizedRepName: string;
  authorizedRepDoc?: string;
  corporateDocsSummary?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReferenceItem {
  name: string;
  relationship: string;
  phone: string;
  verified?: boolean;
  verificationNotes?: string;
}

export interface IndividualFinancialInput {
  activityType?: string;
  employerOrBusinessName?: string;
  occupationOrRole?: string;
  employmentMonths?: number | null;
  incomeSourceType?: IncomeSourceType;
  primaryNetIncome?: number | null;
  additionalIncomeStatus?: AdditionalIncomeStatus;
  additionalNetIncome?: number | null;
  declaredTotalMonthlyIncome?: number | null;
  incomeCurrency: CurrencyCode;
  essentialExpenses?: number | null;
  housingPayment?: number | null;
  housingIncludedInExpenses?: boolean;
  debtDeclarationStatus: DebtDeclarationStatus;
  debtCount?: number | null;
  totalDebtBalance?: number | null;
  currentDebtPayments?: number | null;
  bankDebtPayment?: number | null;
  financeDebtPayment?: number | null;
  cardDebtPayment?: number | null;
  informalDebtPayment?: number | null;
  otherDebtPayment?: number | null;
}

export interface BusinessFinancialInput {
  grossSales?: number | null;
  operatingCosts?: number | null;
  netMonthlyFlow?: number | null;
  businessObligationsMonthly?: number | null;
  totalBusinessDebtBalance?: number | null;
  businessDebtCount?: number | null;
  repaymentSource?: string;
  operationsMonths?: number | null;
  incomeCurrency: CurrencyCode;
  debtDeclarationStatus: DebtDeclarationStatus;
}

export interface DeclaredDocumentsSummary {
  hasIdentityDoc: boolean;
  hasIncomeEvidence: boolean;
  hasAddressProof?: boolean;
  hasCorporateDocs?: boolean;
}

export interface ApplicationFieldChange {
  field: string;
  label: string;
  category: 'BASICO' | 'FINANCIERO' | 'CLIENTE' | 'REFERENCIAS';
  previousValue: string;
  newValue: string;
}

export interface MovementHistoryEntry {
  timestamp: string;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  userId: string;
  userName: string;
  userRole?: string;
  note?: string;
  changes?: ApplicationFieldChange[];
}

export interface ApplicationRecord {
  id: string;
  organizationId: string;
  applicationNumber: string;
  fileNumber: string;
  channel: ChannelType;
  applicantType: ApplicantType;
  customerId: string;
  businessId?: string | null;
  applicantDisplayName: string;
  productCode: ProductCode;
  currency: CurrencyCode;
  requestedAmount: number;
  requestedTermMonths: number;
  paymentFrequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  loanPurpose?: string;
  loanPurposeDescription?: string;
  proposedCollateral?: string;
  financialData: IndividualFinancialInput;
  businessFinancialData?: BusinessFinancialInput | null;
  verifiedFinancialData?: IndividualFinancialInput | null;
  verifiedBusinessFinancialData?: BusinessFinancialInput | null;
  references: ReferenceItem[];
  declaredDocumentsSummary: DeclaredDocumentsSummary;
  status: ApplicationStatus;
  prequalificationStatus?: ScoringStatus;
  latestScoringExecutionId?: string | null;
  latestScore?: number | null;
  latestRiskBand?: string | null;
  recommendedAmount?: number | null;
  recommendedRateMonthly?: number | null;
  recommendedTermMonths?: number | null;
  recommendedInstallment?: number | null;
  consentVersion?: string;
  consentAcceptedAt?: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
  authorizedAlternateAmount?: number | null;
  alternateAmountAuthorizedBy?: string | null;
  originalRequestedConditions?: CreditConditionsSnapshot | null;
  activeFinancialAnalysisId?: string | null;
  approvedEvaluationAnalysisId?: string | null;
  requiresHumanIntervention?: boolean;
  decisionQualificationStatus?: DecisionQualificationStatus | null;
  financialAnalysisVersion?: number | null;
  legalFeeMode?: LegalFeeApplicationMode;
  interestOnlyPeriods?: number;
  installmentCount?: number;
  movementHistory?: MovementHistoryEntry[];
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreditConditionsSnapshot {
  currency: CurrencyCode;
  requestedAmount: number;
  termMonths: number;
  installmentCount: number;
  paymentFrequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  monthlyRatePct: number;
  monthlyRateDecimal: number;
  rateSource: 'AUTOMATICA_ESCALA' | 'MOTOR_V2_BANDA' | 'PERSONALIZADA';
  legalFeesAmount: number;
  legalFeeMode: LegalFeeApplicationMode;
  interestOnlyPeriods: number;
  disbursementDate: string;
}

export interface DecisionRuleEvaluationItem {
  code: string;
  label: string;
  passed: boolean;
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
  detail: string;
}

export interface ExchangeRateAuditMetadata {
  applied: boolean;
  currencyPair: 'USD/DOP';
  sellRate: number;
  source: string;
  rateDate: string;
  obtainedAtIso: string;
  isAutomaticBcrd: boolean;
  isFallback: boolean;
  fallbackReason?: string | null;
  manualOverrideBy?: string | null;
  manualOverrideByName?: string | null;
}

export interface FinancialAnalysisInstallmentPreviewRow {
  numero: number;
  fecha: string;
  etapa: InstallmentStageCode;
  capital: number;
  interes: number;
  cuota: number;
  balance: number;
  dopCuota?: number | null;
}

export interface FinancialAnalysisInstallmentRecord {
  id: string;
  analysisId: string;
  applicationId: string;
  organizationId: string;
  installmentNumber: number;
  dueDate: string;
  stage: InstallmentStageCode;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  remainingBalance: number;
  dopEquivalent?: {
    capital: number;
    interes: number;
    cuota: number;
    balance: number;
  } | null;
  createdAt?: unknown;
}

export interface FinancialAnalysisRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  scoringExecutionId: string | null;
  idempotencyKey: string;
  version: number;
  analysisType: FinancialAnalysisType;
  status: FinancialAnalysisStatus;
  originalRequestedConditions: CreditConditionsSnapshot;
  calculatedConditions: CreditConditionsSnapshot;
  decisionSummary: {
    score: number;
    riskBandCode: RiskBandCode;
    riskBandLabel: string;
    scoringStatus: ScoringStatus;
    qualifiesForRequested: boolean;
    qualifiesForCalculated: boolean;
    requiresHumanIntervention: boolean;
    verdict: string;
    explanation: string;
    rulesPassed: DecisionRuleEvaluationItem[];
    rulesFailed: DecisionRuleEvaluationItem[];
    failureReasons: string[];
    missingData: string[];
    recommendedAlternative: {
      amount: number;
      termMonths: number;
      installmentCount: number;
      monthlyRatePct: number;
      frequency: PaymentFrequency;
      amortizationMethod: AmortizationMethod;
      estimatedInstallment: number;
    } | null;
  };
  financialSummary: {
    currency: CurrencyCode;
    requestedAmount: number;
    legalFeesAmount: number;
    legalFeeMode: LegalFeeApplicationMode;
    financedPrincipal: number;
    netDisbursementAmount: number;
    monthlyRatePct: number;
    periodicRatePct: number;
    paymentFrequency: PaymentFrequency;
    amortizationMethod: AmortizationMethod;
    installmentCount: number;
    interestOnlyPeriods: number;
    amortizationPeriods: number;
    initialInstallment: number;
    finalInstallment: number;
    equalInstallments: boolean;
    totalPrincipal: number;
    totalInterest: number;
    totalPayable: number;
    totalCostIncludingFees: number;
    disbursementDate: string;
    firstDueDate: string;
    lastDueDate: string;
    finalBalance: number;
    isReconciled: boolean;
    dopEquivalentSummary?: {
      requestedAmount: number;
      legalFeesAmount: number;
      financedPrincipal: number;
      netDisbursementAmount: number;
      initialInstallment: number;
      finalInstallment: number;
      totalPrincipal: number;
      totalInterest: number;
      totalPayable: number;
      totalCostIncludingFees: number;
    } | null;
  } | null;
  exchangeRateMeta?: ExchangeRateAuditMetadata | null;
  installmentsCount: number;
  installmentsPreview: FinancialAnalysisInstallmentPreviewRow[];
  canSendToEvaluation: boolean;
  sendToEvaluationBlockedReasons: string[];
  justification?: string | null;
  calculatedBy: string;
  calculatedByName: string;
  calculatedByRole: UserRole;
  calculatedAt?: unknown;
  updatedAt?: unknown;
}

export interface ApplicationDecisionHistoryRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  analysisId: string | null;
  scoringExecutionId: string | null;
  eventType:
    | 'INITIAL_AUTO_EVALUATION'
    | 'HUMAN_REEVALUATION_SIMULATION'
    | 'SENT_TO_EVALUATION_AFTER_REEVALUATION'
    | 'EVALUATION_CONDITIONS_ADJUSTED'
    | 'RETRY_FINANCIAL_PROCESSING';
  originalConditions: CreditConditionsSnapshot;
  evaluatedConditions: CreditConditionsSnapshot;
  previousStatus: ApplicationStatus;
  newStatus: ApplicationStatus;
  qualifies: boolean;
  requiresHumanIntervention: boolean;
  rulesPassedCount: number;
  rulesFailedCount: number;
  unmetReasons: string[];
  changesSummary: Array<{
    field: string;
    label: string;
    before: string;
    after: string;
  }>;
  justification?: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  createdAt?: unknown;
}

export interface ApplicationDocumentRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  category: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  fileDataUrl?: string;
  reviewStatus: 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'OBSERVADO';
  notes?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt?: unknown;
  reviewedBy?: string | null;
  reviewedAt?: unknown;
}

export interface RiskBandConfig {
  code: RiskBandCode;
  label: string;
  minScore: number;
  maxScore: number;
  monthlyRate: number | null;
  minTermMonths: number;
  maxTermMonths: number;
}

export interface ProductLimitConfig {
  productCode: ProductCode;
  label: string;
  currency: CurrencyCode;
  minAmount: number;
  maxAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
  bandCaps: Record<RiskBandCode, number>;
  allowedFrequencies: PaymentFrequency[];
  allowedAmortizationMethods: AmortizationMethod[];
}

export interface ApprovalAuthorityRule {
  id: string;
  role: UserRole;
  productCode: ProductCode | 'ALL';
  maxAmount: number;
  allowedRiskBands: RiskBandCode[];
  requiresCollegialApproval: boolean;
  minVotesRequired: number;
  active: boolean;
}

export type WorkflowStageCode =
  | 'PRECALIFICACION_V2'
  | 'VERIFICACION_BIOMETRIA_OCR'
  | 'ANALISIS_CREDITO'
  | 'PARECER_RIESGO'
  | 'COMITE_CREDITO'
  | 'INSPECCION_GARANTIAS'
  | 'FORMALIZACION_LEGAL'
  | 'DESEMBOLSO_OPERACIONES'
  | 'ETAPA_PERSONALIZADA';

export type WorkflowStageGateType =
  | 'ALWAYS'
  | 'ABOVE_AMOUNT'
  | 'SCORE_BELOW'
  | 'RISK_BAND_BELOW';

export interface WorkflowStageConfig {
  id: string;
  code: WorkflowStageCode;
  name: string;
  description: string;
  ownerRole: UserRole;
  enabled: boolean;
  required: boolean;
  autoSkipOnFastTrack: boolean;
  gateType: WorkflowStageGateType;
  gateAmountDop?: number | null;
  gateMaxScore?: number | null;
  gateMinRiskBand?: RiskBandCode | null;
  slaHours: number;
  lockedOrder?: boolean;
}

export interface AutoDecisionThresholdsConfig {
  autoApproveMinScore: number;
  committeeReviewMinScore: number;
  autoRejectMaxScore: number;
  enableFastTrackAutoApproval: boolean;
  maxAutoApproveAmountDop: number;
  maxAutoApproveAmountUsd: number;
  requireRiskSignOffOverAmountDop: number;
  requireCollegialCommitteeOverAmountDop: number;
  maxAutoDtiPct: number;
  minCoverageRatio: number;
  syncCriticalBandWithAutoReject: boolean;
}

export interface PolicyWorkflowConfig {
  stages: WorkflowStageConfig[];
  decisionThresholds: AutoDecisionThresholdsConfig;
  updatedAtIso?: string;
}

export interface CreditPolicyRecord {
  id: string;
  organizationId: string;
  version: string;
  name?: string;
  description?: string;
  status: 'PROPUESTA' | 'EN_PRUEBAS' | 'APROBADA' | 'ACTIVA' | 'HISTORICA';
  riskBands: RiskBandConfig[];
  products: Record<ProductCode, ProductLimitConfig>;
  capacityConfig: {
    additionalIncomeFactor: number;
    maxNewInstallmentRatio: number;
    maxProjectedDti: number;
    minCoverageRatio: number;
    referenceSimulationMonthlyRate: number;
  };
  exchangeRateConfig: {
    dopPerUsd: number | null;
    rateDate: string;
    source: string;
    stressDepreciations: number[];
    blockUsdOnStressFailure: boolean;
  };
  approvalAuthorities: ApprovalAuthorityRule[];
  workflowConfig?: PolicyWorkflowConfig;
  indicatorWeights?: Record<string, number>;
  allowedExpenses?: string[];
  documentRequirements?: string[];
  approvedBy?: string | null;
  approvedAt?: unknown;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface IndicatorDetailResult {
  number: number;
  key: string;
  name: string;
  maxPoints: number;
  awardedPoints: number;
  usedValue: string;
  explanation: string;
  isFairnessWatch?: boolean;
}

export interface CapacityResult {
  eligibleIncome: number;
  essentialExpenses: number;
  currentDebtPayments: number;
  availableFlow: number;
  currentDti: number;
  projectedDti: number;
  maxInstallmentAllowed: number;
  simulatedReferenceInstallment: number;
  simulatedReferenceCoverage: number;
  sustainablePrincipalAtBandRate: number;
  incomeCurrency: CurrencyCode;
  loanCurrency: CurrencyCode;
  exchangeRateUsed: number | null;
}

export interface CurrencyStressScenarioResult {
  depreciationPct: number;
  stressedExchangeRate: number;
  stressedEligibleIncome: number;
  stressedAvailableFlow: number;
  stressedMaxInstallment: number;
  stressedSustainablePrincipal: number;
  remainsSustainable: boolean;
}

export interface ScoringExecutionRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  policyId?: string;
  policyVersion: string;
  policyStatus: string;
  executionTrigger: 'INITIAL_SUBMIT' | 'ANALYST_RECALC' | 'MANUAL_RERUN';
  inputSnapshot: Record<string, unknown>;
  capacityResult: CapacityResult;
  totalScore: number;
  riskBand: RiskBandConfig;
  status: ScoringStatus;
  recommendedAmount: number;
  recommendedRateMonthly: number;
  recommendedTermMonths: number;
  recommendedInstallment: number;
  favorableFactors: string[];
  alerts: string[];
  missingData: string[];
  currencyStressResults?: {
    applied: boolean;
    scenarios: CurrencyStressScenarioResult[];
  } | null;
  indicatorDetails: IndicatorDetailResult[];
  executedBy: string;
  executedByName?: string;
  executedAt?: unknown;
}

export interface CreditEvaluationRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  analystId: string;
  analystName: string;
  declaredSnapshot: Record<string, unknown>;
  verifiedSnapshot: Record<string, unknown>;
  preliminaryScoringId?: string | null;
  updatedScoringId?: string | null;
  identityVerified: boolean;
  incomeVerified: boolean;
  obligationsVerified: boolean;
  referencesVerified: boolean;
  addressVerified?: boolean;
  phoneVerified?: boolean;
  socialMediaVerified?: boolean;
  findings: string;
  observations: string;
  technicalReport: string;
  recommendedDecision: 'APROBAR' | 'MODIFICAR' | 'DEVOLVER' | 'RECHAZAR';
  recommendedAmount?: number | null;
  recommendedRateMonthly?: number | null;
  recommendedTermMonths?: number | null;
  recommendedConditions?: string;
  justification?: string;
  riskOpinionStatus?: RiskOpinionStatus;
  riskOpinionNotes?: string;
  riskOfficerId?: string | null;
  riskOfficerName?: string | null;
  riskReviewedAt?: unknown;
  status: 'BORRADOR' | 'COMPLETADA';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommitteeDecisionRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  decision: 'APROBADO' | 'APROBADO_CONDICIONADO' | 'DEVUELTO' | 'RECHAZADO';
  approvedAmount?: number | null;
  approvedRateMonthly?: number | null;
  approvedTermMonths?: number | null;
  approvedFrequency?: PaymentFrequency | null;
  approvedAmortizationMethod?: AmortizationMethod | null;
  conditions: Array<{ text: string; fulfilled: boolean }>;
  conditionsFulfilled: boolean;
  rejectionReason?: string | null;
  observations: string;
  authorityUsed: string;
  collegialVotes: Array<{ userId: string; userName: string; role: string; vote: string; votedAt: string }>;
  voteStatus?: 'VOTO_PARCIAL' | 'RESOLUCION_FINAL';
  requiredVotes?: number;
  totalPanelMembers?: number;
  decidedBy: string;
  decidedByName: string;
  decidedByRole: string;
  decidedAt?: unknown;
  isImmutable: true;
}

export interface FormalizationRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  decisionId: string;
  approvedFinancialAnalysisId?: string | null;
  approvedCapital: number;
  financedExpenses: number;
  totalFinanced: number;
  deductedExpenses: number;
  netDisbursementAmount: number;
  contractualRateMonthly: number;
  termMonths: number;
  frequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  disbursementTargetDate: string;
  firstPaymentDate: string;
  maturityDate: string;
  totalContractualPayable: number;
  contractTemplateVersion: string;
  contractText: string;
  promissoryNoteText: string;
  requiredDocsChecklist: Array<{ key: string; label: string; completed: boolean }>;
  conditionsFulfilled: boolean;
  signatures: Array<{ signerName: string; signerRole: string; method: string; signedAt: string }>;
  collateralDetails?: string;
  legalReviewConfirmed: boolean;
  promissoryNoteConfirmed?: boolean;
  contractConfirmed?: boolean;
  status: 'PENDIENTE' | 'LISTA_PARA_DESEMBOLSO' | 'DESEMBOLSADA';
  formalizedBy: string;
  formalizedByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DisbursementRecord {
  id: string;
  organizationId: string;
  disbursementNumber: string;
  applicationId: string;
  loanId: string;
  customerId: string;
  approvedAmount: number;
  totalFinanced: number;
  expenses: number;
  netDeliveredAmount: number;
  disbursementDate: string;
  paymentMethod: 'TRANSFERENCIA' | 'CHEQUE' | 'EFECTIVO_CAJA' | 'OTRO';
  financialEntity: string;
  destinationAccountMasked: string;
  referenceNumber: string;
  receiptNotes?: string;
  voucherFileName?: string | null;
  voucherMimeType?: string | null;
  voucherDocumentId?: string | null;
  idempotencyKey: string;
  responsibleUserId: string;
  responsibleUserName?: string;
  authorizerUserId: string;
  authorizerUserName?: string;
  status: 'CONFIRMADO';
  createdAt?: unknown;
}

export interface LoanRecord {
  id: string;
  organizationId: string;
  loanNumber: string;
  applicationId: string;
  disbursementId: string;
  approvedFinancialAnalysisId?: string | null;
  customerId: string;
  businessId?: string | null;
  applicantDisplayName: string;
  productCode: ProductCode;
  currency: CurrencyCode;
  approvedPrincipal: number;
  financedExpenses: number;
  totalFinancedPrincipal: number;
  currentPrincipalBalance: number;
  contractualRateMonthly: number;
  termMonths: number;
  frequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  disbursementDate: string;
  firstPaymentDate: string;
  maturityDate: string;
  totalContractualInterest: number;
  totalContractualPayable: number;
  status: 'ACTIVO' | 'PAGADO' | 'VENCIDO' | 'CANCELADO';
  paidPrincipalTotal?: number;
  paidInterestTotal?: number;
  paidLateFeeTotal?: number;
  closedAt?: string | null;
  closureCertificateNumber?: string | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LoanInstallmentRecord {
  id: string;
  organizationId: string;
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  otherCharges: number;
  totalAmount: number;
  remainingPrincipalBalance: number;
  status: 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'VENCIDA';
  paidPrincipal?: number;
  paidInterest?: number;
  paidOtherCharges?: number;
  paidLateFee?: number;
  accruedLateFee?: number;
  paidAt?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLogRecord {
  id: string;
  organizationId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  previousState?: string | null;
  newState?: string | null;
  justification?: string | null;
  transactionId: string;
  engineVersion?: string | null;
  userId: string;
  userEmail?: string;
  userRole?: string;
  timestamp?: unknown;
}

export type CustomerEmailEventCode =
  | 'RECIBIDA'
  | 'EN_EVALUACION'
  | 'DEVUELTA'
  | 'EN_COMITE'
  | 'APROBADA'
  | 'APROBADA_CONDICIONADA'
  | 'RECHAZADA'
  | 'PENDIENTE_FIRMA'
  | 'FORMALIZADA'
  | 'DESEMBOLSADA';

export type EmailNotificationStatus =
  | 'QUEUED'
  | 'SENT'
  | 'PENDING_CLOUD_FUNCTION'
  | 'SKIPPED_NO_EMAIL'
  | 'FAILED';

export type EmailDeliveryChannel =
  | 'CLOUD_FUNCTION_TRIGGER'
  | 'EXPRESS_SMTP_RELAY'
  | 'CLOUD_FUNCTION_PENDING_SMTP';

export interface EmailNotificationRecord {
  id: string;
  organizationId: string;
  applicationId: string;
  applicationNumber: string;
  customerId: string;
  applicantUid: string;
  recipientEmail: string;
  recipientName: string;
  eventCode: CustomerEmailEventCode;
  fromStatus?: string | null;
  toStatus: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  deliveryChannel: EmailDeliveryChannel;
  status: EmailNotificationStatus;
  providerMessageId?: string | null;
  errorMessage?: string | null;
  idempotencyKey: string;
  triggeredBy: string;
  triggeredByName?: string;
  sentAt?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type FcmPushStatus =
  | 'idle'
  | 'unsupported'
  | 'vapid_missing'
  | 'permission_denied'
  | 'registering'
  | 'active'
  | 'error';

export type PushDeliveryMode =
  | 'WEB_PUSH_VAPID'
  | 'FCM_AND_WEB_PUSH'
  | 'SW_RELAY_LOCAL';

export interface FcmDeviceTokenRecord {
  id: string;
  organizationId: string;
  userId: string;
  userRole: UserRole;
  userEmail: string;
  token: string;
  platform: string;
  userAgent: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PushSubscriptionRecord {
  id: string;
  organizationId: string;
  userId: string;
  userRole: UserRole;
  userEmail: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fcmToken?: string | null;
  vapidPublicKeyPrefix: string;
  subscribedStatuses: ApplicationStatus[];
  platform: string;
  userAgent: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DocumentOcrVerdict =
  | 'COINCIDE'
  | 'DISCREPANCIA_MENOR'
  | 'DISCREPANCIA_CRITICA'
  | 'ILEGIBLE_O_NO_CORRESPONDE';

export type DocumentOcrFieldMatchStatus = 'MATCH' | 'MINOR_DIFF' | 'MISMATCH' | 'NOT_FOUND';

export interface DocumentOcrComparisonItem {
  fieldKey: string;
  fieldLabel: string;
  declaredValue: string;
  extractedValue: string;
  matchStatus: DocumentOcrFieldMatchStatus;
  variancePct: number | null;
  detail: string;
}

export interface DocumentOcrResult {
  documentId?: string;
  fileName: string;
  category: string;
  modelUsed: string;
  overallVerdict: DocumentOcrVerdict;
  confidenceScore: number;
  detectedDocumentType: string;
  summary: string;
  extractedFields: {
    holderName: string | null;
    documentNumber: string | null;
    employerOrEntity: string | null;
    currency: CurrencyCode | null;
    monthlyIncome: number | null;
    monthlyDeductionsOrExpenses: number | null;
    monthlyDebtPayments: number | null;
    documentDate: string | null;
    address: string | null;
    rawKeyLines: string[];
  };
  comparisons: DocumentOcrComparisonItem[];
  suggestedVerifiedFinancials: {
    primaryNetIncome: number | null;
    additionalNetIncome: number | null;
    essentialExpenses: number | null;
    currentDebtPayments: number | null;
  };
  recommendedReviewStatus: 'VERIFICADO' | 'OBSERVADO';
  analyzedAtIso: string;
}

export type BiometricMatchVerdict =
  | 'COINCIDE'
  | 'REVISION_MANUAL'
  | 'NO_COINCIDE'
  | 'NO_CONCLUYENTE';

export interface BiometricVerificationResult {
  verdict: BiometricMatchVerdict;
  similarityScore: number;
  livenessAssessment: 'APROBADA' | 'DUDOSA' | 'NO_DETERMINADA';
  idPhotoDetected: boolean;
  selfieFaceDetected: boolean;
  extractedDocName: string | null;
  extractedDocNumber: string | null;
  documentIntegrityNotes: string;
  comparisonRationale: string;
  observations: string[];
  modelUsed: string;
  verifiedAtIso: string;
}

export type ExecutivePeriodPreset =
  | 'TODAY'
  | 'LAST_7D'
  | 'CURRENT_MONTH'
  | 'LAST_30D'
  | 'LAST_90D'
  | 'CURRENT_YEAR'
  | 'CUSTOM';

export type ExecutiveCurrencyMode = 'DOP' | 'USD' | 'SEPARATED';

export interface DirectorAnalysisResponse {
  modelUsed: string;
  generatedAtIso: string;
  executiveSummary: string;
  verifiedObservations: string[];
  inferences: string[];
  recommendedActions: Array<{
    title: string;
    detail: string;
    targetSection?: NavSectionId;
  }>;
  dataLimitations: string[];
}

export interface BelaActionSuggestion {
  label: string;
  targetSection?: NavSectionId;
  applicationId?: string;
  loanId?: string;
  requiresConfirmation?: boolean;
  confirmationNote?: string;
}

export interface BelaChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestampIso: string;
  actions?: BelaActionSuggestion[];
  verifiedFacts?: string[];
  isError?: boolean;
}

export interface UserNotificationRecord {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  category: 'CREDITO' | 'COBRANZA' | 'RIESGO' | 'BITACORA' | 'SISTEMA';
  priority: 'INMEDIATA' | 'ALTA' | 'MEDIA';
  title: string;
  message: string;
  amountLabel?: string | null;
  targetSection?: NavSectionId | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceEventKey?: string | null;
  actorName?: string | null;
  eventTimestampIso?: string | null;
  read: boolean;
  readAt?: string | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ModuleCatalogItem {
  code: AxyCoreModuleCode;
  name: string;
  description: string;
  category: AxyCoreModuleCategory;
  iconKey: string;
  availabilityStatus: 'PUBLICADO' | 'RETIRADO';
  developmentStatus: 'DISPONIBLE' | 'EN_DESARROLLO';
  version: string;
  requirements: string;
  dependencies: AxyCoreModuleCode[];
  licenseType: 'INCLUIDO_PLAN' | 'ADDON_COMERCIAL' | 'ENTERPRISE';
  monthlyPriceUsd: number;
  mappedSections: NavSectionId[];
  mappedApiRoutes: string[];
}

export interface CommercialPlanDefinition {
  code: CommercialPlanCode;
  name: string;
  tagline: string;
  includedModules: AxyCoreModuleCode[];
  maxUsers: number;
  maxStorageGb: number;
  maxMonthlyOperations: number;
  includesAi: boolean;
  monthlyPriceUsd: number;
  currency: CurrencyCode;
  validityMonths: number;
  commercialTerms: string;
}

export interface OrganizationMembershipRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  organizationId: string;
  tenantId?: string;
  tenant_id?: string;
  organizationName: string;
  role: UserRole;
  granularPermissions: GranularActionPermission[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED' | 'INACTIVE';
  allowedModuleCodes?: AxyCoreModuleCode[];
  isPrimaryAdmin?: boolean;
  invitedBy: string;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TenantLicenseRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  planCode: CommercialPlanCode;
  status: LicenseStatus;
  startDate: string;
  endDate: string;
  maxUsers: number;
  maxStorageGb: number;
  maxMonthlyOperations: number;
  enabledModules: AxyCoreModuleCode[];
  addonModules: AxyCoreModuleCode[];
  aiEnabled: boolean;
  monthlyFeeUsd: number;
  currency: CurrencyCode;
  notes?: string;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TenantSubscriptionRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  licenseId: string;
  planCode: CommercialPlanCode;
  billingCycle: 'MENSUAL' | 'ANUAL';
  amount: number;
  currency: CurrencyCode;
  status: 'ACTIVA' | 'PENDIENTE_PAGO' | 'SUSPENDIDA' | 'CANCELADA';
  nextBillingDate: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ExpenseCategory =
  | 'NOMINA'
  | 'ALQUILER'
  | 'SERVICIOS_BASICOS'
  | 'TECNOLOGIA'
  | 'MARKETING'
  | 'LEGAL_COBRANZA'
  | 'IMPUESTOS'
  | 'SUMINISTROS'
  | 'INTERESES_INVERSIONISTAS'
  | 'OTROS';

export type ExpensePaymentMethod = 'TRANSFERENCIA' | 'EFECTIVO' | 'CHEQUE' | 'TARJETA';

export type ExpenseStatus = 'PAGADO' | 'PENDIENTE' | 'ANULADO';

export interface OperatingExpenseRecord {
  id: string;
  organizationId: string;
  expenseNumber: string;
  expenseDate: string; // YYYY-MM-DD
  category: ExpenseCategory;
  concept: string;
  vendorName: string;
  invoiceNumber?: string;
  currency: CurrencyCode;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  status: ExpenseStatus;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type InvestorType = 'PERSONA_FISICA' | 'PERSONA_JURIDICA';

export type InvestorStatus = 'ACTIVO' | 'INACTIVO';

export interface InvestorRecord {
  id: string;
  organizationId: string;
  investorCode: string;
  fullName: string;
  investorType: InvestorType;
  documentNumber: string;
  phone: string;
  email?: string;
  currency: CurrencyCode;
  annualReturnRatePct: number;
  joinDate: string; // YYYY-MM-DD
  currentInvestedBalance: number;
  totalContributed: number;
  totalWithdrawn: number;
  totalReturnsPaid: number;
  status: InvestorStatus;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type InvestorTransactionType = 'APORTE_CAPITAL' | 'RETIRO_CAPITAL' | 'PAGO_RENDIMIENTO';

export interface InvestorTransactionRecord {
  id: string;
  organizationId: string;
  investorId: string;
  investorName: string;
  transactionType: InvestorTransactionType;
  transactionDate: string; // YYYY-MM-DD
  currency: CurrencyCode;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber?: string;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export * from './collections';
export * from './altera';



