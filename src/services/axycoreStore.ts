import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as signOutSecondary,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, db, firebaseConfig, handleFirestoreError, OperationType } from '../firebase/config';
import { DEFAULT_POLICY_V2, evaluateCreditDecisionV2 } from '../engine/decisionEngineV2';
import { generateAmortizationSchedule, addMonthsPreservingAnchor } from '../engine/amortizationEngine';
import {
  canExecuteDisbursement,
  canUserApproveCommittee,
  evaluateCollegialCommitteeVotes,
  type CollegialVoteEntry,
} from '../engine/workflowGuards';
import { hasRolePermission } from '../engine/rbac';
import {
  AMORTIZATION_METHOD_LABELS,
  buildOriginalRequestedConditions,
  canUserExecuteHumanReevaluation,
  canUserOverrideRateOrFees,
  computeInstallmentCountFromMonths,
  LEGAL_FEE_MODE_LABELS,
  PAYMENT_FREQUENCY_LABELS,
  runIntegratedDecisionAndCalculation,
  type AlternativeConditionsOverrideInput,
  type IntegratedCreditEvaluationResult,
} from '../engine/integratedCreditEngine';
import { suggestLoanConditions } from '../engine/loanCalculatorEngine';
import { buildCustomerStatusEmailPayload } from '../engine/emailTemplates';
import {
  formatMoney,
  formatRatePct,
  maskAccountNumber,
  normalizeMonthlyRateDecimal,
  sanitizeIdSegment,
  toIsoDateOnly,
} from '../utils/formatters';
import { buildFcmTokenDocId } from '../engine/pushPayload';
import { buildOcrDocumentNote } from '../engine/documentOcr';
import { DEFAULT_WORKFLOW_CONFIG } from '../engine/workflowBuilder';
import {
  buildCriticalAuditEntryPayload,
  isConfidentialDocumentCategory,
} from '../engine/criticalAudit';
import {
  buildNewCompanyRegistrationBundle,
  COMMERCIAL_PLANS_CATALOG,
  DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE,
  isSuperAdminUser,
  runControlledSuGloriaMigration,
  SU_GLORIA_ENABLED_MODULES,
  SU_GLORIA_MANO_AMIGA_ORG,
  SU_GLORIA_ORG_ID,
  switchUserOrganizationWorkspace,
  validateModuleToggle,
  type RegisterNewCompanyInput,
} from '../engine/multiTenantEngine';
import { buildPublicPortalRecordFromOrg } from '../engine/externalPortalEngine';
import {
  buildDeterministicInvitationId,
  buildInvitationActivationUrl,
  buildInvitationEmailContent,
  isPrimarySuperAdminEmail,
  normalizeEmailAddress,
  resolveInvitedUserBootstrap,
} from '../engine/invitationFlow';
import {
  evaluatePreEvaluationRequirements,
  PreEvaluationValidationError,
  type PreEvaluationValidationResult,
} from '../engine/preEvaluationValidation';
import {
  ALL_TRACKED_PUSH_STATUSES,
  buildPushSubscriptionDocId,
} from '../engine/pushPayload';
import { dispatchApplicationStatusChangePush } from './pushSubscriptionService';
import type {
  ApplicationDecisionHistoryRecord,
  ApplicationDocumentRecord,
  ApplicationFieldChange,
  ApplicationRecord,
  ApplicationStatus,
  AuditLogRecord,
  AxyCoreModuleCode,
  BiometricVerificationResult,
  BusinessRecord,
  CommercialPlanCode,
  CommitteeDecisionRecord,
  CreditEvaluationRecord,
  CreditPolicyRecord,
  CustomerEmailEventCode,
  CustomerRecord,
  DisbursementRecord,
  DocumentOcrResult,
  EmailNotificationRecord,
  FcmDeviceTokenRecord,
  FinancialAnalysisInstallmentRecord,
  FinancialAnalysisRecord,
  FormalizationRecord,
  GranularActionPermission,
  LicenseStatus,
  LoanInstallmentRecord,
  LoanRecord,
  MovementHistoryEntry,
  OrganizationMembershipRecord,
  AmortizationMethod,
  LegalFeeApplicationMode,
  OrganizationRecord,
  PaymentFrequency,
  PushSubscriptionRecord,
  RiskOpinionStatus,
  ScoringExecutionRecord,
  TenantLicenseRecord,
  TenantStatus,
  TenantSubscriptionRecord,
  UserInvitationRecord,
  UserProfile,
  UserRole,
  UserStatus,
  InvitationStatus,
  CreditRenewalRecord,
  CollectionPolicyVersionRecord,
  CollectionAccountRecord,
} from '../types/axycore';
import type { AccountingAccountRecord } from '../types/dgiiEcf';
import {
  buildRenewalAccountingJournalEntry,
  calculateRenewalNetDisbursement,
  computeRenewalPayoffBreakdown,
} from '../engine/renewalEngine';
import { ROLE_LABELS } from '../types/axycore';

export const DEFAULT_ORG_ID = SU_GLORIA_ORG_ID;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function sanitizeFirestorePayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeFirestorePayload(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = sanitizeFirestorePayload(v);
      }
    }
    return out as T;
  }
  return value;
}

function cleanObject<T extends object>(obj: T): T {
  return sanitizeFirestorePayload(obj);
}

export function appendMovementHistory(
  existing: MovementHistoryEntry[] | null | undefined,
  entry: Omit<MovementHistoryEntry, 'note'> & { note?: string | null }
): MovementHistoryEntry[] {
  const sanitizedExisting = Array.isArray(existing)
    ? existing.map((item) => sanitizeFirestorePayload(item))
    : [];
  const trimmedNote = typeof entry.note === 'string' ? entry.note.trim() : '';
  const sanitizedChanges = Array.isArray(entry.changes) && entry.changes.length > 0
    ? entry.changes.slice(0, 30).map((c) => ({
        field: String(c.field || '').slice(0, 80),
        label: String(c.label || '').slice(0, 120),
        category: c.category,
        previousValue: String(c.previousValue ?? '—').slice(0, 200),
        newValue: String(c.newValue ?? '—').slice(0, 200),
      }))
    : undefined;
  const nextEntry: MovementHistoryEntry = sanitizeFirestorePayload({
    timestamp: entry.timestamp,
    action: String(entry.action || 'Actualización de expediente').slice(0, 300),
    ...(entry.fromStatus ? { fromStatus: entry.fromStatus } : {}),
    toStatus: entry.toStatus,
    userId: entry.userId,
    userName: entry.userName,
    ...(entry.userRole ? { userRole: String(entry.userRole).slice(0, 64) } : {}),
    ...(trimmedNote ? { note: trimmedNote.slice(0, 500) } : {}),
    ...(sanitizedChanges ? { changes: sanitizedChanges } : {}),
  });
  return [...sanitizedExisting, nextEntry].slice(-50);
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

const APPLICATION_REQUIRED_KEYS = [
  'id',
  'organizationId',
  'applicationNumber',
  'fileNumber',
  'channel',
  'applicantType',
  'customerId',
  'applicantDisplayName',
  'productCode',
  'currency',
  'requestedAmount',
  'requestedTermMonths',
  'paymentFrequency',
  'amortizationMethod',
  'status',
  'createdBy',
  'createdAt',
  'updatedAt',
] as const;

const APPLICATION_ALLOWED_KEYS = new Set<string>([
  ...APPLICATION_REQUIRED_KEYS,
  'businessId',
  'loanPurpose',
  'loanPurposeDescription',
  'proposedCollateral',
  'financialData',
  'businessFinancialData',
  'verifiedFinancialData',
  'verifiedBusinessFinancialData',
  'references',
  'declaredDocumentsSummary',
  'prequalificationStatus',
  'latestScoringExecutionId',
  'latestScore',
  'latestRiskBand',
  'recommendedAmount',
  'recommendedRateMonthly',
  'recommendedTermMonths',
  'recommendedInstallment',
  'authorizedAlternateAmount',
  'alternateAmountAuthorizedBy',
  'consentVersion',
  'consentAcceptedAt',
  'assignedTo',
  'assignedToName',
  'originalRequestedConditions',
  'activeFinancialAnalysisId',
  'approvedEvaluationAnalysisId',
  'requiresHumanIntervention',
  'decisionQualificationStatus',
  'financialAnalysisVersion',
  'legalFeeMode',
  'interestOnlyPeriods',
  'installmentCount',
  'isRenewal',
  'renewalId',
  'renewalModality',
  'originLoanId',
  'originLoanNumber',
  'originPayoffSnapshot',
  'movementHistory',
  'createdByName',
]);

const VALID_APP_CHANNELS = new Set(['INTERNAL', 'EXTERNAL']);
const VALID_APPLICANT_TYPES = new Set(['INDIVIDUAL', 'BUSINESS']);
const VALID_PRODUCT_CODES = new Set([
  'PERSONAL_DOP',
  'EMPRESARIAL_DOP',
  'PERSONAL_USD',
  'EMPRESARIAL_USD',
]);
const VALID_CURRENCIES = new Set(['DOP', 'USD']);
const VALID_PAYMENT_FREQUENCIES = new Set(['DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL']);
const VALID_AMORTIZATION_METHODS = new Set(['SALDO_INSOLUTO', 'INTERES_FIJO']);
const VALID_APPLICATION_STATUSES = new Set([
  'BORRADOR',
  'RECIBIDA',
  'EN_EVALUACION',
  'EN_COMITE',
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'DEVUELTA',
  'RECHAZADA',
  'FORMALIZADA',
  'DESEMBOLSADA',
]);

function isFirestoreTimestampLike(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const candidate = val as { toDate?: unknown; _methodName?: unknown };
  return (
    typeof candidate.toDate === 'function' ||
    candidate._methodName === 'serverTimestamp'
  );
}

function isValidCreatedAtValue(val: unknown): boolean {
  if (isFirestoreTimestampLike(val)) return true;
  if (typeof val === 'string') {
    return val.length >= 10 && val.length <= 40;
  }
  return false;
}

function normalizePreservedCreatedAt(val: unknown): unknown {
  if (isFirestoreTimestampLike(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length >= 10 && trimmed.length <= 40) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString();
  }
  if (val && typeof val === 'object' && 'seconds' in (val as Record<string, unknown>)) {
    const sec = Number((val as { seconds?: unknown }).seconds);
    if (Number.isFinite(sec) && sec > 0) {
      return new Date(sec * 1000).toISOString();
    }
  }
  return serverTimestamp();
}

export function hasApplicationSchemaDrift(
  data: Record<string, unknown> | null | undefined,
  applicationId: string
): boolean {
  if (!data) return true;
  for (const key of APPLICATION_REQUIRED_KEYS) {
    if (!(key in data) || data[key] === undefined || data[key] === null) {
      return true;
    }
  }
  for (const key of Object.keys(data)) {
    if (!APPLICATION_ALLOWED_KEYS.has(key)) {
      return true;
    }
  }
  if (data.id !== applicationId || !VALID_ID_REGEX.test(String(data.id))) return true;
  if (typeof data.organizationId !== 'string' || !VALID_ID_REGEX.test(data.organizationId)) return true;
  if (typeof data.customerId !== 'string' || !VALID_ID_REGEX.test(data.customerId)) return true;
  if (typeof data.createdBy !== 'string' || !VALID_ID_REGEX.test(data.createdBy)) return true;
  if (
    typeof data.applicationNumber !== 'string' ||
    data.applicationNumber.length < 3 ||
    data.applicationNumber.length > 64
  ) {
    return true;
  }
  if (
    typeof data.fileNumber !== 'string' ||
    data.fileNumber.length < 3 ||
    data.fileNumber.length > 64
  ) {
    return true;
  }
  if (typeof data.channel !== 'string' || !VALID_APP_CHANNELS.has(data.channel)) return true;
  if (typeof data.applicantType !== 'string' || !VALID_APPLICANT_TYPES.has(data.applicantType)) {
    return true;
  }
  if (
    typeof data.applicantDisplayName !== 'string' ||
    data.applicantDisplayName.length < 1 ||
    data.applicantDisplayName.length > 200
  ) {
    return true;
  }
  if (typeof data.productCode !== 'string' || !VALID_PRODUCT_CODES.has(data.productCode)) {
    return true;
  }
  if (typeof data.currency !== 'string' || !VALID_CURRENCIES.has(data.currency)) return true;
  if (
    typeof data.requestedAmount !== 'number' ||
    !Number.isFinite(data.requestedAmount) ||
    data.requestedAmount < 0 ||
    data.requestedAmount > 100_000_000
  ) {
    return true;
  }
  if (
    typeof data.requestedTermMonths !== 'number' ||
    !Number.isFinite(data.requestedTermMonths) ||
    data.requestedTermMonths < 0 ||
    data.requestedTermMonths > 360
  ) {
    return true;
  }
  if (
    typeof data.paymentFrequency !== 'string' ||
    !VALID_PAYMENT_FREQUENCIES.has(data.paymentFrequency)
  ) {
    return true;
  }
  if (
    typeof data.amortizationMethod !== 'string' ||
    !VALID_AMORTIZATION_METHODS.has(data.amortizationMethod)
  ) {
    return true;
  }
  if (typeof data.status !== 'string' || !VALID_APPLICATION_STATUSES.has(data.status)) {
    return true;
  }
  if (
    'businessId' in data &&
    data.businessId !== null &&
    (typeof data.businessId !== 'string' || !VALID_ID_REGEX.test(data.businessId))
  ) {
    return true;
  }
  if (
    'loanPurpose' in data &&
    data.loanPurpose !== null &&
    (typeof data.loanPurpose !== 'string' || data.loanPurpose.length > 120)
  ) {
    return true;
  }
  if (
    'loanPurposeDescription' in data &&
    data.loanPurposeDescription !== null &&
    (typeof data.loanPurposeDescription !== 'string' || data.loanPurposeDescription.length > 1000)
  ) {
    return true;
  }
  if (
    'proposedCollateral' in data &&
    data.proposedCollateral !== null &&
    (typeof data.proposedCollateral !== 'string' || data.proposedCollateral.length > 500)
  ) {
    return true;
  }
  if ('financialData' in data && !isPlainObject(data.financialData)) return true;
  if (
    'businessFinancialData' in data &&
    data.businessFinancialData !== null &&
    !isPlainObject(data.businessFinancialData)
  ) {
    return true;
  }
  if (
    'verifiedFinancialData' in data &&
    data.verifiedFinancialData !== null &&
    !isPlainObject(data.verifiedFinancialData)
  ) {
    return true;
  }
  if (
    'verifiedBusinessFinancialData' in data &&
    data.verifiedBusinessFinancialData !== null &&
    !isPlainObject(data.verifiedBusinessFinancialData)
  ) {
    return true;
  }
  if ('references' in data && (!Array.isArray(data.references) || data.references.length > 4)) {
    return true;
  }
  if ('declaredDocumentsSummary' in data && !isPlainObject(data.declaredDocumentsSummary)) {
    return true;
  }
  if (
    'prequalificationStatus' in data &&
    data.prequalificationStatus !== null &&
    (typeof data.prequalificationStatus !== 'string' || data.prequalificationStatus.length > 64)
  ) {
    return true;
  }
  if (
    'latestScoringExecutionId' in data &&
    data.latestScoringExecutionId !== null &&
    (typeof data.latestScoringExecutionId !== 'string' ||
      !VALID_ID_REGEX.test(data.latestScoringExecutionId))
  ) {
    return true;
  }
  if (
    'latestScore' in data &&
    data.latestScore !== null &&
    (typeof data.latestScore !== 'number' ||
      !Number.isFinite(data.latestScore) ||
      data.latestScore < 0 ||
      data.latestScore > 100)
  ) {
    return true;
  }
  if (
    'latestRiskBand' in data &&
    data.latestRiskBand !== null &&
    (typeof data.latestRiskBand !== 'string' || data.latestRiskBand.length > 64)
  ) {
    return true;
  }
  for (const numKey of [
    'recommendedAmount',
    'recommendedRateMonthly',
    'recommendedTermMonths',
    'recommendedInstallment',
    'authorizedAlternateAmount',
  ]) {
    if (
      numKey in data &&
      data[numKey] !== null &&
      (typeof data[numKey] !== 'number' || !Number.isFinite(data[numKey] as number))
    ) {
      return true;
    }
  }
  if (
    'alternateAmountAuthorizedBy' in data &&
    data.alternateAmountAuthorizedBy !== null &&
    (typeof data.alternateAmountAuthorizedBy !== 'string' ||
      data.alternateAmountAuthorizedBy.length > 128)
  ) {
    return true;
  }
  if (
    'consentVersion' in data &&
    data.consentVersion !== null &&
    (typeof data.consentVersion !== 'string' || data.consentVersion.length > 40)
  ) {
    return true;
  }
  if (
    'consentAcceptedAt' in data &&
    data.consentAcceptedAt !== null &&
    data.consentAcceptedAt !== '' &&
    (typeof data.consentAcceptedAt !== 'string' ||
      data.consentAcceptedAt.length < 10 ||
      data.consentAcceptedAt.length > 40)
  ) {
    return true;
  }
  if (
    'assignedTo' in data &&
    data.assignedTo !== null &&
    (typeof data.assignedTo !== 'string' || data.assignedTo.length > 128)
  ) {
    return true;
  }
  if (
    'assignedToName' in data &&
    data.assignedToName !== null &&
    (typeof data.assignedToName !== 'string' || data.assignedToName.length > 160)
  ) {
    return true;
  }
  if (
    'originalRequestedConditions' in data &&
    data.originalRequestedConditions !== null &&
    !isPlainObject(data.originalRequestedConditions)
  ) {
    return true;
  }
  for (const optIdKey of ['activeFinancialAnalysisId', 'approvedEvaluationAnalysisId']) {
    if (
      optIdKey in data &&
      data[optIdKey] !== null &&
      (typeof data[optIdKey] !== 'string' || !VALID_ID_REGEX.test(data[optIdKey] as string))
    ) {
      return true;
    }
  }
  if (
    'requiresHumanIntervention' in data &&
    data.requiresHumanIntervention !== null &&
    typeof data.requiresHumanIntervention !== 'boolean'
  ) {
    return true;
  }
  if (
    'decisionQualificationStatus' in data &&
    data.decisionQualificationStatus !== null &&
    (typeof data.decisionQualificationStatus !== 'string' ||
      ![
        'CALIFICA_AUTO_EVALUACION',
        'REQUIERE_INTERVENCION_HUMANA',
        'REEVALUADA_APROBADA_EVALUACION',
        'DATOS_INSUFICIENTES',
      ].includes(data.decisionQualificationStatus))
  ) {
    return true;
  }
  if (
    'legalFeeMode' in data &&
    data.legalFeeMode !== null &&
    (typeof data.legalFeeMode !== 'string' ||
      !['DESCONTAR_DESEMBOLSO', 'FINANCIAR'].includes(data.legalFeeMode))
  ) {
    return true;
  }
  for (const nonNegKey of ['financialAnalysisVersion', 'interestOnlyPeriods', 'installmentCount']) {
    if (
      nonNegKey in data &&
      data[nonNegKey] !== null &&
      (typeof data[nonNegKey] !== 'number' ||
        !Number.isFinite(data[nonNegKey] as number) ||
        (data[nonNegKey] as number) < 0)
    ) {
      return true;
    }
  }
  if (
    'movementHistory' in data &&
    (!Array.isArray(data.movementHistory) || data.movementHistory.length > 50)
  ) {
    return true;
  }
  if (
    'createdByName' in data &&
    data.createdByName !== null &&
    (typeof data.createdByName !== 'string' || data.createdByName.length > 160)
  ) {
    return true;
  }
  if (!isValidCreatedAtValue(data.createdAt)) return true;
  if (!isFirestoreTimestampLike(data.updatedAt)) return true;
  return false;
}

const VALID_SCORING_STATUSES = new Set<ScoringExecutionRecord['status']>([
  'PREOFERTA',
  'SIN_OFERTA',
  'SIN_OFERTA_CAPACIDAD',
  'DATOS_INSUFICIENTES',
  'DATOS_INSUFICIENTES_DEUDA',
  'DATOS_INSUFICIENTES_CAMBIO',
  'SOLICITUD_FUERA_POLITICA',
  'ERROR_CALCULO',
]);

const VALID_EXECUTION_TRIGGERS = new Set<ScoringExecutionRecord['executionTrigger']>([
  'INITIAL_SUBMIT',
  'ANALYST_RECALC',
  'MANUAL_RERUN',
]);

export function sanitizeScoringExecutionPayload(
  scoring: Omit<ScoringExecutionRecord, 'executedAt'>
): ScoringExecutionRecord {
  const safeNum = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const safeExecId =
    typeof scoring.id === 'string' && VALID_ID_REGEX.test(scoring.id.trim())
      ? scoring.id.trim()
      : generateId('exec');
  const safeOrgId =
    typeof scoring.organizationId === 'string' && VALID_ID_REGEX.test(scoring.organizationId.trim())
      ? scoring.organizationId.trim()
      : DEFAULT_ORG_ID;
  const safeAppId =
    typeof scoring.applicationId === 'string' && VALID_ID_REGEX.test(scoring.applicationId.trim())
      ? scoring.applicationId.trim()
      : sanitizeIdSegment(String(scoring.applicationId || 'app')) || generateId('app');
  const safeExecutedBy =
    typeof scoring.executedBy === 'string' && VALID_ID_REGEX.test(scoring.executedBy.trim())
      ? scoring.executedBy.trim()
      : sanitizeIdSegment(String(scoring.executedBy || 'system')) || 'system';
  const safePolicyVersion = (String(scoring.policyVersion || '2.0.0-propuesta').trim() || '2.0.0-propuesta').slice(0, 40);
  const safePolicyStatus = String(scoring.policyStatus || 'EN_PRUEBAS').trim().slice(0, 40);
  const safeTrigger: ScoringExecutionRecord['executionTrigger'] = VALID_EXECUTION_TRIGGERS.has(
    scoring.executionTrigger
  )
    ? scoring.executionTrigger
    : 'INITIAL_SUBMIT';
  const safeStatus: ScoringExecutionRecord['status'] = VALID_SCORING_STATUSES.has(scoring.status)
    ? scoring.status
    : 'ERROR_CALCULO';
  const safeExecutedByName =
    typeof scoring.executedByName === 'string' && scoring.executedByName.trim().length > 0
      ? scoring.executedByName.trim().slice(0, 160)
      : safeExecutedBy.slice(0, 160);

  return cleanObject({
    id: safeExecId,
    organizationId: safeOrgId,
    applicationId: safeAppId,
    ...(typeof scoring.policyId === 'string' && scoring.policyId.trim().length > 0
      ? { policyId: scoring.policyId.trim().slice(0, 128) }
      : {}),
    policyVersion: safePolicyVersion,
    policyStatus: safePolicyStatus,
    executionTrigger: safeTrigger,
    ...(scoring.inputSnapshot && typeof scoring.inputSnapshot === 'object'
      ? { inputSnapshot: scoring.inputSnapshot }
      : {}),
    capacityResult:
      scoring.capacityResult && typeof scoring.capacityResult === 'object'
        ? scoring.capacityResult
        : ({
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
            incomeCurrency: 'DOP',
            loanCurrency: 'DOP',
            exchangeRateUsed: 1,
          } as ScoringExecutionRecord['capacityResult']),
    totalScore: Math.max(0, Math.min(100, safeNum(scoring.totalScore, 0))),
    ...(scoring.riskBand && typeof scoring.riskBand === 'object'
      ? { riskBand: scoring.riskBand }
      : {}),
    status: safeStatus,
    recommendedAmount: Math.max(0, safeNum(scoring.recommendedAmount, 0)),
    recommendedRateMonthly: normalizeMonthlyRateDecimal(
      safeNum(scoring.recommendedRateMonthly, 0),
      0
    ),
    recommendedTermMonths: Math.max(0, Math.round(safeNum(scoring.recommendedTermMonths, 0))),
    recommendedInstallment: Math.max(0, safeNum(scoring.recommendedInstallment, 0)),
    favorableFactors: Array.isArray(scoring.favorableFactors)
      ? scoring.favorableFactors.slice(0, 30)
      : [],
    alerts: Array.isArray(scoring.alerts) ? scoring.alerts.slice(0, 30) : [],
    missingData: Array.isArray(scoring.missingData) ? scoring.missingData.slice(0, 30) : [],
    currencyStressResults: scoring.currencyStressResults ?? null,
    indicatorDetails: Array.isArray(scoring.indicatorDetails) ? scoring.indicatorDetails : [],
    executedBy: safeExecutedBy,
    executedByName: safeExecutedByName,
    executedAt: serverTimestamp(),
  }) as ScoringExecutionRecord;
}

function buildMaterializedCustomerPayload(
  customer: CustomerRecord,
  organizationId: string,
  actorUid: string
): Record<string, unknown> {
  const safeId = sanitizeIdSegment(customer.id) || generateId('cust');
  const docNumClean = String(customer.documentNumber || '').trim();
  const safeDocNum =
    docNumClean.length >= 5 ? docNumClean.slice(0, 40) : `MIG-${safeId}`.slice(0, 40);
  const phoneClean = String(customer.phone || '').trim();
  const safePhone = phoneClean.length >= 7 ? phoneClean.slice(0, 40) : '809-000-0000';
  const safeFirstName = (String(customer.firstName || '').trim() || 'Cliente').slice(0, 120);
  const safeLastName = (String(customer.lastName || '').trim() || 'Registrado').slice(0, 120);
  const safeDocKey =
    customer.documentKey && customer.documentKey.length >= 6
      ? customer.documentKey.slice(0, 180)
      : `${organizationId}_${customer.documentType || 'CEDULA'}_${safeDocNum}_${safeId}`.slice(0, 180);

  return cleanObject({
    id: safeId,
    organizationId,
    documentType: customer.documentType === 'PASAPORTE' ? 'PASAPORTE' : 'CEDULA',
    documentNumber: safeDocNum,
    documentKey: safeDocKey,
    firstName: safeFirstName,
    lastName: safeLastName,
    ...(customer.birthDate ? { birthDate: String(customer.birthDate).slice(0, 20) } : {}),
    ...(customer.nationality ? { nationality: String(customer.nationality).slice(0, 80) } : {}),
    ...(customer.maritalStatus ? { maritalStatus: String(customer.maritalStatus).slice(0, 40) } : {}),
    phone: safePhone,
    ...(customer.altPhone ? { altPhone: String(customer.altPhone).slice(0, 40) } : {}),
    ...(customer.email ? { email: String(customer.email).slice(0, 254) } : {}),
    ...(customer.address ? { address: String(customer.address).slice(0, 300) } : {}),
    ...(customer.municipality ? { municipality: String(customer.municipality).slice(0, 100) } : {}),
    ...(customer.province ? { province: String(customer.province).slice(0, 100) } : {}),
    ...(typeof customer.residenceMonths === 'number' && Number.isFinite(customer.residenceMonths)
      ? { residenceMonths: Math.max(0, Math.min(1200, Math.round(customer.residenceMonths))) }
      : {}),
    ...(customer.housingType &&
    ['PROPIA', 'ALQUILADA', 'FAMILIAR', 'OTRA', 'NO_DECLARADA'].includes(customer.housingType)
      ? { housingType: customer.housingType }
      : {}),
    ...(typeof customer.housingPayment === 'number' && Number.isFinite(customer.housingPayment)
      ? { housingPayment: Math.max(0, customer.housingPayment) }
      : {}),
    ...(customer.socialMediaDeclared &&
    ['YES', 'NO_MEDIA', 'UNANSWERED'].includes(customer.socialMediaDeclared)
      ? { socialMediaDeclared: customer.socialMediaDeclared }
      : {}),
    ...(customer.socialMediaHandle
      ? { socialMediaHandle: String(customer.socialMediaHandle).slice(0, 120) }
      : {}),
    ...(customer.altContactName
      ? { altContactName: String(customer.altContactName).slice(0, 160) }
      : {}),
    ...(customer.altContactPhone
      ? { altContactPhone: String(customer.altContactPhone).slice(0, 40) }
      : {}),
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function buildMaterializedApplicationPayload(
  application: ApplicationRecord,
  updates: Partial<ApplicationRecord>,
  actorUid: string,
  actorName: string,
  options?: {
    preserveCreatedBy?: unknown;
    preserveCreatedAt?: unknown;
    preserveOrganizationId?: unknown;
  }
): Record<string, unknown> {
  const merged = { ...application, ...updates };
  const consentAt =
    typeof merged.consentAcceptedAt === 'string' && merged.consentAcceptedAt.trim().length >= 10
      ? merged.consentAcceptedAt.trim().slice(0, 40)
      : new Date().toISOString();

  const effectiveOrgId =
    typeof options?.preserveOrganizationId === 'string' &&
    VALID_ID_REGEX.test(options.preserveOrganizationId)
      ? options.preserveOrganizationId
      : merged.organizationId || DEFAULT_ORG_ID;

  const effectiveCreatedBy =
    typeof options?.preserveCreatedBy === 'string' && VALID_ID_REGEX.test(options.preserveCreatedBy)
      ? options.preserveCreatedBy
      : actorUid;

  const effectiveCreatedAt =
    options?.preserveCreatedAt !== undefined && options?.preserveCreatedAt !== null
      ? normalizePreservedCreatedAt(options.preserveCreatedAt)
      : serverTimestamp();

  const rawAppNum = String(merged.applicationNumber || merged.id || 'SOL').trim();
  const safeAppNum = (rawAppNum.length >= 3 ? rawAppNum : `SOL-${merged.id}`).slice(0, 64);
  const rawFileNum = String(merged.fileNumber || `EXP-${merged.id}`).trim();
  const safeFileNum = (rawFileNum.length >= 3 ? rawFileNum : `EXP-${merged.id}`).slice(0, 64);

  const safeCustomerId =
    typeof merged.customerId === 'string' && VALID_ID_REGEX.test(merged.customerId.trim())
      ? merged.customerId.trim()
      : sanitizeIdSegment(String(merged.customerId || merged.id)) || `cust_${merged.id}`.slice(0, 128);

  const safeBusinessId =
    typeof merged.businessId === 'string' && VALID_ID_REGEX.test(merged.businessId.trim())
      ? merged.businessId.trim()
      : null;

  const safeScoringExecId =
    typeof merged.latestScoringExecutionId === 'string' &&
    VALID_ID_REGEX.test(merged.latestScoringExecutionId.trim())
      ? merged.latestScoringExecutionId.trim()
      : null;

  const safeCurrency = merged.currency === 'USD' ? 'USD' : 'DOP';
  const safeApplicantType = merged.applicantType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
  const defaultProductCode =
    safeApplicantType === 'BUSINESS'
      ? safeCurrency === 'USD'
        ? 'EMPRESARIAL_USD'
        : 'EMPRESARIAL_DOP'
      : safeCurrency === 'USD'
      ? 'PERSONAL_USD'
      : 'PERSONAL_DOP';
  const safeProductCode = VALID_PRODUCT_CODES.has(String(merged.productCode))
    ? merged.productCode
    : defaultProductCode;
  const safeFrequency = VALID_PAYMENT_FREQUENCIES.has(String(merged.paymentFrequency))
    ? merged.paymentFrequency
    : 'MENSUAL';
  const safeAmortization = VALID_AMORTIZATION_METHODS.has(String(merged.amortizationMethod))
    ? merged.amortizationMethod
    : 'SALDO_INSOLUTO';
  const safeStatus = VALID_APPLICATION_STATUSES.has(String(merged.status))
    ? merged.status
    : 'RECIBIDA';

  const toFiniteNumOrNull = (val: unknown): number | null => {
    if (val === null) return null;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return cleanObject({
    id: merged.id,
    organizationId: effectiveOrgId,
    applicationNumber: safeAppNum,
    fileNumber: safeFileNum,
    channel: merged.channel === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
    applicantType: safeApplicantType,
    customerId: safeCustomerId,
    ...(safeBusinessId ? { businessId: safeBusinessId } : {}),
    applicantDisplayName: (String(merged.applicantDisplayName || '').trim() || 'Solicitante').slice(0, 200),
    productCode: safeProductCode,
    currency: safeCurrency,
    requestedAmount: Math.max(0, Math.min(100_000_000, Number(merged.requestedAmount) || 0)),
    requestedTermMonths: Math.max(0, Math.min(360, Math.round(Number(merged.requestedTermMonths) || 0))),
    paymentFrequency: safeFrequency,
    amortizationMethod: safeAmortization,
    ...(merged.loanPurpose ? { loanPurpose: String(merged.loanPurpose).slice(0, 120) } : {}),
    ...(merged.loanPurposeDescription
      ? { loanPurposeDescription: String(merged.loanPurposeDescription).slice(0, 1000) }
      : {}),
    ...(merged.proposedCollateral
      ? { proposedCollateral: String(merged.proposedCollateral).slice(0, 500) }
      : {}),
    ...(isPlainObject(merged.financialData) ? { financialData: merged.financialData } : {}),
    ...(merged.businessFinancialData !== undefined &&
    (merged.businessFinancialData === null || isPlainObject(merged.businessFinancialData))
      ? { businessFinancialData: merged.businessFinancialData }
      : {}),
    ...(merged.verifiedFinancialData !== undefined &&
    (merged.verifiedFinancialData === null || isPlainObject(merged.verifiedFinancialData))
      ? { verifiedFinancialData: merged.verifiedFinancialData }
      : {}),
    ...(merged.verifiedBusinessFinancialData !== undefined &&
    (merged.verifiedBusinessFinancialData === null ||
      isPlainObject(merged.verifiedBusinessFinancialData))
      ? { verifiedBusinessFinancialData: merged.verifiedBusinessFinancialData }
      : {}),
    references: Array.isArray(merged.references) ? merged.references.slice(0, 4) : [],
    ...(isPlainObject(merged.declaredDocumentsSummary)
      ? { declaredDocumentsSummary: merged.declaredDocumentsSummary }
      : {}),
    status: safeStatus,
    ...(merged.prequalificationStatus !== undefined
      ? {
          prequalificationStatus:
            merged.prequalificationStatus === null
              ? null
              : String(merged.prequalificationStatus).slice(0, 64),
        }
      : {}),
    ...(merged.latestScoringExecutionId !== undefined
      ? { latestScoringExecutionId: safeScoringExecId }
      : {}),
    ...(merged.latestScore !== undefined
      ? {
          latestScore:
            merged.latestScore === null
              ? null
              : Math.max(0, Math.min(100, Number(merged.latestScore) || 0)),
        }
      : {}),
    ...(merged.latestRiskBand !== undefined
      ? {
          latestRiskBand:
            merged.latestRiskBand === null ? null : String(merged.latestRiskBand).slice(0, 64),
        }
      : {}),
    ...(merged.recommendedAmount !== undefined
      ? { recommendedAmount: toFiniteNumOrNull(merged.recommendedAmount) }
      : {}),
    ...(merged.recommendedRateMonthly !== undefined
      ? {
          recommendedRateMonthly:
            merged.recommendedRateMonthly === null
              ? null
              : normalizeMonthlyRateDecimal(merged.recommendedRateMonthly, 0),
        }
      : {}),
    ...(merged.recommendedTermMonths !== undefined
      ? { recommendedTermMonths: toFiniteNumOrNull(merged.recommendedTermMonths) }
      : {}),
    ...(merged.recommendedInstallment !== undefined
      ? { recommendedInstallment: toFiniteNumOrNull(merged.recommendedInstallment) }
      : {}),
    ...(merged.authorizedAlternateAmount !== undefined
      ? { authorizedAlternateAmount: toFiniteNumOrNull(merged.authorizedAlternateAmount) }
      : {}),
    ...(merged.alternateAmountAuthorizedBy !== undefined
      ? {
          alternateAmountAuthorizedBy:
            merged.alternateAmountAuthorizedBy === null
              ? null
              : String(merged.alternateAmountAuthorizedBy).slice(0, 128),
        }
      : {}),
    ...(merged.originalRequestedConditions !== undefined &&
    (merged.originalRequestedConditions === null || isPlainObject(merged.originalRequestedConditions))
      ? { originalRequestedConditions: merged.originalRequestedConditions }
      : {}),
    ...(merged.activeFinancialAnalysisId !== undefined
      ? {
          activeFinancialAnalysisId:
            typeof merged.activeFinancialAnalysisId === 'string' &&
            VALID_ID_REGEX.test(merged.activeFinancialAnalysisId.trim())
              ? merged.activeFinancialAnalysisId.trim()
              : null,
        }
      : {}),
    ...(merged.approvedEvaluationAnalysisId !== undefined
      ? {
          approvedEvaluationAnalysisId:
            typeof merged.approvedEvaluationAnalysisId === 'string' &&
            VALID_ID_REGEX.test(merged.approvedEvaluationAnalysisId.trim())
              ? merged.approvedEvaluationAnalysisId.trim()
              : null,
        }
      : {}),
    ...(merged.requiresHumanIntervention !== undefined
      ? { requiresHumanIntervention: Boolean(merged.requiresHumanIntervention) }
      : {}),
    ...(merged.decisionQualificationStatus === null ||
    [
      'CALIFICA_AUTO_EVALUACION',
      'REQUIERE_INTERVENCION_HUMANA',
      'REEVALUADA_APROBADA_EVALUACION',
      'DATOS_INSUFICIENTES',
    ].includes(String(merged.decisionQualificationStatus))
      ? {
          decisionQualificationStatus:
            merged.decisionQualificationStatus === null
              ? null
              : String(merged.decisionQualificationStatus),
        }
      : {}),
    ...(merged.financialAnalysisVersion !== undefined
      ? { financialAnalysisVersion: toFiniteNumOrNull(merged.financialAnalysisVersion) }
      : {}),
    ...(merged.legalFeeMode === 'DESCONTAR_DESEMBOLSO' || merged.legalFeeMode === 'FINANCIAR'
      ? { legalFeeMode: merged.legalFeeMode }
      : {}),
    ...(merged.interestOnlyPeriods !== undefined
      ? {
          interestOnlyPeriods: Math.max(
            0,
            Math.min(360, Math.round(Number(merged.interestOnlyPeriods) || 0))
          ),
        }
      : {}),
    ...(merged.installmentCount !== undefined && Number(merged.installmentCount) > 0
      ? {
          installmentCount: Math.max(
            1,
            Math.min(10000, Math.round(Number(merged.installmentCount) || 1))
          ),
        }
      : {}),
    ...(merged.isRenewal !== undefined ? { isRenewal: Boolean(merged.isRenewal) } : {}),
    ...(typeof merged.renewalId === 'string' && VALID_ID_REGEX.test(merged.renewalId.trim())
      ? { renewalId: merged.renewalId.trim() }
      : {}),
    ...(merged.renewalModality === 'MISMAS_CONDICIONES' ||
    merged.renewalModality === 'AUMENTO_O_MODIFICACION'
      ? { renewalModality: merged.renewalModality }
      : {}),
    ...(typeof merged.originLoanId === 'string' && VALID_ID_REGEX.test(merged.originLoanId.trim())
      ? { originLoanId: merged.originLoanId.trim() }
      : {}),
    ...(typeof merged.originLoanNumber === 'string' && merged.originLoanNumber.trim()
      ? { originLoanNumber: merged.originLoanNumber.trim().slice(0, 64) }
      : {}),
    ...(isPlainObject(merged.originPayoffSnapshot)
      ? { originPayoffSnapshot: merged.originPayoffSnapshot }
      : {}),
    consentVersion: String(merged.consentVersion || 'v1.0-Ley172-13').slice(0, 40),
    consentAcceptedAt: consentAt,
    ...(merged.assignedTo !== undefined && merged.assignedTo !== null && String(merged.assignedTo).trim()
      ? { assignedTo: String(merged.assignedTo).trim().slice(0, 128) }
      : {}),
    ...(merged.assignedToName !== undefined &&
    merged.assignedToName !== null &&
    String(merged.assignedToName).trim()
      ? { assignedToName: String(merged.assignedToName).trim().slice(0, 160) }
      : {}),
    movementHistory: Array.isArray(merged.movementHistory)
      ? merged.movementHistory.slice(-50)
      : [],
    createdBy: effectiveCreatedBy,
    createdByName: (merged.createdByName || actorName || 'Usuario').slice(0, 160),
    createdAt: effectiveCreatedAt,
    updatedAt: serverTimestamp(),
  });
}

async function ensureApplicationPersistedInBatch(params: {
  batch: ReturnType<typeof writeBatch>;
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  user: UserProfile;
  updates: Partial<ApplicationRecord>;
  existingAppData?: Record<string, unknown> | null;
}): Promise<{ existed: boolean; organizationId: string; createdBy: string }> {
  const { batch, application, customer, user, updates } = params;
  const appRef = doc(db, 'applications', application.id);
  let existingData: Record<string, unknown> | null = params.existingAppData ?? null;

  if (existingData === null && params.existingAppData === undefined) {
    const existingAppSnap = await getDoc(appRef);
    existingData = existingAppSnap.exists()
      ? (existingAppSnap.data() as Record<string, unknown>)
      : null;
  }

  if (existingData) {
    const effectiveOrgId =
      typeof existingData.organizationId === 'string' && VALID_ID_REGEX.test(existingData.organizationId)
        ? existingData.organizationId
        : application.organizationId || user.organizationId || DEFAULT_ORG_ID;
    const effectiveCreatedBy =
      typeof existingData.createdBy === 'string' && VALID_ID_REGEX.test(existingData.createdBy)
        ? existingData.createdBy
        : user.uid;

    // Self-heal legacy/corrupt docs when an ADMIN performs the transition so isValidApplication never rejects the update.
    if ((user.role === 'ADMIN' || user.isSuperAdmin) && hasApplicationSchemaDrift(existingData, application.id)) {
      const mergedBase: ApplicationRecord = {
        ...application,
        ...(existingData as Partial<ApplicationRecord>),
        id: application.id,
        organizationId: effectiveOrgId,
      };
      batch.set(
        appRef,
        buildMaterializedApplicationPayload(
          mergedBase,
          updates,
          user.uid,
          user.displayName || user.email,
          {
            preserveOrganizationId: effectiveOrgId,
            preserveCreatedBy: effectiveCreatedBy,
            preserveCreatedAt: existingData.createdAt ?? serverTimestamp(),
          }
        )
      );
      return { existed: true, organizationId: effectiveOrgId, createdBy: effectiveCreatedBy };
    }

    batch.update(
      appRef,
      cleanObject({
        ...updates,
        updatedAt: serverTimestamp(),
      })
    );
    return { existed: true, organizationId: effectiveOrgId, createdBy: effectiveCreatedBy };
  }

  const effectiveOrgId = application.organizationId || user.organizationId || DEFAULT_ORG_ID;

  // Application not yet materialized in Firestore: materialize customer + application cleanly.
  if (application.customerId) {
    const custRef = doc(db, 'customers', application.customerId);
    const existingCustSnap = await getDoc(custRef).catch(() => null);
    if (!existingCustSnap?.exists()) {
      const fallbackCustomer: CustomerRecord = customer ?? {
        id: application.customerId,
        organizationId: effectiveOrgId,
        documentType: 'CEDULA',
        documentNumber: `MIG-${application.customerId}`.slice(0, 40),
        documentKey: `${effectiveOrgId}_CEDULA_${application.customerId}`.slice(0, 175),
        firstName: (application.applicantDisplayName || 'Cliente').split(/\s+/)[0] || 'Cliente',
        lastName:
          (application.applicantDisplayName || '').split(/\s+/).slice(1).join(' ') || 'Registrado',
        phone: '809-000-0000',
        createdBy: user.uid,
      };
      batch.set(
        custRef,
        buildMaterializedCustomerPayload(fallbackCustomer, effectiveOrgId, user.uid)
      );
    }
  }

  batch.set(
    appRef,
    buildMaterializedApplicationPayload(
      { ...application, organizationId: effectiveOrgId },
      updates,
      user.uid,
      user.displayName || user.email,
      { preserveOrganizationId: effectiveOrgId }
    )
  );
  return { existed: false, organizationId: effectiveOrgId, createdBy: user.uid };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildCustomerDocId(orgId: string, docType: string, docNum: string): string {
  const norm = sanitizeIdSegment(docNum.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return `cust_${sanitizeIdSegment(orgId)}_${sanitizeIdSegment(docType)}_${norm}`;
}

export function buildBusinessDocId(orgId: string, rnc: string): string {
  const norm = sanitizeIdSegment(rnc.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return `biz_${sanitizeIdSegment(orgId)}_${norm}`;
}

export async function runBackendDecisionEngine(payload: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  useVerifiedData?: boolean;
  executionTrigger: 'INITIAL_SUBMIT' | 'ANALYST_RECALC' | 'MANUAL_RERUN';
  executedBy: string;
  executedByName?: string;
}): Promise<Omit<ScoringExecutionRecord, 'executedAt'>> {
  const alignedCustomer: CustomerRecord = {
    ...payload.customer,
    organizationId: payload.application.organizationId || payload.customer.organizationId,
  };
  const requestPayload = {
    ...payload,
    customer: alignedCustomer,
  };

  try {
    const resp = await fetch('/api/engine/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });
    if (resp.ok) {
      return await resp.json();
    }
    const errBody = await resp.json().catch(() => ({}));
    if (resp.status >= 400 && resp.status < 500) {
      throw new Error(errBody.error || 'Error al ejecutar el Motor de Decisiones V2 en el servidor.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Violación de aislamiento Multi-Tenant')) {
      throw err;
    }
    // Fallback determinista local si el endpoint API no responde temporalmente
  }

  return evaluateCreditDecisionV2({
    application: requestPayload.application,
    customer: requestPayload.customer,
    policy: requestPayload.policy ?? DEFAULT_POLICY_V2,
    useVerifiedData: Boolean(requestPayload.useVerifiedData),
    executionTrigger: requestPayload.executionTrigger,
    executedBy: requestPayload.executedBy,
    executedByName: requestPayload.executedByName,
  });
}

export async function runBackendAmortization(payload: {
  financedPrincipal: number;
  monthlyRate: number;
  termMonths: number;
  frequency: string;
  amortizationMethod: string;
  disbursementDate: string;
  firstPaymentDate: string;
  perInstallmentOtherCharges?: number;
}) {
  const resp = await fetch('/api/amortization/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || 'Error calculando tabla de amortización.');
  }
  return resp.json();
}

export async function runBackendIntegratedDecisionAndCalculation(payload: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  analysisType: FinancialAnalysisRecord['analysisType'];
  version?: number;
  useVerifiedData?: boolean;
  alternativeConditions?: AlternativeConditionsOverrideInput | null;
  justification?: string | null;
  user: UserProfile;
}): Promise<IntegratedCreditEvaluationResult> {
  const alignedCustomer: CustomerRecord = {
    ...payload.customer,
    organizationId: payload.application.organizationId || payload.customer.organizationId,
  };
  const body = {
    application: payload.application,
    customer: alignedCustomer,
    policy: payload.policy,
    analysisType: payload.analysisType,
    version: payload.version ?? 1,
    useVerifiedData: Boolean(payload.useVerifiedData),
    alternativeConditions: payload.alternativeConditions ?? null,
    justification: payload.justification ?? null,
    actor: {
      uid: payload.user.uid,
      displayName: payload.user.displayName || payload.user.email || 'Usuario AxyCore',
      role: payload.user.role,
    },
  };

  try {
    const resp = await fetch('/api/applications/process-decision-and-calculation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      return (await resp.json()) as IntegratedCreditEvaluationResult;
    }
    const errBody = await resp.json().catch(() => ({}));
    if (resp.status === 403 || resp.status === 422) {
      throw new Error(errBody.error || 'Operación rechazada por políticas o permisos del servidor.');
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('Acceso denegado') ||
        err.message.includes('Violación de aislamiento') ||
        err.message.includes('Operación rechazada'))
    ) {
      throw err;
    }
    // Deterministic local fallback if dev server API is temporarily unreachable
  }

  return runIntegratedDecisionAndCalculation({
    application: payload.application,
    customer: alignedCustomer,
    policy: payload.policy ?? DEFAULT_POLICY_V2,
    analysisType: payload.analysisType,
    version: payload.version ?? 1,
    useVerifiedData: Boolean(payload.useVerifiedData),
    alternativeConditions: payload.alternativeConditions ?? null,
    justification: payload.justification ?? null,
    actor: {
      uid: payload.user.uid,
      displayName: payload.user.displayName || payload.user.email || 'Usuario AxyCore',
      role: payload.user.role,
    },
    intent: 'EVALUATE_ONLY',
  });
}

export async function runBackendHumanReevaluation(payload: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  version: number;
  alternativeConditions: AlternativeConditionsOverrideInput;
  justification?: string | null;
  user: UserProfile;
  intent: 'EVALUATE_ONLY' | 'SEND_TO_EVALUATION';
}): Promise<IntegratedCreditEvaluationResult> {
  if (!canUserExecuteHumanReevaluation(payload.user.role)) {
    throw new Error(
      `Acceso denegado: el rol ${payload.user.role} no tiene autorización para ejecutar reevaluación humana.`
    );
  }
  const alignedCustomer: CustomerRecord = {
    ...payload.customer,
    organizationId: payload.application.organizationId || payload.customer.organizationId,
  };

  const body = {
    application: payload.application,
    customer: alignedCustomer,
    policy: payload.policy,
    version: payload.version,
    alternativeConditions: payload.alternativeConditions,
    justification: payload.justification ?? null,
    actor: {
      uid: payload.user.uid,
      displayName: payload.user.displayName || payload.user.email || 'Analista AxyCore',
      role: payload.user.role,
    },
    actorOrganizationId: payload.user.organizationId,
    intent: payload.intent,
  };

  try {
    const resp = await fetch('/api/applications/reevaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      return (await resp.json()) as IntegratedCreditEvaluationResult;
    }
    const errBody = await resp.json().catch(() => ({}));
    if (resp.status >= 400 && resp.status < 500) {
      const reasons = Array.isArray(errBody.blockedReasons) && errBody.blockedReasons.length > 0
        ? ` (${errBody.blockedReasons.join('; ')})`
        : '';
      throw new Error(
        (errBody.error || 'Error validando reevaluación humana en el servidor.') + reasons
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('Acceso denegado') ||
        err.message.includes('Permiso insuficiente') ||
        err.message.includes('Violación de aislamiento') ||
        err.message.includes('No es posible enviar la solicitud'))
    ) {
      throw err;
    }
  }

  const localRes = runIntegratedDecisionAndCalculation({
    application: payload.application,
    customer: alignedCustomer,
    policy: payload.policy ?? DEFAULT_POLICY_V2,
    analysisType: 'REEVALUACION_HUMANA',
    version: payload.version,
    useVerifiedData: false,
    alternativeConditions: payload.alternativeConditions,
    justification: payload.justification ?? null,
    actor: {
      uid: payload.user.uid,
      displayName: payload.user.displayName || payload.user.email || 'Analista AxyCore',
      role: payload.user.role,
    },
    intent: payload.intent,
  });

  if (payload.intent === 'SEND_TO_EVALUATION' && !localRes.canSendToEvaluation) {
    throw new Error(
      `No es posible enviar la solicitud a Evaluación: ${localRes.sendToEvaluationBlockedReasons.join('; ')}`
    );
  }
  return localRes;
}

async function persistFinancialAnalysisInstallmentsChunked(
  installments: Array<Omit<FinancialAnalysisInstallmentRecord, 'createdAt'>>
): Promise<void> {
  if (!installments.length) return;
  const CHUNK_SIZE = 380;
  for (let i = 0; i < installments.length; i += CHUNK_SIZE) {
    const chunk = installments.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const row of chunk) {
      batch.set(
        doc(db, 'financial_analysis_installments', row.id),
        cleanObject({
          ...row,
          createdAt: serverTimestamp(),
        })
      );
    }
    await batch.commit();
  }
}

export async function fetchFinancialAnalysisInstallments(
  analysisId: string,
  organizationId: string
): Promise<FinancialAnalysisInstallmentRecord[]> {
  if (!analysisId || !organizationId) return [];
  const q = query(
    collection(db, 'financial_analysis_installments'),
    where('organizationId', '==', organizationId),
    where('analysisId', '==', analysisId)
  );
  try {
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as FinancialAnalysisInstallmentRecord)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'financial_analysis_installments');
  }
}

export async function dispatchEmailViaServerRelay(payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{
  delivered: boolean;
  deliveryChannel: EmailNotificationRecord['deliveryChannel'];
  providerMessageId?: string | null;
  reason?: string;
}> {
  const resp = await fetch('/api/notifications/dispatch-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  return {
    delivered: Boolean(data.delivered),
    deliveryChannel:
      (data.deliveryChannel as EmailNotificationRecord['deliveryChannel']) ||
      'CLOUD_FUNCTION_PENDING_SMTP',
    providerMessageId: data.providerMessageId ?? null,
    reason: data.reason ?? (!resp.ok ? 'Error en el servidor SMTP.' : undefined),
  };
}

export async function enqueueCustomerStatusEmail(params: {
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  eventCode: CustomerEmailEventCode;
  fromStatus?: string | null;
  toStatus: string;
  historyLength?: number;
  user: UserProfile;
  approvedAmount?: number | null;
  approvedRateMonthly?: number | null;
  approvedTermMonths?: number | null;
  conditions?: string[];
  rejectionReason?: string | null;
  observations?: string | null;
  amortizationSchedule?: Array<{
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    remainingPrincipalBalance: number;
  }>;
  paymentFrequency?: string;
  firstPaymentDate?: string;
  disbursementBank?: string;
  disbursementAccountMasked?: string;
  disbursementRef?: string;
  idempotencySuffix?: string;
}): Promise<EmailNotificationRecord | null> {
  try {
    const {
      application,
      eventCode,
      fromStatus,
      toStatus,
      historyLength,
      user,
      approvedAmount,
      approvedRateMonthly,
      approvedTermMonths,
      conditions,
      rejectionReason,
      observations,
      amortizationSchedule,
      paymentFrequency,
      firstPaymentDate,
      disbursementBank,
      disbursementAccountMasked,
      disbursementRef,
      idempotencySuffix,
    } = params;

    // Despacho no bloqueante de notificaciones Web Push VAPID ante cambio de estado de la solicitud
    void dispatchApplicationStatusChangePush({
      application: {
        ...application,
        status: toStatus as ApplicationStatus,
      },
      prevStatus: fromStatus ?? null,
      triggeredByUid: user.uid,
    }).catch(() => {});

    let customer = params.customer ?? null;
    if (!customer && application.customerId) {
      const custSnap = await getDoc(doc(db, 'customers', application.customerId)).catch(() => null);
      if (custSnap?.exists()) {
        customer = custSnap.data() as CustomerRecord;
      }
    }

    const orgSnap = await getDoc(doc(db, 'organizations', application.organizationId)).catch(() => null);
    const orgName = orgSnap?.exists()
      ? (orgSnap.data() as OrganizationRecord).name
      : 'AxyCore Servicios Financieros';

    const recipientEmail = (customer?.email || '').trim();
    const recipientName = customer
      ? `${customer.firstName} ${customer.lastName}`.trim() || application.applicantDisplayName
      : application.applicantDisplayName;

    const rendered = buildCustomerStatusEmailPayload({
      application,
      eventCode,
      recipientName,
      organizationName: orgName,
      approvedAmount,
      approvedRateMonthly,
      approvedTermMonths,
      conditions,
      rejectionReason,
      observations,
      amortizationSchedule,
      paymentFrequency,
      firstPaymentDate,
      disbursementBank,
      disbursementAccountMasked,
      disbursementRef,
    });

    const baseKey =
      eventCode === 'PENDIENTE_FIRMA'
        ? `${application.id}_PENDIENTE_FIRMA`
        : `${application.id}_${eventCode}_h${historyLength ?? application.movementHistory?.length ?? 0}`;
    const idempotencyKey = idempotencySuffix ? `${baseKey}_${idempotencySuffix}` : baseKey;

    // Evita duplicados por idempotencia si ya existe un registro idéntico
    const existingSnap = await getDocs(
      query(
        collection(db, 'email_notifications'),
        where('organizationId', '==', application.organizationId),
        where('idempotencyKey', '==', idempotencyKey)
      )
    ).catch(() => null);

    if (existingSnap && !existingSnap.empty) {
      return existingSnap.docs[0].data() as EmailNotificationRecord;
    }

    const notifId = generateId('notif');
    const isInternal = user.role !== 'EXTERNAL_CLIENT';

    // Para clientes externos, resolvemos primero el relay SMTP antes de crear el documento (evita requerir permisos de update)
    if (!isInternal) {
      let status: EmailNotificationRecord['status'] = recipientEmail ? 'PENDING_CLOUD_FUNCTION' : 'SKIPPED_NO_EMAIL';
      let deliveryChannel: EmailNotificationRecord['deliveryChannel'] = 'CLOUD_FUNCTION_PENDING_SMTP';
      let providerMessageId: string | null = null;
      let errorMessage: string | null = recipientEmail
        ? null
        : 'El cliente no tiene un correo electrónico registrado en su perfil.';
      let sentAt: string | null = null;

      if (recipientEmail) {
        const dispatchRes = await dispatchEmailViaServerRelay({
          to: recipientEmail,
          subject: rendered.subject,
          text: rendered.bodyText,
          html: rendered.bodyHtml,
        });
        deliveryChannel = dispatchRes.deliveryChannel;
        if (dispatchRes.delivered) {
          status = 'SENT';
          providerMessageId = dispatchRes.providerMessageId ?? null;
          sentAt = new Date().toISOString();
        } else {
          status =
            dispatchRes.deliveryChannel === 'CLOUD_FUNCTION_PENDING_SMTP'
              ? 'PENDING_CLOUD_FUNCTION'
              : 'FAILED';
          errorMessage = dispatchRes.reason ?? null;
        }
      }

      const extRecord: EmailNotificationRecord = cleanObject({
        id: notifId,
        organizationId: application.organizationId,
        applicationId: application.id,
        applicationNumber: application.applicationNumber,
        customerId: application.customerId,
        applicantUid: application.createdBy,
        recipientEmail,
        recipientName,
        eventCode,
        fromStatus: fromStatus ?? null,
        toStatus,
        subject: rendered.subject,
        bodyText: rendered.bodyText,
        bodyHtml: rendered.bodyHtml,
        deliveryChannel,
        status,
        providerMessageId,
        errorMessage,
        idempotencyKey,
        triggeredBy: user.uid,
        triggeredByName: user.displayName,
        sentAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'email_notifications', notifId), extRecord);
      return extRecord;
    }

    const initialStatus: EmailNotificationRecord['status'] = recipientEmail
      ? 'QUEUED'
      : 'SKIPPED_NO_EMAIL';

    const record: EmailNotificationRecord = cleanObject({
      id: notifId,
      organizationId: application.organizationId,
      applicationId: application.id,
      applicationNumber: application.applicationNumber,
      customerId: application.customerId,
      applicantUid: application.createdBy,
      recipientEmail,
      recipientName,
      eventCode,
      fromStatus: fromStatus ?? null,
      toStatus,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      deliveryChannel: 'CLOUD_FUNCTION_PENDING_SMTP',
      status: initialStatus,
      providerMessageId: null,
      errorMessage: recipientEmail
        ? null
        : 'El cliente no tiene un correo electrónico registrado en su perfil.',
      idempotencyKey,
      triggeredBy: user.uid,
      triggeredByName: user.displayName,
      sentAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const notifRef = doc(db, 'email_notifications', notifId);
    await setDoc(notifRef, record);

    if (!recipientEmail) {
      return record;
    }

    // Intentar despacho inmediato vía SMTP si está configurado; de lo contrario queda encolado para Cloud Functions
    const dispatchRes = await dispatchEmailViaServerRelay({
      to: recipientEmail,
      subject: rendered.subject,
      text: rendered.bodyText,
      html: rendered.bodyHtml,
    });

    if (dispatchRes.delivered) {
      const sentAtIso = new Date().toISOString();
      await updateDoc(notifRef, {
        status: 'SENT',
        deliveryChannel: dispatchRes.deliveryChannel,
        providerMessageId: dispatchRes.providerMessageId ?? null,
        errorMessage: null,
        sentAt: sentAtIso,
        updatedAt: serverTimestamp(),
      });
      return {
        ...record,
        status: 'SENT',
        deliveryChannel: dispatchRes.deliveryChannel,
        providerMessageId: dispatchRes.providerMessageId ?? null,
        sentAt: sentAtIso,
      };
    }

    const pendingStatus: EmailNotificationRecord['status'] =
      dispatchRes.deliveryChannel === 'CLOUD_FUNCTION_PENDING_SMTP'
        ? 'PENDING_CLOUD_FUNCTION'
        : 'FAILED';

    await updateDoc(notifRef, {
      status: pendingStatus,
      deliveryChannel: dispatchRes.deliveryChannel,
      errorMessage: dispatchRes.reason ?? null,
      updatedAt: serverTimestamp(),
    });

    return {
      ...record,
      status: pendingStatus,
      deliveryChannel: dispatchRes.deliveryChannel,
      errorMessage: dispatchRes.reason ?? null,
    };
  } catch (err) {
    console.warn('Email notification enqueue warning:', err);
    return null;
  }
}

export async function retryCustomerEmailNotification(
  notification: EmailNotificationRecord
): Promise<EmailNotificationRecord> {
  if (!notification.recipientEmail.trim()) {
    throw new Error('El cliente no tiene correo electrónico registrado en su expediente.');
  }

  const dispatchRes = await dispatchEmailViaServerRelay({
    to: notification.recipientEmail,
    subject: notification.subject,
    text: notification.bodyText,
    html: notification.bodyHtml,
  });

  const notifRef = doc(db, 'email_notifications', notification.id);

  if (dispatchRes.delivered) {
    const sentAtIso = new Date().toISOString();
    await updateDoc(notifRef, {
      status: 'SENT',
      deliveryChannel: dispatchRes.deliveryChannel,
      providerMessageId: dispatchRes.providerMessageId ?? null,
      errorMessage: null,
      sentAt: sentAtIso,
      updatedAt: serverTimestamp(),
    });
    return {
      ...notification,
      status: 'SENT',
      deliveryChannel: dispatchRes.deliveryChannel,
      providerMessageId: dispatchRes.providerMessageId ?? null,
      errorMessage: null,
      sentAt: sentAtIso,
    };
  }

  const nextStatus: EmailNotificationRecord['status'] =
    dispatchRes.deliveryChannel === 'CLOUD_FUNCTION_PENDING_SMTP'
      ? 'PENDING_CLOUD_FUNCTION'
      : 'FAILED';

  await updateDoc(notifRef, {
    status: nextStatus,
    deliveryChannel: dispatchRes.deliveryChannel,
    errorMessage: dispatchRes.reason ?? null,
    updatedAt: serverTimestamp(),
  });

  return {
    ...notification,
    status: nextStatus,
    deliveryChannel: dispatchRes.deliveryChannel,
    errorMessage: dispatchRes.reason ?? null,
  };
}

export async function bootstrapUserAndOrg(
  fbUser: FirebaseUser,
  preferredExternalOrgId?: string | null
): Promise<UserProfile> {
  const userRef = doc(db, 'users', fbUser.uid);
  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
  }

  let profile: UserProfile;
  const cleanEmail = normalizeEmailAddress(fbUser.email);
  const isPrimaryAdmin = isPrimarySuperAdminEmail(cleanEmail) && fbUser.emailVerified;

  if (isPrimaryAdmin) {
    const existingData = snap && snap.exists() ? (snap.data() as UserProfile) : null;
    const forcedAdminProfile = cleanObject({
      ...(existingData || {}),
      uid: fbUser.uid,
      email: cleanEmail || 'andrygallardo7@gmail.com',
      displayName: fbUser.displayName || existingData?.displayName || 'Andry Gallardo',
      role: 'ADMIN' as const,
      organizationId: existingData?.organizationId || DEFAULT_ORG_ID,
      isSuperAdmin: true,
      status: 'ACTIVE' as const,
      createdAt: existingData?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    try {
      await setDoc(userRef, forcedAdminProfile, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}`);
    }
    profile = {
      uid: forcedAdminProfile.uid,
      email: forcedAdminProfile.email,
      displayName: forcedAdminProfile.displayName,
      role: 'ADMIN',
      organizationId: forcedAdminProfile.organizationId,
      isSuperAdmin: true,
      status: 'ACTIVE',
    };
  } else {
    const existingProfile = snap && snap.exists() ? (snap.data() as UserProfile) : null;

    // 1. Deterministically check verifiable admin invitation in `user_invitations/{invId}`
    let pendingInvitation: UserInvitationRecord | null = null;
    if (cleanEmail) {
      const deterministicInviteId = buildDeterministicInvitationId(cleanEmail);
      const invRef = doc(db, 'user_invitations', deterministicInviteId);
      const invSnap = await getDoc(invRef).catch(() => null);
      if (invSnap && invSnap.exists()) {
        const invData = invSnap.data() as UserInvitationRecord;
        if (
          invData.status === 'INVITACION_ENVIADA' &&
          normalizeEmailAddress(invData.email) === cleanEmail
        ) {
          pendingInvitation = invData;
        }
      }
    }

    const decision = resolveInvitedUserBootstrap({
      uid: fbUser.uid,
      email: cleanEmail || 'sin-correo@axycore.local',
      authDisplayName: fbUser.displayName,
      existingProfile,
      pendingInvitation,
    });

    if (decision.shouldClaimInvitation && pendingInvitation && decision.invitationId) {
      const nowIso = new Date().toISOString();
      // Step 1: Create or upgrade `users/{uid}` while invitation status is still INVITACION_ENVIADA
      if (!existingProfile) {
        const claimedUserDoc = cleanObject({
          uid: fbUser.uid,
          email: cleanEmail || 'sin-correo@axycore.local',
          displayName: decision.displayName,
          role: decision.role,
          organizationId: decision.organizationId,
          status: 'ACTIVE' as const,
          invitationId: decision.invitationId,
          invitationStatus: 'CONFIRMADA' as const,
          invitedBy: decision.invitedBy,
          invitedAt: decision.invitedAt,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        try {
          await setDoc(userRef, claimedUserDoc);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}`);
        }
      } else {
        try {
          await updateDoc(
            userRef,
            cleanObject({
              displayName: decision.displayName,
              role: decision.role,
              status: 'ACTIVE' as const,
              organizationId: decision.organizationId,
              invitationId: decision.invitationId,
              invitationStatus: 'CONFIRMADA' as const,
              invitedBy: decision.invitedBy,
              invitedAt: decision.invitedAt,
              updatedAt: serverTimestamp(),
            })
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
        }
      }

      // Step 2: Create or activate `organization_memberships/{orgId}_{uid}`
      if (decision.membershipPayload) {
        const memRef = doc(db, 'organization_memberships', decision.membershipPayload.id);
        const existingMem = await getDoc(memRef).catch(() => null);
        if (!existingMem || !existingMem.exists()) {
          await setDoc(
            memRef,
            cleanObject({
              ...decision.membershipPayload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          ).catch((err) =>
            console.warn('No se pudo crear membresía de invitación automáticamente:', err)
          );
        } else if ((existingMem.data() as OrganizationMembershipRecord).status === 'INVITED') {
          await updateDoc(memRef, {
            status: 'ACTIVE',
            granularPermissions: decision.membershipPayload.granularPermissions,
            userDisplayName: decision.displayName,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      // Step 3: Seal invitation as ACCEPTED so it cannot be replayed
      const invRef = doc(db, 'user_invitations', decision.invitationId);
      await updateDoc(invRef, {
        status: 'ACCEPTED',
        acceptedUid: fbUser.uid,
        acceptedAt: nowIso,
        updatedAt: serverTimestamp(),
      }).catch((err) =>
        console.warn('No se pudo marcar la invitación como ACCEPTED:', err)
      );

      profile = {
        uid: fbUser.uid,
        email: cleanEmail || 'sin-correo@axycore.local',
        displayName: decision.displayName,
        role: decision.role,
        organizationId: decision.organizationId,
        status: 'ACTIVE',
        invitationId: decision.invitationId,
        invitationStatus: 'CONFIRMADA',
        invitedBy: decision.invitedBy,
        invitedAt: decision.invitedAt,
      };
    } else if (!existingProfile) {
      const boundOrgId =
        decision.role === 'EXTERNAL_CLIENT' && preferredExternalOrgId
          ? preferredExternalOrgId
          : decision.organizationId;
      const newProfile = cleanObject({
        uid: fbUser.uid,
        email: cleanEmail || 'sin-correo@axycore.local',
        displayName: decision.displayName,
        role: decision.role,
        organizationId: boundOrgId,
        status: 'ACTIVE' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      try {
        await setDoc(userRef, newProfile);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fbUser.uid}`);
      }
      profile = {
        uid: newProfile.uid,
        email: newProfile.email,
        displayName: newProfile.displayName,
        role: newProfile.role,
        organizationId: newProfile.organizationId,
        status: newProfile.status,
      };
    } else {
      profile = existingProfile;
      // If an external client opens a specific institution's portal link, scope their session strictly to that institution
      if (
        profile.role === 'EXTERNAL_CLIENT' &&
        preferredExternalOrgId &&
        profile.organizationId !== preferredExternalOrgId
      ) {
        try {
          await updateDoc(userRef, {
            organizationId: preferredExternalOrgId,
            linkedCustomerId: null,
            updatedAt: serverTimestamp(),
          });
          profile = {
            ...profile,
            organizationId: preferredExternalOrgId,
            linkedCustomerId: undefined,
          };
        } catch {
          // non-blocking
        }
      }
      // Confirm invitation if pending upon successful sign-in
      if (profile.invitationStatus === 'INVITACION_ENVIADA') {
        try {
          await updateDoc(userRef, {
            invitationStatus: 'CONFIRMADA',
            updatedAt: serverTimestamp(),
          });
          profile.invitationStatus = 'CONFIRMADA';
        } catch {
          // silent
        }
      }
      // Also activate any pre-existing INVITED membership for this UID
      const memId = `${profile.organizationId || DEFAULT_ORG_ID}_${fbUser.uid}`;
      const memRef = doc(db, 'organization_memberships', memId);
      const memSnap = await getDoc(memRef).catch(() => null);
      if (memSnap && memSnap.exists() && (memSnap.data() as OrganizationMembershipRecord).status === 'INVITED') {
        await updateDoc(memRef, {
          status: 'ACTIVE',
          granularPermissions: DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE[profile.role] || ['CONSULTAR'],
          userDisplayName: profile.displayName,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  }

  // Ensure SU GLORIA MANO AMIGA organization, license, subscription, and initial policy exist when Admin signs in
  if (profile.role === 'ADMIN' || isPrimaryAdmin) {
    const orgRef = doc(db, 'organizations', DEFAULT_ORG_ID);
    const orgSnap = await getDoc(orgRef).catch(() => null);
    if (orgSnap && !orgSnap.exists()) {
      const orgDoc: OrganizationRecord = cleanObject({
        ...SU_GLORIA_MANO_AMIGA_ORG,
        id: DEFAULT_ORG_ID,
        organizationId: DEFAULT_ORG_ID,
        name: 'SU GLORIA MANO AMIGA',
        tradeName: 'SU GLORIA MANO AMIGA',
        taxId: '1-31-98421-2',
        rnc: '1-31-98421-2',
        enabledModules: SU_GLORIA_ENABLED_MODULES,
        modulesEnabled: SU_GLORIA_ENABLED_MODULES,
        primaryAdminUid: fbUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(orgRef, orgDoc).catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `organizations/${DEFAULT_ORG_ID}`)
      );
    } else if (orgSnap && orgSnap.exists()) {
      const currentOrg = orgSnap.data() as OrganizationRecord;
      const baseEnabled =
        currentOrg.enabledModules && currentOrg.enabledModules.length > 0
          ? currentOrg.enabledModules
          : currentOrg.modulesEnabled || SU_GLORIA_ENABLED_MODULES;
      const explicitlyDisabled =
        typeof window !== 'undefined' &&
        window.localStorage.getItem(`axycore_ecf_disabled_${DEFAULT_ORG_ID}`) === 'true';
      const explicitlyDisabledAltera =
        typeof window !== 'undefined' &&
        window.localStorage.getItem(`axycore_altera_disabled_${DEFAULT_ORG_ID}`) === 'true';
      const explicitlyDisabledRegula =
        typeof window !== 'undefined' &&
        window.localStorage.getItem(`axycore_regula_disabled_${DEFAULT_ORG_ID}`) === 'true';
      const needsDgiiModuleBackfill =
        !explicitlyDisabled &&
        (!baseEnabled.includes('facturacion_electronica') ||
          !baseEnabled.includes('contabilidad') ||
          !(currentOrg.modulesEnabled || []).includes('facturacion_electronica'));
      const needsAlteraModuleBackfill =
        !explicitlyDisabledAltera &&
        (!baseEnabled.includes('altera') ||
          !(currentOrg.modulesEnabled || []).includes('altera'));
      const needsRegulaModuleBackfill =
        !explicitlyDisabledRegula &&
        (!baseEnabled.includes('regula') ||
          !(currentOrg.modulesEnabled || []).includes('regula'));
      if (
        !currentOrg.tradeName ||
        !currentOrg.rnc ||
        !currentOrg.modulesEnabled ||
        currentOrg.name === 'AxyCore Servicios Financieros' ||
        !currentOrg.enabledModules ||
        needsDgiiModuleBackfill ||
        needsAlteraModuleBackfill ||
        needsRegulaModuleBackfill
      ) {
        const mergedEnabled = Array.from(
          new Set([
            ...baseEnabled,
            ...(needsDgiiModuleBackfill ? (['contabilidad', 'facturacion_electronica'] as AxyCoreModuleCode[]) : []),
            ...(needsAlteraModuleBackfill ? (['altera'] as AxyCoreModuleCode[]) : []),
            ...(needsRegulaModuleBackfill ? (['regula'] as AxyCoreModuleCode[]) : []),
          ])
        );
        const upgradedOrg = cleanObject({
          ...SU_GLORIA_MANO_AMIGA_ORG,
          ...currentOrg,
          id: DEFAULT_ORG_ID,
          organizationId: DEFAULT_ORG_ID,
          tenantId: currentOrg.tenantId || SU_GLORIA_MANO_AMIGA_ORG.tenantId,
          accessCode: currentOrg.accessCode || SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001',
          name: 'SU GLORIA MANO AMIGA',
          legalName: currentOrg.legalName || SU_GLORIA_MANO_AMIGA_ORG.legalName,
          tradeName: 'SU GLORIA MANO AMIGA',
          taxId: currentOrg.taxId || currentOrg.rnc || SU_GLORIA_MANO_AMIGA_ORG.taxId || '1-31-98421-2',
          rnc: currentOrg.rnc || currentOrg.taxId || SU_GLORIA_MANO_AMIGA_ORG.rnc || '1-31-98421-2',
          status: currentOrg.status || 'ACTIVA',
          planCode: currentOrg.planCode || 'CORPORATIVO',
          licenseId: currentOrg.licenseId || 'lic_org_axycore_main',
          licenseStatus: currentOrg.licenseStatus || 'ACTIVA',
          licenseStartDate: currentOrg.licenseStartDate || SU_GLORIA_MANO_AMIGA_ORG.licenseStartDate,
          licenseEndDate: currentOrg.licenseEndDate || SU_GLORIA_MANO_AMIGA_ORG.licenseEndDate,
          maxUsers: currentOrg.maxUsers || 200,
          enabledModules: mergedEnabled,
          modulesEnabled: mergedEnabled,
          primaryAdminUid: currentOrg.primaryAdminUid || fbUser.uid,
          createdAt: currentOrg.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(orgRef, upgradedOrg).catch(async () => {
          await updateDoc(orgRef, {
            enabledModules: mergedEnabled,
            modulesEnabled: mergedEnabled,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        });
      }
    }

    // Ensure Su Gloria Mano Amiga License & Subscription exist
    if (isPrimaryAdmin) {
      const licRef = doc(db, 'licenses', 'lic_org_axycore_main');
      const licSnap = await getDoc(licRef).catch(() => null);
      if (licSnap && !licSnap.exists()) {
        const licDoc: TenantLicenseRecord = {
          id: 'lic_org_axycore_main',
          organizationId: DEFAULT_ORG_ID,
          organizationName: SU_GLORIA_MANO_AMIGA_ORG.name,
          planCode: 'CORPORATIVO',
          status: 'ACTIVA',
          startDate: '2025-01-01',
          endDate: '2027-12-31',
          maxUsers: 200,
          maxStorageGb: 500,
          maxMonthlyOperations: 250000,
          enabledModules: SU_GLORIA_ENABLED_MODULES,
          addonModules: [],
          aiEnabled: true,
          monthlyFeeUsd: 1490,
          currency: 'USD',
          notes: 'Licencia Corporativa Principal — SU GLORIA MANO AMIGA',
          updatedBy: fbUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(licRef, licDoc).catch(() => {});
      } else if (licSnap && licSnap.exists()) {
        const curLic = licSnap.data() as TenantLicenseRecord;
        const licExplicitlyDisabledRegula =
          typeof window !== 'undefined' &&
          window.localStorage.getItem(`axycore_regula_disabled_${DEFAULT_ORG_ID}`) === 'true';
        const licNeedsEcf = !curLic.enabledModules?.includes('facturacion_electronica');
        const licNeedsAltera = !curLic.enabledModules?.includes('altera');
        const licNeedsRegula =
          !licExplicitlyDisabledRegula && !curLic.enabledModules?.includes('regula');
        if (licNeedsEcf || licNeedsAltera || licNeedsRegula) {
          await setDoc(
            licRef,
            {
              ...curLic,
              enabledModules: Array.from(
                new Set([
                  ...(curLic.enabledModules || []),
                  ...(licNeedsEcf ? (['contabilidad', 'facturacion_electronica'] as AxyCoreModuleCode[]) : []),
                  ...(licNeedsAltera ? (['altera'] as AxyCoreModuleCode[]) : []),
                  ...(licNeedsRegula ? (['regula'] as AxyCoreModuleCode[]) : []),
                ])
              ),
              updatedBy: fbUser.uid,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {});
        }
      }

      const subRef = doc(db, 'subscriptions', 'sub_org_axycore_main');
      const subSnap = await getDoc(subRef).catch(() => null);
      if (subSnap && !subSnap.exists()) {
        const subDoc: TenantSubscriptionRecord = {
          id: 'sub_org_axycore_main',
          organizationId: DEFAULT_ORG_ID,
          organizationName: SU_GLORIA_MANO_AMIGA_ORG.name,
          licenseId: 'lic_org_axycore_main',
          planCode: 'CORPORATIVO',
          billingCycle: 'ANUAL',
          amount: 1490,
          currency: 'USD',
          status: 'ACTIVA',
          nextBillingDate: '2027-01-01',
          createdBy: fbUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(subRef, subDoc).catch(() => {});
      }
    }

    // Ensure Membership for current Admin in SU GLORIA MANO AMIGA (canonical ID `${orgId}_${uid}` matching firestore.rules `inSameOrg`)
    const memId = `${DEFAULT_ORG_ID}_${fbUser.uid}`;
    const memRef = doc(db, 'organization_memberships', memId);
    const memSnap = await getDoc(memRef).catch(() => null);
    if (memSnap && !memSnap.exists()) {
      const memDoc = cleanObject({
        id: memId,
        organizationId: DEFAULT_ORG_ID,
        organizationName: SU_GLORIA_MANO_AMIGA_ORG.name,
        userId: fbUser.uid,
        userEmail: profile.email,
        userDisplayName: profile.displayName,
        role: 'ADMIN' as const,
        status: 'ACTIVE' as const,
        granularPermissions: DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE.ADMIN,
        isPrimaryAdmin: true,
        invitedBy: fbUser.uid,
        createdBy: fbUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(memRef, memDoc).catch(() => {});
    }

    const polRef = doc(db, 'credit_policies', DEFAULT_POLICY_V2.id);
    const polSnap = await getDoc(polRef).catch(() => null);
    if (polSnap && !polSnap.exists()) {
      await setDoc(polRef, {
        ...DEFAULT_POLICY_V2,
        createdBy: fbUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch((err) =>
        handleFirestoreError(err, OperationType.CREATE, `credit_policies/${DEFAULT_POLICY_V2.id}`)
      );
    }
  }

  return profile;
}

export async function saveCustomerUnique(
  input: Omit<CustomerRecord, 'id' | 'documentKey' | 'createdAt' | 'updatedAt'>
): Promise<CustomerRecord> {
  const normDoc = input.documentNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normDoc.length < 5) {
    throw new Error('El número de cédula o pasaporte debe tener al menos 5 caracteres alfanuméricos.');
  }
  const customerId = buildCustomerDocId(input.organizationId, input.documentType, normDoc);
  const docKey = `${input.organizationId}_${input.documentType}_${normDoc}`;
  const ref = doc(db, 'customers', customerId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      throw new Error(
        `Ya existe un cliente registrado con ${input.documentType} ${input.documentNumber}. Se bloqueó la duplicación.`
      );
    }
    const record: CustomerRecord = cleanObject({
      ...input,
      id: customerId,
      documentNumber: input.documentNumber.trim(),
      documentKey: docKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const batch = writeBatch(db);
    batch.set(ref, record);
    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      organizationId: input.organizationId,
      eventType: 'CUSTOMER_CREATED',
      entityType: 'customers',
      entityId: customerId,
      action: `Registro de cliente ${input.firstName} ${input.lastName}`,
      newState: `${input.documentType}: ${input.documentNumber}`,
      transactionId: generateId('tx'),
      userId: input.createdBy,
      timestamp: serverTimestamp(),
    });
    await batch.commit();
    return record;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Ya existe un cliente')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `customers/${customerId}`);
  }
}

export interface CustomerUpdateInput {
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
  housingType?: CustomerRecord['housingType'];
  housingPayment?: number;
  socialMediaDeclared?: CustomerRecord['socialMediaDeclared'];
  socialMediaHandle?: string;
  altContactName?: string;
  altContactPhone?: string;
}

export async function updateCustomerRecord(params: {
  customer: CustomerRecord;
  updates: CustomerUpdateInput;
  user: UserProfile;
}): Promise<CustomerRecord> {
  const { customer, updates, user } = params;

  if (user.status !== 'ACTIVE') {
    throw new Error('Tu usuario está INACTIVO y no puede actualizar datos de clientes.');
  }
  if (user.role === 'EXTERNAL_CLIENT' || user.role === 'AUDITOR') {
    throw new Error(`El rol ${user.role} no tiene autorización para modificar expedientes de clientes.`);
  }
  if (!user.isSuperAdmin && customer.organizationId !== user.organizationId) {
    throw new Error('Aislamiento multi-tenant: no puedes modificar clientes de otra organización.');
  }

  const firstName = updates.firstName.trim();
  const lastName = updates.lastName.trim();
  const phone = updates.phone.trim();

  if (!firstName || firstName.length > 120) {
    throw new Error('El nombre del cliente es obligatorio (1–120 caracteres).');
  }
  if (!lastName || lastName.length > 120) {
    throw new Error('El apellido del cliente es obligatorio (1–120 caracteres).');
  }
  if (phone.length < 7 || phone.length > 40) {
    throw new Error('El teléfono principal debe contener entre 7 y 40 caracteres.');
  }

  const clampStr = (val: string | undefined, max: number): string => (val ?? '').trim().slice(0, max);
  const housingType: CustomerRecord['housingType'] =
    updates.housingType &&
    ['PROPIA', 'ALQUILADA', 'FAMILIAR', 'OTRA', 'NO_DECLARADA'].includes(updates.housingType)
      ? updates.housingType
      : customer.housingType || 'NO_DECLARADA';
  const socialMediaDeclared: CustomerRecord['socialMediaDeclared'] =
    updates.socialMediaDeclared &&
    ['YES', 'NO_MEDIA', 'UNANSWERED'].includes(updates.socialMediaDeclared)
      ? updates.socialMediaDeclared
      : customer.socialMediaDeclared || 'UNANSWERED';

  const residenceMonths = Math.max(
    0,
    Math.min(1200, Math.round(Number(updates.residenceMonths ?? customer.residenceMonths ?? 0) || 0))
  );
  const housingPayment = Math.max(
    0,
    Number(updates.housingPayment ?? customer.housingPayment ?? 0) || 0
  );

  const updatePayload = {
    firstName,
    lastName,
    birthDate: clampStr(updates.birthDate, 20),
    nationality: clampStr(updates.nationality, 80),
    maritalStatus: clampStr(updates.maritalStatus, 40),
    phone,
    altPhone: clampStr(updates.altPhone, 40),
    email: clampStr(updates.email, 254),
    address: clampStr(updates.address, 300),
    municipality: clampStr(updates.municipality, 100),
    province: clampStr(updates.province, 100),
    residenceMonths,
    housingType,
    housingPayment,
    socialMediaDeclared,
    socialMediaHandle: clampStr(updates.socialMediaHandle, 120),
    altContactName: clampStr(updates.altContactName, 160),
    altContactPhone: clampStr(updates.altContactPhone, 40),
  };

  const changedLabels: string[] = [];
  if (updatePayload.firstName !== customer.firstName || updatePayload.lastName !== customer.lastName) {
    changedLabels.push('Nombre');
  }
  if (updatePayload.phone !== customer.phone || updatePayload.altPhone !== (customer.altPhone || '')) {
    changedLabels.push('Teléfonos');
  }
  if (updatePayload.email !== (customer.email || '')) {
    changedLabels.push('Correo');
  }
  if (
    updatePayload.address !== (customer.address || '') ||
    updatePayload.province !== (customer.province || '') ||
    updatePayload.municipality !== (customer.municipality || '')
  ) {
    changedLabels.push('Domicilio');
  }
  if (
    updatePayload.housingType !== (customer.housingType || 'NO_DECLARADA') ||
    updatePayload.housingPayment !== (customer.housingPayment || 0)
  ) {
    changedLabels.push('Vivienda');
  }
  if (
    updatePayload.socialMediaDeclared !== (customer.socialMediaDeclared || 'UNANSWERED') ||
    updatePayload.socialMediaHandle !== (customer.socialMediaHandle || '')
  ) {
    changedLabels.push('Redes sociales');
  }
  if (
    updatePayload.altContactName !== (customer.altContactName || '') ||
    updatePayload.altContactPhone !== (customer.altContactPhone || '')
  ) {
    changedLabels.push('Contacto alterno');
  }

  const ref = doc(db, 'customers', customer.id);
  const existingSnap = await getDoc(ref).catch(() => null);
  const batch = writeBatch(db);
  if (existingSnap && existingSnap.exists()) {
    batch.update(ref, {
      ...updatePayload,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(ref, {
      id: customer.id,
      organizationId: customer.organizationId,
      documentType: customer.documentType,
      documentNumber: customer.documentNumber,
      documentKey: customer.documentKey,
      ...updatePayload,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: customer.organizationId,
      eventType: 'CUSTOMER_UPDATED',
      entityType: 'customers',
      entityId: customer.id,
      action: `Actualización de datos de ${firstName} ${lastName} (${customer.documentType}: ${customer.documentNumber})`.slice(
        0,
        200
      ),
      previousState: `${customer.firstName} ${customer.lastName} | Tel: ${customer.phone} | Dir: ${customer.address || '—'}`.slice(
        0,
        4000
      ),
      newState: `${firstName} ${lastName} | Tel: ${phone} | Dir: ${updatePayload.address || '—'}`.slice(
        0,
        4000
      ),
      justification: (
        changedLabels.length > 0
          ? `Campos actualizados: ${changedLabels.join(', ')}`
          : 'Confirmación y actualización de ficha de cliente'
      ).slice(0, 1000),
      transactionId: generateId('tx'),
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `customers/${customer.id}`);
  }

  return {
    ...customer,
    ...updatePayload,
  };
}

export async function saveBusinessUnique(
  input: Omit<BusinessRecord, 'id' | 'rncKey' | 'createdAt' | 'updatedAt'>
): Promise<BusinessRecord> {
  const normRnc = input.rnc.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normRnc.length < 6) {
    throw new Error('El RNC debe tener al menos 6 caracteres alfanuméricos.');
  }
  const bizId = buildBusinessDocId(input.organizationId, normRnc);
  const rncKey = `${input.organizationId}_RNC_${normRnc}`;
  const ref = doc(db, 'businesses', bizId);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      throw new Error(`Ya existe una empresa registrada con el RNC ${input.rnc}.`);
    }
    const record: BusinessRecord = cleanObject({
      ...input,
      id: bizId,
      rnc: input.rnc.trim(),
      rncKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(ref, record);
    return record;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Ya existe una empresa')) throw err;
    handleFirestoreError(err, OperationType.CREATE, `businesses/${bizId}`);
  }
}

export function buildApplicationConsentPayload(params: {
  consentId: string;
  organizationId: string;
  applicationId: string;
  customerId: string;
  consentVersion?: string | null;
  consentText?: string | null;
  acceptedBy: string;
}): Record<string, unknown> {
  const rawText = (params.consentText || '').trim();
  const safeAcceptedText =
    rawText.length >= 10
      ? rawText.slice(0, 2000)
      : 'Acepto los términos de la solicitud y autorizo el tratamiento de mis datos conforme a la Ley 172-13.';
  const safeVersion =
    (params.consentVersion || '').trim().slice(0, 40) || 'v1.0-Ley172-13';

  return {
    id: params.consentId,
    organizationId: params.organizationId,
    applicationId: params.applicationId,
    customerId: params.customerId,
    consentVersion: safeVersion,
    acceptedText: safeAcceptedText,
    accepted: true,
    acceptedBy: params.acceptedBy,
    acceptedAt: serverTimestamp(),
  };
}

export async function submitOrSaveApplication(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  mode: 'DRAFT' | 'SUBMIT';
  user: UserProfile;
  consentText?: string;
}): Promise<{
  application: ApplicationRecord;
  scoring?: ScoringExecutionRecord;
  financialAnalysis?: FinancialAnalysisRecord;
}> {
  const { application, customer, policy, mode, user, consentText } = params;
  const actorUid = auth.currentUser?.uid || user.uid;
  const effectiveOrgId =
    (application.organizationId && VALID_ID_REGEX.test(application.organizationId.trim())
      ? application.organizationId.trim()
      : null) ||
    (user.organizationId && VALID_ID_REGEX.test(user.organizationId.trim())
      ? user.organizationId.trim()
      : null) ||
    DEFAULT_ORG_ID;
  const safeActorName =
    (user.displayName || user.email || 'Solicitante').trim().slice(0, 160) || 'Solicitante';
  const normalizedApp: ApplicationRecord = {
    ...application,
    organizationId: effectiveOrgId,
    customerId: customer.id,
    createdBy: actorUid,
    createdByName: (application.createdByName || safeActorName).trim().slice(0, 160),
    requestedAmount: Math.max(0, Math.min(100_000_000, Number(application.requestedAmount) || 0)),
    requestedTermMonths: Math.max(0, Math.min(360, Math.round(Number(application.requestedTermMonths) || 0))),
  };

  const appRef = doc(db, 'applications', normalizedApp.id);
  const isExistingSnap = await getDoc(appRef).catch(() => null);
  const existingData = isExistingSnap?.exists()
    ? (isExistingSnap.data() as Record<string, unknown>)
    : null;
  const isExisting = Boolean(existingData);

  if (mode === 'DRAFT') {
    const draftPayload = buildMaterializedApplicationPayload(
      normalizedApp,
      { status: 'BORRADOR' },
      actorUid,
      safeActorName,
      {
        preserveOrganizationId: effectiveOrgId,
        preserveCreatedBy: existingData?.createdBy ?? actorUid,
        preserveCreatedAt: existingData?.createdAt,
      }
    ) as unknown as ApplicationRecord;

    try {
      if (isExisting) {
        if (user.role === 'ADMIN' && hasApplicationSchemaDrift(existingData, normalizedApp.id)) {
          const healedDraft = buildMaterializedApplicationPayload(
            {
              ...normalizedApp,
              ...(existingData as Partial<ApplicationRecord>),
              id: normalizedApp.id,
            },
            { ...draftPayload, status: 'BORRADOR' },
            actorUid,
            safeActorName,
            {
              preserveOrganizationId:
                typeof existingData?.organizationId === 'string' &&
                VALID_ID_REGEX.test(existingData.organizationId)
                  ? existingData.organizationId
                  : effectiveOrgId,
              preserveCreatedBy: existingData?.createdBy ?? actorUid,
              preserveCreatedAt: existingData?.createdAt,
            }
          );
          await setDoc(appRef, healedDraft);
        } else {
          await updateDoc(
            appRef,
            cleanObject({
              productCode: draftPayload.productCode,
              currency: draftPayload.currency,
              requestedAmount: draftPayload.requestedAmount,
              requestedTermMonths: draftPayload.requestedTermMonths,
              paymentFrequency: draftPayload.paymentFrequency,
              amortizationMethod: draftPayload.amortizationMethod,
              loanPurpose: draftPayload.loanPurpose ?? '',
              loanPurposeDescription: draftPayload.loanPurposeDescription ?? '',
              proposedCollateral: draftPayload.proposedCollateral ?? '',
              financialData: draftPayload.financialData,
              businessFinancialData: draftPayload.businessFinancialData ?? null,
              references: draftPayload.references ?? [],
              declaredDocumentsSummary: draftPayload.declaredDocumentsSummary,
              status: 'BORRADOR',
              movementHistory: draftPayload.movementHistory ?? [],
              updatedAt: serverTimestamp(),
            })
          );
        }
      } else {
        await setDoc(appRef, draftPayload);
      }
      return { application: draftPayload };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `applications/${normalizedApp.id}`);
    }
  }

  // SUBMIT mode: Automatically execute Decision Engine V2 + Financial Calculation Engine (Stage 1 -> 3)
  const originalConditionsSnapshot = buildOriginalRequestedConditions(normalizedApp);
  const integrated = await runBackendIntegratedDecisionAndCalculation({
    application: {
      ...normalizedApp,
      originalRequestedConditions: originalConditionsSnapshot,
    },
    customer: { ...customer, organizationId: effectiveOrgId },
    policy,
    analysisType: 'SOLICITUD_INICIAL',
    version: 1,
    useVerifiedData: false,
    user: { ...user, uid: actorUid },
  });

  const scoringResult = integrated.scoring;
  const nowIso = new Date().toISOString();
  const autoQualifiedToEval = integrated.canAutoAdvanceToEvaluation;
  const targetPostSubmitStatus: ApplicationStatus = autoQualifiedToEval
    ? 'EN_EVALUACION'
    : 'RECIBIDA';

  const updatedHistory = appendMovementHistory(normalizedApp.movementHistory, {
    timestamp: nowIso,
    action: autoQualifiedToEval
      ? `Solicitud recibida, calificada por Motor V2 (Score ${scoringResult.totalScore}/100) y cálculo financiero conciliado -> paso automático a Evaluación`
      : `Solicitud recibida y evaluada por Motor V2 (${scoringResult.status}, Score ${scoringResult.totalScore}/100) -> requiere intervención humana`,
    fromStatus: normalizedApp.status,
    toStatus: targetPostSubmitStatus,
    userId: actorUid,
    userName: safeActorName,
    userRole: user.role,
    note: integrated.analysis.decisionSummary.explanation,
  });

  const execPayload = sanitizeScoringExecutionPayload({
    ...scoringResult,
    organizationId: effectiveOrgId,
    applicationId: normalizedApp.id,
    executedBy: actorUid,
    executedByName: safeActorName,
  });

  const canPersistScoring =
    Array.isArray(execPayload.indicatorDetails) &&
    (execPayload.indicatorDetails.length === 22 || execPayload.status === 'ERROR_CALCULO');

  const analysisPayload = cleanObject({
    ...integrated.analysis,
    organizationId: effectiveOrgId,
    applicationId: normalizedApp.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    calculatedBy: actorUid,
    calculatedByName: safeActorName,
    calculatedByRole: user.role,
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const decisionHistoryPayload = cleanObject({
    ...integrated.decisionHistory,
    organizationId: effectiveOrgId,
    applicationId: normalizedApp.id,
    analysisId: integrated.analysis.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    newStatus: targetPostSubmitStatus,
    actorId: actorUid,
    actorName: safeActorName,
    actorRole: user.role,
    createdAt: serverTimestamp(),
  });

  const finalApp = buildMaterializedApplicationPayload(
    normalizedApp,
    {
      status: targetPostSubmitStatus,
      prequalificationStatus: execPayload.status,
      latestScoringExecutionId: canPersistScoring ? execPayload.id : null,
      latestScore: execPayload.totalScore,
      latestRiskBand: execPayload.riskBand?.code ?? scoringResult.riskBand?.code ?? 'CRITICO',
      recommendedAmount: execPayload.recommendedAmount,
      recommendedRateMonthly: execPayload.recommendedRateMonthly,
      recommendedTermMonths: execPayload.recommendedTermMonths,
      recommendedInstallment:
        integrated.analysis.financialSummary?.initialInstallment ?? execPayload.recommendedInstallment,
      originalRequestedConditions: originalConditionsSnapshot,
      activeFinancialAnalysisId: integrated.analysis.id,
      approvedEvaluationAnalysisId: autoQualifiedToEval ? integrated.analysis.id : null,
      requiresHumanIntervention: !autoQualifiedToEval,
      decisionQualificationStatus: integrated.decisionQualificationStatus,
      financialAnalysisVersion: 1,
      legalFeeMode: originalConditionsSnapshot.legalFeeMode,
      interestOnlyPeriods: originalConditionsSnapshot.interestOnlyPeriods,
      installmentCount: originalConditionsSnapshot.installmentCount,
      consentAcceptedAt:
        normalizedApp.consentAcceptedAt && normalizedApp.consentAcceptedAt.length >= 10
          ? normalizedApp.consentAcceptedAt
          : nowIso,
      consentVersion: normalizedApp.consentVersion || 'v1.0-Ley172-13',
      movementHistory: updatedHistory,
    },
    actorUid,
    safeActorName,
    {
      preserveOrganizationId: effectiveOrgId,
      preserveCreatedBy: existingData?.createdBy ?? actorUid,
      preserveCreatedAt: existingData?.createdAt,
    }
  ) as unknown as ApplicationRecord;

  const existingUpdatePayload = cleanObject({
    productCode: finalApp.productCode,
    currency: finalApp.currency,
    requestedAmount: finalApp.requestedAmount,
    requestedTermMonths: finalApp.requestedTermMonths,
    paymentFrequency: finalApp.paymentFrequency,
    amortizationMethod: finalApp.amortizationMethod,
    loanPurpose: finalApp.loanPurpose ?? '',
    loanPurposeDescription: finalApp.loanPurposeDescription ?? '',
    proposedCollateral: finalApp.proposedCollateral ?? '',
    financialData: finalApp.financialData,
    businessFinancialData: finalApp.businessFinancialData ?? null,
    references: finalApp.references ?? [],
    declaredDocumentsSummary: finalApp.declaredDocumentsSummary,
    status: targetPostSubmitStatus,
    prequalificationStatus: finalApp.prequalificationStatus,
    latestScoringExecutionId: finalApp.latestScoringExecutionId ?? null,
    latestScore: finalApp.latestScore,
    latestRiskBand: finalApp.latestRiskBand,
    recommendedAmount: finalApp.recommendedAmount,
    recommendedRateMonthly: finalApp.recommendedRateMonthly,
    recommendedTermMonths: finalApp.recommendedTermMonths,
    recommendedInstallment: finalApp.recommendedInstallment,
    originalRequestedConditions: originalConditionsSnapshot,
    activeFinancialAnalysisId: integrated.analysis.id,
    approvedEvaluationAnalysisId: autoQualifiedToEval ? integrated.analysis.id : null,
    requiresHumanIntervention: !autoQualifiedToEval,
    decisionQualificationStatus: integrated.decisionQualificationStatus,
    financialAnalysisVersion: 1,
    legalFeeMode: originalConditionsSnapshot.legalFeeMode,
    interestOnlyPeriods: originalConditionsSnapshot.interestOnlyPeriods,
    installmentCount: originalConditionsSnapshot.installmentCount,
    consentVersion: finalApp.consentVersion,
    consentAcceptedAt: finalApp.consentAcceptedAt,
    movementHistory: updatedHistory,
    updatedAt: serverTimestamp(),
  });

  const consentId = generateId('consent');
  const consentPayload = buildApplicationConsentPayload({
    consentId,
    organizationId: effectiveOrgId,
    applicationId: normalizedApp.id,
    customerId: customer.id,
    consentVersion: finalApp.consentVersion,
    consentText,
    acceptedBy: actorUid,
  });

  const auditId = generateId('audit');
  const auditPayload = {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: autoQualifiedToEval
        ? 'APPLICATION_AUTO_QUALIFIED_TO_EVALUATION'
        : 'APPLICATION_SUBMITTED_REQUIRES_INTERVENTION',
      entityType: 'applications',
      entityId: normalizedApp.id,
      action: `Originación ${finalApp.applicationNumber} (${finalApp.channel}) + Score ${execPayload.totalScore}/100 + Análisis ${integrated.analysis.id} -> ${targetPostSubmitStatus}`,
      newState: `${targetPostSubmitStatus} | ${integrated.decisionQualificationStatus}`,
      transactionId: integrated.analysis.idempotencyKey,
      engineVersion: policy.version,
      userId: actorUid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  };

  const shouldSelfHealExisting =
    isExisting && user.role === 'ADMIN' && hasApplicationSchemaDrift(existingData, normalizedApp.id);

  const batch = writeBatch(db);
  if (isExisting) {
    if (shouldSelfHealExisting) {
      batch.set(appRef, finalApp);
    } else {
      batch.update(appRef, existingUpdatePayload);
    }
  } else {
    batch.set(appRef, finalApp);
  }
  if (canPersistScoring) {
    batch.set(doc(db, 'scoring_executions', execPayload.id), execPayload);
  }
  batch.set(doc(db, 'financial_analyses', integrated.analysis.id), analysisPayload);
  batch.set(doc(db, 'application_decision_history', integrated.decisionHistory.id), decisionHistoryPayload);
  batch.set(doc(db, 'application_consents', consentId), consentPayload);
  batch.set(doc(db, 'audit_logs', auditId), auditPayload);

  try {
    await batch.commit();
  } catch (batchErr) {
    try {
      if (isExisting) {
        if (shouldSelfHealExisting) {
          await setDoc(appRef, finalApp);
        } else {
          await updateDoc(appRef, existingUpdatePayload);
        }
      } else {
        await setDoc(appRef, finalApp);
      }
    } catch (appErr) {
      const schemaDrift = hasApplicationSchemaDrift(
        finalApp as unknown as Record<string, unknown>,
        normalizedApp.id
      );
      const diag = {
        isExisting,
        status: finalApp.status,
        orgId: finalApp.organizationId,
        uidMatch: finalApp.createdBy === auth.currentUser?.uid,
        schemaDrift,
        keysCount: Object.keys(finalApp).length,
        extraKeys: Object.keys(finalApp).filter((k) => !APPLICATION_ALLOWED_KEYS.has(k)),
        faIdValid:
          !finalApp.activeFinancialAnalysisId ||
          VALID_ID_REGEX.test(String(finalApp.activeFinancialAnalysisId)),
        execIdValid:
          !finalApp.latestScoringExecutionId ||
          VALID_ID_REGEX.test(String(finalApp.latestScoringExecutionId)),
        custIdValid: VALID_ID_REGEX.test(String(finalApp.customerId || '')),
        batchErrMsg: batchErr instanceof Error ? batchErr.message : String(batchErr),
      };
      console.error('Application write diagnostic (non-PII):', JSON.stringify(diag));
      handleFirestoreError(appErr, OperationType.WRITE, `applications/${normalizedApp.id}`);
    }

    const secondaryWrites: Array<Promise<void>> = [];
    if (canPersistScoring) {
      secondaryWrites.push(
        setDoc(doc(db, 'scoring_executions', execPayload.id), execPayload).catch((err) => {
          console.warn('Scoring execution write warning after application creation:', err);
        })
      );
    }
    secondaryWrites.push(
      setDoc(doc(db, 'financial_analyses', integrated.analysis.id), analysisPayload).catch((err) => {
        console.warn('Financial analysis write warning after application creation:', err);
      })
    );
    secondaryWrites.push(
      setDoc(
        doc(db, 'application_decision_history', integrated.decisionHistory.id),
        decisionHistoryPayload
      ).catch((err) => {
        console.warn('Decision history write warning after application creation:', err);
      })
    );
    secondaryWrites.push(
      setDoc(doc(db, 'application_consents', consentId), consentPayload).catch((err) => {
        console.warn('Consent record write warning after application creation:', err);
      })
    );
    secondaryWrites.push(
      setDoc(doc(db, 'audit_logs', auditId), auditPayload).catch((err) => {
        console.warn('Audit log write warning after application creation:', err);
      })
    );
    await Promise.all(secondaryWrites);
    console.warn('Application submitted via 2-phase fallback after batch error:', batchErr);
  }

  // Persist individual amortization installments idempotently (deterministic IDs per analysisId + cuota)
  if (integrated.installments.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      integrated.installments.map((row) => ({
        ...row,
        organizationId: effectiveOrgId,
        applicationId: normalizedApp.id,
      }))
    ).catch((err) => {
      console.warn('Installments chunk write warning after application submit:', err);
    });
  }

  await enqueueCustomerStatusEmail({
    application: finalApp,
    customer,
    eventCode: autoQualifiedToEval ? 'EN_EVALUACION' : 'RECIBIDA',
    fromStatus: normalizedApp.status,
    toStatus: targetPostSubmitStatus,
    historyLength: updatedHistory.length,
    user,
  }).catch((err) => {
    console.warn('Customer status email notification skipped after submit:', err);
  });

  return {
    application: finalApp,
    scoring: execPayload,
    financialAnalysis: {
      ...integrated.analysis,
      calculatedAt: nowIso,
      updatedAt: nowIso,
    } as FinancialAnalysisRecord,
  };
}

export async function runHumanReevaluationAndPersist(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  existingAnalyses: FinancialAnalysisRecord[];
  alternativeConditions: AlternativeConditionsOverrideInput;
  justification?: string | null;
  user: UserProfile;
}): Promise<{
  result: IntegratedCreditEvaluationResult;
  analysis: FinancialAnalysisRecord;
}> {
  const { application, customer, policy, existingAnalyses, alternativeConditions, justification, user } =
    params;

  if (!canUserExecuteHumanReevaluation(user.role)) {
    throw new Error(
      `Acceso denegado: el rol ${user.role} no está autorizado para ejecutar reevaluación humana.`
    );
  }
  if (
    (alternativeConditions.useSuggestedRate === false ||
      alternativeConditions.customLegalFeesAmount !== undefined ||
      alternativeConditions.manualExchangeRate !== undefined) &&
    !canUserOverrideRateOrFees(user.role)
  ) {
    throw new Error(
      `Permiso insuficiente: el rol ${user.role} no puede modificar tasa, gastos legales o tipo de cambio manualmente.`
    );
  }

  const maxPrevVersion = existingAnalyses.reduce((m, a) => Math.max(m, a.version || 0), 0);
  const nextVersion = Math.max(2, maxPrevVersion + 1);
  const effectiveOrgId = application.organizationId || user.organizationId || DEFAULT_ORG_ID;

  const result = await runBackendHumanReevaluation({
    application: { ...application, organizationId: effectiveOrgId },
    customer: { ...customer, organizationId: effectiveOrgId },
    policy,
    version: nextVersion,
    alternativeConditions,
    justification,
    user,
    intent: 'EVALUATE_ONLY',
  });

  const nowIso = new Date().toISOString();
  const execPayload = sanitizeScoringExecutionPayload({
    ...result.scoring,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    executedBy: user.uid,
    executedByName: user.displayName,
  });
  const canPersistScoring =
    Array.isArray(execPayload.indicatorDetails) && execPayload.indicatorDetails.length === 22;

  const analysisPayload = cleanObject({
    ...result.analysis,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    status: 'VIGENTE' as const,
    calculatedBy: user.uid,
    calculatedByName: user.displayName,
    calculatedByRole: user.role,
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const historyPayload = cleanObject({
    ...result.decisionHistory,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    analysisId: result.analysis.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    actorId: user.uid,
    actorName: user.displayName,
    actorRole: user.role,
    createdAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  // Preserve prior analyses by marking previously active VIGENTE versions as HISTORICO (never delete!)
  for (const prev of existingAnalyses) {
    if (prev.id !== result.analysis.id && prev.status === 'VIGENTE') {
      batch.update(doc(db, 'financial_analyses', prev.id), {
        status: 'HISTORICO',
        updatedAt: serverTimestamp(),
      });
    }
  }
  if (canPersistScoring) {
    batch.set(doc(db, 'scoring_executions', execPayload.id), execPayload);
  }
  batch.set(doc(db, 'financial_analyses', result.analysis.id), analysisPayload);
  batch.set(doc(db, 'application_decision_history', result.decisionHistory.id), historyPayload);

  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: `Reevaluación humana v${nextVersion}: ${
      result.analysis.decisionSummary.qualifiesForCalculated
        ? 'Cumple políticas (lista para enviar a Evaluación)'
        : 'Aún requiere ajuste de condiciones'
    }`,
    fromStatus: application.status,
    toStatus: application.status,
    userId: user.uid,
    userName: user.displayName,
    userRole: user.role,
    note: justification?.trim() || result.analysis.decisionSummary.explanation,
  });

  batch.update(
    doc(db, 'applications', application.id),
    cleanObject({
      originalRequestedConditions:
        application.originalRequestedConditions ?? result.analysis.originalRequestedConditions,
      activeFinancialAnalysisId: result.analysis.id,
      financialAnalysisVersion: nextVersion,
      prequalificationStatus: execPayload.status,
      ...(canPersistScoring ? { latestScoringExecutionId: execPayload.id } : {}),
      latestScore: execPayload.totalScore,
      latestRiskBand: execPayload.riskBand.code,
      recommendedAmount: execPayload.recommendedAmount,
      recommendedRateMonthly: execPayload.recommendedRateMonthly,
      recommendedTermMonths: execPayload.recommendedTermMonths,
      recommendedInstallment:
        result.analysis.financialSummary?.initialInstallment ?? execPayload.recommendedInstallment,
      movementHistory: newHistory,
      updatedAt: serverTimestamp(),
    })
  );

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: 'APPLICATION_HUMAN_REEVALUATION',
      entityType: 'applications',
      entityId: application.id,
      action: `Reevaluación humana v${nextVersion} (${result.analysis.id}) · Score ${execPayload.totalScore}/100`,
      previousState: application.status,
      newState: application.status,
      justification: justification?.trim() || 'Simulación de condiciones alternativas',
      transactionId: result.analysis.idempotencyKey,
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `financial_analyses/${result.analysis.id}`);
  }

  if (result.installments.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      result.installments.map((r) => ({
        ...r,
        organizationId: effectiveOrgId,
        applicationId: application.id,
      }))
    );
  }

  return {
    result,
    analysis: {
      ...result.analysis,
      status: 'VIGENTE',
      calculatedAt: nowIso,
      updatedAt: nowIso,
    } as FinancialAnalysisRecord,
  };
}

export async function sendReevaluatedApplicationToEvaluation(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  existingAnalyses: FinancialAnalysisRecord[];
  alternativeConditions: AlternativeConditionsOverrideInput;
  justification: string;
  user: UserProfile;
}): Promise<{
  application: ApplicationRecord;
  analysis: FinancialAnalysisRecord;
}> {
  const { application, customer, policy, existingAnalyses, alternativeConditions, justification, user } =
    params;

  if (!canUserExecuteHumanReevaluation(user.role)) {
    throw new Error(
      `Acceso denegado: el rol ${user.role} no está autorizado para enviar solicitudes reevaluadas a Evaluación.`
    );
  }
  if (!justification || justification.trim().length < 10) {
    throw new Error(
      'Debe registrar una justificación de al menos 10 caracteres antes de enviar la solicitud a Evaluación.'
    );
  }

  const maxPrevVersion = existingAnalyses.reduce((m, a) => Math.max(m, a.version || 0), 0);
  const nextVersion = Math.max(2, maxPrevVersion + 1);
  const effectiveOrgId = application.organizationId || user.organizationId || DEFAULT_ORG_ID;

  // Authoritative server-side revalidation with intent = SEND_TO_EVALUATION (blocks bypasses with HTTP 422)
  const result = await runBackendHumanReevaluation({
    application: { ...application, organizationId: effectiveOrgId },
    customer: { ...customer, organizationId: effectiveOrgId },
    policy,
    version: nextVersion,
    alternativeConditions,
    justification: justification.trim(),
    user,
    intent: 'SEND_TO_EVALUATION',
  });

  if (!result.canSendToEvaluation || !result.analysis.financialSummary?.isReconciled) {
    throw new Error(
      `No se puede enviar a Evaluación: ${result.sendToEvaluationBlockedReasons.join('; ')}`
    );
  }

  const nowIso = new Date().toISOString();
  const execPayload = sanitizeScoringExecutionPayload({
    ...result.scoring,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    executedBy: user.uid,
    executedByName: user.displayName,
  });
  const canPersistScoring =
    Array.isArray(execPayload.indicatorDetails) && execPayload.indicatorDetails.length === 22;

  const analysisPayload = cleanObject({
    ...result.analysis,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    status: 'APROBADO_EVALUACION' as const,
    justification: justification.trim().slice(0, 1000),
    calculatedBy: user.uid,
    calculatedByName: user.displayName,
    calculatedByRole: user.role,
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const historyPayload = cleanObject({
    ...result.decisionHistory,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    analysisId: result.analysis.id,
    scoringExecutionId: canPersistScoring ? execPayload.id : null,
    eventType: 'SENT_TO_EVALUATION_AFTER_REEVALUATION' as const,
    newStatus: 'EN_EVALUACION' as const,
    justification: justification.trim().slice(0, 1000),
    actorId: user.uid,
    actorName: user.displayName,
    actorRole: user.role,
    createdAt: serverTimestamp(),
  });

  const calc = result.analysis.calculatedConditions;
  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: `Enviada a Evaluación tras Reevaluación Humana v${nextVersion} (${formatMoney(calc.requestedAmount, calc.currency)} · ${calc.installmentCount} cuotas ${calc.paymentFrequency})`,
    fromStatus: application.status,
    toStatus: 'EN_EVALUACION',
    userId: user.uid,
    userName: user.displayName,
    userRole: user.role,
    note: justification.trim(),
  });

  const batch = writeBatch(db);
  for (const prev of existingAnalyses) {
    if (prev.id !== result.analysis.id && (prev.status === 'VIGENTE' || prev.status === 'APROBADO_EVALUACION')) {
      batch.update(doc(db, 'financial_analyses', prev.id), {
        status: 'HISTORICO',
        updatedAt: serverTimestamp(),
      });
    }
  }
  if (canPersistScoring) {
    batch.set(doc(db, 'scoring_executions', execPayload.id), execPayload);
  }
  batch.set(doc(db, 'financial_analyses', result.analysis.id), analysisPayload);
  batch.set(doc(db, 'application_decision_history', result.decisionHistory.id), historyPayload);

  const appUpdates: Partial<ApplicationRecord> = {
    status: 'EN_EVALUACION',
    requestedAmount: calc.requestedAmount,
    requestedTermMonths: calc.termMonths,
    paymentFrequency: calc.paymentFrequency,
    amortizationMethod: calc.amortizationMethod,
    authorizedAlternateAmount: calc.requestedAmount,
    alternateAmountAuthorizedBy: user.uid,
    originalRequestedConditions:
      application.originalRequestedConditions ?? result.analysis.originalRequestedConditions,
    activeFinancialAnalysisId: result.analysis.id,
    approvedEvaluationAnalysisId: result.analysis.id,
    requiresHumanIntervention: false,
    decisionQualificationStatus: 'REEVALUADA_APROBADA_EVALUACION',
    financialAnalysisVersion: nextVersion,
    legalFeeMode: calc.legalFeeMode,
    interestOnlyPeriods: calc.interestOnlyPeriods,
    installmentCount: calc.installmentCount,
    prequalificationStatus: execPayload.status,
    ...(canPersistScoring ? { latestScoringExecutionId: execPayload.id } : {}),
    latestScore: execPayload.totalScore,
    latestRiskBand: execPayload.riskBand.code,
    recommendedAmount: calc.requestedAmount,
    recommendedRateMonthly: calc.monthlyRateDecimal,
    recommendedTermMonths: calc.termMonths,
    recommendedInstallment:
      result.analysis.financialSummary?.initialInstallment ?? execPayload.recommendedInstallment,
    movementHistory: newHistory,
  };

  batch.update(
    doc(db, 'applications', application.id),
    cleanObject({
      ...appUpdates,
      updatedAt: serverTimestamp(),
    })
  );

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: 'APPLICATION_REEVALUATED_SENT_TO_EVALUATION',
      entityType: 'applications',
      entityId: application.id,
      action: `Solicitud enviada a Evaluación con análisis v${nextVersion} (${result.analysis.id})`,
      previousState: application.status,
      newState: 'EN_EVALUACION',
      justification: justification.trim(),
      transactionId: result.analysis.idempotencyKey,
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${application.id}`);
  }

  if (result.installments.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      result.installments.map((r) => ({
        ...r,
        organizationId: effectiveOrgId,
        applicationId: application.id,
      }))
    );
  }

  const updatedApp: ApplicationRecord = {
    ...application,
    ...appUpdates,
  };

  await enqueueCustomerStatusEmail({
    application: updatedApp,
    customer,
    eventCode: 'EN_EVALUACION',
    fromStatus: application.status,
    toStatus: 'EN_EVALUACION',
    historyLength: newHistory.length,
    user,
    observations: justification.trim(),
  }).catch(() => {});

  return {
    application: updatedApp,
    analysis: {
      ...result.analysis,
      status: 'APROBADO_EVALUACION',
      calculatedAt: nowIso,
      updatedAt: nowIso,
    } as FinancialAnalysisRecord,
  };
}

export async function retryApplicationFinancialProcessing(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  existingAnalyses: FinancialAnalysisRecord[];
  user: UserProfile;
}): Promise<{ analysis: FinancialAnalysisRecord; autoAdvanced: boolean }> {
  const { application, customer, policy, existingAnalyses, user } = params;
  if (!canUserExecuteHumanReevaluation(user.role)) {
    throw new Error('Permiso denegado para reprocesar análisis financiero.');
  }
  const effectiveOrgId = application.organizationId || user.organizationId || DEFAULT_ORG_ID;
  const maxVersion = existingAnalyses.reduce((m, a) => Math.max(m, a.version || 0), 0);
  const nextVersion = maxVersion + 1;

  const integrated = await runBackendIntegratedDecisionAndCalculation({
    application: { ...application, organizationId: effectiveOrgId },
    customer: { ...customer, organizationId: effectiveOrgId },
    policy,
    analysisType: maxVersion === 0 ? 'SOLICITUD_INICIAL' : 'ACTUALIZACION_DATOS',
    version: nextVersion,
    useVerifiedData: false,
    user,
  });

  const nowIso = new Date().toISOString();
  const autoAdvanced =
    application.status === 'RECIBIDA' && integrated.canAutoAdvanceToEvaluation;
  const nextStatus: ApplicationStatus = autoAdvanced ? 'EN_EVALUACION' : application.status;

  const analysisPayload = cleanObject({
    ...integrated.analysis,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    calculatedBy: user.uid,
    calculatedByName: user.displayName,
    calculatedByRole: user.role,
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const historyPayload = cleanObject({
    ...integrated.decisionHistory,
    organizationId: effectiveOrgId,
    applicationId: application.id,
    eventType: 'RETRY_FINANCIAL_PROCESSING' as const,
    previousStatus: application.status,
    newStatus: nextStatus,
    actorId: user.uid,
    actorName: user.displayName,
    actorRole: user.role,
    createdAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  for (const prev of existingAnalyses) {
    if (prev.id !== integrated.analysis.id && prev.status === 'VIGENTE') {
      batch.update(doc(db, 'financial_analyses', prev.id), {
        status: 'HISTORICO',
        updatedAt: serverTimestamp(),
      });
    }
  }
  batch.set(doc(db, 'financial_analyses', integrated.analysis.id), analysisPayload);
  batch.set(doc(db, 'application_decision_history', integrated.decisionHistory.id), historyPayload);
  batch.update(
    doc(db, 'applications', application.id),
    cleanObject({
      status: nextStatus,
      originalRequestedConditions:
        application.originalRequestedConditions ?? integrated.analysis.originalRequestedConditions,
      activeFinancialAnalysisId: integrated.analysis.id,
      ...(autoAdvanced ? { approvedEvaluationAnalysisId: integrated.analysis.id } : {}),
      requiresHumanIntervention: !integrated.analysis.decisionSummary.qualifiesForCalculated,
      decisionQualificationStatus: integrated.decisionQualificationStatus,
      financialAnalysisVersion: nextVersion,
      updatedAt: serverTimestamp(),
    })
  );

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `financial_analyses/${integrated.analysis.id}`);
  }

  if (integrated.installments.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      integrated.installments.map((r) => ({
        ...r,
        organizationId: effectiveOrgId,
        applicationId: application.id,
      }))
    );
  }

  return {
    analysis: {
      ...integrated.analysis,
      calculatedAt: nowIso,
      updatedAt: nowIso,
    } as FinancialAnalysisRecord,
    autoAdvanced,
  };
}

const recentDocAccessCache = new Map<string, number>();

export async function recordCriticalAuditEvent(params: {
  user: UserProfile;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  previousState?: string | null;
  newState?: string | null;
  justification?: string | null;
  engineVersion?: string | null;
}): Promise<void> {
  const auditId = generateId('audit');
  const payload = buildCriticalAuditEntryPayload({
    id: auditId,
    organizationId: params.user.organizationId,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    previousState: params.previousState,
    newState: params.newState,
    justification: params.justification,
    transactionId: generateId('tx'),
    engineVersion: params.engineVersion,
    userId: params.user.uid,
    userEmail: params.user.email,
    userRole: params.user.role,
  });

  try {
    await setDoc(doc(db, 'audit_logs', auditId), {
      ...payload,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `audit_logs/${auditId}`);
  }
}

export async function recordConfidentialDocumentAccess(params: {
  document: Pick<
    ApplicationDocumentRecord,
    'id' | 'organizationId' | 'applicationId' | 'category' | 'fileName' | 'reviewStatus'
  >;
  accessType: 'PREVIEW' | 'DOWNLOAD' | 'OCR_SCAN';
  user: UserProfile;
  applicationNumber?: string;
}): Promise<void> {
  const { document: docMeta, accessType, user, applicationNumber } = params;
  const dedupKey = `${user.uid}:${docMeta.id}:${accessType}`;
  const now = Date.now();
  const prevTs = recentDocAccessCache.get(dedupKey);
  if (prevTs && now - prevTs < 10_000) {
    return;
  }
  recentDocAccessCache.set(dedupKey, now);

  const eventType =
    accessType === 'DOWNLOAD'
      ? 'CONFIDENTIAL_DOCUMENT_DOWNLOADED'
      : accessType === 'OCR_SCAN'
      ? 'CONFIDENTIAL_DOCUMENT_OCR_INSPECTED'
      : 'CONFIDENTIAL_DOCUMENT_PREVIEWED';

  const verb =
    accessType === 'DOWNLOAD'
      ? 'Descarga de documento confidencial'
      : accessType === 'OCR_SCAN'
      ? 'Inspección OCR IA de documento confidencial'
      : 'Visualización de documento confidencial';

  const appRef = applicationNumber || docMeta.applicationId;
  await recordCriticalAuditEvent({
    user: { ...user, organizationId: docMeta.organizationId || user.organizationId },
    eventType,
    entityType: 'application_documents',
    entityId: docMeta.id,
    action: `${verb}: [${docMeta.category}] ${docMeta.fileName} (Exp. ${appRef})`,
    previousState: docMeta.reviewStatus,
    newState: `${accessType}_AUDITADO`,
    justification: `Acceso autorizado rol ${user.role} sobre documento ${docMeta.category} (${appRef}) bajo cumplimiento Ley 172-13`,
  });
}

export async function uploadDocumentRecord(
  docInput: Omit<ApplicationDocumentRecord, 'uploadedAt'>,
  user?: UserProfile
): Promise<void> {
  const isConfidential = isConfidentialDocumentCategory(docInput.category);
  if (user && isConfidential) {
    const batch = writeBatch(db);
    batch.set(doc(db, 'application_documents', docInput.id), {
      ...cleanObject(docInput),
      uploadedAt: serverTimestamp(),
    });
    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      ...buildCriticalAuditEntryPayload({
        id: auditId,
        organizationId: docInput.organizationId,
        eventType: 'CONFIDENTIAL_DOCUMENT_UPLOADED',
        entityType: 'application_documents',
        entityId: docInput.id,
        action: `Carga de documento confidencial [${docInput.category}]: ${docInput.fileName}`,
        newState: docInput.reviewStatus,
        justification: `Expediente ${docInput.applicationId} · ${docInput.notes || 'Soporte documental adjuntado'}`,
        transactionId: generateId('tx'),
        userId: user.uid,
        userEmail: user.email,
        userRole: user.role,
      }),
      timestamp: serverTimestamp(),
    });
    try {
      await batch.commit();
      return;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `application_documents/${docInput.id}`);
    }
  }

  try {
    await setDoc(doc(db, 'application_documents', docInput.id), {
      ...cleanObject(docInput),
      uploadedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `application_documents/${docInput.id}`);
  }
}

export async function updateDocumentReviewStatus(params: {
  docId: string;
  reviewStatus: 'PENDIENTE' | 'RECIBIDO' | 'VERIFICADO' | 'OBSERVADO';
  notes: string;
  reviewerId: string;
  user?: UserProfile;
  organizationId?: string;
  previousStatus?: string;
  fileName?: string;
  category?: string;
  applicationId?: string;
}): Promise<void> {
  const orgId = params.user?.organizationId || params.organizationId;
  if (params.user && orgId) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'application_documents', params.docId), {
      reviewStatus: params.reviewStatus,
      notes: params.notes,
      reviewedBy: params.reviewerId,
      reviewedAt: serverTimestamp(),
    });
    const auditId = generateId('audit');
    const docLabel = params.fileName
      ? `[${params.category || 'DOC'}] ${params.fileName}`
      : params.docId;
    batch.set(doc(db, 'audit_logs', auditId), {
      ...buildCriticalAuditEntryPayload({
        id: auditId,
        organizationId: orgId,
        eventType: 'DOCUMENT_REVIEW_UPDATED',
        entityType: 'application_documents',
        entityId: params.docId,
        action: `Dictamen documental ${docLabel} -> ${params.reviewStatus}`,
        previousState: params.previousStatus || 'RECIBIDO',
        newState: params.reviewStatus,
        justification: params.notes || `Revisión documental por ${params.user.displayName}`,
        transactionId: generateId('tx'),
        userId: params.user.uid,
        userEmail: params.user.email,
        userRole: params.user.role,
      }),
      timestamp: serverTimestamp(),
    });
    try {
      await batch.commit();
      return;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `application_documents/${params.docId}`);
    }
  }

  try {
    await updateDoc(doc(db, 'application_documents', params.docId), {
      reviewStatus: params.reviewStatus,
      notes: params.notes,
      reviewedBy: params.reviewerId,
      reviewedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `application_documents/${params.docId}`);
  }
}

export async function verifyDocumentWithGeminiOcr(params: {
  document: {
    id?: string;
    category: string;
    fileName: string;
    mimeType?: string;
    fileDataUrl: string;
  };
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  business?: BusinessRecord | null;
}): Promise<DocumentOcrResult> {
  const resp = await fetch('/api/documents/verify-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: params.document,
      application: {
        id: params.application.id,
        applicationNumber: params.application.applicationNumber,
        applicantDisplayName: params.application.applicantDisplayName,
        applicantType: params.application.applicantType,
        productCode: params.application.productCode,
        currency: params.application.currency,
        requestedAmount: params.application.requestedAmount,
        financialData: params.application.financialData,
        businessFinancialData: params.application.businessFinancialData ?? null,
      },
      customer: params.customer
        ? {
            firstName: params.customer.firstName,
            lastName: params.customer.lastName,
            documentType: params.customer.documentType,
            documentNumber: params.customer.documentNumber,
            address: params.customer.address,
            phone: params.customer.phone,
          }
        : null,
      business: params.business
        ? {
            legalName: params.business.legalName,
            tradeName: params.business.tradeName,
            rnc: params.business.rnc,
          }
        : null,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'Error ejecutando el Verificador Automático de Documentos (OCR).');
  }
  return data as DocumentOcrResult;
}

export async function verifyBiometricIdentityWithGemini(params: {
  identityDocumentDataUrl: string;
  identityDocumentMimeType?: string;
  identityDocumentFileName?: string;
  selfieDataUrl: string;
  selfieMimeType?: string;
  applicantMeta?: {
    fullName?: string;
    documentType?: string;
    documentNumber?: string;
  };
}): Promise<BiometricVerificationResult> {
  const resp = await fetch('/api/biometrics/verify-identity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      data.error || 'Error ejecutando la verificación biométrica mediante visión artificial.'
    );
  }
  return data as BiometricVerificationResult;
}

export async function applyOcrVerificationToDocument(params: {
  docRecord: ApplicationDocumentRecord;
  ocrResult: DocumentOcrResult;
  overrideStatus?: 'VERIFICADO' | 'OBSERVADO';
  user: UserProfile;
}): Promise<{ reviewStatus: 'VERIFICADO' | 'OBSERVADO'; notes: string }> {
  const { docRecord, ocrResult, overrideStatus, user } = params;

  if (!hasRolePermission(user.role, 'VERIFY_DOCUMENTS')) {
    throw new Error(
      'Permiso RBAC denegado: tu rol no tiene facultad para actualizar el estado documental.'
    );
  }

  const nextStatus = overrideStatus ?? ocrResult.recommendedReviewStatus;
  const note = buildOcrDocumentNote(ocrResult);

  const batch = writeBatch(db);
  batch.update(doc(db, 'application_documents', docRecord.id), {
    reviewStatus: nextStatus,
    notes: note,
    reviewedBy: user.uid,
    reviewedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: docRecord.organizationId,
    eventType: 'DOCUMENT_OCR_VERIFIED',
    entityType: 'application_documents',
    entityId: docRecord.id,
    action: `OCR Gemini (${ocrResult.overallVerdict}, ${ocrResult.confidenceScore}%) -> ${nextStatus} en ${docRecord.fileName}`.slice(
      0,
      195
    ),
    previousState: docRecord.reviewStatus,
    newState: nextStatus,
    justification: note.slice(0, 950),
    transactionId: generateId('tx'),
    engineVersion: ocrResult.modelUsed,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
    return { reviewStatus: nextStatus, notes: note };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `application_documents/${docRecord.id}`);
  }
}

export function buildDefaultFormalizationContent(params: {
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  approvedCapital: number;
  contractualRate: number;
  termMonths: number;
  firstPaymentDate: string;
}) {
  const { application, customer, approvedCapital, contractualRate, termMonths, firstPaymentDate } = params;
  const fullName = customer
    ? `${customer.firstName} ${customer.lastName}`.trim()
    : application.applicantDisplayName;
  const docLabel = customer ? `${customer.documentType} ${customer.documentNumber}` : 'Documento en expediente';
  const contractText =
    `CONTRATO DE PRÉSTAMO MERCANTIL Y DE CONSUMO (GENERADO AUTOMÁTICAMENTE)\n` +
    `Expediente: ${application.fileNumber} | Solicitud: ${application.applicationNumber}\n` +
    `Deudor: ${fullName} (${docLabel})\n` +
    `Producto: ${application.productCode} (${application.currency})\n` +
    `Capital Aprobado: ${formatMoney(approvedCapital, application.currency)}\n` +
    `Tasa Mensual Contractual: ${formatRatePct(contractualRate)} sobre saldo insoluto\n` +
    `Plazo Contractual: ${termMonths} meses (${application.paymentFrequency})\n` +
    `Método de Amortización: ${application.amortizationMethod}\n` +
    `Fecha Estimada Primera Cuota: ${firstPaymentDate}\n` +
    `Condición: El deudor se compromete al pago puntual de las cuotas descritas en la tabla de amortización anexa.`;

  const promissoryNoteText =
    `PAGARÉ A LA ORDEN (GENERADO AUTOMÁTICAMENTE)\n` +
    `Solicitud: ${application.applicationNumber} | Expediente: ${application.fileNumber}\n` +
    `Yo, ${fullName}, portador(a) de ${docLabel}, reconozco deber y prometo pagar incondicionalmente a la orden de la entidad acreedora la suma principal de ${formatMoney(approvedCapital, application.currency)} más intereses convencionales a razón de ${formatRatePct(contractualRate)} mensual en ${termMonths} meses bajo frecuencia ${application.paymentFrequency}, con vencimiento inicial el ${firstPaymentDate}.`;

  return { contractText, promissoryNoteText };
}

export async function validateApplicationPreEvaluationInFirestore(params: {
  application: ApplicationRecord;
  user: UserProfile;
}): Promise<PreEvaluationValidationResult> {
  const { application, user } = params;
  const effectiveOrgId =
    typeof application.organizationId === 'string' && VALID_ID_REGEX.test(application.organizationId)
      ? application.organizationId
      : user.organizationId || DEFAULT_ORG_ID;

  // 1. Live Firestore check of customer profile
  let firestoreCustomer: CustomerRecord | null = null;
  if (application.customerId && VALID_ID_REGEX.test(application.customerId)) {
    try {
      const custSnap = await getDoc(doc(db, 'customers', application.customerId));
      if (custSnap.exists()) {
        firestoreCustomer = {
          ...(custSnap.data() as CustomerRecord),
          id: custSnap.id,
        };
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `customers/${application.customerId}`);
    }
  }

  // 2. Live Firestore check of business profile (only when applicantType === 'BUSINESS')
  let firestoreBusiness: BusinessRecord | null = null;
  if (
    application.applicantType === 'BUSINESS' &&
    application.businessId &&
    VALID_ID_REGEX.test(application.businessId)
  ) {
    try {
      const bizSnap = await getDoc(doc(db, 'businesses', application.businessId));
      if (bizSnap.exists()) {
        firestoreBusiness = {
          ...(bizSnap.data() as BusinessRecord),
          id: bizSnap.id,
        };
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `businesses/${application.businessId}`);
    }
  }

  // 3. Live Firestore check of application documents (single-field org filter avoids composite indexes)
  let firestoreDocuments: ApplicationDocumentRecord[] = [];
  try {
    const docsSnap = await getDocs(
      query(collection(db, 'application_documents'), where('organizationId', '==', effectiveOrgId))
    );
    firestoreDocuments = docsSnap.docs
      .map((d) => ({ ...(d.data() as ApplicationDocumentRecord), id: d.id }))
      .filter((d) => d.applicationId === application.id);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'application_documents');
  }

  return evaluatePreEvaluationRequirements({
    application: { ...application, organizationId: effectiveOrgId },
    firestoreCustomer,
    firestoreBusiness,
    firestoreDocuments,
  });
}

export async function advanceApplicationToEvaluation(params: {
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  policy: CreditPolicyRecord;
  user: UserProfile;
  alternateAmount?: number | null;
  authorizationNote?: string;
  validatedResult?: PreEvaluationValidationResult;
  skipPreEvaluationValidation?: boolean;
}): Promise<{ application: ApplicationRecord; reScored: boolean; validation?: PreEvaluationValidationResult }> {
  const { application, policy, user, alternateAmount, authorizationNote } = params;

  const isAlternateFlow = typeof alternateAmount === 'number' && alternateAmount > 0;
  const ALLOWED_SOURCE_STATUSES = new Set(['BORRADOR', 'RECIBIDA', 'DEVUELTA']);

  // Inspect live Firestore document first to avoid stale-state transitions or misclassifying existing docs
  const appRef = doc(db, 'applications', application.id);
  let existingAppData: Record<string, unknown> | null = null;
  try {
    const existingSnap = await getDoc(appRef);
    if (existingSnap.exists()) {
      existingAppData = existingSnap.data() as Record<string, unknown>;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `applications/${application.id}`);
  }

  const persistedStatus =
    typeof existingAppData?.status === 'string' ? existingAppData.status : application.status;

  // Idempotent guard: if already in EN_EVALUACION in Firestore and not re-scoring with an alternate amount, return cleanly
  if (existingAppData && persistedStatus === 'EN_EVALUACION' && !isAlternateFlow) {
    return {
      application: {
        ...application,
        ...(existingAppData as Partial<ApplicationRecord>),
        status: 'EN_EVALUACION',
      },
      reScored: false,
    };
  }

  if (!ALLOWED_SOURCE_STATUSES.has(persistedStatus)) {
    throw new Error(
      `La solicitud ${application.applicationNumber} ya se encuentra en estado ${persistedStatus} y no puede enviarse nuevamente desde Recibida a Evaluación.`
    );
  }

  const effectiveOrgId =
    typeof existingAppData?.organizationId === 'string' &&
    VALID_ID_REGEX.test(existingAppData.organizationId)
      ? existingAppData.organizationId
      : application.organizationId || user.organizationId || DEFAULT_ORG_ID;

  let resolvedValidation: PreEvaluationValidationResult | undefined;
  if (!params.skipPreEvaluationValidation) {
    resolvedValidation =
      params.validatedResult && params.validatedResult.applicationId === application.id
        ? params.validatedResult
        : await validateApplicationPreEvaluationInFirestore({
            application: { ...application, organizationId: effectiveOrgId },
            user,
          });

    if (!resolvedValidation.canProceed) {
      throw new PreEvaluationValidationError(resolvedValidation);
    }
  }

  let resolvedCustomer = params.customer ?? null;
  if (!resolvedCustomer && application.customerId) {
    const custSnap = await getDoc(doc(db, 'customers', application.customerId)).catch(() => null);
    if (custSnap?.exists()) {
      resolvedCustomer = custSnap.data() as CustomerRecord;
    }
  }
  if (!resolvedCustomer) {
    const parts = (application.applicantDisplayName || 'Cliente Registrado').trim().split(/\s+/);
    resolvedCustomer = {
      id: application.customerId,
      organizationId: effectiveOrgId,
      documentType: 'CEDULA',
      documentNumber: `MIG-${application.customerId}`.slice(0, 40),
      documentKey: `${effectiveOrgId}_CEDULA_${application.customerId}`.slice(0, 175),
      firstName: parts[0] || 'Cliente',
      lastName: parts.slice(1).join(' ') || 'Registrado',
      phone: '809-000-0000',
      createdBy: user.uid,
    };
  }

  const fullAmountApprovedByMotor =
    application.prequalificationStatus === 'PREOFERTA' &&
    (application.recommendedAmount ?? 0) >= application.requestedAmount;

  if (!fullAmountApprovedByMotor && !isAlternateFlow) {
    throw new Error(
      'El monto solicitado no fue aprobado íntegro por el Motor de Decisiones. Debe autorizar un monto alternativo para re-evaluar.'
    );
  }

  const nowIso = new Date().toISOString();
  const batch = writeBatch(db);
  let nextAppFields: Partial<ApplicationRecord> = {
    status: 'EN_EVALUACION',
  };
  let actionLabel = `Solicitud aprobada por Motor de Decisiones (${formatMoney(application.requestedAmount, application.currency)}) -> pasa directamente a Evaluación`;
  let reScored = false;

  if (isAlternateFlow) {
    const appClone: ApplicationRecord = {
      ...application,
      organizationId: effectiveOrgId,
      requestedAmount: alternateAmount!,
    };
    const newScoring = await runBackendDecisionEngine({
      application: appClone,
      customer: { ...resolvedCustomer, organizationId: effectiveOrgId },
      policy,
      useVerifiedData: false,
      executionTrigger: 'MANUAL_RERUN',
      executedBy: user.uid,
      executedByName: user.displayName,
    });
    reScored = true;

    const validScoringDoc =
      Array.isArray(newScoring.indicatorDetails) && newScoring.indicatorDetails.length === 22;
    if (validScoringDoc) {
      batch.set(
        doc(db, 'scoring_executions', newScoring.id),
        sanitizeScoringExecutionPayload({
          ...newScoring,
          organizationId: effectiveOrgId,
        })
      );
    }

    actionLabel = `Autorización de otro monto (${formatMoney(alternateAmount!, application.currency)}) re-evaluada por Motor V2 (Score ${newScoring.totalScore}/100) -> Evaluación`;
    nextAppFields = {
      status: 'EN_EVALUACION',
      requestedAmount: alternateAmount!,
      authorizedAlternateAmount: alternateAmount!,
      alternateAmountAuthorizedBy: user.uid,
      prequalificationStatus: newScoring.status,
      ...(validScoringDoc ? { latestScoringExecutionId: newScoring.id } : {}),
      latestScore: newScoring.totalScore,
      latestRiskBand: newScoring.riskBand.code,
      recommendedAmount: newScoring.recommendedAmount,
      recommendedRateMonthly: normalizeMonthlyRateDecimal(newScoring.recommendedRateMonthly, 0),
      recommendedTermMonths: newScoring.recommendedTermMonths,
      recommendedInstallment: newScoring.recommendedInstallment,
    };
  }

  const baseHistory = Array.isArray(existingAppData?.movementHistory)
    ? (existingAppData.movementHistory as MovementHistoryEntry[])
    : application.movementHistory;

  const newHistory = appendMovementHistory(baseHistory, {
    timestamp: nowIso,
    action: actionLabel,
    fromStatus: persistedStatus as ApplicationRecord['status'],
    toStatus: 'EN_EVALUACION',
    userId: user.uid,
    userName: user.displayName,
    note: authorizationNote?.trim() || null,
  });

  const persistedMeta = await ensureApplicationPersistedInBatch({
    batch,
    application: { ...application, organizationId: effectiveOrgId },
    customer: resolvedCustomer,
    user,
    existingAppData,
    updates: {
      ...nextAppFields,
      movementHistory: newHistory,
    },
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: persistedMeta.organizationId,
      eventType: isAlternateFlow ? 'APPLICATION_ALTERNATE_AMOUNT_AUTHORIZED' : 'APPLICATION_SENT_TO_EVALUATION',
      entityType: 'applications',
      entityId: application.id,
      action: actionLabel,
      previousState: persistedStatus,
      newState: 'EN_EVALUACION',
      justification: authorizationNote?.trim() || (isAlternateFlow ? `Monto autorizado: ${alternateAmount}` : 'Aprobación automática Motor V2'),
      transactionId: generateId('tx'),
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${application.id}`);
  }

  const updatedApp: ApplicationRecord = {
    ...application,
    organizationId: persistedMeta.organizationId,
    createdBy: persistedMeta.createdBy,
    ...nextAppFields,
    movementHistory: newHistory,
  };

  await enqueueCustomerStatusEmail({
    application: updatedApp,
    customer: resolvedCustomer,
    eventCode: 'EN_EVALUACION',
    fromStatus: persistedStatus,
    toStatus: 'EN_EVALUACION',
    historyLength: newHistory.length,
    user,
    observations: authorizationNote?.trim() || null,
  });

  return { application: updatedApp, reScored, validation: resolvedValidation };
}

export const EDITABLE_APPLICATION_STATUSES = [
  'BORRADOR',
  'RECIBIDA',
  'DEVUELTA',
  'EN_EVALUACION',
] as const;

export function canEditApplicationRecord(
  status: ApplicationRecord['status'] | string,
  role?: UserProfile['role'] | null
): boolean {
  if (!role || role === 'EXTERNAL_CLIENT' || role === 'AUDITOR') return false;
  return (EDITABLE_APPLICATION_STATUSES as readonly string[]).includes(status);
}

export interface ReceivedApplicationEditInput {
  productCode: ApplicationRecord['productCode'];
  currency: ApplicationRecord['currency'];
  requestedAmount: number;
  requestedTermMonths: number;
  paymentFrequency: ApplicationRecord['paymentFrequency'];
  amortizationMethod: ApplicationRecord['amortizationMethod'];
  loanPurpose?: string;
  loanPurposeDescription?: string;
  proposedCollateral?: string;
  financialData: ApplicationRecord['financialData'];
  businessFinancialData?: ApplicationRecord['businessFinancialData'];
  references: ApplicationRecord['references'];
  declaredDocumentsSummary: ApplicationRecord['declaredDocumentsSummary'];
}

export interface ReceivedBusinessEditInput {
  legalName: string;
  tradeName?: string;
  companyType?: string;
  economicActivity?: string;
  operationsStartDate?: string;
  authorizedRepName: string;
  authorizedRepDoc?: string;
  corporateDocsSummary?: string;
}

function formatAuditFieldValue(val: unknown, suffix = ''): string {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  if (typeof val === 'number') {
    const formatted = Number.isFinite(val)
      ? val.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : '—';
    return suffix ? `${formatted} ${suffix}`.trim() : formatted;
  }
  const s = String(val).trim();
  return s.length > 0 ? (suffix ? `${s} ${suffix}`.trim() : s) : '—';
}

function normalizeComparable(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val).trim();
}

export function buildApplicationFieldDiff(params: {
  application: ApplicationRecord;
  updates: ReceivedApplicationEditInput;
  customer?: CustomerRecord | null;
  customerUpdates?: CustomerUpdateInput | null;
  business?: BusinessRecord | null;
  businessUpdates?: ReceivedBusinessEditInput | null;
}): ApplicationFieldChange[] {
  const { application, updates, customer, customerUpdates, business, businessUpdates } = params;
  const diffs: ApplicationFieldChange[] = [];

  const pushDiff = (
    field: string,
    label: string,
    category: ApplicationFieldChange['category'],
    prev: unknown,
    next: unknown,
    suffix = ''
  ) => {
    if (normalizeComparable(prev) === normalizeComparable(next)) return;
    diffs.push({
      field,
      label,
      category,
      previousValue: formatAuditFieldValue(prev, suffix),
      newValue: formatAuditFieldValue(next, suffix),
    });
  };

  const curr = updates.currency || application.currency;
  const prevCurr = application.currency;
  const finCurr = updates.financialData?.incomeCurrency || curr;
  const prevFinCurr = application.financialData?.incomeCurrency || prevCurr;

  // 1. Datos básicos del crédito
  pushDiff('productCode', 'Producto crediticio', 'BASICO', application.productCode, updates.productCode);
  pushDiff('currency', 'Moneda', 'BASICO', application.currency, updates.currency);
  if (normalizeComparable(application.requestedAmount) !== normalizeComparable(updates.requestedAmount)) {
    diffs.push({
      field: 'requestedAmount',
      label: 'Monto solicitado',
      category: 'BASICO',
      previousValue: `${prevCurr} ${formatAuditFieldValue(application.requestedAmount)}`,
      newValue: `${curr} ${formatAuditFieldValue(updates.requestedAmount)}`,
    });
  }
  pushDiff('requestedTermMonths', 'Plazo solicitado', 'BASICO', application.requestedTermMonths, updates.requestedTermMonths, 'meses');
  pushDiff('paymentFrequency', 'Frecuencia de pago', 'BASICO', application.paymentFrequency, updates.paymentFrequency);
  pushDiff('amortizationMethod', 'Método de amortización', 'BASICO', application.amortizationMethod, updates.amortizationMethod);
  pushDiff('loanPurpose', 'Destino del préstamo', 'BASICO', application.loanPurpose ?? '', updates.loanPurpose ?? '');
  pushDiff('loanPurposeDescription', 'Detalle del destino', 'BASICO', application.loanPurposeDescription ?? '', updates.loanPurposeDescription ?? '');
  pushDiff('proposedCollateral', 'Garantía propuesta', 'BASICO', application.proposedCollateral ?? '', updates.proposedCollateral ?? '');

  // 2. Datos financieros individuales
  const pFd = application.financialData ?? ({} as ApplicationRecord['financialData']);
  const nFd = updates.financialData ?? ({} as ApplicationRecord['financialData']);
  pushDiff('financialData.incomeSourceType', 'Fuente principal de ingreso', 'FINANCIERO', pFd.incomeSourceType, nFd.incomeSourceType);
  pushDiff('financialData.incomeCurrency', 'Moneda de ingresos', 'FINANCIERO', pFd.incomeCurrency, nFd.incomeCurrency);
  pushDiff('financialData.employerOrBusinessName', 'Empleador o negocio', 'FINANCIERO', pFd.employerOrBusinessName, nFd.employerOrBusinessName);
  pushDiff('financialData.occupationOrRole', 'Cargo u ocupación', 'FINANCIERO', pFd.occupationOrRole, nFd.occupationOrRole);
  pushDiff('financialData.activityType', 'Actividad económica', 'FINANCIERO', pFd.activityType, nFd.activityType);
  pushDiff('financialData.employmentMonths', 'Antigüedad laboral', 'FINANCIERO', pFd.employmentMonths, nFd.employmentMonths, 'meses');
  pushDiff('financialData.primaryNetIncome', 'Ingreso principal neto mensual', 'FINANCIERO', pFd.primaryNetIncome, nFd.primaryNetIncome, finCurr);
  pushDiff('financialData.additionalIncomeStatus', 'Estado ingresos adicionales', 'FINANCIERO', pFd.additionalIncomeStatus, nFd.additionalIncomeStatus);
  pushDiff('financialData.additionalNetIncome', 'Ingreso adicional mensual', 'FINANCIERO', pFd.additionalNetIncome, nFd.additionalNetIncome, finCurr);
  pushDiff('financialData.declaredTotalMonthlyIncome', 'Ingreso mensual total declarado', 'FINANCIERO', pFd.declaredTotalMonthlyIncome, nFd.declaredTotalMonthlyIncome, finCurr);
  pushDiff('financialData.essentialExpenses', 'Gastos esenciales mensuales', 'FINANCIERO', pFd.essentialExpenses, nFd.essentialExpenses, finCurr);
  pushDiff('financialData.housingPayment', 'Pago vivienda / alquiler', 'FINANCIERO', pFd.housingPayment, nFd.housingPayment, finCurr);
  pushDiff('financialData.housingIncludedInExpenses', 'Vivienda incluida en gastos', 'FINANCIERO', Boolean(pFd.housingIncludedInExpenses), Boolean(nFd.housingIncludedInExpenses));
  pushDiff('financialData.debtDeclarationStatus', 'Estado declaración de deudas', 'FINANCIERO', pFd.debtDeclarationStatus, nFd.debtDeclarationStatus);
  pushDiff('financialData.debtCount', 'Cantidad de deudas actuales', 'FINANCIERO', pFd.debtCount, nFd.debtCount);
  pushDiff('financialData.totalDebtBalance', 'Saldo total de deudas', 'FINANCIERO', pFd.totalDebtBalance, nFd.totalDebtBalance, finCurr);
  pushDiff('financialData.currentDebtPayments', 'Cuota mensual total de deudas', 'FINANCIERO', pFd.currentDebtPayments, nFd.currentDebtPayments, finCurr);
  if (prevFinCurr !== finCurr && normalizeComparable(pFd.primaryNetIncome) === normalizeComparable(nFd.primaryNetIncome)) {
    // Currency diff already captured above
  }

  // 2b. Datos financieros empresariales
  if (application.applicantType === 'BUSINESS' && updates.businessFinancialData) {
    const pBfd = application.businessFinancialData ?? ({} as NonNullable<ApplicationRecord['businessFinancialData']>);
    const nBfd = updates.businessFinancialData;
    pushDiff('businessFinancialData.grossSales', 'Ventas brutas mensuales', 'FINANCIERO', pBfd.grossSales, nBfd.grossSales, finCurr);
    pushDiff('businessFinancialData.operatingCosts', 'Costos operativos mensuales', 'FINANCIERO', pBfd.operatingCosts, nBfd.operatingCosts, finCurr);
    pushDiff('businessFinancialData.netMonthlyFlow', 'Flujo neto mensual empresa', 'FINANCIERO', pBfd.netMonthlyFlow, nBfd.netMonthlyFlow, finCurr);
    pushDiff('businessFinancialData.businessObligationsMonthly', 'Obligaciones mensuales empresa', 'FINANCIERO', pBfd.businessObligationsMonthly, nBfd.businessObligationsMonthly, finCurr);
    pushDiff('businessFinancialData.totalBusinessDebtBalance', 'Saldo deuda empresarial', 'FINANCIERO', pBfd.totalBusinessDebtBalance, nBfd.totalBusinessDebtBalance, finCurr);
    pushDiff('businessFinancialData.operationsMonths', 'Meses de operación empresa', 'FINANCIERO', pBfd.operationsMonths, nBfd.operationsMonths, 'meses');
    pushDiff('businessFinancialData.repaymentSource', 'Fuente de repago', 'FINANCIERO', pBfd.repaymentSource, nBfd.repaymentSource);
  }

  // 3. Datos básicos del solicitante (cliente y/o empresa)
  if (customer && customerUpdates) {
    pushDiff('customer.firstName', 'Nombres del cliente', 'CLIENTE', customer.firstName, customerUpdates.firstName);
    pushDiff('customer.lastName', 'Apellidos del cliente', 'CLIENTE', customer.lastName, customerUpdates.lastName);
    pushDiff('customer.phone', 'Teléfono principal', 'CLIENTE', customer.phone, customerUpdates.phone);
    pushDiff('customer.altPhone', 'Teléfono alterno', 'CLIENTE', customer.altPhone ?? '', customerUpdates.altPhone ?? '');
    pushDiff('customer.email', 'Correo electrónico', 'CLIENTE', customer.email ?? '', customerUpdates.email ?? '');
    pushDiff('customer.birthDate', 'Fecha de nacimiento', 'CLIENTE', customer.birthDate ?? '', customerUpdates.birthDate ?? '');
    pushDiff('customer.maritalStatus', 'Estado civil', 'CLIENTE', customer.maritalStatus ?? '', customerUpdates.maritalStatus ?? '');
    pushDiff('customer.address', 'Dirección residencial', 'CLIENTE', customer.address ?? '', customerUpdates.address ?? '');
    pushDiff('customer.municipality', 'Municipio', 'CLIENTE', customer.municipality ?? '', customerUpdates.municipality ?? '');
    pushDiff('customer.province', 'Provincia', 'CLIENTE', customer.province ?? '', customerUpdates.province ?? '');
    pushDiff('customer.housingType', 'Tipo de vivienda', 'CLIENTE', customer.housingType ?? '', customerUpdates.housingType ?? '');
    pushDiff('customer.residenceMonths', 'Meses de residencia', 'CLIENTE', customer.residenceMonths ?? 0, customerUpdates.residenceMonths ?? 0, 'meses');
    pushDiff('customer.housingPayment', 'Pago vivienda (perfil)', 'CLIENTE', customer.housingPayment ?? 0, customerUpdates.housingPayment ?? 0);
  }
  if (business && businessUpdates && application.applicantType === 'BUSINESS') {
    pushDiff('business.legalName', 'Razón social', 'CLIENTE', business.legalName, businessUpdates.legalName);
    pushDiff('business.tradeName', 'Nombre comercial', 'CLIENTE', business.tradeName ?? '', businessUpdates.tradeName ?? '');
    pushDiff('business.economicActivity', 'Actividad económica empresa', 'CLIENTE', business.economicActivity ?? '', businessUpdates.economicActivity ?? '');
    pushDiff('business.authorizedRepName', 'Representante autorizado', 'CLIENTE', business.authorizedRepName, businessUpdates.authorizedRepName);
  }

  // 4. Referencias y documentos declarados
  const prevRefs = application.references ?? [];
  const nextRefs = (updates.references ?? []).filter((r) => (r.name ?? '').trim() || (r.phone ?? '').trim());
  if (JSON.stringify(prevRefs) !== JSON.stringify(nextRefs)) {
    diffs.push({
      field: 'references',
      label: 'Referencias declaradas',
      category: 'REFERENCIAS',
      previousValue: `${prevRefs.length} referencia(s)`,
      newValue: `${nextRefs.length} referencia(s)`,
    });
  }
  const pDocs = application.declaredDocumentsSummary;
  const nDocs = updates.declaredDocumentsSummary;
  if (JSON.stringify(pDocs) !== JSON.stringify(nDocs)) {
    const summarizeDocs = (d?: ApplicationRecord['declaredDocumentsSummary']) => {
      if (!d) return 'Ninguno';
      const active: string[] = [];
      if (d.hasIdentityDoc) active.push('Identidad');
      if (d.hasIncomeEvidence) active.push('Ingresos');
      if (d.hasAddressProof) active.push('Domicilio');
      if (d.hasCorporateDocs) active.push('Societarios');
      return active.length > 0 ? active.join(', ') : 'Ninguno';
    };
    diffs.push({
      field: 'declaredDocumentsSummary',
      label: 'Documentos declarados',
      category: 'REFERENCIAS',
      previousValue: summarizeDocs(pDocs),
      newValue: summarizeDocs(nDocs),
    });
  }

  return diffs;
}

export async function updateReceivedApplicationAndReevaluate(params: {
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  business?: BusinessRecord | null;
  updates: ReceivedApplicationEditInput;
  customerUpdates?: CustomerUpdateInput | null;
  businessUpdates?: ReceivedBusinessEditInput | null;
  reevaluateWithEngine: boolean;
  policy: CreditPolicyRecord;
  user: UserProfile;
  correctionNote?: string;
}): Promise<{
  application: ApplicationRecord;
  customer: CustomerRecord | null;
  newScoring?: ScoringExecutionRecord;
  previousScore: number | null;
  changedFields: string[];
  fieldChanges: ApplicationFieldChange[];
}> {
  const {
    application,
    updates,
    customerUpdates,
    businessUpdates,
    reevaluateWithEngine,
    policy,
    user,
    correctionNote,
  } = params;

  if (user.status !== 'ACTIVE') {
    throw new Error('Tu usuario está INACTIVO y no puede modificar solicitudes.');
  }
  if (!canEditApplicationRecord(application.status, user.role)) {
    throw new Error(
      `No es posible editar la solicitud ${application.applicationNumber} en estado ${application.status} o con el rol ${user.role}.`
    );
  }
  if (!user.isSuperAdmin && application.organizationId !== user.organizationId) {
    throw new Error('Aislamiento multi-tenant: no puedes modificar solicitudes de otra organización.');
  }

  const nextAmount = Math.max(1, Math.min(100_000_000, Number(updates.requestedAmount) || 0));
  const nextTerm = Math.max(1, Math.min(360, Math.round(Number(updates.requestedTermMonths) || 0)));
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    throw new Error('El monto solicitado debe ser mayor a cero.');
  }
  if (!Number.isFinite(nextTerm) || nextTerm <= 0) {
    throw new Error('El plazo solicitado en meses debe ser mayor a cero.');
  }

  const appRef = doc(db, 'applications', application.id);
  let existingAppData: Record<string, unknown> | null = null;
  try {
    const existingSnap = await getDoc(appRef);
    if (existingSnap.exists()) {
      existingAppData = existingSnap.data() as Record<string, unknown>;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `applications/${application.id}`);
  }

  const persistedStatus =
    typeof existingAppData?.status === 'string'
      ? (existingAppData.status as ApplicationRecord['status'])
      : application.status;

  if (!canEditApplicationRecord(persistedStatus, user.role)) {
    throw new Error(
      `La solicitud ${application.applicationNumber} cambió a estado ${persistedStatus} y ya no admite edición directa.`
    );
  }

  const effectiveOrgId =
    typeof existingAppData?.organizationId === 'string' &&
    VALID_ID_REGEX.test(existingAppData.organizationId)
      ? existingAppData.organizationId
      : application.organizationId || user.organizationId || DEFAULT_ORG_ID;

  // 1. Resolve & optionally update linked customer master record
  let effectiveCustomer = params.customer ?? null;
  if (!effectiveCustomer && application.customerId) {
    const custSnap = await getDoc(doc(db, 'customers', application.customerId)).catch(() => null);
    if (custSnap?.exists()) {
      effectiveCustomer = custSnap.data() as CustomerRecord;
    }
  }

  const changedFields: string[] = [];

  if (effectiveCustomer && customerUpdates) {
    effectiveCustomer = await updateCustomerRecord({
      customer: effectiveCustomer,
      updates: customerUpdates,
      user,
    });
    changedFields.push('Datos del cliente');
  }

  // 2. Optionally update linked business record for BUSINESS applications
  let updatedBusinessLegalName: string | null = null;
  if (params.business && businessUpdates && application.businessId) {
    const cleanLegalName = businessUpdates.legalName.trim().slice(0, 180);
    const cleanRepName = businessUpdates.authorizedRepName.trim().slice(0, 160);
    if (!cleanLegalName) {
      throw new Error('La razón social de la empresa es obligatoria.');
    }
    if (!cleanRepName) {
      throw new Error('El nombre del representante autorizado es obligatorio.');
    }
    try {
      await updateDoc(
        doc(db, 'businesses', params.business.id),
        cleanObject({
          legalName: cleanLegalName,
          tradeName: (businessUpdates.tradeName ?? '').trim().slice(0, 180),
          companyType: (businessUpdates.companyType ?? '').trim().slice(0, 80),
          economicActivity: (businessUpdates.economicActivity ?? '').trim().slice(0, 160),
          operationsStartDate: (businessUpdates.operationsStartDate ?? '').trim().slice(0, 20),
          authorizedRepName: cleanRepName,
          authorizedRepDoc: (businessUpdates.authorizedRepDoc ?? '').trim().slice(0, 40),
          corporateDocsSummary: (businessUpdates.corporateDocsSummary ?? '').trim().slice(0, 400),
          updatedAt: serverTimestamp(),
        })
      );
      updatedBusinessLegalName = cleanLegalName;
      changedFields.push('Datos de empresa');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `businesses/${params.business.id}`);
    }
  }

  // 3. Detect changed application fields for clean audit trace
  if (updates.productCode !== application.productCode) changedFields.push('Producto');
  if (updates.currency !== application.currency) changedFields.push('Moneda');
  if (nextAmount !== application.requestedAmount) changedFields.push('Monto solicitado');
  if (nextTerm !== application.requestedTermMonths) changedFields.push('Plazo');
  if (updates.paymentFrequency !== application.paymentFrequency) changedFields.push('Frecuencia de pago');
  if (updates.amortizationMethod !== application.amortizationMethod) changedFields.push('Amortización');
  if ((updates.loanPurpose ?? '') !== (application.loanPurpose ?? '')) changedFields.push('Destino');
  if ((updates.proposedCollateral ?? '') !== (application.proposedCollateral ?? '')) changedFields.push('Garantía');
  if (JSON.stringify(updates.financialData) !== JSON.stringify(application.financialData)) {
    changedFields.push('Datos financieros');
  }
  if (
    application.applicantType === 'BUSINESS' &&
    JSON.stringify(updates.businessFinancialData ?? null) !==
      JSON.stringify(application.businessFinancialData ?? null)
  ) {
    changedFields.push('Finanzas empresariales');
  }
  if (JSON.stringify(updates.references ?? []) !== JSON.stringify(application.references ?? [])) {
    changedFields.push('Referencias');
  }
  if (
    JSON.stringify(updates.declaredDocumentsSummary) !==
    JSON.stringify(application.declaredDocumentsSummary)
  ) {
    changedFields.push('Documentos declarados');
  }

  const nextApplicantDisplayName =
    application.applicantType === 'BUSINESS' && updatedBusinessLegalName
      ? updatedBusinessLegalName
      : effectiveCustomer
      ? `${effectiveCustomer.firstName} ${effectiveCustomer.lastName}`.trim()
      : application.applicantDisplayName;

  if (nextApplicantDisplayName !== application.applicantDisplayName) {
    changedFields.push('Nombre solicitante');
  }

  const validAmortization: ApplicationRecord['amortizationMethod'] =
    updates.amortizationMethod === 'INTERES_FIJO' ? 'INTERES_FIJO' : 'SALDO_INSOLUTO';

  const sanitizedRefs = (updates.references ?? [])
    .map((r) => ({
      name: (r.name ?? '').trim().slice(0, 120),
      relationship: (r.relationship ?? '').trim().slice(0, 80),
      phone: (r.phone ?? '').trim().slice(0, 40),
      ...(r.verified !== undefined ? { verified: r.verified } : {}),
      ...(r.verificationNotes ? { verificationNotes: r.verificationNotes.trim().slice(0, 300) } : {}),
    }))
    .filter((r) => r.name.length > 0 || r.phone.length > 0)
    .slice(0, 4);

  const normalizedFinancialData: ApplicationRecord['financialData'] = {
    ...updates.financialData,
    incomeCurrency: updates.financialData.incomeCurrency || updates.currency,
    debtDeclarationStatus: updates.financialData.debtDeclarationStatus || 'UNDECLARED',
  };

  const normalizedBusinessFinancialData: ApplicationRecord['businessFinancialData'] =
    application.applicantType === 'BUSINESS' && updates.businessFinancialData
      ? {
          ...updates.businessFinancialData,
          incomeCurrency: updates.businessFinancialData.incomeCurrency || updates.currency,
          debtDeclarationStatus: updates.businessFinancialData.debtDeclarationStatus || 'UNDECLARED',
        }
      : application.businessFinancialData ?? null;

  const fieldChanges = buildApplicationFieldDiff({
    application,
    updates: {
      ...updates,
      requestedAmount: nextAmount,
      requestedTermMonths: nextTerm,
      amortizationMethod: validAmortization,
      financialData: normalizedFinancialData,
      businessFinancialData: normalizedBusinessFinancialData,
      references: sanitizedRefs,
    },
    customer: params.customer ?? null,
    customerUpdates,
    business: params.business ?? null,
    businessUpdates,
  });

  const updatedFieldsBase: Partial<ApplicationRecord> = {
    applicantDisplayName: nextApplicantDisplayName.slice(0, 180),
    productCode: updates.productCode,
    currency: updates.currency,
    requestedAmount: nextAmount,
    requestedTermMonths: nextTerm,
    paymentFrequency: updates.paymentFrequency,
    amortizationMethod: validAmortization,
    loanPurpose: (updates.loanPurpose ?? '').trim().slice(0, 120),
    loanPurposeDescription: (updates.loanPurposeDescription ?? '').trim().slice(0, 600),
    proposedCollateral: (updates.proposedCollateral ?? '').trim().slice(0, 400),
    financialData: normalizedFinancialData,
    businessFinancialData: normalizedBusinessFinancialData,
    references: sanitizedRefs,
    declaredDocumentsSummary: {
      hasIdentityDoc: Boolean(updates.declaredDocumentsSummary?.hasIdentityDoc),
      hasIncomeEvidence: Boolean(updates.declaredDocumentsSummary?.hasIncomeEvidence),
      hasAddressProof: Boolean(updates.declaredDocumentsSummary?.hasAddressProof),
      hasCorporateDocs: Boolean(updates.declaredDocumentsSummary?.hasCorporateDocs),
    },
    status: persistedStatus,
  };

  const previousScore = application.latestScore ?? null;
  let newScoring: ScoringExecutionRecord | undefined;
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();

  const actorUid = auth.currentUser?.uid || user.uid;
  const actorUser: UserProfile = {
    ...user,
    uid: actorUid,
  };

  // Fallback synthetic customer if linked customer record is missing
  const scoringCustomer: CustomerRecord = effectiveCustomer ?? {
    id: application.customerId,
    organizationId: effectiveOrgId,
    documentType: 'CEDULA',
    documentNumber: `CLI-${application.customerId}`.slice(0, 40),
    documentKey: `${effectiveOrgId}_CEDULA_${application.customerId}`.slice(0, 175),
    firstName: (nextApplicantDisplayName.split(/\s+/)[0] || 'Cliente').slice(0, 120),
    lastName: (nextApplicantDisplayName.split(/\s+/).slice(1).join(' ') || 'Registrado').slice(0, 120),
    phone: '809-000-0000',
    createdBy: actorUid,
  };

  let scoringAppFields: Partial<ApplicationRecord> = {};
  if (reevaluateWithEngine) {
    const appForScoring: ApplicationRecord = {
      ...application,
      ...updatedFieldsBase,
      organizationId: effectiveOrgId,
    };
    newScoring = await runBackendDecisionEngine({
      application: appForScoring,
      customer: { ...scoringCustomer, organizationId: effectiveOrgId },
      policy,
      useVerifiedData: false,
      executionTrigger: 'MANUAL_RERUN',
      executedBy: actorUid,
      executedByName: user.displayName || user.email || 'Usuario AxyCore',
    });

    const validScoringDoc =
      Array.isArray(newScoring.indicatorDetails) &&
      (newScoring.indicatorDetails.length === 22 || newScoring.status === 'ERROR_CALCULO');

    if (validScoringDoc) {
      batch.set(
        doc(db, 'scoring_executions', newScoring.id),
        sanitizeScoringExecutionPayload({
          ...newScoring,
          organizationId: effectiveOrgId,
          executedBy: actorUid,
        })
      );
    }

    scoringAppFields = {
      prequalificationStatus: newScoring.status,
      ...(validScoringDoc ? { latestScoringExecutionId: newScoring.id } : {}),
      latestScore: newScoring.totalScore,
      latestRiskBand: newScoring.riskBand.code,
      recommendedAmount: newScoring.recommendedAmount,
      recommendedRateMonthly: normalizeMonthlyRateDecimal(newScoring.recommendedRateMonthly, 0),
      recommendedTermMonths: newScoring.recommendedTermMonths,
      recommendedInstallment: newScoring.recommendedInstallment,
    };
  }

  const fieldsSummary =
    changedFields.length > 0 ? changedFields.join(', ') : 'Revisión y confirmación de datos';
  const actionLabel = reevaluateWithEngine && newScoring
    ? `Solicitud actualizada (${fieldsSummary}) y reevaluada por Motor V2 (Score ${
        previousScore !== null ? `${previousScore} → ` : ''
      }${newScoring.totalScore}/100 · ${newScoring.status})`
    : `Solicitud actualizada (${fieldsSummary})`;

  const baseHistory = Array.isArray(existingAppData?.movementHistory)
    ? (existingAppData.movementHistory as MovementHistoryEntry[])
    : application.movementHistory;

  const newHistory = appendMovementHistory(baseHistory, {
    timestamp: nowIso,
    action: actionLabel,
    fromStatus: persistedStatus,
    toStatus: persistedStatus,
    userId: actorUid,
    userName: user.displayName || user.email || 'Usuario AxyCore',
    userRole: user.role,
    note: correctionNote?.trim() || null,
    changes: fieldChanges,
  });

  const persistedMeta = await ensureApplicationPersistedInBatch({
    batch,
    application: { ...application, organizationId: effectiveOrgId },
    customer: scoringCustomer,
    user: actorUser,
    existingAppData,
    updates: {
      ...updatedFieldsBase,
      ...scoringAppFields,
      movementHistory: newHistory,
    },
  });

  const prevStatePayload = JSON.stringify({
    status: persistedStatus,
    score: previousScore,
    fields: Object.fromEntries(fieldChanges.map((c) => [c.label, c.previousValue])),
  }).slice(0, 3900);

  const nextStatePayload = JSON.stringify({
    status: persistedStatus,
    score: reevaluateWithEngine && newScoring ? newScoring.totalScore : previousScore,
    ...(reevaluateWithEngine && newScoring ? { prequalificationStatus: newScoring.status } : {}),
    fields: Object.fromEntries(fieldChanges.map((c) => [c.label, c.newValue])),
  }).slice(0, 3900);

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: persistedMeta.organizationId,
      eventType: reevaluateWithEngine
        ? 'APPLICATION_UPDATED_AND_REEVALUATED'
        : 'APPLICATION_DATA_UPDATED',
      entityType: 'applications',
      entityId: application.id,
      action: actionLabel.slice(0, 200),
      previousState: prevStatePayload,
      newState: nextStatePayload,
      justification: (
        correctionNote?.trim() ||
        `Actualización de solicitud recibida (${fieldsSummary})${
          reevaluateWithEngine ? ' con reevaluación de Motor V2' : ''
        }.`
      ).slice(0, 1000),
      transactionId: generateId('tx'),
      engineVersion: policy.version,
      userId: actorUid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${application.id}`);
  }

  const finalApp: ApplicationRecord = {
    ...application,
    organizationId: persistedMeta.organizationId,
    createdBy: persistedMeta.createdBy,
    ...updatedFieldsBase,
    ...scoringAppFields,
    movementHistory: newHistory,
  };

  return {
    application: finalApp,
    customer: effectiveCustomer,
    newScoring,
    previousScore,
    changedFields,
    fieldChanges,
  };
}

export async function reevaluateApplicationWithEngine(params: {
  application: ApplicationRecord;
  customer?: CustomerRecord | null;
  policy: CreditPolicyRecord;
  user: UserProfile;
  note?: string;
}): Promise<{
  application: ApplicationRecord;
  newScoring: ScoringExecutionRecord;
  previousScore: number | null;
}> {
  const result = await updateReceivedApplicationAndReevaluate({
    application: params.application,
    customer: params.customer,
    updates: {
      productCode: params.application.productCode,
      currency: params.application.currency,
      requestedAmount: params.application.requestedAmount,
      requestedTermMonths: params.application.requestedTermMonths,
      paymentFrequency: params.application.paymentFrequency,
      amortizationMethod: params.application.amortizationMethod,
      loanPurpose: params.application.loanPurpose,
      loanPurposeDescription: params.application.loanPurposeDescription,
      proposedCollateral: params.application.proposedCollateral,
      financialData: params.application.financialData,
      businessFinancialData: params.application.businessFinancialData,
      references: params.application.references ?? [],
      declaredDocumentsSummary: params.application.declaredDocumentsSummary ?? {
        hasIdentityDoc: false,
        hasIncomeEvidence: false,
      },
    },
    reevaluateWithEngine: true,
    policy: params.policy,
    user: params.user,
    correctionNote: params.note || 'Reevaluación manual solicitada con Motor de Decisiones V2.',
  });

  if (!result.newScoring) {
    throw new Error('No se recibió respuesta del Motor de Decisiones Crediticias V2.');
  }

  return {
    application: result.application,
    newScoring: result.newScoring,
    previousScore: result.previousScore,
  };
}

export interface EvaluationAdjustedConditionsInput {
  requestedAmount: number;
  termMonths: number;
  paymentFrequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  legalFeeMode: LegalFeeApplicationMode;
  interestOnlyPeriods?: number;
}

export async function saveEvaluationConditionsAdjustment(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  adjustedConditions: EvaluationAdjustedConditionsInput;
  justification?: string;
  user: UserProfile;
}): Promise<{
  newScoring: ScoringExecutionRecord;
  analysis: FinancialAnalysisRecord;
  policyRatePct: number;
  policyLegalFees: number;
}> {
  const { application, customer, policy, adjustedConditions, justification, user } = params;

  if (!hasRolePermission(user.role, 'EDIT_VERIFIED_FINANCIALS')) {
    throw new Error(
      'Permiso RBAC denegado: solo Analista de Créditos o Administrador puede ajustar las condiciones en Evaluación.'
    );
  }

  const targetAmount = Math.max(1, Number(adjustedConditions.requestedAmount) || 0);
  const targetTermMonths = Math.max(1, Math.round(Number(adjustedConditions.termMonths) || 1));
  const targetFrequency: PaymentFrequency = adjustedConditions.paymentFrequency;
  const targetMethod: AmortizationMethod = adjustedConditions.amortizationMethod;
  const targetLegalFeeMode: LegalFeeApplicationMode = adjustedConditions.legalFeeMode;
  const targetInterestOnly = Math.max(0, Math.round(Number(adjustedConditions.interestOnlyPeriods) || 0));
  const targetInstallmentCount = computeInstallmentCountFromMonths(targetTermMonths, targetFrequency);

  // Strictly resolve rate & legal fees from institutional policy scale
  const policySuggestion = suggestLoanConditions(application.currency, targetAmount);
  const policyRateDecimal = Number((policySuggestion.tasa / 100).toFixed(6));
  const originalSnapshot =
    application.originalRequestedConditions ?? buildOriginalRequestedConditions(application);

  const updatedAppForScoring: ApplicationRecord = {
    ...application,
    requestedAmount: targetAmount,
    requestedTermMonths: targetTermMonths,
    paymentFrequency: targetFrequency,
    amortizationMethod: targetMethod,
    legalFeeMode: targetLegalFeeMode,
    installmentCount: targetInstallmentCount,
    interestOnlyPeriods: targetInterestOnly,
    originalRequestedConditions: originalSnapshot,
  };

  const nextVer = (application.financialAnalysisVersion ?? 1) + 1;
  const actorUid = auth.currentUser?.uid || user.uid;
  const effectiveUser: UserProfile = { ...user, uid: actorUid };

  const evalIntegrated = await runBackendIntegratedDecisionAndCalculation({
    application: updatedAppForScoring,
    customer,
    policy,
    analysisType: 'AJUSTE_EVALUACION',
    version: nextVer,
    useVerifiedData: Boolean(
      application.verifiedFinancialData || application.verifiedBusinessFinancialData
    ),
    alternativeConditions: {
      requestedAmount: targetAmount,
      termMonths: targetTermMonths,
      installmentCount: targetInstallmentCount,
      paymentFrequency: targetFrequency,
      amortizationMethod: targetMethod,
      useSuggestedRate: true,
      legalFeeMode: targetLegalFeeMode,
      interestOnlyPeriods: targetInterestOnly,
    },
    justification:
      justification?.trim() ||
      `Ajuste de condiciones en Evaluación: ${formatMoney(targetAmount, application.currency)} · ${targetTermMonths} meses (${PAYMENT_FREQUENCY_LABELS[targetFrequency]}) · ${AMORTIZATION_METHOD_LABELS[targetMethod]} · Gastos legales: ${LEGAL_FEE_MODE_LABELS[targetLegalFeeMode]}.`,
    user: effectiveUser,
  });

  const nowIso = new Date().toISOString();
  const execPayload = sanitizeScoringExecutionPayload({
    ...evalIntegrated.scoring,
    organizationId: application.organizationId,
    applicationId: application.id,
    executedBy: actorUid,
    executedByName: effectiveUser.displayName,
  });
  const validScoringDoc =
    Array.isArray(execPayload.indicatorDetails) && execPayload.indicatorDetails.length === 22;

  const calculatedInstallment =
    evalIntegrated.analysis.financialSummary?.initialInstallment ?? execPayload.recommendedInstallment;

  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: `Condiciones ajustadas en Evaluación: ${formatMoney(targetAmount, application.currency)} · ${targetTermMonths}m ${PAYMENT_FREQUENCY_LABELS[targetFrequency]} · ${AMORTIZATION_METHOD_LABELS[targetMethod]} · Tasa política ${policySuggestion.tasa}%`,
    fromStatus: application.status,
    toStatus: application.status,
    userId: actorUid,
    userName: effectiveUser.displayName,
    userRole: effectiveUser.role,
    note: `Gastos legales (${formatMoney(policySuggestion.gastosLegales, application.currency)}): ${LEGAL_FEE_MODE_LABELS[targetLegalFeeMode]}. ${justification?.trim() || ''}`.trim(),
  });

  const batch = writeBatch(db);
  if (validScoringDoc) {
    batch.set(doc(db, 'scoring_executions', execPayload.id), execPayload);
  }
  if (
    application.activeFinancialAnalysisId &&
    application.activeFinancialAnalysisId !== evalIntegrated.analysis.id
  ) {
    batch.update(doc(db, 'financial_analyses', application.activeFinancialAnalysisId), {
      status: 'HISTORICO',
      updatedAt: serverTimestamp(),
    });
  }

  const analysisPayload = cleanObject({
    ...evalIntegrated.analysis,
    organizationId: application.organizationId,
    applicationId: application.id,
    scoringExecutionId: validScoringDoc ? execPayload.id : null,
    status: 'VIGENTE' as const,
    calculatedBy: actorUid,
    calculatedByName: effectiveUser.displayName,
    calculatedByRole: effectiveUser.role,
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'financial_analyses', evalIntegrated.analysis.id), analysisPayload);
  batch.set(
    doc(db, 'application_decision_history', evalIntegrated.decisionHistory.id),
    cleanObject({
      ...evalIntegrated.decisionHistory,
      organizationId: application.organizationId,
      applicationId: application.id,
      analysisId: evalIntegrated.analysis.id,
      scoringExecutionId: validScoringDoc ? execPayload.id : null,
      eventType: 'EVALUATION_CONDITIONS_ADJUSTED' as const,
      previousStatus: application.status,
      newStatus: application.status,
      actorId: actorUid,
      actorName: effectiveUser.displayName,
      actorRole: effectiveUser.role,
      createdAt: serverTimestamp(),
    })
  );

  await ensureApplicationPersistedInBatch({
    batch,
    application,
    customer,
    user: effectiveUser,
    updates: {
      requestedAmount: targetAmount,
      requestedTermMonths: targetTermMonths,
      paymentFrequency: targetFrequency,
      amortizationMethod: targetMethod,
      legalFeeMode: targetLegalFeeMode,
      installmentCount: targetInstallmentCount,
      interestOnlyPeriods: targetInterestOnly,
      originalRequestedConditions: originalSnapshot,
      prequalificationStatus: execPayload.status,
      ...(validScoringDoc ? { latestScoringExecutionId: execPayload.id } : {}),
      latestScore: execPayload.totalScore,
      latestRiskBand: execPayload.riskBand.code,
      recommendedAmount: targetAmount,
      recommendedRateMonthly: policyRateDecimal,
      recommendedTermMonths: targetTermMonths,
      recommendedInstallment: calculatedInstallment,
      activeFinancialAnalysisId: evalIntegrated.analysis.id,
      approvedEvaluationAnalysisId: evalIntegrated.analysis.id,
      financialAnalysisVersion: nextVer,
      assignedTo: actorUid,
      assignedToName: effectiveUser.displayName,
      movementHistory: newHistory,
    },
  });

  if (application.isRenewal && application.renewalId) {
    batch.update(
      doc(db, 'credit_renewals', application.renewalId),
      cleanObject({
        status: 'EN_EVALUACION',
        evaluatorId: actorUid,
        evaluatorName: (effectiveUser.displayName || effectiveUser.email || 'Analista').slice(0, 160),
        requestedConditions: {
          amount: targetAmount,
          rateMonthly: policyRateDecimal,
          termMonths: targetTermMonths,
          frequency: targetFrequency,
          amortizationMethod: targetMethod,
          installmentAmount: calculatedInstallment,
          productCode: application.productCode,
          legalFeeMode: targetLegalFeeMode,
        },
        grossApprovedAmount: targetAmount,
        updatedAt: serverTimestamp(),
      })
    );
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: application.organizationId,
      eventType: 'CREDIT_EVALUATION_RECALC',
      entityType: 'applications',
      entityId: application.id,
      action: `Ajuste condiciones Evaluación v${nextVer}: ${formatMoney(targetAmount, application.currency)} / ${targetTermMonths}m ${targetFrequency} / ${targetMethod} / ${targetLegalFeeMode}`,
      previousState: application.status,
      newState: application.status,
      justification:
        justification?.trim() || 'Ajuste de condiciones según política institucional en Evaluación',
      transactionId: evalIntegrated.analysis.idempotencyKey,
      engineVersion: policy.version,
      userId: actorUid,
      userEmail: effectiveUser.email,
      userRole: effectiveUser.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${application.id}`);
  }

  if (evalIntegrated.installments.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      evalIntegrated.installments.map((r) => ({
        ...r,
        organizationId: application.organizationId,
        applicationId: application.id,
      }))
    ).catch((err) => {
      console.warn('Evaluation condition adjustment installments persistence warning:', err);
    });
  }

  return {
    newScoring: { ...evalIntegrated.scoring, executedAt: nowIso } as ScoringExecutionRecord,
    analysis: {
      ...evalIntegrated.analysis,
      status: 'VIGENTE',
      calculatedAt: nowIso,
      updatedAt: nowIso,
    } as FinancialAnalysisRecord,
    policyRatePct: policySuggestion.tasa,
    policyLegalFees: policySuggestion.gastosLegales,
  };
}

export async function saveAnalystEvaluationAndRecalc(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  evaluation: Omit<CreditEvaluationRecord, 'createdAt' | 'updatedAt'>;
  adjustedConditions?: EvaluationAdjustedConditionsInput;
  sendToCommittee: boolean;
  returnToApplicant: boolean;
  user: UserProfile;
}): Promise<{ newScoring: ScoringExecutionRecord }> {
  const {
    application,
    customer,
    policy,
    evaluation,
    adjustedConditions,
    sendToCommittee,
    returnToApplicant,
    user,
  } = params;

  if (!hasRolePermission(user.role, 'EDIT_VERIFIED_FINANCIALS')) {
    throw new Error('Permiso RBAC denegado: solo Analista de Créditos o Administrador puede registrar la depuración analítica.');
  }

  if (sendToCommittee) {
    if (
      !evaluation.referencesVerified ||
      !evaluation.addressVerified ||
      !evaluation.phoneVerified ||
      !evaluation.socialMediaVerified
    ) {
      throw new Error(
        'Debe completar el checklist de depuración del cliente (Referencias, Dirección, Teléfono y Redes Sociales) antes de enviar a Comité.'
      );
    }
  }

  const effAmount =
    adjustedConditions && adjustedConditions.requestedAmount > 0
      ? adjustedConditions.requestedAmount
      : evaluation.recommendedAmount !== null &&
          evaluation.recommendedAmount !== undefined &&
          evaluation.recommendedAmount > 0
      ? evaluation.recommendedAmount
      : application.requestedAmount;
  const effTerm =
    adjustedConditions && adjustedConditions.termMonths > 0
      ? Math.max(1, Math.round(adjustedConditions.termMonths))
      : evaluation.recommendedTermMonths !== null &&
          evaluation.recommendedTermMonths !== undefined &&
          evaluation.recommendedTermMonths > 0
      ? Math.max(1, Math.round(evaluation.recommendedTermMonths))
      : application.requestedTermMonths;
  const effFrequency: PaymentFrequency =
    adjustedConditions?.paymentFrequency ?? application.paymentFrequency;
  const effMethod: AmortizationMethod =
    adjustedConditions?.amortizationMethod ?? application.amortizationMethod;
  const effLegalFeeMode: LegalFeeApplicationMode =
    adjustedConditions?.legalFeeMode ?? application.legalFeeMode ?? 'DESCONTAR_DESEMBOLSO';
  const effInterestOnly =
    adjustedConditions?.interestOnlyPeriods ?? application.interestOnlyPeriods ?? 0;
  const effInstallmentCount = computeInstallmentCountFromMonths(effTerm, effFrequency);
  const originalSnapshot =
    application.originalRequestedConditions ?? buildOriginalRequestedConditions(application);

  // Resolve institutional policy rate & legal fees strictly from configured scale
  let policyRateDecimal = normalizeMonthlyRateDecimal(
    evaluation.recommendedRateMonthly ?? application.recommendedRateMonthly ?? 0.05,
    0.05
  );
  if (effAmount >= 1) {
    try {
      const policySug = suggestLoanConditions(application.currency, effAmount);
      policyRateDecimal = Number((policySug.tasa / 100).toFixed(6));
    } catch {
      // Fallback to existing rate if out of bounds
    }
  }

  const updatedAppForScoring: ApplicationRecord = {
    ...application,
    requestedAmount: effAmount,
    requestedTermMonths: effTerm,
    paymentFrequency: effFrequency,
    amortizationMethod: effMethod,
    legalFeeMode: effLegalFeeMode,
    installmentCount: effInstallmentCount,
    interestOnlyPeriods: effInterestOnly,
    originalRequestedConditions: originalSnapshot,
    verifiedFinancialData: (evaluation.verifiedSnapshot.financialData as ApplicationRecord['financialData']) ?? application.financialData,
    verifiedBusinessFinancialData:
      (evaluation.verifiedSnapshot.businessFinancialData as ApplicationRecord['businessFinancialData']) ??
      application.businessFinancialData,
  };

  // Generate NEW versioned execution without overwriting historical scoring_executions
  const newScoring = await runBackendDecisionEngine({
    application: updatedAppForScoring,
    customer,
    policy,
    useVerifiedData: true,
    executionTrigger: 'ANALYST_RECALC',
    executedBy: user.uid,
    executedByName: user.displayName,
  });

  const targetStatus = returnToApplicant
    ? 'DEVUELTA'
    : sendToCommittee
    ? 'EN_COMITE'
    : 'EN_EVALUACION';

  const effRecAmount = effAmount > 0 ? effAmount : newScoring.recommendedAmount;
  const effRecRate = policyRateDecimal > 0 ? policyRateDecimal : normalizeMonthlyRateDecimal(newScoring.recommendedRateMonthly, 0);
  const effRecTerm = effTerm > 0 ? effTerm : newScoring.recommendedTermMonths;

  const nowIso = new Date().toISOString();
  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: `Evaluación analítica (${evaluation.recommendedDecision}) y recálculo Motor V2: Score ${newScoring.totalScore}/100`,
    fromStatus: application.status,
    toStatus: targetStatus,
    userId: user.uid,
    userName: user.displayName,
    note: evaluation.justification || evaluation.findings || null,
  });

  const evalRef = doc(db, 'credit_evaluations', evaluation.id);
  const existingEval = await getDoc(evalRef).catch(() => null);

  const batch = writeBatch(db);
  const validScoringDoc = Array.isArray(newScoring.indicatorDetails) && newScoring.indicatorDetails.length === 22;
  if (validScoringDoc) {
    batch.set(
      doc(db, 'scoring_executions', newScoring.id),
      sanitizeScoringExecutionPayload(newScoring)
    );
  }

  // Create a new versioned FinancialAnalysis marked VIGENTE applying institutional policy rate & legal fees
  // while preserving all prior versions as HISTORICO.
  let evalAnalysisId: string | null = application.activeFinancialAnalysisId ?? null;
  let evalAnalysisVersion: number = application.financialAnalysisVersion ?? 1;
  let evalCalculatedInstallment: number | null = null;
  let evalInstallmentsToSave: Array<Omit<FinancialAnalysisInstallmentRecord, 'createdAt'>> = [];

  if (effRecAmount > 0 && effRecTerm > 0) {
    try {
      const nextVer = (application.financialAnalysisVersion ?? 1) + 1;
      const evalIntegrated = await runBackendIntegratedDecisionAndCalculation({
        application: updatedAppForScoring,
        customer,
        policy,
        analysisType: 'AJUSTE_EVALUACION',
        version: nextVer,
        useVerifiedData: true,
        alternativeConditions: {
          requestedAmount: effRecAmount,
          termMonths: effRecTerm,
          installmentCount: effInstallmentCount,
          paymentFrequency: effFrequency,
          amortizationMethod: effMethod,
          useSuggestedRate: true,
          legalFeeMode: effLegalFeeMode,
          interestOnlyPeriods: effInterestOnly,
        },
        justification: evaluation.justification || evaluation.findings || 'Ajuste en etapa de Evaluación',
        user,
      });

      evalAnalysisId = evalIntegrated.analysis.id;
      evalAnalysisVersion = nextVer;
      evalCalculatedInstallment = evalIntegrated.analysis.financialSummary?.initialInstallment ?? null;
      evalInstallmentsToSave = evalIntegrated.installments;

      if (
        application.activeFinancialAnalysisId &&
        application.activeFinancialAnalysisId !== evalIntegrated.analysis.id
      ) {
        batch.update(doc(db, 'financial_analyses', application.activeFinancialAnalysisId), {
          status: 'HISTORICO',
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(
        doc(db, 'financial_analyses', evalIntegrated.analysis.id),
        cleanObject({
          ...evalIntegrated.analysis,
          organizationId: application.organizationId,
          applicationId: application.id,
          scoringExecutionId: validScoringDoc ? newScoring.id : null,
          status: 'VIGENTE' as const,
          calculatedBy: user.uid,
          calculatedByName: user.displayName,
          calculatedByRole: user.role,
          calculatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      batch.set(
        doc(db, 'application_decision_history', evalIntegrated.decisionHistory.id),
        cleanObject({
          ...evalIntegrated.decisionHistory,
          organizationId: application.organizationId,
          applicationId: application.id,
          analysisId: evalIntegrated.analysis.id,
          scoringExecutionId: validScoringDoc ? newScoring.id : null,
          eventType: 'EVALUATION_CONDITIONS_ADJUSTED' as const,
          previousStatus: application.status,
          newStatus: targetStatus,
          actorId: user.uid,
          actorName: user.displayName,
          actorRole: user.role,
          createdAt: serverTimestamp(),
        })
      );
    } catch (evalCalcErr) {
      console.warn('Evaluation financial analysis versioning warning:', evalCalcErr);
    }
  }

  await ensureApplicationPersistedInBatch({
    batch,
    application,
    customer,
    user,
    updates: {
      requestedAmount: effRecAmount,
      requestedTermMonths: effRecTerm,
      paymentFrequency: effFrequency,
      amortizationMethod: effMethod,
      legalFeeMode: effLegalFeeMode,
      installmentCount: effInstallmentCount,
      interestOnlyPeriods: effInterestOnly,
      originalRequestedConditions: originalSnapshot,
      verifiedFinancialData: updatedAppForScoring.verifiedFinancialData ?? null,
      verifiedBusinessFinancialData: updatedAppForScoring.verifiedBusinessFinancialData ?? null,
      status: targetStatus,
      prequalificationStatus: newScoring.status,
      ...(validScoringDoc ? { latestScoringExecutionId: newScoring.id } : {}),
      latestScore: newScoring.totalScore,
      latestRiskBand: newScoring.riskBand.code,
      recommendedAmount: effRecAmount,
      recommendedRateMonthly: effRecRate,
      recommendedTermMonths: effRecTerm,
      recommendedInstallment: evalCalculatedInstallment ?? newScoring.recommendedInstallment,
      ...(evalAnalysisId
        ? {
            activeFinancialAnalysisId: evalAnalysisId,
            approvedEvaluationAnalysisId: evalAnalysisId,
            financialAnalysisVersion: evalAnalysisVersion,
          }
        : {}),
      assignedTo: user.uid,
      assignedToName: user.displayName,
      movementHistory: newHistory,
    },
  });

  if (application.isRenewal && application.renewalId) {
    const nextRenStatus =
      targetStatus === 'EN_COMITE'
        ? 'PENDIENTE_COMITE'
        : targetStatus === 'DEVUELTA'
        ? 'DEVUELTA_CORRECCION'
        : 'EN_EVALUACION';
    batch.update(
      doc(db, 'credit_renewals', application.renewalId),
      cleanObject({
        status: nextRenStatus,
        evaluatorId: user.uid,
        evaluatorName: (user.displayName || user.email || 'Analista').slice(0, 160),
        requestedConditions: {
          amount: effRecAmount,
          rateMonthly: effRecRate,
          termMonths: effRecTerm,
          frequency: effFrequency,
          amortizationMethod: effMethod,
          installmentAmount: evalCalculatedInstallment ?? newScoring.recommendedInstallment ?? 0,
          productCode: application.productCode,
          legalFeeMode: effLegalFeeMode,
        },
        grossApprovedAmount: effRecAmount,
        updatedAt: serverTimestamp(),
      })
    );
  }

  if (existingEval?.exists()) {
    batch.update(
      evalRef,
      cleanObject({
        verifiedSnapshot: evaluation.verifiedSnapshot,
        updatedScoringId: validScoringDoc ? newScoring.id : evaluation.updatedScoringId ?? null,
        identityVerified: evaluation.identityVerified,
        incomeVerified: evaluation.incomeVerified,
        obligationsVerified: evaluation.obligationsVerified,
        referencesVerified: evaluation.referencesVerified,
        addressVerified: Boolean(evaluation.addressVerified),
        phoneVerified: Boolean(evaluation.phoneVerified),
        socialMediaVerified: Boolean(evaluation.socialMediaVerified),
        findings: evaluation.findings,
        observations: evaluation.observations,
        technicalReport: evaluation.technicalReport,
        recommendedDecision: evaluation.recommendedDecision,
        recommendedAmount: evaluation.recommendedAmount ?? null,
        recommendedRateMonthly:
          evaluation.recommendedRateMonthly !== null && evaluation.recommendedRateMonthly !== undefined
            ? normalizeMonthlyRateDecimal(evaluation.recommendedRateMonthly, 0)
            : null,
        recommendedTermMonths: evaluation.recommendedTermMonths ?? null,
        recommendedConditions: evaluation.recommendedConditions ?? '',
        justification: evaluation.justification ?? '',
        status: sendToCommittee || returnToApplicant ? 'COMPLETADA' : 'BORRADOR',
        updatedAt: serverTimestamp(),
      })
    );
  } else {
    batch.set(
      evalRef,
      cleanObject({
        ...evaluation,
        recommendedRateMonthly:
          evaluation.recommendedRateMonthly !== null && evaluation.recommendedRateMonthly !== undefined
            ? normalizeMonthlyRateDecimal(evaluation.recommendedRateMonthly, 0)
            : null,
        addressVerified: Boolean(evaluation.addressVerified),
        phoneVerified: Boolean(evaluation.phoneVerified),
        socialMediaVerified: Boolean(evaluation.socialMediaVerified),
        updatedScoringId: validScoringDoc ? newScoring.id : evaluation.updatedScoringId ?? null,
        status: sendToCommittee || returnToApplicant ? 'COMPLETADA' : 'BORRADOR',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: application.organizationId,
      eventType: 'CREDIT_EVALUATION_RECALC',
      entityType: 'applications',
      entityId: application.id,
      action: `Evaluación analítica -> ${targetStatus} (Score ${newScoring.totalScore}/100)`,
      previousState: application.status,
      newState: targetStatus,
      justification: evaluation.justification || evaluation.findings || 'Depuración analítica',
      transactionId: generateId('tx'),
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `credit_evaluations/${evaluation.id}`);
  }

  if (evalInstallmentsToSave.length > 0) {
    await persistFinancialAnalysisInstallmentsChunked(
      evalInstallmentsToSave.map((r) => ({
        ...r,
        organizationId: application.organizationId,
        applicationId: application.id,
      }))
    ).catch((err) => {
      console.warn('Evaluation installments persistence warning:', err);
    });
  }

  if (targetStatus !== application.status) {
    await enqueueCustomerStatusEmail({
      application: updatedAppForScoring,
      customer,
      eventCode: targetStatus,
      fromStatus: application.status,
      toStatus: targetStatus,
      historyLength: newHistory.length,
      user,
      observations: evaluation.justification || evaluation.findings,
    });
  }

  return {
    newScoring: { ...newScoring, executedAt: nowIso },
  };
}

export async function saveRiskOfficerSignOff(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  existingEvaluation: CreditEvaluationRecord | null;
  riskOpinionStatus: RiskOpinionStatus;
  riskOpinionNotes: string;
  recalculateScoring: boolean;
  action: 'SAVE_ONLY' | 'ESCALATE_COMMITTEE' | 'RETURN';
  user: UserProfile;
}): Promise<{ newScoring: ScoringExecutionRecord | null }> {
  const {
    application,
    customer,
    policy,
    existingEvaluation,
    riskOpinionStatus,
    riskOpinionNotes,
    recalculateScoring,
    action,
    user,
  } = params;

  if (!hasRolePermission(user.role, 'RISK_SIGN_OFF')) {
    throw new Error('Permiso RBAC denegado: solo el Oficial de Riesgo o Administrador puede emitir el dictamen de riesgo.');
  }

  let newScoring: Omit<ScoringExecutionRecord, 'executedAt'> | null = null;
  if (recalculateScoring) {
    newScoring = await runBackendDecisionEngine({
      application,
      customer,
      policy,
      useVerifiedData: Boolean(application.verifiedFinancialData || application.verifiedBusinessFinancialData),
      executionTrigger: 'MANUAL_RERUN',
      executedBy: user.uid,
      executedByName: user.displayName,
    });
  }

  const targetStatus =
    action === 'RETURN'
      ? 'DEVUELTA'
      : action === 'ESCALATE_COMMITTEE'
      ? 'EN_COMITE'
      : 'EN_EVALUACION';

  const nowIso = new Date().toISOString();
  const actionLabel =
    action === 'RETURN'
      ? `Oficial de Riesgo devolvió expediente (${riskOpinionStatus})`
      : action === 'ESCALATE_COMMITTEE'
      ? `Oficial de Riesgo avaló y escaló a Comité (${riskOpinionStatus})`
      : `Oficial de Riesgo registró dictamen (${riskOpinionStatus})`;

  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: newScoring
      ? `${actionLabel} · Score V2: ${newScoring.totalScore}/100`
      : actionLabel,
    fromStatus: application.status,
    toStatus: targetStatus,
    userId: user.uid,
    userName: user.displayName,
    note: riskOpinionNotes.trim() || null,
  });

  const evalId = existingEvaluation?.id ?? generateId('eval');
  const evalRef = doc(db, 'credit_evaluations', evalId);
  const existingEvalSnap = await getDoc(evalRef).catch(() => null);
  const batch = writeBatch(db);

  const validScoringDoc = Boolean(
    newScoring && Array.isArray(newScoring.indicatorDetails) && newScoring.indicatorDetails.length === 22
  );
  if (newScoring && validScoringDoc) {
    batch.set(
      doc(db, 'scoring_executions', newScoring.id),
      sanitizeScoringExecutionPayload(newScoring)
    );
  }

  await ensureApplicationPersistedInBatch({
    batch,
    application,
    customer,
    user,
    updates: {
      status: targetStatus,
      ...(newScoring
        ? {
            prequalificationStatus: newScoring.status,
            ...(validScoringDoc ? { latestScoringExecutionId: newScoring.id } : {}),
            latestScore: newScoring.totalScore,
            latestRiskBand: newScoring.riskBand.code,
            recommendedAmount: newScoring.recommendedAmount,
            recommendedRateMonthly: normalizeMonthlyRateDecimal(newScoring.recommendedRateMonthly, 0),
            recommendedTermMonths: newScoring.recommendedTermMonths,
            recommendedInstallment: newScoring.recommendedInstallment,
          }
        : {}),
      movementHistory: newHistory,
    },
  });

  if (existingEvalSnap?.exists()) {
    batch.update(
      evalRef,
      cleanObject({
        riskOpinionStatus,
        riskOpinionNotes: riskOpinionNotes.trim(),
        riskOfficerId: user.uid,
        riskOfficerName: user.displayName,
        riskReviewedAt: nowIso,
        ...(newScoring && validScoringDoc ? { updatedScoringId: newScoring.id } : {}),
        updatedAt: serverTimestamp(),
      })
    );
  } else {
    batch.set(
      evalRef,
      cleanObject({
        id: evalId,
        organizationId: application.organizationId,
        applicationId: application.id,
        analystId: user.uid,
        analystName: user.displayName,
        declaredSnapshot: {
          financialData: application.financialData,
          businessFinancialData: application.businessFinancialData ?? null,
        },
        verifiedSnapshot: {
          financialData: application.verifiedFinancialData ?? application.financialData,
          businessFinancialData:
            application.verifiedBusinessFinancialData ?? application.businessFinancialData ?? null,
        },
        preliminaryScoringId: application.latestScoringExecutionId ?? null,
        updatedScoringId:
          (validScoringDoc ? newScoring?.id : null) ?? application.latestScoringExecutionId ?? null,
        identityVerified: false,
        incomeVerified: false,
        obligationsVerified: false,
        referencesVerified: false,
        findings: '',
        observations: '',
        technicalReport: '',
        recommendedDecision: riskOpinionStatus === 'RECHAZO_RIESGO' ? 'RECHAZAR' : 'APROBAR',
        riskOpinionStatus,
        riskOpinionNotes: riskOpinionNotes.trim(),
        riskOfficerId: user.uid,
        riskOfficerName: user.displayName,
        riskReviewedAt: nowIso,
        status: 'BORRADOR',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: application.organizationId,
      eventType: 'RISK_OFFICER_REVIEW',
      entityType: 'credit_evaluations',
      entityId: evalId,
      action: actionLabel,
      previousState: application.status,
      newState: targetStatus,
      justification: riskOpinionNotes.trim() || `Dictamen ${riskOpinionStatus}`,
      transactionId: generateId('tx'),
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `credit_evaluations/${evalId}`);
  }

  if (targetStatus !== application.status) {
    await enqueueCustomerStatusEmail({
      application,
      customer,
      eventCode: targetStatus,
      fromStatus: application.status,
      toStatus: targetStatus,
      historyLength: newHistory.length,
      user,
      observations: riskOpinionNotes.trim(),
    });
  }

  return {
    newScoring: newScoring ? { ...newScoring, executedAt: nowIso } : null,
  };
}

export async function submitCommitteeDecision(params: {
  application: ApplicationRecord;
  evaluation?: CreditEvaluationRecord | null;
  policy: CreditPolicyRecord;
  decisionInput: Omit<CommitteeDecisionRecord, 'decidedAt' | 'isImmutable' | 'authorityUsed'>;
  user: UserProfile;
}): Promise<{
  resolved: boolean;
  voteCount: number;
  approveCount: number;
  resolvedDecision: CommitteeDecisionRecord['decision'] | null;
}> {
  const { application, evaluation, policy, decisionInput, user } = params;

  const check = canUserApproveCommittee({
    userId: user.uid,
    userRole: user.role,
    application,
    evaluation,
    proposedAmount: decisionInput.approvedAmount ?? application.requestedAmount,
    policy,
  });

  if (!check.allowed) {
    throw new Error(check.reason || 'Usuario sin facultades para decidir en Comité.');
  }

  if (decisionInput.decision === 'RECHAZADO' && !decisionInput.rejectionReason?.trim()) {
    throw new Error('El rechazo requiere un motivo documentado obligatorio.');
  }

  const isApprovalVote =
    decisionInput.decision === 'APROBADO' || decisionInput.decision === 'APROBADO_CONDICIONADO';
  if (isApprovalVote) {
    const proposedAmt =
      decisionInput.approvedAmount ?? application.recommendedAmount ?? application.requestedAmount;
    const proposedTerm =
      decisionInput.approvedTermMonths ??
      application.recommendedTermMonths ??
      application.requestedTermMonths;
    if (!Number.isFinite(proposedAmt) || proposedAmt <= 0) {
      throw new Error('Debe indicar un monto aprobado mayor a cero.');
    }
    if (!Number.isFinite(proposedTerm) || proposedTerm < 1) {
      throw new Error('Debe indicar un plazo aprobado de al menos 1 mes.');
    }
  }

  const safeOrgIdInitial =
    typeof application.organizationId === 'string' && VALID_ID_REGEX.test(application.organizationId.trim())
      ? application.organizationId.trim()
      : user.organizationId || DEFAULT_ORG_ID;
  const safeActorName =
    String(decisionInput.decidedByName || user.displayName || user.email || 'Miembro de Comité')
      .trim()
      .slice(0, 160) || 'Miembro de Comité';
  const safeActorRole =
    String(decisionInput.decidedByRole || user.role || 'COMMITTEE_MEMBER')
      .trim()
      .slice(0, 64) || 'COMMITTEE_MEMBER';
  const safeFrequency: PaymentFrequency = VALID_PAYMENT_FREQUENCIES.has(
    String(decisionInput.approvedFrequency ?? application.paymentFrequency)
  )
    ? ((decisionInput.approvedFrequency ?? application.paymentFrequency) as PaymentFrequency)
    : 'MENSUAL';
  const safeAmortization: AmortizationMethod = VALID_AMORTIZATION_METHODS.has(
    String(decisionInput.approvedAmortizationMethod ?? application.amortizationMethod)
  )
    ? ((decisionInput.approvedAmortizationMethod ?? application.amortizationMethod) as AmortizationMethod)
    : 'SALDO_INSOLUTO';

  const safeApprovedAmount =
    decisionInput.approvedAmount !== null &&
    decisionInput.approvedAmount !== undefined &&
    Number.isFinite(Number(decisionInput.approvedAmount)) &&
    Number(decisionInput.approvedAmount) >= 0
      ? Number(Number(decisionInput.approvedAmount).toFixed(2))
      : null;
  const safeApprovedRateMonthly =
    decisionInput.approvedRateMonthly !== null &&
    decisionInput.approvedRateMonthly !== undefined &&
    Number.isFinite(Number(decisionInput.approvedRateMonthly)) &&
    Number(decisionInput.approvedRateMonthly) >= 0
      ? normalizeMonthlyRateDecimal(decisionInput.approvedRateMonthly, 0.04)
      : null;
  const safeApprovedTermMonths =
    decisionInput.approvedTermMonths !== null &&
    decisionInput.approvedTermMonths !== undefined &&
    Number.isFinite(Number(decisionInput.approvedTermMonths)) &&
    Number(decisionInput.approvedTermMonths) >= 0
      ? Math.round(Number(decisionInput.approvedTermMonths))
      : null;

  const normalizedDecisionInput = {
    ...decisionInput,
    organizationId: safeOrgIdInitial,
    applicationId: application.id,
    approvedAmount: safeApprovedAmount,
    approvedRateMonthly: safeApprovedRateMonthly,
    approvedTermMonths: safeApprovedTermMonths,
    approvedFrequency: safeFrequency,
    approvedAmortizationMethod: safeAmortization,
    conditions: Array.isArray(decisionInput.conditions) ? decisionInput.conditions.slice(0, 20) : [],
    conditionsFulfilled: Boolean(decisionInput.conditionsFulfilled),
    rejectionReason:
      decisionInput.rejectionReason && String(decisionInput.rejectionReason).trim()
        ? String(decisionInput.rejectionReason).trim().slice(0, 2000)
        : null,
    observations: String(decisionInput.observations ?? '').trim().slice(0, 3000),
    decidedBy: user.uid,
    decidedByName: safeActorName,
    decidedByRole: safeActorRole,
  };

  // Load prior votes cast for this application in this organization using a single-field query (no composite index required)
  const existingSnap = await getDocs(
    query(collection(db, 'committee_decisions'), where('organizationId', '==', safeOrgIdInitial))
  ).catch(() => null);

  const priorVotes: CollegialVoteEntry[] = [];
  if (existingSnap) {
    for (const d of existingSnap.docs) {
      const rec = d.data() as CommitteeDecisionRecord;
      if (rec.applicationId !== application.id) continue;
      if (rec.voteStatus === 'RESOLUCION_FINAL' && Array.isArray(rec.collegialVotes)) {
        rec.collegialVotes.forEach((v) => priorVotes.push(v));
      } else {
        priorVotes.push({
          userId: rec.decidedBy,
          userName: rec.decidedByName,
          role: rec.decidedByRole,
          vote: rec.decision,
          votedAt: String(rec.decidedAt ?? ''),
        });
      }
    }
  }

  if (priorVotes.some((v) => v.userId === user.uid)) {
    throw new Error('Ya emitiste tu voto para este expediente. Se requieren votos de miembros distintos (2 de 3).');
  }

  const nowIso = new Date().toISOString();
  const thisVote: CollegialVoteEntry = {
    userId: user.uid,
    userName: safeActorName,
    role: safeActorRole,
    vote: normalizedDecisionInput.decision,
    votedAt: nowIso,
  };

  const voteEval = evaluateCollegialCommitteeVotes([...priorVotes, thisVote], 2, 3);
  const voteDocId = `dec_${sanitizeIdSegment(application.id)}_${sanitizeIdSegment(user.uid)}`.slice(0, 120);
  const safeAuthorityUsed = String(check.authorityUsed ?? 'Facultad de Comité').trim().slice(0, 200);
  const safeCollegialVotes = voteEval.uniqueVotes.slice(0, 15).map((v) => ({
    userId: String(v.userId || '').slice(0, 128),
    userName: String(v.userName || 'Votante').slice(0, 160),
    role: String(v.role || 'COMMITTEE_MEMBER').slice(0, 64),
    vote: String(v.vote || 'APROBADO').slice(0, 40),
    votedAt: String(v.votedAt || nowIso).slice(0, 40),
  }));

  if (voteEval.resolvedDecision === null) {
    const newHistory = appendMovementHistory(application.movementHistory, {
      timestamp: nowIso,
      action: `Voto Comité (${voteEval.totalVotes}/3): ${safeActorName} votó ${normalizedDecisionInput.decision} (${voteEval.approveCount}/2 requeridos)`,
      fromStatus: application.status,
      toStatus: 'EN_COMITE',
      userId: user.uid,
      userName: safeActorName,
      note: normalizedDecisionInput.observations || normalizedDecisionInput.rejectionReason || null,
    });

    const batch = writeBatch(db);
    const persisted = await ensureApplicationPersistedInBatch({
      batch,
      application,
      user,
      updates: {
        status: 'EN_COMITE',
        movementHistory: newHistory,
      },
    });
    const effectiveOrgId = persisted.organizationId || safeOrgIdInitial;

    batch.set(
      doc(db, 'committee_decisions', voteDocId),
      cleanObject({
        ...normalizedDecisionInput,
        id: voteDocId,
        organizationId: effectiveOrgId,
        collegialVotes: safeCollegialVotes,
        voteStatus: 'VOTO_PARCIAL',
        requiredVotes: 2,
        totalPanelMembers: 3,
        authorityUsed: safeAuthorityUsed,
        isImmutable: true,
        decidedAt: serverTimestamp(),
      })
    );

    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      ...buildCriticalAuditEntryPayload({
        id: auditId,
        organizationId: effectiveOrgId,
        eventType: 'COMMITTEE_VOTE_RECORDED',
        entityType: 'committee_decisions',
        entityId: voteDocId,
        action: `Voto ${voteEval.totalVotes}/3 emitido (${normalizedDecisionInput.decision}) para ${application.applicationNumber}`,
        previousState: application.status,
        newState: 'EN_COMITE',
        justification:
          normalizedDecisionInput.observations ||
          normalizedDecisionInput.rejectionReason ||
          safeAuthorityUsed ||
          '',
        transactionId: generateId('tx'),
        userId: user.uid,
        userEmail: user.email,
        userRole: safeActorRole,
      }),
      timestamp: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `committee_decisions/${voteDocId}`);
    }

    return {
      resolved: false,
      voteCount: voteEval.totalVotes,
      approveCount: voteEval.approveCount,
      resolvedDecision: null,
    };
  }

  // Quorum (2 of 3) reached -> Emit final resolution and auto-generate Formalization + Amortization Email
  const resolvedDecision = voteEval.resolvedDecision;
  const nextAppStatus =
    resolvedDecision === 'APROBADO'
      ? 'APROBADA'
      : resolvedDecision === 'APROBADO_CONDICIONADO'
      ? 'APROBADA_CONDICIONADA'
      : resolvedDecision === 'DEVUELTO'
      ? 'DEVUELTA'
      : 'RECHAZADA';

  const newHistory = appendMovementHistory(application.movementHistory, {
    timestamp: nowIso,
    action: `Resolución Colegiada Comité (${voteEval.approveCount >= 2 ? `${voteEval.approveCount}/3 a favor` : `${voteEval.totalVotes}/3 votos`}): ${resolvedDecision}`,
    fromStatus: application.status,
    toStatus: nextAppStatus,
    userId: user.uid,
    userName: safeActorName,
    note: normalizedDecisionInput.observations || normalizedDecisionInput.rejectionReason || null,
  });

  const rawApprovedCapital =
    normalizedDecisionInput.approvedAmount ??
    application.recommendedAmount ??
    application.requestedAmount;
  const approvedCapital = Number(
    Math.max(1, Number.isFinite(Number(rawApprovedCapital)) ? Number(rawApprovedCapital) : 1).toFixed(2)
  );
  const contractualRate = normalizeMonthlyRateDecimal(
    normalizedDecisionInput.approvedRateMonthly ?? application.recommendedRateMonthly ?? 0.04,
    0.04
  );
  const termMonths = Math.max(
    1,
    Math.min(
      360,
      Math.round(
        normalizedDecisionInput.approvedTermMonths ??
          application.recommendedTermMonths ??
          application.requestedTermMonths ??
          12
      )
    )
  );
  const disbTargetDate = toIsoDateOnly();
  const firstPayDate = addMonthsPreservingAnchor(disbTargetDate, 1);

  let scheduleRows: Array<{
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    remainingPrincipalBalance: number;
  }> = [];

  let customer: CustomerRecord | null = null;
  if (application.customerId) {
    const custSnap = await getDoc(doc(db, 'customers', application.customerId)).catch(() => null);
    if (custSnap?.exists()) {
      customer = custSnap.data() as CustomerRecord;
    }
  }

  const formId = `form_${sanitizeIdSegment(application.id)}`.slice(0, 128);
  let autoFormPayload: Record<string, unknown> | null = null;

  const batch = writeBatch(db);
  const persisted = await ensureApplicationPersistedInBatch({
    batch,
    application,
    user,
    updates: {
      status: nextAppStatus,
      movementHistory: newHistory,
    },
  });
  const effectiveOrgId = persisted.organizationId || safeOrgIdInitial;

  const finalDecisionPayload = cleanObject({
    ...normalizedDecisionInput,
    id: voteDocId,
    organizationId: effectiveOrgId,
    decision: resolvedDecision,
    collegialVotes: safeCollegialVotes,
    voteStatus: 'RESOLUCION_FINAL',
    requiredVotes: 2,
    totalPanelMembers: 3,
    authorityUsed: safeAuthorityUsed,
    isImmutable: true,
    decidedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'committee_decisions', voteDocId), finalDecisionPayload);

  if (resolvedDecision === 'APROBADO' || resolvedDecision === 'APROBADO_CONDICIONADO') {
    const originPayoffEstimate = Number(application.originPayoffSnapshot?.totalPayoffAmount ?? 0);
    if (application.isRenewal && originPayoffEstimate > 0) {
      const renewalCheck = calculateRenewalNetDisbursement({
        grossApprovedAmount: approvedCapital,
        payoffAmount: originPayoffEstimate,
        otherAuthorizedDiscounts: 0,
      });
      if (!renewalCheck.valid) {
        throw new Error(
          renewalCheck.reason ||
            'El monto aprobado en Comité no cubre el saldo de cancelación del préstamo anterior.'
        );
      }
    }

    const schedule = generateAmortizationSchedule({
      financedPrincipal: approvedCapital,
      monthlyRate: contractualRate,
      termMonths,
      frequency: safeFrequency,
      amortizationMethod: safeAmortization,
      disbursementDate: disbTargetDate,
      firstPaymentDate: firstPayDate,
    });
    scheduleRows = schedule.rows.map((r) => ({
      installmentNumber: r.installmentNumber,
      dueDate: r.dueDate,
      principalAmount: r.principalAmount,
      interestAmount: r.interestAmount,
      totalAmount: r.totalAmount,
      remainingPrincipalBalance: r.remainingPrincipalBalance,
    }));

    const existingFormSnap = await getDoc(doc(db, 'formalizations', formId)).catch(() => null);
    if (!existingFormSnap?.exists()) {
      const { contractText, promissoryNoteText } = buildDefaultFormalizationContent({
        application: {
          ...application,
          organizationId: effectiveOrgId,
          paymentFrequency: safeFrequency,
          amortizationMethod: safeAmortization,
        },
        customer,
        approvedCapital,
        contractualRate,
        termMonths,
        firstPaymentDate: firstPayDate,
      });

      const renewalContractClause = application.isRenewal
        ? `\n\nCLÁUSULA ESPECIAL DE RENOVACIÓN Y LIQUIDACIÓN DE PRÉSTAMO ANTERIOR:\nEl prestatario autoriza irrevocablemente que del monto aprobado de este nuevo crédito (${formatMoney(approvedCapital, application.currency)}), la entidad liquide y cancele totalmente el saldo actualizado del préstamo anterior No. ${application.originLoanNumber || application.originLoanId || 'N/A'} (estimado en ${formatMoney(originPayoffEstimate, application.currency)}), entregándose únicamente el desembolso neto resultante al momento de la ejecución efectiva del desembolso.\n`
        : '';

      const safeMaturityDate = String(schedule.maturityDate || firstPayDate).slice(0, 20);
      const safeTotalPayable = Number.isFinite(schedule.totalContractualPayable)
        ? Number(schedule.totalContractualPayable.toFixed(2))
        : approvedCapital;
      const safeCollateralDetails =
        typeof application.proposedCollateral === 'string'
          ? application.proposedCollateral.trim().slice(0, 1950)
          : '';
      const initialNetDisb = application.isRenewal
        ? Number(Math.max(0.01, approvedCapital - originPayoffEstimate).toFixed(2))
        : approvedCapital;

      const autoForm: Omit<FormalizationRecord, 'createdAt' | 'updatedAt'> = {
        id: formId,
        organizationId: effectiveOrgId,
        applicationId: application.id,
        decisionId: voteDocId,
        approvedCapital,
        financedExpenses: 0,
        totalFinanced: approvedCapital,
        deductedExpenses: 0,
        netDisbursementAmount: initialNetDisb,
        contractualRateMonthly: contractualRate,
        termMonths,
        frequency: safeFrequency,
        amortizationMethod: safeAmortization,
        disbursementTargetDate: disbTargetDate.slice(0, 20),
        firstPaymentDate: firstPayDate.slice(0, 20),
        maturityDate: safeMaturityDate,
        totalContractualPayable: safeTotalPayable,
        contractTemplateVersion: 'tpl-v1.0-revision-legal',
        contractText: `${contractText}${renewalContractClause}`.slice(0, 19500),
        promissoryNoteText: promissoryNoteText.slice(0, 14500),
        requiredDocsChecklist: [
          { key: 'id_doc', label: 'Documento de identidad vigente', completed: true },
          { key: 'contract_signed', label: 'Contrato de préstamo revisado y correcto', completed: false },
          { key: 'promissory', label: 'Pagaré notarial / mercantil correcto', completed: false },
          { key: 'schedule', label: 'Tabla de amortización generada y enviada al cliente', completed: true },
        ],
        conditionsFulfilled:
          resolvedDecision !== 'APROBADO_CONDICIONADO' ||
          (normalizedDecisionInput.conditions?.length ?? 0) === 0,
        signatures: [],
        collateralDetails: safeCollateralDetails,
        legalReviewConfirmed: false,
        promissoryNoteConfirmed: false,
        contractConfirmed: false,
        ...(application.isRenewal
          ? {
              isRenewal: true,
              renewalId: application.renewalId ?? null,
              originLoanId: application.originLoanId ?? null,
              originLoanNumber: application.originLoanNumber ?? null,
              renewalPayoffAmount: originPayoffEstimate,
              renewalPayoffBreakdown: application.originPayoffSnapshot ?? null,
            }
          : {}),
        status: 'PENDIENTE',
        formalizedBy: user.uid,
        formalizedByName: safeActorName,
      };
      autoFormPayload = cleanObject({
        ...autoForm,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'formalizations', formId), autoFormPayload);
    }
  }

  // Sync credit_renewals status upon Committee resolution (NEVER cancels origin loan here!)
  if (application.isRenewal && application.renewalId) {
    const nextRenewalStatus =
      resolvedDecision === 'APROBADO' || resolvedDecision === 'APROBADO_CONDICIONADO'
        ? 'PENDIENTE_FORMALIZACION'
        : resolvedDecision === 'DEVUELTO'
        ? 'DEVUELTA_CORRECCION'
        : 'RECHAZADA';
    batch.update(
      doc(db, 'credit_renewals', application.renewalId),
      cleanObject({
        status: nextRenewalStatus,
        committeeDecision: resolvedDecision,
        committeeDecidedBy: user.uid,
        committeeDecidedByName: safeActorName,
        committeeDecisionBy: user.uid,
        committeeDecisionByName: safeActorName,
        committeeNotes: normalizedDecisionInput.observations || null,
        rejectionReason: normalizedDecisionInput.rejectionReason || null,
        ...(resolvedDecision === 'APROBADO' || resolvedDecision === 'APROBADO_CONDICIONADO'
          ? {
              formalizationId: formId,
              approvedAmount: approvedCapital,
              grossApprovedAmount: approvedCapital,
              approvedAt: nowIso,
              approvedConditions: {
                amount: approvedCapital,
                rateMonthly: contractualRate,
                termMonths,
                frequency: safeFrequency,
                amortizationMethod: safeAmortization,
                installmentAmount: scheduleRows[0]?.totalAmount ?? 0,
              },
            }
          : {}),
        updatedAt: serverTimestamp(),
      })
    );
  }

  const auditId = generateId('audit');
  const finalAuditPayload = {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: 'COMMITTEE_DECISION_IMMUTABLE',
      entityType: 'committee_decisions',
      entityId: voteDocId,
      action: `Comité resolvió (${voteEval.approveCount}/3) ${resolvedDecision} para ${application.applicationNumber}`,
      previousState: application.status,
      newState: nextAppStatus,
      justification:
        normalizedDecisionInput.observations ||
        normalizedDecisionInput.rejectionReason ||
        safeAuthorityUsed ||
        '',
      transactionId: generateId('tx'),
      userId: user.uid,
      userEmail: user.email,
      userRole: safeActorRole,
    }),
    timestamp: serverTimestamp(),
  };
  batch.set(doc(db, 'audit_logs', auditId), finalAuditPayload);

  try {
    await batch.commit();
  } catch (err) {
    if (autoFormPayload) {
      // Fallback: commit the core collegial decision + application transition + audit log first,
      // then persist the auto-formalization draft independently so a secondary draft conflict never blocks voting.
      const coreBatch = writeBatch(db);
      await ensureApplicationPersistedInBatch({
        batch: coreBatch,
        application,
        user,
        updates: {
          status: nextAppStatus,
          movementHistory: newHistory,
        },
      });
      coreBatch.set(doc(db, 'committee_decisions', voteDocId), finalDecisionPayload);
      coreBatch.set(doc(db, 'audit_logs', auditId), finalAuditPayload);
      try {
        await coreBatch.commit();
        await setDoc(doc(db, 'formalizations', formId), autoFormPayload).catch((formErr) => {
          console.warn('Auto-formalization draft skipped after committee approval:', formErr);
        });
      } catch (coreErr) {
        handleFirestoreError(coreErr, OperationType.WRITE, `committee_decisions/${voteDocId}`);
      }
    } else {
      handleFirestoreError(err, OperationType.WRITE, `committee_decisions/${voteDocId}`);
    }
  }

  await enqueueCustomerStatusEmail({
    application: {
      ...application,
      organizationId: effectiveOrgId,
      paymentFrequency: safeFrequency,
      amortizationMethod: safeAmortization,
    },
    customer,
    eventCode: nextAppStatus,
    fromStatus: application.status,
    toStatus: nextAppStatus,
    historyLength: newHistory.length,
    user,
    approvedAmount: approvedCapital,
    approvedRateMonthly: contractualRate,
    approvedTermMonths: termMonths,
    conditions: normalizedDecisionInput.conditions?.map((c) => c.text) ?? [],
    rejectionReason: normalizedDecisionInput.rejectionReason ?? null,
    observations: normalizedDecisionInput.observations ?? null,
    amortizationSchedule: scheduleRows,
    paymentFrequency: application.paymentFrequency,
    firstPaymentDate: firstPayDate,
  });

  return {
    resolved: true,
    voteCount: voteEval.totalVotes,
    approveCount: voteEval.approveCount,
    resolvedDecision,
  };
}

export async function saveFormalizationRecord(params: {
  application: ApplicationRecord;
  formalization: Omit<FormalizationRecord, 'createdAt' | 'updatedAt'>;
  markReadyForDisbursement: boolean;
  user: UserProfile;
}): Promise<void> {
  const { application, formalization, markReadyForDisbursement, user } = params;

  const safeApprovedCapital = Number(
    (Number.isFinite(Number(formalization.approvedCapital)) ? Number(formalization.approvedCapital) : 0).toFixed(2)
  );
  const safeFinancedExpenses = Number(
    Math.max(
      0,
      Number.isFinite(Number(formalization.financedExpenses)) ? Number(formalization.financedExpenses) : 0
    ).toFixed(2)
  );
  const safeDeductedExpenses = Number(
    Math.max(
      0,
      Number.isFinite(Number(formalization.deductedExpenses)) ? Number(formalization.deductedExpenses) : 0
    ).toFixed(2)
  );
  const safeTotalFinanced = Number(
    Math.max(
      safeApprovedCapital,
      Number.isFinite(Number(formalization.totalFinanced))
        ? Number(formalization.totalFinanced)
        : safeApprovedCapital + safeFinancedExpenses
    ).toFixed(2)
  );
  const safeNetDisbursement = Number(
    (Number.isFinite(Number(formalization.netDisbursementAmount))
      ? Number(formalization.netDisbursementAmount)
      : safeApprovedCapital - safeDeductedExpenses
    ).toFixed(2)
  );

  if (!Number.isFinite(safeApprovedCapital) || safeApprovedCapital <= 0) {
    throw new Error('El capital aprobado para formalización debe ser mayor a cero.');
  }
  if (!Number.isFinite(safeNetDisbursement) || safeNetDisbursement <= 0) {
    throw new Error('El monto neto a entregar debe ser mayor a cero (revise los gastos descontados).');
  }
  if (safeTotalFinanced < safeApprovedCapital) {
    throw new Error('El total financiado no puede ser inferior al capital aprobado.');
  }

  const normalizedRate = normalizeMonthlyRateDecimal(formalization.contractualRateMonthly, 0.04);
  const safeTermMonths = Math.max(
    1,
    Math.min(
      360,
      Math.round(
        Number.isFinite(Number(formalization.termMonths)) && Number(formalization.termMonths) > 0
          ? Number(formalization.termMonths)
          : application.recommendedTermMonths ?? application.requestedTermMonths ?? 12
      )
    )
  );
  const safeFrequency: PaymentFrequency = VALID_PAYMENT_FREQUENCIES.has(String(formalization.frequency))
    ? formalization.frequency
    : VALID_PAYMENT_FREQUENCIES.has(String(application.paymentFrequency))
    ? application.paymentFrequency
    : 'MENSUAL';
  const safeAmortization: AmortizationMethod = VALID_AMORTIZATION_METHODS.has(
    String(formalization.amortizationMethod)
  )
    ? formalization.amortizationMethod
    : VALID_AMORTIZATION_METHODS.has(String(application.amortizationMethod))
    ? application.amortizationMethod
    : 'SALDO_INSOLUTO';

  const safeActorName =
    String(user.displayName || user.email || 'Formalización').trim().slice(0, 160) || 'Formalización';
  const safeActorRole = String(user.role || 'FORMALIZATION').trim().slice(0, 64) || 'FORMALIZATION';

  const promissoryConfirmed = Boolean(formalization.promissoryNoteConfirmed ?? formalization.legalReviewConfirmed);
  const contractConfirmed = Boolean(formalization.contractConfirmed ?? formalization.legalReviewConfirmed);
  const syncedLegalConfirmed = promissoryConfirmed && contractConfirmed;

  const syncedChecklist = (Array.isArray(formalization.requiredDocsChecklist)
    ? formalization.requiredDocsChecklist
    : []
  )
    .slice(0, 25)
    .map((item) => {
      if (item.key === 'promissory' && promissoryConfirmed) return { ...item, completed: true };
      if (item.key === 'contract_signed' && contractConfirmed) return { ...item, completed: true };
      if (item.key === 'schedule' && syncedLegalConfirmed) return { ...item, completed: true };
      return item;
    });

  const rawSignatures = Array.isArray(formalization.signatures) ? formalization.signatures : [];
  const effectiveSignatures = (
    rawSignatures.length > 0
      ? rawSignatures
      : markReadyForDisbursement
      ? [
          {
            signerName: safeActorName,
            signerRole: 'Validación Legal y Formalización',
            method: 'ELECTRONICA_CERTIFICADA',
            signedAt: new Date().toISOString(),
          },
        ]
      : []
  ).slice(0, 10);

  if (markReadyForDisbursement) {
    if (!promissoryConfirmed || !contractConfirmed) {
      throw new Error('Debe confirmar en el checklist que tanto el Pagaré como el Contrato están correctos antes de enviar a Desembolso.');
    }
    const incompleteDocs = syncedChecklist.filter((d) => !d.completed);
    if (incompleteDocs.length > 0) {
      throw new Error(
        `Faltan documentos obligatorios por completar: ${incompleteDocs.map((d) => d.label).join(', ')}`
      );
    }
  }

  const rawFormId = typeof formalization.id === 'string' ? formalization.id.trim() : '';
  const formId = (
    VALID_ID_REGEX.test(rawFormId)
      ? rawFormId
      : `form_${sanitizeIdSegment(application.id)}`
  ).slice(0, 128);
  const formRef = doc(db, 'formalizations', formId);
  const existingSnap = await getDoc(formRef).catch(() => null);
  const existingData = existingSnap?.exists()
    ? (existingSnap.data() as Record<string, unknown>)
    : null;
  const targetStatus = markReadyForDisbursement ? 'LISTA_PARA_DESEMBOLSO' : 'PENDIENTE';

  const newHistory = markReadyForDisbursement
    ? appendMovementHistory(application.movementHistory, {
        timestamp: new Date().toISOString(),
        action: 'Expediente formalizado y habilitado para desembolso',
        fromStatus: application.status,
        toStatus: 'FORMALIZADA',
        userId: user.uid,
        userName: safeActorName,
      })
    : null;

  const batch = writeBatch(db);
  let effectiveOrgId =
    (typeof existingData?.organizationId === 'string' && VALID_ID_REGEX.test(existingData.organizationId)
      ? existingData.organizationId
      : null) ??
    (typeof application.organizationId === 'string' && VALID_ID_REGEX.test(application.organizationId)
      ? application.organizationId
      : null) ??
    (typeof user.organizationId === 'string' && VALID_ID_REGEX.test(user.organizationId)
      ? user.organizationId
      : DEFAULT_ORG_ID);

  if (markReadyForDisbursement && newHistory) {
    const persisted = await ensureApplicationPersistedInBatch({
      batch,
      application,
      user,
      updates: {
        status: 'FORMALIZADA',
        movementHistory: newHistory,
      },
    });
    if (persisted.organizationId && VALID_ID_REGEX.test(persisted.organizationId)) {
      effectiveOrgId = persisted.organizationId;
    }
  }

  const rawApprovedAnalysisId =
    formalization.approvedFinancialAnalysisId ??
    application.approvedEvaluationAnalysisId ??
    application.activeFinancialAnalysisId ??
    null;
  const linkedApprovedAnalysisId =
    typeof rawApprovedAnalysisId === 'string' && VALID_ID_REGEX.test(rawApprovedAnalysisId.trim())
      ? rawApprovedAnalysisId.trim()
      : null;

  const rawDecisionId =
    typeof formalization.decisionId === 'string' && VALID_ID_REGEX.test(formalization.decisionId.trim())
      ? formalization.decisionId.trim()
      : typeof existingData?.decisionId === 'string' && VALID_ID_REGEX.test(existingData.decisionId.trim())
      ? existingData.decisionId.trim()
      : `dec_${sanitizeIdSegment(application.id)}`.slice(0, 128);

  const safeDisbTargetDate = String(formalization.disbursementTargetDate || toIsoDateOnly()).slice(0, 20);
  const safeFirstPaymentDate = String(
    formalization.firstPaymentDate || addMonthsPreservingAnchor(safeDisbTargetDate, 1)
  ).slice(0, 20);
  const safeMaturityDate = String(formalization.maturityDate || safeFirstPaymentDate).slice(0, 20);
  const safeTotalPayable = Number(
    (Number.isFinite(Number(formalization.totalContractualPayable)) &&
    Number(formalization.totalContractualPayable) >= 0
      ? Number(formalization.totalContractualPayable)
      : safeTotalFinanced
    ).toFixed(2)
  );
  const safeContractText = String(formalization.contractText ?? '').slice(0, 19500);
  const safePromissoryText = String(formalization.promissoryNoteText ?? '').slice(0, 14500);
  const safeCollateralDetails = String(formalization.collateralDetails ?? '').slice(0, 1950);
  const safeTemplateVersion =
    String(formalization.contractTemplateVersion || 'tpl-v1.0-revision-legal').trim().slice(0, 40) ||
    'tpl-v1.0-revision-legal';

  const preservedFormalizedBy =
    existingData &&
    typeof existingData.formalizedBy === 'string' &&
    VALID_ID_REGEX.test(existingData.formalizedBy)
      ? existingData.formalizedBy
      : user.uid;
  const preservedFormalizedByName =
    existingData &&
    typeof existingData.formalizedByName === 'string' &&
    existingData.formalizedByName.trim().length > 0
      ? existingData.formalizedByName.trim().slice(0, 160)
      : safeActorName;
  const preservedOrgIdForExisting =
    existingData &&
    typeof existingData.organizationId === 'string' &&
    VALID_ID_REGEX.test(existingData.organizationId)
      ? existingData.organizationId
      : effectiveOrgId;

  const isRenewalForm = Boolean(formalization.isRenewal || application.isRenewal);
  const safeRenewalPayoff = isRenewalForm
    ? Number(
        Math.max(
          0,
          Number(
            formalization.renewalPayoffAmount ??
              application.originPayoffSnapshot?.totalPayoffAmount ??
              0
          )
        ).toFixed(2)
      )
    : 0;
  const resolvedNetForRenewal = isRenewalForm
    ? Number((safeApprovedCapital - safeDeductedExpenses - safeRenewalPayoff).toFixed(2))
    : safeNetDisbursement;

  if (isRenewalForm && resolvedNetForRenewal <= 0) {
    throw new Error(
      `Bloqueo de renovación en formalización: el desembolso neto (${formatMoney(resolvedNetForRenewal, application.currency)}) debe ser mayor a cero luego de liquidar ${formatMoney(safeRenewalPayoff, application.currency)} y descontar ${formatMoney(safeDeductedExpenses, application.currency)}.`
    );
  }

  const renewalFormFields = isRenewalForm
    ? {
        isRenewal: true,
        renewalId: formalization.renewalId ?? application.renewalId ?? null,
        originLoanId: formalization.originLoanId ?? application.originLoanId ?? null,
        originLoanNumber: formalization.originLoanNumber ?? application.originLoanNumber ?? null,
        renewalPayoffAmount: safeRenewalPayoff,
        renewalPayoffBreakdown:
          formalization.renewalPayoffBreakdown ?? application.originPayoffSnapshot ?? null,
      }
    : {};

  const fullSanitizedFormalizationPayload = cleanObject({
    id: formId,
    organizationId: existingData ? preservedOrgIdForExisting : effectiveOrgId,
    applicationId: application.id,
    decisionId: rawDecisionId,
    approvedFinancialAnalysisId: linkedApprovedAnalysisId,
    approvedCapital: safeApprovedCapital,
    financedExpenses: safeFinancedExpenses,
    totalFinanced: safeTotalFinanced,
    deductedExpenses: safeDeductedExpenses,
    netDisbursementAmount: resolvedNetForRenewal,
    contractualRateMonthly: normalizedRate,
    termMonths: safeTermMonths,
    frequency: safeFrequency,
    amortizationMethod: safeAmortization,
    disbursementTargetDate: safeDisbTargetDate,
    firstPaymentDate: safeFirstPaymentDate,
    maturityDate: safeMaturityDate,
    totalContractualPayable: safeTotalPayable,
    contractTemplateVersion: safeTemplateVersion,
    contractText: safeContractText,
    promissoryNoteText: safePromissoryText,
    requiredDocsChecklist: syncedChecklist,
    conditionsFulfilled: Boolean(formalization.conditionsFulfilled),
    signatures: effectiveSignatures,
    collateralDetails: safeCollateralDetails,
    legalReviewConfirmed: syncedLegalConfirmed,
    promissoryNoteConfirmed: promissoryConfirmed,
    contractConfirmed: contractConfirmed,
    ...renewalFormFields,
    status: targetStatus,
    formalizedBy: existingData ? preservedFormalizedBy : user.uid,
    formalizedByName: existingData ? preservedFormalizedByName : safeActorName,
    createdAt: existingData
      ? normalizePreservedCreatedAt(existingData.createdAt)
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const updateFieldsPayload = cleanObject({
    approvedCapital: safeApprovedCapital,
    financedExpenses: safeFinancedExpenses,
    totalFinanced: safeTotalFinanced,
    deductedExpenses: safeDeductedExpenses,
    netDisbursementAmount: resolvedNetForRenewal,
    contractualRateMonthly: normalizedRate,
    termMonths: safeTermMonths,
    frequency: safeFrequency,
    amortizationMethod: safeAmortization,
    disbursementTargetDate: safeDisbTargetDate,
    firstPaymentDate: safeFirstPaymentDate,
    maturityDate: safeMaturityDate,
    totalContractualPayable: safeTotalPayable,
    contractText: safeContractText,
    promissoryNoteText: safePromissoryText,
    requiredDocsChecklist: syncedChecklist,
    conditionsFulfilled: Boolean(formalization.conditionsFulfilled),
    signatures: effectiveSignatures,
    collateralDetails: safeCollateralDetails,
    legalReviewConfirmed: syncedLegalConfirmed,
    promissoryNoteConfirmed: promissoryConfirmed,
    contractConfirmed: contractConfirmed,
    approvedFinancialAnalysisId: linkedApprovedAnalysisId,
    ...renewalFormFields,
    status: targetStatus,
    updatedAt: serverTimestamp(),
  });

  const isAdminActor = user.role === 'ADMIN' || Boolean(user.isSuperAdmin);
  if (existingData && !isAdminActor) {
    batch.update(formRef, updateFieldsPayload);
  } else {
    // Admin full-document set self-heals any legacy/drifted formalization fields (e.g. approvedCapital mismatch or missing keys).
    batch.set(formRef, fullSanitizedFormalizationPayload);
  }

  if (isRenewalForm && (formalization.renewalId || application.renewalId)) {
    const renId = formalization.renewalId || application.renewalId!;
    batch.update(
      doc(db, 'credit_renewals', renId),
      cleanObject({
        status: markReadyForDisbursement ? 'PENDIENTE_DESEMBOLSO' : 'PENDIENTE_FORMALIZACION',
        formalizationId: formId,
        formalizedBy: user.uid,
        formalizedByName: safeActorName,
        otherDeductionsAmount: safeDeductedExpenses,
        settledPayoffAmount: safeRenewalPayoff,
        netDisbursementAmount: resolvedNetForRenewal,
        updatedAt: serverTimestamp(),
      })
    );
  }

  const auditId = generateId('audit');
  const auditPayload = {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: markReadyForDisbursement ? 'FORMALIZATION_COMPLETED' : 'FORMALIZATION_SAVED',
      entityType: 'formalizations',
      entityId: formId,
      action: `${markReadyForDisbursement ? 'Formalización completada' : 'Borrador formalización'} para ${application.applicationNumber}`,
      previousState: application.status,
      newState: markReadyForDisbursement ? 'FORMALIZADA' : application.status,
      transactionId: generateId('tx'),
      userId: user.uid,
      userEmail: user.email,
      userRole: safeActorRole,
    }),
    timestamp: serverTimestamp(),
  };
  batch.set(doc(db, 'audit_logs', auditId), auditPayload);

  try {
    await batch.commit();
  } catch {
    // Fallback: isolate formalization, application transition, and audit log writes so secondary conflicts never block
    // formalization and any real permission denial pinpoints the exact document path.
    try {
      if (existingData && !isAdminActor) {
        await updateDoc(formRef, updateFieldsPayload);
      } else {
        await setDoc(formRef, fullSanitizedFormalizationPayload);
      }
    } catch (formErr) {
      handleFirestoreError(formErr, OperationType.WRITE, `formalizations/${formId}`);
    }

    if (markReadyForDisbursement && newHistory) {
      try {
        const appBatch = writeBatch(db);
        await ensureApplicationPersistedInBatch({
          batch: appBatch,
          application,
          user,
          updates: {
            status: 'FORMALIZADA',
            movementHistory: newHistory,
          },
        });
        await appBatch.commit();
      } catch (appErr) {
        handleFirestoreError(appErr, OperationType.UPDATE, `applications/${application.id}`);
      }
    }

    await setDoc(doc(db, 'audit_logs', auditId), auditPayload).catch((auditErr) => {
      console.warn('Formalization audit log warning:', auditErr);
    });
  }

  if (markReadyForDisbursement) {
    await enqueueCustomerStatusEmail({
      application: {
        ...application,
        organizationId: effectiveOrgId,
      },
      eventCode: 'FORMALIZADA',
      fromStatus: application.status,
      toStatus: 'FORMALIZADA',
      historyLength: (application.movementHistory?.length ?? 0) + 1,
      user,
      approvedAmount: safeApprovedCapital,
      approvedRateMonthly: normalizedRate,
      approvedTermMonths: safeTermMonths,
    });
  } else if (rawSignatures.length === 0) {
    await enqueueCustomerStatusEmail({
      application: {
        ...application,
        organizationId: effectiveOrgId,
      },
      eventCode: 'PENDIENTE_FIRMA',
      fromStatus: application.status,
      toStatus: 'PENDIENTE_FIRMA',
      historyLength: application.movementHistory?.length ?? 0,
      user,
      approvedAmount: safeApprovedCapital,
      approvedRateMonthly: normalizedRate,
      approvedTermMonths: safeTermMonths,
    });
  }
}

export async function executeIdempotentDisbursement(params: {
  application: ApplicationRecord;
  decision: CommitteeDecisionRecord;
  formalization: FormalizationRecord;
  paymentMethod: DisbursementRecord['paymentMethod'];
  financialEntity: string;
  destinationAccountRaw: string;
  referenceNumber: string;
  receiptNotes: string;
  disbursementDate: string;
  authorizerUserId: string;
  authorizerUserName: string;
  idempotencyKey: string;
  voucherFile?: { fileName: string; mimeType: string; sizeBytes: number; dataUrl: string } | null;
  accountingAccounts?: AccountingAccountRecord[];
  collectionPolicy?: CollectionPolicyVersionRecord;
  user: UserProfile;
}): Promise<{ loan: LoanRecord; disbursement: DisbursementRecord }> {
  const {
    application,
    decision,
    formalization,
    paymentMethod,
    financialEntity,
    destinationAccountRaw,
    referenceNumber,
    receiptNotes,
    disbursementDate,
    authorizerUserId,
    authorizerUserName,
    idempotencyKey,
    voucherFile,
    accountingAccounts = [],
    collectionPolicy,
    user,
  } = params;

  const cleanEntity = financialEntity.trim();
  const cleanRef = referenceNumber.trim();
  const cleanDisbDate = disbursementDate.trim();

  if (cleanEntity.length < 1) {
    throw new Error('Debe indicar la entidad financiera o caja de desembolso.');
  }
  if (cleanRef.length < 2) {
    throw new Error('El número de referencia o comprobante debe tener al menos 2 caracteres.');
  }
  if (cleanDisbDate.length < 8) {
    throw new Error('Seleccione una fecha de desembolso válida (AAAA-MM-DD).');
  }
  if (formalization.approvedCapital <= 0 || formalization.netDisbursementAmount <= 0) {
    throw new Error('Los montos de formalización deben ser mayores a cero antes de desembolsar.');
  }
  if (voucherFile && voucherFile.dataUrl.length > 690_000) {
    throw new Error('El archivo del comprobante supera el límite permitido (máx. ~500 KB). Comprima la imagen o PDF.');
  }

  const contractualRate = normalizeMonthlyRateDecimal(formalization.contractualRateMonthly, 0.04);
  const disbId = application.id; // Deterministic lock ID = applicationId!
  const disbRef = doc(db, 'disbursements', disbId);
  const appRef = doc(db, 'applications', application.id);
  const formRef = doc(db, 'formalizations', formalization.id.slice(0, 128));
  const voucherDocId = voucherFile ? `doc_disb_${application.id}`.slice(0, 128) : null;

  // Pre-compute deterministic schedule via amortization engine
  const schedule = generateAmortizationSchedule({
    financedPrincipal: formalization.totalFinanced,
    monthlyRate: contractualRate,
    termMonths: formalization.termMonths,
    frequency: formalization.frequency,
    amortizationMethod: formalization.amortizationMethod,
    disbursementDate: cleanDisbDate,
    firstPaymentDate: formalization.firstPaymentDate,
  });

  if (schedule.rows.length > 360) {
    throw new Error(
      `El calendario supera el máximo de 360 cuotas soportadas por operación (${schedule.rows.length} cuotas). Ajuste plazo o frecuencia.`
    );
  }

  const loanId = `loan_${application.id}`.slice(0, 112);
  const loanNumber = `PRE-${application.applicationNumber.replace(/^SOL-/, '')}`.slice(0, 64);
  const disbNumber = `DES-${application.applicationNumber.replace(/^SOL-/, '')}`.slice(0, 64);

  const isRenewalOp = Boolean(
    (application.isRenewal || formalization.isRenewal) &&
      (application.originLoanId || formalization.originLoanId)
  );
  const originLoanId = (application.originLoanId || formalization.originLoanId || '').trim();
  const renewalId = (application.renewalId || formalization.renewalId || '').trim();

  // Pre-fetch origin loan installment document IDs outside the transaction so all reads inside tx occur before writes
  let originInstallmentIds: string[] = [];
  if (isRenewalOp && originLoanId) {
    const instSnap = await getDocs(
      query(
        collection(db, 'loan_installments'),
        where('organizationId', '==', application.organizationId),
        where('loanId', '==', originLoanId)
      )
    );
    originInstallmentIds = instSnap.docs.map((d) => d.id);
    // Guard Firestore 500-write transaction limit cleanly before mutating anything
    const projectedWrites = schedule.rows.length + originInstallmentIds.length + 12;
    if (projectedWrites > 490) {
      throw new Error(
        `La renovación supera el límite transaccional atómico de Firestore (${projectedWrites} operaciones). Reduzca la cantidad de cuotas.`
      );
    }
  }

  let createdDisb!: DisbursementRecord;
  let createdLoan!: LoanRecord;

  try {
    await runTransaction(db, async (tx) => {
      // --- PHASE 1: ALL FIRESTORE READS BEFORE ANY WRITES ---
      const existingDisbSnap = await tx.get(disbRef);
      const appSnap = await tx.get(appRef);
      const formSnap = await tx.get(formRef);

      let originLoanSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
      let originColAccSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
      let renewalSnap: Awaited<ReturnType<typeof tx.get>> | null = null;
      const originInstSnaps: Array<Awaited<ReturnType<typeof tx.get>>> = [];

      if (isRenewalOp && originLoanId) {
        originLoanSnap = await tx.get(doc(db, 'loans', originLoanId));
        originColAccSnap = await tx.get(doc(db, 'collection_accounts', originLoanId));
        if (renewalId) {
          renewalSnap = await tx.get(doc(db, 'credit_renewals', renewalId));
        }
        for (const instId of originInstallmentIds) {
          originInstSnaps.push(await tx.get(doc(db, 'loan_installments', instId)));
        }
      }

      if (!appSnap.exists()) {
        throw new Error('Expediente de solicitud no encontrado en Firestore.');
      }

      const freshApp = appSnap.data() as ApplicationRecord;
      const guard = canExecuteDisbursement({
        userRole: user.role,
        application: freshApp,
        decision,
        formalization,
        existingDisbursementId: existingDisbSnap.exists() ? existingDisbSnap.id : null,
      });

      if (!guard.allowed) {
        throw new Error(guard.reason || 'Precondiciones de desembolso no satisfechas.');
      }

      // --- PHASE 2: COORDINATED RENEWAL LIQUIDATION COMPUTATION & HARD VALIDATIONS ---
      let effectiveNetDelivered = formalization.netDisbursementAmount;
      let finalPayoffBreakdown:
        | ReturnType<typeof computeRenewalPayoffBreakdown>['breakdown']
        | null = null;
      let renewalAccountingEntryId: string | null = null;
      let originLoanData: LoanRecord | null = null;
      let freshOriginInsts: LoanInstallmentRecord[] = [];

      if (isRenewalOp && originLoanId) {
        if (!originLoanSnap || !originLoanSnap.exists()) {
          throw new Error(`El préstamo anterior (${originLoanId}) no existe en Firestore.`);
        }
        originLoanData = originLoanSnap.data() as LoanRecord;
        if (
          originLoanData.status === 'CANCELADO' ||
          originLoanData.status === 'CANCELADO_POR_RENOVACION' ||
          (originLoanData.status === 'PAGADO' && originLoanData.currentPrincipalBalance <= 0)
        ) {
          throw new Error(
            `El préstamo anterior ${originLoanData.loanNumber} ya se encuentra en estado ${originLoanData.status} y no puede volver a liquidarse por renovación.`
          );
        }
        if (renewalSnap?.exists()) {
          const rData = renewalSnap.data() as CreditRenewalRecord;
          if (rData.status === 'DESEMBOLSADA') {
            throw new Error(
              `Bloqueo de idempotencia: la renovación ${rData.renewalNumber} ya fue desembolsada.`
            );
          }
        }

        freshOriginInsts = originInstSnaps
          .filter((s) => s.exists())
          .map((s) => s.data() as LoanInstallmentRecord);

        const freshOriginColAcc = originColAccSnap?.exists()
          ? (originColAccSnap.data() as CollectionAccountRecord)
          : null;

        finalPayoffBreakdown = computeRenewalPayoffBreakdown({
          loan: originLoanData,
          installments: freshOriginInsts,
          account: freshOriginColAcc,
          policy: collectionPolicy,
          asOfDateIso: cleanDisbDate,
        }).breakdown;

        const netCalc = calculateRenewalNetDisbursement({
          grossApprovedAmount: formalization.approvedCapital,
          payoffAmount: finalPayoffBreakdown.totalPayoffAmount,
          otherAuthorizedDiscounts: formalization.deductedExpenses,
        });

        if (!netCalc.valid) {
          throw new Error(
            netCalc.reason ||
              `Saldo insuficiente para renovación: el monto aprobado (${formatMoney(formalization.approvedCapital, application.currency)}) no cubre la liquidación actualizada (${formatMoney(finalPayoffBreakdown.totalPayoffAmount, application.currency)}) más descuentos (${formatMoney(formalization.deductedExpenses, application.currency)}).`
          );
        }

        effectiveNetDelivered = netCalc.netDisbursementAmount;
        renewalAccountingEntryId = `je_ren_${sanitizeIdSegment(application.id)}`.slice(0, 120);
      }

      const nowIso = new Date().toISOString();

      createdDisb = cleanObject({
        id: disbId,
        organizationId: application.organizationId,
        disbursementNumber: disbNumber,
        applicationId: application.id,
        loanId,
        customerId: application.customerId,
        approvedAmount: formalization.approvedCapital,
        totalFinanced: formalization.totalFinanced,
        expenses: formalization.financedExpenses + formalization.deductedExpenses,
        netDeliveredAmount: effectiveNetDelivered,
        disbursementDate: cleanDisbDate,
        paymentMethod,
        financialEntity: cleanEntity.slice(0, 160),
        destinationAccountMasked: maskAccountNumber(destinationAccountRaw),
        referenceNumber: cleanRef.slice(0, 100),
        receiptNotes: receiptNotes.trim().slice(0, 1000),
        voucherFileName: voucherFile?.fileName?.slice(0, 240) ?? null,
        voucherMimeType: voucherFile?.mimeType?.slice(0, 120) ?? null,
        voucherDocumentId: voucherDocId,
        ...(isRenewalOp && finalPayoffBreakdown && originLoanData
          ? {
              isRenewal: true,
              renewalId: renewalId || null,
              originLoanId: originLoanData.id,
              originLoanNumber: originLoanData.loanNumber,
              renewalPayoffAmount: finalPayoffBreakdown.totalPayoffAmount,
              renewalPayoffBreakdown: finalPayoffBreakdown,
              accountingEntryId: renewalAccountingEntryId,
            }
          : {}),
        idempotencyKey: idempotencyKey.slice(0, 128),
        responsibleUserId: user.uid,
        responsibleUserName: user.displayName.slice(0, 160),
        authorizerUserId,
        authorizerUserName: authorizerUserName.slice(0, 160),
        status: 'CONFIRMADO' as const,
        createdAt: serverTimestamp(),
      });

      createdLoan = cleanObject({
        id: loanId,
        organizationId: application.organizationId,
        loanNumber,
        applicationId: application.id,
        disbursementId: disbId,
        approvedFinancialAnalysisId:
          formalization.approvedFinancialAnalysisId ??
          application.approvedEvaluationAnalysisId ??
          application.activeFinancialAnalysisId ??
          null,
        customerId: application.customerId,
        businessId: application.businessId ?? null,
        applicantDisplayName: application.applicantDisplayName.slice(0, 200),
        productCode: application.productCode,
        currency: application.currency,
        approvedPrincipal: formalization.approvedCapital,
        financedExpenses: formalization.financedExpenses,
        totalFinancedPrincipal: formalization.totalFinanced,
        currentPrincipalBalance: formalization.totalFinanced,
        contractualRateMonthly: contractualRate,
        termMonths: formalization.termMonths,
        frequency: formalization.frequency,
        amortizationMethod: formalization.amortizationMethod,
        disbursementDate: cleanDisbDate,
        firstPaymentDate: formalization.firstPaymentDate,
        maturityDate: schedule.maturityDate,
        totalContractualInterest: schedule.totalInterestScheduled,
        totalContractualPayable: schedule.totalContractualPayable,
        ...(isRenewalOp && finalPayoffBreakdown && originLoanData
          ? {
              isRenewal: true,
              renewalId: renewalId || null,
              originLoanId: originLoanData.id,
              originLoanNumber: originLoanData.loanNumber,
              payoffSettledAmount: finalPayoffBreakdown.totalPayoffAmount,
              additionalDeductionsAmount: formalization.deductedExpenses,
              netDisbursementDelivered: effectiveNetDelivered,
            }
          : {}),
        status: 'ACTIVO' as const,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      const newHistory = appendMovementHistory(freshApp.movementHistory, {
        timestamp: nowIso,
        action:
          isRenewalOp && originLoanData && finalPayoffBreakdown
            ? `Desembolso por renovación (${disbNumber}) confirmado: liquidado ${originLoanData.loanNumber} (${formatMoney(finalPayoffBreakdown.totalPayoffAmount, application.currency)}) -> Nuevo préstamo ${loanNumber}`
            : `Desembolso confirmado (${disbNumber}) y Préstamo creado (${loanNumber})`,
        fromStatus: freshApp.status,
        toStatus: 'DESEMBOLSADA',
        userId: user.uid,
        userName: user.displayName,
        note: `Ref: ${cleanRef} · Neto entregado: ${formatMoney(effectiveNetDelivered, application.currency)}`,
      });

      // --- PHASE 3: ALL ATOMIC WRITES ---
      if (isRenewalOp && originLoanData && finalPayoffBreakdown) {
        // 3A. Settle all unpaid installments of the origin loan
        for (const inst of freshOriginInsts) {
          if (inst.status === 'PAGADA') continue;
          const totalLateFee = originLoanData.lateFeeExempt ? 0 : inst.accruedLateFee ?? 0;
          const netLateFeeToPay = Math.max(
            0,
            Number((totalLateFee - (inst.waivedLateFee ?? 0)).toFixed(2))
          );
          tx.update(doc(db, 'loan_installments', inst.id), {
            status: 'PAGADA',
            paidPrincipal: inst.principalAmount,
            paidInterest: inst.interestAmount,
            paidOtherCharges: inst.otherCharges,
            paidLateFee: netLateFeeToPay,
            paidAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        }

        // 3B. Transition origin loan to CANCELADO_POR_RENOVACION with bidirectional linkage
        const nextOriginPaidPrincipal = Number(
          (
            (originLoanData.paidPrincipalTotal ?? 0) + finalPayoffBreakdown.remainingPrincipal
          ).toFixed(2)
        );
        const nextOriginPaidInterest = Number(
          (
            (originLoanData.paidInterestTotal ?? 0) + finalPayoffBreakdown.remainingInterest
          ).toFixed(2)
        );
        const nextOriginPaidLateFee = Number(
          (
            (originLoanData.paidLateFeeTotal ?? 0) + finalPayoffBreakdown.remainingLateFee
          ).toFixed(2)
        );

        tx.update(doc(db, 'loans', originLoanData.id), {
          status: 'CANCELADO_POR_RENOVACION',
          currentPrincipalBalance: 0,
          paidPrincipalTotal: nextOriginPaidPrincipal,
          paidInterestTotal: nextOriginPaidInterest,
          paidLateFeeTotal: nextOriginPaidLateFee,
          renewedToLoanId: loanId,
          renewedToLoanNumber: loanNumber,
          renewalPayoffAmount: finalPayoffBreakdown.totalPayoffAmount,
          renewalLiquidationDate: cleanDisbDate,
          closedAt: nowIso,
          closureCertificateNumber: `LIQ-REN-${loanNumber}`.slice(0, 64),
          updatedAt: serverTimestamp(),
        });

        // 3C. Close origin collection account so delinquency/collections immediately reflect 0 debt
        if (originColAccSnap?.exists()) {
          tx.update(doc(db, 'collection_accounts', originLoanData.id), {
            stage: 'CANCELADO',
            bucket: 'AL_DIA',
            dpd: 0,
            priority: 'BAJA',
            priorityScore: 0,
            overdueInstallmentsCount: 0,
            overduePrincipal: 0,
            overdueInterest: 0,
            overdueLateFee: 0,
            overdueCharges: 0,
            overdueTotalAmount: 0,
            totalOutstandingPrincipal: 0,
            updatedAt: serverTimestamp(),
          });
        }

        // 3D. Create balanced double-entry accounting journal entry
        if (renewalAccountingEntryId) {
          const journalEntry = buildRenewalAccountingJournalEntry({
            entryId: renewalAccountingEntryId,
            organizationId: application.organizationId,
            entryDate: cleanDisbDate,
            currency: application.currency,
            renewalNumber:
              (renewalSnap?.exists()
                ? (renewalSnap.data() as CreditRenewalRecord).renewalNumber
                : null) || `REN-${loanNumber}`,
            originLoanNumber: originLoanData.loanNumber,
            targetLoanNumber: loanNumber,
            disbursementId: disbId,
            disbursementNumber: disbNumber,
            customerName: application.applicantDisplayName,
            totalFinancedNewLoan: formalization.totalFinanced,
            financedExpenses: formalization.financedExpenses,
            deductedExpenses: formalization.deductedExpenses,
            settledPrincipal: finalPayoffBreakdown.remainingPrincipal,
            settledInterest: finalPayoffBreakdown.remainingInterest,
            settledLateFee: finalPayoffBreakdown.remainingLateFee,
            settledCharges: finalPayoffBreakdown.remainingCharges,
            netDisbursementDelivered: effectiveNetDelivered,
            idempotencyKey,
            accounts: accountingAccounts,
            userId: user.uid,
            userName: user.displayName || user.email || 'Usuario AxyCore',
          });
          tx.set(doc(db, 'accounting_journal_entries', renewalAccountingEntryId), {
            ...cleanObject(journalEntry),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // 3E. Finalize credit_renewals/{renewalId} record
        if (renewalId && renewalSnap?.exists()) {
          tx.update(
            doc(db, 'credit_renewals', renewalId),
            cleanObject({
              status: 'DESEMBOLSADA',
              targetLoanId: loanId,
              targetLoanNumber: loanNumber,
              disbursementId: disbId,
              accountingEntryId: renewalAccountingEntryId,
              finalPayoffBreakdown,
              approvedAmount: formalization.approvedCapital,
              grossApprovedAmount: formalization.approvedCapital,
              settledPayoffAmount: finalPayoffBreakdown.totalPayoffAmount,
              otherDeductionsAmount: formalization.deductedExpenses,
              netDisbursementAmount: effectiveNetDelivered,
              disbursedBy: user.uid,
              disbursedByName: (user.displayName || user.email || 'Usuario').slice(0, 160),
              liquidationDate: cleanDisbDate,
              disbursedAt: nowIso,
              errorMessage: null,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }

      if (voucherFile && voucherDocId) {
        tx.set(doc(db, 'application_documents', voucherDocId), {
          id: voucherDocId,
          organizationId: application.organizationId,
          applicationId: application.id,
          category: 'COMPROBANTE_DESEMBOLSO',
          fileName: voucherFile.fileName.slice(0, 240),
          mimeType: voucherFile.mimeType.slice(0, 120),
          sizeBytes: voucherFile.sizeBytes,
          fileDataUrl: voucherFile.dataUrl,
          reviewStatus: 'VERIFICADO',
          notes: `Comprobante de desembolso ${disbNumber} · Ref ${cleanRef}`.slice(0, 500),
          uploadedBy: user.uid,
          uploadedByName: user.displayName.slice(0, 160),
          uploadedAt: serverTimestamp(),
        });
      }

      tx.set(disbRef, createdDisb);
      tx.set(doc(db, 'loans', loanId), createdLoan);
      tx.set(doc(db, 'collection_accounts', loanId), {
        id: loanId,
        organizationId: application.organizationId,
        loanId,
        loanNumber,
        applicationId: application.id,
        customerId: application.customerId,
        applicantDisplayName: application.applicantDisplayName.slice(0, 200),
        productCode: application.productCode,
        currency: application.currency,
        dpd: 0,
        maxHistoricalDpd: 0,
        stage: 'AL_DIA',
        bucket: 'AL_DIA',
        priority: 'BAJA',
        priorityScore: 0,
        priorityReasons: [
          isRenewalOp ? 'Préstamo desembolsado por renovación' : 'Préstamo recién desembolsado',
        ],
        overdueInstallmentsCount: 0,
        totalInstallmentsCount: schedule.rows.length,
        paidInstallmentsCount: 0,
        overduePrincipal: 0,
        overdueInterest: 0,
        overdueLateFee: 0,
        overdueCharges: 0,
        overdueTotalAmount: 0,
        totalOutstandingPrincipal: formalization.totalFinanced,
        nextDueDate: formalization.firstPaymentDate,
        nextDueAmount: schedule.rows[0]?.totalAmount ?? 0,
        pendingVerificationAmount: 0,
        brokenPromisesCount: 0,
        behaviorScore: 920,
        behaviorBand: 'EXCELENTE',
        consentWhatsAppOptIn: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (formSnap.exists()) {
        tx.update(formRef, {
          status: 'DESEMBOLSADA',
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(
          formRef,
          cleanObject({
            ...formalization,
            id: formalization.id.slice(0, 128),
            contractualRateMonthly: contractualRate,
            status: 'DESEMBOLSADA',
            formalizedBy: user.uid,
            formalizedByName: user.displayName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
      const freshAppRecord = freshApp as unknown as Record<string, unknown>;
      if (
        (user.role === 'ADMIN' || user.isSuperAdmin) &&
        hasApplicationSchemaDrift(freshAppRecord, application.id)
      ) {
        tx.set(
          appRef,
          buildMaterializedApplicationPayload(
            {
              ...application,
              ...(freshApp as Partial<ApplicationRecord>),
              id: application.id,
            },
            { status: 'DESEMBOLSADA', movementHistory: newHistory },
            user.uid,
            user.displayName || user.email,
            {
              preserveOrganizationId:
                typeof freshAppRecord.organizationId === 'string' &&
                VALID_ID_REGEX.test(freshAppRecord.organizationId)
                  ? freshAppRecord.organizationId
                  : application.organizationId,
              preserveCreatedBy: freshAppRecord.createdBy ?? user.uid,
              preserveCreatedAt: freshAppRecord.createdAt ?? serverTimestamp(),
            }
          )
        );
      } else {
        tx.update(appRef, {
          status: 'DESEMBOLSADA',
          movementHistory: newHistory,
          updatedAt: serverTimestamp(),
        });
      }

      for (const row of schedule.rows) {
        const instId = `${loanId}_cuota_${String(row.installmentNumber).padStart(3, '0')}`;
        const instRecord: LoanInstallmentRecord = {
          id: instId,
          organizationId: application.organizationId,
          loanId,
          installmentNumber: row.installmentNumber,
          dueDate: row.dueDate,
          principalAmount: row.principalAmount,
          interestAmount: row.interestAmount,
          otherCharges: row.otherCharges,
          totalAmount: row.totalAmount,
          remainingPrincipalBalance: row.remainingPrincipalBalance,
          status: 'PENDIENTE',
          createdAt: serverTimestamp(),
        };
        tx.set(doc(db, 'loan_installments', instId), instRecord);
      }

      const auditId = generateId('audit');
      tx.set(doc(db, 'audit_logs', auditId), {
        ...buildCriticalAuditEntryPayload({
          id: auditId,
          organizationId: application.organizationId,
          eventType: isRenewalOp
            ? 'RENEWAL_DISBURSEMENT_AND_LIQUIDATION'
            : 'DISBURSEMENT_AND_LOAN_CREATED',
          entityType: 'loans',
          entityId: loanId,
          action:
            isRenewalOp && originLoanData && finalPayoffBreakdown
              ? `Renovación desembolsada (${disbNumber}): ${originLoanData.loanNumber} CANCELADO_POR_RENOVACION (${formatMoney(finalPayoffBreakdown.totalPayoffAmount, application.currency)}) -> Nuevo ${loanNumber} | Neto ${formatMoney(effectiveNetDelivered, application.currency)}`
              : `Desembolso ${disbNumber} confirmado -> Préstamo ${loanNumber} (${schedule.rows.length} cuotas)`,
          previousState: 'FORMALIZADA',
          newState: isRenewalOp ? 'DESEMBOLSADA / CANCELADO_POR_RENOVACION + ACTIVO' : 'DESEMBOLSADA / ACTIVO',
          justification: `Ref: ${cleanRef} | Idempotency: ${idempotencyKey}`,
          transactionId: idempotencyKey,
          userId: user.uid,
          userEmail: user.email,
          userRole: user.role,
        }),
        timestamp: serverTimestamp(),
      });
    });
  } catch (err) {
    // On renewal transaction failure, Firestore rolls back completely so originLoan stays untouched.
    // Record ERROR_EJECUCION on credit_renewals & audit_logs for traceability without mutating originLoan.
    if (isRenewalOp && renewalId) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await updateDoc(doc(db, 'credit_renewals', renewalId), {
        status: 'ERROR_EJECUCION',
        errorMessage: errMsg.slice(0, 950),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      const errAuditId = generateId('audit');
      await setDoc(doc(db, 'audit_logs', errAuditId), {
        ...buildCriticalAuditEntryPayload({
          id: errAuditId,
          organizationId: application.organizationId,
          eventType: 'RENEWAL_DISBURSEMENT_ERROR',
          entityType: 'credit_renewals',
          entityId: renewalId,
          action: `Error en desembolso de renovación (${application.applicationNumber}): rollback atómico ejecutado; préstamo origen intacto`,
          previousState: 'PENDIENTE_DESEMBOLSO',
          newState: 'ERROR_EJECUCION',
          justification: errMsg.slice(0, 950),
          transactionId: idempotencyKey,
          userId: user.uid,
          userEmail: user.email,
          userRole: user.role,
        }),
        timestamp: serverTimestamp(),
      }).catch(() => {});
    }
    if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `disbursements/${disbId}`);
  }

  await enqueueCustomerStatusEmail({
    application,
    eventCode: 'DESEMBOLSADA',
    fromStatus: 'FORMALIZADA',
    toStatus: 'DESEMBOLSADA',
    historyLength: (application.movementHistory?.length ?? 0) + 1,
    user,
    approvedAmount: formalization.approvedCapital,
    approvedRateMonthly: formalization.contractualRateMonthly,
    approvedTermMonths: formalization.termMonths,
    firstPaymentDate: formalization.firstPaymentDate,
    disbursementBank: financialEntity,
    disbursementAccountMasked: maskAccountNumber(destinationAccountRaw),
    disbursementRef: referenceNumber,
  });

  return { loan: createdLoan, disbursement: createdDisb };
}

export async function updateUserRoleAdmin(params: {
  targetUid: string;
  role: UserRole;
  status: UserStatus;
  adminUser: UserProfile;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', params.targetUid), {
    role: params.role,
    status: params.status,
    updatedAt: serverTimestamp(),
  });

  const memId = `${params.adminUser.organizationId}_${params.targetUid}`;
  const memDoc = await getDoc(doc(db, 'organization_memberships', memId)).catch(() => null);
  if (memDoc && memDoc.exists()) {
    batch.update(doc(db, 'organization_memberships', memId), {
      role: params.role,
      status: params.status === 'INVITED' ? 'INVITED' : params.status,
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.adminUser.organizationId,
    eventType: 'USER_RBAC_UPDATED',
    entityType: 'users',
    entityId: params.targetUid,
    action: `Actualización de rol a ${params.role} (${params.status})`,
    transactionId: generateId('tx'),
    userId: params.adminUser.uid,
    userEmail: params.adminUser.email,
    userRole: params.adminUser.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.targetUid}`);
  }
}

export async function resendInvitationEmailAdmin(params: {
  targetUser: UserProfile;
  adminUser: UserProfile;
  organization?: OrganizationRecord;
}): Promise<{
  resetSent: boolean;
  smtpDelivered: boolean;
  emailDeliveryChannel: string;
  invitationLink: string;
}> {
  const canManage =
    isSuperAdminUser(params.adminUser, true) || params.adminUser.role === 'ADMIN';
  if (!canManage) {
    throw new Error('Solo el rol Administrador puede reenviar invitaciones.');
  }
  const cleanEmail = normalizeEmailAddress(params.targetUser.email);
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('El usuario no posee un correo electrónico corporativo válido.');
  }

  const orgId =
    params.organization?.id ||
    params.targetUser.organizationId ||
    params.adminUser.organizationId ||
    DEFAULT_ORG_ID;
  const orgName =
    params.organization?.tradeName ||
    params.organization?.name ||
    SU_GLORIA_MANO_AMIGA_ORG.tradeName ||
    'SU GLORIA MANO AMIGA';
  const accessCode =
    params.organization?.accessCode ||
    SU_GLORIA_MANO_AMIGA_ORG.accessCode ||
    'SGMA-001';
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'http://localhost:3000';
  const inviteId = buildDeterministicInvitationId(cleanEmail);
  const invitationLink = buildInvitationActivationUrl({
    origin,
    inviteId,
    orgCode: accessCode,
    email: cleanEmail,
  });

  // 1. Try Firebase Auth password setup/reset email
  let resetSent = false;
  try {
    const actionCodeSettings = {
      url: invitationLink,
      handleCodeInApp: false,
    };
    await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings).catch(async () => {
      await sendPasswordResetEmail(auth, cleanEmail);
    });
    resetSent = true;
  } catch (err) {
    console.warn('sendPasswordResetEmail fallback on resend:', err);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      resetSent = true;
    } catch {
      resetSent = false;
    }
  }

  // 2. Always attempt branded SMTP email relay and capture honest delivery status
  const emailContent = buildInvitationEmailContent({
    displayName: params.targetUser.displayName || cleanEmail.split('@')[0],
    email: cleanEmail,
    roleLabel: ROLE_LABELS[params.targetUser.role] || params.targetUser.role,
    organizationName: orgName,
    accessCode,
    invitationLink,
    resetSent,
  });

  let smtpDelivered = false;
  let emailDeliveryChannel = resetSent ? 'FIREBASE_AUTH_EMAIL' : 'INVITATION_LINK_READY';
  try {
    const resp = await fetch('/api/notifications/dispatch-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cleanEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      }),
    });
    const payload = await resp.json().catch(() => null);
    if (payload?.delivered) {
      smtpDelivered = true;
      emailDeliveryChannel = resetSent
        ? 'FIREBASE_AUTH_AND_SMTP'
        : String(payload.deliveryChannel || 'EXPRESS_SMTP_RELAY');
    } else if (!resetSent && payload?.deliveryChannel) {
      emailDeliveryChannel = String(payload.deliveryChannel);
    }
  } catch {
    // keep channel from Firebase Auth
  }

  const nowIso = new Date().toISOString();
  const invRef = doc(db, 'user_invitations', inviteId);
  const existingInvSnap = await getDoc(invRef).catch(() => null);
  const invRecord = cleanObject({
    id: inviteId,
    email: cleanEmail,
    displayName: params.targetUser.displayName || cleanEmail.split('@')[0],
    role: params.targetUser.role,
    organizationId: orgId,
    organizationName: orgName,
    accessCode,
    status: 'INVITACION_ENVIADA' as const,
    invitedBy: params.adminUser.uid,
    invitedByEmail: params.adminUser.email,
    invitedAt: nowIso,
    invitationLink,
    emailDeliveryChannel,
    createdAt: existingInvSnap?.exists() ? existingInvSnap.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(invRef, invRecord);

  const userRef = doc(db, 'users', params.targetUser.uid);
  const existingUserSnap = await getDoc(userRef).catch(() => null);
  if (existingUserSnap?.exists()) {
    batch.update(userRef, {
      invitationId: inviteId,
      invitationStatus: 'INVITACION_ENVIADA',
      invitedAt: nowIso,
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: orgId,
    eventType: 'USER_INVITATION_RESENT',
    entityType: 'users',
    entityId: params.targetUser.uid,
    action: `Reenvío de invitación a ${cleanEmail} (${orgName}) · Canal: ${emailDeliveryChannel}`.slice(0, 190),
    newState: `${params.targetUser.role} · INVITACION_ENVIADA`,
    transactionId: generateId('tx'),
    userId: params.adminUser.uid,
    userEmail: params.adminUser.email,
    userRole: params.adminUser.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.targetUser.uid}`);
  }

  return { resetSent, smtpDelivered, emailDeliveryChannel, invitationLink };
}

export async function saveNewPolicyVersion(params: {
  policy: CreditPolicyRecord;
  adminUser: UserProfile;
  isNewVersion: boolean;
}): Promise<void> {
  const { policy, adminUser, isNewVersion } = params;
  const polRef = doc(db, 'credit_policies', policy.id);
  const batch = writeBatch(db);

  if (isNewVersion) {
    batch.set(polRef, {
      ...cleanObject(policy),
      workflowConfig: policy.workflowConfig ?? DEFAULT_WORKFLOW_CONFIG,
      createdBy: adminUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(polRef, {
      name: policy.name ?? '',
      description: policy.description ?? '',
      status: policy.status,
      riskBands: policy.riskBands,
      products: policy.products,
      capacityConfig: policy.capacityConfig,
      exchangeRateConfig: policy.exchangeRateConfig,
      approvalAuthorities: policy.approvalAuthorities,
      workflowConfig: policy.workflowConfig ?? DEFAULT_WORKFLOW_CONFIG,
      allowedExpenses: policy.allowedExpenses ?? [],
      documentRequirements: policy.documentRequirements ?? [],
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: adminUser.organizationId,
    eventType: isNewVersion ? 'POLICY_VERSION_CREATED' : 'POLICY_UPDATED',
    entityType: 'credit_policies',
    entityId: policy.id,
    action: `${isNewVersion ? 'Nueva versión' : 'Actualización'} de política ${policy.version} (${policy.status})`.slice(0, 155),
    engineVersion: policy.version,
    transactionId: generateId('tx'),
    userId: adminUser.uid,
    userEmail: adminUser.email,
    userRole: adminUser.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `credit_policies/${policy.id}`);
  }
}

export async function updateOrganizationBranding(params: {
  organizationId: string;
  name: string;
  taxId: string;
  phone?: string;
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  adminUser: UserProfile;
}): Promise<void> {
  const orgId = params.organizationId.trim();
  const cleanName = (params.name || '').trim().slice(0, 160);
  if (cleanName.length < 2) {
    throw new Error('El nombre oficial de la institución debe tener al menos 2 caracteres.');
  }
  const cleanTaxId = (params.taxId || '').trim().slice(0, 40);
  const cleanPhone =
    typeof params.phone === 'string' ? params.phone.trim().slice(0, 40) : undefined;
  const cleanPrimaryColor = (params.primaryColor || '#0B1220').trim().slice(0, 32);
  const cleanAccentColor = (params.accentColor || '#2563EB').trim().slice(0, 32);
  const cleanLogoUrl =
    typeof params.logoUrl === 'string' && params.logoUrl.trim().length <= 350_000
      ? params.logoUrl.trim()
      : undefined;

  const orgRef = doc(db, 'organizations', orgId);
  const brandingPatch: Record<string, unknown> = {
    name: cleanName,
    taxId: cleanTaxId,
    rnc: cleanTaxId,
    ...(cleanPhone !== undefined ? { phone: cleanPhone } : {}),
    primaryColor: cleanPrimaryColor,
    accentColor: cleanAccentColor,
    ...(cleanLogoUrl !== undefined ? { logoUrl: cleanLogoUrl } : {}),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(orgRef, brandingPatch);
    return;
  } catch (updateErr) {
    // Fallback: if org doc does not exist yet or contains legacy/unrecognized fields, self-heal with whitelisted schema fields
    try {
      const existingSnap = await getDoc(orgRef).catch(() => null);
      const existingRaw = existingSnap?.exists()
        ? (existingSnap.data() as Record<string, unknown>)
        : {};
      const allowedKeys = [
        'tenantId', 'tenant_id', 'accessCode', 'legalName', 'tradeName', 'rnc',
        'country', 'province', 'city', 'address', 'phone', 'corporateEmail',
        'currency', 'timezone', 'status', 'onboardingDate', 'planCode',
        'licenseId', 'licenseStatus', 'licenseStartDate', 'licenseEndDate',
        'maxUsers', 'enabledModules', 'modulesEnabled', 'primaryAdminUid',
        'primaryAdminName', 'primaryAdminEmail', 'primaryAdminPhone', 'notes',
        'logoUrl',
      ] as const;

      const preserved: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (existingRaw[key] !== undefined && existingRaw[key] !== null) {
          preserved[key] = existingRaw[key];
        }
      }

      const rawCreatedAt = existingRaw.createdAt;
      const hasValidCreatedAt =
        rawCreatedAt != null &&
        (typeof rawCreatedAt === 'object' ||
          (typeof rawCreatedAt === 'string' && rawCreatedAt.length >= 10 && rawCreatedAt.length <= 40));

      const baseDefault = orgId === SU_GLORIA_ORG_ID ? SU_GLORIA_MANO_AMIGA_ORG : undefined;
      const healedDoc = cleanObject({
        ...(baseDefault || {}),
        ...preserved,
        id: orgId,
        organizationId: orgId,
        name: cleanName,
        taxId: cleanTaxId,
        rnc: cleanTaxId,
        ...(cleanPhone !== undefined ? { phone: cleanPhone } : {}),
        primaryColor: cleanPrimaryColor,
        accentColor: cleanAccentColor,
        ...(cleanLogoUrl !== undefined ? { logoUrl: cleanLogoUrl } : {}),
        createdAt: hasValidCreatedAt ? rawCreatedAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(orgRef, healedDoc);
      return;
    } catch {
      handleFirestoreError(updateErr, OperationType.UPDATE, `organizations/${orgId}`);
    }
  }
}

export async function fetchInstallmentsByLoan(loanId: string, orgId: string): Promise<LoanInstallmentRecord[]> {
  try {
    const q = query(
      collection(db, 'loan_installments'),
      where('organizationId', '==', orgId),
      where('loanId', '==', loanId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as LoanInstallmentRecord)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'loan_installments');
  }
}

export async function seedSyntheticDemoData(user: UserProfile, policy: CreditPolicyRecord): Promise<number> {
  const demoCustomers: Array<Omit<CustomerRecord, 'id' | 'documentKey' | 'createdAt' | 'updatedAt'>> = [
    {
      organizationId: user.organizationId,
      documentType: 'CEDULA',
      documentNumber: '00118492031',
      firstName: 'Mariela',
      lastName: 'Almonte Vásquez',
      birthDate: '1989-04-12',
      nationality: 'Dominicana',
      maritalStatus: 'Casada',
      phone: '8095552101',
      email: 'mariela.almonte@demo.axycore.do',
      address: 'Calle El Sol #45, Los Jardines',
      municipality: 'Santiago',
      province: 'Santiago',
      residenceMonths: 60,
      housingType: 'PROPIA',
      housingPayment: 0,
      socialMediaDeclared: 'YES',
      socialMediaHandle: '@mariela_av',
      createdBy: user.uid,
    },
    {
      organizationId: user.organizationId,
      documentType: 'CEDULA',
      documentNumber: '40229384712',
      firstName: 'Jean Carlos',
      lastName: 'Méndez Peña',
      birthDate: '1993-09-23',
      nationality: 'Dominicana',
      maritalStatus: 'Soltero',
      phone: '8295553304',
      email: '',
      address: 'Av. 27 de Febrero #210, Evaristo Morales',
      municipality: 'Distrito Nacional',
      province: 'Santo Domingo',
      residenceMonths: 18,
      housingType: 'ALQUILADA',
      housingPayment: 22000,
      socialMediaDeclared: 'NO_MEDIA',
      socialMediaHandle: '',
      createdBy: user.uid,
    },
  ];

  let createdCount = 0;
  for (let i = 0; i < demoCustomers.length; i++) {
    const cInput = demoCustomers[i];
    const custId = buildCustomerDocId(user.organizationId, cInput.documentType, cInput.documentNumber);
    const custSnap = await getDoc(doc(db, 'customers', custId));
    let customer: CustomerRecord;
    if (!custSnap.exists()) {
      customer = await saveCustomerUnique(cInput);
    } else {
      customer = custSnap.data() as CustomerRecord;
    }

    const appId = `app_demo_${i + 1}_${Date.now().toString().slice(-5)}`;
    const appNum = `SOL-DEMO-${String(i + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
    const isFirst = i === 0;
    const app: ApplicationRecord = {
      id: appId,
      organizationId: user.organizationId,
      applicationNumber: appNum,
      fileNumber: `EXP-${appNum}`,
      channel: isFirst ? 'INTERNAL' : 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: customer.id,
      applicantDisplayName: `${customer.firstName} ${customer.lastName}`,
      productCode: isFirst ? 'PERSONAL_DOP' : 'PERSONAL_USD',
      currency: isFirst ? 'DOP' : 'USD',
      requestedAmount: isFirst ? 220000 : 1800,
      requestedTermMonths: isFirst ? 12 : 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: isFirst ? 'Consolidación y mejoras del hogar' : 'Equipamiento de oficina independiente',
      loanPurposeDescription: isFirst
        ? 'Remodelación de cocina y compra de inversores solares.'
        : 'Adquisición de equipo informático para servicios profesionales.',
      financialData: isFirst
        ? {
            activityType: 'Asalariado sector salud',
            employerOrBusinessName: 'Centro Médico Metropolitano',
            occupationOrRole: 'Coordinadora Administrativa',
            employmentMonths: 54,
            incomeSourceType: 'FIJA_RECURRENTE',
            primaryNetIncome: 145000,
            additionalIncomeStatus: 'QUANTIFIED',
            additionalNetIncome: 20000,
            declaredTotalMonthlyIncome: 165000,
            incomeCurrency: 'DOP',
            essentialExpenses: 42000,
            housingPayment: 0,
            housingIncludedInExpenses: false,
            debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
            debtCount: 0,
            totalDebtBalance: 0,
            currentDebtPayments: 0,
          }
        : {
            activityType: 'Independiente / Consultoría',
            employerOrBusinessName: 'Méndez Consultores',
            occupationOrRole: 'Consultor TI',
            employmentMonths: 20,
            incomeSourceType: 'MIXTA_RECURRENTE',
            primaryNetIncome: 115000,
            additionalIncomeStatus: 'EXPLICIT_NONE',
            additionalNetIncome: 0,
            declaredTotalMonthlyIncome: 115000,
            incomeCurrency: 'DOP',
            essentialExpenses: 48000,
            housingPayment: 22000,
            housingIncludedInExpenses: true,
            debtDeclarationStatus: 'HAS_DEBTS',
            debtCount: 2,
            totalDebtBalance: 140000,
            currentDebtPayments: 11500,
            bankDebtPayment: 8000,
            cardDebtPayment: 3500,
          },
      references: isFirst
        ? [
            { name: 'Rafael Almonte', relationship: 'Padre', phone: '8095559100' },
            { name: 'Lucía Taveras', relationship: 'Supervisora', phone: '8095559200' },
          ]
        : [{ name: 'Roberto Méndez', relationship: 'Hermano', phone: '8295558811' }],
      declaredDocumentsSummary: {
        hasIdentityDoc: true,
        hasIncomeEvidence: isFirst,
      },
      status: 'RECIBIDA',
      consentVersion: 'v1.0-Ley172-13',
      createdBy: user.uid,
      createdByName: user.displayName,
    };

    await submitOrSaveApplication({
      application: app,
      customer,
      policy,
      mode: 'SUBMIT',
      user,
    });
    createdCount++;
  }

  return createdCount;
}

export async function saveFcmDeviceToken(params: {
  user: UserProfile;
  token: string;
}): Promise<FcmDeviceTokenRecord> {
  const { user, token } = params;
  if (user.role === 'EXTERNAL_CLIENT') {
    throw new Error('Los clientes externos no registran tokens Push del Inbox operativo.');
  }

  const tokenId = buildFcmTokenDocId(user.uid, token);
  const ref = doc(db, 'fcm_tokens', tokenId);
  const nowIso = new Date().toISOString();
  const platform = (typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : 'web').slice(0, 64);
  const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'browser').slice(0, 300);

  try {
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists()) {
      await updateDoc(ref, {
        userRole: user.role,
        platform,
        userAgent,
        status: 'ACTIVE',
        lastSeenAt: nowIso,
        updatedAt: serverTimestamp(),
      });
      return {
        ...(existing.data() as FcmDeviceTokenRecord),
        userRole: user.role,
        platform,
        userAgent,
        status: 'ACTIVE',
        lastSeenAt: nowIso,
      };
    }

    const record: FcmDeviceTokenRecord = {
      id: tokenId,
      organizationId: user.organizationId || DEFAULT_ORG_ID,
      userId: user.uid,
      userRole: user.role,
      userEmail: user.email,
      token,
      platform,
      userAgent,
      status: 'ACTIVE',
      lastSeenAt: nowIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, record);
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `fcm_tokens/${tokenId}`);
  }
}

export async function revokeFcmDeviceToken(params: {
  userId: string;
  token: string;
}): Promise<void> {
  const tokenId = buildFcmTokenDocId(params.userId, params.token);
  const ref = doc(db, 'fcm_tokens', tokenId);
  try {
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists()) {
      await updateDoc(ref, {
        status: 'REVOKED',
        lastSeenAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `fcm_tokens/${tokenId}`);
  }
}

export async function savePushSubscriptionRecord(params: {
  user: UserProfile;
  endpoint: string;
  p256dh: string;
  auth: string;
  fcmToken?: string | null;
  vapidPublicKeyPrefix: string;
  subscribedStatuses?: ApplicationStatus[];
}): Promise<PushSubscriptionRecord> {
  const { user, endpoint, p256dh, auth, fcmToken, vapidPublicKeyPrefix } = params;
  const subscriptionId = buildPushSubscriptionDocId(user.uid, endpoint);
  const ref = doc(db, 'push_subscriptions', subscriptionId);
  const nowIso = new Date().toISOString();
  const platform = (
    typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : 'web'
  ).slice(0, 64);
  const userAgent = (
    typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'browser'
  ).slice(0, 300);
  const normalizedStatuses: ApplicationStatus[] =
    params.subscribedStatuses && params.subscribedStatuses.length > 0
      ? params.subscribedStatuses.slice(0, 12)
      : [...ALL_TRACKED_PUSH_STATUSES];

  try {
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists()) {
      const updatePayload = {
        userRole: user.role,
        p256dh: p256dh.slice(0, 256),
        auth: auth.slice(0, 128),
        fcmToken: fcmToken ? fcmToken.slice(0, 512) : null,
        vapidPublicKeyPrefix: vapidPublicKeyPrefix.slice(0, 32),
        subscribedStatuses: normalizedStatuses,
        platform,
        userAgent,
        status: 'ACTIVE' as const,
        lastSeenAt: nowIso,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, updatePayload);
      return {
        ...(existing.data() as PushSubscriptionRecord),
        ...updatePayload,
      };
    }

    const record: PushSubscriptionRecord = {
      id: subscriptionId,
      organizationId: user.organizationId || DEFAULT_ORG_ID,
      userId: user.uid,
      userRole: user.role,
      userEmail: user.email,
      endpoint: endpoint.slice(0, 1024),
      p256dh: p256dh.slice(0, 256),
      auth: auth.slice(0, 128),
      fcmToken: fcmToken ? fcmToken.slice(0, 512) : null,
      vapidPublicKeyPrefix: vapidPublicKeyPrefix.slice(0, 32),
      subscribedStatuses: normalizedStatuses,
      platform,
      userAgent,
      status: 'ACTIVE',
      lastSeenAt: nowIso,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, record);
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `push_subscriptions/${subscriptionId}`);
  }
}

export async function updatePushSubscriptionPreferences(params: {
  subscriptionId: string;
  subscribedStatuses: ApplicationStatus[];
}): Promise<void> {
  const ref = doc(db, 'push_subscriptions', params.subscriptionId);
  const sanitized: ApplicationStatus[] =
    params.subscribedStatuses.length > 0
      ? params.subscribedStatuses.slice(0, 12)
      : [...ALL_TRACKED_PUSH_STATUSES];
  try {
    await updateDoc(ref, {
      subscribedStatuses: sanitized,
      lastSeenAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `push_subscriptions/${params.subscriptionId}`);
  }
}

export async function revokePushSubscriptionRecord(params: {
  userId: string;
  endpoint?: string | null;
  subscriptionId?: string | null;
}): Promise<void> {
  const subId =
    params.subscriptionId ||
    (params.endpoint ? buildPushSubscriptionDocId(params.userId, params.endpoint) : null);
  if (!subId) return;
  const ref = doc(db, 'push_subscriptions', subId);
  try {
    const existing = await getDoc(ref).catch(() => null);
    if (existing?.exists()) {
      await updateDoc(ref, {
        status: 'REVOKED',
        lastSeenAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `push_subscriptions/${subId}`);
  }
}

export async function inviteStaffUserByAdmin(params: {
  email: string;
  displayName: string;
  role: UserRole;
  adminUser: UserProfile;
  organization?: OrganizationRecord;
}): Promise<{
  profile: UserProfile;
  invitation: UserInvitationRecord;
  invitationLink: string;
  verificationSent: boolean;
  resetSent: boolean;
  smtpDelivered: boolean;
  emailDeliveryChannel: string;
  authVerified: boolean;
  authStatus: 'EXISTING_AUTH_USER' | 'NEW_AUTH_USER' | 'EMAIL_PASSWORD_DISABLED' | 'AUTH_FAILED';
}> {
  const canInvite =
    isSuperAdminUser(params.adminUser, true) || params.adminUser.role === 'ADMIN';
  if (!canInvite) {
    throw new Error('Solo el rol Administrador puede invitar o aprovisionar usuarios corporativos.');
  }
  const cleanEmail = normalizeEmailAddress(params.email);
  const cleanName = params.displayName.trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Ingresa un correo electrónico corporativo válido.');
  }
  if (cleanName.length < 2) {
    throw new Error('Ingresa el nombre completo del colaborador.');
  }

  const orgId = params.organization?.id || params.adminUser.organizationId || DEFAULT_ORG_ID;
  const orgName =
    params.organization?.tradeName ||
    params.organization?.name ||
    SU_GLORIA_MANO_AMIGA_ORG.tradeName ||
    'SU GLORIA MANO AMIGA';
  const accessCode =
    params.organization?.accessCode ||
    SU_GLORIA_MANO_AMIGA_ORG.accessCode ||
    'SGMA-001';
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'http://localhost:3000';
  const inviteId = buildDeterministicInvitationId(cleanEmail);
  const invitationLink = buildInvitationActivationUrl({
    origin,
    inviteId,
    orgCode: accessCode,
    email: cleanEmail,
  });

  // 1. Check if user already exists in Firestore users collection
  let existingUserDoc: any = null;
  try {
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      existingUserDoc = snap.docs[0];
    }
  } catch (err) {
    console.warn('Error querying existing user in Firestore:', err);
  }

  // 2. Verify existence / create account in Firebase Auth via isolated secondary app
  let authUid: string | null = null;
  let userExistsInAuth = false;
  let authStatus: 'EXISTING_AUTH_USER' | 'NEW_AUTH_USER' | 'EMAIL_PASSWORD_DISABLED' | 'AUTH_FAILED' =
    'AUTH_FAILED';

  const randomSecret =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `${crypto.randomUUID()}_${Date.now().toString(36)}`
      : `Axy!${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}#9Z`;

  const secondaryAppName = `axy_invite_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let secondaryApp: any = null;
  let secondaryAuth: any = null;

  try {
    secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
    secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, randomSecret);
    await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
    authUid = cred.user.uid;
    userExistsInAuth = true;
    authStatus = 'NEW_AUTH_USER';
    await signOutSecondary(secondaryAuth).catch(() => {});
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use') {
      userExistsInAuth = true;
      authStatus = 'EXISTING_AUTH_USER';
    } else if (err?.code === 'auth/operation-not-allowed') {
      // Email/Password sign-in provider not enabled yet; Google OAuth + invitation link still work seamlessly!
      authStatus = 'EMAIL_PASSWORD_DISABLED';
      userExistsInAuth = false;
    } else if (existingUserDoc) {
      userExistsInAuth = true;
      authStatus = 'EXISTING_AUTH_USER';
    } else {
      console.warn('Firebase Auth user check/creation notice:', err?.code, err?.message);
      authStatus = 'AUTH_FAILED';
    }
  } finally {
    if (secondaryApp) {
      await deleteApp(secondaryApp).catch(() => {});
    }
  }

  // 3. Determine Firestore user UID (real Auth UID if known, else existing Firestore UID, else placeholder)
  let uid = authUid;
  if (!uid && existingUserDoc) {
    uid = existingUserDoc.id;
  }
  if (!uid) {
    uid = `usr_${sanitizeIdSegment(cleanEmail).slice(0, 110)}`;
  }

  // 4. Send invitation emails:
  // (a) Firebase Auth password setup email (when account exists/was created in Auth)
  let resetSent = false;
  const verificationSent = false;

  if (userExistsInAuth) {
    try {
      const actionCodeSettings = {
        url: invitationLink,
        handleCodeInApp: false,
      };
      await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings).catch(async () => {
        await sendPasswordResetEmail(auth, cleanEmail);
      });
      resetSent = true;
    } catch (resetErr) {
      console.warn('sendPasswordResetEmail primary error, retrying standard call:', resetErr);
      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        resetSent = true;
      } catch (innerErr) {
        console.warn('sendPasswordResetEmail fallback failed:', innerErr);
        resetSent = false;
      }
    }
  }

  // (b) Always dispatch rich branded HTML+text email via Express SMTP relay (returns honest delivery status)
  const emailContent = buildInvitationEmailContent({
    displayName: cleanName,
    email: cleanEmail,
    roleLabel: ROLE_LABELS[params.role] || params.role,
    organizationName: orgName,
    accessCode,
    invitationLink,
    resetSent,
  });

  let smtpDelivered = false;
  let emailDeliveryChannel = resetSent ? 'FIREBASE_AUTH_EMAIL' : 'INVITATION_LINK_READY';
  try {
    const resp = await fetch('/api/notifications/dispatch-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cleanEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      }),
    });
    const payload = await resp.json().catch(() => null);
    if (payload?.delivered) {
      smtpDelivered = true;
      emailDeliveryChannel = resetSent
        ? 'FIREBASE_AUTH_AND_SMTP'
        : String(payload.deliveryChannel || 'EXPRESS_SMTP_RELAY');
    } else if (!resetSent && payload?.deliveryChannel) {
      emailDeliveryChannel = String(payload.deliveryChannel);
    }
  } catch {
    // keep channel from Firebase Auth
  }

  // 5. Persist verifiable `user_invitations/{inviteId}`, `users/{uid}`, `organization_memberships/{orgId}_{uid}`, and `audit_logs`
  const nowIso = new Date().toISOString();
  const invRef = doc(db, 'user_invitations', inviteId);
  const existingInvSnap = await getDoc(invRef).catch(() => null);

  const invitationDoc: UserInvitationRecord = cleanObject({
    id: inviteId,
    email: cleanEmail,
    displayName: cleanName,
    role: params.role,
    organizationId: orgId,
    organizationName: orgName,
    accessCode,
    status: 'INVITACION_ENVIADA' as const,
    invitedBy: params.adminUser.uid,
    invitedByEmail: params.adminUser.email,
    invitedAt: nowIso,
    invitationLink,
    authStatus,
    emailDeliveryChannel,
    createdAt: existingInvSnap?.exists() ? existingInvSnap.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const userRef = doc(db, 'users', uid);
  const existingUserDocSnap = existingUserDoc || (await getDoc(userRef).catch(() => null));
  const userAlreadyInDb = Boolean(existingUserDocSnap && existingUserDocSnap.exists());

  const newUserDoc = cleanObject({
    uid,
    email: cleanEmail,
    displayName: cleanName,
    role: params.role,
    organizationId: orgId,
    status: 'ACTIVE' as const,
    invitationId: inviteId,
    invitationStatus: 'INVITACION_ENVIADA' as const,
    invitedBy: params.adminUser.uid,
    invitedAt: nowIso,
    createdAt: userAlreadyInDb ? existingUserDocSnap.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const membershipId = `${orgId}_${uid}`;
  const memberRef = doc(db, 'organization_memberships', membershipId);
  const existingMemberSnap = await getDoc(memberRef).catch(() => null);
  const memberAlreadyInDb = Boolean(existingMemberSnap && existingMemberSnap.exists());

  const newMembershipDoc = cleanObject({
    id: membershipId,
    organizationId: orgId,
    organizationName: orgName,
    userId: uid,
    userEmail: cleanEmail,
    userDisplayName: cleanName,
    role: params.role,
    status: 'ACTIVE' as const,
    granularPermissions: DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE[params.role] || ['CONSULTAR'],
    isPrimaryAdmin: params.role === 'ADMIN',
    invitationId: inviteId,
    invitedBy: params.adminUser.uid,
    createdBy:
      memberAlreadyInDb && existingMemberSnap
        ? existingMemberSnap.data()?.createdBy || params.adminUser.uid
        : params.adminUser.uid,
    createdAt:
      memberAlreadyInDb && existingMemberSnap
        ? existingMemberSnap.data()?.createdAt || serverTimestamp()
        : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(invRef, invitationDoc);
  batch.set(userRef, newUserDoc, { merge: true });
  batch.set(memberRef, newMembershipDoc, { merge: true });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: orgId,
    eventType: 'USER_INVITED_BY_ADMIN',
    entityType: 'users',
    entityId: uid,
    action: `Invitación enviada a ${cleanEmail} (${orgName}) con rol ${params.role} · Auth: ${authStatus}`.slice(0, 190),
    newState: `${params.role} · INVITACION_ENVIADA`,
    transactionId: generateId('tx'),
    userId: params.adminUser.uid,
    userEmail: params.adminUser.email,
    userRole: params.adminUser.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }

  return {
    profile: {
      uid,
      email: cleanEmail,
      displayName: cleanName,
      role: params.role,
      organizationId: orgId,
      status: 'ACTIVE',
      invitationId: inviteId,
      invitationStatus: 'INVITACION_ENVIADA',
      invitedBy: params.adminUser.uid,
      invitedAt: nowIso,
    },
    invitation: invitationDoc,
    invitationLink,
    verificationSent,
    resetSent,
    smtpDelivered,
    emailDeliveryChannel,
    authVerified: userExistsInAuth,
    authStatus,
  };
}

export async function fetchDirectorAnalysisFromApi(payload: {
  question?: string;
  scopedContext: Record<string, unknown>;
  actorId: string;
}) {
  const resp = await fetch('/api/ai/director', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'No se pudo obtener el análisis de AxyCore Director.');
  }
  return data;
}

export async function fetchBelaAssistantFromApi(payload: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  scopedContext: Record<string, unknown>;
  actorId: string;
}) {
  const resp = await fetch('/api/ai/bela', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'No fue posible consultar a Bela en este momento.');
  }
  return data;
}

// ============================================================================
// ARQUITECTURA SAAS MULTIEMPRESA — PLATFORM CONTROL & GESTIÓN DE TENANTS
// ============================================================================

export async function registerNewTenantOrganizationInStore(params: {
  input: RegisterNewCompanyInput;
  actor: UserProfile;
}): Promise<{
  organization: OrganizationRecord;
  license: TenantLicenseRecord;
  subscription: TenantSubscriptionRecord;
  adminMembership: OrganizationMembershipRecord;
  invitationLink: string;
}> {
  if (!isSuperAdminUser(params.actor, true)) {
    throw new Error('Acceso denegado: Solo el Superadministrador AxyCore puede registrar nuevas empresas clientes.');
  }

  const bundle = buildNewCompanyRegistrationBundle({
    ...params.input,
    createdByUid: params.actor.uid,
  });
  const batch = writeBatch(db);

  const orgDoc: OrganizationRecord = cleanObject({
    ...bundle.organization,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const licDoc: TenantLicenseRecord = cleanObject({
    ...bundle.license,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const subDoc: TenantSubscriptionRecord = cleanObject({
    ...bundle.subscription,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const memDoc: OrganizationMembershipRecord = cleanObject({
    ...bundle.adminMembership,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Also initialize a default CreditPolicy V2 for the new organization so its credit engine is ready immediately
  const orgPolicyId = `pol_${bundle.organization.id}_v2`;
  const orgPolicyDoc: CreditPolicyRecord = cleanObject({
    ...DEFAULT_POLICY_V2,
    id: orgPolicyId,
    organizationId: bundle.organization.id,
    createdBy: params.actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'organizations', bundle.organization.id), orgDoc);
  batch.set(doc(db, 'licenses', bundle.license.id), licDoc);
  batch.set(doc(db, 'subscriptions', bundle.subscription.id), subDoc);
  batch.set(doc(db, 'organization_memberships', bundle.adminMembership.id), memDoc);
  batch.set(doc(db, 'credit_policies', orgPolicyId), orgPolicyDoc);

  // Also register Superadministrador membership in the new organization for support/supervision
  const superMemId = `mem_${bundle.organization.id}_${params.actor.uid}`;
  batch.set(doc(db, 'organization_memberships', superMemId), {
    id: superMemId,
    organizationId: bundle.organization.id,
    organizationName: bundle.organization.name,
    userId: params.actor.uid,
    userEmail: params.actor.email,
    userDisplayName: params.actor.displayName,
    role: 'ADMIN',
    status: 'ACTIVE',
    granularPermissions: DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE.ADMIN,
    invitedBy: params.actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.actor.organizationId || DEFAULT_ORG_ID,
    eventType: 'TENANT_COMPANY_REGISTERED',
    entityType: 'organizations',
    entityId: bundle.organization.id,
    action: `Incorporación de empresa SaaS: ${bundle.organization.tradeName} (${bundle.organization.taxId}) — Plan ${bundle.organization.planCode}`.slice(0, 195),
    newState: JSON.stringify({
      tenantId: bundle.organization.tenantId,
      planCode: bundle.organization.planCode,
      enabledModulesCount: bundle.organization.enabledModules?.length ?? 0,
      primaryAdminEmail: bundle.organization.primaryAdminEmail,
    }).slice(0, 3800),
    transactionId: generateId('tx'),
    userId: params.actor.uid,
    userEmail: params.actor.email,
    userRole: params.actor.role,
    timestamp: serverTimestamp(),
  });

  const publicPortal = buildPublicPortalRecordFromOrg(bundle.organization);
  batch.set(
    doc(db, 'public_portals', publicPortal.portalCode),
    cleanObject({ ...publicPortal, updatedAt: serverTimestamp() })
  );

  await batch.commit();
  return bundle;
}

export async function updateTenantOrganizationStatusInStore(params: {
  organization: OrganizationRecord;
  status?: TenantStatus;
  planCode?: CommercialPlanCode;
  maxUsers?: number;
  licenseStatus?: LicenseStatus;
  licenseEndDate?: string;
  tradeName?: string;
  legalName?: string;
  taxId?: string;
  phone?: string;
  corporateEmail?: string;
  currency?: 'DOP' | 'USD';
  accessCode?: string;
  actor: UserProfile;
}): Promise<OrganizationRecord> {
  if (!isSuperAdminUser(params.actor, true)) {
    throw new Error('Acceso denegado: Solo el Superadministrador AxyCore puede modificar el estado o plan de una empresa.');
  }

  const { organization, actor } = params;
  const targetId = organization.id || organization.organizationId || DEFAULT_ORG_ID;
  const normalizedCode = params.accessCode?.trim()
    ? params.accessCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
    : organization.accessCode || (targetId === SU_GLORIA_ORG_ID ? 'SGMA-001' : undefined);
  const updatedOrg: OrganizationRecord = cleanObject({
    ...organization,
    id: targetId,
    organizationId: targetId,
    accessCode: normalizedCode,
    status: params.status ?? organization.status ?? 'ACTIVA',
    planCode: params.planCode ?? organization.planCode ?? 'EMPRESARIAL',
    maxUsers: params.maxUsers ?? organization.maxUsers ?? 25,
    licenseStatus: params.licenseStatus ?? organization.licenseStatus ?? 'ACTIVA',
    licenseEndDate: params.licenseEndDate ?? organization.licenseEndDate,
    tradeName: params.tradeName ?? organization.tradeName ?? organization.name,
    name: params.tradeName ?? organization.name,
    legalName: params.legalName ?? organization.legalName,
    taxId: params.taxId ?? organization.taxId ?? organization.rnc,
    rnc: params.taxId ?? organization.rnc ?? organization.taxId,
    phone: params.phone ?? organization.phone,
    corporateEmail: params.corporateEmail ?? organization.corporateEmail,
    currency: params.currency ?? organization.currency ?? 'DOP',
    enabledModules: organization.enabledModules || organization.modulesEnabled || SU_GLORIA_ENABLED_MODULES,
    modulesEnabled: organization.modulesEnabled || organization.enabledModules || SU_GLORIA_ENABLED_MODULES,
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'organizations', targetId), updatedOrg);
  const publicPortal = buildPublicPortalRecordFromOrg(updatedOrg);
  batch.set(
    doc(db, 'public_portals', publicPortal.portalCode),
    cleanObject({ ...publicPortal, updatedAt: serverTimestamp() })
  );

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: actor.organizationId || DEFAULT_ORG_ID,
    eventType: 'TENANT_STATUS_UPDATED',
    entityType: 'organizations',
    entityId: targetId,
    action: `Actualización corporativa de ${updatedOrg.name}: Estado=${updatedOrg.status}, Licencia=${updatedOrg.licenseStatus}, Plan=${updatedOrg.planCode}`.slice(0, 195),
    previousState: JSON.stringify({
      status: organization.status,
      licenseStatus: organization.licenseStatus,
      planCode: organization.planCode,
    }),
    newState: JSON.stringify({
      status: updatedOrg.status,
      licenseStatus: updatedOrg.licenseStatus,
      planCode: updatedOrg.planCode,
      maxUsers: updatedOrg.maxUsers,
    }),
    transactionId: generateId('tx'),
    userId: actor.uid,
    userEmail: actor.email,
    userRole: actor.role,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return updatedOrg;
}

export async function toggleTenantModuleInStore(params: {
  organization: OrganizationRecord;
  license?: TenantLicenseRecord | null;
  targetModule: AxyCoreModuleCode;
  enable: boolean;
  autoEnableDependencies?: boolean;
  actor: UserProfile;
}): Promise<{ organization: OrganizationRecord; message: string }> {
  if (!isSuperAdminUser(params.actor, true)) {
    throw new Error('Acceso denegado: Solo el Superadministrador AxyCore puede activar o desactivar módulos por empresa.');
  }

  const currentModules = (params.organization.enabledModules || params.organization.modulesEnabled || []) as AxyCoreModuleCode[];
  const validation = validateModuleToggle({
    currentModules,
    targetModule: params.targetModule,
    enable: params.enable,
  });

  if (!validation.allowed) {
    throw new Error(validation.reason || 'No se pudo cambiar el estado del módulo.');
  }

  const statusText =
    validation.reason ||
    `Módulo [${params.targetModule}] ${params.enable ? 'habilitado' : 'desactivado'} en ${params.organization.name}.`;

  const targetId = params.organization.id || params.organization.organizationId || DEFAULT_ORG_ID;
  if (typeof window !== 'undefined' && params.targetModule === 'facturacion_electronica') {
    if (params.enable) {
      window.localStorage.removeItem(`axycore_ecf_disabled_${targetId}`);
    } else {
      window.localStorage.setItem(`axycore_ecf_disabled_${targetId}`, 'true');
    }
  }
  if (typeof window !== 'undefined' && params.targetModule === 'altera') {
    if (params.enable) {
      window.localStorage.removeItem(`axycore_altera_disabled_${targetId}`);
    } else {
      window.localStorage.setItem(`axycore_altera_disabled_${targetId}`, 'true');
    }
  }
  if (typeof window !== 'undefined' && params.targetModule === 'regula') {
    if (params.enable) {
      window.localStorage.removeItem(`axycore_regula_disabled_${targetId}`);
    } else {
      window.localStorage.setItem(`axycore_regula_disabled_${targetId}`, 'true');
    }
  }
  const updatedOrg: OrganizationRecord = cleanObject({
    ...params.organization,
    id: targetId,
    organizationId: targetId,
    enabledModules: validation.updatedModules,
    modulesEnabled: validation.updatedModules,
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'organizations', params.organization.id), updatedOrg);

  if (params.license) {
    const updatedLic: TenantLicenseRecord = cleanObject({
      ...params.license,
      enabledModules: validation.updatedModules,
      updatedBy: params.actor.uid,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'licenses', params.license.id), updatedLic);
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.actor.organizationId || DEFAULT_ORG_ID,
    eventType: params.enable ? 'TENANT_MODULE_ENABLED' : 'TENANT_MODULE_DISABLED',
    entityType: 'organizations',
    entityId: params.organization.id,
    action: `${params.enable ? 'Activación' : 'Desactivación'} de módulo [${params.targetModule}] en empresa ${params.organization.name}`.slice(0, 195),
    previousState: JSON.stringify({ count: currentModules.length }),
    newState: JSON.stringify({
      targetModule: params.targetModule,
      enable: params.enable,
      totalEnabled: validation.updatedModules.length,
    }),
    justification: statusText.slice(0, 900),
    transactionId: generateId('tx'),
    userId: params.actor.uid,
    userEmail: params.actor.email,
    userRole: params.actor.role,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return { organization: updatedOrg, message: statusText };
}

export async function updateTenantLicenseInStore(params: {
  license: TenantLicenseRecord;
  organization: OrganizationRecord;
  status: LicenseStatus;
  endDate: string;
  maxUsers: number;
  planCode: CommercialPlanCode;
  actor: UserProfile;
}): Promise<TenantLicenseRecord> {
  if (!isSuperAdminUser(params.actor, true)) {
    throw new Error('Acceso denegado: Solo el Superadministrador AxyCore puede administrar licencias comerciales.');
  }

  const updatedLicense: TenantLicenseRecord = cleanObject({
    ...params.license,
    status: params.status,
    endDate: params.endDate,
    maxUsers: params.maxUsers,
    planCode: params.planCode,
    updatedBy: params.actor.uid,
    updatedAt: serverTimestamp(),
  });

  const updatedOrg: OrganizationRecord = cleanObject({
    ...params.organization,
    licenseStatus: params.status,
    licenseEndDate: params.endDate,
    maxUsers: params.maxUsers,
    planCode: params.planCode,
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'licenses', params.license.id), updatedLicense);
  batch.set(doc(db, 'organizations', params.organization.id), updatedOrg);

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.actor.organizationId || DEFAULT_ORG_ID,
    eventType: 'TENANT_LICENSE_UPDATED',
    entityType: 'licenses',
    entityId: params.license.id,
    action: `Actualización de licencia ${params.license.id} (${params.organization.name}): ${params.status} hasta ${params.endDate}`.slice(0, 195),
    newState: JSON.stringify({
      status: params.status,
      endDate: params.endDate,
      maxUsers: params.maxUsers,
      planCode: params.planCode,
    }),
    transactionId: generateId('tx'),
    userId: params.actor.uid,
    userEmail: params.actor.email,
    userRole: params.actor.role,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return updatedLicense;
}

export async function saveOrganizationMembershipInStore(params: {
  organizationId: string;
  organizationName?: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  role: UserRole;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
  granularPermissions: GranularActionPermission[];
  actor: UserProfile;
}): Promise<OrganizationMembershipRecord> {
  const isSuper = isSuperAdminUser(params.actor, true);
  if (!isSuper && (params.actor.role !== 'ADMIN' || params.actor.organizationId !== params.organizationId)) {
    throw new Error('Solo el Superadministrador o el Administrador de esta empresa puede gestionar membresías.');
  }

  const memId = `mem_${sanitizeIdSegment(params.organizationId)}_${sanitizeIdSegment(params.userId)}`;
  const memRef = doc(db, 'organization_memberships', memId);
  const existingSnap = await getDoc(memRef).catch(() => null);

  const record: OrganizationMembershipRecord = cleanObject({
    id: memId,
    organizationId: params.organizationId,
    organizationName: params.organizationName || params.organizationId,
    userId: params.userId,
    userEmail: params.userEmail.trim().toLowerCase(),
    userDisplayName: params.userDisplayName.trim(),
    role: params.role,
    status: params.status,
    granularPermissions: params.granularPermissions,
    invitedBy: existingSnap?.exists() ? (existingSnap.data() as OrganizationMembershipRecord).invitedBy : params.actor.uid,
    createdAt: existingSnap?.exists() ? (existingSnap.data() as OrganizationMembershipRecord).createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(memRef, record);

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.actor.organizationId || DEFAULT_ORG_ID,
    eventType: 'ORGANIZATION_MEMBERSHIP_SAVED',
    entityType: 'organization_memberships',
    entityId: memId,
    action: `Asignación de membresía multiempresa para ${record.userEmail} en ${params.organizationId} (${record.role})`.slice(0, 195),
    newState: JSON.stringify({
      organizationId: params.organizationId,
      role: record.role,
      status: record.status,
      permissions: record.granularPermissions,
    }),
    transactionId: generateId('tx'),
    userId: params.actor.uid,
    userEmail: params.actor.email,
    userRole: params.actor.role,
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return record;
}

export async function fetchUserMembershipsFromStore(
  uid: string
): Promise<OrganizationMembershipRecord[]> {
  try {
    const q = query(collection(db, 'organization_memberships'), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrganizationMembershipRecord);
  } catch {
    return [];
  }
}

export async function switchActiveOrganizationInStore(params: {
  user: UserProfile;
  targetOrganizationId: string;
  organizations: OrganizationRecord[];
  memberships: OrganizationMembershipRecord[];
  isSuperAdmin: boolean;
}): Promise<UserProfile> {
  const result = switchUserOrganizationWorkspace({
    userProfile: params.user,
    targetOrganizationId: params.targetOrganizationId,
    organizations: params.organizations,
    memberships: params.memberships,
    isSuperAdmin: params.isSuperAdmin,
  });
  if (!result.allowed || !result.updatedProfile) {
    throw new Error(result.reason || 'No tienes autorización para cambiar a esta organización.');
  }

  // Persist active organizationId on user document so Firestore security rules (`inSameOrg`) immediately align with active workspace
  const userRef = doc(db, 'users', params.user.uid);
  await updateDoc(userRef, {
    organizationId: params.targetOrganizationId,
    ...(params.isSuperAdmin ? {} : { role: result.updatedProfile.role }),
    updatedAt: serverTimestamp(),
  });

  return result.updatedProfile;
}

export async function executeControlledSuGloriaMigrationInStore(params: {
  customers: CustomerRecord[];
  loans: LoanRecord[];
  payments: Array<{ id: string; organizationId: string }>;
  installments: LoanInstallmentRecord[];
  collectionActions: Array<{ id: string; organizationId: string }>;
  actor: UserProfile;
}) {
  if (!isSuperAdminUser(params.actor, true) && params.actor.role !== 'ADMIN') {
    throw new Error('Solo un Administrador autorizado puede ejecutar la verificación de migración controlada.');
  }

  const custMigration = runControlledSuGloriaMigration(params.customers);
  const loanMigration = runControlledSuGloriaMigration(params.loans);
  const payMigration = runControlledSuGloriaMigration(params.payments);
  const instMigration = runControlledSuGloriaMigration(params.installments);
  const actMigration = runControlledSuGloriaMigration(params.collectionActions);

  const orgRef = doc(db, 'organizations', SU_GLORIA_ORG_ID);
  await setDoc(orgRef, cleanObject({
    ...SU_GLORIA_MANO_AMIGA_ORG,
    primaryAdminUid: params.actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })).catch(() => {});

  return {
    organization: SU_GLORIA_MANO_AMIGA_ORG,
    migratedCounts: {
      customers: custMigration.records.length,
      loans: loanMigration.records.length,
      payments: payMigration.records.length,
      installments: instMigration.records.length,
      collectionActions: actMigration.records.length,
    },
    duplicatesCreated:
      custMigration.duplicateIdsDetected +
      loanMigration.duplicateIdsDetected +
      payMigration.duplicateIdsDetected +
      instMigration.duplicateIdsDetected +
      actMigration.duplicateIdsDetected,
    idempotent: true,
  };
}

/**
 * Obtiene una organización por su ID o tenantId desde Firestore.
 */
export async function getOrganizationById(organizationId: string): Promise<OrganizationRecord | null> {
  try {
    const orgRef = doc(db, 'organizations', organizationId);
    const snap = await getDoc(orgRef);
    if (!snap.exists()) return null;
    const data = snap.data() as OrganizationRecord;
    return {
      ...data,
      id: data.id || organizationId,
      organizationId: data.organizationId || data.id || organizationId,
      tradeName: data.tradeName || data.name,
      rnc: data.rnc || data.taxId,
      taxId: data.taxId || data.rnc,
      modulesEnabled: data.modulesEnabled || data.enabledModules || SU_GLORIA_ENABLED_MODULES,
      enabledModules: data.enabledModules || data.modulesEnabled || SU_GLORIA_ENABLED_MODULES,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `organizations/${organizationId}`);
    return null;
  }
}

/**
 * Lista todas las organizaciones de la plataforma en Firestore.
 */
export async function listAllTenantOrganizations(): Promise<OrganizationRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'organizations'));
    return snap.docs.map((d) => {
      const data = d.data() as OrganizationRecord;
      return {
        ...data,
        id: data.id || d.id,
        organizationId: data.organizationId || data.id || d.id,
        tradeName: data.tradeName || data.name,
        rnc: data.rnc || data.taxId,
        taxId: data.taxId || data.rnc,
        modulesEnabled: data.modulesEnabled || data.enabledModules || SU_GLORIA_ENABLED_MODULES,
        enabledModules: data.enabledModules || data.modulesEnabled || SU_GLORIA_ENABLED_MODULES,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'organizations');
    return [];
  }
}

/**
 * Asegura la existencia y actualización de la organización principal "SU GLORIA MANO AMIGA",
 * preservando todos los registros de negocio asociados con idempotencia total.
 */
export async function ensureSuGloriaManoAmigaExists(actorUid?: string): Promise<OrganizationRecord> {
  const orgRef = doc(db, 'organizations', SU_GLORIA_ORG_ID);
  const snap = await getDoc(orgRef).catch(() => null);
  if (snap?.exists()) {
    const existing = snap.data() as OrganizationRecord;
    return {
      ...SU_GLORIA_MANO_AMIGA_ORG,
      ...existing,
      id: SU_GLORIA_ORG_ID,
      organizationId: SU_GLORIA_ORG_ID,
      enabledModules: existing.enabledModules || existing.modulesEnabled || SU_GLORIA_ENABLED_MODULES,
      modulesEnabled: existing.modulesEnabled || existing.enabledModules || SU_GLORIA_ENABLED_MODULES,
    };
  }

  const orgDoc: OrganizationRecord = cleanObject({
    id: SU_GLORIA_ORG_ID,
    organizationId: SU_GLORIA_ORG_ID,
    tenantId: SU_GLORIA_MANO_AMIGA_ORG.tenantId,
    tenant_id: SU_GLORIA_MANO_AMIGA_ORG.tenant_id,
    accessCode: SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001',
    name: 'SU GLORIA MANO AMIGA',
    legalName: SU_GLORIA_MANO_AMIGA_ORG.legalName,
    tradeName: 'SU GLORIA MANO AMIGA',
    taxId: '1-31-98421-2',
    rnc: '1-31-98421-2',
    country: SU_GLORIA_MANO_AMIGA_ORG.country,
    province: SU_GLORIA_MANO_AMIGA_ORG.province,
    city: SU_GLORIA_MANO_AMIGA_ORG.city,
    address: SU_GLORIA_MANO_AMIGA_ORG.address,
    phone: SU_GLORIA_MANO_AMIGA_ORG.phone,
    corporateEmail: SU_GLORIA_MANO_AMIGA_ORG.corporateEmail,
    currency: SU_GLORIA_MANO_AMIGA_ORG.currency,
    timezone: SU_GLORIA_MANO_AMIGA_ORG.timezone,
    status: 'ACTIVA',
    onboardingDate: SU_GLORIA_MANO_AMIGA_ORG.onboardingDate,
    planCode: 'CORPORATIVO',
    licenseId: SU_GLORIA_MANO_AMIGA_ORG.licenseId,
    licenseStatus: 'ACTIVA',
    licenseStartDate: SU_GLORIA_MANO_AMIGA_ORG.licenseStartDate,
    licenseEndDate: SU_GLORIA_MANO_AMIGA_ORG.licenseEndDate,
    maxUsers: SU_GLORIA_MANO_AMIGA_ORG.maxUsers,
    enabledModules: SU_GLORIA_ENABLED_MODULES,
    modulesEnabled: SU_GLORIA_ENABLED_MODULES,
    primaryAdminUid: actorUid || SU_GLORIA_MANO_AMIGA_ORG.primaryAdminUid,
    primaryAdminName: SU_GLORIA_MANO_AMIGA_ORG.primaryAdminName,
    primaryAdminEmail: SU_GLORIA_MANO_AMIGA_ORG.primaryAdminEmail,
    primaryAdminPhone: SU_GLORIA_MANO_AMIGA_ORG.primaryAdminPhone,
    notes: SU_GLORIA_MANO_AMIGA_ORG.notes,
    primaryColor: SU_GLORIA_MANO_AMIGA_ORG.primaryColor,
    accentColor: SU_GLORIA_MANO_AMIGA_ORG.accentColor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(orgRef, orgDoc).catch((err) =>
    handleFirestoreError(err, OperationType.CREATE, `organizations/${SU_GLORIA_ORG_ID}`)
  );

  return orgDoc;
}

const LEGACY_ORG_IDS = ['org_default', 'org_su_gloria_mano_amiga', 'su-gloria-mano-amiga'] as const;

export interface FirestoreInventoryCollectionSummary {
  collectionName: string;
  label: string;
  category: 'ORIGINACION' | 'CARTERA' | 'COBRANZA_Y_PAGOS' | 'INVERSIONISTAS';
  primaryOrgCount: number;
  legacyOrgCount: number;
  totalFound: number;
  status: 'OK' | 'WARNING';
  note?: string;
}

export interface FirestorePortfolioInventoryReport {
  checkedAtIso: string;
  primaryOrgId: string;
  legacyOrgIdsChecked: string[];
  collections: FirestoreInventoryCollectionSummary[];
  totalPrimaryDocs: number;
  totalLegacyDocs: number;
  loansWithoutCollectionAccountEstimate: number;
}

async function safeCountCollectionByOrgs(
  colName: string,
  orgIds: string[]
): Promise<{ count: number; error?: string }> {
  try {
    const q =
      orgIds.length === 1
        ? query(collection(db, colName), where('organizationId', '==', orgIds[0]))
        : query(collection(db, colName), where('organizationId', 'in', orgIds));
    try {
      const agg = await getCountFromServer(q);
      return { count: agg.data().count };
    } catch {
      const snap = await getDocs(q);
      return { count: snap.size };
    }
  } catch (err) {
    return {
      count: 0,
      error: err instanceof Error ? err.message : 'Sin acceso o índice pendiente',
    };
  }
}

/**
 * Audita el inventario real persistido en Firestore en todas las colecciones operativas
 * de la organización principal (SU GLORIA MANO AMIGA: org_axycore_main) y verifica si existen
 * registros residuales bajo organizationId legados, 100% independiente de plataformas externas.
 */
export async function auditFirestorePortfolioInventory(
  actor: UserProfile
): Promise<FirestorePortfolioInventoryReport> {
  if (!isSuperAdminUser(actor, true) && actor.role !== 'ADMIN') {
    throw new Error('Solo un Administrador o Superadministrador autorizado puede auditar el inventario de Firestore.');
  }

  const catalog: Array<{
    collectionName: string;
    label: string;
    category: FirestoreInventoryCollectionSummary['category'];
  }> = [
    { collectionName: 'customers', label: 'Clientes', category: 'ORIGINACION' },
    { collectionName: 'businesses', label: 'Negocios / Empresas', category: 'ORIGINACION' },
    { collectionName: 'applications', label: 'Solicitudes de Crédito', category: 'ORIGINACION' },
    { collectionName: 'committee_decisions', label: 'Decisiones de Comité', category: 'ORIGINACION' },
    { collectionName: 'formalizations', label: 'Formalizaciones', category: 'ORIGINACION' },
    { collectionName: 'disbursements', label: 'Desembolsos', category: 'CARTERA' },
    { collectionName: 'loans', label: 'Préstamos (Cartera Completa)', category: 'CARTERA' },
    { collectionName: 'loan_installments', label: 'Cuotas de Préstamos', category: 'CARTERA' },
    { collectionName: 'collection_accounts', label: 'Cuentas de Cobranza', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'collection_actions', label: 'Gestiones de Cobro', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'payment_promises', label: 'Promesas de Pago', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'payment_agreements', label: 'Acuerdos de Pago', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'payments', label: 'Pagos Realizados / Reportados', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'payment_allocations', label: 'Aplicaciones / Desglose de Pagos', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'collection_receipts', label: 'Recibos Oficiales de Cobro', category: 'COBRANZA_Y_PAGOS' },
    { collectionName: 'investors', label: 'Inversionistas', category: 'INVERSIONISTAS' },
    { collectionName: 'investor_transactions', label: 'Movimientos de Inversionistas', category: 'INVERSIONISTAS' },
  ];

  const summaries = await Promise.all(
    catalog.map(async (item): Promise<FirestoreInventoryCollectionSummary> => {
      const [primaryRes, legacyRes] = await Promise.all([
        safeCountCollectionByOrgs(item.collectionName, [SU_GLORIA_ORG_ID]),
        safeCountCollectionByOrgs(item.collectionName, [...LEGACY_ORG_IDS]),
      ]);
      const note = primaryRes.error || legacyRes.error;
      return {
        collectionName: item.collectionName,
        label: item.label,
        category: item.category,
        primaryOrgCount: primaryRes.count,
        legacyOrgCount: legacyRes.count,
        totalFound: primaryRes.count + legacyRes.count,
        status: note || legacyRes.count > 0 ? 'WARNING' : 'OK',
        ...(note ? { note } : {}),
      };
    })
  );

  const loansCount = summaries.find((s) => s.collectionName === 'loans')?.primaryOrgCount ?? 0;
  const accountsCount = summaries.find((s) => s.collectionName === 'collection_accounts')?.primaryOrgCount ?? 0;

  return {
    checkedAtIso: new Date().toISOString(),
    primaryOrgId: SU_GLORIA_ORG_ID,
    legacyOrgIdsChecked: [...LEGACY_ORG_IDS],
    collections: summaries,
    totalPrimaryDocs: summaries.reduce((acc, s) => acc + s.primaryOrgCount, 0),
    totalLegacyDocs: summaries.reduce((acc, s) => acc + s.legacyOrgCount, 0),
    loansWithoutCollectionAccountEstimate: Math.max(0, loansCount - accountsCount),
  };
}

/**
 * Asocia y migra de manera controlada e idempotente registros de negocio existentes
 * con organizationId legado hacia 'SU GLORIA MANO AMIGA' (org_axycore_main),
 * procesando lotes seguros de hasta 400 operaciones sin sobrescribir IDs ni duplicar documentos.
 */
export async function associateExistingBusinessRecordsToSuGloria(actor: UserProfile): Promise<{
  organization: OrganizationRecord;
  migratedCustomers: number;
  migratedLoans: number;
  migratedPayments: number;
  migratedInstallments: number;
  migratedActions: number;
}> {
  if (!isSuperAdminUser(actor, true) && actor.role !== 'ADMIN') {
    throw new Error('Solo un Administrador autorizado puede ejecutar la asociación de registros a Su Gloria Mano Amiga.');
  }

  const org = await ensureSuGloriaManoAmigaExists(actor.uid);

  const queryLegacy = async (colName: string) => {
    try {
      const q = query(collection(db, colName), where('organizationId', 'in', [...LEGACY_ORG_IDS]));
      return await getDocs(q);
    } catch {
      return null;
    }
  };

  const [custSnap, loanSnap, paySnap, instSnap, actSnap] = await Promise.all([
    queryLegacy('customers'),
    queryLegacy('loans'),
    queryLegacy('payments'),
    queryLegacy('loan_installments'),
    queryLegacy('collection_actions'),
  ]);

  let migratedCustomers = 0;
  let migratedLoans = 0;
  let migratedPayments = 0;
  let migratedInstallments = 0;
  let migratedActions = 0;

  const pendingRefs: Array<ReturnType<typeof doc>> = [];

  const collectRefs = (
    snap: Awaited<ReturnType<typeof queryLegacy>>,
    onAdded: () => void
  ) => {
    if (!snap || snap.empty) return;
    for (const d of snap.docs) {
      pendingRefs.push(d.ref);
      onAdded();
    }
  };

  collectRefs(custSnap, () => migratedCustomers++);
  collectRefs(loanSnap, () => migratedLoans++);
  collectRefs(paySnap, () => migratedPayments++);
  collectRefs(instSnap, () => migratedInstallments++);
  collectRefs(actSnap, () => migratedActions++);

  const BATCH_LIMIT = 400;
  for (let i = 0; i < pendingRefs.length; i += BATCH_LIMIT) {
    const chunk = pendingRefs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const ref of chunk) {
      batch.update(ref, { organizationId: SU_GLORIA_ORG_ID, updatedAt: serverTimestamp() });
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'associate_su_gloria_records');
    }
  }

  return {
    organization: org,
    migratedCustomers,
    migratedLoans,
    migratedPayments,
    migratedInstallments,
    migratedActions,
  };
}




