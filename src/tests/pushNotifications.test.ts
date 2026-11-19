import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_TRACKED_PUSH_STATUSES,
  buildApplicationCriticalPushPayload,
  buildPushSubscriptionDocId,
  isValidVapidPublicKey,
  normalizeVapidKey,
  shouldTriggerApplicationCriticalPush,
  urlBase64ToUint8Array,
} from '../engine/pushPayload';
import {
  dispatchApplicationStatusChangePush,
  serializePushSubscription,
  subscribeBrowserToVapidPush,
  unsubscribeBrowserFromVapidPush,
} from '../services/pushSubscriptionService';
import type { ApplicationRecord, UserProfile } from '../types/axycore';

const SAMPLE_ENV_VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDZKrxZFuSjSmOWzIN542P1w1Gm8yEs6_O1uvWCWzW_A';

const SAMPLE_APPLICATION: Pick<
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
> = {
  id: 'app_test_push_001',
  organizationId: 'org_axycore_main',
  applicationNumber: 'SOL-2026-0912',
  applicantDisplayName: 'Giordanny Fernández',
  channel: 'EXTERNAL',
  productCode: 'PERSONAL_DOP',
  currency: 'DOP',
  requestedAmount: 150000,
  status: 'APROBADA',
  createdBy: 'uid_client_001',
};

const SAMPLE_USER: UserProfile = {
  uid: 'uid_staff_001',
  organizationId: 'org_axycore_main',
  email: 'analista@axycore.local',
  displayName: 'Analista Crédito',
  role: 'CREDIT_ANALYST',
  status: 'ACTIVE',
};

describe('VAPID Web Push Key Utilities & Payload Engine', () => {
  it('normalizes and validates a standard 65-byte uncompressed P-256 VAPID public key', () => {
    expect(normalizeVapidKey(`  "${SAMPLE_ENV_VAPID_KEY}"  `)).toBe(SAMPLE_ENV_VAPID_KEY);
    expect(isValidVapidPublicKey(SAMPLE_ENV_VAPID_KEY)).toBe(true);

    const decoded = urlBase64ToUint8Array(SAMPLE_ENV_VAPID_KEY);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.length).toBe(65);
    expect(decoded[0]).toBe(0x04);
  });

  it('rejects empty, malformed, or wrong-length VAPID public keys', () => {
    expect(isValidVapidPublicKey('')).toBe(false);
    expect(isValidVapidPublicKey('short-key')).toBe(false);
    expect(isValidVapidPublicKey('not!valid@base64url#key$1234567890123456789012345678901234567890')).toBe(false);
    expect(() => urlBase64ToUint8Array('   ')).toThrow();
  });

  it('generates deterministic, Firestore-safe subscription document IDs', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/eX4mPl3-endpoint-token:APA91bH7_9xYz';
    const id1 = buildPushSubscriptionDocId('uid_client_001', endpoint);
    const id2 = buildPushSubscriptionDocId('uid_client_001', endpoint);
    const idOther = buildPushSubscriptionDocId('uid_client_001', `${endpoint}_v2`);

    expect(id1).toBe(id2);
    expect(id1).not.toBe(idOther);
    expect(id1.length).toBeLessThanOrEqual(128);
    expect(/^[a-zA-Z0-9_\-]+$/.test(id1)).toBe(true);
    expect(id1.startsWith('push_')).toBe(true);
  });

  it('triggers push alerts on every tracked credit application status transition and ignores no-ops', () => {
    for (const status of ALL_TRACKED_PUSH_STATUSES) {
      expect(shouldTriggerApplicationCriticalPush('BORRADOR', status)).toBe(true);
      expect(shouldTriggerApplicationCriticalPush(status, status)).toBe(false);
    }
    expect(shouldTriggerApplicationCriticalPush(undefined, 'BORRADOR')).toBe(false);
    expect(shouldTriggerApplicationCriticalPush('RECIBIDA', null)).toBe(false);
  });

  it('builds tailored status-change payloads for both STAFF and CLIENT audiences', () => {
    const staffPayload = buildApplicationCriticalPushPayload(SAMPLE_APPLICATION, {
      prevStatus: 'EN_COMITE',
      audience: 'STAFF',
    });
    expect(staffPayload.eventType).toBe('APPLICATION_APPROVED');
    expect(staffPayload.targetSection).toBe('formalization');
    expect(staffPayload.ackKey).toBe('app_test_push_001:APROBADA');
    expect(staffPayload.data.previousStatus).toBe('EN_COMITE');
    expect(staffPayload.data.audience).toBe('STAFF');
    expect(staffPayload.body).toContain('SOL-2026-0912');
    expect(staffPayload.body).toContain('Giordanny Fernández');
    expect(staffPayload.body).toContain('→');

    const clientPayload = buildApplicationCriticalPushPayload(SAMPLE_APPLICATION, {
      prevStatus: 'EN_COMITE',
      audience: 'CLIENT',
    });
    expect(clientPayload.targetSection).toBe('dashboard');
    expect(clientPayload.title).toContain('Crédito fue Aprobado');
    expect(clientPayload.data.audience).toBe('CLIENT');
    expect(clientPayload.data.clickAction).toContain('section=dashboard');
  });
});

describe('VAPID Web Push Subscription Service Lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes browser PushSubscription objects cleanly', () => {
    const mockSub = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-sub-123',
      toJSON: () => ({
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-sub-123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      }),
    } as unknown as PushSubscription;

    const serialized = serializePushSubscription(mockSub);
    expect(serialized).toEqual({
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-sub-123',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    });
  });

  it('subscribes via PushManager using the decoded .env VAPID applicationServerKey and unsubscribes cleanly', async () => {
    const unsubscribeMock = vi.fn().mockResolvedValue(true);
    const createdSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/vapid-sub-endpoint-999',
      options: {
        applicationServerKey: urlBase64ToUint8Array(SAMPLE_ENV_VAPID_KEY).buffer,
      },
      unsubscribe: unsubscribeMock,
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/vapid-sub-endpoint-999',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      }),
    } as unknown as PushSubscription;

    const subscribeMock = vi.fn().mockResolvedValue(createdSub);
    const getSubscriptionMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdSub);

    const mockSwRegistration = {
      pushManager: {
        getSubscription: getSubscriptionMock,
        subscribe: subscribeMock,
      },
    };

    const mockNotification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    vi.stubGlobal('window', {
      Notification: mockNotification,
      PushManager: function PushManager() {},
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(mockSwRegistration),
        ready: Promise.resolve(mockSwRegistration),
        getRegistration: vi.fn().mockResolvedValue(mockSwRegistration),
      },
    });

    const result = await subscribeBrowserToVapidPush({
      user: SAMPLE_USER,
      vapidPublicKeyOverride: SAMPLE_ENV_VAPID_KEY,
    });

    expect(result.status).toBe('active');
    expect(result.subscription?.endpoint).toBe(
      'https://fcm.googleapis.com/fcm/send/vapid-sub-endpoint-999'
    );
    expect(result.subscriptionId).toMatch(/^push_/);
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    const subscribeArg = subscribeMock.mock.calls[0][0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(subscribeArg.userVisibleOnly).toBe(true);
    expect(subscribeArg.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(subscribeArg.applicationServerKey.length).toBe(65);
    expect(subscribeArg.applicationServerKey[0]).toBe(0x04);

    const unsubRes = await unsubscribeBrowserFromVapidPush();
    expect(unsubRes.endpoint).toBe('https://fcm.googleapis.com/fcm/send/vapid-sub-endpoint-999');
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('returns permission_denied when browser Notification permission is denied', async () => {
    vi.stubGlobal('window', {
      Notification: {
        permission: 'denied',
        requestPermission: vi.fn().mockResolvedValue('denied'),
      },
      PushManager: function PushManager() {},
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {},
    });

    const res = await subscribeBrowserToVapidPush({
      user: SAMPLE_USER,
      vapidPublicKeyOverride: SAMPLE_ENV_VAPID_KEY,
    });

    expect(res.status).toBe('permission_denied');
  });

  it('dispatches status-change notification requests to /api/push/notify-status-change and skips unchanged statuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        deliveredViaWebPush: 1,
        deliveredViaRelay: 2,
        matchedSubscriptions: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const skipped = await dispatchApplicationStatusChangePush({
      application: SAMPLE_APPLICATION,
      prevStatus: 'APROBADA',
      triggeredByUid: SAMPLE_USER.uid,
    });
    expect(skipped.dispatched).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const sent = await dispatchApplicationStatusChangePush({
      application: SAMPLE_APPLICATION,
      prevStatus: 'EN_COMITE',
      triggeredByUid: SAMPLE_USER.uid,
    });
    expect(sent.dispatched).toBe(true);
    expect(sent.deliveredViaWebPush).toBe(1);
    expect(sent.deliveredViaRelay).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/push/notify-status-change',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
