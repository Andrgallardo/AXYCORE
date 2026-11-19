import type { AuditLogRecord } from '../types/axycore';

export type CriticalEventCategory =
  | 'STATUS_CHANGE'
  | 'COMMITTEE_APPROVAL'
  | 'CONFIDENTIAL_DOC_ACCESS'
  | 'GOVERNANCE_AND_FINANCE';

export type CriticalEventSeverity = 'CRITICO' | 'ALTO' | 'ESTANDAR';

export type ConfidentialAccessAction =
  | 'PREVIEW'
  | 'DOWNLOAD'
  | 'OCR_SCAN'
  | 'UPLOAD'
  | 'REVIEW_UPDATE';

export interface CriticalAuditClassification {
  isCritical: boolean;
  category: CriticalEventCategory | null;
  categoryLabel: string;
  severity: CriticalEventSeverity;
  complianceControl: string;
}

export interface CriticalAuditSummary {
  totalLogs: number;
  totalCritical: number;
  statusChangesCount: number;
  committeeApprovalsCount: number;
  confidentialDocAccessCount: number;
  governanceFinanceCount: number;
  criticalSeverityCount: number;
  uniqueActorsCount: number;
}

export const CRITICAL_CATEGORY_LABELS: Record<CriticalEventCategory, string> = {
  STATUS_CHANGE: 'Cambio de Estado',
  COMMITTEE_APPROVAL: 'Aprobación / Dictamen de Comité',
  CONFIDENTIAL_DOC_ACCESS: 'Acceso a Documento Confidencial',
  GOVERNANCE_AND_FINANCE: 'Gobernanza, RBAC y Políticas',
};

const CONFIDENTIAL_DOC_CATEGORIES = new Set([
  'CEDULA_IDENTIDAD',
  'IDENTIDAD',
  'PASAPORTE',
  'VERIFICACION_BIOMETRICA',
  'BIOMETRIA',
  'COMPROBANTE_INGRESOS',
  'INGRESOS',
  'ESTADO_CUENTA',
  'DOCUMENTO_SOCIETARIO',
  'CONTRATO_FIRMADO',
  'PAGARE_FIRMADO',
  'CONTRATO_PAGARE',
  'COMPROBANTE_DOMICILIO',
  'OTRO_SOPORTE',
]);

const CONFIDENTIAL_DOC_EVENT_TYPES = new Set([
  'CONFIDENTIAL_DOCUMENT_ACCESSED',
  'CONFIDENTIAL_DOCUMENT_PREVIEWED',
  'CONFIDENTIAL_DOCUMENT_DOWNLOADED',
  'CONFIDENTIAL_DOCUMENT_OCR_INSPECTED',
  'CONFIDENTIAL_DOCUMENT_UPLOADED',
  'DOCUMENT_OCR_VERIFIED',
  'DOCUMENT_REVIEW_UPDATED',
]);

const STATUS_TRANSITION_EVENT_TYPES = new Set([
  'APPLICATION_STATUS_CHANGED',
  'APPLICATION_SUBMITTED_AND_SCORED',
  'CREDIT_EVALUATION_RECALC',
  'RISK_OFFICER_REVIEW',
  'FORMALIZATION_COMPLETED',
  'FORMALIZATION_SAVED',
  'DISBURSEMENT_AND_LOAN_CREATED',
]);

const GOVERNANCE_EVENT_TYPES = new Set([
  'USER_RBAC_UPDATED',
  'POLICY_VERSION_CREATED',
  'POLICY_UPDATED',
  'WORKFLOW_CONFIG_UPDATED',
]);

export function normalizeDocumentCategory(category?: string | null): string {
  return String(category ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function isConfidentialDocumentCategory(category?: string | null): boolean {
  const norm = normalizeDocumentCategory(category);
  if (!norm) return true;
  if (norm === 'PUBLICO' || norm === 'INFORMATIVO_PUBLICO') return false;
  return (
    CONFIDENTIAL_DOC_CATEGORIES.has(norm) ||
    norm.includes('CEDULA') ||
    norm.includes('IDENT') ||
    norm.includes('INGRESO') ||
    norm.includes('CUENTA') ||
    norm.includes('CONTRATO') ||
    norm.includes('PAGARE') ||
    norm.includes('BIOMETR') ||
    norm.includes('SOCIETAR')
  );
}

export function classifyCriticalAuditEvent(
  log: Pick<AuditLogRecord, 'eventType' | 'entityType' | 'previousState' | 'newState' | 'action'>
): CriticalAuditClassification {
  const eventType = String(log.eventType || '').toUpperCase();
  const entityType = String(log.entityType || '').toLowerCase();
  const prevState = String(log.previousState ?? '').trim();
  const nextState = String(log.newState ?? '').trim();
  const actionUpper = String(log.action ?? '').toUpperCase();

  // 1. Committee approvals & rejections (highest governance weight)
  if (
    eventType === 'COMMITTEE_DECISION_IMMUTABLE' ||
    entityType === 'committee_decisions'
  ) {
    return {
      isCritical: true,
      category: 'COMMITTEE_APPROVAL',
      categoryLabel: CRITICAL_CATEGORY_LABELS.COMMITTEE_APPROVAL,
      severity: 'CRITICO',
      complianceControl: 'Gobierno Comité / Segregación de Funciones',
    };
  }

  // 2. Confidential document accesses, OCR inspections, downloads & reviews
  if (
    CONFIDENTIAL_DOC_EVENT_TYPES.has(eventType) ||
    entityType === 'application_documents'
  ) {
    const isHighRiskAccess =
      eventType === 'CONFIDENTIAL_DOCUMENT_DOWNLOADED' ||
      actionUpper.includes('CONTRATO') ||
      actionUpper.includes('PAGARE') ||
      actionUpper.includes('BIOMETR') ||
      actionUpper.includes('DISCREPANCIA') ||
      nextState === 'OBSERVADO';

    return {
      isCritical: true,
      category: 'CONFIDENTIAL_DOC_ACCESS',
      categoryLabel: CRITICAL_CATEGORY_LABELS.CONFIDENTIAL_DOC_ACCESS,
      severity: isHighRiskAccess ? 'CRITICO' : 'ALTO',
      complianceControl: 'Ley 172-13 / Confidencialidad Documental',
    };
  }

  // 3. Application lifecycle state changes, formalizations & disbursements
  const hasExplicitStateTransition =
    Boolean(prevState) && Boolean(nextState) && prevState !== nextState;

  if (STATUS_TRANSITION_EVENT_TYPES.has(eventType) || hasExplicitStateTransition) {
    const isTerminalOrMoneyEvent =
      eventType === 'DISBURSEMENT_AND_LOAN_CREATED' ||
      eventType === 'FORMALIZATION_COMPLETED' ||
      nextState.includes('DESEMBOLSADA') ||
      nextState.includes('FORMALIZADA') ||
      nextState.includes('RECHAZADA') ||
      nextState.includes('DEVUELTA');

    return {
      isCritical: true,
      category: 'STATUS_CHANGE',
      categoryLabel: CRITICAL_CATEGORY_LABELS.STATUS_CHANGE,
      severity: isTerminalOrMoneyEvent ? 'CRITICO' : 'ALTO',
      complianceControl: 'Trazabilidad Ciclo de Vida Crediticio',
    };
  }

  // 4. RBAC & Credit Policy / Workflow governance events
  if (GOVERNANCE_EVENT_TYPES.has(eventType)) {
    const isCriticalGovernance =
      eventType === 'USER_RBAC_UPDATED' || eventType === 'POLICY_VERSION_CREATED';
    return {
      isCritical: true,
      category: 'GOVERNANCE_AND_FINANCE',
      categoryLabel: CRITICAL_CATEGORY_LABELS.GOVERNANCE_AND_FINANCE,
      severity: isCriticalGovernance ? 'CRITICO' : 'ALTO',
      complianceControl: 'Control Interno / RBAC y Política V2',
    };
  }

  return {
    isCritical: false,
    category: null,
    categoryLabel: 'Operación Estándar',
    severity: 'ESTANDAR',
    complianceControl: 'Registro General',
  };
}

export function summarizeCriticalAuditLogs(logs: AuditLogRecord[]): CriticalAuditSummary {
  let totalCritical = 0;
  let statusChangesCount = 0;
  let committeeApprovalsCount = 0;
  let confidentialDocAccessCount = 0;
  let governanceFinanceCount = 0;
  let criticalSeverityCount = 0;
  const actors = new Set<string>();

  for (const log of logs) {
    const classification = classifyCriticalAuditEvent(log);
    if (!classification.isCritical) continue;

    totalCritical += 1;
    if (classification.severity === 'CRITICO') {
      criticalSeverityCount += 1;
    }

    if (classification.category === 'STATUS_CHANGE') statusChangesCount += 1;
    else if (classification.category === 'COMMITTEE_APPROVAL') committeeApprovalsCount += 1;
    else if (classification.category === 'CONFIDENTIAL_DOC_ACCESS') confidentialDocAccessCount += 1;
    else if (classification.category === 'GOVERNANCE_AND_FINANCE') governanceFinanceCount += 1;

    const actorKey = log.userEmail || log.userId;
    if (actorKey) actors.add(actorKey);
  }

  return {
    totalLogs: logs.length,
    totalCritical,
    statusChangesCount,
    committeeApprovalsCount,
    confidentialDocAccessCount,
    governanceFinanceCount,
    criticalSeverityCount,
    uniqueActorsCount: actors.size,
  };
}

export function buildCriticalAuditEntryPayload(params: {
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
  userEmail?: string | null;
  userRole?: string | null;
}): Omit<AuditLogRecord, 'timestamp'> {
  const safeStr = (val: string | null | undefined, max: number, fallback = '') =>
    String(val ?? fallback).trim().slice(0, max);

  const payload: Omit<AuditLogRecord, 'timestamp'> = {
    id: safeStr(params.id, 128),
    organizationId: safeStr(params.organizationId, 128),
    eventType: safeStr(params.eventType, 80, 'CRITICAL_EVENT'),
    entityType: safeStr(params.entityType, 80, 'system'),
    entityId: safeStr(params.entityId, 128, 'unknown'),
    action: safeStr(params.action, 195, 'Evento de auditoría'),
    transactionId: safeStr(params.transactionId, 128, 'tx_unknown'),
    userId: safeStr(params.userId, 128),
  };

  if (params.previousState !== undefined && params.previousState !== null && params.previousState !== '') {
    payload.previousState = safeStr(params.previousState, 3900);
  }
  if (params.newState !== undefined && params.newState !== null && params.newState !== '') {
    payload.newState = safeStr(params.newState, 3900);
  }
  if (params.justification !== undefined && params.justification !== null && params.justification !== '') {
    payload.justification = safeStr(params.justification, 950);
  }
  if (params.engineVersion !== undefined && params.engineVersion !== null && params.engineVersion !== '') {
    payload.engineVersion = safeStr(params.engineVersion, 40);
  }
  if (params.userEmail) {
    payload.userEmail = safeStr(params.userEmail, 254);
  }
  if (params.userRole) {
    payload.userRole = safeStr(params.userRole, 64);
  }

  return payload;
}
