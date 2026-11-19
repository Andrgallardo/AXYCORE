import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  Activity,
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  CreditCard,
  ExternalLink,
  Gavel,
  GitCompare,
  Handshake,
  History,
  Inbox,
  Radar,
  Radio,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { useAxyCore } from '../context/AxyCoreContext';
import { sendClientWebPushNotification } from '../firebase/messaging';
import type { UserNotificationRecord } from '../types/axycore';
import {
  applyMarkAsReadTransition,
  buildUnifiedNotificationCenterItems,
  buildUserNotificationDocId,
  buildUserNotificationPayload,
  computePendingNotificationsCount,
  getNotificationAlertVisualMeta,
  mergeFirestoreAndDerivedNotifications,
  NOTIFICATION_ALERT_TYPE_LABELS,
  summarizeNotificationsByAlertType,
  type NotificationAlertIconKey,
  type NotificationAlertTypeCode,
  type NotificationCategory,
  type UnifiedNotificationItem,
} from '../engine/notificationCenterEngine';

export const OPEN_NOTIFICATION_CENTER_EVENT = 'axycore:open-notification-center';

export interface OpenNotificationCenterDetail {
  category?: NotificationCategory;
  alertType?: NotificationAlertTypeCode | 'ALL';
}

export function triggerOpenNotificationCenter(detail?: OpenNotificationCenterDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenNotificationCenterDetail>(OPEN_NOTIFICATION_CENTER_EVENT, {
      detail: detail ?? {},
    })
  );
}

const ALERT_ICON_COMPONENTS: Record<
  NotificationAlertIconKey,
  React.ComponentType<{ className?: string }>
> = {
  gavel: Gavel,
  inbox: Inbox,
  'clipboard-check': ClipboardCheck,
  'rotate-ccw': RotateCcw,
  send: Send,
  handshake: Handshake,
  'calendar-clock': CalendarClock,
  'credit-card': CreditCard,
  'git-compare': GitCompare,
  radar: Radar,
  'shield-alert': ShieldAlert,
};

export function renderAlertTypeIcon(
  alertType: NotificationAlertTypeCode,
  className = 'w-4 h-4'
): React.ReactElement {
  const meta = getNotificationAlertVisualMeta(alertType);
  const IconComponent = ALERT_ICON_COMPONENTS[meta.iconKey] ?? ShieldAlert;
  return <IconComponent className={className} />;
}

export function NotificationCenter() {
  const {
    firebaseUser,
    userProfile,
    applications,
    loans,
    loanInstallments,
    paymentPromises,
    payments,
    reconciliationExceptions,
    riskAlerts,
    collectionActions,
    committeeDecisions,
    auditLogs,
    clockInfo,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    setSelectedApplicationId,
    setSelectedCollectionLoanId,
    setActiveSection,
    desktopNotifPermission,
    desktopNotifEnabled,
    requestDesktopNotifications,
    toggleDesktopNotifications,
    fcmStatus,
    fcmError,
    fcmActiveDevicesCount,
    pushDeliveryMode,
    pushSubscribedStatuses,
    enableFcmPush,
    disableFcmPush,
    updatePushStatusPreferences,
    sendTestPush,
    rbac,
  } = useAxyCore();

  const [open, setOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory>('ALL');
  const [alertTypeFilter, setAlertTypeFilter] = useState<NotificationAlertTypeCode | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'UNREAD' | 'ALL'>('ALL');
  const [expandedHistoryKey, setExpandedHistoryKey] = useState<string | null>(null);
  const [showPushSettings, setShowPushSettings] = useState(false);
  const [testingPush, setTestingPush] = useState(false);

  const handleTestWebPush = useCallback(async () => {
    setTestingPush(true);
    try {
      const res = await sendTestPush();
      if (!res.delivered) {
        await sendClientWebPushNotification({
          title: 'Verificación Web Push (VAPID)',
          body: 'Certificado VAPID activo y canal Web Push operativo en AxyCore.',
          targetSection: 'applications',
        });
      }
    } finally {
      setTimeout(() => setTestingPush(false), 800);
    }
  }, [sendTestPush]);
  const [firestoreNotifications, setFirestoreNotifications] = useState<UserNotificationRecord[]>([]);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);
  const [readExtraKeys, setReadExtraKeys] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('axycore_extra_notif_ack');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const syncedDocIdsRef = useRef<Set<string>>(new Set());

  const currentUserId = userProfile?.uid || firebaseUser?.uid || '';
  const currentOrgId = userProfile?.organizationId || '';

  // 1. Real-time Firestore listener on `notifications` filtered by current user's ID
  useEffect(() => {
    if (!firebaseUser || !userProfile || !currentUserId || !currentOrgId) {
      setFirestoreNotifications([]);
      setFirestoreLoaded(false);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('organizationId', '==', currentOrgId),
      where('userId', '==', currentUserId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs
          .map((d) => d.data() as UserNotificationRecord)
          .filter((docItem) => docItem.userId === currentUserId);
        docs.forEach((d) => syncedDocIdsRef.current.add(d.id));
        setFirestoreNotifications(docs);
        setFirestoreLoaded(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'notifications');
      }
    );

    return () => unsub();
  }, [firebaseUser, userProfile, currentUserId, currentOrgId]);

  const acknowledgeLocalKey = useCallback(
    (ackKey: string) => {
      acknowledgeAlert(ackKey);
      setReadExtraKeys((prev) => {
        if (prev.includes(ackKey)) return prev;
        const next = [...prev, ackKey];
        try {
          localStorage.setItem('axycore_extra_notif_ack', JSON.stringify(next.slice(-300)));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [acknowledgeAlert]
  );

  // Listen for custom open events from DashboardTopAlertStrip or AppShell
  useEffect(() => {
    const onOpenCustom = (ev: Event) => {
      const custom = ev as CustomEvent<OpenNotificationCenterDetail>;
      if (custom.detail?.category) {
        setCategoryFilter(custom.detail.category);
      } else {
        setCategoryFilter('ALL');
      }
      if (custom.detail?.alertType) {
        setAlertTypeFilter(custom.detail.alertType);
      } else {
        setAlertTypeFilter('ALL');
      }
      setOpen(true);
    };
    window.addEventListener(OPEN_NOTIFICATION_CENTER_EVENT, onOpenCustom);
    return () => window.removeEventListener(OPEN_NOTIFICATION_CENTER_EVENT, onOpenCustom);
  }, []);

  const acknowledgedSet = useMemo(() => {
    const set = new Set<string>(readExtraKeys);
    if (userProfile && typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem(`axycore_ack_notifs_${userProfile.uid}`);
        if (stored) {
          (JSON.parse(stored) as string[]).forEach((k) => set.add(k));
        }
      } catch {
        // ignore
      }
    }
    for (const fsDoc of firestoreNotifications) {
      if (fsDoc.userId === currentUserId && fsDoc.read) {
        set.add(fsDoc.id);
        if (fsDoc.sourceEventKey) {
          set.add(fsDoc.sourceEventKey);
        }
      }
    }
    return set;
  }, [readExtraKeys, userProfile, firestoreNotifications, currentUserId]);

  const derivedNotifications = useMemo<UnifiedNotificationItem[]>(() => {
    if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT') return [];
    return buildUnifiedNotificationCenterItems({
      todayIso: clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      paymentPromises,
      payments,
      reconciliationExceptions,
      riskAlerts,
      collectionActions,
      committeeDecisions,
      auditLogs,
      acknowledgedKeys: acknowledgedSet,
      canAccessSection: rbac.canAccessSection,
      hasPermission: rbac.hasPermission,
    });
  }, [
    userProfile,
    clockInfo.todayIso,
    applications,
    loans,
    loanInstallments,
    paymentPromises,
    payments,
    reconciliationExceptions,
    riskAlerts,
    collectionActions,
    committeeDecisions,
    auditLogs,
    acknowledgedSet,
    rbac,
  ]);

  // 2. Merge Firestore `notifications` (filtered by userId) with derived event-history notifications
  const unifiedNotifications = useMemo<UnifiedNotificationItem[]>(() => {
    if (!currentUserId) return [];
    return mergeFirestoreAndDerivedNotifications({
      currentUserId,
      firestoreNotifications,
      derivedItems: derivedNotifications,
      localReadKeys: acknowledgedSet,
    });
  }, [currentUserId, firestoreNotifications, derivedNotifications, acknowledgedSet]);

  // 3. Automatically persist new operational notifications into Firestore `notifications` collection for currentUserId
  useEffect(() => {
    if (
      !firestoreLoaded ||
      !firebaseUser ||
      !userProfile ||
      userProfile.role === 'EXTERNAL_CLIENT' ||
      !currentUserId ||
      !currentOrgId
    ) {
      return;
    }

    const existingIds = new Set(firestoreNotifications.map((d) => d.id));
    const toCreate = derivedNotifications
      .map((item) => ({
        item,
        docId:
          item.firestoreNotificationId || buildUserNotificationDocId(currentUserId, item.ackKey),
      }))
      .filter(({ docId }) => !existingIds.has(docId) && !syncedDocIdsRef.current.has(docId))
      .slice(0, 12);

    if (toCreate.length === 0) return;

    toCreate.forEach(({ docId }) => syncedDocIdsRef.current.add(docId));

    (async () => {
      try {
        const batch = writeBatch(db);
        for (const { item, docId } of toCreate) {
          const payload = buildUserNotificationPayload({
            userId: currentUserId,
            organizationId: currentOrgId,
            createdBy: currentUserId,
            item: { ...item, firestoreNotificationId: docId },
            read: !item.isUnread,
            readAt: !item.isUnread ? new Date().toISOString() : null,
          });
          batch.set(doc(db, 'notifications', docId), {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'notifications');
      }
    })();
  }, [
    firestoreLoaded,
    firebaseUser,
    userProfile,
    currentUserId,
    currentOrgId,
    derivedNotifications,
    firestoreNotifications,
  ]);

  // 4. markAsRead: updates notification `read: true` in Firestore and subtracts from pendingCount immediately
  const markAsRead = useCallback(
    async (item: UnifiedNotificationItem) => {
      acknowledgeLocalKey(item.ackKey);
      if (!firebaseUser || !userProfile || !currentUserId || !currentOrgId) return;

      const nowIso = new Date().toISOString();
      const docId =
        item.firestoreNotificationId || buildUserNotificationDocId(currentUserId, item.ackKey);
      const existsInFirestore = firestoreNotifications.some((d) => d.id === docId);

      // Optimistically update local Firestore notifications state so pendingCount decrements immediately
      setFirestoreNotifications((prev) =>
        applyMarkAsReadTransition({
          firestoreNotifications: prev,
          currentUserId,
          organizationId: currentOrgId,
          targetItem: item,
          readAtIso: nowIso,
        }).updatedFirestoreNotifications
      );

      try {
        if (existsInFirestore) {
          await updateDoc(doc(db, 'notifications', docId), {
            read: true,
            readAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        } else {
          syncedDocIdsRef.current.add(docId);
          const payload = buildUserNotificationPayload({
            userId: currentUserId,
            organizationId: currentOrgId,
            createdBy: currentUserId,
            item: { ...item, firestoreNotificationId: docId },
            read: true,
            readAt: nowIso,
          });
          await setDoc(doc(db, 'notifications', docId), {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `notifications/${docId}`);
      }
    },
    [
      acknowledgeLocalKey,
      firebaseUser,
      userProfile,
      currentUserId,
      currentOrgId,
      firestoreNotifications,
    ]
  );

  const handleMarkAllRead = useCallback(async () => {
    acknowledgeAllAlerts();
    const unreadItems = unifiedNotifications.filter((n) => n.isUnread);
    for (const item of unreadItems) {
      acknowledgeLocalKey(item.ackKey);
    }

    if (
      !firebaseUser ||
      !userProfile ||
      !currentUserId ||
      !currentOrgId ||
      unreadItems.length === 0
    ) {
      return;
    }

    const nowIso = new Date().toISOString();
    setFirestoreNotifications((prev) => {
      let current = prev;
      for (const item of unreadItems) {
        current = applyMarkAsReadTransition({
          firestoreNotifications: current,
          currentUserId,
          organizationId: currentOrgId,
          targetItem: item,
          readAtIso: nowIso,
        }).updatedFirestoreNotifications;
      }
      return current;
    });

    try {
      const batch = writeBatch(db);
      const existingIds = new Set(firestoreNotifications.map((d) => d.id));

      for (const item of unreadItems) {
        const docId =
          item.firestoreNotificationId || buildUserNotificationDocId(currentUserId, item.ackKey);
        if (existingIds.has(docId)) {
          batch.update(doc(db, 'notifications', docId), {
            read: true,
            readAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        } else {
          syncedDocIdsRef.current.add(docId);
          const payload = buildUserNotificationPayload({
            userId: currentUserId,
            organizationId: currentOrgId,
            createdBy: currentUserId,
            item: { ...item, firestoreNotificationId: docId },
            read: true,
            readAt: nowIso,
          });
          batch.set(doc(db, 'notifications', docId), {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'notifications');
    }
  }, [
    acknowledgeAllAlerts,
    acknowledgeLocalKey,
    unifiedNotifications,
    firebaseUser,
    userProfile,
    currentUserId,
    currentOrgId,
    firestoreNotifications,
  ]);

  const alertTypeSummaries = useMemo(
    () => summarizeNotificationsByAlertType(unifiedNotifications),
    [unifiedNotifications]
  );

  // Pending counter for current user's unread notifications
  const pendingCount = useMemo(
    () => computePendingNotificationsCount(unifiedNotifications),
    [unifiedNotifications]
  );

  const filteredNotifications = useMemo(() => {
    return unifiedNotifications.filter((item) => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (alertTypeFilter !== 'ALL' && item.alertType !== alertTypeFilter) return false;
      if (viewMode === 'UNREAD' && !item.isUnread) return false;
      return true;
    });
  }, [unifiedNotifications, categoryFilter, alertTypeFilter, viewMode]);

  const handleNotificationItemClick = useCallback(
    (item: UnifiedNotificationItem) => {
      void markAsRead(item);
      if (item.applicationId) {
        setSelectedApplicationId(item.applicationId);
      }
      if (item.loanId && item.primarySection === 'cobranza_portfolio') {
        setSelectedCollectionLoanId(item.loanId);
      }
      setActiveSection(item.primarySection);
      setOpen(false);
    },
    [
      markAsRead,
      setSelectedApplicationId,
      setSelectedCollectionLoanId,
      setActiveSection,
    ]
  );

  if (!userProfile || !currentUserId) {
    return null;
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid="notification-center-trigger"
          aria-label={`Centro de notificaciones (${pendingCount} pendientes)`}
          className={`group relative inline-flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
            open
              ? 'bg-[#040C1E] text-white border-[#00B8FF] shadow-[0_0_20px_-4px_rgba(0,184,255,0.65)]'
              : 'bg-[#040C1E] dark:bg-[#040C1E] text-slate-100 border-[#00B8FF]/30 hover:border-[#00B8FF] hover:shadow-[0_0_16px_-4px_rgba(0,184,255,0.45)]'
          }`}
          title="NotificationCenter · Alertas en tiempo real (Firestore)"
        >
          <span className="relative flex items-center justify-center">
            <Bell className="w-4 h-4 text-[#00B8FF] group-hover:text-[#00D1FF] transition-colors" />
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#00D1FF] ring-2 ring-[#040C1E]" />
            )}
          </span>
          <span className="hidden xl:inline text-xs font-semibold tracking-tight text-slate-100">
            Notificaciones
          </span>
          {pendingCount > 0 && (
            <span
              data-testid="notification-pending-counter"
              className="min-w-[20px] h-[18px] px-1.5 rounded-md axy-brand-gradient border border-[#00D1FF]/40 text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center shadow-[0_0_12px_-2px_rgba(0,184,255,0.75)]"
            >
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          data-testid="notification-center-popover"
          className="axy-panel-in z-50 w-[370px] sm:w-[520px] rounded-2xl bg-[#040C1E] backdrop-blur-xl text-slate-100 border border-[#00B8FF]/30 shadow-[0_28px_70px_-12px_rgba(2,6,23,0.9),0_0_32px_-6px_rgba(0,102,255,0.42)] overflow-hidden focus:outline-none"
        >
          {/* Top AxyCore Infinity Accent Hairline */}
          <div className="axy-infinity-line" />

          {/* Header */}
          <div className="px-4 py-3.5 bg-[#040C1E] border-b border-[#00B8FF]/20 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#0066FF]/20 border border-[#00B8FF]/45 flex items-center justify-center shrink-0 shadow-[0_0_14px_-3px_rgba(0,184,255,0.65)]">
                  <Bell className="w-3.5 h-3.5 text-[#00D1FF]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-bold text-white tracking-tight flex items-center gap-2 truncate">
                    <span>NotificationCenter</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-[#0066FF]/25 border border-[#00B8FF]/45 text-[#00D1FF] font-mono text-[10px] font-semibold">
                      FIRESTORE
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                    {pendingCount} pendiente(s) · {unifiedNotifications.length} alerta(s) ·{' '}
                    {userProfile.displayName}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0066FF]/20 hover:bg-[#0066FF]/35 border border-[#00B8FF]/40 text-[11px] font-semibold text-[#00D1FF] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-[#00D1FF]" />
                  <span>Marcar leídas</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPushSettings((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  showPushSettings
                    ? 'bg-[#E2B35E]/20 border-[#E2B35E]/45 text-[#E2B35E]'
                    : 'bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08] hover:text-white'
                }`}
                title="Configurar notificaciones Push y de escritorio"
              >
                Push
              </button>
              <Popover.Close asChild>
                <button
                  type="button"
                  aria-label="Cerrar centro de notificaciones"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </Popover.Close>
            </div>
          </div>

          {/* Category Tabs & Read/Unread Toggle */}
          <div className="px-4 py-2 bg-[#040C1E] border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'ALL', label: 'Todas' },
                  { id: 'CREDITO', label: 'Créditos' },
                  { id: 'COBRANZA', label: 'Cobranza' },
                  { id: 'RIESGO', label: 'Riesgo' },
                  { id: 'BITACORA', label: 'Bitácora' },
                ] as Array<{ id: NotificationCategory; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(tab.id);
                    setAlertTypeFilter('ALL');
                  }}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    categoryFilter === tab.id
                      ? 'axy-brand-gradient text-white shadow-[0_0_12px_-2px_rgba(0,184,255,0.65)]'
                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'ALL' ? 'UNREAD' : 'ALL'))}
              className="text-[11px] font-semibold text-[#00D1FF] hover:text-sky-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              {viewMode === 'UNREAD'
                ? `Ver todas (${unifiedNotifications.length})`
                : `Solo pendientes (${pendingCount})`}
            </button>
          </div>

          {/* Differentiated Alert Types Chip Bar (with custom icon per alert type) */}
          {alertTypeSummaries.length > 0 && (
            <div className="px-4 py-2 bg-[#080D18] border-b border-white/[0.06] flex items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setAlertTypeFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                  alertTypeFilter === 'ALL'
                    ? 'bg-white/15 text-white font-semibold border border-white/20'
                    : 'bg-white/[0.04] text-slate-400 border border-transparent hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                Todos ({unifiedNotifications.length})
              </button>
              {alertTypeSummaries.map((summary) => {
                const meta = getNotificationAlertVisualMeta(summary.alertType);
                const isSelected = alertTypeFilter === summary.alertType;
                return (
                  <button
                    key={summary.alertType}
                    type="button"
                    onClick={() =>
                      setAlertTypeFilter((prev) =>
                        prev === summary.alertType ? 'ALL' : summary.alertType
                      )
                    }
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-all flex items-center gap-1.5 border ${
                      isSelected
                        ? `${meta.badgeClass} font-semibold shadow-[0_0_12px_-3px_rgba(59,130,246,0.5)]`
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    {renderAlertTypeIcon(summary.alertType, 'w-3 h-3 shrink-0')}
                    <span>{summary.label}</span>
                    <span className="font-mono tabular-nums text-[10px] opacity-90">
                      {summary.totalCount}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Collapsible Desktop Notification & FCM Web Push Controls */}
          {showPushSettings && (
            <div className="px-4 py-3 bg-[#08132B] border-b border-[#00B8FF]/15 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100 truncate">
                    Notificaciones de escritorio
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {desktopNotifPermission === 'unsupported'
                      ? 'No disponibles en este navegador'
                      : desktopNotifPermission === 'denied'
                      ? 'Permiso bloqueado en configuración del navegador'
                      : desktopNotifPermission === 'granted'
                      ? desktopNotifEnabled
                        ? 'Activas para eventos operativos en vivo'
                        : 'Pausadas por el usuario'
                      : 'Requiere autorización del navegador'}
                  </p>
                </div>

                {desktopNotifPermission === 'default' && (
                  <button
                    type="button"
                    onClick={requestDesktopNotifications}
                    className="px-2.5 py-1.5 rounded-lg axy-brand-gradient hover:brightness-110 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Activar alertas
                  </button>
                )}
                {desktopNotifPermission === 'granted' && (
                  <button
                    type="button"
                    onClick={toggleDesktopNotifications}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] text-[11px] font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {desktopNotifEnabled ? (
                      <>
                        <BellOff className="w-3 h-3" />
                        <span>Pausar</span>
                      </>
                    ) : (
                      <>
                        <Bell className="w-3 h-3" />
                        <span>Reanudar</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-100 flex items-center gap-1.5 truncate">
                      <Radio
                        className={`w-3.5 h-3.5 shrink-0 ${
                          fcmStatus === 'active' ? 'text-[#00D1FF]' : 'text-slate-400'
                        }`}
                      />
                      <span>Push Web (VAPID · Solicitudes de Crédito)</span>
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {fcmStatus === 'active'
                        ? `Suscrito (${pushDeliveryMode === 'FCM_AND_WEB_PUSH' ? 'VAPID + FCM' : 'VAPID Web Push'}) · ${fcmActiveDevicesCount} dispositivo(s)`
                        : fcmStatus === 'registering'
                        ? 'Registrando Service Worker y suscripción VAPID...'
                        : fcmStatus === 'vapid_missing'
                        ? 'Pendiente configurar VITE_FIREBASE_VAPID_KEY en .env'
                        : fcmStatus === 'permission_denied'
                        ? 'Permiso Web Push denegado en el navegador'
                        : fcmStatus === 'unsupported'
                        ? 'Service Worker o PushManager no soportado aquí'
                        : fcmStatus === 'error'
                        ? fcmError || 'Error registrando suscripción Web Push VAPID'
                        : 'Notifica cambios de estado en solicitudes en tiempo real'}
                    </p>
                  </div>

                  {fcmStatus === 'active' ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={testingPush}
                        onClick={handleTestWebPush}
                        className="px-2.5 py-1.5 rounded-lg border border-[#00B8FF]/40 bg-[#0066FF]/20 text-[11px] font-medium text-[#00D1FF] hover:bg-[#0066FF]/35 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50"
                        title="Emitir notificación Web Push de prueba al navegador"
                      >
                        {testingPush ? 'Enviando...' : 'Probar Push'}
                      </button>
                      <button
                        type="button"
                        onClick={disableFcmPush}
                        className="px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] text-[11px] font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                      >
                        Desactivar
                      </button>
                    </div>
                  ) : (
                    fcmStatus !== 'unsupported' &&
                    fcmStatus !== 'vapid_missing' && (
                      <button
                        type="button"
                        disabled={fcmStatus === 'registering'}
                        onClick={enableFcmPush}
                        className="px-2.5 py-1.5 rounded-lg axy-brand-gradient hover:brightness-110 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {fcmStatus === 'registering' ? 'Activando...' : 'Activar Push'}
                      </button>
                    )
                  )}
                </div>

                {fcmStatus === 'active' && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">
                      Estados de solicitud notificados ({pushSubscribedStatuses.length}/9)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { code: 'RECIBIDA', label: 'Recibida' },
                          { code: 'EN_EVALUACION', label: 'Evaluación' },
                          { code: 'DEVUELTA', label: 'Devuelta' },
                          { code: 'EN_COMITE', label: 'Comité' },
                          { code: 'APROBADA', label: 'Aprobada' },
                          { code: 'APROBADA_CONDICIONADA', label: 'Condicionada' },
                          { code: 'RECHAZADA', label: 'Rechazada' },
                          { code: 'FORMALIZADA', label: 'Formalizada' },
                          { code: 'DESEMBOLSADA', label: 'Desembolsada' },
                        ] as const
                      ).map((item) => {
                        const checked = pushSubscribedStatuses.includes(item.code);
                        return (
                          <button
                            key={item.code}
                            type="button"
                            onClick={() => {
                              const next = checked
                                ? pushSubscribedStatuses.filter((s) => s !== item.code)
                                : [...pushSubscribedStatuses, item.code];
                              if (next.length > 0) {
                                void updatePushStatusPreferences(next);
                              }
                            }}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                              checked
                                ? 'bg-[#0066FF]/20 border-[#00D1FF]/40 text-[#7CE4FF]'
                                : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notifications List */}
          <div className="max-h-[410px] overflow-y-auto divide-y divide-white/[0.06] bg-[#040C1E]">
            {filteredNotifications.length === 0 ? (
              <div className="p-9 text-center space-y-2 text-xs text-slate-400">
                <div className="w-10 h-10 rounded-xl bg-[#0066FF]/15 border border-[#00B8FF]/30 flex items-center justify-center mx-auto text-[#00D1FF]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <p className="font-semibold text-slate-200">
                  Sin notificaciones para este filtro
                </p>
                <p className="text-[11px] text-slate-400">
                  {alertTypeFilter !== 'ALL'
                    ? `No existen eventos activos del tipo «${NOTIFICATION_ALERT_TYPE_LABELS[alertTypeFilter]}».`
                    : 'Tu bandeja ejecutiva de notificaciones está al día.'}
                </p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const visualMeta = getNotificationAlertVisualMeta(item.alertType);
                const isHistoryExpanded = expandedHistoryKey === item.ackKey;

                return (
                  <div
                    key={item.ackKey}
                    data-testid={`notification-item-${item.alertType}`}
                    onClick={() => {
                      if (item.isUnread) {
                        void markAsRead(item);
                      }
                    }}
                    className={`p-3.5 space-y-2.5 text-xs transition-all cursor-pointer ${
                      item.isUnread
                        ? `${visualMeta.unreadBorderClass} bg-[#0066FF]/[0.12] hover:bg-[#0066FF]/[0.18]`
                        : 'bg-[#040C1E] hover:bg-[#08132B] opacity-85'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Differentiated Alert Type Icon Badge */}
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${visualMeta.iconContainerClass}`}
                        title={visualMeta.label}
                      >
                        {renderAlertTypeIcon(item.alertType, 'w-4 h-4')}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                              <span
                                className={`px-1.5 py-0.5 rounded-md font-mono font-bold tracking-wider uppercase ${visualMeta.badgeClass}`}
                              >
                                {visualMeta.shortTag}
                              </span>
                              <span className="font-semibold text-slate-200">
                                {item.alertTypeLabel}
                              </span>
                              <span aria-hidden="true" className="text-slate-600">
                                ·
                              </span>
                              <span className="font-mono tabular-nums text-slate-400">
                                {item.timestampDisplay}
                              </span>
                              {item.isUnread ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#0066FF]/25 text-[#00D1FF] font-mono text-[10px] font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#00D1FF]" />
                                  Pendiente
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-medium">
                                  Leída
                                </span>
                              )}
                            </div>

                            <p className="font-semibold text-white truncate mt-1 text-[13px]">
                              {item.title}
                            </p>
                            <p className="text-[11px] font-mono text-slate-400 truncate">
                              {item.subtitle} · Actor: {item.actorName}
                            </p>
                          </div>

                          {item.amountLabel && (
                            <span className="font-mono tabular-nums font-bold text-[#00D1FF] bg-[#00B8FF]/10 border border-[#00B8FF]/30 px-2 py-0.5 rounded-md shrink-0 text-[11px]">
                              {item.amountLabel}
                            </span>
                          )}
                        </div>

                        <p className="text-[11px] text-slate-300 leading-relaxed mt-1.5">
                          {item.detail}
                        </p>

                        {/* Linked Event History Timeline */}
                        {item.eventHistory.length > 0 && (
                          <div
                            className="pt-2"
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHistoryKey((prev) =>
                                  prev === item.ackKey ? null : item.ackKey
                                )
                              }
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#00D1FF] hover:text-sky-200 cursor-pointer transition-colors"
                            >
                              <History className="w-3.5 h-3.5 text-[#00B8FF]" />
                              <span>
                                Historial vinculado ({item.eventHistory.length} evento
                                {item.eventHistory.length === 1 ? '' : 's'})
                              </span>
                              {isHistoryExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>

                            {isHistoryExpanded && (
                              <div className="mt-2 p-2.5 rounded-xl bg-[#030816] border border-[#00B8FF]/15 space-y-2">
                                {item.eventHistory.map((ev) => (
                                  <div
                                    key={ev.id}
                                    className="text-[11px] pb-2 last:pb-0 border-b last:border-b-0 border-white/[0.06] space-y-0.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-200 truncate">
                                        {ev.sourceLabel} ·{' '}
                                        <span className="font-mono text-[10px] text-[#00D1FF]">
                                          {ev.eventCode}
                                        </span>
                                      </span>
                                      <span className="font-mono tabular-nums text-[10px] text-slate-400 shrink-0">
                                        {ev.timestampDisplay}
                                      </span>
                                    </div>
                                    <p className="text-slate-300">{ev.description}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                                      <span>Actor: {ev.actor}</span>
                                      {ev.stateTransition && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="font-mono text-[#00B8FF]">
                                            {ev.stateTransition}
                                          </span>
                                        </>
                                      )}
                                      {ev.note && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="truncate max-w-[260px]">{ev.note}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div
                          className="flex flex-wrap items-center justify-between gap-2 pt-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleNotificationItemClick(item)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-all ${visualMeta.actionButtonClass}`}
                            >
                              {renderAlertTypeIcon(item.alertType, 'w-3 h-3')}
                              <span>{item.primaryLabel}</span>
                            </button>

                            {item.secondaryLabel && item.secondarySection && (
                              <button
                                type="button"
                                onClick={() => {
                                  void markAsRead(item);
                                  if (item.applicationId) {
                                    setSelectedApplicationId(item.applicationId);
                                  } else if (item.loanId) {
                                    setSelectedCollectionLoanId(item.loanId);
                                  }
                                  setActiveSection(item.secondarySection!);
                                  setOpen(false);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/15 bg-white/[0.04] text-[11px] font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap cursor-pointer transition-colors"
                              >
                                <ExternalLink className="w-3 h-3 text-[#00D1FF]" />
                                <span>{item.secondaryLabel}</span>
                              </button>
                            )}
                          </div>

                          {item.isUnread && (
                            <button
                              type="button"
                              onClick={() => void markAsRead(item)}
                              className="px-2 py-1 rounded-md bg-[#0066FF]/20 hover:bg-[#0066FF] text-[11px] font-semibold text-[#00D1FF] hover:text-white border border-[#00B8FF]/40 transition-colors cursor-pointer"
                            >
                              Marcar leída
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer links */}
          <div className="px-4 py-2.5 border-t border-[#00B8FF]/15 bg-[#030816] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              {rbac.canAccessSection('cobranza_sentinel') && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('cobranza_sentinel');
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:underline cursor-pointer"
                >
                  <Radar className="w-3.5 h-3.5 text-[#00D1FF]" />
                  <span>Ir a Centinela</span>
                </button>
              )}
              {rbac.canAccessSection('audit') && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('audit');
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:underline cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>Bitácora de Eventos</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveSection('applications');
                setOpen(false);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#00D1FF] hover:text-sky-200 hover:underline cursor-pointer ml-auto"
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Bandeja de Solicitudes</span>
            </button>
          </div>

          <Popover.Arrow className="fill-[#08132B] stroke-[#00B8FF]/30" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DashboardTopAlertStrip() {
  const {
    userProfile,
    applications,
    loans,
    loanInstallments,
    paymentPromises,
    payments,
    reconciliationExceptions,
    riskAlerts,
    collectionActions,
    committeeDecisions,
    auditLogs,
    clockInfo,
    rbac,
  } = useAxyCore();

  const summaries = useMemo(() => {
    if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT') return [];
    const items = buildUnifiedNotificationCenterItems({
      todayIso: clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      paymentPromises,
      payments,
      reconciliationExceptions,
      riskAlerts,
      collectionActions,
      committeeDecisions,
      auditLogs,
      acknowledgedKeys: new Set<string>(),
      canAccessSection: rbac.canAccessSection,
      hasPermission: rbac.hasPermission,
    });
    return summarizeNotificationsByAlertType(items);
  }, [
    userProfile,
    clockInfo.todayIso,
    applications,
    loans,
    loanInstallments,
    paymentPromises,
    payments,
    reconciliationExceptions,
    riskAlerts,
    collectionActions,
    committeeDecisions,
    auditLogs,
    rbac,
  ]);

  if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT' || summaries.length === 0) {
    return null;
  }

  return (
    <div className="pt-3 border-t border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
          <span>Alertas conectadas al historial:</span>
        </span>
        {summaries.slice(0, 6).map((s) => {
          const meta = getNotificationAlertVisualMeta(s.alertType);
          return (
            <button
              key={s.alertType}
              type="button"
              onClick={() =>
                triggerOpenNotificationCenter({
                  alertType: s.alertType,
                })
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#00B8FF]/20 bg-[#040C1E] hover:bg-[#0E1D40] text-slate-100 transition-all cursor-pointer whitespace-nowrap shadow-xs"
            >
              <span className={meta.iconTextClass}>
                {renderAlertTypeIcon(s.alertType, 'w-3.5 h-3.5 shrink-0')}
              </span>
              <span className="font-medium">{s.label}</span>
              <span className="font-mono tabular-nums font-bold text-[#00D1FF]">
                {s.totalCount}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => triggerOpenNotificationCenter({ category: 'ALL', alertType: 'ALL' })}
        className="text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer whitespace-nowrap"
      >
        Abrir NotificationCenter →
      </button>
    </div>
  );
}
