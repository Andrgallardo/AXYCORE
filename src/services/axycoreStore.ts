import {
  collection,
  doc,
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
  ApplicationDocumentRecord,
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
  FormalizationRecord,
  GranularActionPermission,
  LicenseStatus,
  LoanInstallmentRecord,
  LoanRecord,
  MovementHistoryEntry,
  OrganizationMembershipRecord,
  OrganizationRecord,
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
} from '../types/axycore';
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
  const nextEntry: MovementHistoryEntry = sanitizeFirestorePayload({
    timestamp: entry.timestamp,
    action: String(entry.action || 'Actualización de expediente').slice(0, 300),
    ...(entry.fromStatus ? { fromStatus: entry.fromStatus } : {}),
    toStatus: entry.toStatus,
    userId: entry.userId,
    userName: entry.userName,
    ...(trimmedNote ? { note: trimmedNote.slice(0, 500) } : {}),
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
  'movementHistory',
  'createdByName',
]);

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
  if (!VALID_ID_REGEX.test(String(data.organizationId || ''))) return true;
  if (!VALID_ID_REGEX.test(String(data.customerId || ''))) return true;
  if (!VALID_ID_REGEX.test(String(data.createdBy || ''))) return true;
  if (typeof data.applicationNumber !== 'string' || data.applicationNumber.length < 3 || data.applicationNumber.length > 64) {
    return true;
  }
  if (typeof data.fileNumber !== 'string' || data.fileNumber.length < 3 || data.fileNumber.length > 64) {
    return true;
  }
  if (
    'latestScoringExecutionId' in data &&
    data.latestScoringExecutionId !== null &&
    !VALID_ID_REGEX.test(String(data.latestScoringExecutionId))
  ) {
    return true;
  }
  if (
    'businessId' in data &&
    data.businessId !== null &&
    !VALID_ID_REGEX.test(String(data.businessId))
  ) {
    return true;
  }
  if (Array.isArray(data.references) && data.references.length > 4) return true;
  if (Array.isArray(data.movementHistory) && data.movementHistory.length > 50) return true;
  if (
    'latestScore' in data &&
    data.latestScore !== null &&
    (typeof data.latestScore !== 'number' || data.latestScore < 0 || data.latestScore > 100)
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
    ...(typeof customer.residenceMonths === 'number'
      ? { residenceMonths: Math.max(0, Math.min(1200, Math.round(customer.residenceMonths))) }
      : {}),
    ...(customer.housingType ? { housingType: customer.housingType } : {}),
    ...(typeof customer.housingPayment === 'number'
      ? { housingPayment: Math.max(0, customer.housingPayment) }
      : {}),
    ...(customer.socialMediaDeclared ? { socialMediaDeclared: customer.socialMediaDeclared } : {}),
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
      ? options.preserveCreatedAt
      : serverTimestamp();

  const rawAppNum = String(merged.applicationNumber || merged.id || 'SOL').trim();
  const safeAppNum = (rawAppNum.length >= 3 ? rawAppNum : `SOL-${merged.id}`).slice(0, 64);
  const rawFileNum = String(merged.fileNumber || `EXP-${merged.id}`).trim();
  const safeFileNum = (rawFileNum.length >= 3 ? rawFileNum : `EXP-${merged.id}`).slice(0, 64);

  const safeBusinessId =
    typeof merged.businessId === 'string' && VALID_ID_REGEX.test(merged.businessId.trim())
      ? merged.businessId.trim()
      : null;

  const safeScoringExecId =
    typeof merged.latestScoringExecutionId === 'string' &&
    VALID_ID_REGEX.test(merged.latestScoringExecutionId.trim())
      ? merged.latestScoringExecutionId.trim()
      : null;

  return cleanObject({
    id: merged.id,
    organizationId: effectiveOrgId,
    applicationNumber: safeAppNum,
    fileNumber: safeFileNum,
    channel: merged.channel === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL',
    applicantType: merged.applicantType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
    customerId: merged.customerId,
    ...(safeBusinessId ? { businessId: safeBusinessId } : {}),
    applicantDisplayName: (String(merged.applicantDisplayName || '').trim() || 'Solicitante').slice(0, 200),
    productCode: merged.productCode || 'PERSONAL_DOP',
    currency: merged.currency === 'USD' ? 'USD' : 'DOP',
    requestedAmount: Math.max(0, Number(merged.requestedAmount) || 0),
    requestedTermMonths: Math.max(0, Math.min(360, Math.round(Number(merged.requestedTermMonths) || 0))),
    paymentFrequency: merged.paymentFrequency || 'MENSUAL',
    amortizationMethod: merged.amortizationMethod || 'SALDO_INSOLUTO',
    ...(merged.loanPurpose ? { loanPurpose: String(merged.loanPurpose).slice(0, 120) } : {}),
    ...(merged.loanPurposeDescription
      ? { loanPurposeDescription: String(merged.loanPurposeDescription).slice(0, 1000) }
      : {}),
    ...(merged.proposedCollateral
      ? { proposedCollateral: String(merged.proposedCollateral).slice(0, 500) }
      : {}),
    ...(merged.financialData ? { financialData: merged.financialData } : {}),
    ...(merged.businessFinancialData !== undefined
      ? { businessFinancialData: merged.businessFinancialData }
      : {}),
    ...(merged.verifiedFinancialData !== undefined
      ? { verifiedFinancialData: merged.verifiedFinancialData }
      : {}),
    ...(merged.verifiedBusinessFinancialData !== undefined
      ? { verifiedBusinessFinancialData: merged.verifiedBusinessFinancialData }
      : {}),
    references: Array.isArray(merged.references) ? merged.references.slice(0, 4) : [],
    ...(merged.declaredDocumentsSummary
      ? { declaredDocumentsSummary: merged.declaredDocumentsSummary }
      : {}),
    status: merged.status,
    ...(merged.prequalificationStatus ? { prequalificationStatus: merged.prequalificationStatus } : {}),
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
    ...(merged.recommendedAmount !== undefined ? { recommendedAmount: merged.recommendedAmount } : {}),
    ...(merged.recommendedRateMonthly !== undefined
      ? {
          recommendedRateMonthly:
            merged.recommendedRateMonthly === null
              ? null
              : normalizeMonthlyRateDecimal(merged.recommendedRateMonthly, 0),
        }
      : {}),
    ...(merged.recommendedTermMonths !== undefined
      ? { recommendedTermMonths: merged.recommendedTermMonths }
      : {}),
    ...(merged.recommendedInstallment !== undefined
      ? { recommendedInstallment: merged.recommendedInstallment }
      : {}),
    ...(merged.authorizedAlternateAmount !== undefined
      ? { authorizedAlternateAmount: merged.authorizedAlternateAmount }
      : {}),
    ...(merged.alternateAmountAuthorizedBy !== undefined
      ? { alternateAmountAuthorizedBy: merged.alternateAmountAuthorizedBy }
      : {}),
    consentVersion: String(merged.consentVersion || 'v1.0-Ley172-13').slice(0, 40),
    consentAcceptedAt: consentAt,
    ...(merged.assignedTo ? { assignedTo: String(merged.assignedTo).slice(0, 128) } : {}),
    ...(merged.assignedToName ? { assignedToName: String(merged.assignedToName).slice(0, 160) } : {}),
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

    // Self-heal legacy/corrupt migrated docs when an ADMIN performs the transition so isValidApplication never rejects the update.
    if (user.role === 'ADMIN' && hasApplicationSchemaDrift(existingData, application.id)) {
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

  // Application only existed in memory (e.g. AppSheet migration bundle): materialize customer + application cleanly.
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

export async function bootstrapUserAndOrg(fbUser: FirebaseUser): Promise<UserProfile> {
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
      const newProfile = cleanObject({
        uid: fbUser.uid,
        email: cleanEmail || 'sin-correo@axycore.local',
        displayName: decision.displayName,
        role: decision.role,
        organizationId: decision.organizationId,
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
      const needsDgiiModuleBackfill =
        !explicitlyDisabled &&
        (!baseEnabled.includes('facturacion_electronica') ||
          !baseEnabled.includes('contabilidad') ||
          !(currentOrg.modulesEnabled || []).includes('facturacion_electronica'));
      const needsAlteraModuleBackfill =
        !explicitlyDisabledAltera &&
        (!baseEnabled.includes('altera') ||
          !(currentOrg.modulesEnabled || []).includes('altera'));
      if (
        !currentOrg.tradeName ||
        !currentOrg.rnc ||
        !currentOrg.modulesEnabled ||
        currentOrg.name === 'AxyCore Servicios Financieros' ||
        !currentOrg.enabledModules ||
        needsDgiiModuleBackfill ||
        needsAlteraModuleBackfill
      ) {
        const mergedEnabled = Array.from(
          new Set([
            ...baseEnabled,
            ...(needsDgiiModuleBackfill ? (['contabilidad', 'facturacion_electronica'] as AxyCoreModuleCode[]) : []),
            ...(needsAlteraModuleBackfill ? (['altera'] as AxyCoreModuleCode[]) : []),
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
        const licNeedsEcf = !curLic.enabledModules?.includes('facturacion_electronica');
        const licNeedsAltera = !curLic.enabledModules?.includes('altera');
        if (licNeedsEcf || licNeedsAltera) {
          await setDoc(
            licRef,
            {
              ...curLic,
              enabledModules: Array.from(
                new Set([
                  ...(curLic.enabledModules || []),
                  ...(licNeedsEcf ? (['contabilidad', 'facturacion_electronica'] as AxyCoreModuleCode[]) : []),
                  ...(licNeedsAltera ? (['altera'] as AxyCoreModuleCode[]) : []),
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
}): Promise<{ application: ApplicationRecord; scoring?: ScoringExecutionRecord }> {
  const { application, customer, policy, mode, user, consentText } = params;
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
    createdBy: user.uid,
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
      user.uid,
      safeActorName,
      {
        preserveOrganizationId: effectiveOrgId,
        preserveCreatedBy: existingData?.createdBy ?? user.uid,
        preserveCreatedAt: existingData?.createdAt,
      }
    ) as unknown as ApplicationRecord;

    try {
      if (isExisting) {
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
      } else {
        await setDoc(appRef, draftPayload);
      }
      return { application: draftPayload };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `applications/${normalizedApp.id}`);
    }
  }

  // SUBMIT mode: Execute Motor de Decisiones Crediticias V2 on backend immediately
  const scoringResult = await runBackendDecisionEngine({
    application: normalizedApp,
    customer: { ...customer, organizationId: effectiveOrgId },
    policy,
    executionTrigger: 'INITIAL_SUBMIT',
    executedBy: user.uid,
    executedByName: safeActorName,
  });

  const nowIso = new Date().toISOString();
  const updatedHistory = appendMovementHistory(normalizedApp.movementHistory, {
    timestamp: nowIso,
    action: `Solicitud enviada y precalificada por Motor V2 (${scoringResult.status}, Score ${scoringResult.totalScore}/100)`,
    toStatus: 'RECIBIDA',
    userId: user.uid,
    userName: safeActorName,
  });

  const execPayload = sanitizeScoringExecutionPayload({
    ...scoringResult,
    organizationId: effectiveOrgId,
    applicationId: normalizedApp.id,
    executedBy: user.uid,
    executedByName: safeActorName,
  });

  const canPersistScoring =
    Array.isArray(execPayload.indicatorDetails) &&
    (execPayload.indicatorDetails.length === 22 || execPayload.status === 'ERROR_CALCULO');

  const finalApp = buildMaterializedApplicationPayload(
    normalizedApp,
    {
      status: 'RECIBIDA',
      prequalificationStatus: execPayload.status,
      latestScoringExecutionId: canPersistScoring ? execPayload.id : null,
      latestScore: execPayload.totalScore,
      latestRiskBand: execPayload.riskBand?.code ?? scoringResult.riskBand?.code ?? 'CRITICO',
      recommendedAmount: execPayload.recommendedAmount,
      recommendedRateMonthly: execPayload.recommendedRateMonthly,
      recommendedTermMonths: execPayload.recommendedTermMonths,
      recommendedInstallment: execPayload.recommendedInstallment,
      consentAcceptedAt:
        normalizedApp.consentAcceptedAt && normalizedApp.consentAcceptedAt.length >= 10
          ? normalizedApp.consentAcceptedAt
          : nowIso,
      consentVersion: normalizedApp.consentVersion || 'v1.0-Ley172-13',
      movementHistory: updatedHistory,
    },
    user.uid,
    safeActorName,
    {
      preserveOrganizationId: effectiveOrgId,
      preserveCreatedBy: existingData?.createdBy ?? user.uid,
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
    status: 'RECIBIDA',
    prequalificationStatus: finalApp.prequalificationStatus,
    latestScoringExecutionId: finalApp.latestScoringExecutionId ?? null,
    latestScore: finalApp.latestScore,
    latestRiskBand: finalApp.latestRiskBand,
    recommendedAmount: finalApp.recommendedAmount,
    recommendedRateMonthly: finalApp.recommendedRateMonthly,
    recommendedTermMonths: finalApp.recommendedTermMonths,
    recommendedInstallment: finalApp.recommendedInstallment,
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
    acceptedBy: user.uid,
  });

  const auditId = generateId('audit');
  const auditPayload = {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: effectiveOrgId,
      eventType: 'APPLICATION_SUBMITTED_AND_SCORED',
      entityType: 'applications',
      entityId: normalizedApp.id,
      action: `Originación ${finalApp.applicationNumber} (${finalApp.channel}) + Score ${execPayload.totalScore}/100`,
      newState: `RECIBIDA | ${execPayload.status}`,
      transactionId: generateId('tx'),
      engineVersion: policy.version,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  };

  const batch = writeBatch(db);
  if (isExisting) {
    batch.update(appRef, existingUpdatePayload);
  } else {
    batch.set(appRef, finalApp);
  }
  if (canPersistScoring) {
    batch.set(doc(db, 'scoring_executions', execPayload.id), execPayload);
  }
  batch.set(doc(db, 'application_consents', consentId), consentPayload);
  batch.set(doc(db, 'audit_logs', auditId), auditPayload);

  try {
    await batch.commit();
  } catch (batchErr) {
    // Fallback de persistencia en 2 fases cuando un batch multi-documento encuentra restricciones
    // de evaluación cruzada (p. ej. existsAfter en creación simultánea de solicitud + scoring):
    // 1) Persistir primero `applications/{id}` para garantizar que el expediente exista en disco.
    try {
      if (isExisting) {
        await updateDoc(appRef, existingUpdatePayload);
      } else {
        await setDoc(appRef, finalApp);
      }
    } catch (appErr) {
      handleFirestoreError(appErr, OperationType.WRITE, `applications/${normalizedApp.id}`);
    }

    // 2) Persistir registros satelitales (scoring, consentimiento y auditoría) con el expediente ya creado.
    const secondaryWrites: Array<Promise<void>> = [];
    if (canPersistScoring) {
      secondaryWrites.push(
        setDoc(doc(db, 'scoring_executions', execPayload.id), execPayload).catch((err) => {
          console.warn('Scoring execution write warning after application creation:', err);
        })
      );
    }
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

  await enqueueCustomerStatusEmail({
    application: finalApp,
    customer,
    eventCode: 'RECIBIDA',
    fromStatus: normalizedApp.status,
    toStatus: 'RECIBIDA',
    historyLength: updatedHistory.length,
    user,
  }).catch((err) => {
    console.warn('Customer status email notification skipped after submit:', err);
  });

  return { application: finalApp, scoring: execPayload };
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

export async function saveAnalystEvaluationAndRecalc(params: {
  application: ApplicationRecord;
  customer: CustomerRecord;
  policy: CreditPolicyRecord;
  evaluation: Omit<CreditEvaluationRecord, 'createdAt' | 'updatedAt'>;
  sendToCommittee: boolean;
  returnToApplicant: boolean;
  user: UserProfile;
}): Promise<{ newScoring: ScoringExecutionRecord }> {
  const { application, customer, policy, evaluation, sendToCommittee, returnToApplicant, user } = params;

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

  const updatedAppForScoring: ApplicationRecord = {
    ...application,
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

  const effRecAmount =
    evaluation.recommendedAmount !== null && evaluation.recommendedAmount !== undefined && evaluation.recommendedAmount > 0
      ? evaluation.recommendedAmount
      : newScoring.recommendedAmount;
  const effRecRate =
    evaluation.recommendedRateMonthly !== null && evaluation.recommendedRateMonthly !== undefined && evaluation.recommendedRateMonthly > 0
      ? normalizeMonthlyRateDecimal(evaluation.recommendedRateMonthly, 0)
      : normalizeMonthlyRateDecimal(newScoring.recommendedRateMonthly, 0);
  const effRecTerm =
    evaluation.recommendedTermMonths !== null && evaluation.recommendedTermMonths !== undefined && evaluation.recommendedTermMonths > 0
      ? evaluation.recommendedTermMonths
      : newScoring.recommendedTermMonths;

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

  await ensureApplicationPersistedInBatch({
    batch,
    application,
    customer,
    user,
    updates: {
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
      recommendedInstallment: newScoring.recommendedInstallment,
      assignedTo: user.uid,
      assignedToName: user.displayName,
      movementHistory: newHistory,
    },
  });

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

  const normalizedDecisionInput = {
    ...decisionInput,
    approvedRateMonthly:
      decisionInput.approvedRateMonthly !== null && decisionInput.approvedRateMonthly !== undefined
        ? normalizeMonthlyRateDecimal(decisionInput.approvedRateMonthly, 0.04)
        : null,
  };

  // Load prior votes cast for this application in this organization (2-of-3 collegial quorum)
  const existingSnap = await getDocs(
    query(
      collection(db, 'committee_decisions'),
      where('organizationId', '==', application.organizationId),
      where('applicationId', '==', application.id)
    )
  ).catch(() => null);

  const priorVotes: CollegialVoteEntry[] = [];
  if (existingSnap) {
    for (const d of existingSnap.docs) {
      const rec = d.data() as CommitteeDecisionRecord;
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
    userName: user.displayName,
    role: user.role,
    vote: normalizedDecisionInput.decision,
    votedAt: nowIso,
  };

  const voteEval = evaluateCollegialCommitteeVotes([...priorVotes, thisVote], 2, 3);
  const voteDocId = `dec_${sanitizeIdSegment(application.id)}_${sanitizeIdSegment(user.uid)}`.slice(0, 120);

  if (voteEval.resolvedDecision === null) {
    const newHistory = appendMovementHistory(application.movementHistory, {
      timestamp: nowIso,
      action: `Voto Comité (${voteEval.totalVotes}/3): ${user.displayName} votó ${normalizedDecisionInput.decision} (${voteEval.approveCount}/2 requeridos)`,
      fromStatus: application.status,
      toStatus: 'EN_COMITE',
      userId: user.uid,
      userName: user.displayName,
      note: normalizedDecisionInput.observations || normalizedDecisionInput.rejectionReason || null,
    });

    const batch = writeBatch(db);
    await ensureApplicationPersistedInBatch({
      batch,
      application,
      user,
      updates: {
        status: 'EN_COMITE',
        movementHistory: newHistory,
      },
    });

    batch.set(
      doc(db, 'committee_decisions', voteDocId),
      cleanObject({
        ...normalizedDecisionInput,
        id: voteDocId,
        collegialVotes: voteEval.uniqueVotes,
        voteStatus: 'VOTO_PARCIAL',
        requiredVotes: 2,
        totalPanelMembers: 3,
        authorityUsed: check.authorityUsed ?? 'Facultad de Comité',
        isImmutable: true,
        decidedAt: serverTimestamp(),
      })
    );

    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      ...buildCriticalAuditEntryPayload({
        id: auditId,
        organizationId: application.organizationId,
        eventType: 'COMMITTEE_VOTE_RECORDED',
        entityType: 'committee_decisions',
        entityId: voteDocId,
        action: `Voto ${voteEval.totalVotes}/3 emitido (${normalizedDecisionInput.decision}) para ${application.applicationNumber}`,
        previousState: application.status,
        newState: 'EN_COMITE',
        justification:
          normalizedDecisionInput.observations ||
          normalizedDecisionInput.rejectionReason ||
          check.authorityUsed ||
          '',
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
    userName: user.displayName,
    note: normalizedDecisionInput.observations || normalizedDecisionInput.rejectionReason || null,
  });

  const batch = writeBatch(db);
  await ensureApplicationPersistedInBatch({
    batch,
    application,
    user,
    updates: {
      status: nextAppStatus,
      movementHistory: newHistory,
    },
  });

  batch.set(
    doc(db, 'committee_decisions', voteDocId),
    cleanObject({
      ...normalizedDecisionInput,
      id: voteDocId,
      decision: resolvedDecision,
      collegialVotes: voteEval.uniqueVotes,
      voteStatus: 'RESOLUCION_FINAL',
      requiredVotes: 2,
      totalPanelMembers: 3,
      authorityUsed: check.authorityUsed ?? 'Facultad de Comité',
      isImmutable: true,
      decidedAt: serverTimestamp(),
    })
  );

  const approvedCapital =
    normalizedDecisionInput.approvedAmount ??
    application.recommendedAmount ??
    application.requestedAmount;
  const contractualRate = normalizeMonthlyRateDecimal(
    normalizedDecisionInput.approvedRateMonthly ?? application.recommendedRateMonthly ?? 0.04,
    0.04
  );
  const termMonths = Math.max(
    1,
    Math.round(
      normalizedDecisionInput.approvedTermMonths ??
        application.recommendedTermMonths ??
        application.requestedTermMonths ??
        12
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

  if (resolvedDecision === 'APROBADO' || resolvedDecision === 'APROBADO_CONDICIONADO') {
    const schedule = generateAmortizationSchedule({
      financedPrincipal: approvedCapital,
      monthlyRate: contractualRate,
      termMonths,
      frequency: application.paymentFrequency,
      amortizationMethod: application.amortizationMethod,
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

    const formId = `form_${application.id}`.slice(0, 128);
    const existingFormSnap = await getDoc(doc(db, 'formalizations', formId)).catch(() => null);
    if (!existingFormSnap?.exists()) {
      const { contractText, promissoryNoteText } = buildDefaultFormalizationContent({
        application,
        customer,
        approvedCapital,
        contractualRate,
        termMonths,
        firstPaymentDate: firstPayDate,
      });

      const autoForm: Omit<FormalizationRecord, 'createdAt' | 'updatedAt'> = {
        id: formId,
        organizationId: application.organizationId,
        applicationId: application.id,
        decisionId: voteDocId,
        approvedCapital,
        financedExpenses: 0,
        totalFinanced: approvedCapital,
        deductedExpenses: 0,
        netDisbursementAmount: approvedCapital,
        contractualRateMonthly: contractualRate,
        termMonths,
        frequency: application.paymentFrequency,
        amortizationMethod: application.amortizationMethod,
        disbursementTargetDate: disbTargetDate,
        firstPaymentDate: firstPayDate,
        maturityDate: schedule.maturityDate,
        totalContractualPayable: schedule.totalContractualPayable,
        contractTemplateVersion: 'tpl-v1.0-revision-legal',
        contractText: contractText.slice(0, 19500),
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
        collateralDetails: (application.proposedCollateral ?? '').slice(0, 1950),
        legalReviewConfirmed: false,
        promissoryNoteConfirmed: false,
        contractConfirmed: false,
        status: 'PENDIENTE',
        formalizedBy: user.uid,
        formalizedByName: user.displayName,
      };
      batch.set(
        doc(db, 'formalizations', formId),
        cleanObject({
          ...autoForm,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: application.organizationId,
      eventType: 'COMMITTEE_DECISION_IMMUTABLE',
      entityType: 'committee_decisions',
      entityId: voteDocId,
      action: `Comité resolvió (${voteEval.approveCount}/3) ${resolvedDecision} para ${application.applicationNumber}`,
      previousState: application.status,
      newState: nextAppStatus,
      justification:
        normalizedDecisionInput.observations ||
        normalizedDecisionInput.rejectionReason ||
        check.authorityUsed ||
        '',
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
    handleFirestoreError(err, OperationType.WRITE, `committee_decisions/${voteDocId}`);
  }

  await enqueueCustomerStatusEmail({
    application,
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

  if (!Number.isFinite(formalization.approvedCapital) || formalization.approvedCapital <= 0) {
    throw new Error('El capital aprobado para formalización debe ser mayor a cero.');
  }
  if (!Number.isFinite(formalization.netDisbursementAmount) || formalization.netDisbursementAmount <= 0) {
    throw new Error('El monto neto a entregar debe ser mayor a cero (revise los gastos descontados).');
  }
  if (formalization.totalFinanced < formalization.approvedCapital) {
    throw new Error('El total financiado no puede ser inferior al capital aprobado.');
  }

  const normalizedRate = normalizeMonthlyRateDecimal(formalization.contractualRateMonthly, 0.04);
  const promissoryConfirmed = Boolean(formalization.promissoryNoteConfirmed ?? formalization.legalReviewConfirmed);
  const contractConfirmed = Boolean(formalization.contractConfirmed ?? formalization.legalReviewConfirmed);
  const syncedLegalConfirmed = promissoryConfirmed && contractConfirmed;

  const syncedChecklist = (formalization.requiredDocsChecklist ?? []).slice(0, 25).map((item) => {
    if (item.key === 'promissory' && promissoryConfirmed) return { ...item, completed: true };
    if (item.key === 'contract_signed' && contractConfirmed) return { ...item, completed: true };
    if (item.key === 'schedule' && syncedLegalConfirmed) return { ...item, completed: true };
    return item;
  });

  const effectiveSignatures = (
    formalization.signatures.length > 0
      ? formalization.signatures
      : markReadyForDisbursement
      ? [
          {
            signerName: user.displayName,
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

  const formId = formalization.id.slice(0, 128);
  const formRef = doc(db, 'formalizations', formId);
  const existingSnap = await getDoc(formRef).catch(() => null);
  const targetStatus = markReadyForDisbursement ? 'LISTA_PARA_DESEMBOLSO' : 'PENDIENTE';

  const batch = writeBatch(db);
  if (markReadyForDisbursement) {
    const newHistory = appendMovementHistory(application.movementHistory, {
      timestamp: new Date().toISOString(),
      action: 'Expediente formalizado y habilitado para desembolso',
      fromStatus: application.status,
      toStatus: 'FORMALIZADA',
      userId: user.uid,
      userName: user.displayName,
    });
    await ensureApplicationPersistedInBatch({
      batch,
      application,
      user,
      updates: {
        status: 'FORMALIZADA',
        movementHistory: newHistory,
      },
    });
  }

  if (existingSnap?.exists()) {
    batch.update(
      formRef,
      cleanObject({
        financedExpenses: formalization.financedExpenses,
        totalFinanced: formalization.totalFinanced,
        deductedExpenses: formalization.deductedExpenses,
        netDisbursementAmount: formalization.netDisbursementAmount,
        disbursementTargetDate: formalization.disbursementTargetDate.slice(0, 20),
        firstPaymentDate: formalization.firstPaymentDate.slice(0, 20),
        maturityDate: formalization.maturityDate.slice(0, 20),
        totalContractualPayable: formalization.totalContractualPayable,
        contractText: formalization.contractText.slice(0, 19500),
        promissoryNoteText: formalization.promissoryNoteText.slice(0, 14500),
        requiredDocsChecklist: syncedChecklist,
        conditionsFulfilled: formalization.conditionsFulfilled,
        signatures: effectiveSignatures,
        collateralDetails: (formalization.collateralDetails ?? '').slice(0, 1950),
        legalReviewConfirmed: syncedLegalConfirmed,
        promissoryNoteConfirmed: promissoryConfirmed,
        contractConfirmed: contractConfirmed,
        status: targetStatus,
        updatedAt: serverTimestamp(),
      })
    );
  } else {
    batch.set(
      formRef,
      cleanObject({
        ...formalization,
        id: formId,
        contractualRateMonthly: normalizedRate,
        disbursementTargetDate: formalization.disbursementTargetDate.slice(0, 20),
        firstPaymentDate: formalization.firstPaymentDate.slice(0, 20),
        maturityDate: formalization.maturityDate.slice(0, 20),
        contractText: formalization.contractText.slice(0, 19500),
        promissoryNoteText: formalization.promissoryNoteText.slice(0, 14500),
        collateralDetails: (formalization.collateralDetails ?? '').slice(0, 1950),
        requiredDocsChecklist: syncedChecklist,
        signatures: effectiveSignatures,
        legalReviewConfirmed: syncedLegalConfirmed,
        promissoryNoteConfirmed: promissoryConfirmed,
        contractConfirmed: contractConfirmed,
        status: targetStatus,
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
      eventType: markReadyForDisbursement ? 'FORMALIZATION_COMPLETED' : 'FORMALIZATION_SAVED',
      entityType: 'formalizations',
      entityId: formId,
      action: `${markReadyForDisbursement ? 'Formalización completada' : 'Borrador formalización'} para ${application.applicationNumber}`,
      previousState: application.status,
      newState: markReadyForDisbursement ? 'FORMALIZADA' : application.status,
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
    handleFirestoreError(err, OperationType.WRITE, `formalizations/${formId}`);
  }

  if (markReadyForDisbursement) {
    await enqueueCustomerStatusEmail({
      application,
      eventCode: 'FORMALIZADA',
      fromStatus: application.status,
      toStatus: 'FORMALIZADA',
      historyLength: (application.movementHistory?.length ?? 0) + 1,
      user,
      approvedAmount: formalization.approvedCapital,
      approvedRateMonthly: normalizedRate,
      approvedTermMonths: formalization.termMonths,
    });
  } else if (formalization.signatures.length === 0) {
    await enqueueCustomerStatusEmail({
      application,
      eventCode: 'PENDIENTE_FIRMA',
      fromStatus: application.status,
      toStatus: 'PENDIENTE_FIRMA',
      historyLength: application.movementHistory?.length ?? 0,
      user,
      approvedAmount: formalization.approvedCapital,
      approvedRateMonthly: normalizedRate,
      approvedTermMonths: formalization.termMonths,
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

  let createdDisb!: DisbursementRecord;
  let createdLoan!: LoanRecord;

  try {
    await runTransaction(db, async (tx) => {
      const existingDisbSnap = await tx.get(disbRef);
      const appSnap = await tx.get(appRef);
      const formSnap = await tx.get(formRef);

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
        netDeliveredAmount: formalization.netDisbursementAmount,
        disbursementDate: cleanDisbDate,
        paymentMethod,
        financialEntity: cleanEntity.slice(0, 160),
        destinationAccountMasked: maskAccountNumber(destinationAccountRaw),
        referenceNumber: cleanRef.slice(0, 100),
        receiptNotes: receiptNotes.trim().slice(0, 1000),
        voucherFileName: voucherFile?.fileName?.slice(0, 240) ?? null,
        voucherMimeType: voucherFile?.mimeType?.slice(0, 120) ?? null,
        voucherDocumentId: voucherDocId,
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
        status: 'ACTIVO' as const,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      const newHistory = appendMovementHistory(freshApp.movementHistory, {
        timestamp: new Date().toISOString(),
        action: `Desembolso confirmado (${disbNumber}) y Préstamo creado (${loanNumber})`,
        fromStatus: freshApp.status,
        toStatus: 'DESEMBOLSADA',
        userId: user.uid,
        userName: user.displayName,
        note: `Ref: ${cleanRef} · Neto entregado: ${formalization.netDisbursementAmount}`,
      });

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
        priorityReasons: ['Préstamo recién desembolsado'],
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
      tx.update(appRef, {
        status: 'DESEMBOLSADA',
        movementHistory: newHistory,
        updatedAt: serverTimestamp(),
      });

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
          eventType: 'DISBURSEMENT_AND_LOAN_CREATED',
          entityType: 'loans',
          entityId: loanId,
          action: `Desembolso ${disbNumber} confirmado -> Préstamo ${loanNumber} (${schedule.rows.length} cuotas)`,
          previousState: 'FORMALIZADA',
          newState: 'DESEMBOLSADA / ACTIVO',
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
  primaryColor: string;
  accentColor: string;
  adminUser: UserProfile;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'organizations', params.organizationId), {
      name: params.name,
      taxId: params.taxId,
      primaryColor: params.primaryColor,
      accentColor: params.accentColor,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `organizations/${params.organizationId}`);
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
  const existing = snap?.exists() ? (snap.data() as OrganizationRecord) : null;

  const orgDoc: OrganizationRecord = cleanObject({
    ...SU_GLORIA_MANO_AMIGA_ORG,
    ...(existing || {}),
    id: SU_GLORIA_ORG_ID,
    organizationId: SU_GLORIA_ORG_ID,
    accessCode: existing?.accessCode || 'SGMA-001',
    name: 'SU GLORIA MANO AMIGA',
    tradeName: 'SU GLORIA MANO AMIGA',
    taxId: '1-31-98421-2',
    rnc: '1-31-98421-2',
    status: existing?.status || 'ACTIVA',
    planCode: existing?.planCode || 'CORPORATIVO',
    licenseStatus: existing?.licenseStatus || 'ACTIVA',
    enabledModules: existing?.enabledModules || existing?.modulesEnabled || SU_GLORIA_ENABLED_MODULES,
    modulesEnabled: existing?.modulesEnabled || existing?.enabledModules || SU_GLORIA_ENABLED_MODULES,
    primaryAdminUid: existing?.primaryAdminUid || actorUid || SU_GLORIA_MANO_AMIGA_ORG.primaryAdminUid,
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(orgRef, orgDoc, { merge: true }).catch((err) =>
    handleFirestoreError(err, OperationType.WRITE, `organizations/${SU_GLORIA_ORG_ID}`)
  );

  return orgDoc;
}

/**
 * Asocia y migra de manera controlada e idempotente registros de negocio existentes
 * (clientes, préstamos, pagos, cuotas, gestiones de cobranza) hacia 'SU GLORIA MANO AMIGA',
 * garantizando cero duplicación y preservando los IDs originales y metadatos.
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

  // Leer colecciones para garantizar asociación de registros sin organizationId o con 'org_default'
  const [custSnap, loanSnap, paySnap, instSnap, actSnap] = await Promise.all([
    getDocs(collection(db, 'customers')).catch(() => null),
    getDocs(collection(db, 'loans')).catch(() => null),
    getDocs(collection(db, 'payments')).catch(() => null),
    getDocs(collection(db, 'loan_installments')).catch(() => null),
    getDocs(collection(db, 'collection_actions')).catch(() => null),
  ]);

  let migratedCustomers = 0;
  let migratedLoans = 0;
  let migratedPayments = 0;
  let migratedInstallments = 0;
  let migratedActions = 0;

  const batch = writeBatch(db);
  let batchOps = 0;

  const processDocs = (
    docs: Array<{ id: string; data: () => Record<string, unknown>; ref: ReturnType<typeof doc> }>,
    counterCallback: () => void
  ) => {
    for (const d of docs) {
      const data = d.data();
      const rawOrg = typeof data.organizationId === 'string' ? data.organizationId.trim() : '';
      if (!rawOrg || rawOrg === 'org_default') {
        batch.update(d.ref, { organizationId: SU_GLORIA_ORG_ID, updatedAt: serverTimestamp() });
        batchOps++;
        counterCallback();
      }
    }
  };

  if (custSnap && !custSnap.empty) {
    processDocs(custSnap.docs, () => migratedCustomers++);
  }
  if (loanSnap && !loanSnap.empty) {
    processDocs(loanSnap.docs, () => migratedLoans++);
  }
  if (paySnap && !paySnap.empty) {
    processDocs(paySnap.docs, () => migratedPayments++);
  }
  if (instSnap && !instSnap.empty) {
    processDocs(instSnap.docs, () => migratedInstallments++);
  }
  if (actSnap && !actSnap.empty) {
    processDocs(actSnap.docs, () => migratedActions++);
  }

  if (batchOps > 0) {
    await batch.commit().catch(() => {});
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



