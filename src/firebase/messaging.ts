import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Unsubscribe,
} from 'firebase/messaging';
import { app } from './config';
import { isValidVapidPublicKey, normalizeVapidKey } from '../engine/pushPayload';
import type { FcmPushStatus } from '../types/axycore';

export interface RegisterFcmResult {
  status: FcmPushStatus;
  token?: string;
  message?: string;
}

export const DEFAULT_FCM_VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDZKrxZFuSjSmOWzIN542P1w1Gm8yEs6_O1uvWCWzW_A';

export function getConfiguredVapidKey(): string {
  const envObj = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const fromFirebase = normalizeVapidKey(envObj.VITE_FIREBASE_VAPID_KEY);
  if (fromFirebase) return fromFirebase;
  const fromGeneric = normalizeVapidKey(envObj.VITE_VAPID_PUBLIC_KEY);
  if (fromGeneric) return fromGeneric;
  return DEFAULT_FCM_VAPID_KEY;
}

export function isVapidKeyConfigured(): boolean {
  return isValidVapidPublicKey(getConfiguredVapidKey());
}

export async function isFcmWebPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export async function registerFcmDeviceToken(): Promise<RegisterFcmResult> {
  const supported = await isFcmWebPushSupported();
  if (!supported) {
    return {
      status: 'unsupported',
      message: 'Este navegador o contexto no soporta Firebase Cloud Messaging Web Push.',
    };
  }

  const vapidKey = getConfiguredVapidKey();
  if (!vapidKey) {
    return {
      status: 'vapid_missing',
      message:
        'Falta configurar VITE_FIREBASE_VAPID_KEY (certificado Web Push de Firebase Console -> Cloud Messaging) para generar el token del dispositivo.',
    };
  }

  let permission = window.Notification.permission;
  if (permission === 'default') {
    permission = await window.Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      status: 'permission_denied',
      message: 'El usuario o el navegador bloqueó el permiso de notificaciones Web Push.',
    };
  }

  try {
    const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    await navigator.serviceWorker.ready;

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration,
    });

    if (!token) {
      return {
        status: 'error',
        message: 'No se pudo obtener un token de registro FCM válido para este navegador.',
      };
    }

    return {
      status: 'active',
      token,
    };
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Error registrando el Service Worker o el token FCM.',
    };
  }
}

export async function unregisterFcmDeviceToken(): Promise<void> {
  const supported = await isFcmWebPushSupported();
  if (!supported) return;
  try {
    const messaging = getMessaging(app);
    await deleteToken(messaging);
  } catch {
    // Ignore errors when deleting stale browser tokens
  }
}

export async function subscribeForegroundFcmMessages(
  onPayload: (payload: MessagePayload) => void
): Promise<Unsubscribe | null> {
  const supported = await isFcmWebPushSupported();
  if (!supported) return null;
  try {
    const messaging = getMessaging(app);
    return onMessage(messaging, onPayload);
  } catch {
    return null;
  }
}

/**
 * Emite una notificación Web Push en el navegador respetando permisos y Service Worker.
 */
export async function sendClientWebPushNotification(params: {
  title: string;
  body: string;
  applicationId?: string;
  targetSection?: string;
  tag?: string;
  icon?: string;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;

  const title = `AxyCore · ${params.title}`;
  const options: NotificationOptions = {
    body: params.body,
    icon: params.icon || '/assets/aistudio/image_aea21874.png',
    badge: '/assets/aistudio/image_aea21874.png',
    tag: params.tag || `axycore_${Date.now()}`,
    data: {
      applicationId: params.applicationId || '',
      targetSection: params.targetSection || 'applications',
      clickUrl: params.applicationId
        ? `/?applicationId=${encodeURIComponent(params.applicationId)}&section=${encodeURIComponent(params.targetSection || 'applications')}`
        : '/?section=applications',
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    const n = new window.Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch (err) {
    console.warn('No se pudo emitir la notificación Web Push:', err);
    return false;
  }
}

