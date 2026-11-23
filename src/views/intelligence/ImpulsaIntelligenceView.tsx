import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  Briefcase,
  CheckCircle2,
  FileBarChart2,
  RefreshCw,
  Settings2,
  Target,
  AlertTriangle,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  computeImpulsaCommercialMetrics,
  computeImpulsaInternalAlerts,
} from '../../engine/impulsa/impulsaEngine';
import { hasRolePermission } from '../../engine/rbac';
import { ImpulsaOverviewTab } from './ImpulsaOverviewTab';
import { ImpulsaOpportunitiesTab } from './ImpulsaOpportunitiesTab';
import { ImpulsaFollowUpTray } from './ImpulsaFollowUpTray';
import {
  ImpulsaAssistantTab,
  ImpulsaAutomationTab,
  ImpulsaReportsTab,
} from './ImpulsaAssistantAndReportsTabs';

type ImpulsaTabKey =
  | 'overview'
  | 'opportunities'
  | 'crm'
  | 'assistant'
  | 'reports'
  | 'automation';

export const ImpulsaIntelligenceView: React.FC = () => {
  const {
    userProfile,
    organization,
    usersList,
    customers,
    loans,
    applications,
    collectionAccounts,
    riskAlerts,
    auditLogs,
    activeOrTestPolicy,
    impulsaOpportunities,
    impulsaConfig,
    runImpulsaDetection,
    assignImpulsaOpportunityEntry,
    logImpulsaFollowUp,
    convertImpulsaToApplication,
    updateImpulsaConfigSettings,
    syncImpulsaWithAxyCore,
    setActiveSection,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<ImpulsaTabKey>('overview');
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [runningDetection, setRunningDetection] = useState(false);
  const [runBanner, setRunBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const dopPerUsd = activeOrTestPolicy.exchangeRateConfig?.dopPerUsd || 60;

  const { metrics, charts } = useMemo(
    () =>
      computeImpulsaCommercialMetrics({
        opportunities: impulsaOpportunities,
        loans,
        applications,
        dopPerUsd,
      }),
    [impulsaOpportunities, loans, applications, dopPerUsd]
  );

  const internalAlerts = useMemo(
    () => computeImpulsaInternalAlerts(impulsaOpportunities, impulsaConfig),
    [impulsaOpportunities, impulsaConfig]
  );

  if (!userProfile) return null;

  const canRunDetector =
    hasRolePermission(userProfile.role, 'MANAGE_IMPULSA') ||
    hasRolePermission(userProfile.role, 'CONFIGURE_IMPULSA');

  const handleRunDetection = async () => {
    setRunningDetection(true);
    setRunBanner(null);
    try {
      const { result, runLog } = await runImpulsaDetection('MANUAL');
      setRunBanner({
        type: 'ok',
        text: `Análisis completado sobre ${runLog.customersAnalyzed} cliente(s) y ${runLog.loansAnalyzed} préstamo(s): ${result.created.length} nueva(s), ${result.updated.length} actualizada(s), ${result.reconciled.length} conciliada(s) con solicitudes/desembolsos.`,
      });
    } catch (err) {
      setRunBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error ejecutando el Detector Inteligente.',
      });
    } finally {
      setRunningDetection(false);
    }
  };

  const openOpportunityInDossier = (oppId: string) => {
    setSelectedOpportunityId(oppId);
    setActiveTab('opportunities');
  };

  const tabs: Array<{
    key: ImpulsaTabKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { key: 'overview', label: 'Centro Comercial', icon: BarChart3 },
    {
      key: 'opportunities',
      label: 'Detector y Expedientes',
      icon: Target,
      badge: metrics.totalOpportunities,
    },
    {
      key: 'crm',
      label: 'Bandeja de Seguimiento',
      icon: Briefcase,
      badge: metrics.pendingManagement,
    },
    { key: 'assistant', label: 'Impulsa IA', icon: Bot },
    { key: 'reports', label: 'Reportes y Exportación', icon: FileBarChart2 },
    { key: 'automation', label: 'Automatización y Reglas', icon: Settings2 },
  ];

  return (
    <div className="space-y-5">
      {/* Compact Executive Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Impulsa — Motor Inteligente de Crecimiento Crediticio
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Inteligencia comercial conectada en tiempo real a clientes, préstamos, pagos, políticas vigentes, Centinela y Motor de Decisiones V2.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {impulsaConfig.lastRunAtIso && (
              <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                <div>Último análisis real</div>
                <div className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                  {new Date(impulsaConfig.lastRunAtIso).toLocaleString('es-DO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              </div>
            )}
            {canRunDetector && (
              <button
                type="button"
                onClick={() => void handleRunDetection()}
                disabled={runningDetection}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningDetection ? 'animate-spin' : ''}`} />
                {runningDetection ? 'Analizando cartera...' : 'Ejecutar Detector Inteligente'}
              </button>
            )}
          </div>
        </div>

        {/* Run Feedback Banner */}
        {runBanner && (
          <div
            className={`mt-4 rounded-lg px-3.5 py-2.5 text-xs font-medium flex items-center gap-2 ${
              runBanner.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900'
            }`}
          >
            {runBanner.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{runBanner.text}</span>
          </div>
        )}

        {/* Horizontal Tab Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-slate-900 dark:bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span
                    className={`ml-0.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'overview' && (
        <ImpulsaOverviewTab
          metrics={metrics}
          charts={charts}
          alerts={internalAlerts}
          onSelectOpportunityById={openOpportunityInDossier}
          onGoToTab={(tab) => setActiveTab(tab)}
        />
      )}

      {activeTab === 'opportunities' && (
        <ImpulsaOpportunitiesTab
          mode="opportunities"
          opportunities={impulsaOpportunities}
          selectedOpportunityId={selectedOpportunityId}
          onSelectOpportunity={setSelectedOpportunityId}
          usersList={usersList}
          currentUser={userProfile}
          policy={activeOrTestPolicy}
          onAssign={assignImpulsaOpportunityEntry}
          onLogFollowUp={logImpulsaFollowUp}
          onConvertToApplication={convertImpulsaToApplication}
          onNavigateSection={(sec) => setActiveSection(sec)}
        />
      )}

      {activeTab === 'crm' && (
        <ImpulsaFollowUpTray
          opportunities={impulsaOpportunities}
          customers={customers}
          loans={loans}
          applications={applications}
          collectionAccounts={collectionAccounts}
          riskAlerts={riskAlerts}
          auditLogs={auditLogs}
          usersList={usersList}
          currentUser={userProfile}
          policy={activeOrTestPolicy}
          unmanagedAlertHours={impulsaConfig.unmanagedAlertHours}
          selectedOpportunityId={selectedOpportunityId}
          onSelectOpportunity={setSelectedOpportunityId}
          onAssign={assignImpulsaOpportunityEntry}
          onLogFollowUp={logImpulsaFollowUp}
          onConvertToApplication={convertImpulsaToApplication}
          onSyncWithAxyCore={syncImpulsaWithAxyCore}
          onNavigateSection={(sec) => setActiveSection(sec)}
        />
      )}

      {activeTab === 'assistant' && (
        <ImpulsaAssistantTab
          opportunities={impulsaOpportunities}
          metrics={metrics}
          charts={charts}
          alerts={internalAlerts}
          organization={organization}
          currentUser={userProfile}
          onSelectOpportunityById={openOpportunityInDossier}
        />
      )}

      {activeTab === 'reports' && (
        <ImpulsaReportsTab
          opportunities={impulsaOpportunities}
          organization={organization}
          usersList={usersList}
          onSelectOpportunityById={openOpportunityInDossier}
        />
      )}

      {activeTab === 'automation' && (
        <ImpulsaAutomationTab
          config={impulsaConfig}
          currentUser={userProfile}
          onSaveConfig={updateImpulsaConfigSettings}
          onRunDetection={handleRunDetection}
          runningDetection={runningDetection}
        />
      )}
    </div>
  );
};
