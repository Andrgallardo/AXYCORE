import type { ApplicationRecord, ApplicationStatus, NavSectionId } from '../types/axycore';
import {
  APPLICATION_STATUS_LABELS,
  formatMoney,
  PRODUCT_LABELS,
  sanitizeIdSegment,
} from '../utils/formatters';

export type InboxPushEventType =
  | 'NEW_INBOX_APPLICATION'
  | 'EVALUATION_STARTED'
  | 'COMMITTEE_ESCALATION'
  | 'APPLICATION_APPROVED'
  | 'APPLICATION_APPROVED_CONDITIONED'
  | 'RETURNED_APPLICATION'
  | 'APPLICATION_REJECTED'
  | 'APPLICATION_FORMALIZED'
  | 'APPLICATION_DISBURSED';

export type PushAudience = 'STAFF' | 'CLIENT';

export interface InboxPushPayload {
  eventType: InboxPushEventType;
  ackKey: string;
  priority: 'INMEDIATA' | 'ALTA';
  targetSection: NavSectionId;
  title: string;
  body: string;
  data: Record<string, string>;
}

export const ALL_TRACKED_PUSH_STATUSES: ApplicationStatus[] = [
  'RECIBIDA',
  'EN_EVALUACION',
  'DEVUELTA',
  'EN_COMITE',
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'RECHAZADA',
  'FORMALIZADA',
  'DESEMBOLSADA',
];

export const CRITICAL_APPLICATION_STATUSES: Set<ApplicationStatus> = new Set(
  ALL_TRACKED_PUSH_STATUSES
);

/**
 * Normaliza una clave VAPID proveniente de variables de entorno (.env), eliminando comillas o espacios.
 */
export function normalizeVapidKey(raw: string | undefined | null): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

/**
 * Convierte una clave pública VAPID en formato Base64URL (RFC 8292) a Uint8Array
 * compatible con PushManager.subscribe({ applicationServerKey }).
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const cleaned = normalizeVapidKey(base64String);
  if (!cleaned) {
    throw new Error('La clave pública VAPID está vacía.');
  }

  const padding = '='.repeat((4 - (cleaned.length % 4)) % 4);
  const base64 = (cleaned + padding).replace(/-/g, '+').replace(/_/g, '/');

  let rawData: string;
  if (typeof atob === 'function') {
    rawData = atob(base64);
  } else if (typeof Buffer !== 'undefined') {
    rawData = Buffer.from(base64, 'base64').toString('binary');
  } else {
    throw new Error('No se encontró decodificador Base64 en este entorno.');
  }

  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Valida que una clave pública VAPID decodifique correctamente a un punto P-256 sin comprimir
 * (65 bytes iniciando con el byte 0x04 según RFC 8292 / Web Push).
 */
export function isValidVapidPublicKey(raw: string | undefined | null): boolean {
  const cleaned = normalizeVapidKey(raw);
  if (cleaned.length < 60 || !/^[A-Za-z0-9\-_]+={0,2}$/.test(cleaned)) {
    return false;
  }
  try {
    const bytes = urlBase64ToUint8Array(cleaned);
    return bytes.length === 65 && bytes[0] === 0x04;
  } catch {
    return false;
  }
}

/**
 * Determina si una transición de estado en una solicitud corresponde a un cambio que requiere notificación Web Push.
 */
export function shouldTriggerApplicationCriticalPush(
  prevStatus: string | undefined | null,
  nextStatus: string | undefined | null
): boolean {
  if (!nextStatus || prevStatus === nextStatus) return false;
  return CRITICAL_APPLICATION_STATUSES.has(nextStatus as ApplicationStatus);
}

/**
 * Determina si una transición de estado en una solicitud debe disparar notificación Web Push al equipo de crédito del Inbox.
 * (Mantenido para compatibilidad).
 */
export function shouldTriggerInboxPush(
  prevStatus: string | undefined | null,
  nextStatus: string | undefined | null
): boolean {
  if (!nextStatus) return false;
  if (nextStatus === 'RECIBIDA' && prevStatus !== 'RECIBIDA') return true;
  if (nextStatus === 'DEVUELTA' && prevStatus !== 'DEVUELTA') return true;
  if (nextStatus === 'EN_COMITE' && prevStatus !== 'EN_COMITE') return true;
  return false;
}

/**
 * Construye el payload homogéneo para notificaciones Web Push (VAPID / FCM) ante cambios de estado
 * en solicitudes de crédito, adaptado al perfil del destinatario (equipo interno o cliente).
 */
export function buildApplicationCriticalPushPayload(
  app: Pick<
    ApplicationRecord,
    | 'id'
    | 'applicationNumber'
    | 'applicantDisplayName'
    | 'channel'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'status'
  >,
  options?: {
    prevStatus?: string | null;
    audience?: PushAudience;
  }
): InboxPushPayload {
  const audience: PushAudience = options?.audience === 'CLIENT' ? 'CLIENT' : 'STAFF';
  const prevStatus = options?.prevStatus || '';
  const channelLabel = app.channel === 'EXTERNAL' ? 'Canal Externo' : 'Canal Interno';
  const productLabel = PRODUCT_LABELS[app.productCode] ?? app.productCode;
  const amountText = formatMoney(app.requestedAmount, app.currency);
  const ackKey = `${app.id}:${app.status}`;
  const statusLabel = APPLICATION_STATUS_LABELS[app.status] ?? app.status;
  const prevStatusLabel =
    prevStatus && prevStatus in APPLICATION_STATUS_LABELS
      ? APPLICATION_STATUS_LABELS[prevStatus as ApplicationStatus]
      : prevStatus;

  let eventType: InboxPushEventType;
  let priority: 'INMEDIATA' | 'ALTA';
  let targetSection: NavSectionId;
  let title: string;

  switch (app.status) {
    case 'RECIBIDA':
      eventType = 'NEW_INBOX_APPLICATION';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'applications';
      title =
        audience === 'CLIENT'
          ? 'Solicitud de Crédito Recibida'
          : `Nueva solicitud en Inbox (${channelLabel})`;
      break;
    case 'EN_EVALUACION':
      eventType = 'EVALUATION_STARTED';
      priority = 'ALTA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'evaluation';
      title =
        audience === 'CLIENT'
          ? 'Tu solicitud entró en Evaluación Crediticia'
          : 'Solicitud en Evaluación Crediticia y Riesgo';
      break;
    case 'EN_COMITE':
      eventType = 'COMMITTEE_ESCALATION';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'committee';
      title =
        audience === 'CLIENT'
          ? 'Tu solicitud fue escalada a Comité de Crédito'
          : 'Expediente enviado a Comité de Crédito';
      break;
    case 'APROBADA':
      eventType = 'APPLICATION_APPROVED';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'formalization';
      title =
        audience === 'CLIENT'
          ? '¡Tu Crédito fue Aprobado!'
          : '¡Crédito Aprobado por Comité!';
      break;
    case 'APROBADA_CONDICIONADA':
      eventType = 'APPLICATION_APPROVED_CONDITIONED';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'formalization';
      title =
        audience === 'CLIENT'
          ? 'Crédito Aprobado con Condiciones'
          : 'Crédito Aprobado con Condiciones Especiales';
      break;
    case 'DEVUELTA':
      eventType = 'RETURNED_APPLICATION';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'applications';
      title =
        audience === 'CLIENT'
          ? 'Tu solicitud requiere información adicional'
          : 'Solicitud devuelta requiere atención';
      break;
    case 'RECHAZADA':
      eventType = 'APPLICATION_REJECTED';
      priority = 'ALTA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'applications';
      title =
        audience === 'CLIENT'
          ? 'Actualización de tu solicitud de crédito'
          : 'Dictamen de Crédito: Solicitud No Aprobada';
      break;
    case 'FORMALIZADA':
      eventType = 'APPLICATION_FORMALIZED';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'disbursements';
      title =
        audience === 'CLIENT'
          ? 'Tu expediente de crédito fue Formalizado'
          : 'Expediente Formalizado · Listo para Desembolso';
      break;
    case 'DESEMBOLSADA':
      eventType = 'APPLICATION_DISBURSED';
      priority = 'INMEDIATA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'loans';
      title =
        audience === 'CLIENT'
          ? '¡Tu préstamo ha sido Desembolsado!'
          : '¡Préstamo Desembolsado con Éxito!';
      break;
    default:
      eventType = 'NEW_INBOX_APPLICATION';
      priority = 'ALTA';
      targetSection = audience === 'CLIENT' ? 'dashboard' : 'applications';
      title = `Actualización de crédito (${statusLabel})`;
      break;
  }

  const transitionSuffix =
    prevStatusLabel && prevStatusLabel !== statusLabel
      ? ` · ${prevStatusLabel} → ${statusLabel}`
      : ` · Estado: ${statusLabel}`;

  const body =
    audience === 'CLIENT'
      ? `Solicitud ${app.applicationNumber} (${amountText} · ${productLabel})${transitionSuffix}`
      : `${app.applicationNumber} · ${app.applicantDisplayName} · ${amountText} (${productLabel})${transitionSuffix}`;

  const clickAction = `/?applicationId=${encodeURIComponent(app.id)}&section=${encodeURIComponent(targetSection)}`;

  return {
    eventType,
    ackKey,
    priority,
    targetSection,
    title,
    body,
    data: {
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      applicantDisplayName: app.applicantDisplayName,
      channel: app.channel,
      status: app.status,
      previousStatus: prevStatus,
      audience,
      eventType,
      priority,
      targetSection,
      ackKey,
      title,
      body,
      clickAction,
    },
  };
}

/**
 * Alias de compatibilidad hacia atrás para buildApplicationCriticalPushPayload.
 */
export function buildInboxPushPayload(
  app: Pick<
    ApplicationRecord,
    | 'id'
    | 'applicationNumber'
    | 'applicantDisplayName'
    | 'channel'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'status'
  >
): InboxPushPayload {
  return buildApplicationCriticalPushPayload(app);
}

/**
 * Genera un ID determinístico para almacenar un token FCM en Firestore respetando ^[a-zA-Z0-9_\-]+$ y max 128 chars.
 */
export function buildFcmTokenDocId(userId: string, token: string): string {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) + hash + token.charCodeAt(i)) >>> 0;
  }
  const safeUid = sanitizeIdSegment(userId).slice(0, 48);
  const hex = hash.toString(16).padStart(8, '0');
  const suffix = sanitizeIdSegment(token.slice(-12)).slice(0, 12) || 'tok';
  return `fcm_${safeUid}_${hex}_${suffix}`;
}

/**
 * Genera un ID determinístico para almacenar una suscripción Web Push VAPID en Firestore
 * respetando ^[a-zA-Z0-9_\-]+$ y max 128 chars.
 */
export function buildPushSubscriptionDocId(userId: string, endpoint: string): string {
  let hash = 5381;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) + hash + endpoint.charCodeAt(i)) >>> 0;
  }
  const safeUid = sanitizeIdSegment(userId).slice(0, 48);
  const hex = hash.toString(16).padStart(8, '0');
  const suffix = sanitizeIdSegment(endpoint.slice(-14)).slice(0, 12) || 'sub';
  return `push_${safeUid}_${hex}_${suffix}`;
}
