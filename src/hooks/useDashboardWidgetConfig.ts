import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_ALERT_WIDGET_IDS,
  ALL_EXECUTIVE_KPI_IDS,
  buildDefaultDashboardWidgetConfig,
  dashboardWidgetReducer,
  getRoleDashboardPolicy,
  sanitizeDashboardWidgetConfig,
  type AlertsViewMode,
  type AlertWidgetId,
  type DashboardSectionId,
  type DashboardWidgetAction,
  type DashboardWidgetConfigState,
  type ExecutiveKpiWidgetId,
  type RoleDashboardPolicy,
} from '../engine/dashboardWidgetConfig';
import {
  persistDashboardWidgetConfig,
  readLocalDashboardWidgetConfig,
  subscribeDashboardWidgetConfig,
  writeLocalDashboardWidgetConfig,
} from '../services/dashboardConfigStore';
import type { CreditPermission, NavSectionId, UserRole } from '../types/axycore';

export type WidgetSyncStatus = 'SYNCED' | 'SAVING' | 'LOCAL_ONLY' | 'ERROR';

export function useDashboardWidgetConfig(params: {
  organizationId: string;
  userId: string;
  role: UserRole;
  isAuthenticated: boolean;
  hasPermission: (p: CreditPermission) => boolean;
  canAccessSection: (s: NavSectionId) => boolean;
}) {
  const { organizationId, userId, role, isAuthenticated, hasPermission, canAccessSection } = params;

  const policy: RoleDashboardPolicy = useMemo(
    () => getRoleDashboardPolicy({ role, hasPermission, canAccessSection }),
    [role, hasPermission, canAccessSection]
  );

  const [config, setConfig] = useState<DashboardWidgetConfigState>(() => {
    const cached = readLocalDashboardWidgetConfig({ organizationId, userId, role });
    if (cached) {
      return sanitizeDashboardWidgetConfig(cached, policy, { organizationId, userId });
    }
    return buildDefaultDashboardWidgetConfig({ organizationId, userId, policy });
  });

  const [editMode, setEditMode] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WidgetSyncStatus>(
    isAuthenticated ? 'SYNCED' : 'LOCAL_ONLY'
  );
  const remoteExistsRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  // Re-sanitize cleanly whenever role, organization, or user changes
  useEffect(() => {
    remoteExistsRef.current = false;
    const cached = readLocalDashboardWidgetConfig({ organizationId, userId, role });
    setConfig(
      cached
        ? sanitizeDashboardWidgetConfig(cached, policy, { organizationId, userId })
        : buildDefaultDashboardWidgetConfig({ organizationId, userId, policy })
    );
  }, [organizationId, userId, role, policy]);

  // Real-time Firestore listener
  useEffect(() => {
    if (!isAuthenticated || !userId || !organizationId) {
      setSyncStatus('LOCAL_ONLY');
      return;
    }

    const unsub = subscribeDashboardWidgetConfig({
      organizationId,
      userId,
      role,
      onData: (remote, existsRemotely) => {
        remoteExistsRef.current = existsRemotely;
        if (existsRemotely && remote) {
          const sanitized = sanitizeDashboardWidgetConfig(remote, policy, {
            organizationId,
            userId,
          });
          setConfig(sanitized);
          writeLocalDashboardWidgetConfig(sanitized);
        }
        setSyncStatus('SYNCED');
      },
      onError: () => {
        setSyncStatus('ERROR');
      },
    });

    return () => {
      unsub();
    };
  }, [isAuthenticated, organizationId, userId, role, policy]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const dispatchConfigAction = useCallback(
    (action: DashboardWidgetAction) => {
      setConfig((prev) => {
        const next = dashboardWidgetReducer(prev, action, policy);
        if (next === prev) return prev;
        writeLocalDashboardWidgetConfig(next);

        if (isAuthenticated && userId && organizationId) {
          setSyncStatus('SAVING');
          if (saveTimerRef.current !== null && typeof window !== 'undefined') {
            window.clearTimeout(saveTimerRef.current);
          }
          const runSave = () => {
            void persistDashboardWidgetConfig({
              config: next,
              existsRemotely: remoteExistsRef.current,
            })
              .then(() => {
                remoteExistsRef.current = true;
                setSyncStatus('SYNCED');
              })
              .catch(() => {
                setSyncStatus('ERROR');
              });
          };
          if (typeof window !== 'undefined') {
            saveTimerRef.current = window.setTimeout(runSave, 220);
          } else {
            runSave();
          }
        } else {
          setSyncStatus('LOCAL_ONLY');
        }
        return next;
      });
    },
    [policy, isAuthenticated, userId, organizationId]
  );

  const visibleKpis = useMemo(
    () => config.kpiOrder.filter((id) => !config.hiddenKpis.includes(id)),
    [config.kpiOrder, config.hiddenKpis]
  );

  const hiddenKpiWidgets = useMemo(
    () => config.kpiOrder.filter((id) => config.hiddenKpis.includes(id)),
    [config.kpiOrder, config.hiddenKpis]
  );

  const restrictedKpis = useMemo(
    () => ALL_EXECUTIVE_KPI_IDS.filter((id) => !policy.allowedKpis.includes(id)),
    [policy.allowedKpis]
  );

  const visibleAlerts = useMemo(
    () => config.alertOrder.filter((id) => !config.hiddenAlerts.includes(id)),
    [config.alertOrder, config.hiddenAlerts]
  );

  const hiddenAlertWidgets = useMemo(
    () => config.alertOrder.filter((id) => config.hiddenAlerts.includes(id)),
    [config.alertOrder, config.hiddenAlerts]
  );

  const restrictedAlerts = useMemo(
    () => ALL_ALERT_WIDGET_IDS.filter((id) => !policy.allowedAlerts.includes(id)),
    [policy.allowedAlerts]
  );

  const visibleSections = useMemo(
    () => config.sectionOrder.filter((id) => !config.hiddenSections.includes(id)),
    [config.sectionOrder, config.hiddenSections]
  );

  const hiddenSectionWidgets = useMemo(
    () => config.sectionOrder.filter((id) => config.hiddenSections.includes(id)),
    [config.sectionOrder, config.hiddenSections]
  );

  return {
    config,
    policy,
    editMode,
    setEditMode,
    syncStatus,
    visibleKpis,
    hiddenKpiWidgets,
    restrictedKpis,
    visibleAlerts,
    hiddenAlertWidgets,
    restrictedAlerts,
    visibleSections,
    hiddenSectionWidgets,
    reorderKpi: (fromId: ExecutiveKpiWidgetId, toId: ExecutiveKpiWidgetId) =>
      dispatchConfigAction({ type: 'REORDER_KPI', fromId, toId }),
    moveKpi: (id: ExecutiveKpiWidgetId, direction: -1 | 1) =>
      dispatchConfigAction({ type: 'MOVE_KPI', id, direction }),
    toggleKpiVisibility: (id: ExecutiveKpiWidgetId) =>
      dispatchConfigAction({ type: 'TOGGLE_KPI_VISIBILITY', id }),
    showAllKpis: () => dispatchConfigAction({ type: 'SHOW_ALL_KPIS' }),
    reorderAlert: (fromId: AlertWidgetId, toId: AlertWidgetId) =>
      dispatchConfigAction({ type: 'REORDER_ALERT', fromId, toId }),
    moveAlert: (id: AlertWidgetId, direction: -1 | 1) =>
      dispatchConfigAction({ type: 'MOVE_ALERT', id, direction }),
    toggleAlertVisibility: (id: AlertWidgetId) =>
      dispatchConfigAction({ type: 'TOGGLE_ALERT_VISIBILITY', id }),
    showAllAlerts: () => dispatchConfigAction({ type: 'SHOW_ALL_ALERTS' }),
    setAlertsViewMode: (mode: AlertsViewMode) =>
      dispatchConfigAction({ type: 'SET_ALERTS_VIEW_MODE', mode }),
    reorderSection: (fromId: DashboardSectionId, toId: DashboardSectionId) =>
      dispatchConfigAction({ type: 'REORDER_SECTION', fromId, toId }),
    moveSection: (id: DashboardSectionId, direction: -1 | 1) =>
      dispatchConfigAction({ type: 'MOVE_SECTION', id, direction }),
    toggleSectionVisibility: (id: DashboardSectionId) =>
      dispatchConfigAction({ type: 'TOGGLE_SECTION_VISIBILITY', id }),
    resetToRoleDefaults: () =>
      dispatchConfigAction({
        type: 'RESET_TO_ROLE_DEFAULT',
        organizationId,
        userId,
      }),
  };
}
