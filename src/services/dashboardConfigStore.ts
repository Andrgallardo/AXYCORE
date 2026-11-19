import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  buildDashboardWidgetDocId,
  type DashboardWidgetConfigState,
} from '../engine/dashboardWidgetConfig';
import type { UserRole } from '../types/axycore';

const COLLECTION_NAME = 'dashboard_widget_configs';

function buildLocalStorageKey(organizationId: string, userId: string, role: UserRole): string {
  return `axycore_dash_widgets_v2_${organizationId}_${userId}_${role}`;
}

export function readLocalDashboardWidgetConfig(params: {
  organizationId: string;
  userId: string;
  role: UserRole;
}): Partial<DashboardWidgetConfigState> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(
      buildLocalStorageKey(params.organizationId, params.userId, params.role)
    );
    if (!raw) return null;
    return JSON.parse(raw) as Partial<DashboardWidgetConfigState>;
  } catch {
    return null;
  }
}

export function writeLocalDashboardWidgetConfig(config: DashboardWidgetConfigState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      buildLocalStorageKey(config.organizationId, config.userId, config.role),
      JSON.stringify(config)
    );
  } catch {
    // ignore storage quota limits
  }
}

export function subscribeDashboardWidgetConfig(params: {
  organizationId: string;
  userId: string;
  role: UserRole;
  onData: (remote: Partial<DashboardWidgetConfigState> | null, existsRemotely: boolean) => void;
  onError?: (err: unknown) => void;
}): () => void {
  const { organizationId, userId, role, onData, onError } = params;
  const docId = buildDashboardWidgetDocId(organizationId, userId, role);
  const path = `${COLLECTION_NAME}/${docId}`;
  const ref = doc(db, COLLECTION_NAME, docId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null, false);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      onData(
        {
          organizationId: String(data.organizationId || organizationId),
          userId: String(data.userId || userId),
          role: (data.role as UserRole) || role,
          sectionOrder: Array.isArray(data.sectionOrder) ? (data.sectionOrder as DashboardWidgetConfigState['sectionOrder']) : undefined,
          hiddenSections: Array.isArray(data.hiddenSections) ? (data.hiddenSections as DashboardWidgetConfigState['hiddenSections']) : undefined,
          kpiOrder: Array.isArray(data.kpiOrder) ? (data.kpiOrder as DashboardWidgetConfigState['kpiOrder']) : undefined,
          hiddenKpis: Array.isArray(data.hiddenKpis) ? (data.hiddenKpis as DashboardWidgetConfigState['hiddenKpis']) : undefined,
          alertOrder: Array.isArray(data.alertOrder) ? (data.alertOrder as DashboardWidgetConfigState['alertOrder']) : undefined,
          hiddenAlerts: Array.isArray(data.hiddenAlerts) ? (data.hiddenAlerts as DashboardWidgetConfigState['hiddenAlerts']) : undefined,
          alertsViewMode: data.alertsViewMode === 'FEED' || data.alertsViewMode === 'CARDS' ? data.alertsViewMode : 'CARDS',
        },
        true
      );
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function persistDashboardWidgetConfig(params: {
  config: DashboardWidgetConfigState;
  existsRemotely: boolean;
}): Promise<void> {
  const { config, existsRemotely } = params;
  const docId = buildDashboardWidgetDocId(config.organizationId, config.userId, config.role);
  const path = `${COLLECTION_NAME}/${docId}`;
  const ref = doc(db, COLLECTION_NAME, docId);

  writeLocalDashboardWidgetConfig(config);

  if (existsRemotely) {
    try {
      await updateDoc(ref, {
        sectionOrder: config.sectionOrder.slice(0, 8),
        hiddenSections: config.hiddenSections.slice(0, 8),
        kpiOrder: config.kpiOrder.slice(0, 4),
        hiddenKpis: config.hiddenKpis.slice(0, 4),
        alertOrder: config.alertOrder.slice(0, 7),
        hiddenAlerts: config.hiddenAlerts.slice(0, 7),
        alertsViewMode: config.alertsViewMode,
        updatedBy: config.userId,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
    return;
  }

  try {
    await setDoc(ref, {
      id: docId,
      organizationId: config.organizationId,
      userId: config.userId,
      role: config.role,
      sectionOrder: config.sectionOrder.slice(0, 8),
      hiddenSections: config.hiddenSections.slice(0, 8),
      kpiOrder: config.kpiOrder.slice(0, 4),
      hiddenKpis: config.hiddenKpis.slice(0, 4),
      alertOrder: config.alertOrder.slice(0, 7),
      hiddenAlerts: config.hiddenAlerts.slice(0, 7),
      alertsViewMode: config.alertsViewMode,
      updatedBy: config.userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
