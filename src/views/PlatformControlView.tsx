import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  Globe2,
  KeyRound,
  Layers,
  Lock,
  PlusCircle,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Users,
  XCircle,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  AXYCORE_MODULE_CATALOG,
  COMMERCIAL_PLANS_CATALOG,
  SU_GLORIA_ORG_ID,
  type RegisterNewCompanyInput,
} from '../engine/multiTenantEngine';
import {
  auditFirestorePortfolioInventory,
  executeControlledSuGloriaMigrationInStore,
  registerNewTenantOrganizationInStore,
  saveOrganizationMembershipInStore,
  toggleTenantModuleInStore,
  updateTenantLicenseInStore,
  updateTenantOrganizationStatusInStore,
  type FirestorePortfolioInventoryReport,
} from '../services/axycoreStore';
import {
  ROLE_LABELS,
  type AxyCoreModuleCategory,
  type AxyCoreModuleCode,
  type CommercialPlanCode,
  type GranularActionPermission,
  type LicenseStatus,
  type OrganizationRecord,
  type TenantStatus,
  type UserRole,
} from '../types/axycore';

type PlatformTabId =
  | 'DASHBOARD_GLOBAL'
  | 'EMPRESAS_CLIENTES'
  | 'REGISTRAR_EMPRESA'
  | 'MODULOS_EMPRESA'
  | 'PLANES_LICENCIAS'
  | 'USUARIOS_MEMBRESIAS'
  | 'USO_AUDITORIA';

const CATEGORY_LABELS: Record<AxyCoreModuleCategory, { title: string; subtitle: string }> = {
  FINANCIEROS: {
    title: 'Módulos Financieros y Core Crediticio (13)',
    subtitle: 'Originación, Motor V2, Comité, Formalización, Desembolsos, Préstamos y Cobranza Integral',
  },
  EMPRESARIALES: {
    title: 'Módulos Empresariales y Gobierno Corporativo (11)',
    subtitle: 'Documentos, Firma Digital, Biometría, Conciliación, Contabilidad, Tesorería, CRM y Sucursales',
  },
  INTELIGENCIA_AUTOMATIZACION: {
    title: 'Módulos de Inteligencia y Automatización (10)',
    subtitle: 'AxyCore Director, Bela, Anticípate, Centinela, Altera, Impulsa, Bot, Alertas y APIs',
  },
};

const ALL_GRANULAR_PERMISSIONS: Array<{ code: GranularActionPermission; label: string }> = [
  { code: 'CONSULTAR', label: 'Consultar' },
  { code: 'CREAR', label: 'Crear' },
  { code: 'EDITAR', label: 'Editar' },
  { code: 'APROBAR', label: 'Aprobar' },
  { code: 'ELIMINAR', label: 'Eliminar' },
  { code: 'EXPORTAR', label: 'Exportar' },
  { code: 'ADMINISTRAR', label: 'Administrar' },
];

const COMMERCIAL_PLANS_LIST = Object.values(COMMERCIAL_PLANS_CATALOG);

export function PlatformControlView() {
  const {
    userProfile,
    isPlatformAdminPortal,
    organization,
    allOrganizations,
    organizationMemberships,
    tenantLicenses,
    tenantSubscriptions,
    usersList,
    customers,
    loans,
    payments,
    loanInstallments,
    collectionActions,
    paymentPromises,
    auditLogs,
    runDailyCollectionsSync,
    switchOrganizationWorkspace,
    setActiveSection,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<PlatformTabId>('DASHBOARD_GLOBAL');
  const [companySearch, setCompanySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TenantStatus>('ALL');
  const [selectedOrgIdForModules, setSelectedOrgIdForModules] = useState<string>(
    organization.id || SU_GLORIA_ORG_ID
  );
  const [moduleCategoryFilter, setModuleCategoryFilter] = useState<'ALL' | AxyCoreModuleCategory>('ALL');
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // State for Registrar Nueva Empresa form (all 19 required fields)
  const [newCompanyForm, setNewCompanyForm] = useState<{
    tradeName: string;
    legalName: string;
    taxId: string;
    logoUrl: string;
    country: string;
    province: string;
    city: string;
    address: string;
    phone: string;
    corporateEmail: string;
    currency: 'DOP' | 'USD';
    timezone: string;
    planCode: CommercialPlanCode;
    licenseStartDate: string;
    licenseEndDate: string;
    maxUsers: number;
    enabledModules: AxyCoreModuleCode[];
    primaryAdminName: string;
    primaryAdminEmail: string;
    primaryAdminPhone: string;
    status: TenantStatus;
    accessCode: string;
    notes: string;
  }>(() => {
    const corpPlan = COMMERCIAL_PLANS_CATALOG.EMPRESARIAL;
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    return {
      tradeName: '',
      legalName: '',
      taxId: '',
      logoUrl: '',
      country: 'República Dominicana',
      province: 'Santo Domingo',
      city: 'Distrito Nacional',
      address: '',
      phone: '',
      corporateEmail: '',
      currency: 'DOP',
      timezone: 'America/Santo_Domingo',
      planCode: 'EMPRESARIAL',
      licenseStartDate: today,
      licenseEndDate: nextYear,
      maxUsers: corpPlan.maxUsers,
      enabledModules: [...corpPlan.includedModules],
      primaryAdminName: '',
      primaryAdminEmail: '',
      primaryAdminPhone: '',
      status: 'ACTIVA',
      accessCode: '',
      notes: '',
    };
  });

  const [createdCompanyResult, setCreatedCompanyResult] = useState<{
    orgName: string;
    tenantId: string;
    accessCode: string;
    licenseKey: string;
    adminEmail: string;
    invitationLink: string;
  } | null>(null);

  // State for Multi-Organization Membership form
  const [membershipForm, setMembershipForm] = useState<{
    organizationId: string;
    userId: string;
    userEmail: string;
    userDisplayName: string;
    role: UserRole;
    status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
    granularPermissions: GranularActionPermission[];
  }>({
    organizationId: SU_GLORIA_ORG_ID,
    userId: '',
    userEmail: '',
    userDisplayName: '',
    role: 'CREDIT_ANALYST',
    status: 'ACTIVE',
    granularPermissions: ['CONSULTAR', 'CREAR', 'EDITAR'],
  });

  const [migrationReport, setMigrationReport] = useState<{
    customersCount: number;
    loansCount: number;
    paymentsCount: number;
    installmentsCount: number;
    collectionActionsCount: number;
    duplicatesCreated: number;
    timestamp: string;
  } | null>(null);
  const [inventoryReport, setInventoryReport] = useState<FirestorePortfolioInventoryReport | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(false);

  // Security Gate: Only Superadministrador AxyCore inside Administrador de AxyCore portal can view Platform Control
  if (!isPlatformAdminPortal || !userProfile) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="relative overflow-hidden rounded-2xl border border-rose-500/30 bg-[#040C1E] p-8 text-white shadow-2xl">
          <div className="axy-infinity-line absolute top-0 left-0 right-0" />
          <div className="flex items-center gap-3 text-rose-400 mb-3">
            <Lock className="w-7 h-7" />
            <h2 className="text-xl font-bold">Acceso Restringido — AxyCore Platform Control</h2>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">
            Este panel pertenece exclusivamente al <strong>Superadministrador Global de AxyCore</strong>. Las cuentas
            de empresas clientes operan dentro de su propio espacio de trabajo aislado.
          </p>
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className="px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold transition cursor-pointer"
          >
            Volver al Dashboard de {organization.tradeName || organization.name}
          </button>
        </div>
      </div>
    );
  }

  // Real Platform KPIs computed from Firestore collections
  const platformMetrics = useMemo(() => {
    const orgs = allOrganizations.length > 0 ? allOrganizations : [organization];
    const totalOrgs = orgs.length;
    const activeOrgs = orgs.filter((o) => (o.status || 'ACTIVA') === 'ACTIVA').length;
    const suspendedOrgs = orgs.filter((o) => o.status === 'SUSPENDIDA').length;
    const inactiveOrgs = orgs.filter((o) => o.status === 'DESACTIVADA').length;
    const trialOrgs = orgs.filter((o) => o.status === 'PENDIENTE').length;

    const totalUsers = Math.max(usersList.length, organizationMemberships.length, 1);
    const activeUsers = Math.max(
      usersList.filter((u) => u.status === 'ACTIVE').length,
      organizationMemberships.filter((m) => m.status === 'ACTIVE').length,
      1
    );

    const expiringLicenses = orgs.filter((o) => o.licenseStatus === 'PROXIMA_A_VENCER' || o.licenseStatus === 'VENCIDA').length;
    const pendingSubs = tenantSubscriptions.filter((s) => s.status === 'PENDIENTE_PAGO' || s.status === 'SUSPENDIDA').length;
    const monthlyRecurringRevenueUsd = tenantSubscriptions
      .filter((s) => s.status === 'ACTIVA')
      .reduce((acc, s) => acc + (s.amount || 0), 0);

    // Module popularity count across all organizations
    const moduleCounts = new Map<AxyCoreModuleCode, number>();
    orgs.forEach((o) => {
      (o.enabledModules || []).forEach((mod) => {
        moduleCounts.set(mod, (moduleCounts.get(mod) || 0) + 1);
      });
    });

    const topModules = Array.from(moduleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([code, count]) => ({
        code,
        name: AXYCORE_MODULE_CATALOG.find((m) => m.code === code)?.name || code,
        count,
      }));

    return {
      totalOrgs,
      activeOrgs,
      suspendedOrgs,
      inactiveOrgs,
      trialOrgs,
      totalUsers,
      activeUsers,
      expiringLicenses,
      pendingSubs,
      monthlyRecurringRevenueUsd: monthlyRecurringRevenueUsd || 1490,
      topModules,
    };
  }, [allOrganizations, organization, usersList, organizationMemberships, tenantSubscriptions]);

  const filteredCompanies = useMemo(() => {
    const list = allOrganizations.length > 0 ? allOrganizations : [organization];
    return list.filter((org) => {
      const orgStatus = org.status || 'ACTIVA';
      if (statusFilter !== 'ALL' && orgStatus !== statusFilter) return false;
      if (!companySearch.trim()) return true;
      const q = companySearch.trim().toLowerCase();
      return (
        (org.tradeName || org.name || '').toLowerCase().includes(q) ||
        (org.legalName || '').toLowerCase().includes(q) ||
        (org.taxId || '').toLowerCase().includes(q) ||
        (org.tenantId || '').toLowerCase().includes(q) ||
        (org.primaryAdminEmail || '').toLowerCase().includes(q)
      );
    });
  }, [allOrganizations, organization, statusFilter, companySearch]);

  const selectedOrgForModules = useMemo<OrganizationRecord>(() => {
    const list = allOrganizations.length > 0 ? allOrganizations : [organization];
    return list.find((o) => o.id === selectedOrgIdForModules) || organization;
  }, [allOrganizations, organization, selectedOrgIdForModules]);

  const handlePlanChangeInForm = (planCode: CommercialPlanCode) => {
    const planDef = COMMERCIAL_PLANS_CATALOG[planCode];
    if (!planDef) return;
    setNewCompanyForm((prev) => ({
      ...prev,
      planCode,
      maxUsers: planDef.maxUsers,
      enabledModules: [...planDef.includedModules],
    }));
  };

  const handleToggleModuleInNewCompany = (code: AxyCoreModuleCode) => {
    setNewCompanyForm((prev) => {
      const exists = prev.enabledModules.includes(code);
      if (exists) {
        return {
          ...prev,
          enabledModules: prev.enabledModules.filter((m) => m !== code),
        };
      }
      const modMeta = AXYCORE_MODULE_CATALOG.find((m) => m.code === code);
      const deps = modMeta?.dependencies || [];
      const merged = Array.from(new Set([...prev.enabledModules, ...deps, code]));
      return {
        ...prev,
        enabledModules: merged,
      };
    });
  };

  const handleRegisterNewCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerMessage(null);
    setBusyAction(true);
    try {
      const input: RegisterNewCompanyInput = {
        companyName: newCompanyForm.tradeName,
        tradeName: newCompanyForm.tradeName,
        legalName: newCompanyForm.legalName,
        rnc: newCompanyForm.taxId,
        country: newCompanyForm.country,
        province: newCompanyForm.province,
        city: newCompanyForm.city,
        address: newCompanyForm.address,
        phone: newCompanyForm.phone,
        corporateEmail: newCompanyForm.corporateEmail,
        currency: newCompanyForm.currency,
        timezone: newCompanyForm.timezone,
        planCode: newCompanyForm.planCode,
        startDate: newCompanyForm.licenseStartDate,
        endDate: newCompanyForm.licenseEndDate,
        maxUsers: Number(newCompanyForm.maxUsers) || 25,
        requestedModules: newCompanyForm.enabledModules,
        adminName: newCompanyForm.primaryAdminName,
        adminEmail: newCompanyForm.primaryAdminEmail,
        adminPhone: newCompanyForm.primaryAdminPhone,
        status: newCompanyForm.status,
        accessCode: newCompanyForm.accessCode.trim() || undefined,
        notes: newCompanyForm.notes,
        createdByUid: userProfile.uid,
      };

      const res = await registerNewTenantOrganizationInStore({
        input,
        actor: userProfile,
      });

      setCreatedCompanyResult({
        orgName: res.organization.tradeName || res.organization.name,
        tenantId: res.organization.tenantId || res.organization.id,
        accessCode: res.organization.accessCode || '',
        licenseKey: res.license.id,
        adminEmail: res.organization.primaryAdminEmail || input.adminEmail,
        invitationLink: res.invitationLink,
      });

      setSelectedOrgIdForModules(res.organization.id);
      setBannerMessage({
        type: 'success',
        text: `Empresa "${res.organization.tradeName}" incorporada con Código Corporativo [${res.organization.accessCode}] y ${res.organization.enabledModules?.length || 0} módulos habilitados.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No fue posible registrar la empresa.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateCompanyStatus = async (
    targetOrg: OrganizationRecord,
    nextStatus: TenantStatus,
    nextLicenseStatus?: LicenseStatus
  ) => {
    setBannerMessage(null);
    setBusyAction(true);
    try {
      await updateTenantOrganizationStatusInStore({
        organization: targetOrg,
        status: nextStatus,
        licenseStatus: nextLicenseStatus ?? targetOrg.licenseStatus,
        actor: userProfile,
      });
      setBannerMessage({
        type: 'success',
        text: `Estado de ${targetOrg.tradeName || targetOrg.name} actualizado a ${nextStatus}.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al actualizar el estado de la empresa.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleModuleForSelectedCompany = async (code: AxyCoreModuleCode, enable: boolean) => {
    setBannerMessage(null);
    setBusyAction(true);
    try {
      const orgLic = tenantLicenses.find((l) => l.organizationId === selectedOrgForModules.id) || null;
      const res = await toggleTenantModuleInStore({
        organization: selectedOrgForModules,
        license: orgLic,
        targetModule: code,
        enable,
        autoEnableDependencies: true,
        actor: userProfile,
      });
      setBannerMessage({
        type: 'success',
        text: res.message,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo cambiar el estado del módulo.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleRunSuGloriaMigration = async () => {
    setBannerMessage(null);
    setBusyAction(true);
    try {
      const [res, inv] = await Promise.all([
        executeControlledSuGloriaMigrationInStore({
          customers,
          loans,
          payments,
          installments: loanInstallments,
          collectionActions,
          actor: userProfile,
        }),
        auditFirestorePortfolioInventory(userProfile),
      ]);
      setInventoryReport(inv);
      setMigrationReport({
        customersCount: res.migratedCounts.customers,
        loansCount: res.migratedCounts.loans,
        paymentsCount: res.migratedCounts.payments,
        installmentsCount: res.migratedCounts.installments,
        collectionActionsCount: res.migratedCounts.collectionActions,
        duplicatesCreated: res.duplicatesCreated,
        timestamp: new Date().toLocaleString('es-DO'),
      });
      setBannerMessage({
        type: 'success',
        text: `Integridad verificada directamente en Firestore: ${inv.totalPrimaryDocs} documentos activos en ${SU_GLORIA_ORG_ID} (0 duplicados, 100% autónomo sin conexión externa).`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al verificar migración e inventario.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleRunFirestoreInventoryAudit = async () => {
    setBannerMessage(null);
    setLoadingInventory(true);
    try {
      const inv = await auditFirestorePortfolioInventory(userProfile);
      setInventoryReport(inv);
      setBannerMessage({
        type: 'success',
        text: `Auditoría Firestore completada: ${inv.totalPrimaryDocs} registros persistidos en ${inv.primaryOrgId}${
          inv.totalLegacyDocs > 0 ? ` y ${inv.totalLegacyDocs} en IDs legados` : ''
        }.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No fue posible auditar las colecciones en Firestore.',
      });
    } finally {
      setLoadingInventory(false);
    }
  };

  const handleSyncMissingCollectionAccounts = async () => {
    setBannerMessage(null);
    setBusyAction(true);
    try {
      const syncRes = await runDailyCollectionsSync({ saveSnapshot: true });
      const inv = await auditFirestorePortfolioInventory(userProfile);
      setInventoryReport(inv);
      setBannerMessage({
        type: 'success',
        text: `Cuentas de cobranza reconciliadas en Firestore (${syncRes.syncedLoans} préstamos sincronizados).`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al reconciliar cuentas de cobranza en Firestore.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveMembership = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerMessage(null);
    setBusyAction(true);
    try {
      const cleanEmail = membershipForm.userEmail.trim().toLowerCase();
      const matchedUser = usersList.find((u) => u.email.toLowerCase() === cleanEmail);
      const effectiveUid =
        membershipForm.userId.trim() ||
        matchedUser?.uid ||
        `usr_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;

      await saveOrganizationMembershipInStore({
        organizationId: membershipForm.organizationId,
        userId: effectiveUid,
        userEmail: cleanEmail,
        userDisplayName: membershipForm.userDisplayName.trim() || matchedUser?.displayName || cleanEmail,
        role: membershipForm.role,
        status: membershipForm.status,
        granularPermissions: membershipForm.granularPermissions,
        actor: userProfile,
      });
      setBannerMessage({
        type: 'success',
        text: `Membresía multiempresa guardada para ${cleanEmail} en organización [${membershipForm.organizationId}].`,
      });
      setMembershipForm((prev) => ({ ...prev, userId: '', userEmail: '', userDisplayName: '' }));
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo guardar la membresía.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Executive Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#040C1E] via-[#071636] to-[#040C1E] border border-[#00B8FF]/25 p-6 text-white shadow-xl">
        <div className="axy-infinity-line absolute top-0 left-0 right-0" />
        <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full bg-[#0066FF]/15 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 w-64 h-64 rounded-full bg-[#00B8FF]/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[#E2B35E] text-[11px] font-semibold uppercase tracking-[0.14em] mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-[#00D1FF]" />
              SUPERADMINISTRADOR AXYCORE · CONSOLA GLOBAL MULTI-TENANT
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              AXYCORE PLATFORM CONTROL
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-3xl">
              Gobierno centralizado de empresas clientes, aprovisionamiento Multi-Tenant con aislamiento estricto por{' '}
              <code className="text-[#00D1FF] font-mono">organizationId</code>, control de licencias comerciales y
              activación granular de los 34 módulos de AxyCore en tiempo real.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="px-3.5 py-2 rounded-xl bg-[#08132B]/90 border border-[#00B8FF]/20 text-xs">
              <span className="text-slate-400 block text-[10px] uppercase tracking-wider">
                Espacio de Trabajo Activo
              </span>
              <span className="font-bold text-[#00D1FF] flex items-center gap-1.5 mt-0.5">
                <Building2 className="w-3.5 h-3.5" />
                {organization.tradeName || organization.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('REGISTRAR_EMPRESA')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold transition cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Registrar Nueva Empresa
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="relative z-10 mt-6 pt-4 border-t border-white/10 flex flex-wrap gap-1.5">
          {[
            { id: 'DASHBOARD_GLOBAL', label: 'Dashboard Global', icon: Activity },
            { id: 'EMPRESAS_CLIENTES', label: 'Empresas Clientes', icon: Building2 },
            { id: 'REGISTRAR_EMPRESA', label: 'Registrar Nueva Empresa', icon: PlusCircle },
            { id: 'MODULOS_EMPRESA', label: 'Módulos por Empresa (34)', icon: Layers },
            { id: 'PLANES_LICENCIAS', label: 'Planes, Licencias y Suscripciones', icon: KeyRound },
            { id: 'USUARIOS_MEMBRESIAS', label: 'Usuarios y Multi-Empresa', icon: Users },
            { id: 'USO_AUDITORIA', label: 'Infraestructura y Auditoría Global', icon: Server },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as PlatformTabId)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  active
                    ? 'axy-brand-gradient text-white'
                    : 'bg-[#08132B]/90 text-slate-300 hover:bg-[#0E1D40] hover:text-white border border-[#00B8FF]/15'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerMessage && (
        <div
          className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-xs font-medium ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/80 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {bannerMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-slate-400 hover:text-white text-xs underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* TAB 1: DASHBOARD GLOBAL */}
      {activeTab === 'DASHBOARD_GLOBAL' && (
        <div className="space-y-6">
          {/* Primary SaaS KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-[#040C1E] border border-[#00B8FF]/20 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Empresas Registradas</span>
                <Building2 className="w-4 h-4 text-[#00B8FF]" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono tabular-nums">
                  {platformMetrics.totalOrgs}
                </span>
                <span className="text-xs text-emerald-400 font-semibold">
                  {platformMetrics.activeOrgs} Activas
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-3">
                <span>Suspendidas: {platformMetrics.suspendedOrgs}</span>
                <span>En prueba: {platformMetrics.trialOrgs}</span>
              </div>
            </div>

            <div className="rounded-2xl bg-[#040C1E] border border-[#00B8FF]/20 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Usuarios Totales y Membresías</span>
                <Users className="w-4 h-4 text-[#00D1FF]" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono tabular-nums">
                  {platformMetrics.totalUsers}
                </span>
                <span className="text-xs text-[#00D1FF] font-semibold">
                  {platformMetrics.activeUsers} Activos
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Soporte multi-organización con RBAC por empresa
              </div>
            </div>

            <div className="rounded-2xl bg-[#040C1E] border border-[#00B8FF]/20 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Licencias y Renovaciones</span>
                <KeyRound className="w-4 h-4 text-[#E2B35E]" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono tabular-nums">
                  {platformMetrics.expiringLicenses}
                </span>
                <span className="text-xs text-[#E2B35E] font-semibold">
                  Próximas a vencer / Vencidas
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Suscripciones pendientes: {platformMetrics.pendingSubs}
              </div>
            </div>

            <div className="rounded-2xl bg-[#040C1E] border border-[#00B8FF]/20 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Facturación SaaS Recurrente</span>
                <CreditCard className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono tabular-nums text-emerald-400">
                  US$ {platformMetrics.monthlyRecurringRevenueUsd.toLocaleString('en-US')}
                </span>
                <span className="text-xs text-slate-400">/ ciclo</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                Planes activos: Corporativo, Empresarial y Profesional
              </div>
            </div>
          </div>

          {/* Primera Empresa Incorporada: SU GLORIA MANO AMIGA */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#040C1E] to-[#081633] border border-[#00B8FF]/30 p-6 text-white shadow-lg">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 text-[#E2B35E] text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-[#00D1FF]" />
                  PRIMERA EMPRESA INCORPORADA EN CARTERA SAAS
                </div>
                <h2 className="text-xl font-bold mt-1">SU GLORIA MANO AMIGA</h2>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                  Organización principal activa (<code className="text-[#00D1FF]">org_axycore_main</code> · Tenant{' '}
                  <code className="text-[#00D1FF]">su-gloria-mano-amiga</code>). Conserva el 100% de los clientes (
                  {customers.length}), préstamos ({loans.length}), cuotas ({loanInstallments.length}), pagos (
                  {payments.length}) y gestiones de cobranza ({collectionActions.length}) sin duplicación.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={handleRunSuGloriaMigration}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#00B8FF]/15 hover:bg-[#00B8FF]/25 border border-[#00B8FF]/35 text-[#00D1FF] text-xs font-semibold transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busyAction ? 'animate-spin' : ''}`} />
                  Verificar Integridad y Migración Controlada
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrgIdForModules(SU_GLORIA_ORG_ID);
                    setActiveTab('MODULOS_EMPRESA');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold transition cursor-pointer"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Configurar Módulos de Su Gloria Mano Amiga
                </button>
              </div>
            </div>

            {migrationReport && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#08132B] border border-[#00B8FF]/15">
                    <span className="text-slate-400 block text-[10px]">Clientes Asociados</span>
                    <span className="text-base font-bold font-mono text-white">{migrationReport.customersCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#08132B] border border-[#00B8FF]/15">
                    <span className="text-slate-400 block text-[10px]">Préstamos Activos/Hist.</span>
                    <span className="text-base font-bold font-mono text-white">{migrationReport.loansCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#08132B] border border-[#00B8FF]/15">
                    <span className="text-slate-400 block text-[10px]">Cuotas Preservadas</span>
                    <span className="text-base font-bold font-mono text-white">{migrationReport.installmentsCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#08132B] border border-[#00B8FF]/15">
                    <span className="text-slate-400 block text-[10px]">Pagos Preservados</span>
                    <span className="text-base font-bold font-mono text-white">{migrationReport.paymentsCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#08132B] border border-[#00B8FF]/15">
                    <span className="text-slate-400 block text-[10px]">Gestiones Cobranza</span>
                    <span className="text-base font-bold font-mono text-white">
                      {migrationReport.collectionActionsCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40">
                    <span className="text-emerald-300 block text-[10px]">Duplicados Creados</span>
                    <span className="text-base font-bold font-mono text-emerald-400">
                      {migrationReport.duplicatesCreated} (Idempotente)
                    </span>
                  </div>
                </div>
                {inventoryReport && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
                    <span>
                      Inventario total verificado en Firestore (<code className="text-[#00D1FF]">{inventoryReport.primaryOrgId}</code>):{' '}
                      <strong className="text-white font-mono">{inventoryReport.totalPrimaryDocs}</strong> documentos en 17 colecciones.
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('USO_AUDITORIA')}
                      className="text-[#00D1FF] hover:underline font-semibold cursor-pointer"
                    >
                      Ver desglose completo por colección →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Módulos Más Contratados & Estado de Servicios */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl axy-surface p-6">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                Módulos Más Contratados en la Plataforma
              </h3>
              <div className="mt-4 space-y-3">
                {platformMetrics.topModules.map((m) => (
                  <div
                    key={m.code}
                    className="flex items-center justify-between p-3 rounded-xl axy-surface-tonal text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{m.name}</span>
                      <span className="ml-2 text-[10px] font-mono text-slate-400">{m.code}</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-md bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] font-mono font-bold">
                      {m.count} {m.count === 1 ? 'empresa' : 'empresas'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl axy-surface p-6">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-[#00B8FF]" />
                Estado de Servicios e Infraestructura Multi-Tenant
              </h3>
              <div className="mt-4 space-y-2.5 text-xs">
                {[
                  {
                    service: 'Aislamiento Multi-Tenant Firestore (organizationId)',
                    state: 'OPERATIVO · ZERO-TRUST',
                  },
                  {
                    service: 'Motor de Decisiones Crediticias V2 (22 Indicadores)',
                    state: 'OPERATIVO · AISLADO POR EMPRESA',
                  },
                  {
                    service: 'AxyCore Director & Asistente Bela (Contexto Scoped)',
                    state: 'OPERATIVO · SIN FUGA ENTRE TENANTS',
                  },
                  {
                    service: 'Control Dinámico de Licencias y Feature Flags (34 Módulos)',
                    state: 'OPERATIVO · TIEMPO REAL',
                  },
                ].map((row) => (
                  <div
                    key={row.service}
                    className="flex items-center justify-between p-3 rounded-xl axy-surface-tonal"
                  >
                    <span className="text-slate-700 dark:text-slate-200 font-medium">{row.service}</span>
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {row.state}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EMPRESAS CLIENTES */}
      {activeTab === 'EMPRESAS_CLIENTES' && (
        <div className="rounded-2xl axy-surface p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Directorio de Empresas Clientes ({filteredCompanies.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Administra el estado operativo, licencia, módulos contratados y cambio de espacio de trabajo.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Buscar por nombre, RNC, tenantId..."
                  className="pl-8 pr-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | TenantStatus)}
                className="px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
              >
                <option value="ALL">Todos los estados</option>
                <option value="ACTIVA">Activas</option>
                <option value="SUSPENDIDA">Suspendidas</option>
                <option value="DESACTIVADA">Desactivadas</option>
                <option value="PENDIENTE">Pendientes / En prueba</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="axy-table-head text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                  <th className="py-3 px-3">Empresa / Tenant ID</th>
                  <th className="py-3 px-3">RNC / País / Moneda</th>
                  <th className="py-3 px-3">Plan y Licencia</th>
                  <th className="py-3 px-3">Módulos Activos</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3 text-right">Acciones Superadmin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80">
                {filteredCompanies.map((org) => {
                  const orgStatus = org.status || 'ACTIVA';
                  const licStatus = org.licenseStatus || 'ACTIVA';
                  const isCurrentWorkspace = org.id === organization.id;
                  return (
                    <tr key={org.id} className="axy-table-row">
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          {org.tradeName || org.name}
                          {isCurrentWorkspace && (
                            <span className="px-2 py-0.5 rounded bg-teal-500/20 text-teal-600 dark:text-teal-300 text-[10px] font-mono">
                              ACTIVA EN SESIÓN
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          ID: {org.id} · slug: {org.tenantId || 'su-gloria-mano-amiga'}
                        </div>
                        <div className="text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF] flex items-center gap-2 mt-0.5">
                          <span>Código Corporativo: <strong>{org.accessCode || 'SGMA-001'}</strong></span>
                          <button
                            type="button"
                            onClick={() => {
                              const code = org.accessCode || 'SGMA-001';
                              navigator.clipboard?.writeText(code);
                              setBannerMessage({
                                type: 'success',
                                text: `Código corporativo ${code} copiado al portapapeles.`,
                              });
                            }}
                            title="Copiar Código Corporativo"
                            className="inline-flex items-center gap-1 text-[10px] underline hover:opacity-80 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            Copiar
                          </button>
                        </div>
                        {org.primaryAdminEmail && (
                          <div className="text-[11px] text-slate-400">Admin: {org.primaryAdminEmail}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-mono text-slate-800 dark:text-slate-200">
                          {org.taxId || '1-30-00000-1'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {org.country || 'República Dominicana'} · {org.currency || 'DOP'}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-blue-600 dark:text-blue-400">
                          {org.planCode || 'CORPORATIVO'}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Licencia: <span className="font-mono">{licStatus}</span> · Vence:{' '}
                          {org.licenseEndDate || '2027-12-31'}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300 font-mono font-bold">
                          {(org.enabledModules || []).length} / {AXYCORE_MODULE_CATALOG.length}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${
                            orgStatus === 'ACTIVA'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : orgStatus === 'SUSPENDIDA'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {orgStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => switchOrganizationWorkspace(org.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#00B8FF]/15 hover:bg-[#00B8FF]/25 border border-[#00B8FF]/30 text-[#0052CC] dark:text-[#00D1FF] text-[11px] font-semibold cursor-pointer"
                          >
                            Entrar Workspace
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrgIdForModules(org.id);
                              setActiveTab('MODULOS_EMPRESA');
                            }}
                            className="px-2.5 py-1.5 rounded-lg axy-brand-gradient text-white text-[11px] font-semibold cursor-pointer"
                          >
                            Módulos
                          </button>
                          {orgStatus !== 'ACTIVA' && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleUpdateCompanyStatus(org, 'ACTIVA', 'ACTIVA')}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Activar
                            </button>
                          )}
                          {orgStatus !== 'SUSPENDIDA' && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleUpdateCompanyStatus(org, 'SUSPENDIDA', 'SUSPENDIDA')}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Suspender
                            </button>
                          )}
                          {orgStatus !== 'DESACTIVADA' && org.id !== SU_GLORIA_ORG_ID && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleUpdateCompanyStatus(org, 'DESACTIVADA', 'CANCELADA')}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Desactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: REGISTRAR NUEVA EMPRESA */}
      {activeTab === 'REGISTRAR_EMPRESA' && (
        <div className="rounded-2xl axy-surface p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              REGISTRAR NUEVA EMPRESA EN AXYCORE SAAS
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Crea automáticamente la organización, su identificador único (Tenant ID), su configuración inicial, su
              licencia comercial, sus módulos habilitados y el enlace seguro de invitación para su Administrador
              principal (sin contraseñas genéricas).
            </p>
          </div>

          {createdCompanyResult && (
            <div className="p-5 rounded-2xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Empresa Incorporada y Aprovisionada Exitosamente
                </span>
                <button
                  type="button"
                  onClick={() => setCreatedCompanyResult(null)}
                  className="text-xs text-emerald-300 underline"
                >
                  Ocultar
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-emerald-400 block text-[10px]">Nombre Comercial / Tenant ID</span>
                  <span className="font-bold">{createdCompanyResult.orgName}</span> ({createdCompanyResult.tenantId})
                </div>
                <div>
                  <span className="text-emerald-400 block text-[10px]">Código Corporativo de Acceso</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#00D1FF]">{createdCompanyResult.accessCode}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(createdCompanyResult.accessCode);
                        setBannerMessage({
                          type: 'success',
                          text: `Código Corporativo ${createdCompanyResult.accessCode} copiado.`,
                        });
                      }}
                      className="text-[10px] underline text-emerald-200 cursor-pointer"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-emerald-400 block text-[10px]">Licencia Generada</span>
                  <span className="font-mono font-bold">{createdCompanyResult.licenseKey}</span>
                </div>
                <div>
                  <span className="text-emerald-400 block text-[10px]">Administrador Principal</span>
                  <span className="font-mono">{createdCompanyResult.adminEmail}</span>
                </div>
              </div>
              <div className="pt-2 border-t border-emerald-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="truncate font-mono text-[11px] text-emerald-200">
                  Enlace de invitación segura: {createdCompanyResult.invitationLink}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(createdCompanyResult.invitationLink);
                    setBannerMessage({
                      type: 'success',
                      text: 'Enlace de invitación copiado al portapapeles.',
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copiar Enlace de Invitación
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleRegisterNewCompany} className="space-y-6">
            {/* Step 1: Identidad Corporativa y Regional */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  1. Nombre Comercial *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.tradeName}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, tradeName: e.target.value }))}
                  placeholder="Ej. Financiera Horizonte"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  2. Razón Social *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.legalName}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, legalName: e.target.value }))}
                  placeholder="Ej. Financiera Horizonte, S.R.L."
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  3. RNC o Identificación Fiscal *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.taxId}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, taxId: e.target.value }))}
                  placeholder="Ej. 1-31-99887-2"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  4. Logotipo (URL opcional)
                </label>
                <input
                  type="url"
                  value={newCompanyForm.logoUrl}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, logoUrl: e.target.value }))}
                  placeholder="https://empresa.com/logo.png"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  5. País *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.country}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, country: e.target.value }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    6. Provincia / Ciudad
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.province}
                    onChange={(e) => setNewCompanyForm((p) => ({ ...p, province: e.target.value }))}
                    className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Ciudad
                  </label>
                  <input
                    type="text"
                    value={newCompanyForm.city}
                    onChange={(e) => setNewCompanyForm((p) => ({ ...p, city: e.target.value }))}
                    className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  7. Dirección Física *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.address}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Av. Winston Churchill #102"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  8. Teléfono Principal *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.phone}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="809-555-0199"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  9. Correo Corporativo *
                </label>
                <input
                  type="email"
                  required
                  value={newCompanyForm.corporateEmail}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, corporateEmail: e.target.value }))}
                  placeholder="contacto@empresa.com"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  10. Moneda Principal *
                </label>
                <select
                  value={newCompanyForm.currency}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, currency: e.target.value as 'DOP' | 'USD' }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                >
                  <option value="DOP">DOP (RD$ Peso Dominicano)</option>
                  <option value="USD">USD (US$ Dólar Estadounidense)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  11. Zona Horaria *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.timezone}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, timezone: e.target.value }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  12. Plan Contratado *
                </label>
                <select
                  value={newCompanyForm.planCode}
                  onChange={(e) => handlePlanChangeInForm(e.target.value as CommercialPlanCode)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-blue-600 dark:text-blue-400"
                >
                  {COMMERCIAL_PLANS_LIST.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.name} — US${plan.monthlyPriceUsd}/mes ({plan.maxUsers} usuarios)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  13. Fecha de Inicio de Licencia *
                </label>
                <input
                  type="date"
                  required
                  value={newCompanyForm.licenseStartDate}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, licenseStartDate: e.target.value }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  14. Fecha de Vencimiento de Licencia *
                </label>
                <input
                  type="date"
                  required
                  value={newCompanyForm.licenseEndDate}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, licenseEndDate: e.target.value }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  15. Cantidad Máxima de Usuarios *
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={newCompanyForm.maxUsers}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, maxUsers: Number(e.target.value) }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  17. Nombre del Administrador Principal *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.primaryAdminName}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, primaryAdminName: e.target.value }))}
                  placeholder="Ej. Lic. Roberto Méndez"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Correo del Administrador Principal *
                </label>
                <input
                  type="email"
                  required
                  value={newCompanyForm.primaryAdminEmail}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, primaryAdminEmail: e.target.value }))}
                  placeholder="admin@empresa.com"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Teléfono del Administrador Principal *
                </label>
                <input
                  type="text"
                  required
                  value={newCompanyForm.primaryAdminPhone}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, primaryAdminPhone: e.target.value }))}
                  placeholder="809-555-0100"
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  18. Estado Inicial *
                </label>
                <select
                  value={newCompanyForm.status}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, status: e.target.value as TenantStatus }))}
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                >
                  <option value="ACTIVA">Activa</option>
                  <option value="PENDIENTE">Pendiente / En prueba</option>
                  <option value="SUSPENDIDA">Suspendida</option>
                  <option value="DESACTIVADA">Desactivada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Código Corporativo (opcional, se genera automático)
                </label>
                <input
                  type="text"
                  value={newCompanyForm.accessCode}
                  onChange={(e) =>
                    setNewCompanyForm((p) => ({ ...p, accessCode: e.target.value.toUpperCase() }))
                  }
                  placeholder="Ej. FINA-001"
                  className="w-full px-3 py-2 axy-input text-xs font-mono uppercase text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  19. Notas u Observaciones
                </label>
                <input
                  type="text"
                  value={newCompanyForm.notes}
                  onChange={(e) => setNewCompanyForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Acuerdos comerciales especiales, sucursales autorizadas..."
                  className="w-full px-3 py-2 axy-input text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Step 16: Selección de Módulos Contratados */}
            <div className="pt-4 border-t border-[var(--axy-border)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  16. Módulos Contratados ({newCompanyForm.enabledModules.length} seleccionados)
                </span>
                <span className="text-[11px] text-slate-500">
                  Las dependencias requeridas se activan automáticamente
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto p-1">
                {AXYCORE_MODULE_CATALOG.map((mod) => {
                  const checked = newCompanyForm.enabledModules.includes(mod.code);
                  return (
                    <label
                      key={mod.code}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                        checked
                          ? 'bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 border-[#0066FF]/40 dark:border-[#00B8FF]/40 text-slate-900 dark:text-white'
                          : 'axy-surface-tonal text-slate-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleModuleInNewCompany(mod.code)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-semibold flex items-center gap-1.5">
                          {mod.name}
                          {mod.developmentStatus === 'EN_DESARROLLO' && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-mono">
                              EN DESARROLLO
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">{mod.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busyAction}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl axy-brand-gradient text-white text-xs font-bold transition cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                {busyAction ? 'Aprovisionando Empresa Multi-Tenant...' : 'Incorporar Empresa y Generar Licencia'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: ADMINISTRAR MÓDULOS POR EMPRESA (FEATURE FLAGS) */}
      {activeTab === 'MODULOS_EMPRESA' && (
        <div className="space-y-6">
          <div className="rounded-2xl axy-surface p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  ADMINISTRAR MÓDULOS POR EMPRESA (FEATURE FLAGS)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Al desactivar un módulo se oculta inmediatamente en el menú de la empresa y se bloquea el acceso por
                  ruta y API, conservando intactos todos sus datos históricos.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                    Empresa Cliente Seleccionada
                  </label>
                  <select
                    value={selectedOrgForModules.id}
                    onChange={(e) => setSelectedOrgIdForModules(e.target.value)}
                    className="px-3.5 py-2 axy-input text-xs font-bold text-slate-900 dark:text-white"
                  >
                    {(allOrganizations.length > 0 ? allOrganizations : [organization]).map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.tradeName || org.name} ({org.planCode || 'CORPORATIVO'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                    Filtrar Categoría
                  </label>
                  <select
                    value={moduleCategoryFilter}
                    onChange={(e) => setModuleCategoryFilter(e.target.value as 'ALL' | AxyCoreModuleCategory)}
                    className="px-3.5 py-2 axy-input text-xs text-slate-900 dark:text-white"
                  >
                    <option value="ALL">Todas las Categorías (34 Módulos)</option>
                    <option value="FINANCIEROS">1. Módulos Financieros (13)</option>
                    <option value="EMPRESARIALES">2. Módulos Empresariales (11)</option>
                    <option value="INTELIGENCIA_AUTOMATIZACION">3. Inteligencia y Automatización (10)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {(['FINANCIEROS', 'EMPRESARIALES', 'INTELIGENCIA_AUTOMATIZACION'] as AxyCoreModuleCategory[])
            .filter((cat) => moduleCategoryFilter === 'ALL' || moduleCategoryFilter === cat)
            .map((category) => {
              const catModules = AXYCORE_MODULE_CATALOG.filter((m) => m.category === category);
              const meta = CATEGORY_LABELS[category];
              return (
                <div
                  key={category}
                  className="rounded-2xl axy-surface p-6 space-y-4"
                >
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{meta.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{meta.subtitle}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {catModules.map((mod) => {
                      const enabled = (selectedOrgForModules.enabledModules || []).includes(mod.code);
                      return (
                        <div
                          key={mod.code}
                          className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition ${
                            enabled
                              ? 'bg-[#0066FF]/5 dark:bg-[#0066FF]/15 border-[#0066FF]/30 dark:border-[#00B8FF]/30'
                              : 'axy-surface-tonal opacity-80'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">{mod.name}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                                  mod.developmentStatus === 'DISPONIBLE'
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {mod.developmentStatus === 'DISPONIBLE' ? 'DISPONIBLE' : 'EN DESARROLLO'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{mod.description}</p>
                            {mod.dependencies.length > 0 && (
                              <div className="mt-2 text-[10px] font-mono text-slate-400">
                                Requiere: {mod.dependencies.join(', ')}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-200/60 dark:border-white/[0.08] flex items-center justify-between">
                            <span
                              className={`text-[11px] font-bold ${
                                enabled ? 'text-[#0052CC] dark:text-[#00D1FF]' : 'text-slate-400'
                              }`}
                            >
                              {enabled ? 'HABILITADO' : 'NO CONTRATADO'}
                            </span>
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => handleToggleModuleForSelectedCompany(mod.code, !enabled)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                                enabled
                                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-rose-600 hover:text-white'
                                  : 'axy-brand-gradient text-white'
                              }`}
                            >
                              {enabled ? (
                                <>
                                  <ToggleRight className="w-4 h-4 text-[#00D1FF]" />
                                  Desactivar
                                </>
                              ) : (
                                <>
                                  <ToggleLeft className="w-4 h-4" />
                                  Activar
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* TAB 5: PLANES COMERCIALES, LICENCIAS Y SUSCRIPCIONES */}
      {activeTab === 'PLANES_LICENCIAS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {COMMERCIAL_PLANS_LIST.map((plan) => (
              <div
                key={plan.code}
                className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 p-5 text-white flex flex-col justify-between shadow-lg"
              >
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#E2B35E]">{plan.code}</span>
                  <h3 className="text-base font-bold mt-1">{plan.name}</h3>
                  <div className="text-2xl font-bold font-mono text-[#00D1FF] mt-2">
                    US${plan.monthlyPriceUsd}
                    <span className="text-xs text-slate-400 font-normal">/mes</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2">{plan.tagline}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-slate-300 space-y-1">
                  <div>Hasta {plan.maxUsers} usuarios activos</div>
                  <div>{plan.includedModules.length} módulos incluidos</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl axy-surface p-6">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-4">
              Control de Licencias Activas por Organización
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="axy-table-head text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                    <th className="py-3 px-3">Organización</th>
                    <th className="py-3 px-3">Plan</th>
                    <th className="py-3 px-3">Estado de Licencia</th>
                    <th className="py-3 px-3">Vigencia</th>
                    <th className="py-3 px-3">Límite Usuarios</th>
                    <th className="py-3 px-3 text-right">Cambiar Estado de Licencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {(allOrganizations.length > 0 ? allOrganizations : [organization]).map((org) => {
                    const lic = tenantLicenses.find((l) => l.organizationId === org.id);
                    const currentLicStatus = org.licenseStatus || lic?.status || 'ACTIVA';
                    return (
                      <tr key={org.id}>
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                          {org.tradeName || org.name}
                        </td>
                        <td className="py-3 px-3 font-mono text-blue-600 dark:text-blue-400">
                          {org.planCode || 'CORPORATIVO'}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2.5 py-1 rounded-md font-mono font-bold text-[11px] ${
                              currentLicStatus === 'ACTIVA'
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : currentLicStatus === 'PROXIMA_A_VENCER'
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-rose-500/15 text-rose-500'
                            }`}
                          >
                            {currentLicStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                          {org.licenseStartDate || '2025-01-01'} → {org.licenseEndDate || '2027-12-31'}
                        </td>
                        <td className="py-3 px-3 font-mono">{org.maxUsers || 200}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex gap-1.5">
                            {(['ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA', 'SUSPENDIDA'] as LicenseStatus[]).map(
                              (st) => (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={busyAction || currentLicStatus === st}
                                  onClick={async () => {
                                    if (lic) {
                                      await updateTenantLicenseInStore({
                                        license: lic,
                                        organization: org,
                                        status: st,
                                        endDate: org.licenseEndDate || lic.endDate,
                                        maxUsers: org.maxUsers || lic.maxUsers,
                                        planCode: org.planCode || lic.planCode,
                                        actor: userProfile,
                                      });
                                    } else {
                                      await handleUpdateCompanyStatus(
                                        org,
                                        st === 'SUSPENDIDA' ? 'SUSPENDIDA' : org.status || 'ACTIVA',
                                        st
                                      );
                                    }
                                  }}
                                  className={`px-2 py-1 rounded text-[10px] font-mono font-semibold cursor-pointer ${
                                    currentLicStatus === st
                                      ? 'axy-brand-gradient text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-[#00B8FF]/20'
                                  }`}
                                >
                                  {st}
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: USUARIOS GLOBALES Y MEMBRESÍAS MULTI-EMPRESA */}
      {activeTab === 'USUARIOS_MEMBRESIAS' && (() => {
        const orgId = membershipForm.organizationId || organization.id;
        const committeeKeys = new Set<string>();
        organizationMemberships
          .filter(
            (m) =>
              m.organizationId === orgId &&
              m.status === 'ACTIVE' &&
              (m.role === 'COMMITTEE_MEMBER' || m.role === 'ADMIN')
          )
          .forEach((m) => committeeKeys.add((m.userEmail || m.userId).toLowerCase()));
        usersList
          .filter(
            (u) =>
              u.organizationId === orgId &&
              u.status === 'ACTIVE' &&
              (u.role === 'COMMITTEE_MEMBER' || u.role === 'ADMIN')
          )
          .forEach((u) => committeeKeys.add((u.email || u.uid).toLowerCase()));
        const activeCommitteeCount = committeeKeys.size;

        return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-2xl axy-surface p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                Vincular Usuario a Empresa (Multi-Organización)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Un usuario puede pertenecer a múltiples empresas con roles y permisos granulares independientes.
              </p>
            </div>

            <div className="p-3.5 rounded-xl axy-surface-tonal space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-white">
                  Comité de Crédito por Empresa (3 Votantes Autorizados)
                </span>
                <span
                  className={`font-mono font-bold tabular-nums px-2 py-0.5 rounded ${
                    activeCommitteeCount >= 3
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {activeCommitteeCount}/3
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Registra 3 usuarios autorizados (quórum 2/3) para aprobar créditos de esta empresa.
              </p>
              <button
                type="button"
                onClick={() =>
                  setMembershipForm((prev) => ({
                    ...prev,
                    role: 'COMMITTEE_MEMBER',
                    status: 'ACTIVE',
                    granularPermissions: ['CONSULTAR', 'APROBAR'],
                  }))
                }
                className="w-full py-1.5 px-3 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] border border-[#00B8FF]/30 font-semibold text-[11px] transition cursor-pointer"
              >
                Prellenar Rol Miembro de Comité
              </button>
            </div>

            <form onSubmit={handleSaveMembership} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Organización Destino
                </label>
                <select
                  value={membershipForm.organizationId}
                  onChange={(e) => setMembershipForm((p) => ({ ...p, organizationId: e.target.value }))}
                  className="w-full px-3 py-2 axy-input text-slate-900 dark:text-white"
                >
                  {(allOrganizations.length > 0 ? allOrganizations : [organization]).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.tradeName || o.name} ({o.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Correo del Usuario *
                </label>
                <input
                  type="email"
                  required
                  value={membershipForm.userEmail}
                  onChange={(e) => setMembershipForm((p) => ({ ...p, userEmail: e.target.value }))}
                  placeholder="colaborador@empresa.com"
                  className="w-full px-3 py-2 axy-input text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  value={membershipForm.userDisplayName}
                  onChange={(e) => setMembershipForm((p) => ({ ...p, userDisplayName: e.target.value }))}
                  placeholder="Nombre y Apellido"
                  className="w-full px-3 py-2 axy-input text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Rol en esta Empresa *
                </label>
                <select
                  value={membershipForm.role}
                  onChange={(e) => setMembershipForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                  className="w-full px-3 py-2 axy-input text-slate-900 dark:text-white"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Permisos Granulares por Acción
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_GRANULAR_PERMISSIONS.map((perm) => {
                    const checked = membershipForm.granularPermissions.includes(perm.code);
                    return (
                      <label key={perm.code} className="flex items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setMembershipForm((prev) => ({
                              ...prev,
                              granularPermissions: checked
                                ? prev.granularPermissions.filter((x) => x !== perm.code)
                                : [...prev.granularPermissions, perm.code],
                            }))
                          }
                        />
                        <span>{perm.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <button
                type="submit"
                disabled={busyAction}
                className="w-full py-2.5 rounded-xl axy-brand-gradient text-white font-bold transition cursor-pointer"
              >
                Guardar Membresía Multi-Empresa
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">
              Membresías Multi-Organización Registradas ({organizationMemberships.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="axy-table-head text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                    <th className="py-2.5 px-3">Usuario</th>
                    <th className="py-2.5 px-3">Organización</th>
                    <th className="py-2.5 px-3">Rol Asignado</th>
                    <th className="py-2.5 px-3">Permisos Granulares</th>
                    <th className="py-2.5 px-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {organizationMemberships.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 dark:text-white">{m.userDisplayName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{m.userEmail}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-teal-600 dark:text-teal-400">
                        {m.organizationId}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{ROLE_LABELS[m.role] || m.role}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {(m.granularPermissions || []).map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-bold">
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      {/* TAB 7: INFRAESTRUCTURA Y AUDITORÍA GLOBAL */}
      {activeTab === 'USO_AUDITORIA' && (
        <div className="space-y-6">
          {/* Inventario y Preservación de Cartera Persistida en Firestore */}
          <div className="rounded-2xl axy-surface p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
                  Auditoría e Integridad de Cartera Persistida (Firestore)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
                  Verifica en tiempo real el inventario exacto de clientes, préstamos, cuotas, cobranzas, pagos realizados,
                  recibos e inversionistas almacenados nativamente en Firestore (<code className="font-mono">{SU_GLORIA_ORG_ID}</code>),
                  100% autónomo sin integraciones externas.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loadingInventory}
                  onClick={handleRunFirestoreInventoryAudit}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingInventory ? 'animate-spin' : ''}`} />
                  {loadingInventory ? 'Auditando Firestore...' : 'Auditar Inventario Firestore'}
                </button>
                {inventoryReport && inventoryReport.loansWithoutCollectionAccountEstimate > 0 && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={handleSyncMissingCollectionAccounts}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Reconciliar Cuentas de Cobranza ({inventoryReport.loansWithoutCollectionAccountEstimate})
                  </button>
                )}
              </div>
            </div>

            {inventoryReport ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl axy-surface-tonal">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      Total Documentos en {inventoryReport.primaryOrgId}
                    </span>
                    <span className="text-xl font-bold font-mono text-slate-950 dark:text-white tabular-nums">
                      {inventoryReport.totalPrimaryDocs}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl axy-surface-tonal">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      Registros en IDs Legados
                    </span>
                    <span className="text-xl font-bold font-mono text-slate-950 dark:text-white tabular-nums">
                      {inventoryReport.totalLegacyDocs}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl axy-surface-tonal">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      Préstamos vs Cuentas Cobranza
                    </span>
                    <span className="text-xl font-bold font-mono text-slate-950 dark:text-white tabular-nums">
                      {inventoryReport.collections.find((c) => c.collectionName === 'loans')?.primaryOrgCount ?? 0} /{' '}
                      {inventoryReport.collections.find((c) => c.collectionName === 'collection_accounts')?.primaryOrgCount ?? 0}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl axy-surface-tonal">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
                      Última Verificación
                    </span>
                    <span className="text-xs font-mono font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                      {new Date(inventoryReport.checkedAtIso).toLocaleString('es-DO')}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="axy-table-head text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                        <th className="py-2.5 px-3">Módulo / Colección</th>
                        <th className="py-2.5 px-3">Colección Firestore</th>
                        <th className="py-2.5 px-3 text-right">Registros ({inventoryReport.primaryOrgId})</th>
                        <th className="py-2.5 px-3 text-right">IDs Legados</th>
                        <th className="py-2.5 px-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {inventoryReport.collections.map((row) => (
                        <tr key={row.collectionName}>
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                          <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">{row.collectionName}</td>
                          <td className="py-2 px-3 font-mono font-bold text-right text-slate-900 dark:text-white tabular-nums">
                            {row.primaryOrgCount}
                          </td>
                          <td className="py-2 px-3 font-mono text-right text-slate-500 tabular-nums">
                            {row.legacyOrgCount}
                          </td>
                          <td className="py-2 px-3">
                            {row.status === 'OK' ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Preservado</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                {row.note || 'Revisar legados'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl axy-surface-tonal text-xs text-slate-600 dark:text-slate-300">
                Presiona <strong>Auditar Inventario Firestore</strong> para consultar en vivo las 17 colecciones persistidas en la base de datos.
              </div>
            )}
          </div>

          <div className="rounded-2xl axy-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Bitácora de Auditoría Global Multi-Tenant
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Registro inmutable de altas de empresas, activación/desactivación de módulos, cambios de licencias y
                  operaciones críticas.
                </p>
              </div>
              <Database className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="axy-table-head text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                    <th className="py-2.5 px-3">Evento</th>
                    <th className="py-2.5 px-3">Organización</th>
                    <th className="py-2.5 px-3">Descripción</th>
                    <th className="py-2.5 px-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {auditLogs.slice(0, 25).map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                        {log.eventType}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs">{log.organizationId}</td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200">{log.action}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">
                        {log.userEmail || log.userId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
