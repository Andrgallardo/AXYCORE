import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  ClipboardList,
  Compass,
  Cpu,
  Dna,
  Download,
  FlaskConical,
  GitBranch,
  GraduationCap,
  History,
  Home,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildAlteraPortfolioSummary,
  buildClientFinancialDna,
  buildCreditDigitalTwin,
  buildPreventivePlanBSignals,
} from '../../engine/altera/alteraTwinAndDnaEngine';
import type {
  AlteraPreventiveSignal,
  AlteraQueryResponse,
  AlteraRecommendationRecord,
  AlteraSectionTab,
} from '../../types/altera';
import {
  AlteraCreditIntelligenceSection,
  AlteraDigitalTwinSection,
  AlteraFinancialDnaSection,
  AlteraHomeSection,
} from './AlteraAnalysisTabs';
import {
  AlteraPlanBSection,
  AlteraUniversesAndLabSection,
} from './AlteraSimulationAndActionTabs';
import {
  AlteraAnalysisHistorySection,
  AlteraConfigParamsSection,
  AlteraOutcomeLearningSection,
  AlteraRecommendationsSection,
} from './AlteraGovernanceTabs';
import { INTERVENTION_LABELS, downloadTextFile } from './alteraUiShared';

const ALTERA_NAV_TABS: Array<{
  id: AlteraSectionTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'home', label: 'Inicio de ALTERA', icon: Home },
  { id: 'credit_intelligence', label: 'Inteligencia Crediticia', icon: BarChart3 },
  { id: 'financial_dna', label: 'ADN Financiero', icon: Dna },
  { id: 'digital_twin', label: 'Gemelo Digital', icon: Cpu },
  { id: 'alternative_universes', label: 'Universos Alternativos', icon: GitBranch },
  { id: 'preventive_plan_b', label: 'Plan B Preventivo', icon: Compass },
  { id: 'intervention_lab', label: 'Lab. Intervenciones', icon: FlaskConical },
  { id: 'scenario_simulator', label: 'Simulador Escenarios', icon: ShieldAlert },
  { id: 'recommendations', label: 'Recomendaciones', icon: ClipboardList },
  { id: 'outcome_learning', label: 'Aprendizaje Resultados', icon: GraduationCap },
  { id: 'analysis_history', label: 'Historial Análisis', icon: History },
  { id: 'config_params', label: 'Configuración', icon: Sliders },
];

export function AlteraIntelligenceView() {
  const {
    organization,
    rbac,
    customers,
    loans,
    loanInstallments,
    payments,
    collectionAccounts,
    collectionActions,
    paymentPromises,
    paymentAgreements,
    customerDisputes,
    riskAlerts,
    applications,
    evaluations,
    activeOrTestPolicy,
    activeCollectionPolicy,
    auditLogs,
    alteraScenarios,
    alteraRecommendations,
    alteraOutcomes,
    alteraAnalyses,
    alteraConfig,
    saveAlteraScenarioEntry,
    createAlteraRecommendationEntry,
    updateAlteraRecommendationStatus,
    recordAlteraOutcomeCalibration,
    logAlteraAnalysis,
    updateAlteraConfigSettings,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<AlteraSectionTab>('home');
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const isReadOnlyAuditor = rbac.role === 'AUDITOR';
  const canSimulate = Boolean(rbac.permissions.SIMULATE_ALTERA) && !isReadOnlyAuditor;
  const canPropose = Boolean(rbac.permissions.PROPOSE_ALTERA_INTERVENTION) && !isReadOnlyAuditor;
  const canApprove = Boolean(rbac.permissions.APPROVE_ALTERA_INTERVENTION) && !isReadOnlyAuditor;
  const canManageConfig = Boolean(rbac.permissions.MANAGE_ALTERA_CONFIG) && !isReadOnlyAuditor;

  const twins = useMemo(() => {
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const accMap = new Map(collectionAccounts.map((a) => [a.loanId, a]));

    return loans.map((loan) =>
      buildCreditDigitalTwin({
        loan,
        installments: loanInstallments,
        payments,
        collectionAccount: accMap.get(loan.id) ?? null,
        promises: paymentPromises,
        agreements: paymentAgreements,
        disputes: customerDisputes,
        riskAlerts,
        customer: customerMap.get(loan.customerId) ?? null,
        collectionPolicy: activeCollectionPolicy,
        alteraConfig,
      })
    );
  }, [
    loans,
    loanInstallments,
    payments,
    collectionAccounts,
    paymentPromises,
    paymentAgreements,
    customerDisputes,
    riskAlerts,
    customers,
    activeCollectionPolicy,
    alteraConfig,
  ]);

  const dnas = useMemo(() => {
    return customers.map((customer) =>
      buildClientFinancialDna({
        customer,
        loans,
        twins,
        payments,
        promises: paymentPromises,
        agreements: paymentAgreements,
        disputes: customerDisputes,
        applications,
        evaluations,
      })
    );
  }, [
    customers,
    loans,
    twins,
    payments,
    paymentPromises,
    paymentAgreements,
    customerDisputes,
    applications,
    evaluations,
  ]);

  const preventiveSignals = useMemo(() => {
    return buildPreventivePlanBSignals({
      twins,
      dnas,
      collectionAccounts,
      collectionActions,
      riskAlerts,
      policy: activeOrTestPolicy,
      alteraConfig,
    });
  }, [
    twins,
    dnas,
    collectionAccounts,
    collectionActions,
    riskAlerts,
    activeOrTestPolicy,
    alteraConfig,
  ]);

  const portfolio = useMemo(() => {
    return buildAlteraPortfolioSummary({
      twins,
      dnas,
      preventiveSignals,
      recommendations: alteraRecommendations,
      savedScenarios: alteraScenarios,
      outcomes: alteraOutcomes,
    });
  }, [twins, dnas, preventiveSignals, alteraRecommendations, alteraScenarios, alteraOutcomes]);

  const effectiveLoanId = selectedLoanId || twins[0]?.loanId || '';
  const effectiveCustomerId = selectedCustomerId || dnas[0]?.customerId || '';

  const handleNavigateTab = (
    tab: AlteraSectionTab,
    opts?: { loanId?: string; customerId?: string }
  ) => {
    if (opts?.loanId) setSelectedLoanId(opts.loanId);
    if (opts?.customerId) setSelectedCustomerId(opts.customerId);
    setActiveTab(tab);
  };

  const handleLogQuery = (response: AlteraQueryResponse) => {
    if (isReadOnlyAuditor) return;
    logAlteraAnalysis({
      analysisType: 'CONSULTA_ALTERA',
      loanId: response.targetLoanId ?? null,
      customerId: response.targetCustomerId ?? null,
      queryText: response.query,
      summary: response.headline,
      confidencePct: response.explainability.confidencePct,
    }).catch(() => {});
  };

  const handleConvertSignalToRecommendation = async (sig: AlteraPreventiveSignal) => {
    const twin = twins.find((t) => t.loanId === sig.loanId);
    const categoryMap: Record<
      AlteraPreventiveSignal['suggestedInterventionType'],
      AlteraRecommendationRecord['category']
    > = {
      ABONO_EXTRAORDINARIO: 'ABONO_CAPITAL',
      CAMBIO_FECHA_PAGO: 'AJUSTE_VENCIMIENTO',
      REESTRUCTURACION_PLAZO: 'REESTRUCTURACION',
      REDUCCION_TEMPORAL_CUOTA: 'PLAN_B_PREVENTIVO',
      ESTRATEGIA_COBRANZA_PREVENTIVA: 'CONTENCION_COBRANZA',
      PAGO_PARCIAL_CONTROLADO: 'PLAN_B_PREVENTIVO',
    };

    await createAlteraRecommendationEntry({
      initialStatus: 'PENDIENTE_REVISION',
      recommendation: {
        customerId: sig.customerId,
        customerName: sig.customerName,
        loanId: sig.loanId,
        loanNumber: sig.loanNumber,
        currency: sig.currency,
        category: categoryMap[sig.suggestedInterventionType],
        interventionType: sig.suggestedInterventionType,
        proposedParams: sig.suggestedParams,
        priority: sig.priority,
        evidenceSummary: sig.evidenceUsed.join(' | '),
        diagnosis: sig.detectedRisk,
        proposedAlternative: `${INTERVENTION_LABELS[sig.suggestedInterventionType]} — ${sig.recommendedAction}`,
        expectedImpact: sig.expectedImpactSummary,
        expectedRecoveryDeltaPct: sig.priority === 'CRITICA' ? 16 : 11,
        expectedBalanceAtHorizon: twin?.currentPrincipalBalance ?? 0,
        confidencePct: sig.confidencePct,
        policyCompliant: true,
        responsibleUserId: sig.suggestedAssigneeId,
        responsibleUserName: sig.suggestedAssigneeName,
        suggestedFollowUpDate: sig.suggestedFollowUpDate,
        explainability: sig.explainability,
      },
      initialNotes: `Generada desde Plan B Preventivo (${sig.situationDetected}).`,
    });
  };

  const handleExportReport = (format: 'json' | 'csv') => {
    const stamp = portfolio.asOfDateIso;
    if (format === 'json') {
      downloadTextFile(
        `ALTERA_Informe_Cartera_${stamp}.json`,
        JSON.stringify(
          {
            organization: organization.tradeName || organization.name,
            generatedAtIso: new Date().toISOString(),
            portfolio,
            preventiveSignalsCount: preventiveSignals.length,
            recommendationsCount: alteraRecommendations.length,
            twins: twins.map((t) => ({
              loanNumber: t.loanNumber,
              customerName: t.customerName,
              currency: t.currency,
              currentPrincipalBalance: t.currentPrincipalBalance,
              dpdCurrent: t.dpdCurrent,
              deteriorationScore: t.deteriorationScore,
              recoveryProbabilityPct: t.recoveryProbabilityPct,
              priority: t.priority,
            })),
          },
          null,
          2
        ),
        'application/json;charset=utf-8'
      );
      return;
    }

    const header = [
      'Prestamo',
      'Cliente',
      'Moneda',
      'SaldoCapital',
      'DPD',
      'PuntualidadPct',
      'ScoreDeterioro',
      'ProbRecuperacionPct',
      'Prioridad',
      'Tendencia',
    ].join(',');
    const rows = twins.map((t) =>
      [
        `"${t.loanNumber}"`,
        `"${t.customerName.replace(/"/g, '""')}"`,
        t.currency,
        t.currentPrincipalBalance.toFixed(2),
        t.dpdCurrent,
        t.patterns.punctualityRatePct,
        t.deteriorationScore,
        t.recoveryProbabilityPct,
        t.priority,
        t.trend,
      ].join(',')
    );
    downloadTextFile(
      `ALTERA_Matriz_Cartera_${stamp}.csv`,
      [header, ...rows].join('\n'),
      'text/csv;charset=utf-8'
    );
  };

  if (!rbac.permissions.VIEW_ALTERA) {
    return (
      <div className="p-8 rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 text-white text-center space-y-2">
        <h2 className="font-display text-xl font-bold">Acceso Restringido a ALTERA</h2>
        <p className="text-xs text-slate-300">
          Tu rol actual ({rbac.role}) no dispone del permiso VIEW_ALTERA para consultar el Laboratorio de Decisiones Inteligentes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#030816] via-[#040C1E] to-[#08132B] border border-[#00B8FF]/25 p-5 sm:p-6 text-white shadow-xl">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-bold tracking-widest uppercase text-[#00D1FF]">
                AXYCORE INTELIGENCIA · MOTOR PREDICTIVO Y PRESCRIPTIVO
              </span>
              <span className="text-[11px] text-slate-400">
                | {organization.tradeName || organization.name}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              ALTERA <span className="text-[#00B8FF] font-semibold">· Laboratorio de Decisiones Inteligentes</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Gemelo Digital Crediticio, ADN Financiero, Universos Alternativos y Plan B Preventivo conectados a la base real de AxyCore con aprobación humana obligatoria.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleExportReport('csv')}
              className="px-3 py-2 rounded-xl bg-[#08132B] hover:bg-[#0052CC]/30 border border-[#00B8FF]/30 text-xs font-semibold text-[#00D1FF] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> CSV Cartera
            </button>
            <button
              type="button"
              onClick={() => handleExportReport('json')}
              className="px-3 py-2 rounded-xl bg-[#08132B] hover:bg-[#0052CC]/30 border border-[#00B8FF]/30 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Informe JSON
            </button>
          </div>
        </div>

        {isReadOnlyAuditor && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/15 border border-amber-400/35 text-xs text-amber-200">
            <strong>Modo Auditoría (Solo Lectura):</strong> Puedes inspeccionar diagnósticos, explicabilidad, comparadores en memoria y trazabilidad sin modificar registros.
          </div>
        )}
      </div>

      {/* 12-Section Navigation Rail */}
      <div className="p-2 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-max">
          {ALTERA_NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-[#0052CC] to-[#0066FF] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#040C1E]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#00D1FF]' : ''}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'home' && (
        <AlteraHomeSection
          portfolio={portfolio}
          twins={twins}
          dnas={dnas}
          signals={preventiveSignals}
          loans={loans}
          creditPolicy={activeOrTestPolicy}
          alteraConfig={alteraConfig}
          onNavigateTab={handleNavigateTab}
          onLogQuery={handleLogQuery}
        />
      )}

      {activeTab === 'credit_intelligence' && (
        <AlteraCreditIntelligenceSection
          portfolio={portfolio}
          twins={twins}
          onSelectTwin={(loanId) => handleNavigateTab('digital_twin', { loanId })}
          onSimulateLoan={(loanId) => handleNavigateTab('alternative_universes', { loanId })}
        />
      )}

      {activeTab === 'financial_dna' && (
        <AlteraFinancialDnaSection
          dnas={dnas}
          selectedCustomerId={effectiveCustomerId}
          onSelectCustomer={(customerId) => setSelectedCustomerId(customerId)}
        />
      )}

      {activeTab === 'digital_twin' && (
        <AlteraDigitalTwinSection
          twins={twins}
          selectedLoanId={effectiveLoanId}
          onSelectLoan={(loanId) => setSelectedLoanId(loanId)}
          onSimulateLoan={(loanId) => handleNavigateTab('alternative_universes', { loanId })}
        />
      )}

      {(activeTab === 'alternative_universes' ||
        activeTab === 'intervention_lab' ||
        activeTab === 'scenario_simulator') && (
        <AlteraUniversesAndLabSection
          mode={activeTab}
          loans={loans}
          twins={twins}
          creditPolicy={activeOrTestPolicy}
          collectionPolicy={activeCollectionPolicy}
          alteraConfig={alteraConfig}
          savedScenarios={alteraScenarios}
          selectedLoanId={effectiveLoanId}
          onSelectLoan={(loanId) => setSelectedLoanId(loanId)}
          canSimulate={canSimulate}
          canPropose={canPropose}
          isReadOnlyAuditor={isReadOnlyAuditor}
          onSaveScenario={async (sc) => {
            await saveAlteraScenarioEntry(sc);
          }}
          onCreateRecommendation={async (payload) => {
            await createAlteraRecommendationEntry(payload);
          }}
        />
      )}

      {activeTab === 'preventive_plan_b' && (
        <AlteraPlanBSection
          signals={preventiveSignals}
          canPropose={canPropose}
          isReadOnlyAuditor={isReadOnlyAuditor}
          onSimulateLoan={(loanId) => handleNavigateTab('alternative_universes', { loanId })}
          onConvertSignalToRecommendation={handleConvertSignalToRecommendation}
        />
      )}

      {activeTab === 'recommendations' && (
        <AlteraRecommendationsSection
          recommendations={alteraRecommendations}
          canPropose={canPropose}
          canApprove={canApprove}
          isReadOnlyAuditor={isReadOnlyAuditor}
          onTransitionStatus={async (payload) => {
            await updateAlteraRecommendationStatus(payload);
          }}
        />
      )}

      {activeTab === 'outcome_learning' && (
        <AlteraOutcomeLearningSection
          recommendations={alteraRecommendations}
          outcomes={alteraOutcomes}
          loans={loans}
          twins={twins}
          installments={loanInstallments}
          payments={payments}
          promises={paymentPromises}
          canPropose={canPropose}
          isReadOnlyAuditor={isReadOnlyAuditor}
          onSaveOutcome={async (out) => {
            await recordAlteraOutcomeCalibration(out);
          }}
        />
      )}

      {activeTab === 'analysis_history' && (
        <AlteraAnalysisHistorySection analyses={alteraAnalyses} auditLogs={auditLogs} />
      )}

      {activeTab === 'config_params' && (
        <AlteraConfigParamsSection
          config={alteraConfig}
          canManageConfig={canManageConfig}
          onSaveConfig={async (nextCfg) => {
            await updateAlteraConfigSettings(nextCfg);
          }}
        />
      )}
    </div>
  );
}
