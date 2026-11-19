import React from 'react';
import { ArrowLeft, Rocket, Sparkles } from 'lucide-react';
import { AxyCoreProvider, useAxyCore } from './context/AxyCoreContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginGate } from './components/LoginGate';
import { AppShell } from './components/AppShell';
import { ApplicationDetailDrawer } from './components/ApplicationDetailDrawer';
import { DirectorDedicatedView } from './components/DirectorSection';
import { ExecutiveDashboardView } from './views/ExecutiveDashboardView';
import { SystemGuideView } from './views/SystemGuideView';
import { DashboardView } from './views/DashboardView';
import { NewApplicationView } from './views/NewApplicationView';
import { LoanCalculatorView } from './views/LoanCalculatorView';
import { ApplicationsInboxView } from './views/ApplicationsInboxView';
import { DecisionEngineView } from './views/DecisionEngineView';
import { EvaluationView } from './views/EvaluationView';
import { CommitteeView } from './views/CommitteeView';
import { FormalizationView } from './views/FormalizationView';
import { DisbursementsView } from './views/DisbursementsView';
import { DisbursedLoansView } from './views/DisbursedLoansView';
import { CustomersView } from './views/CustomersView';
import { DocumentsView } from './views/DocumentsView';
import { ReportsView } from './views/ReportsView';
import { PoliciesView } from './views/PoliciesView';
import { AuditView } from './views/AuditView';
import { CustomerLoan360Drawer } from './views/collections/CustomerLoan360Drawer';
import { CollectionsPortfolioAndQueuesView } from './views/collections/CollectionsPortfolioAndQueuesView';
import { CollectionsActionsAndAgendaView } from './views/collections/CollectionsActionsAndAgendaView';
import { PaymentsAndReconciliationView } from './views/collections/PaymentsAndReconciliationView';
import { RecoveryBotAndSentinelView } from './views/collections/RecoveryBotAndSentinelView';
import { CollectionsOverviewAndGovernanceView } from './views/collections/CollectionsOverviewAndGovernanceView';
import { AccountingStatementsView } from './views/operations/AccountingStatementsView';
import { AccountingLedgersAndBooksView } from './views/operations/AccountingLedgersAndBooksView';
import { AccountingPaymentValidationView } from './views/operations/AccountingPaymentValidationView';
import { DgiiDashboardAndDocumentsView } from './views/operations/dgii/DgiiDashboardAndDocumentsView';
import {
  DgiiEmitInvoiceView,
  type EcfAdjustmentPrefill,
} from './views/operations/dgii/DgiiEmitInvoiceView';
import { DgiiReceivedEcfView } from './views/operations/dgii/DgiiReceivedEcfView';
import { DgiiMasterCatalogsView } from './views/operations/dgii/DgiiMasterCatalogsView';
import { DgiiInfrastructureView } from './views/operations/dgii/DgiiInfrastructureView';
import { DgiiReportsAndAuditView } from './views/operations/dgii/DgiiReportsAndAuditView';
import { RegisterPaymentsView } from './views/operations/RegisterPaymentsView';
import { RegisterExpensesView } from './views/operations/RegisterExpensesView';
import { RegisterInvestorsView } from './views/operations/RegisterInvestorsView';
import { PlatformControlView } from './views/PlatformControlView';
import { ClientPortalView } from './views/ClientPortalView';
import { IntelligenceDashboardView } from './components/IntelligenceDashboardView';
import { AlteraIntelligenceView } from './views/intelligence/AlteraIntelligenceView';
import { AXYCORE_MODULE_CATALOG } from './engine/multiTenantEngine';
import type { AxyCoreModuleCode, NavSectionId } from './types/axycore';
import type { DgiiEcfDocumentRecord } from './types/dgiiEcf';

function UpcomingIntelligenceModuleView({
  moduleName,
  subtitle,
  description,
  capabilities,
}: {
  moduleName: string;
  subtitle: string;
  description: string;
  capabilities: string[];
}) {
  const { setActiveSection } = useAxyCore();

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <div className="relative overflow-hidden p-6 sm:p-8 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-5">
        <div className="axy-infinity-line absolute top-0 left-0 right-0" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#040C1E] border border-[#00B8FF]/25 text-[#00D1FF] text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-[#E2B35E]" />
            <span>Módulo en Hoja de Ruta · Próximamente</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver al Dashboard Ejecutivo</span>
          </button>
        </div>

        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            AxyCore {moduleName}
          </h2>
          <p className="text-sm font-medium text-[#0066FF] dark:text-[#00D1FF]">{subtitle}</p>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E]/60 border border-slate-200/70 dark:border-[#00B8FF]/15 space-y-2.5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Rocket className="w-3.5 h-3.5 text-[#00B8FF]" />
            <span>Capacidades previstas en la arquitectura</span>
          </p>
          <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
            {capabilities.map((cap, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono text-[#0066FF] dark:text-[#00D1FF] font-bold">0{idx + 1}.</span>
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveSection('director')}
            className="px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
          >
            Usar AxyCore Director Ahora
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('cobranza_anticipate')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
          >
            Abrir Anticípate 30 / 60 / 90d
          </button>
        </div>
      </div>
    </div>
  );
}

function TenantModuleRestrictedView({
  reason,
  requiredModule,
}: {
  reason?: string;
  requiredModule?: AxyCoreModuleCode;
}) {
  const { organization, isPlatformAdminPortal, setActiveSection } = useAxyCore();
  const moduleMeta = requiredModule
    ? AXYCORE_MODULE_CATALOG.find((m) => m.code === requiredModule)
    : undefined;

  return (
    <div className="max-w-2xl mx-auto py-10">
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 p-8 text-white shadow-2xl space-y-5">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="inline-flex items-center gap-2 text-[#E2B35E] text-xs font-semibold">
          <span>Módulo No Contratado o Licencia Restringida</span>
        </div>
        <h2 className="font-display text-2xl font-bold text-white">
          {moduleMeta ? moduleMeta.name : 'Acceso Restringido por Licencia'}
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          {reason ||
            `Este módulo no se encuentra habilitado actualmente en el plan contratado por ${
              organization.tradeName || organization.name
            }.`}
        </p>
        <div className="p-4 rounded-xl bg-[#08132B] border border-[#00B8FF]/15 text-xs text-slate-400 space-y-1">
          <div>
            Organización activa:{' '}
            <strong className="text-white">{organization.tradeName || organization.name}</strong>
          </div>
          <div>
            Plan comercial: <strong className="text-[#E2B35E]">{organization.planCode || 'CORPORATIVO'}</strong> ·
            Estado de licencia: <strong className="text-[#00B8FF]">{organization.licenseStatus || 'ACTIVA'}</strong>
          </div>
          <div>
            Nota: Tus datos históricos en este módulo permanecen 100% protegidos y se restaurarán al reactivar el
            módulo en tu licencia.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className="px-4 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer"
          >
            Volver al Dashboard de {organization.tradeName || organization.name}
          </button>
          {isPlatformAdminPortal && (
            <button
              type="button"
              onClick={() => setActiveSection('platform_control')}
              className="px-4 py-2.5 rounded-xl border border-[#00B8FF]/40 bg-[#00B8FF]/10 hover:bg-[#00B8FF]/20 text-[#00D1FF] text-xs font-semibold cursor-pointer"
            >
              Habilitar Módulo en Platform Control
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AxyCoreRouter() {
  const {
    authReady,
    firebaseUser,
    userProfile,
    activeSection,
    setActiveSection,
    externalPortalMode,
    selectedApplicationId,
    setSelectedApplicationId,
    selectedCollectionLoanId,
    setSelectedCollectionLoanId,
    rbac,
    getSectionTenantAccess,
    biometricLocked,
    biometricSetupPending,
    portalAccessError,
  } = useAxyCore();

  const [ecfAdjustmentPrefill, setEcfAdjustmentPrefill] =
    React.useState<EcfAdjustmentPrefill | null>(null);

  const handleSelectReferenceForAdjustment = (
    referenceDoc: DgiiEcfDocumentRecord,
    targetType: '33' | '34'
  ) => {
    setEcfAdjustmentPrefill({ referenceDoc, targetType });
    setActiveSection('ecf_emit');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#030816] flex flex-col items-center justify-center p-6 text-center">
        <div className="h-14 w-14 rounded-2xl bg-white p-2 shadow-[0_0_32px_-4px_rgba(0,184,255,0.45)] mb-4 flex items-center justify-center">
          <img
            src="/assets/aistudio/image_aea21874.png"
            alt="AxyCore"
            referrerPolicy="no-referrer"
            className="h-full w-full object-contain"
          />
        </div>
        <p className="font-display text-sm font-semibold text-slate-200">
          Inicializando sesión segura en Axy<span className="text-[#00B8FF]">Core</span>...
        </p>
      </div>
    );
  }

  // Require authenticated user, verified email, active profile, no biometric lock/pending setup, and valid portal access
  if (
    !firebaseUser ||
    !firebaseUser.emailVerified ||
    !userProfile ||
    biometricLocked ||
    biometricSetupPending ||
    portalAccessError
  ) {
    return <LoginGate />;
  }

  const renderSectionById = (sectionId: NavSectionId) => {
    switch (sectionId) {
      case 'platform_control':
        return <PlatformControlView />;
      case 'dashboard':
        return <ExecutiveDashboardView />;
      case 'system_guide':
        return <SystemGuideView />;
      case 'credit_dashboard':
        return <DashboardView />;
      case 'intelligence_dashboard':
        return <IntelligenceDashboardView />;
      case 'director':
        return <DirectorDedicatedView />;
      case 'bela':
        return <ExecutiveDashboardView />;
      case 'new_application':
        return <NewApplicationView />;
      case 'loan_calculator':
        return <LoanCalculatorView />;
      case 'applications':
        return <ApplicationsInboxView />;
      case 'decision_engine':
        return <DecisionEngineView />;
      case 'evaluation':
        return <EvaluationView />;
      case 'committee':
        return <CommitteeView />;
      case 'formalization':
        return <FormalizationView />;
      case 'disbursements':
        return <DisbursementsView />;
      case 'loans':
        return <DisbursedLoansView />;
      case 'customers':
        return <CustomersView initialSection="ALL" />;
      case 'customers_active':
        return <CustomersView initialSection="ACTIVO" />;
      case 'customers_inactive':
        return <CustomersView initialSection="INACTIVO" />;
      case 'customers_update':
        return <CustomersView initialSection="UPDATE" />;
      case 'documents':
        return <DocumentsView />;
      case 'reports':
        return <ReportsView />;
      case 'policies':
        return <PoliciesView focusTab="parameters" />;
      case 'admin_risk_bands':
        return <PoliciesView focusTab="risk_bands" />;
      case 'admin_product_limits':
        return <PoliciesView focusTab="product_limits" />;
      case 'admin_approval_matrix':
        return <PoliciesView focusTab="approval_matrix" />;
      case 'admin_workflow':
        return <PoliciesView focusTab="workflow" />;
      case 'admin_users':
        return <PoliciesView focusTab="users" />;
      case 'admin_roles':
        return <PoliciesView focusTab="roles" />;
      case 'admin_settings':
        return <PoliciesView focusTab="settings" />;
      case 'audit':
        return <AuditView />;
      case 'cobranza_dashboard':
        return <CollectionsOverviewAndGovernanceView mode="dashboard" />;
      case 'cobranza_anticipate':
        return <CollectionsOverviewAndGovernanceView mode="anticipate" />;
      case 'cobranza_portfolio':
        return <CollectionsPortfolioAndQueuesView mode="portfolio" />;
      case 'cobranza_daily':
        return <CollectionsPortfolioAndQueuesView mode="daily" />;
      case 'cobranza_urgent':
        return <CollectionsPortfolioAndQueuesView mode="urgent" />;
      case 'cobranza_legal':
        return <CollectionsPortfolioAndQueuesView mode="legal" />;
      case 'cobranza_my_actions':
        return <CollectionsActionsAndAgendaView mode="my_actions" />;
      case 'cobranza_actions':
        return <CollectionsActionsAndAgendaView mode="all_actions" />;
      case 'cobranza_agreements_today':
        return <CollectionsActionsAndAgendaView mode="agreements_today" />;
      case 'cobranza_agreements_broken':
        return <CollectionsActionsAndAgendaView mode="agreements_broken" />;
      case 'cobranza_promises':
        return <CollectionsActionsAndAgendaView mode="promises" />;
      case 'cobranza_agenda':
        return <CollectionsActionsAndAgendaView mode="agenda" />;
      case 'cobranza_payments':
        return <PaymentsAndReconciliationView mode="payments" />;
      case 'cobranza_reconciliation':
        return <PaymentsAndReconciliationView mode="reconciliation" />;
      case 'cobranza_unidentified':
        return <PaymentsAndReconciliationView mode="unidentified" />;
      case 'cobranza_contact_center':
        return <RecoveryBotAndSentinelView mode="contact_center" />;
      case 'cobranza_bot':
        return <RecoveryBotAndSentinelView mode="bot" />;
      case 'cobranza_sentinel':
        return <RecoveryBotAndSentinelView mode="sentinel" />;
      case 'cobranza_assignment':
        return <RecoveryBotAndSentinelView mode="assignment" />;
      case 'cobranza_reports':
        return <CollectionsOverviewAndGovernanceView mode="reports" />;
      case 'cobranza_params':
        return <CollectionsOverviewAndGovernanceView mode="params" />;
      case 'cobranza_audit':
        return <CollectionsOverviewAndGovernanceView mode="audit" />;
      case 'accounting':
        return <AccountingStatementsView mode="overview" />;
      case 'accounting_chart_of_accounts':
        return <AccountingLedgersAndBooksView mode="chart_of_accounts" />;
      case 'accounting_journal_entries':
        return <AccountingLedgersAndBooksView mode="journal_entries" />;
      case 'accounting_daily_book':
        return <AccountingLedgersAndBooksView mode="daily_book" />;
      case 'accounting_general_ledger':
        return <AccountingLedgersAndBooksView mode="general_ledger" />;
      case 'accounting_receivables':
        return <AccountingLedgersAndBooksView mode="receivables" />;
      case 'accounting_payables':
        return <AccountingLedgersAndBooksView mode="payables" />;
      case 'accounting_taxes':
        return <AccountingLedgersAndBooksView mode="taxes" />;
      case 'accounting_payment_validation':
        return <AccountingPaymentValidationView />;
      case 'accounting_statements':
        return <AccountingStatementsView mode="statements" />;
      case 'ecf_dashboard':
        return (
          <DgiiDashboardAndDocumentsView
            mode="dashboard"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_emit':
        return (
          <DgiiEmitInvoiceView
            initialPrefill={ecfAdjustmentPrefill}
            onClearPrefill={() => setEcfAdjustmentPrefill(null)}
          />
        );
      case 'ecf_issued':
        return (
          <DgiiDashboardAndDocumentsView
            mode="issued"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_received':
        return <DgiiReceivedEcfView />;
      case 'ecf_credit_notes':
        return (
          <DgiiDashboardAndDocumentsView
            mode="credit_notes"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_debit_notes':
        return (
          <DgiiDashboardAndDocumentsView
            mode="debit_notes"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_dgii_status':
        return (
          <DgiiDashboardAndDocumentsView
            mode="dgii_status"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_void':
        return (
          <DgiiDashboardAndDocumentsView
            mode="void"
            onSelectReferenceForAdjustment={handleSelectReferenceForAdjustment}
          />
        );
      case 'ecf_customers':
        return <DgiiMasterCatalogsView mode="customers" />;
      case 'ecf_products':
        return <DgiiMasterCatalogsView mode="products" />;
      case 'ecf_sequences':
        return <DgiiInfrastructureView mode="sequences" />;
      case 'ecf_certificates':
        return <DgiiInfrastructureView mode="certificates" />;
      case 'ecf_config':
        return <DgiiInfrastructureView mode="config" />;
      case 'ecf_sandbox':
        return <DgiiInfrastructureView mode="sandbox" />;
      case 'ecf_reports':
        return <DgiiReportsAndAuditView mode="reports" />;
      case 'ecf_audit':
        return <DgiiReportsAndAuditView mode="audit" />;
      case 'register_payment':
        return <RegisterPaymentsView />;
      case 'register_expense':
        return <RegisterExpensesView />;
      case 'register_investor':
        return <RegisterInvestorsView />;
      case 'intelligence_altera':
        return <AlteraIntelligenceView />;
      case 'intelligence_impulsa':
        return (
          <UpcomingIntelligenceModuleView
            moduleName="Impulsa"
            subtitle="Motor de Renovación Preventiva y Crecimiento de Cartera Sana"
            description="Identifica clientes con historial de pago impecable y baja exposición para pre-calificar renovaciones o líneas adicionales sin deteriorar el riesgo."
            capabilities={[
              'Detección automática de clientes con >75% del capital amortizado y 0 días de atraso histórico.',
              'Pre-evaluación instantánea con el Motor Determinístico V2.',
              'Generación de campañas supervisadas para Oficiales de Negocios.',
            ]}
          />
        );
      default:
        return <ExecutiveDashboardView />;
    }
  };

  const renderSection = () => {
    if (externalPortalMode || rbac.role === 'EXTERNAL_CLIENT') {
      if (activeSection === 'new_application') {
        return <NewApplicationView />;
      }
      if (activeSection === 'loan_calculator') {
        return <LoanCalculatorView />;
      }
      return <ClientPortalView />;
    }
    const tenantCheck = getSectionTenantAccess(activeSection);
    if (!tenantCheck.allowed) {
      return (
        <TenantModuleRestrictedView
          reason={tenantCheck.reason}
          requiredModule={tenantCheck.requiredModule ?? undefined}
        />
      );
    }
    if (!rbac.canAccessSection(activeSection)) {
      const fallbackSection: NavSectionId = rbac.allowedSections[0] ?? 'dashboard';
      return renderSectionById(fallbackSection);
    }
    return renderSectionById(activeSection);
  };

  return (
    <AppShell>
      {renderSection()}
      <ApplicationDetailDrawer
        applicationId={selectedApplicationId}
        onClose={() => setSelectedApplicationId(null)}
      />
      <CustomerLoan360Drawer
        loanId={selectedCollectionLoanId}
        onClose={() => setSelectedCollectionLoanId(null)}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AxyCoreProvider>
        <AxyCoreRouter />
      </AxyCoreProvider>
    </ErrorBoundary>
  );
}
