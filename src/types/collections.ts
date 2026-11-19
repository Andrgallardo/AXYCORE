import type { CurrencyCode } from './axycore';

export type CollectionStage =
  | 'AL_DIA'
  | 'PREVENTIVA'
  | 'TEMPRANA'
  | 'INTERMEDIA'
  | 'AVANZADA'
  | 'CRITICA'
  | 'CANCELADO';

export type CollectionBucket =
  | 'AL_DIA'
  | '1_5'
  | '6_15'
  | '16_30'
  | '31_60'
  | '61_90'
  | '90_MAS';

export type CollectionPriority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export type PaymentComponentKey = 'MORA' | 'CARGOS' | 'INTERES' | 'CAPITAL';

export type CollectionChannel =
  | 'LLAMADA'
  | 'WHATSAPP'
  | 'VISITA_CAMPO'
  | 'SMS'
  | 'EMAIL'
  | 'OFICINA'
  | 'BOT_AUTOMATICO';

export type CollectionContactResult =
  | 'CONTACTO_EFECTIVO_PROMESA'
  | 'CONTACTO_SIN_ACUERDO'
  | 'SOLICITA_REESTRUCTURACION'
  | 'RECLAMACION_CLIENTE'
  | 'NO_CONTESTA'
  | 'BUZON'
  | 'NUMERO_EQUIVOCADO_O_INACTIVO'
  | 'COMPROMISO_PAGO_VERIFICADO'
  | 'MENSAJE_ENTREGADO';

export interface CollectionAccountRecord {
  id: string; // == loanId
  organizationId: string;
  loanId: string;
  loanNumber: string;
  applicationId: string;
  customerId: string;
  applicantDisplayName: string;
  customerPhone?: string;
  customerEmail?: string;
  province?: string;
  municipality?: string;
  branchName?: string;
  productCode: string;
  currency: CurrencyCode;
  dpd: number;
  maxHistoricalDpd: number;
  stage: CollectionStage;
  bucket: CollectionBucket;
  priority: CollectionPriority;
  priorityScore: number;
  priorityReasons: string[];
  overdueInstallmentsCount: number;
  totalInstallmentsCount: number;
  paidInstallmentsCount: number;
  overduePrincipal: number;
  overdueInterest: number;
  overdueLateFee: number;
  overdueCharges: number;
  overdueTotalAmount: number;
  totalOutstandingPrincipal: number;
  nextDueDate?: string | null;
  nextDueAmount?: number;
  lastPaymentDate?: string | null;
  lastPaymentAmount?: number;
  pendingVerificationAmount: number;
  assignedCollectorId?: string | null;
  assignedCollectorName?: string | null;
  lastActionAt?: string | null;
  lastActionType?: string | null;
  lastActionResult?: string | null;
  nextFollowUpDate?: string | null;
  activePromiseId?: string | null;
  activePromiseDate?: string | null;
  activePromiseAmount?: number | null;
  brokenPromisesCount: number;
  behaviorScore: number; // Indicador separado del Score V2 de originación
  behaviorBand: 'EXCELENTE' | 'BUENO' | 'ATENCION' | 'RIESGO_ALTO' | 'CRITICO';
  isRestructured?: boolean;
  hasOpenDispute?: boolean;
  consentWhatsAppOptIn: boolean;
  closedAt?: string | null;
  closureCertificateNumber?: string | null;
  cutoffDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CollectionAssignmentRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  collectionAccountId: string;
  customerId: string;
  previousCollectorId?: string | null;
  previousCollectorName?: string | null;
  newCollectorId: string;
  newCollectorName: string;
  reason: string;
  ruleApplied?: string | null;
  assignedBy: string;
  assignedByName: string;
  createdAt?: unknown;
}

export interface CollectionActionRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  collectorId: string;
  collectorName: string;
  channel: CollectionChannel;
  contactResult: CollectionContactResult;
  notes: string;
  dpdAtAction: number;
  nextActionDate?: string | null;
  promiseCreatedId?: string | null;
  disputeCreatedId?: string | null;
  isClosed: boolean;
  correctsActionId?: string | null;
  correctionReason?: string | null;
  supersededByActionId?: string | null;
  actionTimeIso: string;
  createdAt?: unknown;
}

export type CollectionTaskType =
  | 'VENCIMIENTO_HOY'
  | 'PROMESA_HOY'
  | 'PROMESA_INCUMPLIDA'
  | 'MORA_TEMPRANA_1_5'
  | 'PAGO_PARCIAL'
  | 'SEGUIMIENTO_GESTION'
  | 'ALERTA_CENTINELA'
  | 'CARTERA_CRITICA'
  | 'VERIFICACION_PAGO_PENDIENTE'
  | 'TAREA_MANUAL';

export type CollectionTaskStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'COMPLETADA'
  | 'VENCIDA'
  | 'CANCELADA';

export interface CollectionTaskRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  assignedToUserId: string;
  assignedToUserName: string;
  taskType: CollectionTaskType;
  sourceEventKey: string; // Llave determinística para evitar duplicados por evento
  priority: CollectionPriority;
  title: string;
  description: string;
  dueDate: string; // YYYY-MM-DD (America/Santo_Domingo)
  status: CollectionTaskStatus;
  completedBy?: string | null;
  completedAt?: string | null;
  outcomeNotes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PromiseStatus =
  | 'VIGENTE'
  | 'CUMPLIDA'
  | 'CUMPLIDA_PARCIAL'
  | 'INCUMPLIDA'
  | 'CANCELADA'
  | 'PENDIENTE_VERIFICACION';

export interface PaymentPromiseRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  promisedAmount: number;
  promisedDate: string; // YYYY-MM-DD
  channel: CollectionChannel;
  createdByUserId: string;
  createdByUserName: string;
  status: PromiseStatus;
  fulfilledAmount: number;
  fulfilledPaymentIds: string[];
  verifiedAt?: string | null;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AgreementType = 'ACUERDO_PAGO' | 'REESTRUCTURACION' | 'REFINANCIAMIENTO';
export type AgreementStatus =
  | 'PROPUESTO'
  | 'APROBADO'
  | 'ACTIVO'
  | 'CUMPLIDO'
  | 'INCUMPLIDO'
  | 'RECHAZADO';

export interface PaymentAgreementRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  agreementType: AgreementType;
  totalAgreedAmount: number;
  downPaymentAmount: number;
  installmentCount: number;
  proposedRateMonthly?: number | null;
  firstDueDate: string;
  notes: string;
  proposedBy: string;
  proposedByName: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  rejectedReason?: string | null;
  status: AgreementStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PaymentStatus =
  | 'REPORTADO'
  | 'RECIBIDO_PENDIENTE_VERIFICACION'
  | 'VERIFICADO'
  | 'APLICADO'
  | 'RECHAZADO'
  | 'REVERTIDO';

export type PaymentChannelMethod =
  | 'TRANSFERENCIA'
  | 'DEPOSITO'
  | 'CAJA_EFECTIVO'
  | 'TARJETA'
  | 'CHEQUE'
  | 'LINK_PAGO'
  | 'OTRO';

export interface PaymentRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  amount: number;
  paymentDate: string; // YYYY-MM-DD
  method: PaymentChannelMethod;
  bankName?: string;
  referenceNumber: string;
  idempotencyKey: string;
  receiptEvidenceName?: string;
  receiptEvidenceMimeType?: string;
  receiptEvidenceSizeBytes?: number;
  receiptEvidenceDataUrl?: string;
  receiptEvidenceNote?: string;
  status: PaymentStatus;
  reportedByUserId: string;
  reportedByName: string;
  verifiedByUserId?: string | null;
  verifiedByName?: string | null;
  appliedByUserId?: string | null;
  appliedByName?: string | null;
  appliedAt?: string | null;
  appliedDate?: string | null;
  appliedBreakdown?: {
    principal?: number;
    interest?: number;
    lateFee?: number;
    otherCharges?: number;
  } | null;
  reversedByUserId?: string | null;
  reversedByName?: string | null;
  reversalReason?: string | null;
  reconciliationMatchId?: string | null;
  receiptNumber?: string | null;
  imputationOrderUsed?: PaymentComponentKey[];
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentAllocationRecord {
  id: string;
  organizationId: string;
  paymentId: string;
  loanId: string;
  installmentId: string;
  installmentNumber: number;
  currency: CurrencyCode;
  appliedToLateFee: number;
  appliedToCharges: number;
  appliedToInterest: number;
  appliedToPrincipal: number;
  totalAllocated: number;
  reversed: boolean;
  createdAt?: unknown;
}

export interface PaymentReversalRecord {
  id: string;
  organizationId: string;
  paymentId: string;
  loanId: string;
  loanNumber: string;
  currency: CurrencyCode;
  reversedAmount: number;
  reason: string;
  authorizedByUserId: string;
  authorizedByName: string;
  previousReceiptNumber?: string | null;
  createdAt?: unknown;
}

export interface CollectionReceiptRecord {
  id: string;
  organizationId: string;
  receiptNumber: string;
  paymentId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  amount: number;
  appliedToPrincipal: number;
  appliedToInterest: number;
  appliedToLateFee: number;
  appliedToCharges: number;
  remainingPrincipalAfter: number;
  paymentDate: string;
  referenceNumber: string;
  issuedBy: string;
  issuedByName: string;
  issuedAt: string;
  status: 'EMITIDO' | 'ANULADO_POR_REVERSO';
  createdAt?: unknown;
}

export interface PaymentIntentRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  reportedAmount: number;
  reportedDate: string;
  referenceNumber: string;
  sourceChannel: 'WHATSAPP_BOT' | 'PORTAL_CLIENTE' | 'GESTOR' | 'CAJA';
  status: 'PENDIENTE_VERIFICACION' | 'VINCULADO_A_PAGO' | 'RECHAZADO';
  linkedPaymentId?: string | null;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type BankTransactionStatus =
  | 'PENDIENTE'
  | 'CONCILIADA'
  | 'POR_IDENTIFICAR'
  | 'DUPLICADA'
  | 'IGNORADA';

export interface BankTransactionRecord {
  id: string;
  organizationId: string;
  batchId: string;
  transactionDate: string; // YYYY-MM-DD
  valueDate?: string;
  bankName: string;
  referenceNumber: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  idempotencyHash: string;
  status: BankTransactionStatus;
  matchedPaymentId?: string | null;
  matchedLoanId?: string | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MatchConfidenceType =
  | 'EXACTA'
  | 'PROBABLE'
  | 'AMBIGUA'
  | 'DIFERENCIA_MONTO'
  | 'REFERENCIA_DUPLICADA'
  | 'SIN_COINCIDENCIA'
  | 'YA_CONCILIADA';

export interface ReconciliationMatchRecord {
  id: string;
  organizationId: string;
  bankTransactionId: string;
  paymentId?: string | null;
  loanId?: string | null;
  confidence: MatchConfidenceType;
  amountDiff: number;
  score: number;
  reason: string;
  autoApplied: boolean;
  status: 'SUGERIDO' | 'CONFIRMADO' | 'RECHAZADO';
  confirmedBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReconciliationExceptionRecord {
  id: string;
  organizationId: string;
  bankTransactionId: string;
  paymentId?: string | null;
  loanId?: string | null;
  exceptionType:
    | 'SIN_COINCIDENCIA'
    | 'MULTIPLES_CANDIDATOS'
    | 'DIFERENCIA_MONTO'
    | 'REFERENCIA_DUPLICADA'
    | 'YA_CONCILIADO';
  detail: string;
  status: 'ABIERTA' | 'RESUELTA' | 'DESCARTADA';
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CollectorTargetRecord {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  periodYm: string; // YYYY-MM
  targetAmountDop: number;
  targetAmountUsd: number;
  maxCasesLimit: number;
  promiseFulfillmentTargetPct: number;
  active: boolean;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface CollectionCampaignRecord {
  id: string;
  organizationId: string;
  name: string;
  stageTarget: CollectionStage | 'VENCIMIENTO_PROXIMO';
  templateId: string;
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  status: 'ACTIVA' | 'PAUSADA' | 'BORRADOR';
  maxPerDay: number;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MessageTemplateRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  stageTarget: CollectionStage | 'VENCIMIENTO_PROXIMO' | 'GENERAL';
  bodyTemplate: string;
  approvalStatus: 'APROBADA' | 'BORRADOR' | 'RECHAZADA';
  variables: string[];
  updatedBy: string;
  updatedAt?: unknown;
}

export type MessageDeliveryStatus =
  | 'INTEGRACION_PENDIENTE'
  | 'BLOQUEADO_OPT_OUT'
  | 'BLOQUEADO_HORARIO'
  | 'BLOQUEADO_FRECUENCIA'
  | 'BLOQUEADO_RECLAMACION'
  | 'SIMULADO_LOCAL'
  | 'ENVIADO';

export interface MessageEventRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  campaignId?: string | null;
  templateId?: string | null;
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  direction: 'OUTBOUND' | 'INBOUND';
  recipientMasked: string;
  messagePreview: string;
  deliveryStatus: MessageDeliveryStatus;
  externalMessageId?: string | null;
  consentVerified: boolean;
  blockReason?: string | null;
  createdBy: string;
  createdAt?: unknown;
}

export type SentinelRuleCode =
  | 'PROMESAS_INCUMPLIDAS_REITERADAS'
  | 'MORA_TEMPRANA_SIN_PRIMER_CONTACTO'
  | 'DESPLAZAMIENTO_TRAMO_MORA'
  | 'CUENTA_CRITICA_SIN_SEGUIMIENTO'
  | 'PAGOS_REPORTADOS_NO_CONFIRMADOS'
  | 'CONCENTRACION_GESTOR_CARGA'
  | 'REINCIDENCIA_HISTORICA'
  | 'ACUMULACION_PAGOS_PARCIALES'
  | 'CONCENTRACION_VENCIMIENTOS_PROXIMOS'
  | 'RECLAMACION_ABIERTA_URGENTE'
  | 'SALDO_CERO_SIN_CIERRE'
  | 'POSIBLE_PAGO_DUPLICADO'
  | 'EXCEPCION_CONCILIACION_ANTIGUA';

export interface RiskAlertRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  ruleCode: SentinelRuleCode;
  severity: CollectionPriority;
  title: string;
  description: string;
  metricValue: string;
  status: 'ACTIVA' | 'EN_REVISION' | 'ATENDIDA' | 'DESCARTADA';
  attendedBy?: string | null;
  attendedNotes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DisputeType =
  | 'PAGO_NO_REFLEJADO'
  | 'COBRO_INDEBIDO'
  | 'ERROR_SALDO'
  | 'ACOSO_CONTACTO'
  | 'OTRO';

export interface CustomerDisputeRecord {
  id: string;
  organizationId: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  disputeType: DisputeType;
  description: string;
  pauseAutomatedMessages: boolean;
  status: 'ABIERTA' | 'EN_INVESTIGACION' | 'RESUELTA_FAVOR_CLIENTE' | 'RESUELTA_IMPROCEDENTE';
  assignedTo?: string | null;
  resolutionNotes?: string | null;
  openedBy: string;
  openedByName: string;
  resolvedBy?: string | null;
  resolvedByName?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CollectionStageDefinition {
  stage: Exclude<CollectionStage, 'AL_DIA' | 'CANCELADO'>;
  label: string;
  minDpd: number;
  maxDpd: number | null;
  suggestedChannel: CollectionChannel;
  slaHours: number;
}

export interface CollectionPolicyVersionRecord {
  id: string;
  organizationId: string;
  version: string;
  status: 'ACTIVA' | 'PROPUESTA' | 'HISTORICA';
  graceDays: number;
  lateFeeRateMonthlyPct: number;
  imputationOrder: PaymentComponentKey[];
  stagesConfig: CollectionStageDefinition[];
  allowedContactHours: {
    startHour: number; // e.g. 8
    endHour: number;   // e.g. 20
    allowSundays: boolean;
  };
  maxDailyContactsPerLoan: number;
  maxWeeklyBotMessagesPerLoan: number;
  autoApplyExactBankMatch: boolean;
  autoMarkBrokenPromises: boolean;
  requireFinanceApprovalForClosure: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CollectionDailySnapshotRecord {
  id: string;
  organizationId: string;
  cutoffDate: string; // YYYY-MM-DD (America/Santo_Domingo)
  policyVersion: string;
  totalActiveLoans: number;
  overdueLoansCount: number;
  principalBalanceDop: number;
  principalBalanceUsd: number;
  par1Dop: number;
  par30Dop: number;
  par60Dop: number;
  par90Dop: number;
  par1Usd: number;
  par30Usd: number;
  par60Usd: number;
  par90Usd: number;
  overdueAmountDop: number;
  overdueAmountUsd: number;
  createdBy: string;
  createdAt?: unknown;
}
