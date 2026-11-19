/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBUZNpE5u_YJ7UVz4jowAdLHDbtYrYpYTk',
  authDomain: 'future-bridge-skpm1.firebaseapp.com',
  projectId: 'future-bridge-skpm1',
  storageBucket: 'future-bridge-skpm1.firebasestorage.app',
  messagingSenderId: '232179188032',
  appId: '1:232179188032:web:97130ef1e118939291faa5',
});

const messaging = firebase.messaging();

function showAxyCoreNotification(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const notification =
    payload.notification && typeof payload.notification === 'object' ? payload.notification : {};

  const title =
    notification.title ||
    payload.title ||
    data.title ||
    'AxyCore · Actualización de Solicitud de Crédito';
  const body =
    notification.body ||
    payload.body ||
    data.body ||
    'Una solicitud de crédito ha cambiado de estado.';
  const tag =
    data.ackKey ||
    payload.tag ||
    (data.applicationId && data.status
      ? `${data.applicationId}:${data.status}`
      : data.applicationId || 'axycore-credit-status');
  const targetSection = data.targetSection || payload.targetSection || 'applications';
  const applicationId = data.applicationId || payload.applicationId || '';
  const clickUrl =
    data.clickAction ||
    data.clickUrl ||
    payload.clickUrl ||
    (applicationId
      ? `/?applicationId=${encodeURIComponent(applicationId)}&section=${encodeURIComponent(targetSection)}`
      : `/?section=${encodeURIComponent(targetSection)}`);

  return self.registration.showNotification(title, {
    body,
    icon: payload.icon || '/assets/aistudio/image_aea21874.png',
    badge: '/assets/aistudio/image_aea21874.png',
    tag,
    renotify: true,
    requireInteraction: data.priority === 'INMEDIATA' || payload.priority === 'INMEDIATA',
    data: {
      applicationId,
      targetSection,
      status: data.status || '',
      previousStatus: data.previousStatus || '',
      clickUrl,
    },
  });
}

// Firebase Cloud Messaging background push handler
messaging.onBackgroundMessage((payload) => {
  return showAxyCoreNotification(payload);
});

// Standard W3C VAPID Web Push event handler (for payloads dispatched via web-push / Push API)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let parsed = null;
  try {
    parsed = event.data.json();
  } catch {
    try {
      parsed = { title: 'AxyCore · Notificación Push', body: event.data.text() };
    } catch {
      parsed = null;
    }
  }

  if (!parsed) return;

  // Avoid double-rendering if Firebase Messaging SDK already intercepts standard FCM payloads
  if (parsed.from || parsed.fcmMessageId || (parsed.notification && parsed.FCM_MSG)) {
    return;
  }

  event.waitUntil(showAxyCoreNotification(parsed));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payloadData = (event.notification && event.notification.data) || {};
  const applicationId = payloadData.applicationId || '';
  const targetSection = payloadData.targetSection || 'applications';
  const targetUrl = applicationId
    ? `/?applicationId=${encodeURIComponent(applicationId)}&section=${encodeURIComponent(targetSection)}`
    : payloadData.clickUrl || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'AXYCORE_PUSH_CLICK',
            applicationId,
            targetSection,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
