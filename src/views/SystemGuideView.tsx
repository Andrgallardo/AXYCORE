import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  GitBranch,
  Globe,
  Layers,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  ALL_CREDIT_PERMISSIONS,
  CREDIT_ROLE_PROFILES,
  PERMISSION_LABELS,
  ROLE_PERMISSION_MATRIX,
  SECTION_ACCESS_BY_ROLE,
} from '../engine/rbac';
import {
  AXYCORE_MODULE_CATALOG,
  COMMERCIAL_PLANS_CATALOG,
  DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE,
  getModuleByCode,
  MODULE_CATEGORY_LABELS,
  SU_GLORIA_ENABLED_MODULES,
} from '../engine/multiTenantEngine';
import {
  computeGuideAccessSummary,
  filterSystemGuideAreas,
  GUIDE_DOMAIN_LABELS,
  SYSTEM_GUIDE_AREAS,
  SYSTEM_GUIDE_FLOWS,
  SYSTEM_GUIDE_PORTALS,
  SYSTEM_TECHNICAL_PILLARS,
  type GuideDomainCategory,
} from '../engine/systemGuideCatalog';
import {
  ROLE_LABELS,
  type AxyCoreModuleCategory,
  type NavSectionId,
  type UserRole,
} from '../types/axycore';

type GuideTabId = 'MAPA' | 'FLUJOS' | 'ROLES_PORTALES' | 'CATALOGO';

const GUIDE_TABS: Array<{
  id: GuideTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'MAPA', label: 'Mapa del Sistema', icon: BookOpen },
  { id: 'FLUJOS', label: 'Flujos de Punta a Punta', icon: GitBranch },
  { id: 'ROLES_PORTALES', label: 'Roles, Permisos y Portales', icon: Users },
  { id: 'CATALOGO', label: 'Catálogo de Módulos (34)', icon: Layers },
];

const DOMAIN_FILTERS: GuideDomainCategory[] = [
  'ALL',
  'INICIO_CONTROL',
  'CREDITO_CLIENTES',
  'COBROS_CONTACT',
  'CONTABILIDAD_DGII',
  'INTELIGENCIA_ADMIN',
];

export function SystemGuideView() {
  const {
    organization,
    rbac,
    setActiveSection,
    getSectionTenantAccess,
    isPlatformAdminPortal,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<GuideTabId>('MAPA');
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<GuideDomainCategory>('ALL');
  const [selectedAreaId, setSelectedAreaId] = useState<string>('ALL');

  const [selectedFlowId, setSelectedFlowId] = useState<string>(SYSTEM_GUIDE_FLOWS[0].id);
  const [selectedRole, setSelectedRole] = useState<UserRole>(rbac.role || 'ADMIN');
  const [catalogCategory, setCatalogCategory] = useState<'ALL' | AxyCoreModuleCategory>('ALL');
  const [catalogStateFilter, setCatalogStateFilter] = useState<
    'ALL' | 'ENABLED_ORG' | 'AVAILABLE' | 'ROADMAP'
  >('ALL');

  const checkNavAvailability = (sectionId: NavSectionId) => {
    if (sectionId === 'platform_control' && !isPlatformAdminPortal) {
      return {
        canOpen: false,
        statusText: 'Solo Superadministrador en Platform Control',
      };
    }
    const tenantAccess = getSectionTenantAccess(sectionId);
    if (!tenantAccess.allowed) {
      const modName = tenantAccess.requiredModule
        ? getModuleByCode(tenantAccess.requiredModule)?.name || tenantAccess.requiredModule
        : null;
      return {
        canOpen: false,
        statusText: modName
          ? `Requiere módulo ${modName} en licencia`
          : 'Restringido por licencia de organización',
      };
    }
    if (!rbac.canAccessSection(sectionId)) {
      return {
        canOpen: false,
        statusText: `No asignado al rol ${rbac.roleLabel}`,
      };
    }
    return {
      canOpen: true,
      statusText: 'Disponible en tu sesión',
    };
  };

  const accessSummary = useMemo(
    () =>
      computeGuideAccessSummary({
        areas: SYSTEM_GUIDE_AREAS,
        canAccessSection: (sec) =>
          (sec !== 'platform_control' || isPlatformAdminPortal) && rbac.canAccessSection(sec),
        isSectionLicensed: (sec) => getSectionTenantAccess(sec).allowed,
      }),
    [rbac, isPlatformAdminPortal, getSectionTenantAccess]
  );

  const filteredAreas = useMemo(() => {
    const base = filterSystemGuideAreas({
      areas: SYSTEM_GUIDE_AREAS,
      query: searchQuery,
      domain: domainFilter,
    });
    if (selectedAreaId === 'ALL') return base;
    return base.filter((a) => a.id === selectedAreaId);
  }, [searchQuery, domainFilter, selectedAreaId]);

  const activeFlow = useMemo(
    () => SYSTEM_GUIDE_FLOWS.find((f) => f.id === selectedFlowId) ?? SYSTEM_GUIDE_FLOWS[0],
    [selectedFlowId]
  );

  const enabledOrgModules = useMemo(
    () => new Set(organization.enabledModules ?? SU_GLORIA_ENABLED_MODULES),
    [organization.enabledModules]
  );

  const filteredCatalogModules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return AXYCORE_MODULE_CATALOG.filter((mod) => {
      if (catalogCategory !== 'ALL' && mod.category !== catalogCategory) return false;
      const isEnabledInOrg = enabledOrgModules.has(mod.code);
      if (catalogStateFilter === 'ENABLED_ORG' && !isEnabledInOrg) return false;
      if (catalogStateFilter === 'AVAILABLE' && mod.developmentStatus !== 'DISPONIBLE') return false;
      if (catalogStateFilter === 'ROADMAP' && mod.developmentStatus === 'DISPONIBLE') return false;
      if (q) {
        return (
          mod.name.toLowerCase().includes(q) ||
          mod.description.toLowerCase().includes(q) ||
          mod.code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalogCategory, catalogStateFilter, enabledOrgModules, searchQuery]);

  const roleProfile = CREDIT_ROLE_PROFILES[selectedRole];
  const roleGranular = DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE[selectedRole] ?? [];
  const roleSections = SECTION_ACCESS_BY_ROLE[selectedRole] ?? [];
  const rolePermissions = ALL_CREDIT_PERMISSIONS.filter(
    (perm) => ROLE_PERMISSION_MATRIX[selectedRole]?.[perm]
  );

  const orgDisplayName = organization.tradeName || organization.name;

  return (
    <div className="space-y-6">
      {/* Header & Live Session Context */}
      <section className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 sm:p-7">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <p className="text-xs font-medium text-[#0052CC] dark:text-[#00D1FF]">
              Arquitectura Funcional y Operativa · {orgDisplayName}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-white text-balance">
              Guía Completa de AxyCore
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Recorrido interactivo por todas las áreas, pantallas, flujos operativos, roles RBAC y
              módulos reales de AxyCore. Explora cómo opera cada módulo y accede directamente a las
              vistas autorizadas para tu sesión.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-5 pt-2 lg:pt-0 border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-white/10 lg:pl-6 shrink-0">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Áreas del Sistema</p>
              <p className="font-mono tabular-nums text-xl font-bold text-slate-950 dark:text-white mt-0.5">
                {accessSummary.totalAreas}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Pantallas Reales</p>
              <p className="font-mono tabular-nums text-xl font-bold text-slate-950 dark:text-white mt-0.5">
                {accessSummary.totalScreens}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Tu Acceso Actual</p>
              <p className="font-mono tabular-nums text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                {accessSummary.accessibleScreens}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Catálogo SaaS</p>
              <p className="font-mono tabular-nums text-xl font-bold text-[#0052CC] dark:text-[#00D1FF] mt-0.5">
                {AXYCORE_MODULE_CATALOG.length}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs + Search */}
        <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-white/10 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Secciones de la Guía de AxyCore"
            className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/15"
          >
            {GUIDE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-white dark:bg-[#0E1D40] text-slate-950 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isSelected ? 'text-[#0066FF] dark:text-[#00D1FF]' : 'text-slate-400'
                    }`}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {(activeTab === 'MAPA' || activeTab === 'CATALOGO') && (
            <div className="flex items-center gap-2 w-full xl:w-96">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    activeTab === 'MAPA'
                      ? 'Buscar módulo, DGII, Motor V2, Altera, BCRD…'
                      : 'Buscar en los 34 módulos del catálogo…'
                  }
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-950 dark:text-white placeholder:text-slate-400 focus:border-[#0066FF] dark:focus:border-[#00D1FF] focus:outline-none"
                />
              </div>
              {(searchQuery || domainFilter !== 'ALL' || selectedAreaId !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setDomainFilter('ALL');
                    setSelectedAreaId('ALL');
                    setCatalogCategory('ALL');
                    setCatalogStateFilter('ALL');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Limpiar</span>
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* TAB 1: MAPA COMPLETO DEL SISTEMA */}
      {activeTab === 'MAPA' && (
        <div className="space-y-6">
          {/* Domain & Quick Area Filters */}
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {DOMAIN_FILTERS.map((dom) => {
                  const active = domainFilter === dom;
                  return (
                    <button
                      key={dom}
                      type="button"
                      onClick={() => {
                        setDomainFilter(dom);
                        setSelectedAreaId('ALL');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'axy-brand-gradient text-white'
                          : 'bg-slate-100 dark:bg-[#040C1E] text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#0E1D40]'
                      }`}
                    >
                      {GUIDE_DOMAIN_LABELS[dom]}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Rol activo: <strong className="text-slate-900 dark:text-white">{rbac.roleLabel}</strong>
                {' · '}
                Plan <strong className="text-slate-900 dark:text-white">{organization.planCode || 'EMPRESARIAL'}</strong>
              </p>
            </div>

            {/* Area Quick Index */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedAreaId('ALL')}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  selectedAreaId === 'ALL'
                    ? 'bg-sky-50 dark:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Ver las 9 áreas
              </button>
              {SYSTEM_GUIDE_AREAS.map((area) => {
                const selected = selectedAreaId === area.id;
                return (
                  <button
                    key={area.id}
                    type="button"
                    onClick={() => {
                      setDomainFilter('ALL');
                      setSelectedAreaId(area.id);
                    }}
                    className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      selected
                        ? 'bg-sky-50 dark:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                    }`}
                  >
                    <span className="font-mono tabular-nums mr-1">{area.order}.</span>
                    {area.title}
                  </button>
                );
              })}
            </div>
          </div>

          {filteredAreas.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                No se encontraron módulos ni funcionalidades para «{searchQuery}»
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Prueba buscando términos como Préstamos, Motor V2, DGII, Conciliación, Altera o Contact Center.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setDomainFilter('ALL');
                  setSelectedAreaId('ALL');
                }}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
              >
                Restablecer vista completa
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredAreas.map((area) => (
                <section
                  key={area.id}
                  className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden"
                >
                  {/* Area Header */}
                  <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1.5 max-w-3xl">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                          Área {area.order}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{GUIDE_DOMAIN_LABELS[area.domain]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {area.items.length} {area.items.length === 1 ? 'módulo' : 'módulos'}
                        </span>
                      </div>
                      <h2 className="font-display text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                        {area.title}
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        {area.purpose}
                      </p>
                    </div>

                    <div className="lg:max-w-sm text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#040C1E] px-4 py-3 rounded-xl">
                      <span className="font-semibold text-slate-900 dark:text-white block mb-0.5">
                        Control clave de arquitectura
                      </span>
                      {area.keyGuarantee}
                    </div>
                  </div>

                  {/* Items List separated cleanly with hairline dividers (zero nested card sandwiches) */}
                  <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {area.items.map((item) => {
                      const availability = checkNavAvailability(item.sectionId);
                      return (
                        <div
                          key={item.sectionId}
                          className="p-5 sm:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="space-y-2 max-w-4xl min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                                {item.title}
                              </h3>
                              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                ·
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {item.tags.join(' · ')}
                              </span>
                              {item.comingSoon && (
                                <>
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                    ·
                                  </span>
                                  <span className="text-xs font-medium text-amber-700 dark:text-[#E2B35E]">
                                    En hoja de ruta
                                  </span>
                                </>
                              )}
                            </div>

                            <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                              {item.summary}
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                              <p className="text-slate-600 dark:text-slate-400">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  Mecanismo:{' '}
                                </span>
                                {item.mechanism}
                              </p>
                              <p className="text-slate-600 dark:text-slate-400">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  Resultado:{' '}
                                </span>
                                {item.outcome}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-row lg:flex-col lg:items-end justify-between gap-2 shrink-0">
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                availability.canOpen
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {availability.canOpen ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{availability.statusText}</span>
                            </span>

                            {availability.canOpen && (
                              <button
                                type="button"
                                onClick={() => setActiveSection(item.sectionId)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                              >
                                <span>Abrir módulo</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: FLUJOS OPERATIVOS DE PUNTA A PUNTA */}
      {activeTab === 'FLUJOS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {SYSTEM_GUIDE_FLOWS.map((flow) => {
              const isSelected = flow.id === activeFlow.id;
              return (
                <button
                  key={flow.id}
                  type="button"
                  onClick={() => setSelectedFlowId(flow.id)}
                  className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer space-y-1.5 ${
                    isSelected
                      ? 'bg-[#040C1E] border-[#00B8FF] text-white'
                      : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/18 text-slate-900 dark:text-slate-100 hover:border-[#0066FF]/50'
                  }`}
                >
                  <p
                    className={`text-xs font-mono tabular-nums ${
                      isSelected ? 'text-[#00D1FF]' : 'text-[#0052CC] dark:text-[#00D1FF]'
                    }`}
                  >
                    {flow.estimatedTouchpoints}
                  </p>
                  <p className="font-display text-sm font-bold leading-snug">{flow.title}</p>
                  <p
                    className={`text-xs ${
                      isSelected ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {flow.subtitle}
                  </p>
                </button>
              );
            })}
          </div>

          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-[#0052CC] dark:text-[#00D1FF]">
                  Recorrido Operativo Verificado · {activeFlow.estimatedTouchpoints}
                </p>
                <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white mt-0.5">
                  {activeFlow.title}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                  {activeFlow.subtitle}
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {activeFlow.steps.map((step) => {
                const availability = checkNavAvailability(step.sectionId);
                return (
                  <div
                    key={`${activeFlow.id}_${step.stepNumber}`}
                    className="p-5 sm:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-4 max-w-4xl">
                      <span className="font-mono tabular-nums text-lg font-bold text-[#0052CC] dark:text-[#00D1FF] shrink-0 pt-0.5">
                        {step.stepNumber}
                      </span>
                      <div className="space-y-1.5 min-w-0">
                        <h3 className="text-sm sm:text-base font-bold text-slate-950 dark:text-white">
                          {step.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                          {step.whatHappens}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                          <span>
                            <strong className="text-slate-700 dark:text-slate-200">
                              Compuerta de control:
                            </strong>{' '}
                            {step.controlGate}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          <strong className="text-slate-700 dark:text-slate-200">
                            Roles participantes:
                          </strong>{' '}
                          {step.participatingRoles.map((r) => ROLE_LABELS[r]).join(' · ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 lg:pl-4">
                      {availability.canOpen ? (
                        <button
                          type="button"
                          onClick={() => setActiveSection(step.sectionId)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                        >
                          <span>Ir a esta etapa</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>{availability.statusText}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: ROLES, PERMISOS, 3 PORTALES Y PILARES TÉCNICOS */}
      {activeTab === 'ROLES_PORTALES' && (
        <div className="space-y-6">
          {/* 3 Portals Comparison */}
          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Globe className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
              <div>
                <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                  Ecosistema de 3 Portales Integrados
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Misma infraestructura segura con experiencias diferenciadas para empleados, clientes externos y administración SaaS.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-2">
              {SYSTEM_GUIDE_PORTALS.map((portal) => (
                <div
                  key={portal.id}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] space-y-2.5"
                >
                  <div className="space-y-1">
                    <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      {portal.name}
                    </h3>
                    <p className="text-xs text-[#0052CC] dark:text-[#00D1FF] font-medium">
                      {portal.audience}
                    </p>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {portal.purpose}
                  </p>
                  <ul className="space-y-1.5 pt-1 text-xs text-slate-600 dark:text-slate-400">
                    {portal.capabilities.map((cap, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-mono tabular-nums text-[#0052CC] dark:text-[#00D1FF] font-semibold">
                          0{idx + 1}.
                        </span>
                        <span>{cap}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Interactive 15 RBAC Roles Explorer */}
          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                    Explorador de los 15 Roles RBAC y 43 Permisos
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecciona cualquier rol para inspeccionar su alcance exacto, permisos autorizados y pantallas visibles.
                  </p>
                </div>
              </div>
              {rbac.canAccessSection('admin_roles') && (
                <button
                  type="button"
                  onClick={() => setActiveSection('admin_roles')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 text-xs font-semibold text-slate-800 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Abrir Matriz en Administración</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12">
              <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] max-h-[520px] overflow-y-auto">
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((roleKey) => {
                  const selected = selectedRole === roleKey;
                  const permCount = ALL_CREDIT_PERMISSIONS.filter(
                    (p) => ROLE_PERMISSION_MATRIX[roleKey]?.[p]
                  ).length;
                  const secCount = SECTION_ACCESS_BY_ROLE[roleKey]?.length ?? 0;
                  return (
                    <button
                      key={roleKey}
                      type="button"
                      onClick={() => setSelectedRole(roleKey)}
                      className={`w-full px-5 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        selected
                          ? 'bg-sky-50/90 dark:bg-[#0066FF]/20 text-slate-950 dark:text-white'
                          : 'hover:bg-slate-50 dark:hover:bg-white/[0.03] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          {ROLE_LABELS[roleKey]}
                          {rbac.role === roleKey ? ' (Tu rol)' : ''}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {roleKey}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {permCount}p · {secCount}m
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="lg:col-span-8 p-5 sm:p-6 space-y-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono text-[#0052CC] dark:text-[#00D1FF] font-semibold">
                      {selectedRole}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {rolePermissions.length} permisos operativos
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {roleSections.length} pantallas autorizadas
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                    {roleProfile.label}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                    {roleProfile.scopeSummary}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <strong className="text-slate-800 dark:text-slate-200">
                      Foco de flujo:
                    </strong>{' '}
                    {roleProfile.workflowFocus}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] space-y-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Acciones granulares permitidas
                  </p>
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-300">
                    {roleGranular.join(' · ')}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] space-y-2.5">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Permisos funcionales habilitados ({rolePermissions.length})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {rolePermissions.map((perm) => (
                      <div key={perm} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span>{PERMISSION_LABELS[perm]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 6 Technical Pillars */}
          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Compass className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
              <div>
                <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                  Garantías Técnicas y de Cumplimiento
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Controles transversales integrados en el núcleo de la plataforma.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {SYSTEM_TECHNICAL_PILLARS.map((pillar) => {
                const avail = pillar.relatedSection
                  ? checkNavAvailability(pillar.relatedSection)
                  : { canOpen: false, statusText: '' };
                return (
                  <div
                    key={pillar.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF]">
                        {pillar.scope}
                      </p>
                      <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                        {pillar.title}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {pillar.detail}
                      </p>
                    </div>
                    {pillar.relatedSection && avail.canOpen && (
                      <button
                        type="button"
                        onClick={() => setActiveSection(pillar.relatedSection!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline w-fit cursor-pointer"
                      >
                        <span>Ver en el sistema</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: CATÁLOGO COMERCIAL DE LOS 34 MÓDULOS */}
      {activeTab === 'CATALOGO' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'FINANCIEROS', 'EMPRESARIALES', 'INTELIGENCIA_AUTOMATIZACION'] as const).map(
                  (cat) => {
                    const active = catalogCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCatalogCategory(cat)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          active
                            ? 'axy-brand-gradient text-white'
                            : 'bg-slate-100 dark:bg-[#040C1E] text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#0E1D40]'
                        }`}
                      >
                        {cat === 'ALL' ? 'Todos (34)' : MODULE_CATEGORY_LABELS[cat]}
                      </button>
                    );
                  }
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'ALL' as const, label: 'Todos los estados' },
                  { id: 'ENABLED_ORG' as const, label: `Activos en ${orgDisplayName}` },
                  { id: 'AVAILABLE' as const, label: 'Disponibles' },
                  { id: 'ROADMAP' as const, label: 'En desarrollo' },
                ].map((opt) => {
                  const active = catalogStateFilter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCatalogStateFilter(opt.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                        active
                          ? 'bg-sky-50 dark:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Modules Table */}
          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/80 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-semibold">Módulo</th>
                    <th className="py-3 px-4 font-semibold">Categoría</th>
                    <th className="py-3 px-4 font-semibold">Estado Desarrollo</th>
                    <th className="py-3 px-4 font-semibold">Estado en {orgDisplayName}</th>
                    <th className="py-3 px-4 font-semibold">Dependencias</th>
                    <th className="py-3 px-4 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {filteredCatalogModules.map((mod) => {
                    const isEnabledOrg = enabledOrgModules.has(mod.code);
                    const isAvailable = mod.developmentStatus === 'DISPONIBLE';
                    const firstPermittedSection = mod.mappedSections.find(
                      (s) => checkNavAvailability(s).canOpen
                    );
                    return (
                      <tr
                        key={mod.code}
                        className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="py-3.5 px-4 max-w-md">
                          <p className="font-bold text-slate-950 dark:text-white">
                            {mod.name}{' '}
                            <span className="font-mono font-normal text-slate-400">
                              v{mod.version}
                            </span>
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {mod.description}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {MODULE_CATEGORY_LABELS[mod.category]}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              isAvailable
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-[#E2B35E]'
                            }`}
                          >
                            {isAvailable ? 'Disponible en Producción' : 'En Desarrollo'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              isEnabledOrg
                                ? 'text-[#0052CC] dark:text-[#00D1FF]'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {isEnabledOrg ? 'Activo en licencia' : 'No habilitado'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                          {mod.dependencies.length > 0 ? mod.dependencies.join(', ') : 'Núcleo base'}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {firstPermittedSection ? (
                            <button
                              type="button"
                              onClick={() => setActiveSection(firstPermittedSection)}
                              className="inline-flex items-center gap-1 font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                            >
                              <span>Abrir</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCatalogModules.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        No hay módulos que coincidan con el filtro aplicado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Commercial Plans Reference Matrix */}
          <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                Planes Comerciales Multi-Empresa
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configuración de capacidad y alcance modular administrada desde AxyCore Platform Control.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-white/[0.08] text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-4 font-semibold">Plan</th>
                    <th className="py-2.5 px-4 font-semibold">Enfoque</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Usuarios</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Almacenamiento</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Ops / Mes</th>
                    <th className="py-2.5 px-4 font-semibold">Suite IA</th>
                    <th className="py-2.5 pl-4 font-semibold text-right">Módulos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {Object.values(COMMERCIAL_PLANS_CATALOG).map((plan) => (
                    <tr key={plan.code}>
                      <td className="py-3 pr-4 font-bold text-slate-950 dark:text-white whitespace-nowrap">
                        {plan.name}
                        {organization.planCode === plan.code ? ' (Actual)' : ''}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-md">
                        {plan.tagline}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {plan.maxUsers}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {plan.maxStorageGb} GB
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {plan.maxMonthlyOperations.toLocaleString('en-US')}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {plan.includesAi ? 'Incluida (Director y Bela)' : 'Opcional'}
                      </td>
                      <td className="py-3 pl-4 text-right font-mono tabular-nums font-bold text-[#0052CC] dark:text-[#00D1FF]">
                        {plan.includedModules.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
