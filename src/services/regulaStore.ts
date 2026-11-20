import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { DEFAULT_ORG_ID, generateId } from './axycoreStore';
import { buildDefaultRegulaConfig, resolveUserRegulaRole } from '../engine/regulaEngine';
import type { UserProfile } from '../types/axycore';
import type {
  RegulaAiConsultaRecord,
  RegulaAlertaRecord,
  RegulaAprobacionRecord,
  RegulaBaseRecord,
  RegulaCollectionName,
  RegulaConfiguracionRecord,
  RegulaEvidenciaRecord,
  RegulaHistorialRecord,
  RegulaNotificacionRecord,
  RegulaWorkspaceData,
} from '../types/regula';

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

export function getRegulaCollectionRef(organizationId: string, col: RegulaCollectionName) {
  return collection(db, 'regula_tenants', organizationId, col);
}

export function getRegulaDocRef(organizationId: string, col: RegulaCollectionName, docId: string) {
  return doc(db, 'regula_tenants', organizationId, col, docId);
}

export function assertRegulaActor(user: UserProfile | null | undefined, organizationId?: string): {
  uid: string;
  displayName: string;
  orgId: string;
} {
  if (!user || !user.uid) {
    throw new Error('Debes iniciar sesión para operar en AxyCore REGULA.');
  }
  if (user.role === 'EXTERNAL_CLIENT') {
    throw new Error('Acceso denegado: clientes externos no tienen acceso a AxyCore REGULA.');
  }
  const orgId = organizationId || user.organizationId || DEFAULT_ORG_ID;
  return {
    uid: user.uid,
    displayName: user.displayName || user.email || 'Usuario AxyCore',
    orgId,
  };
}

export async function appendRegulaHistory(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  entityType: RegulaCollectionName | 'regula_system';
  entityId: string;
  entityCode?: string;
  action: string;
  previousSummary?: string;
  newSummary?: string;
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const roleDef = resolveUserRegulaRole(params.user, params.config);
  const id = generateId('rghist');
  const nowIso = new Date().toISOString();
  const payload: RegulaHistorialRecord = stripUndefined({
    id,
    organizationId: actor.orgId,
    entityType: params.entityType,
    entityId: params.entityId,
    entityCode: params.entityCode,
    action: params.action,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: roleDef?.name || params.user.role,
    previousSummary: params.previousSummary,
    newSummary: params.newSummary,
    timestampIso: nowIso,
    createdBy: actor.uid,
    createdByName: actor.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await setDoc(getRegulaDocRef(actor.orgId, 'regula_historial', id), payload);
  } catch (err) {
    console.warn('No se pudo registrar historial REGULA:', err);
  }
}

export async function recordRegulaApproval(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  entityType: RegulaCollectionName;
  entityId: string;
  entityCode?: string;
  approvalAction: RegulaAprobacionRecord['approvalAction'];
  decision: 'APROBADO' | 'RECHAZADO';
  justification: string;
}): Promise<RegulaAprobacionRecord> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const roleDef = resolveUserRegulaRole(params.user, params.config);
  const id = generateId('rgapr');
  const nowIso = new Date().toISOString();
  const payload: RegulaAprobacionRecord = stripUndefined({
    id,
    organizationId: actor.orgId,
    entityType: params.entityType,
    entityId: params.entityId,
    entityCode: params.entityCode,
    approvalAction: params.approvalAction,
    decision: params.decision,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: roleDef?.name || params.user.role,
    justification: params.justification.trim() || 'Aprobación formal registrada en REGULA.',
    timestampIso: nowIso,
    createdBy: actor.uid,
    createdByName: actor.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await setDoc(getRegulaDocRef(actor.orgId, 'regula_aprobaciones', id), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `regula_tenants/${actor.orgId}/regula_aprobaciones/${id}`);
  }
  await appendRegulaHistory({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    entityType: params.entityType,
    entityId: params.entityId,
    entityCode: params.entityCode,
    action: `${params.approvalAction} (${params.decision})`,
    newSummary: payload.justification,
  });
  return { ...payload, createdAt: nowIso, updatedAt: nowIso };
}

export async function createRegulaEntity<T extends RegulaBaseRecord>(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  collectionName: RegulaCollectionName;
  prefix: string;
  data: Omit<T, 'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'>;
  auditAction: string;
  entityCode?: string;
  customId?: string;
}): Promise<T> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const id = params.customId || generateId(params.prefix);
  const nowIso = new Date().toISOString();

  const payload = stripUndefined({
    ...params.data,
    id,
    organizationId: actor.orgId,
    createdBy: actor.uid,
    createdByName: actor.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(getRegulaDocRef(actor.orgId, params.collectionName, id), payload);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `regula_tenants/${actor.orgId}/${params.collectionName}/${id}`
    );
  }

  if (params.collectionName !== 'regula_historial' && params.collectionName !== 'regula_aprobaciones') {
    await appendRegulaHistory({
      user: params.user,
      organizationId: actor.orgId,
      config: params.config,
      entityType: params.collectionName,
      entityId: id,
      entityCode: params.entityCode,
      action: params.auditAction,
      newSummary: params.entityCode || id,
    });
  }

  return {
    ...(payload as unknown as T),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function updateRegulaEntity<T extends RegulaBaseRecord>(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  collectionName: RegulaCollectionName;
  id: string;
  patch: Partial<Omit<T, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>>;
  auditAction: string;
  entityCode?: string;
  previousSummary?: string;
  newSummary?: string;
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const payload = stripUndefined({
    ...params.patch,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });

  try {
    await updateDoc(getRegulaDocRef(actor.orgId, params.collectionName, params.id), payload);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `regula_tenants/${actor.orgId}/${params.collectionName}/${params.id}`
    );
  }

  await appendRegulaHistory({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    entityType: params.collectionName,
    entityId: params.id,
    entityCode: params.entityCode,
    action: params.auditAction,
    previousSummary: params.previousSummary,
    newSummary: params.newSummary,
  });
}

export async function softDeleteRegulaEntity(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  collectionName: RegulaCollectionName;
  id: string;
  entityCode?: string;
  reason: string;
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const nowIso = new Date().toISOString();
  await updateRegulaEntity({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    collectionName: params.collectionName,
    id: params.id,
    entityCode: params.entityCode,
    patch: {
      deletedAt: nowIso,
      deletedBy: actor.uid,
      deleteReason: params.reason.trim() || 'Anulación lógica registrada por usuario autorizado.',
    },
    auditAction: 'ANULACION_LOGICA',
    newSummary: params.reason,
  });
}

export async function saveRegulaConfiguration(params: {
  user: UserProfile;
  organizationId: string;
  institutionName?: string;
  existingConfig: RegulaConfiguracionRecord | null;
  updates: Partial<RegulaConfiguracionRecord>;
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const docId = `regula_cfg_${actor.orgId}`;
  const defaults = buildDefaultRegulaConfig({
    organizationId: actor.orgId,
    institutionName: params.institutionName,
    createdBy: actor.uid,
  });

  if (!params.existingConfig) {
    const merged: RegulaConfiguracionRecord = stripUndefined({
      ...defaults,
      ...params.updates,
      id: docId,
      organizationId: actor.orgId,
      createdBy: actor.uid,
      createdByName: actor.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(getRegulaDocRef(actor.orgId, 'regula_configuracion', docId), merged);
  } else {
    const patch = stripUndefined({
      ...params.updates,
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(getRegulaDocRef(actor.orgId, 'regula_configuracion', params.existingConfig.id), patch);
  }

  await appendRegulaHistory({
    user: params.user,
    organizationId: actor.orgId,
    config: params.existingConfig,
    entityType: 'regula_configuracion',
    entityId: params.existingConfig?.id || docId,
    entityCode: 'CONFIG_REGULA',
    action: 'ACTUALIZACION_CONFIGURACION',
    newSummary: 'Parámetros institucionales de AxyCore REGULA actualizados.',
  });
}

export async function syncRegulaAlertAndNotification(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  existingAlerts: RegulaAlertaRecord[];
  alert: Omit<RegulaAlertaRecord, 'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'>;
}): Promise<boolean> {
  const alreadyExists = params.existingAlerts.some(
    (a) => !a.deletedAt && a.dedupKey === params.alert.dedupKey && a.status !== 'DESCARTADA'
  );
  if (alreadyExists) return false;

  const actor = assertRegulaActor(params.user, params.organizationId);
  const created = await createRegulaEntity<RegulaAlertaRecord>({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    collectionName: 'regula_alertas',
    prefix: 'rgalt',
    data: params.alert,
    auditAction: 'ALERTA_GENERADA',
    entityCode: params.alert.alertType,
  });

  // Also record internal notification in regula_notificaciones (deduplicated by dedupKey)
  await createRegulaEntity<RegulaNotificacionRecord>({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    collectionName: 'regula_notificaciones',
    prefix: 'rgnot',
    data: {
      dedupKey: params.alert.dedupKey,
      recipientUid: actor.uid,
      recipientRole: params.user.role,
      title: params.alert.title,
      message: params.alert.description,
      severity: params.alert.severity,
      channel: 'INTERNA_AXYCORE',
      deliveryStatus: 'ENTREGADA_INTERNA',
      read: false,
      targetSection: params.alert.targetSection,
      relatedEntityId: created.id,
    },
    auditAction: 'NOTIFICACION_INTERNA_REGULA',
    entityCode: params.alert.alertType,
  });

  // Feed AxyCore central notifications collection (deduplicated deterministic docId) without failing if rules differ
  try {
    const safeKey = params.alert.dedupKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const notifId = `regula_${actor.uid.slice(0, 20)}_${safeKey}`;
    await setDoc(
      doc(db, 'notifications', notifId),
      stripUndefined({
        id: notifId,
        organizationId: actor.orgId,
        userId: actor.uid,
        ackKey: `regula_${params.alert.dedupKey}`,
        alertType: 'EVENTO_CRITICO_BITACORA',
        category: 'RIESGO',
        priority: params.alert.severity === 'CRITICA' ? 'INMEDIATA' : params.alert.severity === 'ALTA' ? 'ALTA' : 'MEDIA',
        title: `[REGULA] ${params.alert.title}`.slice(0, 180),
        subtitle: params.alert.alertType,
        detail: params.alert.description.slice(0, 600),
        primarySection: 'regula',
        read: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
  } catch {
    // Non-blocking sync to AxyCore central notification center
  }

  return true;
}

export async function logEvidenceDownloadAndOpen(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  evidence: RegulaEvidenciaRecord;
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const nowIso = new Date().toISOString();
  await updateRegulaEntity<RegulaEvidenciaRecord>({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    collectionName: 'regula_evidencias',
    id: params.evidence.id,
    entityCode: params.evidence.code,
    patch: {
      downloadCount: (params.evidence.downloadCount || 0) + 1,
      lastAccessedBy: actor.displayName,
      lastAccessedAt: nowIso,
    },
    auditAction: 'CONSULTA_DESCARGA_EVIDENCIA',
    newSummary: `Descarga/consulta de ${params.evidence.fileName} (${params.evidence.version})`,
  });

  if (params.evidence.fileDataUrl) {
    const a = document.createElement('a');
    a.href = params.evidence.fileDataUrl;
    a.download = params.evidence.fileName || `${params.evidence.code}.bin`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export async function readFileAsBoundedDataUrl(file: File, maxInlineBytes = 420_000): Promise<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileDataUrl?: string;
  truncatedNote?: string;
}> {
  if (file.size > maxInlineBytes) {
    return {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      truncatedNote: `Archivo mayor a ${Math.round(maxInlineBytes / 1024)} KB: metadatos y versión registrados; adjunta un PDF/imagen compacto (≤${Math.round(maxInlineBytes / 1024)} KB) para almacenamiento binario directo en Firestore.`,
    };
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    fileDataUrl: dataUrl,
  };
}

export async function recordRegulaAiQuery(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  entry: Omit<
    RegulaAiConsultaRecord,
    'id' | 'organizationId' | 'actorUid' | 'actorName' | 'actorRole' | 'timestampIso' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
  >;
}): Promise<RegulaAiConsultaRecord> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const roleDef = resolveUserRegulaRole(params.user, params.config);
  const nowIso = new Date().toISOString();
  return createRegulaEntity<RegulaAiConsultaRecord>({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    collectionName: 'regula_ai_consultas',
    prefix: 'rgai',
    data: {
      ...params.entry,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: roleDef?.name || params.user.role,
      timestampIso: nowIso,
    },
    auditAction: `CONSULTA_REGULA_AI_${params.entry.mode}`,
    entityCode: params.entry.mode,
  });
}

export async function validateRegulaAiQuery(params: {
  user: UserProfile;
  organizationId: string;
  config?: RegulaConfiguracionRecord | null;
  queryId: string;
  status: 'VALIDADA_APLICADA' | 'DESCARTADA';
}): Promise<void> {
  const actor = assertRegulaActor(params.user, params.organizationId);
  const nowIso = new Date().toISOString();
  await updateDoc(getRegulaDocRef(actor.orgId, 'regula_ai_consultas', params.queryId), {
    humanValidationStatus: params.status,
    validatedBy: actor.uid,
    validatedByName: actor.displayName,
    validatedAt: nowIso,
    updatedAt: serverTimestamp(),
  });
  await appendRegulaHistory({
    user: params.user,
    organizationId: actor.orgId,
    config: params.config,
    entityType: 'regula_ai_consultas',
    entityId: params.queryId,
    action: `VALIDACION_HUMANA_IA_${params.status}`,
    newSummary: `Validado por ${actor.displayName}`,
  });
}

export function createEmptyRegulaWorkspaceData(): RegulaWorkspaceData {
  return {
    config: null,
    normativas: [],
    normativaVersiones: [],
    obligaciones: [],
    aplicabilidad: [],
    calendario: [],
    responsables: [],
    kyc: [],
    debidaDiligencia: [],
    beneficiariosFinales: [],
    perfilesRiesgo: [],
    casosPlaft: [],
    riesgos: [],
    evaluacionesRiesgo: [],
    controles: [],
    pruebasControl: [],
    auditorias: [],
    programasAuditoria: [],
    hallazgos: [],
    evidencias: [],
    documentos: [],
    incidentes: [],
    planesAccion: [],
    actividades: [],
    capacitaciones: [],
    participantes: [],
    evaluacionesCapacitacion: [],
    alertas: [],
    notificaciones: [],
    aprobaciones: [],
    historial: [],
    aiConsultas: [],
  };
}

export function subscribeToRegulaWorkspace(
  organizationId: string,
  onUpdate: (updater: (prev: RegulaWorkspaceData) => RegulaWorkspaceData) => void,
  onError?: (err: Error) => void
): () => void {
  const mappings: Array<{ col: RegulaCollectionName; key: keyof RegulaWorkspaceData; isSingleton?: boolean }> = [
    { col: 'regula_configuracion', key: 'config', isSingleton: true },
    { col: 'regula_normativas', key: 'normativas' },
    { col: 'regula_normativa_versiones', key: 'normativaVersiones' },
    { col: 'regula_obligaciones', key: 'obligaciones' },
    { col: 'regula_aplicabilidad', key: 'aplicabilidad' },
    { col: 'regula_calendario', key: 'calendario' },
    { col: 'regula_responsables', key: 'responsables' },
    { col: 'regula_kyc', key: 'kyc' },
    { col: 'regula_debida_diligencia', key: 'debidaDiligencia' },
    { col: 'regula_beneficiarios_finales', key: 'beneficiariosFinales' },
    { col: 'regula_perfiles_riesgo', key: 'perfilesRiesgo' },
    { col: 'regula_casos_plaft', key: 'casosPlaft' },
    { col: 'regula_matriz_riesgos', key: 'riesgos' },
    { col: 'regula_evaluaciones_riesgo', key: 'evaluacionesRiesgo' },
    { col: 'regula_controles', key: 'controles' },
    { col: 'regula_pruebas_control', key: 'pruebasControl' },
    { col: 'regula_auditorias', key: 'auditorias' },
    { col: 'regula_programas_auditoria', key: 'programasAuditoria' },
    { col: 'regula_hallazgos', key: 'hallazgos' },
    { col: 'regula_evidencias', key: 'evidencias' },
    { col: 'regula_documentos', key: 'documentos' },
    { col: 'regula_incidentes', key: 'incidentes' },
    { col: 'regula_planes_accion', key: 'planesAccion' },
    { col: 'regula_actividades', key: 'actividades' },
    { col: 'regula_capacitaciones', key: 'capacitaciones' },
    { col: 'regula_participantes', key: 'participantes' },
    { col: 'regula_evaluaciones_capacitacion', key: 'evaluacionesCapacitacion' },
    { col: 'regula_alertas', key: 'alertas' },
    { col: 'regula_notificaciones', key: 'notificaciones' },
    { col: 'regula_aprobaciones', key: 'aprobaciones' },
    { col: 'regula_historial', key: 'historial' },
    { col: 'regula_ai_consultas', key: 'aiConsultas' },
  ];

  const unsubs = mappings.map(({ col, key, isSingleton }) =>
    onSnapshot(
      getRegulaCollectionRef(organizationId, col),
      (snap) => {
        const docs = snap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
        onUpdate((prev) => ({
          ...prev,
          [key]: isSingleton ? (docs[0] ?? null) : docs,
        }));
      },
      (err) => {
        if (onError) onError(err);
      }
    )
  );

  return () => {
    for (const u of unsubs) u();
  };
}
