import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Compass,
  Eye,
  GitBranch,
  Layers,
  Lock,
  Network,
  RotateCcw,
  Search,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildSitemapGraph,
  filterSitemapGraph,
  SITEMAP_DATA_CONNECTIONS,
  SITEMAP_LAYER_LABELS,
  type SitemapAccessFilter,
  type SitemapArchitectureLayer,
  type SitemapDomainResolved,
  type SitemapNodeResolved,
} from '../../engine/systemSitemapEngine';
import type { NavigationGroupKey } from '../../engine/navigationBreadcrumbs';

type SitemapViewMode = 'TOPOLOGY' | 'TREE';

const LAYER_OPTIONS: SitemapArchitectureLayer[] = [
  'ALL',
  'CORE_HUB',
  'ORIGINATION_KYC',
  'COLLECTIONS_RECOVERY',
  'ACCOUNTING_DGII',
  'INTELLIGENCE_GOVERNANCE',
];

const ACCESS_OPTIONS: Array<{ id: SitemapAccessFilter; label: string }> = [
  { id: 'ALL', label: 'Todos' },
  { id: 'ACCESSIBLE', label: 'Disponibles' },
  { id: 'RESTRICTED', label: 'Restringidos' },
];

export function SystemSitemapView() {
  const {
    organization,
    rbac,
    setActiveSection,
    setBelaOpen,
    getSectionTenantAccess,
    isPlatformAdminPortal,
    applications,
    loans,
    customers,
    documents,
    collectionAccounts,
    payments,
    riskAlerts,
    dgiiEcfDocuments,
    auditLogs,
    usersList,
  } = useAxyCore();

  const [viewMode, setViewMode] = useState<SitemapViewMode>('TOPOLOGY');
  const [searchQuery, setSearchQuery] = useState('');
  const [layerFilter, setLayerFilter] = useState<SitemapArchitectureLayer>('ALL');
  const [accessFilter, setAccessFilter] = useState<SitemapAccessFilter>('ALL');
  const [directNavigation, setDirectNavigation] = useState(true);
  const [selectedDomainKey, setSelectedDomainKey] = useState<NavigationGroupKey>('inteligencia');
  const [hoveredDomainKey, setHoveredDomainKey] = useState<NavigationGroupKey | null>(null);
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);

  const liveMetrics = useMemo(() => {
    const activeLoansCount = loans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO').length;
    const pendingPaymentsCount = payments.filter((p) =>
      ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
    ).length;
    const activeAlertsCount = riskAlerts.filter((a) => a.status === 'ACTIVA').length;
    return {
      applicationsCount: applications.length,
      activeLoansCount,
      customersCount: customers.length,
      documentsCount: documents.length,
      collectionAccountsCount: collectionAccounts.length,
      paymentsCount: payments.length,
      pendingPaymentsCount,
      activeAlertsCount,
      ecfDocumentsCount: dgiiEcfDocuments.length,
      auditLogsCount: auditLogs.length,
      usersCount: usersList.length,
    };
  }, [
    applications.length,
    loans,
    customers.length,
    documents.length,
    collectionAccounts.length,
    payments,
    riskAlerts,
    dgiiEcfDocuments.length,
    auditLogs.length,
    usersList.length,
  ]);

  const fullDomains = useMemo(
    () =>
      buildSitemapGraph({
        canAccessSection: rbac.canAccessSection,
        getSectionTenantAccess,
        isPlatformAdminPortal,
        roleLabel: rbac.roleLabel,
        liveMetrics,
      }),
    [rbac.canAccessSection, rbac.roleLabel, getSectionTenantAccess, isPlatformAdminPortal, liveMetrics]
  );

  const filteredDomains = useMemo(
    () =>
      filterSitemapGraph({
        domains: fullDomains,
        query: searchQuery,
        layer: layerFilter,
        accessFilter,
      }),
    [fullDomains, searchQuery, layerFilter, accessFilter]
  );

  const totals = useMemo(() => {
    const totalNodes = fullDomains.reduce((sum, d) => sum + d.totalCount, 0);
    const accessibleNodes = fullDomains.reduce((sum, d) => sum + d.accessibleCount, 0);
    const visibleNodes = filteredDomains.reduce((sum, d) => sum + d.totalCount, 0);
    return {
      totalDomains: fullDomains.length,
      totalNodes,
      accessibleNodes,
      visibleNodes,
      flowsCount: SITEMAP_DATA_CONNECTIONS.length,
    };
  }, [fullDomains, filteredDomains]);

  const domainLookup = useMemo(() => {
    const map = new Map<NavigationGroupKey, SitemapDomainResolved>();
    for (const d of fullDomains) {
      map.set(d.domain.key, d);
    }
    return map;
  }, [fullDomains]);

  const visibleDomainKeys = useMemo(
    () => new Set(filteredDomains.map((d) => d.domain.key)),
    [filteredDomains]
  );

  const activeDomain: SitemapDomainResolved | undefined = useMemo(() => {
    const inFiltered = filteredDomains.find((d) => d.domain.key === selectedDomainKey);
    return inFiltered ?? filteredDomains[0] ?? fullDomains[0];
  }, [filteredDomains, fullDomains, selectedDomainKey]);

  const focusDomainKey = hoveredDomainKey ?? activeDomain?.domain.key ?? 'inteligencia';

  const inspectedNode: SitemapNodeResolved | null = useMemo(() => {
    if (!inspectedNodeId) return null;
    for (const d of fullDomains) {
      const found = d.nodes.find((n) => n.sectionId === inspectedNodeId);
      if (found) return found;
    }
    return null;
  }, [fullDomains, inspectedNodeId]);

  const relatedConnections = useMemo(
    () =>
      SITEMAP_DATA_CONNECTIONS.filter(
        (c) => c.from === focusDomainKey || c.to === focusDomainKey
      ),
    [focusDomainKey]
  );

  const handleOpenNode = (node: SitemapNodeResolved) => {
    setInspectedNodeId(node.sectionId);
    if (!node.accessible) return;
    if (node.sectionId === 'bela') {
      setBelaOpen(true);
      return;
    }
    setActiveSection(node.sectionId);
  };

  const handleNodeClick = (node: SitemapNodeResolved) => {
    if (directNavigation && node.accessible) {
      handleOpenNode(node);
      return;
    }
    setInspectedNodeId(node.sectionId);
  };

  const hasActiveFilters =
    searchQuery.trim().length > 0 || layerFilter !== 'ALL' || accessFilter !== 'ALL';

  const resetFilters = () => {
    setSearchQuery('');
    setLayerFilter('ALL');
    setAccessFilter('ALL');
  };

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto">
      {/* Header */}
      <header className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Network className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
              <span className="font-medium text-[#0052CC] dark:text-[#00D1FF]">
                Suite de Inteligencia
              </span>
              <span aria-hidden="true">·</span>
              <span>{organization.tradeName || organization.name}</span>
              <span aria-hidden="true">·</span>
              <span>{rbac.roleLabel}</span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tracking-tight">
              Mapa del Sistema
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
              Arquitectura interactiva de AxyCore con los 9 dominios operativos, flujos de datos en
              vivo y acceso directo a cada sección autorizada.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10">
              <button
                type="button"
                onClick={() => setViewMode('TOPOLOGY')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'TOPOLOGY'
                    ? 'bg-white dark:bg-[#0E1D40] text-slate-950 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Mapa Topológico</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TREE')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'TREE'
                    ? 'bg-white dark:bg-[#0E1D40] text-slate-950 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Árbol Completo</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDirectNavigation((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                directNavigation
                  ? 'border-[#0066FF]/35 bg-[#0066FF]/8 text-[#0052CC] dark:text-[#00D1FF] dark:border-[#00B8FF]/35 dark:bg-[#00B8FF]/12'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#040C1E] text-slate-600 dark:text-slate-300'
              }`}
              title="Al hacer clic en un nodo accesible, abre directamente su pantalla"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>{directNavigation ? 'Clic directo: Activo' : 'Modo inspección'}</span>
            </button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-white/8 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Dominios operativos</div>
            <div className="mt-0.5 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
              {totals.totalDomains}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Nodos del sistema</div>
            <div className="mt-0.5 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
              {totals.visibleNodes}
              {totals.visibleNodes !== totals.totalNodes && (
                <span className="text-xs font-normal text-slate-400"> / {totals.totalNodes}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Disponibles en tu sesión</div>
            <div className="mt-0.5 font-mono tabular-nums text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {totals.accessibleNodes}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Flujos inter-módulo</div>
            <div className="mt-0.5 font-mono tabular-nums text-lg font-bold text-[#0052CC] dark:text-[#00D1FF]">
              {totals.flowsCount}
            </div>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar módulo, pantalla, proceso o etiqueta (ej. ALTERA, Comité, e-CF)..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/85 dark:border-white/10 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-[#0066FF] dark:focus:border-[#00B8FF]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <select
              aria-label="Filtrar por capa arquitectónica"
              value={layerFilter}
              onChange={(e) => setLayerFilter(e.target.value as SitemapArchitectureLayer)}
              className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/85 dark:border-white/10 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#0066FF] cursor-pointer"
            >
              {LAYER_OPTIONS.map((layer) => (
                <option key={layer} value={layer}>
                  {SITEMAP_LAYER_LABELS[layer]}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10">
            {ACCESS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAccessFilter(opt.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  accessFilter === opt.id
                    ? 'bg-white dark:bg-[#0E1D40] text-slate-950 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty filter state */}
      {filteredDomains.length === 0 ? (
        <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-10 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Ningún nodo coincide con los filtros actuales.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Prueba otra palabra clave o restablece los filtros de capa y acceso.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Mostrar toda la arquitectura</span>
          </button>
        </div>
      ) : viewMode === 'TOPOLOGY' ? (
        /* TOPOLOGY MODE */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Interactive SVG Architecture Canvas */}
          <div className="xl:col-span-7 space-y-4">
            <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                    Topología de Dominios y Flujos de Datos
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecciona un dominio para explorar sus pantallas y conexiones activas.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                  9 dominios · {SITEMAP_DATA_CONNECTIONS.length} enlaces
                </span>
              </div>

              <div className="rounded-xl bg-slate-50/90 dark:bg-[#040C1E] border border-slate-200/75 dark:border-white/8 overflow-hidden">
                <svg
                  viewBox="0 0 1000 565"
                  className="w-full h-auto block select-none"
                  role="img"
                  aria-label="Mapa topológico de la arquitectura de AxyCore"
                >
                  <defs>
                    <pattern
                      id="sitemap-dot-grid"
                      width="28"
                      height="28"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="2" cy="2" r="1" className="fill-slate-300/60 dark:fill-sky-400/12" />
                    </pattern>
                  </defs>
                  <rect width="1000" height="565" fill="url(#sitemap-dot-grid)" />

                  {/* Connection lines */}
                  {SITEMAP_DATA_CONNECTIONS.map((conn) => {
                    const fromDom = domainLookup.get(conn.from);
                    const toDom = domainLookup.get(conn.to);
                    if (!fromDom || !toDom) return null;

                    const isHighlighted =
                      conn.from === focusDomainKey || conn.to === focusDomainKey;
                    const bothVisible =
                      visibleDomainKeys.has(conn.from) && visibleDomainKeys.has(conn.to);

                    const x1 = fromDom.domain.canvasPos.x;
                    const y1 = fromDom.domain.canvasPos.y;
                    const x2 = toDom.domain.canvasPos.x;
                    const y2 = toDom.domain.canvasPos.y;
                    const mx = (x1 + x2) / 2;
                    const my = (y1 + y2) / 2 - 14;

                    return (
                      <g key={conn.id} opacity={bothVisible ? 1 : 0.2}>
                        <path
                          d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                          fill="none"
                          stroke={isHighlighted ? '#0066FF' : '#94A3B8'}
                          strokeWidth={isHighlighted ? 2.4 : 1.2}
                          strokeOpacity={isHighlighted ? 0.85 : 0.35}
                          strokeDasharray={isHighlighted ? undefined : '4 4'}
                        />
                        {isHighlighted && (
                          <circle cx={mx} cy={my} r="3.5" fill="#00B8FF" />
                        )}
                      </g>
                    );
                  })}

                  {/* Domain nodes */}
                  {fullDomains.map((entry) => {
                    const { domain, accessibleCount, totalCount } = entry;
                    const isVisible = visibleDomainKeys.has(domain.key);
                    const isSelected = activeDomain?.domain.key === domain.key;
                    const isConnected = relatedConnections.some(
                      (c) => c.from === domain.key || c.to === domain.key
                    );
                    const w = 186;
                    const h = 64;
                    const x = domain.canvasPos.x - w / 2;
                    const y = domain.canvasPos.y - h / 2;

                    return (
                      <g
                        key={domain.key}
                        transform={`translate(${x}, ${y})`}
                        opacity={isVisible ? 1 : 0.3}
                        onClick={() => {
                          if (!isVisible) return;
                          setSelectedDomainKey(domain.key);
                        }}
                        onMouseEnter={() => setHoveredDomainKey(domain.key)}
                        onMouseLeave={() => setHoveredDomainKey(null)}
                        className={isVisible ? 'cursor-pointer' : 'cursor-not-allowed'}
                      >
                        <rect
                          width={w}
                          height={h}
                          rx="12"
                          className={
                            isSelected
                              ? 'fill-[#041B4E] dark:fill-[#0E1D40]'
                              : 'fill-white dark:fill-[#08132B]'
                          }
                          stroke={
                            isSelected
                              ? domain.accentHex
                              : isConnected
                                ? '#0066FF'
                                : '#CBD5E1'
                          }
                          strokeWidth={isSelected ? 2.4 : isConnected ? 1.5 : 1}
                          strokeOpacity={isSelected ? 1 : 0.7}
                        />
                        <rect
                          x="0"
                          y="0"
                          width="5"
                          height={h}
                          rx="2"
                          fill={domain.accentHex}
                        />
                        <text
                          x="16"
                          y="24"
                          fontSize="10"
                          fontWeight="700"
                          fontFamily="monospace"
                          fill={isSelected ? '#00D1FF' : domain.accentHex}
                        >
                          {domain.order} · {accessibleCount}/{totalCount} nodos
                        </text>
                        <text
                          x="16"
                          y="45"
                          fontSize="13"
                          fontWeight="700"
                          className={
                            isSelected
                              ? 'fill-white'
                              : 'fill-slate-900 dark:fill-slate-100'
                          }
                        >
                          {domain.shortTitle}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Active connections legend */}
              <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-white/8">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Flujos conectados con{' '}
                  <span className="text-[#0052CC] dark:text-[#00D1FF]">
                    {domainLookup.get(focusDomainKey)?.domain.title}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {relatedConnections.map((conn) => {
                    const fromTitle = domainLookup.get(conn.from)?.domain.shortTitle ?? conn.from;
                    const toTitle = domainLookup.get(conn.to)?.domain.shortTitle ?? conn.to;
                    return (
                      <div
                        key={conn.id}
                        className="p-2.5 rounded-xl bg-slate-50/90 dark:bg-[#040C1E]/70 text-xs space-y-0.5"
                      >
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{fromTitle}</span>
                          <ArrowRight className="w-3 h-3 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                          <span>{toTitle}</span>
                          <span className="text-slate-400 font-normal">· {conn.label}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {conn.detail}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Selected Domain Nodes + Optional Node Inspector */}
          <div className="xl:col-span-5 space-y-4">
            {activeDomain && (
              <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                      Dominio {activeDomain.domain.order} · {SITEMAP_LAYER_LABELS[activeDomain.domain.layer]}
                    </div>
                    <h3 className="mt-0.5 font-display text-base font-bold text-slate-950 dark:text-white">
                      {activeDomain.domain.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {activeDomain.domain.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-white">
                      {activeDomain.accessibleCount}/{activeDomain.totalCount}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">activos</div>
                  </div>
                </div>

                {/* Quick domain switcher pills */}
                <div className="flex flex-wrap gap-1.5 pb-3 border-b border-slate-100 dark:border-white/8">
                  {filteredDomains.map((d) => {
                    const active = d.domain.key === activeDomain.domain.key;
                    return (
                      <button
                        key={d.domain.key}
                        type="button"
                        onClick={() => setSelectedDomainKey(d.domain.key)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white'
                            : 'bg-slate-100 dark:bg-[#040C1E] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/10'
                        }`}
                      >
                        {d.domain.order} {d.domain.shortTitle}
                      </button>
                    );
                  })}
                </div>

                {/* Node List */}
                <div className="divide-y divide-slate-100 dark:divide-white/8 max-h-[430px] overflow-y-auto pr-1">
                  {activeDomain.nodes.map((node) => {
                    const isInspected = inspectedNode?.sectionId === node.sectionId;
                    return (
                      <div
                        key={node.sectionId}
                        className={`py-2.5 flex items-center justify-between gap-3 transition-colors rounded-lg px-2 ${
                          isInspected ? 'bg-[#0066FF]/6 dark:bg-[#00B8FF]/10' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleNodeClick(node)}
                          className="flex-1 min-w-0 text-left group cursor-pointer"
                          style={{ paddingLeft: `${node.depth * 14}px` }}
                        >
                          <div className="flex items-center gap-2">
                            {node.depth > 0 && (
                              <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">
                                ↳
                              </span>
                            )}
                            <span
                              className={`text-xs sm:text-sm font-semibold truncate ${
                                node.accessible
                                  ? 'text-slate-900 dark:text-white group-hover:text-[#0052CC] dark:group-hover:text-[#00D1FF]'
                                  : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {node.label}
                            </span>
                            {node.comingSoon && (
                              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                                · Hoja de ruta
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {node.summary}
                          </p>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          {typeof node.liveCount === 'number' && (
                            <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                              {node.liveCount} {node.liveCountLabel}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setInspectedNodeId(node.sectionId)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/8 cursor-pointer"
                            title="Inspeccionar detalles del nodo"
                            aria-label={`Inspeccionar ${node.label}`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {node.accessible ? (
                            <button
                              type="button"
                              onClick={() => handleOpenNode(node)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF] text-[#0052CC] dark:text-[#00D1FF] hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              <span>Abrir</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500"
                              title={node.accessLabel}
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Node Inspector */}
            {inspectedNode && (
              <div className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/25 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {inspectedNode.breadcrumbPath.join(' / ')}
                    </div>
                    <h4 className="mt-0.5 font-display text-sm font-bold text-slate-950 dark:text-white">
                      {inspectedNode.label}
                    </h4>
                  </div>
                  {inspectedNode.accessible ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Autorizado</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Restringido</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {inspectedNode.summary}
                </p>

                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-white/8">
                  <div>
                    Estado en sesión:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {inspectedNode.accessLabel}
                    </strong>
                  </div>
                  {inspectedNode.requiredModuleName && (
                    <div>
                      Módulo de licencia:{' '}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {inspectedNode.requiredModuleName}
                      </strong>
                    </div>
                  )}
                  {typeof inspectedNode.liveCount === 'number' && (
                    <div>
                      Volumen actual:{' '}
                      <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {inspectedNode.liveCount} {inspectedNode.liveCountLabel}
                      </strong>
                    </div>
                  )}
                </div>

                {inspectedNode.accessible && (
                  <button
                    type="button"
                    onClick={() => handleOpenNode(inspectedNode)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer"
                  >
                    <span>Ir a {inspectedNode.label}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* FULL DIRECTORY TREE MODE */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDomains.map((entry) => (
            <section
              key={entry.domain.key}
              className="bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 dark:border-white/8">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: entry.domain.accentHex }}
                      />
                      <span>{entry.domain.order}</span>
                      <span>·</span>
                      <span>{SITEMAP_LAYER_LABELS[entry.domain.layer]}</span>
                    </div>
                    <h3 className="mt-1 font-display text-sm font-bold text-slate-950 dark:text-white">
                      {entry.domain.title}
                    </h3>
                  </div>
                  <span className="font-mono tabular-nums text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                    {entry.accessibleCount}/{entry.totalCount}
                  </span>
                </div>

                <ul className="mt-2.5 space-y-1">
                  {entry.nodes.map((node) => (
                    <li key={node.sectionId}>
                      <button
                        type="button"
                        onClick={() => handleNodeClick(node)}
                        disabled={!node.accessible && directNavigation}
                        style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                        className={`w-full pr-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                          node.accessible
                            ? 'hover:bg-slate-50 dark:hover:bg-white/6 text-slate-800 dark:text-slate-200 cursor-pointer group'
                            : 'text-slate-400 dark:text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {node.depth > 0 && (
                            <span className="text-slate-300 dark:text-slate-600 font-mono text-[11px]">
                              └
                            </span>
                          )}
                          <span className="text-xs font-medium truncate group-hover:text-[#0052CC] dark:group-hover:text-[#00D1FF]">
                            {node.label}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {typeof node.liveCount === 'number' && (
                            <span className="font-mono tabular-nums text-[10px] text-slate-400">
                              {node.liveCount}
                            </span>
                          )}
                          {node.accessible ? (
                            <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-[#0066FF] dark:group-hover:text-[#00D1FF]" />
                          ) : (
                            <Lock className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2.5 border-t border-slate-100 dark:border-white/8 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span className="truncate">{entry.domain.shortTitle}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDomainKey(entry.domain.key);
                    setViewMode('TOPOLOGY');
                  }}
                  className="inline-flex items-center gap-1 text-[#0052CC] dark:text-[#00D1FF] font-semibold hover:underline shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Ver flujos</span>
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
