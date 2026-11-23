import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { hasRolePermission } from '../engine/rbac';
import {
  buildDefaultImpulsaConfig,
  detectImpulsaOpportunities,
  type DetectImpulsaInput,
  type DetectImpulsaResult,
} from '../engine/impulsa/impulsaEngine';
import {
  DEFAULT_ORG_ID,
  generateId,
  recordCriticalAuditEvent,
  submitOrSaveApplication,
} from './axycoreStore';
import type {
  AmortizationMethod,
  ApplicationRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanRecord,
  PaymentFrequency,
  ProductCode,
  ScoringExecutionRecord,
  UserProfile,
} from '../types/axycore';
import {
  IMPULSA_CATEGORY_LABELS,
  IMPULSA_STATUS_LABELS,
  type ImpulsaContactChannel,
  type ImpulsaEngineConfig,
  type ImpulsaEngineRunLog,
  type ImpulsaFollowUpEntry,
  type ImpulsaOpportunityRecord,
  type ImpulsaOpportunityStatus,
} from '../types/impulsa';

function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function assertStaffOrg(user: UserProfile): string {
  if (!user || !user.uid) {
    throw new Error('Usuario no autenticado para operar en Impulsa.');
  }
  if (user.role === 'EXTERNAL_CLIENT') {
    throw new Error('Acceso denegado: clientes externos no tienen acceso a Impulsa.');
  }
  return user.organizationId || DEFAULT_ORG_ID;
}

export async function runAndPersistImpulsaDetection(params: {
  user: UserProfile;
  trigger: 'MANUAL' | 'PROGRAMADO';
  input: Omit<DetectImpulsaInput, 'organizationId' | 'actorId'>;
}): Promise<{
  result: DetectImpulsaResult;
  runLog: ImpulsaEngineRunLog;
}> {
  const orgId = assertStaffOrg(params.user);
  if (
    params.trigger === 'MANUAL' &&
    !hasRolePermission(params.user.role, 'MANAGE_IMPULSA') &&
    !hasRolePermission(params.user.role, 'CONFIGURE_IMPULSA')
  ) {
    throw new Error('Tu rol no tiene permiso para ejecutar el detector de Impulsa.');
  }

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  const result = detectImpulsaOpportunities({
    ...params.input,
    organizationId: orgId,
    actorId: params.user.uid,
    nowIso,
  });

  // Persist created, updated, and reconciled opportunities in chunked batches
  const toPersistMap = new Map<string, ImpulsaOpportunityRecord>();
  for (const item of [...result.updated, ...result.reconciled, ...result.created]) {
    toPersistMap.set(item.id, item);
  }
  const toPersist = Array.from(toPersistMap.values());
  const createdIdSet = new Set(result.created.map((c) => c.id));

  for (let i = 0; i < toPersist.length; i += 350) {
    const chunk = toPersist.slice(i, i + 350);
    const batch = writeBatch(db);
    for (const opp of chunk) {
      const ref = doc(db, 'impulsa_opportunities', opp.id);
      const clean = stripUndefined({
        ...opp,
        organizationId: orgId,
        followUpHistory: (opp.followUpHistory || []).slice(-40),
        updatedAt: serverTimestamp(),
        ...(createdIdSet.has(opp.id) ? { createdAt: serverTimestamp() } : {}),
      });
      batch.set(ref, clean, { merge: true });
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'impulsa_opportunities');
    }
  }

  const runLog: ImpulsaEngineRunLog = {
    id: generateId('imp_run'),
    executedAtIso: nowIso,
    trigger: params.trigger,
    actorId: params.user.uid,
    actorName: params.user.displayName || params.user.email || 'Usuario AxyCore',
    customersAnalyzed: result.customersAnalyzed,
    loansAnalyzed: result.loansAnalyzed,
    detectedTotal: result.opportunities.length,
    createdCount: result.created.length,
    updatedCount: result.updated.length,
    reconciledCount: result.reconciled.length,
    autoAssignedCount: result.autoAssignedCount,
    skippedByRiskCount: result.skippedByRiskCount,
    durationMs: Math.max(1, Date.now() - startedAt),
  };

  // Update config run history (keep latest 25 runs)
  const baseCfg = params.input.config || buildDefaultImpulsaConfig(orgId);
  const updatedConfig: ImpulsaEngineConfig = stripUndefined({
    ...baseCfg,
    id: orgId,
    organizationId: orgId,
    lastRunAtIso: nowIso,
    recentRuns: [runLog, ...(baseCfg.recentRuns || [])].slice(0, 25),
    updatedBy: params.user.uid,
    updatedByName: params.user.displayName || params.user.email || 'Usuario AxyCore',
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'impulsa_configs', orgId), updatedConfig, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `impulsa_configs/${orgId}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_DETECTION_RUN',
    entityType: 'impulsa_configs',
    entityId: orgId,
    action: `Ejecución Motor Impulsa (${params.trigger}): ${result.created.length} nuevas, ${result.updated.length} actualizadas, ${result.reconciled.length} conciliadas`,
    newState: JSON.stringify({
      customersAnalyzed: result.customersAnalyzed,
      loansAnalyzed: result.loansAnalyzed,
      created: result.created.length,
      reconciled: result.reconciled.length,
    }),
  });

  return { result, runLog };
}

export async function assignImpulsaOpportunity(params: {
  user: UserProfile;
  opportunity: ImpulsaOpportunityRecord;
  targetOfficer: { uid: string; displayName: string };
  reason: string;
}): Promise<void> {
  const orgId = assertStaffOrg(params.user);
  if (params.opportunity.organizationId !== orgId) {
    throw new Error('Aislamiento multi-tenant: la oportunidad pertenece a otra institución.');
  }

  const isReassignment = Boolean(
    params.opportunity.assignedOfficerId &&
      params.opportunity.assignedOfficerId !== params.targetOfficer.uid
  );

  const canManageAssignment = hasRolePermission(params.user.role, 'ASSIGN_IMPULSA');
  const isSelfClaimingUnassigned =
    !params.opportunity.assignedOfficerId &&
    params.targetOfficer.uid === params.user.uid &&
    hasRolePermission(params.user.role, 'MANAGE_IMPULSA');

  if (isReassignment && !canManageAssignment) {
    throw new Error(
      `Bloqueo anti-colisión: esta oportunidad ya pertenece a ${params.opportunity.assignedOfficerName || 'otro oficial'}. Solo un supervisor o administrador puede reasignarla.`
    );
  }
  if (!isSelfClaimingUnassigned && !canManageAssignment) {
    throw new Error('Tu rol no tiene permiso para asignar oportunidades a otros oficiales.');
  }

  const nowIso = new Date().toISOString();
  const nextStatus: ImpulsaOpportunityStatus =
    params.opportunity.status === 'DETECTADA' ||
    params.opportunity.status === 'PENDIENTE_ASIGNACION'
      ? 'ASIGNADA'
      : params.opportunity.status;

  const entry: ImpulsaFollowUpEntry = {
    id: generateId('imp_fu'),
    timestampIso: nowIso,
    actorId: params.user.uid,
    actorName: params.user.displayName || params.user.email || 'Usuario AxyCore',
    actorRole: params.user.role,
    channel: 'INTERNO',
    previousStatus: params.opportunity.status,
    newStatus: nextStatus,
    outcome: isReassignment ? 'Reasignación de responsable' : 'Asignación de responsable',
    comment:
      params.reason.trim() ||
      `Asignada a ${params.targetOfficer.displayName} con exclusividad operativa.`,
    nextFollowUpDate: params.opportunity.nextFollowUpDate ?? null,
  };

  const nextHistory = [...(params.opportunity.followUpHistory || []), entry].slice(-40);

  try {
    await updateDoc(
      doc(db, 'impulsa_opportunities', params.opportunity.id),
      stripUndefined({
        assignedOfficerId: params.targetOfficer.uid,
        assignedOfficerName: params.targetOfficer.displayName,
        assignedAtIso: nowIso,
        assignedBy: params.user.uid,
        assignmentLockReason:
          params.reason.trim() ||
          `Asignada exclusivamente a ${params.targetOfficer.displayName}`,
        status: nextStatus,
        followUpHistory: nextHistory,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `impulsa_opportunities/${params.opportunity.id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_OPPORTUNITY_ASSIGNED',
    entityType: 'impulsa_opportunities',
    entityId: params.opportunity.id,
    action: `${isReassignment ? 'Reasignación' : 'Asignación'} Impulsa ${params.opportunity.opportunityCode} -> ${params.targetOfficer.displayName}`,
    previousState: params.opportunity.assignedOfficerName || 'Sin asignar',
    newState: params.targetOfficer.displayName,
    justification: params.reason.trim() || null,
  });
}

export async function logImpulsaFollowUpAndTransition(params: {
  user: UserProfile;
  opportunity: ImpulsaOpportunityRecord;
  newStatus: ImpulsaOpportunityStatus;
  channel: ImpulsaContactChannel;
  outcome: string;
  comment: string;
  nextFollowUpDate?: string | null;
}): Promise<void> {
  const orgId = assertStaffOrg(params.user);
  if (params.opportunity.organizationId !== orgId) {
    throw new Error('Aislamiento multi-tenant: la oportunidad pertenece a otra institución.');
  }
  if (!hasRolePermission(params.user.role, 'MANAGE_IMPULSA')) {
    throw new Error('Tu rol no tiene permiso para gestionar oportunidades en Impulsa.');
  }

  // Prevent collision: if assigned to another officer and current user cannot reassign, block edit
  const canOverrideOwner = hasRolePermission(params.user.role, 'ASSIGN_IMPULSA');
  if (
    params.opportunity.assignedOfficerId &&
    params.opportunity.assignedOfficerId !== params.user.uid &&
    !canOverrideOwner
  ) {
    throw new Error(
      `Esta oportunidad está asignada a ${params.opportunity.assignedOfficerName}. Solicita reasignación a un supervisor para gestionarla.`
    );
  }

  const nowIso = new Date().toISOString();
  const actorName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const entry: ImpulsaFollowUpEntry = {
    id: generateId('imp_fu'),
    timestampIso: nowIso,
    actorId: params.user.uid,
    actorName,
    actorRole: params.user.role,
    channel: params.channel,
    previousStatus: params.opportunity.status,
    newStatus: params.newStatus,
    outcome: params.outcome.trim() || IMPULSA_STATUS_LABELS[params.newStatus],
    comment: params.comment.trim() || 'Seguimiento comercial registrado.',
    nextFollowUpDate: params.nextFollowUpDate || null,
  };

  const nextHistory = [...(params.opportunity.followUpHistory || []), entry].slice(-40);
  const autoClaimOwner = !params.opportunity.assignedOfficerId;

  try {
    await updateDoc(
      doc(db, 'impulsa_opportunities', params.opportunity.id),
      stripUndefined({
        status: params.newStatus,
        lastContactAtIso: params.channel !== 'INTERNO' ? nowIso : params.opportunity.lastContactAtIso ?? nowIso,
        lastOutcome: entry.outcome,
        nextFollowUpDate: params.nextFollowUpDate || null,
        followUpHistory: nextHistory,
        ...(autoClaimOwner
          ? {
              assignedOfficerId: params.user.uid,
              assignedOfficerName: actorName,
              assignedAtIso: nowIso,
              assignedBy: params.user.uid,
            }
          : {}),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `impulsa_opportunities/${params.opportunity.id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_FOLLOWUP_LOGGED',
    entityType: 'impulsa_opportunities',
    entityId: params.opportunity.id,
    action: `Gestión Impulsa ${params.opportunity.opportunityCode}: ${params.opportunity.status} -> ${params.newStatus} (${params.channel})`,
    previousState: params.opportunity.status,
    newState: params.newStatus,
    justification: params.comment.trim() || null,
  });
}

export async function convertImpulsaOpportunityToApplication(params: {
  user: UserProfile;
  opportunity: ImpulsaOpportunityRecord;
  customer: CustomerRecord;
  latestCustomerApplication?: ApplicationRecord;
  policy: CreditPolicyRecord;
  productCode: ProductCode;
  requestedAmount: number;
  requestedTermMonths: number;
  paymentFrequency: PaymentFrequency;
  amortizationMethod: AmortizationMethod;
  loanPurposeNote?: string;
  submitMode: 'SUBMIT' | 'DRAFT';
}): Promise<{
  application: ApplicationRecord;
  scoring?: ScoringExecutionRecord;
}> {
  const orgId = assertStaffOrg(params.user);
  if (params.opportunity.organizationId !== orgId || params.customer.organizationId !== orgId) {
    throw new Error('Aislamiento multi-tenant: discrepancia de organización.');
  }
  if (
    !hasRolePermission(params.user.role, 'CONVERT_IMPULSA') &&
    !hasRolePermission(params.user.role, 'ORIGINATE_APPLICATION')
  ) {
    throw new Error('Tu rol no tiene permiso para convertir oportunidades de Impulsa en solicitudes.');
  }
  if (params.opportunity.linkedApplicationId) {
    throw new Error(
      `Esta oportunidad ya fue convertida en la solicitud ${params.opportunity.linkedApplicationNumber || params.opportunity.linkedApplicationId}.`
    );
  }

  const productCfg = params.policy.products[params.productCode];
  if (!productCfg) {
    throw new Error(`El producto ${params.productCode} no existe en la política vigente.`);
  }

  const now = new Date();
  const appId = generateId('app');
  const suffix = String(Date.now()).slice(-6);
  const applicationNumber = `SOL-${now.getFullYear()}-${suffix}`;
  const fileNumber = `EXP-${now.getFullYear()}-${suffix}`;
  const isBusinessProduct =
    params.productCode === 'EMPRESARIAL_DOP' || params.productCode === 'EMPRESARIAL_USD';

  const prevApp = params.latestCustomerApplication;
  const actorName = params.user.displayName || params.user.email || 'Oficial Impulsa';

  const financialData = prevApp?.verifiedFinancialData || prevApp?.financialData || {
    activityType: 'INGRESO_EXISTENTE_CARTERA',
    employerOrBusinessName: '',
    incomeSourceType: 'FIJA_RECURRENTE' as const,
    primaryNetIncome: params.opportunity.estimatedPaymentCapacity > 0
      ? Math.round(params.opportunity.estimatedPaymentCapacity * 2.5)
      : null,
    additionalIncomeStatus: 'EXPLICIT_NONE' as const,
    additionalNetIncome: 0,
    incomeCurrency: productCfg.currency,
    essentialExpenses: 0,
    housingPayment: params.customer.housingPayment ?? 0,
    housingIncludedInExpenses: false,
    debtDeclarationStatus: 'NO_DEBTS_EXPLICIT' as const,
    currentDebtPayments: 0,
  };

  const purposeText =
    params.loanPurposeNote?.trim() ||
    `Originada desde Impulsa (${params.opportunity.opportunityCode} · ${IMPULSA_CATEGORY_LABELS[params.opportunity.category]})`;

  const newApplication: ApplicationRecord = {
    id: appId,
    organizationId: orgId,
    applicationNumber,
    fileNumber,
    channel: 'INTERNAL',
    applicantType: isBusinessProduct ? 'BUSINESS' : 'INDIVIDUAL',
    customerId: params.customer.id, // Reuses existing customer — zero duplication
    businessId: isBusinessProduct ? prevApp?.businessId ?? null : null,
    applicantDisplayName: params.opportunity.customerName,
    productCode: params.productCode,
    currency: productCfg.currency,
    requestedAmount: Number(params.requestedAmount) || params.opportunity.suggestedAmount,
    requestedTermMonths: Number(params.requestedTermMonths) || params.opportunity.suggestedTermMonths,
    paymentFrequency: params.paymentFrequency,
    amortizationMethod: params.amortizationMethod,
    loanPurpose: IMPULSA_CATEGORY_LABELS[params.opportunity.category],
    loanPurposeDescription: purposeText,
    proposedCollateral: prevApp?.proposedCollateral || '',
    financialData,
    businessFinancialData: isBusinessProduct ? prevApp?.businessFinancialData ?? null : null,
    references: prevApp?.references || [],
    declaredDocumentsSummary: prevApp?.declaredDocumentsSummary || {
      hasIdentityDoc: Boolean(params.customer.documentNumber),
      hasIncomeEvidence: Boolean(financialData.primaryNetIncome),
    },
    status: 'BORRADOR',
    assignedTo: params.opportunity.assignedOfficerId || params.user.uid,
    assignedToName: params.opportunity.assignedOfficerName || actorName,
    movementHistory: [
      {
        timestamp: now.toISOString(),
        action: `Solicitud generada desde Impulsa (${params.opportunity.opportunityCode} · ${IMPULSA_CATEGORY_LABELS[params.opportunity.category]})`,
        fromStatus: 'IMPULSA',
        toStatus: params.submitMode === 'DRAFT' ? 'BORRADOR' : 'RECIBIDA',
        userId: params.user.uid,
        userName: actorName,
        userRole: params.user.role,
        note: purposeText,
      },
    ],
    createdBy: params.user.uid,
    createdByName: actorName,
  };

  const submitResult = await submitOrSaveApplication({
    application: newApplication,
    customer: params.customer,
    policy: params.policy,
    mode: params.submitMode,
    user: params.user,
    consentText: `Solicitud originada desde AxyCore Impulsa (${params.opportunity.opportunityCode}) con consentimiento comercial del cliente para evaluación en Motor V2.`,
  });

  const nowIso = new Date().toISOString();
  const nextOppStatus: ImpulsaOpportunityStatus =
    submitResult.application.status === 'EN_EVALUACION'
      ? 'EN_EVALUACION'
      : 'CONVERTIDA_SOLICITUD';

  const conversionEntry: ImpulsaFollowUpEntry = {
    id: generateId('imp_fu'),
    timestampIso: nowIso,
    actorId: params.user.uid,
    actorName,
    actorRole: params.user.role,
    channel: 'INTERNO',
    previousStatus: params.opportunity.status,
    newStatus: nextOppStatus,
    outcome: `Convertida en solicitud ${submitResult.application.applicationNumber}`,
    comment: `Enviada al flujo oficial de AxyCore (${submitResult.application.status})${
      submitResult.scoring ? ` · Score Motor V2: ${submitResult.scoring.totalScore}/100` : ''
    }.`,
    nextFollowUpDate: null,
  };

  const autoAssignOnConvert = !params.opportunity.assignedOfficerId;
  try {
    await updateDoc(
      doc(db, 'impulsa_opportunities', params.opportunity.id),
      stripUndefined({
        status: nextOppStatus,
        linkedApplicationId: submitResult.application.id,
        linkedApplicationNumber: submitResult.application.applicationNumber,
        linkedApplicationStatus: submitResult.application.status,
        convertedAtIso: nowIso,
        convertedBy: params.user.uid,
        lastOutcome: conversionEntry.outcome,
        ...(autoAssignOnConvert
          ? {
              assignedOfficerId: params.user.uid,
              assignedOfficerName: actorName,
              assignedAtIso: nowIso,
              assignedBy: params.user.uid,
            }
          : {}),
        followUpHistory: [...(params.opportunity.followUpHistory || []), conversionEntry].slice(-40),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `impulsa_opportunities/${params.opportunity.id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_CONVERTED_TO_APPLICATION',
    entityType: 'impulsa_opportunities',
    entityId: params.opportunity.id,
    action: `Oportunidad Impulsa ${params.opportunity.opportunityCode} convertida en solicitud ${submitResult.application.applicationNumber}`,
    previousState: params.opportunity.status,
    newState: nextOppStatus,
    justification: purposeText,
  });

  return {
    application: submitResult.application,
    scoring: submitResult.scoring,
  };
}

export async function saveImpulsaConfig(params: {
  user: UserProfile;
  config: ImpulsaEngineConfig;
}): Promise<void> {
  const orgId = assertStaffOrg(params.user);
  if (!hasRolePermission(params.user.role, 'CONFIGURE_IMPULSA')) {
    throw new Error('Tu rol no tiene permiso para modificar parámetros y automatización de Impulsa.');
  }

  const payload: ImpulsaEngineConfig = stripUndefined({
    ...params.config,
    id: orgId,
    organizationId: orgId,
    requireExplicitConsentForExternalContact: true, // Always enforced
    recentRuns: (params.config.recentRuns || []).slice(0, 25),
    updatedBy: params.user.uid,
    updatedByName: params.user.displayName || params.user.email || 'Administrador',
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'impulsa_configs', orgId), payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `impulsa_configs/${orgId}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_CONFIG_UPDATED',
    entityType: 'impulsa_configs',
    entityId: orgId,
    action: `Parámetros de Impulsa actualizados (frecuencia: ${payload.frequency}, asignación: ${payload.assignmentStrategy})`,
    newState: JSON.stringify({
      enabled: payload.enabled,
      frequency: payload.frequency,
      assignmentStrategy: payload.assignmentStrategy,
      unmanagedAlertHours: payload.unmanagedAlertHours,
    }),
  });
}

export function resolveExpectedStatusFromAxyCore(params: {
  opportunity: ImpulsaOpportunityRecord;
  application?: ApplicationRecord | null;
  loan?: LoanRecord | null;
}): {
  expectedStatus: ImpulsaOpportunityStatus;
  expectedAppStatus: string | null;
  expectedLoanId: string | null;
  expectedLoanNumber: string | null;
  expectedDisbursedAmount: number | null;
  needsSync: boolean;
} {
  const { opportunity, application, loan } = params;
  if (!application && !loan) {
    return {
      expectedStatus: opportunity.status,
      expectedAppStatus: opportunity.linkedApplicationStatus ?? null,
      expectedLoanId: opportunity.linkedLoanId ?? null,
      expectedLoanNumber: opportunity.linkedLoanNumber ?? null,
      expectedDisbursedAmount: opportunity.disbursedAmount ?? null,
      needsSync: false,
    };
  }

  let expectedStatus: ImpulsaOpportunityStatus = opportunity.status;
  let expectedLoanId = opportunity.linkedLoanId ?? null;
  let expectedLoanNumber = opportunity.linkedLoanNumber ?? null;
  let expectedDisbursedAmount = opportunity.disbursedAmount ?? null;
  const expectedAppStatus = application?.status ?? opportunity.linkedApplicationStatus ?? null;

  if (application?.status === 'DESEMBOLSADA' || loan) {
    expectedStatus = 'DESEMBOLSADA';
    expectedLoanId = loan?.id || expectedLoanId;
    expectedLoanNumber = loan?.loanNumber || expectedLoanNumber;
    expectedDisbursedAmount =
      loan?.approvedPrincipal ??
      loan?.totalFinancedPrincipal ??
      application?.requestedAmount ??
      expectedDisbursedAmount;
  } else if (
    application?.status === 'APROBADA' ||
    application?.status === 'APROBADA_CONDICIONADA' ||
    application?.status === 'FORMALIZADA'
  ) {
    expectedStatus = 'APROBADA';
  } else if (
    application?.status === 'EN_EVALUACION' ||
    application?.status === 'EN_COMITE' ||
    application?.status === 'RECIBIDA'
  ) {
    expectedStatus = 'EN_EVALUACION';
  } else if (application?.status === 'RECHAZADA') {
    expectedStatus = 'DESCARTADA';
  } else if (application?.status === 'BORRADOR' || application?.status === 'DEVUELTA') {
    expectedStatus = 'CONVERTIDA_SOLICITUD';
  }

  const needsSync =
    expectedStatus !== opportunity.status ||
    expectedAppStatus !== (opportunity.linkedApplicationStatus ?? null) ||
    expectedLoanId !== (opportunity.linkedLoanId ?? null) ||
    expectedLoanNumber !== (opportunity.linkedLoanNumber ?? null);

  return {
    expectedStatus,
    expectedAppStatus,
    expectedLoanId,
    expectedLoanNumber,
    expectedDisbursedAmount,
    needsSync,
  };
}

export async function syncImpulsaLifecycleWithAxyCore(params: {
  user: UserProfile;
  opportunities: ImpulsaOpportunityRecord[];
  applications: ApplicationRecord[];
  loans: LoanRecord[];
}): Promise<{ syncedCount: number; syncedCodes: string[] }> {
  const orgId = assertStaffOrg(params.user);
  if (!hasRolePermission(params.user.role, 'MANAGE_IMPULSA')) {
    throw new Error('Tu rol no tiene permiso para sincronizar estados de Impulsa.');
  }

  const appsById = new Map(params.applications.map((a) => [a.id, a]));
  const loansByAppId = new Map<string, LoanRecord>();
  for (const loan of params.loans) {
    if (loan.applicationId) loansByAppId.set(loan.applicationId, loan);
  }

  const nowIso = new Date().toISOString();
  const actorName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const toUpdate: Array<{
    opp: ImpulsaOpportunityRecord;
    sync: ReturnType<typeof resolveExpectedStatusFromAxyCore>;
  }> = [];

  for (const opp of params.opportunities) {
    if (opp.organizationId !== orgId || !opp.linkedApplicationId) continue;
    const app = appsById.get(opp.linkedApplicationId) || null;
    const loan = loansByAppId.get(opp.linkedApplicationId) || null;
    const sync = resolveExpectedStatusFromAxyCore({ opportunity: opp, application: app, loan });
    if (sync.needsSync) {
      toUpdate.push({ opp, sync });
    }
  }

  if (toUpdate.length === 0) {
    return { syncedCount: 0, syncedCodes: [] };
  }

  const syncedCodes: string[] = [];
  for (let i = 0; i < toUpdate.length; i += 350) {
    const chunk = toUpdate.slice(i, i + 350);
    const batch = writeBatch(db);
    for (const { opp, sync } of chunk) {
      syncedCodes.push(opp.opportunityCode);
      const entry: ImpulsaFollowUpEntry = {
        id: generateId('imp_fu'),
        timestampIso: nowIso,
        actorId: params.user.uid,
        actorName,
        actorRole: params.user.role,
        channel: 'INTERNO',
        previousStatus: opp.status,
        newStatus: sync.expectedStatus,
        outcome: `Sincronizado con AxyCore (${sync.expectedAppStatus || sync.expectedStatus})`,
        comment: sync.expectedLoanNumber
          ? `Préstamo real desembolsado: ${sync.expectedLoanNumber} (${opp.currency} ${sync.expectedDisbursedAmount ?? 0}).`
          : `Estado real de solicitud ${opp.linkedApplicationNumber || opp.linkedApplicationId}: ${sync.expectedAppStatus}.`,
        nextFollowUpDate: null,
      };
      batch.update(
        doc(db, 'impulsa_opportunities', opp.id),
        stripUndefined({
          status: sync.expectedStatus,
          linkedApplicationStatus: sync.expectedAppStatus,
          linkedLoanId: sync.expectedLoanId,
          linkedLoanNumber: sync.expectedLoanNumber,
          disbursedAmount: sync.expectedDisbursedAmount,
          lastOutcome: entry.outcome,
          lastEvaluatedAtIso: nowIso,
          followUpHistory: [...(opp.followUpHistory || []), entry].slice(-40),
          updatedAt: serverTimestamp(),
        })
      );
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'impulsa_opportunities');
    }
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'IMPULSA_AXYCORE_SYNC',
    entityType: 'impulsa_opportunities',
    entityId: orgId,
    action: `Sincronización de trazabilidad Impulsa ↔ AxyCore (${syncedCodes.length} oportunidad(es): ${syncedCodes.slice(0, 6).join(', ')})`,
    newState: JSON.stringify({ syncedCount: syncedCodes.length, syncedCodes }),
  });

  return { syncedCount: syncedCodes.length, syncedCodes };
}
