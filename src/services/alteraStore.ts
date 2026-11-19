import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { hasRolePermission } from '../engine/rbac';
import { buildDefaultAlteraConfig } from '../engine/altera/alteraTwinAndDnaEngine';
import { generateId, recordCriticalAuditEvent, DEFAULT_ORG_ID } from './axycoreStore';
import type { UserProfile } from '../types/axycore';
import type {
  AlteraAnalysisLogRecord,
  AlteraConfigRecord,
  AlteraOutcomeRecord,
  AlteraRecommendationFollowUp,
  AlteraRecommendationRecord,
  AlteraRecommendationStatus,
  AlteraSavedScenarioRecord,
} from '../types/altera';

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

function assertStaffOrganization(user: UserProfile): string {
  if (!user || !user.uid) {
    throw new Error('Usuario no autenticado para operar en ALTERA.');
  }
  if (user.role === 'EXTERNAL_CLIENT') {
    throw new Error('Acceso denegado: Clientes externos no tienen acceso a ALTERA.');
  }
  return user.organizationId || DEFAULT_ORG_ID;
}

const VALID_TRANSITIONS: Record<AlteraRecommendationStatus, AlteraRecommendationStatus[]> = {
  GENERADA: ['PENDIENTE_REVISION', 'APROBADA', 'RECHAZADA', 'CERRADA'],
  PENDIENTE_REVISION: ['APROBADA', 'RECHAZADA', 'CERRADA'],
  APROBADA: ['EN_EJECUCION', 'EJECUTADA', 'CERRADA'],
  RECHAZADA: ['CERRADA'],
  EN_EJECUCION: ['EJECUTADA', 'CERRADA'],
  EJECUTADA: ['CERRADA'],
  CERRADA: [],
};

export async function saveAlteraScenario(params: {
  user: UserProfile;
  scenario: Omit<
    AlteraSavedScenarioRecord,
    'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
  >;
}): Promise<AlteraSavedScenarioRecord> {
  const orgId = assertStaffOrganization(params.user);
  if (!hasRolePermission(params.user.role, 'SIMULATE_ALTERA')) {
    throw new Error('Tu rol no tiene permiso para guardar escenarios simulados en ALTERA.');
  }

  const id = generateId('alt_scn');
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const payload: AlteraSavedScenarioRecord = stripUndefined({
    ...params.scenario,
    id,
    organizationId: orgId,
    createdBy: params.user.uid,
    createdByName: displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'altera_scenarios', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `altera_scenarios/${id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'ALTERA_SCENARIO_SAVED',
    entityType: 'altera_scenarios',
    entityId: id,
    action: `Escenario ALTERA guardado (${payload.loanNumber} · ${payload.interventionType})`,
    newState: JSON.stringify({
      loanId: payload.loanId,
      recommendedUniverseCode: payload.recommendedUniverseCode,
      projectedRecoveryPct: payload.projectedRecoveryPct,
      policyCompliant: payload.policyCompliant,
    }),
    engineVersion: 'ALTERA_V1',
  });

  return {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function createAlteraRecommendation(params: {
  user: UserProfile;
  initialStatus?: 'GENERADA' | 'PENDIENTE_REVISION';
  recommendation: Omit<
    AlteraRecommendationRecord,
    | 'id'
    | 'organizationId'
    | 'code'
    | 'createdAtIso'
    | 'status'
    | 'followUpHistory'
    | 'createdBy'
    | 'createdByName'
    | 'createdAt'
    | 'updatedAt'
  >;
  initialNotes?: string;
}): Promise<AlteraRecommendationRecord> {
  const orgId = assertStaffOrganization(params.user);
  if (!hasRolePermission(params.user.role, 'PROPOSE_ALTERA_INTERVENTION')) {
    throw new Error('Tu rol no tiene permiso para generar o proponer intervenciones en ALTERA.');
  }

  const id = generateId('alt_rec');
  const nowIso = new Date().toISOString();
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const status: 'GENERADA' | 'PENDIENTE_REVISION' =
    params.initialStatus === 'PENDIENTE_REVISION' ? 'PENDIENTE_REVISION' : 'GENERADA';
  const code = `ALT-${nowIso.slice(2, 10).replace(/-/g, '')}-${id.slice(-4).toUpperCase()}`;

  const firstHistory: AlteraRecommendationFollowUp = {
    timestampIso: nowIso,
    userId: params.user.uid,
    userName: displayName,
    userRole: params.user.role,
    fromStatus: 'NUEVA',
    toStatus: status,
    notes:
      params.initialNotes?.trim() ||
      (status === 'PENDIENTE_REVISION'
        ? 'Recomendación generada por ALTERA y enviada a revisión humana.'
        : 'Recomendación generada en borrador analítico por ALTERA.'),
  };

  const payload: AlteraRecommendationRecord = stripUndefined({
    ...params.recommendation,
    id,
    organizationId: orgId,
    code,
    createdAtIso: nowIso,
    status,
    followUpHistory: [firstHistory],
    createdBy: params.user.uid,
    createdByName: displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'altera_recommendations', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `altera_recommendations/${id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'ALTERA_RECOMMENDATION_CREATED',
    entityType: 'altera_recommendations',
    entityId: id,
    action: `Recomendación ALTERA ${code} (${status}) para préstamo ${payload.loanNumber}`,
    newState: JSON.stringify({
      code,
      status,
      priority: payload.priority,
      interventionType: payload.interventionType,
      loanId: payload.loanId,
    }),
    justification: firstHistory.notes,
    engineVersion: 'ALTERA_V1',
  });

  return {
    ...payload,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function transitionAlteraRecommendationStatus(params: {
  user: UserProfile;
  recommendation: AlteraRecommendationRecord;
  nextStatus: AlteraRecommendationStatus;
  notes?: string;
}): Promise<AlteraRecommendationRecord> {
  const orgId = assertStaffOrganization(params.user);
  const { recommendation, nextStatus } = params;

  if (recommendation.organizationId !== orgId) {
    throw new Error('Aislamiento multiempresa: la recomendación pertenece a otra organización.');
  }

  const allowedTargets = VALID_TRANSITIONS[recommendation.status] || [];
  if (!allowedTargets.includes(nextStatus)) {
    throw new Error(
      `Transición de estado inválida en ALTERA: ${recommendation.status} → ${nextStatus}.`
    );
  }

  if (nextStatus === 'PENDIENTE_REVISION') {
    if (!hasRolePermission(params.user.role, 'PROPOSE_ALTERA_INTERVENTION')) {
      throw new Error('Tu rol no tiene permiso para enviar recomendaciones a revisión.');
    }
  } else {
    if (!hasRolePermission(params.user.role, 'APPROVE_ALTERA_INTERVENTION')) {
      throw new Error(
        'Aprobación humana obligatoria: tu rol no cuenta con facultad APPROVE_ALTERA_INTERVENTION.'
      );
    }
  }

  const nowIso = new Date().toISOString();
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const cleanNote =
    params.notes?.trim() ||
    `Cambio de estado ${recommendation.status} → ${nextStatus} autorizado por ${displayName}.`;

  const entry: AlteraRecommendationFollowUp = {
    timestampIso: nowIso,
    userId: params.user.uid,
    userName: displayName,
    userRole: params.user.role,
    fromStatus: recommendation.status,
    toStatus: nextStatus,
    notes: cleanNote,
  };

  const nextHistory = [...(recommendation.followUpHistory || []), entry].slice(-40);
  const isFormalDecision = nextStatus === 'APROBADA' || nextStatus === 'RECHAZADA';

  const patch = stripUndefined({
    status: nextStatus,
    followUpHistory: nextHistory,
    ...(isFormalDecision
      ? {
          decisionByUserId: params.user.uid,
          decisionByUserName: displayName,
          decisionNotes: cleanNote,
        }
      : {}),
    updatedAt: serverTimestamp(),
  });

  try {
    await updateDoc(doc(db, 'altera_recommendations', recommendation.id), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `altera_recommendations/${recommendation.id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: `ALTERA_RECOMMENDATION_${nextStatus}`,
    entityType: 'altera_recommendations',
    entityId: recommendation.id,
    action: `Recomendación ${recommendation.code} pasó de ${recommendation.status} a ${nextStatus}`,
    previousState: recommendation.status,
    newState: nextStatus,
    justification: cleanNote,
    engineVersion: 'ALTERA_V1',
  });

  return {
    ...recommendation,
    status: nextStatus,
    followUpHistory: nextHistory,
    ...(isFormalDecision
      ? {
          decisionByUserId: params.user.uid,
          decisionByUserName: displayName,
          decisionNotes: cleanNote,
        }
      : {}),
    updatedAt: nowIso,
  };
}

export async function saveAlteraOutcomeCalibration(params: {
  user: UserProfile;
  outcome: Omit<
    AlteraOutcomeRecord,
    'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
  >;
}): Promise<AlteraOutcomeRecord> {
  const orgId = assertStaffOrganization(params.user);
  if (!hasRolePermission(params.user.role, 'PROPOSE_ALTERA_INTERVENTION')) {
    throw new Error('Tu rol no tiene permiso para registrar calibración de resultados ALTERA.');
  }

  const id = generateId('alt_out');
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const payload: AlteraOutcomeRecord = stripUndefined({
    ...params.outcome,
    id,
    organizationId: orgId,
    createdBy: params.user.uid,
    createdByName: displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'altera_outcomes', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `altera_outcomes/${id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'ALTERA_OUTCOME_CALIBRATED',
    entityType: 'altera_outcomes',
    entityId: id,
    action: `Evaluación post-intervención ${payload.recommendationCode} · Efectividad ${payload.effectivenessScore}%`,
    newState: JSON.stringify({
      recommendationId: payload.recommendationId,
      effectivenessScore: payload.effectivenessScore,
      calibrationDeltaPct: payload.calibrationDeltaPct,
      commitmentFulfilled: payload.commitmentFulfilled,
    }),
    justification: payload.learningConclusion,
    engineVersion: 'ALTERA_V1',
  });

  return {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function logAlteraAnalysisHistory(params: {
  user: UserProfile;
  entry: Omit<
    AlteraAnalysisLogRecord,
    'id' | 'organizationId' | 'actorUid' | 'actorName' | 'actorRole' | 'createdAtIso' | 'createdAt'
  >;
}): Promise<AlteraAnalysisLogRecord | null> {
  const orgId = assertStaffOrganization(params.user);
  // El rol AUDITOR es estrictamente de solo lectura: ejecuta consultas en memoria sin persistir escrituras.
  if (params.user.role === 'AUDITOR') {
    return null;
  }

  const id = generateId('alt_log');
  const nowIso = new Date().toISOString();
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';
  const payload: AlteraAnalysisLogRecord = stripUndefined({
    ...params.entry,
    id,
    organizationId: orgId,
    actorUid: params.user.uid,
    actorName: displayName,
    actorRole: params.user.role,
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'altera_analyses', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `altera_analyses/${id}`);
  }

  return {
    ...payload,
    createdAt: nowIso,
  };
}

export async function saveAlteraConfig(params: {
  user: UserProfile;
  config: Partial<
    Omit<
      AlteraConfigRecord,
      | 'id'
      | 'organizationId'
      | 'requireHumanApprovalForAllInterventions'
      | 'updatedBy'
      | 'updatedByName'
      | 'createdAt'
      | 'updatedAt'
    >
  >;
  existingConfig?: AlteraConfigRecord | null;
}): Promise<AlteraConfigRecord> {
  const orgId = assertStaffOrganization(params.user);
  if (!hasRolePermission(params.user.role, 'MANAGE_ALTERA_CONFIG')) {
    throw new Error('Tu rol no tiene permiso para modificar los parámetros de ALTERA.');
  }

  const id = `altera_cfg_${orgId}`;
  const defaults = buildDefaultAlteraConfig(orgId);
  const base = params.existingConfig && params.existingConfig.organizationId === orgId
    ? params.existingConfig
    : defaults;
  const displayName = params.user.displayName || params.user.email || 'Usuario AxyCore';

  const nextWeights = {
    delayTrendWeight: Number(
      params.config.deteriorationWeights?.delayTrendWeight ?? base.deteriorationWeights.delayTrendWeight
    ),
    brokenPromisesWeight: Number(
      params.config.deteriorationWeights?.brokenPromisesWeight ??
        base.deteriorationWeights.brokenPromisesWeight
    ),
    overdueRatioWeight: Number(
      params.config.deteriorationWeights?.overdueRatioWeight ?? base.deteriorationWeights.overdueRatioWeight
    ),
    behavioralShiftWeight: Number(
      params.config.deteriorationWeights?.behavioralShiftWeight ??
        base.deteriorationWeights.behavioralShiftWeight
    ),
  };

  const payload: AlteraConfigRecord = stripUndefined({
    ...base,
    ...params.config,
    id,
    organizationId: orgId,
    deteriorationWeights: nextWeights,
    requireHumanApprovalForAllInterventions: true,
    updatedBy: params.user.uid,
    updatedByName: displayName,
    createdAt: base.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'altera_configs', id), payload, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `altera_configs/${id}`);
  }

  await recordCriticalAuditEvent({
    user: params.user,
    eventType: 'ALTERA_CONFIG_UPDATED',
    entityType: 'altera_configs',
    entityId: id,
    action: `Parámetros operativos y pesos de deterioro ALTERA actualizados`,
    previousState: JSON.stringify({
      earlyDeteriorationDelayThresholdDays: base.earlyDeteriorationDelayThresholdDays,
      maxRestructureExtensionMonths: base.maxRestructureExtensionMonths,
      calibrationFactorPct: base.calibrationFactorPct,
    }),
    newState: JSON.stringify({
      earlyDeteriorationDelayThresholdDays: payload.earlyDeteriorationDelayThresholdDays,
      maxRestructureExtensionMonths: payload.maxRestructureExtensionMonths,
      calibrationFactorPct: payload.calibrationFactorPct,
    }),
    engineVersion: 'ALTERA_V1',
  });

  return {
    ...payload,
    updatedAt: new Date().toISOString(),
  };
}
