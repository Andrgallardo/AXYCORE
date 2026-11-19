import {
  ALL_TRACKED_PUSH_STATUSES,
  buildApplicationCriticalPushPayload,
  buildPushSubscriptionDocId,
  isValidVapidPublicKey,
  normalizeVapidKey,
  shouldTriggerApplicationCriticalPush,
  urlBase64ToUint8Array,
  type InboxPushPayload,
} from '../engine/pushPayload';
import {
  registerFcmDeviceToken,
  sendClientWebPushNotification,
  unregisterFcmDeviceToken,
} from '../firebase/messaging';
import type {
  ApplicationRecord,
  ApplicationStatus,
  FcmPushStatus,
  PushDeliveryMode,
  UserProfile,
} from '../types/axycore';

export interface SerializedWebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidPushSubscribeResult {
  status: FcmPushStatus;
  subscriptionId?: string;
  subscription?: SerializedWebPushSubscription;
  fcmToken?: string | null;
  vapidPublicKeyPrefix?: string;
  deliveryMode?: PushDeliveryMode;
  message?: string;
}

export interface DispatchStatusPushResult {
  dispatched: boolean;
  deliveredViaWebPush: number;
  deliveredViaRelay: number;
  matchedSubscriptions: number;
  payload?: InboxPushPayload;
  reason?: string;
}

/**
 * Obtiene la clave pública VAPID definida en .env (VITE_FIREBASE_VAPID_KEY o VITE_VAPID_PUBLIC_KEY).
 */
export function getEnvVapidPublicKey(): string {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const fromFirebaseVar = normalizeVapidKey(metaEnv.VITE_FIREBASE_VAPID_KEY);
  if (fromFirebaseVar) return fromFirebaseVar;
  const fromGenericVar = normalizeVapidKey(metaEnv.VITE_VAPID_PUBLIC_KEY);
  if (fromGenericVar) return fromGenericVar;
  return '';
}

/**
 * Resuelve la clave pública VAPID desde .env en cliente y, si no está inyectada, consulta el endpoint del servidor.
 */
export async function resolveVapidPublicKey(): Promise<string> {
  const localKey = getEnvVapidPublicKey();
  if (localKey) return localKey;

  if (typeof fetch === 'undefined') return '';
  try {
    const resp = await fetch('/api/push/vapid-public-key');
    if (!resp.ok) return '';
    const data = (await resp.json()) as { publicKey?: string };
    return normalizeVapidKey(data.publicKey);
  } catch {
    return '';
  }
}

export function isVapidWebPushSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Extrae endpoint y claves criptográficas (p256dh, auth) de un objeto PushSubscription del navegador.
 */
export function serializePushSubscription(
  sub: PushSubscription | null | undefined
): SerializedWebPushSubscription | null {
  if (!sub || !sub.endpoint) return null;
  const json = typeof sub.toJSON === 'function' ? sub.toJSON() : null;
  const p256dh = String(json?.keys?.p256dh || '').trim();
  const auth = String(json?.keys?.auth || '').trim();
  if (!p256dh || !auth) return null;
  return {
    endpoint: sub.endpoint.trim(),
    p256dh,
    auth,
  };
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Obtiene una suscripción PushManager activa en el navegador sin solicitar permisos.
 */
export async function getCurrentBrowserPushSubscription(): Promise<SerializedWebPushSubscription | null> {
  if (!isVapidWebPushSupported()) return null;
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration('/')) ||
      (await navigator.serviceWorker.getRegistration());
    if (!reg || !reg.pushManager) return null;
    const sub = await reg.pushManager.getSubscription();
    return serializePushSubscription(sub);
  } catch {
    return null;
  }
}

/**
 * Suscribe el navegador a notificaciones Web Push usando la clave VAPID definida en .env.
 * Combina suscripción estándar W3C PushManager (applicationServerKey) con registro opcional FCM.
 */
export async function subscribeBrowserToVapidPush(params: {
  user: UserProfile;
  vapidPublicKeyOverride?: string;
}): Promise<VapidPushSubscribeResult> {
  if (!isVapidWebPushSupported()) {
    return {
      status: 'unsupported',
      message: 'Este navegador o contexto no soporta Service Worker / Web Push API.',
    };
  }

  const vapidKey = normalizeVapidKey(params.vapidPublicKeyOverride) || (await resolveVapidPublicKey());
  if (!vapidKey || !isValidVapidPublicKey(vapidKey)) {
    return {
      status: 'vapid_missing',
      message:
        'La clave pública VAPID (VITE_FIREBASE_VAPID_KEY) no está definida o tiene formato inválido en .env.',
    };
  }

  let permission = window.Notification.permission;
  if (permission === 'default') {
    permission = await window.Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      status: 'permission_denied',
      message: 'El navegador o el usuario denegó el permiso para notificaciones Push.',
    };
  }

  try {
    const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    const readyRegistration = (await navigator.serviceWorker.ready) || swRegistration;
    const applicationServerKey = urlBase64ToUint8Array(vapidKey);

    let pushSub = await readyRegistration.pushManager.getSubscription();
    if (pushSub?.options?.applicationServerKey) {
      const existingKeyBytes = new Uint8Array(pushSub.options.applicationServerKey);
      if (!uint8ArraysEqual(existingKeyBytes, applicationServerKey)) {
        await pushSub.unsubscribe().catch(() => false);
        pushSub = null;
      }
    }

    if (!pushSub) {
      pushSub = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const serialized = serializePushSubscription(pushSub);
    if (!serialized) {
      return {
        status: 'error',
        message: 'El navegador generó una suscripción Push sin claves de cifrado válidas (p256dh/auth).',
      };
    }

    // Intento no bloqueante de token FCM (permite compatibilidad con Firebase Cloud Messaging sin romper Web Push VAPID)
    let fcmToken: string | null = null;
    try {
      const fcmRes = await registerFcmDeviceToken();
      if (fcmRes.status === 'active' && fcmRes.token) {
        fcmToken = fcmRes.token;
      }
    } catch {
      fcmToken = null;
    }

    const subscriptionId = buildPushSubscriptionDocId(params.user.uid, serialized.endpoint);
    const deliveryMode: PushDeliveryMode = fcmToken ? 'FCM_AND_WEB_PUSH' : 'WEB_PUSH_VAPID';

    return {
      status: 'active',
      subscriptionId,
      subscription: serialized,
      fcmToken,
      vapidPublicKeyPrefix: vapidKey.slice(0, 16),
      deliveryMode,
    };
  } catch (err) {
    // Fallback elegante cuando el sandbox/iframe bloquea PushManager.subscribe pero permite Notification + SW local
    const rawMsg =
      err instanceof Error
        ? err.message
        : 'Error suscribiendo el navegador al servicio Web Push VAPID.';
    return {
      status: 'error',
      message: rawMsg,
    };
  }
}

/**
 * Cancela la suscripción PushManager activa del navegador y limpia el token FCM si existe.
 */
export async function unsubscribeBrowserFromVapidPush(): Promise<{
  endpoint: string | null;
}> {
  let endpoint: string | null = null;
  if (isVapidWebPushSupported()) {
    try {
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ||
        (await navigator.serviceWorker.getRegistration());
      if (reg?.pushManager) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          endpoint = sub.endpoint;
          await sub.unsubscribe().catch(() => false);
        }
      }
    } catch {
      // Ignore browser unsubscribe errors
    }
  }
  await unregisterFcmDeviceToken().catch(() => {});
  return { endpoint };
}

/**
 * Registra la suscripción Push VAPID en el backend Express para despacho en cambios de estado.
 */
export async function registerPushSubscriptionWithServer(params: {
  subscriptionId: string;
  user: UserProfile;
  subscription: SerializedWebPushSubscription;
  fcmToken?: string | null;
  subscribedStatuses?: ApplicationStatus[];
}): Promise<{ ok: boolean; vapidPrivateConfigured?: boolean }> {
  if (typeof fetch === 'undefined') return { ok: false };
  try {
    const resp = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionId: params.subscriptionId,
        organizationId: params.user.organizationId || 'org_axycore_main',
        userId: params.user.uid,
        userRole: params.user.role,
        userEmail: params.user.email,
        subscription: {
          endpoint: params.subscription.endpoint,
          keys: {
            p256dh: params.subscription.p256dh,
            auth: params.subscription.auth,
          },
        },
        fcmToken: params.fcmToken ?? null,
        subscribedStatuses:
          params.subscribedStatuses && params.subscribedStatuses.length > 0
            ? params.subscribedStatuses
            : ALL_TRACKED_PUSH_STATUSES,
      }),
    });
    if (!resp.ok) return { ok: false };
    const data = (await resp.json()) as { ok?: boolean; vapidPrivateConfigured?: boolean };
    return {
      ok: Boolean(data.ok),
      vapidPrivateConfigured: Boolean(data.vapidPrivateConfigured),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Elimina/revoca una suscripción Push VAPID del registro activo del backend Express.
 */
export async function unregisterPushSubscriptionFromServer(params: {
  userId: string;
  endpoint?: string | null;
  subscriptionId?: string | null;
}): Promise<void> {
  if (typeof fetch === 'undefined') return;
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: params.userId,
        endpoint: params.endpoint ?? null,
        subscriptionId: params.subscriptionId ?? null,
      }),
    });
  } catch {
    // Non-blocking cleanup
  }
}

/**
 * Despacha notificaciones Push a los usuarios suscritos (staff y cliente solicitante)
 * cada vez que una aplicación de crédito cambia de estado.
 */
export async function dispatchApplicationStatusChangePush(params: {
  application: Pick<
    ApplicationRecord,
    | 'id'
    | 'organizationId'
    | 'applicationNumber'
    | 'applicantDisplayName'
    | 'channel'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'status'
    | 'createdBy'
  >;
  prevStatus?: string | null;
  triggeredByUid?: string;
}): Promise<DispatchStatusPushResult> {
  if (!shouldTriggerApplicationCriticalPush(params.prevStatus, params.application.status)) {
    return {
      dispatched: false,
      deliveredViaWebPush: 0,
      deliveredViaRelay: 0,
      matchedSubscriptions: 0,
      reason: 'Sin cambio de estado notificable.',
    };
  }

  const payload = buildApplicationCriticalPushPayload(params.application, {
    prevStatus: params.prevStatus,
    audience: 'STAFF',
  });

  if (typeof fetch === 'undefined') {
    return {
      dispatched: false,
      deliveredViaWebPush: 0,
      deliveredViaRelay: 0,
      matchedSubscriptions: 0,
      payload,
      reason: 'Entorno sin fetch disponible.',
    };
  }

  try {
    const resp = await fetch('/api/push/notify-status-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application: params.application,
        prevStatus: params.prevStatus ?? null,
        triggeredByUid: params.triggeredByUid ?? null,
      }),
    });
    if (!resp.ok) {
      return {
        dispatched: false,
        deliveredViaWebPush: 0,
        deliveredViaRelay: 0,
        matchedSubscriptions: 0,
        payload,
        reason: `HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json()) as {
      deliveredViaWebPush?: number;
      deliveredViaRelay?: number;
      matchedSubscriptions?: number;
      payload?: InboxPushPayload;
    };
    return {
      dispatched: true,
      deliveredViaWebPush: Number(data.deliveredViaWebPush ?? 0),
      deliveredViaRelay: Number(data.deliveredViaRelay ?? 0),
      matchedSubscriptions: Number(data.matchedSubscriptions ?? 0),
      payload: data.payload ?? payload,
    };
  } catch (err) {
    return {
      dispatched: false,
      deliveredViaWebPush: 0,
      deliveredViaRelay: 0,
      matchedSubscriptions: 0,
      payload,
      reason: err instanceof Error ? err.message : 'Error contactando servicio de notificaciones Push.',
    };
  }
}

/**
 * Envía una notificación Push de prueba vía servidor (VAPID Web Push) con respaldo inmediato en el Service Worker local.
 */
export async function sendTestPushViaServerOrLocal(params: {
  user: UserProfile;
  endpoint?: string | null;
}): Promise<{ delivered: boolean; channel: 'WEB_PUSH_SERVER' | 'SERVICE_WORKER_LOCAL' | 'FAILED' }> {
  const isClient = params.user.role === 'EXTERNAL_CLIENT';
  const targetSection = isClient ? 'dashboard' : 'applications';
  const title = isClient
    ? 'Alertas Push Activas · Portal de Cliente'
    : 'Notificaciones Push VAPID Activas';
  const body = isClient
    ? 'Recibirás una notificación instantánea cada vez que tu solicitud de crédito cambie de estado.'
    : 'Suscripción VAPID verificada. Recibirás alertas inmediatas ante cualquier cambio de estado en solicitudes de crédito.';

  if (typeof fetch !== 'undefined') {
    try {
      const resp = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: params.user.uid,
          organizationId: params.user.organizationId || 'org_axycore_main',
          endpoint: params.endpoint ?? null,
          title,
          body,
          targetSection,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { deliveredViaWebPush?: number };
        if (Number(data.deliveredViaWebPush ?? 0) > 0) {
          return { delivered: true, channel: 'WEB_PUSH_SERVER' };
        }
      }
    } catch {
      // Fallback to local Service Worker notification
    }
  }

  const localOk = await sendClientWebPushNotification({
    title,
    body,
    targetSection,
    tag: `axycore_push_test_${Date.now()}`,
  });

  return {
    delivered: localOk,
    channel: localOk ? 'SERVICE_WORKER_LOCAL' : 'FAILED',
  };
}
