import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildDefaultRegulaConfig,
  buildRegulaDashboardCharts,
  buildRiskHeatmap5x5,
  computeRegulaDashboardKpis,
  computeRegulaEcosystemSignals,
  deriveRegulaPriorityAlerts,
  hasRegulaPermission,
  resolveUserRegulaRole,
} from '../../engine/regulaEngine';
import {
  createEmptyRegulaWorkspaceData,
  subscribeToRegulaWorkspace,
  syncRegulaAlertAndNotification,
} from '../../services/regulaStore';
import type {
  RegulaActionPermission,
  RegulaConfiguracionRecord,
  RegulaSectionId,
  RegulaWorkspaceData,
} from '../../types/regula';

export function useRegulaWorkspace() {
  const {
    userProfile,
    organization,
    clockInfo,
    riskAlerts,
    alteraRecommendations,
    collectionAccounts,
    policies,
    loans,
    reconciliationExceptions,
    dgiiEcfDocuments,
    documents,
    customers,
    businesses,
    usersList,
  } = useAxyCore();

  const orgId = organization.id || userProfile?.organizationId || 'org_axycore_main';
  const todayIso = clockInfo.todayIso;

  const [data, setData] = useState<RegulaWorkspaceData>(createEmptyRegulaWorkspaceData);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncingAlerts, setSyncingAlerts] = useState(false);

  useEffect(() => {
    setLoading(true);
    setSyncError(null);
    setData(createEmptyRegulaWorkspaceData());

    const unsub = subscribeToRegulaWorkspace(
      orgId,
      (updater) => {
        setData(updater);
        setLoading(false);
      },
      (err) => {
        setSyncError(err.message || 'Error sincronizando datos de AxyCore REGULA.');
        setLoading(false);
      }
    );

    // Ensure loading clears even if all collections are initially empty
    const timer = window.setTimeout(() => setLoading(false), 1200);
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, [orgId]);

  const effectiveConfig: RegulaConfiguracionRecord = useMemo(() => {
    if (data.config) return data.config;
    return buildDefaultRegulaConfig({
      organizationId: orgId,
      institutionName: organization.tradeName || organization.name,
      createdBy: userProfile?.uid || 'system',
    });
  }, [data.config, orgId, organization.name, organization.tradeName, userProfile?.uid]);

  const activeRegulaRole = useMemo(
    () => resolveUserRegulaRole(userProfile, effectiveConfig),
    [userProfile, effectiveConfig]
  );

  const can = useCallback(
    (section: RegulaSectionId, action: RegulaActionPermission): boolean =>
      hasRegulaPermission({
        user: userProfile,
        config: effectiveConfig,
        section,
        action,
      }),
    [userProfile, effectiveConfig]
  );

  const kpis = useMemo(() => computeRegulaDashboardKpis(data, todayIso), [data, todayIso]);

  const charts = useMemo(() => buildRegulaDashboardCharts(data, todayIso), [data, todayIso]);

  const residualHeatmap = useMemo(
    () => buildRiskHeatmap5x5(data.riesgos, 'RESIDUAL', effectiveConfig.riskThresholds),
    [data.riesgos, effectiveConfig.riskThresholds]
  );

  const inherentHeatmap = useMemo(
    () => buildRiskHeatmap5x5(data.riesgos, 'INHERENTE', effectiveConfig.riskThresholds),
    [data.riesgos, effectiveConfig.riskThresholds]
  );

  const priorityAlerts = useMemo(() => deriveRegulaPriorityAlerts(data, todayIso), [data, todayIso]);

  const ecosystemSignals = useMemo(
    () =>
      computeRegulaEcosystemSignals({
        riskAlerts,
        alteraRecommendations,
        collectionAccounts,
        creditPolicies: policies,
        loans,
        reconciliationExceptions,
        dgiiEcfDocuments,
        documents,
        customers,
        businesses,
        regulaKyc: data.kyc,
      }),
    [
      riskAlerts,
      alteraRecommendations,
      collectionAccounts,
      policies,
      loans,
      reconciliationExceptions,
      dgiiEcfDocuments,
      documents,
      customers,
      businesses,
      data.kyc,
    ]
  );

  const persistDerivedAlerts = useCallback(async (): Promise<number> => {
    if (!userProfile) return 0;
    setSyncingAlerts(true);
    let createdCount = 0;
    try {
      for (const a of priorityAlerts.slice(0, 25)) {
        const created = await syncRegulaAlertAndNotification({
          user: userProfile,
          organizationId: orgId,
          config: effectiveConfig,
          existingAlerts: data.alertas,
          alert: {
            dedupKey: a.dedupKey,
            alertType: a.alertType,
            severity: a.severity,
            title: a.title,
            description: a.description,
            targetSection: a.targetSection,
            relatedEntityType: a.relatedEntityType,
            relatedEntityId: a.relatedEntityId,
            dueDate: a.dueDate,
            status: 'ACTIVA',
            escalated: a.escalated,
          },
        });
        if (created) createdCount += 1;
      }
      return createdCount;
    } finally {
      setSyncingAlerts(false);
    }
  }, [userProfile, orgId, effectiveConfig, priorityAlerts, data.alertas]);

  return {
    orgId,
    todayIso,
    userProfile,
    organization,
    usersList,
    customers,
    businesses,
    data,
    effectiveConfig,
    activeRegulaRole,
    can,
    loading,
    syncError,
    kpis,
    charts,
    residualHeatmap,
    inherentHeatmap,
    priorityAlerts,
    ecosystemSignals,
    syncingAlerts,
    persistDerivedAlerts,
  };
}

export type RegulaWorkspaceState = ReturnType<typeof useRegulaWorkspace>;
