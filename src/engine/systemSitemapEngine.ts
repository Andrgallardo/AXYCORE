import {
  buildBreadcrumbsForSection,
  SECTION_HIERARCHY,
  type NavigationGroupKey,
} from './navigationBreadcrumbs';
import { getModuleByCode, resolveModuleForNavSection } from './multiTenantEngine';
import { SYSTEM_GUIDE_AREAS } from './systemGuideCatalog';
import type { AxyCoreModuleCode, NavSectionId } from '../types/axycore';

export type SitemapArchitectureLayer =
  | 'ALL'
  | 'CORE_HUB'
  | 'ORIGINATION_KYC'
  | 'COLLECTIONS_RECOVERY'
  | 'ACCOUNTING_DGII'
  | 'INTELLIGENCE_GOVERNANCE';

export type SitemapAccessFilter = 'ALL' | 'ACCESSIBLE' | 'RESTRICTED';

export interface SitemapDomainDefinition {
  key: NavigationGroupKey;
  order: string;
  title: string;
  shortTitle: string;
  layer: Exclude<SitemapArchitectureLayer, 'ALL'>;
  description: string;
  /** Normalized coordinates (0..1000 x 0..560) for the architectural topology canvas */
  canvasPos: { x: number; y: number };
  accentHex: string;
}

export interface SitemapDataConnection {
  id: string;
  from: NavigationGroupKey;
  to: NavigationGroupKey;
  label: string;
  detail: string;
}

export interface SitemapLiveMetrics {
  applicationsCount: number;
  activeLoansCount: number;
  customersCount: number;
  documentsCount: number;
  collectionAccountsCount: number;
  paymentsCount: number;
  pendingPaymentsCount: number;
  activeAlertsCount: number;
  ecfDocumentsCount: number;
  auditLogsCount: number;
  usersCount: number;
}

export interface SitemapNodeResolved {
  sectionId: NavSectionId;
  label: string;
  groupKey: NavigationGroupKey;
  parentSectionId?: NavSectionId;
  depth: 0 | 1 | 2;
  summary: string;
  tags: string[];
  comingSoon?: boolean;
  accessible: boolean;
  accessLabel: string;
  requiredModuleCode: AxyCoreModuleCode | null;
  requiredModuleName: string | null;
  breadcrumbPath: string[];
  liveCount?: number;
  liveCountLabel?: string;
}

export interface SitemapDomainResolved {
  domain: SitemapDomainDefinition;
  nodes: SitemapNodeResolved[];
  totalCount: number;
  accessibleCount: number;
  restrictedCount: number;
}

export const SITEMAP_LAYER_LABELS: Record<SitemapArchitectureLayer, string> = {
  ALL: 'Todas las capas',
  CORE_HUB: 'Núcleo y Reportería',
  ORIGINATION_KYC: 'Originación y Clientes',
  COLLECTIONS_RECOVERY: 'Cobros y Contact Center',
  ACCOUNTING_DGII: 'Contabilidad y DGII e-CF',
  INTELLIGENCE_GOVERNANCE: 'Inteligencia y Gobierno',
};

export const SITEMAP_DOMAINS: SitemapDomainDefinition[] = [
  {
    key: 'inicio',
    order: '01',
    title: 'Inicio y Gobierno SaaS',
    shortTitle: 'Inicio / SaaS',
    layer: 'CORE_HUB',
    description: 'Tablero ejecutivo configurable, Guía de AxyCore y Platform Control multitenant.',
    canvasPos: { x: 500, y: 74 },
    accentHex: '#0066FF',
  },
  {
    key: 'prestamos',
    order: '02',
    title: 'Préstamos y Originación',
    shortTitle: 'Préstamos',
    layer: 'ORIGINATION_KYC',
    description: 'Calculadora V2, solicitudes, Motor de Decisiones, evaluación, comité, formalización y desembolso.',
    canvasPos: { x: 175, y: 185 },
    accentHex: '#00B8FF',
  },
  {
    key: 'clientes',
    order: '03',
    title: 'Clientes y Expedientes',
    shortTitle: 'Clientes',
    layer: 'ORIGINATION_KYC',
    description: 'Maestro KYC sin duplicados por Cédula/RNC y bóveda documental con OCR.',
    canvasPos: { x: 175, y: 340 },
    accentHex: '#0284C7',
  },
  {
    key: 'cartera',
    order: '04',
    title: 'Cobros y Recuperación',
    shortTitle: 'Cobros',
    layer: 'COLLECTIONS_RECOVERY',
    description: 'Colas diarias/urgentes/legales, Ficha 360°, acuerdos, pagos, AxyRecovery Bot y cierre.',
    canvasPos: { x: 500, y: 245 },
    accentHex: '#0EA5E9',
  },
  {
    key: 'contact_center',
    order: '05',
    title: 'Contact Center',
    shortTitle: 'Contact Center',
    layer: 'COLLECTIONS_RECOVERY',
    description: 'Productividad de gestores, tasa de contactabilidad y cumplimiento real de promesas.',
    canvasPos: { x: 500, y: 405 },
    accentHex: '#10B981',
  },
  {
    key: 'operaciones',
    order: '06',
    title: 'Contabilidad y DGII e-CF',
    shortTitle: 'Contabilidad & e-CF',
    layer: 'ACCOUNTING_DGII',
    description: 'Partida doble, libros diario/mayor, conciliación bancaria y facturación electrónica Ley 32-23.',
    canvasPos: { x: 825, y: 185 },
    accentHex: '#E2B35E',
  },
  {
    key: 'reportes',
    order: '07',
    title: 'Reportes y Analítica',
    shortTitle: 'Reportes',
    layer: 'CORE_HUB',
    description: 'Reportería ejecutiva PDF/CSV de colocación, riesgo y recuperación de cartera.',
    canvasPos: { x: 825, y: 340 },
    accentHex: '#6366F1',
  },
  {
    key: 'inteligencia',
    order: '08',
    title: 'Inteligencia y Control Institucional',
    shortTitle: 'Inteligencia y Control',
    layer: 'INTELLIGENCE_GOVERNANCE',
    description: 'AxyCore Director, Bela IA, Altera, Centinela, Anticípate, AxyCore REGULA, Mapa del Sistema e Impulsa.',
    canvasPos: { x: 315, y: 500 },
    accentHex: '#00D1FF',
  },
  {
    key: 'administracion',
    order: '09',
    title: 'Administración y Auditoría',
    shortTitle: 'Administración',
    layer: 'INTELLIGENCE_GOVERNANCE',
    description: 'Usuarios, 15 roles RBAC, políticas crediticias y de cobranza, asignación y bitácora inmutable.',
    canvasPos: { x: 685, y: 500 },
    accentHex: '#8B5CF6',
  },
];

export const SITEMAP_DATA_CONNECTIONS: SitemapDataConnection[] = [
  {
    id: 'inicio_prestamos',
    from: 'inicio',
    to: 'prestamos',
    label: 'KPIs de Colocación',
    detail: 'El Dashboard Ejecutivo agrega solicitudes, tasas de aprobación y desembolsos en tiempo real.',
  },
  {
    id: 'inicio_cartera',
    from: 'inicio',
    to: 'cartera',
    label: 'Salud PAR y Recaudo',
    detail: 'Consolida indicadores de morosidad PAR 1/7/30/60/90 y recuperación por moneda.',
  },
  {
    id: 'inicio_operaciones',
    from: 'inicio',
    to: 'operaciones',
    label: 'Control Financiero',
    detail: 'Refleja tesorería, validación de pagos y operación contable/fiscal de la entidad.',
  },
  {
    id: 'prestamos_clientes',
    from: 'prestamos',
    to: 'clientes',
    label: 'KYC y Expedientes',
    detail: 'Originación y Evaluación leen y validan identidad única, documentos OCR e historial del cliente.',
  },
  {
    id: 'prestamos_cartera',
    from: 'prestamos',
    to: 'cartera',
    label: 'Cuotas Desembolsadas',
    detail: 'Cada desembolso genera préstamos activos y calendario de cuotas que alimenta las colas de cobro.',
  },
  {
    id: 'cartera_contact',
    from: 'cartera',
    to: 'contact_center',
    label: 'Gestiones y Promesas',
    detail: 'Las gestiones registradas y promesas cumplidas calculan los KPIs de Contact Center.',
  },
  {
    id: 'cartera_operaciones',
    from: 'cartera',
    to: 'operaciones',
    label: 'Pagos y Conciliación',
    detail: 'Los pagos reportados pasan a validación contable, conciliación bancaria y asientos de partida doble.',
  },
  {
    id: 'operaciones_reportes',
    from: 'operaciones',
    to: 'reportes',
    label: 'Estados y Fiscales',
    detail: 'Los libros contables, pagos confirmados y comprobantes e-CF alimentan reportes ejecutivos y fiscales.',
  },
  {
    id: 'prestamos_inteligencia',
    from: 'prestamos',
    to: 'inteligencia',
    label: 'Scoring V2 y Gemelos',
    detail: 'Ejecuciones del Motor V2 y contratos activos nutren Inteligencia de Motor, Director y ALTERA.',
  },
  {
    id: 'cartera_inteligencia',
    from: 'cartera',
    to: 'inteligencia',
    label: 'DPD, Centinela y Plan B',
    detail: 'Atrasos, promesas y alertas alimentan Centinela, Anticípate 30/60/90d y ALTERA.',
  },
  {
    id: 'admin_prestamos',
    from: 'administracion',
    to: 'prestamos',
    label: 'Políticas y Facultades',
    detail: 'Bandas de riesgo, límites de producto y matriz de Comité gobiernan toda la originación.',
  },
  {
    id: 'admin_cartera',
    from: 'administracion',
    to: 'cartera',
    label: 'Imputación y Asignación',
    detail: 'Parámetros de cobranza y asignación de cartera rigen colas, mora y orden de aplicación de pagos.',
  },
  {
    id: 'admin_operaciones',
    from: 'administracion',
    to: 'operaciones',
    label: 'RBAC y Auditoría',
    detail: 'Control de permisos granulares y bitácora inmutable sobre asientos, pagos y e-CF DGII.',
  },
];

const GUIDE_ITEM_BY_SECTION = new Map(
  SYSTEM_GUIDE_AREAS.flatMap((area) => area.items).map((item) => [item.sectionId, item])
);

function resolveNodeDepth(sectionId: NavSectionId): 0 | 1 | 2 {
  const node = SECTION_HIERARCHY[sectionId];
  if (!node?.parentSectionId) return 0;
  const parent = SECTION_HIERARCHY[node.parentSectionId];
  if (parent?.parentSectionId) return 2;
  return 1;
}

function resolveLiveCountForSection(
  sectionId: NavSectionId,
  metrics?: Partial<SitemapLiveMetrics>
): { count?: number; label?: string } {
  if (!metrics) return {};
  switch (sectionId) {
    case 'applications':
    case 'decision_engine':
    case 'evaluation':
    case 'committee':
      return typeof metrics.applicationsCount === 'number'
        ? { count: metrics.applicationsCount, label: 'solicitudes' }
        : {};
    case 'loans':
    case 'disbursements':
      return typeof metrics.activeLoansCount === 'number'
        ? { count: metrics.activeLoansCount, label: 'préstamos' }
        : {};
    case 'customers':
    case 'customers_active':
    case 'customers_inactive':
    case 'customers_update':
      return typeof metrics.customersCount === 'number'
        ? { count: metrics.customersCount, label: 'clientes' }
        : {};
    case 'documents':
      return typeof metrics.documentsCount === 'number'
        ? { count: metrics.documentsCount, label: 'documentos' }
        : {};
    case 'cobranza_portfolio':
    case 'cobranza_daily':
    case 'cobranza_urgent':
    case 'cobranza_legal':
      return typeof metrics.collectionAccountsCount === 'number'
        ? { count: metrics.collectionAccountsCount, label: 'cuentas' }
        : {};
    case 'cobranza_payments':
    case 'register_payment':
      return typeof metrics.paymentsCount === 'number'
        ? { count: metrics.paymentsCount, label: 'pagos' }
        : {};
    case 'accounting_payment_validation':
      return typeof metrics.pendingPaymentsCount === 'number'
        ? { count: metrics.pendingPaymentsCount, label: 'por validar' }
        : {};
    case 'cobranza_sentinel':
      return typeof metrics.activeAlertsCount === 'number'
        ? { count: metrics.activeAlertsCount, label: 'alertas' }
        : {};
    case 'ecf_dashboard':
    case 'ecf_issued':
    case 'ecf_dgii_status':
      return typeof metrics.ecfDocumentsCount === 'number'
        ? { count: metrics.ecfDocumentsCount, label: 'e-CF' }
        : {};
    case 'audit':
      return typeof metrics.auditLogsCount === 'number'
        ? { count: metrics.auditLogsCount, label: 'eventos' }
        : {};
    case 'admin_users':
      return typeof metrics.usersCount === 'number'
        ? { count: metrics.usersCount, label: 'usuarios' }
        : {};
    default:
      return {};
  }
}

export function buildSitemapGraph(params: {
  canAccessSection: (sectionId: NavSectionId) => boolean;
  getSectionTenantAccess: (sectionId: NavSectionId) => {
    allowed: boolean;
    requiredModule?: AxyCoreModuleCode | null;
    reason?: string;
  };
  isPlatformAdminPortal: boolean;
  roleLabel: string;
  liveMetrics?: Partial<SitemapLiveMetrics>;
}): SitemapDomainResolved[] {
  const {
    canAccessSection,
    getSectionTenantAccess,
    isPlatformAdminPortal,
    roleLabel,
    liveMetrics,
  } = params;

  const allSectionNodes = Object.values(SECTION_HIERARCHY);

  return SITEMAP_DOMAINS.map((domain) => {
    const groupNodes = allSectionNodes
      .filter((n) => n.groupKey === domain.key)
      .map<SitemapNodeResolved>((node) => {
        const guideMeta = GUIDE_ITEM_BY_SECTION.get(node.sectionId);
        const requiredModuleCode = resolveModuleForNavSection(node.sectionId);
        const requiredModuleName = requiredModuleCode
          ? getModuleByCode(requiredModuleCode)?.name || requiredModuleCode
          : null;

        let accessible = true;
        let accessLabel = 'Disponible en tu sesión';

        if (node.sectionId === 'platform_control' && !isPlatformAdminPortal) {
          accessible = false;
          accessLabel = 'Solo Superadministrador SaaS';
        } else {
          const tenantCheck = getSectionTenantAccess(node.sectionId);
          if (!tenantCheck.allowed) {
            accessible = false;
            const modName = tenantCheck.requiredModule
              ? getModuleByCode(tenantCheck.requiredModule)?.name || tenantCheck.requiredModule
              : null;
            accessLabel = modName
              ? `Requiere módulo ${modName}`
              : 'Restringido por licencia';
          } else if (!canAccessSection(node.sectionId)) {
            accessible = false;
            accessLabel = `No asignado a ${roleLabel}`;
          }
        }

        const breadcrumbs = buildBreadcrumbsForSection({
          activeSection: node.sectionId,
          canAccessSection: () => true,
        }).map((b) => b.label);

        const live = resolveLiveCountForSection(node.sectionId, liveMetrics);

        return {
          sectionId: node.sectionId,
          label: node.label,
          groupKey: node.groupKey,
          parentSectionId: node.parentSectionId,
          depth: resolveNodeDepth(node.sectionId),
          summary:
            guideMeta?.summary ||
            (node.sectionId === 'system_sitemap'
              ? 'Mapa interactivo de la arquitectura de AxyCore con acceso directo a cada nodo del sistema.'
              : `Módulo operativo dentro de ${domain.title}.`),
          tags:
            guideMeta?.tags ||
            (node.sectionId === 'system_sitemap'
              ? ['Arquitectura', 'Sitemap', 'Navegación']
              : [domain.shortTitle]),
          comingSoon: guideMeta?.comingSoon || node.sectionId === 'intelligence_impulsa',
          accessible,
          accessLabel,
          requiredModuleCode,
          requiredModuleName,
          breadcrumbPath: breadcrumbs,
          liveCount: live.count,
          liveCountLabel: live.label,
        };
      });

    const accessibleCount = groupNodes.filter((n) => n.accessible).length;

    return {
      domain,
      nodes: groupNodes,
      totalCount: groupNodes.length,
      accessibleCount,
      restrictedCount: groupNodes.length - accessibleCount,
    };
  });
}

export function filterSitemapGraph(params: {
  domains: SitemapDomainResolved[];
  query: string;
  layer: SitemapArchitectureLayer;
  accessFilter: SitemapAccessFilter;
}): SitemapDomainResolved[] {
  const { domains, query, layer, accessFilter } = params;
  const q = query.trim().toLowerCase();

  return domains
    .filter((entry) => layer === 'ALL' || entry.domain.layer === layer)
    .map((entry) => {
      const domainMatchesQuery =
        !q ||
        entry.domain.title.toLowerCase().includes(q) ||
        entry.domain.description.toLowerCase().includes(q);

      const filteredNodes = entry.nodes.filter((node) => {
        if (accessFilter === 'ACCESSIBLE' && !node.accessible) return false;
        if (accessFilter === 'RESTRICTED' && node.accessible) return false;
        if (!q || domainMatchesQuery) return true;
        return (
          node.label.toLowerCase().includes(q) ||
          node.sectionId.toLowerCase().includes(q) ||
          node.summary.toLowerCase().includes(q) ||
          node.tags.some((t) => t.toLowerCase().includes(q)) ||
          (node.requiredModuleName || '').toLowerCase().includes(q)
        );
      });

      const accessibleCount = filteredNodes.filter((n) => n.accessible).length;
      return {
        ...entry,
        nodes: filteredNodes,
        totalCount: filteredNodes.length,
        accessibleCount,
        restrictedCount: filteredNodes.length - accessibleCount,
      };
    })
    .filter((entry) => entry.nodes.length > 0);
}
