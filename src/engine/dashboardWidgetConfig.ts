import type { CreditPermission, NavSectionId, UserRole } from '../types/axycore';
import { sanitizeIdSegment } from '../utils/formatters';
import type { HomeSmartAlert } from './homeDashboardEngine';

export type ExecutiveKpiWidgetId =
  | 'CARTERA_TOTAL'
  | 'CARTERA_VENCIDA'
  | 'DESEMBOLSOS'
  | 'RECUPERACION';

export type AlertWidgetId = HomeSmartAlert['category'];

export type DashboardSectionId =
  | 'executiveSummary'
  | 'performanceOverview'
  | 'panorama'
  | 'intelligence'
  | 'alertsAndActivity'
  | 'performance'
  | 'collections'
  | 'teamProductivity'
  | 'shortcuts';

export type AlertsViewMode = 'CARDS' | 'FEED';

export const ALL_EXECUTIVE_KPI_IDS: ExecutiveKpiWidgetId[] = [
  'CARTERA_TOTAL',
  'CARTERA_VENCIDA',
  'DESEMBOLSOS',
  'RECUPERACION',
];

export const ALL_ALERT_WIDGET_IDS: AlertWidgetId[] = [
  'CUOTAS_VENCIDAS',
  'PROMESAS_INCUMPLIDAS',
  'PROXIMO_VENCER',
  'EVALUACION',
  'APROBACIONES',
  'EXPEDIENTES',
  'INCIDENCIAS',
];

export const ALL_DASHBOARD_SECTION_IDS: DashboardSectionId[] = [
  'executiveSummary',
  'performanceOverview',
  'panorama',
  'intelligence',
  'alertsAndActivity',
  'performance',
  'collections',
  'teamProductivity',
  'shortcuts',
];

export interface WidgetMetadata<T extends string> {
  id: T;
  label: string;
  shortDesc: string;
  requiredDomain: string;
}

export const EXECUTIVE_KPI_CATALOG: Record<ExecutiveKpiWidgetId, WidgetMetadata<ExecutiveKpiWidgetId>> = {
  CARTERA_TOTAL: {
    id: 'CARTERA_TOTAL',
    label: 'Cartera Total',
    shortDesc: 'Capital vigente activo, variación mensual y operaciones vigentes',
    requiredDomain: 'Cartera',
  },
  CARTERA_VENCIDA: {
    id: 'CARTERA_VENCIDA',
    label: 'Cartera Vencida',
    shortDesc: 'Exposición en mora PAR 1 / PAR 30 y variación frente al corte anterior',
    requiredDomain: 'Riesgo y Mora',
  },
  DESEMBOLSOS: {
    id: 'DESEMBOLSOS',
    label: 'Desembolsos',
    shortDesc: 'Colocación del período, préstamos desembolsados y tendencia',
    requiredDomain: 'Originación y Tesorería',
  },
  RECUPERACION: {
    id: 'RECUPERACION',
    label: 'Recuperación',
    shortDesc: 'Cobros aplicados, cumplimiento frente a meta y evolución',
    requiredDomain: 'Cobros y Finanzas',
  },
};

export const ALERT_WIDGET_CATALOG: Record<AlertWidgetId, WidgetMetadata<AlertWidgetId>> = {
  CUOTAS_VENCIDAS: {
    id: 'CUOTAS_VENCIDAS',
    label: 'Cuotas vencidas',
    shortDesc: 'Cuentas con atraso DPD ≥ 1 ordenadas por severidad',
    requiredDomain: 'Cobranza',
  },
  PROMESAS_INCUMPLIDAS: {
    id: 'PROMESAS_INCUMPLIDAS',
    label: 'Promesas incumplidas',
    shortDesc: 'Compromisos de pago vencidos sin aplicación confirmada',
    requiredDomain: 'Cobranza',
  },
  PROXIMO_VENCER: {
    id: 'PROXIMO_VENCER',
    label: 'Próximo a vencer',
    shortDesc: 'Cuotas con vencimiento en los próximos 5 días',
    requiredDomain: 'Cobranza',
  },
  EVALUACION: {
    id: 'EVALUACION',
    label: 'Pendiente evaluación',
    shortDesc: 'Solicitudes recibidas, en análisis o devueltas',
    requiredDomain: 'Crédito',
  },
  APROBACIONES: {
    id: 'APROBACIONES',
    label: 'Operaciones por aprobar',
    shortDesc: 'Comité de crédito, acuerdos propuestos y gastos pendientes',
    requiredDomain: 'Aprobaciones',
  },
  EXPEDIENTES: {
    id: 'EXPEDIENTES',
    label: 'Expedientes incompletos',
    shortDesc: 'Documentos observados o soportes obligatorios faltantes',
    requiredDomain: 'Documental',
  },
  INCIDENCIAS: {
    id: 'INCIDENCIAS',
    label: 'Incidencias operativas',
    shortDesc: 'Alertas Centinela, disputas abiertas y excepciones de conciliación',
    requiredDomain: 'Riesgo y Control',
  },
};

export const DASHBOARD_SECTION_CATALOG: Record<DashboardSectionId, WidgetMetadata<DashboardSectionId>> = {
  executiveSummary: {
    id: 'executiveSummary',
    label: 'Resumen Ejecutivo (KPIs)',
    shortDesc: 'Tarjetas financieras configurables del período',
    requiredDomain: 'Inicio',
  },
  performanceOverview: {
    id: 'performanceOverview',
    label: 'Vista General de Desempeño',
    shortDesc: 'Tasa de aprobación, colocación diaria e índice de mora PAR 30 con gráficas Recharts',
    requiredDomain: 'Desempeño Ejecutivo',
  },
  panorama: {
    id: 'panorama',
    label: 'Panorama Financiero (4 Gráficos)',
    shortDesc: 'Evolución, desembolsos vs recuperación, morosidad y productos',
    requiredDomain: 'Analítica',
  },
  intelligence: {
    id: 'intelligence',
    label: 'AxyCore Intelligence',
    shortDesc: 'Observaciones ejecutivas y diagnóstico IA en vivo',
    requiredDomain: 'Inteligencia',
  },
  alertsAndActivity: {
    id: 'alertsAndActivity',
    label: 'Centro de Alertas y Actividad',
    shortDesc: 'Alertas priorizadas configurables y bitácora reciente',
    requiredDomain: 'Supervisión',
  },
  performance: {
    id: 'performance',
    label: 'Rendimiento de la Institución',
    shortDesc: '6 indicadores de eficiencia por área operativa',
    requiredDomain: 'Desempeño',
  },
  collections: {
    id: 'collections',
    label: 'Resumen de Cobros',
    shortDesc: 'Meta diaria, contactabilidad y recuperación por etapa',
    requiredDomain: 'Cobranza',
  },
  teamProductivity: {
    id: 'teamProductivity',
    label: 'Productividad del Equipo',
    shortDesc: 'Operaciones por usuario y rendimiento departamental',
    requiredDomain: 'Equipo',
  },
  shortcuts: {
    id: 'shortcuts',
    label: 'Accesos Inteligentes',
    shortDesc: 'Atajos operativos dinámicos según permisos',
    requiredDomain: 'Navegación',
  },
};

export interface RoleDashboardPolicy {
  role: UserRole;
  canConfigure: boolean;
  allowedKpis: ExecutiveKpiWidgetId[];
  defaultKpiOrder: ExecutiveKpiWidgetId[];
  defaultHiddenKpis: ExecutiveKpiWidgetId[];
  lockedVisibleKpis: ExecutiveKpiWidgetId[];
  allowedAlerts: AlertWidgetId[];
  defaultAlertOrder: AlertWidgetId[];
  defaultHiddenAlerts: AlertWidgetId[];
  lockedVisibleAlerts: AlertWidgetId[];
  allowedSections: DashboardSectionId[];
  defaultSectionOrder: DashboardSectionId[];
  defaultHiddenSections: DashboardSectionId[];
  roleSummaryNote: string;
}

export interface DashboardWidgetConfigState {
  organizationId: string;
  userId: string;
  role: UserRole;
  sectionOrder: DashboardSectionId[];
  hiddenSections: DashboardSectionId[];
  kpiOrder: ExecutiveKpiWidgetId[];
  hiddenKpis: ExecutiveKpiWidgetId[];
  alertOrder: AlertWidgetId[];
  hiddenAlerts: AlertWidgetId[];
  alertsViewMode: AlertsViewMode;
  updatedAtIso?: string;
}

export type DashboardWidgetAction =
  | { type: 'HYDRATE_REMOTE'; config: Partial<DashboardWidgetConfigState> }
  | { type: 'REORDER_KPI'; fromId: ExecutiveKpiWidgetId; toId: ExecutiveKpiWidgetId }
  | { type: 'MOVE_KPI'; id: ExecutiveKpiWidgetId; direction: -1 | 1 }
  | { type: 'TOGGLE_KPI_VISIBILITY'; id: ExecutiveKpiWidgetId }
  | { type: 'SHOW_ALL_KPIS' }
  | { type: 'REORDER_ALERT'; fromId: AlertWidgetId; toId: AlertWidgetId }
  | { type: 'MOVE_ALERT'; id: AlertWidgetId; direction: -1 | 1 }
  | { type: 'TOGGLE_ALERT_VISIBILITY'; id: AlertWidgetId }
  | { type: 'SHOW_ALL_ALERTS' }
  | { type: 'SET_ALERTS_VIEW_MODE'; mode: AlertsViewMode }
  | { type: 'REORDER_SECTION'; fromId: DashboardSectionId; toId: DashboardSectionId }
  | { type: 'MOVE_SECTION'; id: DashboardSectionId; direction: -1 | 1 }
  | { type: 'TOGGLE_SECTION_VISIBILITY'; id: DashboardSectionId }
  | {
      type: 'RESET_TO_ROLE_DEFAULT';
      organizationId: string;
      userId: string;
    };

function uniqueOrdered<T extends string>(items: T[], allowed: T[]): T[] {
  const allowedSet = new Set(allowed);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (allowedSet.has(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  for (const item of allowed) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function getRoleDashboardPolicy(params: {
  role: UserRole;
  hasPermission: (p: CreditPermission) => boolean;
  canAccessSection: (s: NavSectionId) => boolean;
}): RoleDashboardPolicy {
  const { role, hasPermission, canAccessSection } = params;

  if (role === 'EXTERNAL_CLIENT') {
    return {
      role,
      canConfigure: false,
      allowedKpis: ['CARTERA_TOTAL'],
      defaultKpiOrder: ['CARTERA_TOTAL'],
      defaultHiddenKpis: [],
      lockedVisibleKpis: ['CARTERA_TOTAL'],
      allowedAlerts: [],
      defaultAlertOrder: [],
      defaultHiddenAlerts: [],
      lockedVisibleAlerts: [],
      allowedSections: ['executiveSummary', 'shortcuts'],
      defaultSectionOrder: ['executiveSummary', 'shortcuts'],
      defaultHiddenSections: [],
      roleSummaryNote: 'Vista portal cliente con acceso limitado.',
    };
  }

  const canSeeCredit =
    hasPermission('VIEW_INTERNAL_INBOX') ||
    canAccessSection('applications') ||
    canAccessSection('evaluation') ||
    canAccessSection('committee');
  const canSeeCollections =
    hasPermission('VIEW_COLLECTIONS_PORTFOLIO') ||
    canAccessSection('cobranza_portfolio') ||
    canAccessSection('cobranza_daily');
  const canSeeDocs = canSeeCredit || canAccessSection('documents');
  const canSeeApprovals =
    canSeeCredit || canAccessSection('cobranza_actions') || canAccessSection('register_expense');
  const canSeeIncidents =
    canSeeCollections ||
    canAccessSection('cobranza_sentinel') ||
    canAccessSection('cobranza_reconciliation') ||
    canAccessSection('cobranza_unidentified');

  const computeAllowedAlertsFromRbac = (preferredOrder: AlertWidgetId[]): AlertWidgetId[] => {
    const mapAllowed: Record<AlertWidgetId, boolean> = {
      CUOTAS_VENCIDAS: canSeeCollections,
      PROMESAS_INCUMPLIDAS: canSeeCollections,
      PROXIMO_VENCER: canSeeCollections,
      EVALUACION: canSeeCredit,
      APROBACIONES: canSeeApprovals,
      EXPEDIENTES: canSeeDocs,
      INCIDENCIAS: canSeeIncidents,
    };
    const filtered = preferredOrder.filter((id) => mapAllowed[id]);
    return filtered.length > 0 ? filtered : ['APROBACIONES'];
  };

  switch (role) {
    case 'ADMIN':
    case 'MANAGEMENT':
    case 'AUDITOR': {
      const kpis: ExecutiveKpiWidgetId[] = [
        'CARTERA_TOTAL',
        'CARTERA_VENCIDA',
        'DESEMBOLSOS',
        'RECUPERACION',
      ];
      const alerts: AlertWidgetId[] = [
        'CUOTAS_VENCIDAS',
        'PROMESAS_INCUMPLIDAS',
        'APROBACIONES',
        'EVALUACION',
        'PROXIMO_VENCER',
        'EXPEDIENTES',
        'INCIDENCIAS',
      ];
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: ALL_DASHBOARD_SECTION_IDS,
        defaultHiddenSections: [],
        roleSummaryNote:
          role === 'AUDITOR'
            ? 'Control transversal de auditoría con visibilidad completa de KPIs y alertas.'
            : 'Control ejecutivo completo sobre todos los widgets de Resumen Ejecutivo y Centro de Alertas.',
      };
    }

    case 'RISK_OFFICER': {
      const kpis: ExecutiveKpiWidgetId[] = [
        'CARTERA_VENCIDA',
        'CARTERA_TOTAL',
        'RECUPERACION',
        'DESEMBOLSOS',
      ];
      const alerts = computeAllowedAlertsFromRbac([
        'CUOTAS_VENCIDAS',
        'INCIDENCIAS',
        'EVALUACION',
        'PROMESAS_INCUMPLIDAS',
        'APROBACIONES',
        'EXPEDIENTES',
        'PROXIMO_VENCER',
      ]);
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'intelligence',
          'panorama',
          'performance',
          'collections',
          'teamProductivity',
          'shortcuts',
        ],
        defaultHiddenSections: [],
        roleSummaryNote:
          'Prioridad de Riesgo: Cartera Vencida, alertas Centinela e incidencias de originación en primer plano.',
      };
    }

    case 'BUSINESS_OFFICER': {
      const kpis: ExecutiveKpiWidgetId[] = [
        'DESEMBOLSOS',
        'CARTERA_TOTAL',
        'RECUPERACION',
        'CARTERA_VENCIDA',
      ];
      const alerts = computeAllowedAlertsFromRbac([
        'EVALUACION',
        'EXPEDIENTES',
        'APROBACIONES',
        'PROXIMO_VENCER',
        'CUOTAS_VENCIDAS',
      ]);
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: ALL_DASHBOARD_SECTION_IDS,
        defaultHiddenSections: [],
        roleSummaryNote:
          'Enfoque Comercial: Desembolsos, originación y expedientes priorizados según permisos de negocios.',
      };
    }

    case 'CREDIT_ANALYST': {
      const kpis: ExecutiveKpiWidgetId[] = [
        'CARTERA_TOTAL',
        'DESEMBOLSOS',
        'CARTERA_VENCIDA',
        'RECUPERACION',
      ];
      const alerts = computeAllowedAlertsFromRbac([
        'EVALUACION',
        'EXPEDIENTES',
        'APROBACIONES',
        'CUOTAS_VENCIDAS',
        'PROXIMO_VENCER',
      ]);
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'panorama',
          'intelligence',
          'performance',
          'teamProductivity',
          'collections',
          'shortcuts',
        ],
        defaultHiddenSections: ['collections'],
        roleSummaryNote:
          'Enfoque Analítico: Solicitudes en evaluación, depuración documental y aprobación de comité.',
      };
    }

    case 'COMMITTEE_MEMBER': {
      const kpis: ExecutiveKpiWidgetId[] = [
        'CARTERA_TOTAL',
        'CARTERA_VENCIDA',
        'DESEMBOLSOS',
        'RECUPERACION',
      ];
      const alerts = computeAllowedAlertsFromRbac([
        'APROBACIONES',
        'EVALUACION',
        'EXPEDIENTES',
        'CUOTAS_VENCIDAS',
        'PROXIMO_VENCER',
      ]);
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'intelligence',
          'panorama',
          'performance',
          'teamProductivity',
          'collections',
          'shortcuts',
        ],
        defaultHiddenSections: [],
        roleSummaryNote:
          'Enfoque de Comité: Expedientes pendientes de votación y salud de cartera en primer orden.',
      };
    }

    case 'FORMALIZATION': {
      const kpis: ExecutiveKpiWidgetId[] = ['DESEMBOLSOS', 'CARTERA_TOTAL', 'RECUPERACION'];
      const alerts: AlertWidgetId[] = ['APROBACIONES', 'EXPEDIENTES', 'EVALUACION'];
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'panorama',
          'performance',
          'teamProductivity',
          'intelligence',
          'shortcuts',
        ],
        defaultSectionOrder: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'panorama',
          'performance',
          'teamProductivity',
          'intelligence',
          'shortcuts',
        ],
        defaultHiddenSections: [],
        roleSummaryNote:
          'Enfoque de Formalización: Contratos aprobados, pagarés y validación de expedientes.',
      };
    }

    case 'OPERATIONS':
    case 'FINANCE': {
      const isFinance = role === 'FINANCE';
      const kpis: ExecutiveKpiWidgetId[] = isFinance
        ? ['RECUPERACION', 'DESEMBOLSOS', 'CARTERA_TOTAL', 'CARTERA_VENCIDA']
        : ['DESEMBOLSOS', 'CARTERA_TOTAL', 'RECUPERACION', 'CARTERA_VENCIDA'];
      const alerts = computeAllowedAlertsFromRbac(
        isFinance
          ? ['INCIDENCIAS', 'CUOTAS_VENCIDAS', 'PROMESAS_INCUMPLIDAS', 'APROBACIONES', 'PROXIMO_VENCER']
          : ['APROBACIONES', 'EXPEDIENTES', 'CUOTAS_VENCIDAS', 'PROXIMO_VENCER', 'INCIDENCIAS']
      );
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: ALL_DASHBOARD_SECTION_IDS,
        defaultSectionOrder: ALL_DASHBOARD_SECTION_IDS,
        defaultHiddenSections: [],
        roleSummaryNote: isFinance
          ? 'Enfoque Financiero: Recuperación aplicada, conciliación bancaria y desembolsos.'
          : 'Enfoque Operativo: Desembolsos, pagos reportados y seguimiento de cartera.',
      };
    }

    case 'COLLECTION_AGENT':
    case 'SUPERVISOR':
    case 'COLLECTION_COORDINATOR': {
      const kpis: ExecutiveKpiWidgetId[] = ['RECUPERACION', 'CARTERA_VENCIDA', 'CARTERA_TOTAL'];
      const alerts = computeAllowedAlertsFromRbac([
        'CUOTAS_VENCIDAS',
        'PROMESAS_INCUMPLIDAS',
        'PROXIMO_VENCER',
        'INCIDENCIAS',
        'APROBACIONES',
      ]);
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'collections',
          'panorama',
          'intelligence',
          'performance',
          'teamProductivity',
          'shortcuts',
        ],
        defaultSectionOrder: [
          'executiveSummary',
          'performanceOverview',
          'alertsAndActivity',
          'collections',
          'panorama',
          'intelligence',
          'performance',
          'teamProductivity',
          'shortcuts',
        ],
        defaultHiddenSections: [],
        roleSummaryNote:
          'Enfoque de Cobranza: Recuperación, Cartera Vencida, cuotas atrasadas y promesas incumplidas sin métricas de originación comercial.',
      };
    }

    case 'CASHIER': {
      const kpis: ExecutiveKpiWidgetId[] = ['RECUPERACION', 'CARTERA_VENCIDA'];
      const alerts: AlertWidgetId[] = ['PROXIMO_VENCER', 'CUOTAS_VENCIDAS', 'PROMESAS_INCUMPLIDAS'];
      return {
        role,
        canConfigure: true,
        allowedKpis: kpis,
        defaultKpiOrder: kpis,
        defaultHiddenKpis: [],
        lockedVisibleKpis: [],
        allowedAlerts: alerts,
        defaultAlertOrder: alerts,
        defaultHiddenAlerts: [],
        lockedVisibleAlerts: [],
        allowedSections: [
          'executiveSummary',
          'alertsAndActivity',
          'collections',
          'shortcuts',
        ],
        defaultSectionOrder: [
          'executiveSummary',
          'alertsAndActivity',
          'collections',
          'shortcuts',
        ],
        defaultHiddenSections: [],
        roleSummaryNote:
          'Enfoque de Caja: Recaudo diario, cuotas exigibles y vencimientos próximos.',
      };
    }
  }
}

export function buildDashboardWidgetDocId(
  organizationId: string,
  userId: string,
  role: UserRole
): string {
  const orgSeg = sanitizeIdSegment(organizationId || 'org_axycore_main');
  const uidSeg = sanitizeIdSegment(userId || 'anon');
  const roleSeg = sanitizeIdSegment(role);
  return `dwc_${orgSeg}_${uidSeg}_${roleSeg}`.slice(0, 128);
}

export function buildDefaultDashboardWidgetConfig(params: {
  organizationId: string;
  userId: string;
  policy: RoleDashboardPolicy;
}): DashboardWidgetConfigState {
  const { organizationId, userId, policy } = params;
  return {
    organizationId,
    userId,
    role: policy.role,
    sectionOrder: [...policy.defaultSectionOrder],
    hiddenSections: [...policy.defaultHiddenSections],
    kpiOrder: [...policy.defaultKpiOrder],
    hiddenKpis: [...policy.defaultHiddenKpis],
    alertOrder: [...policy.defaultAlertOrder],
    hiddenAlerts: [...policy.defaultHiddenAlerts],
    alertsViewMode: 'CARDS',
  };
}

export function sanitizeDashboardWidgetConfig(
  raw: Partial<DashboardWidgetConfigState> | null | undefined,
  policy: RoleDashboardPolicy,
  meta: { organizationId: string; userId: string }
): DashboardWidgetConfigState {
  const defaults = buildDefaultDashboardWidgetConfig({
    organizationId: meta.organizationId,
    userId: meta.userId,
    policy,
  });
  if (!raw) return defaults;

  const allowedSectionSet = new Set(policy.allowedSections);
  const allowedKpiSet = new Set(policy.allowedKpis);
  const allowedAlertSet = new Set(policy.allowedAlerts);

  const lockedKpiSet = new Set(policy.lockedVisibleKpis);
  const lockedAlertSet = new Set(policy.lockedVisibleAlerts);

  const rawSectionOrder = Array.isArray(raw.sectionOrder)
    ? (raw.sectionOrder as DashboardSectionId[])
    : defaults.sectionOrder;
  const shouldPromotePerfOverview =
    Array.isArray(raw.sectionOrder) &&
    !rawSectionOrder.includes('performanceOverview') &&
    allowedSectionSet.has('performanceOverview');
  const sectionOrder = uniqueOrdered(rawSectionOrder, policy.allowedSections);
  if (shouldPromotePerfOverview) {
    const perfIdx = sectionOrder.indexOf('performanceOverview');
    const execIdx = sectionOrder.indexOf('executiveSummary');
    if (perfIdx > -1) {
      sectionOrder.splice(perfIdx, 1);
      sectionOrder.splice(execIdx >= 0 ? execIdx + 1 : 0, 0, 'performanceOverview');
    }
  }
  const hiddenSections = Array.from(
    new Set(
      (Array.isArray(raw.hiddenSections)
        ? (raw.hiddenSections as DashboardSectionId[])
        : defaults.hiddenSections
      ).filter((id) => allowedSectionSet.has(id))
    )
  );

  const kpiOrder = uniqueOrdered(
    Array.isArray(raw.kpiOrder) ? (raw.kpiOrder as ExecutiveKpiWidgetId[]) : defaults.kpiOrder,
    policy.allowedKpis
  );
  const hiddenKpis = Array.from(
    new Set(
      (Array.isArray(raw.hiddenKpis)
        ? (raw.hiddenKpis as ExecutiveKpiWidgetId[])
        : defaults.hiddenKpis
      ).filter((id) => allowedKpiSet.has(id) && !lockedKpiSet.has(id))
    )
  );

  const alertOrder = uniqueOrdered(
    Array.isArray(raw.alertOrder) ? (raw.alertOrder as AlertWidgetId[]) : defaults.alertOrder,
    policy.allowedAlerts
  );
  const hiddenAlerts = Array.from(
    new Set(
      (Array.isArray(raw.hiddenAlerts)
        ? (raw.hiddenAlerts as AlertWidgetId[])
        : defaults.hiddenAlerts
      ).filter((id) => allowedAlertSet.has(id) && !lockedAlertSet.has(id))
    )
  );

  const alertsViewMode: AlertsViewMode =
    raw.alertsViewMode === 'FEED' || raw.alertsViewMode === 'CARDS' ? raw.alertsViewMode : 'CARDS';

  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    role: policy.role,
    sectionOrder,
    hiddenSections,
    kpiOrder,
    hiddenKpis,
    alertOrder,
    hiddenAlerts,
    alertsViewMode,
    updatedAtIso: typeof raw.updatedAtIso === 'string' ? raw.updatedAtIso : undefined,
  };
}

export function reorderArrayItem<T extends string>(list: T[], fromId: T, toId: T): T[] {
  if (fromId === toId) return list;
  const fromIdx = list.indexOf(fromId);
  const toIdx = list.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function moveArrayItemByStep<T extends string>(
  list: T[],
  id: T,
  direction: -1 | 1
): T[] {
  const idx = list.indexOf(id);
  if (idx === -1) return list;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);
  return next;
}

export function toggleVisibilityList<T extends string>(
  hiddenList: T[],
  id: T,
  lockedIds: T[] = []
): T[] {
  if (lockedIds.includes(id)) {
    return hiddenList.filter((item) => item !== id);
  }
  return hiddenList.includes(id)
    ? hiddenList.filter((item) => item !== id)
    : [...hiddenList, id];
}

export function dashboardWidgetReducer(
  state: DashboardWidgetConfigState,
  action: DashboardWidgetAction,
  policy: RoleDashboardPolicy
): DashboardWidgetConfigState {
  if (!policy.canConfigure && action.type !== 'HYDRATE_REMOTE' && action.type !== 'RESET_TO_ROLE_DEFAULT') {
    return state;
  }

  switch (action.type) {
    case 'HYDRATE_REMOTE':
      return sanitizeDashboardWidgetConfig(action.config, policy, {
        organizationId: state.organizationId,
        userId: state.userId,
      });

    case 'REORDER_KPI': {
      if (!policy.allowedKpis.includes(action.fromId) || !policy.allowedKpis.includes(action.toId)) {
        return state;
      }
      return {
        ...state,
        kpiOrder: reorderArrayItem(state.kpiOrder, action.fromId, action.toId),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'MOVE_KPI': {
      if (!policy.allowedKpis.includes(action.id)) return state;
      return {
        ...state,
        kpiOrder: moveArrayItemByStep(state.kpiOrder, action.id, action.direction),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'TOGGLE_KPI_VISIBILITY': {
      if (!policy.allowedKpis.includes(action.id)) return state;
      return {
        ...state,
        hiddenKpis: toggleVisibilityList(state.hiddenKpis, action.id, policy.lockedVisibleKpis),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'SHOW_ALL_KPIS':
      return {
        ...state,
        hiddenKpis: [],
        updatedAtIso: new Date().toISOString(),
      };

    case 'REORDER_ALERT': {
      if (!policy.allowedAlerts.includes(action.fromId) || !policy.allowedAlerts.includes(action.toId)) {
        return state;
      }
      return {
        ...state,
        alertOrder: reorderArrayItem(state.alertOrder, action.fromId, action.toId),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'MOVE_ALERT': {
      if (!policy.allowedAlerts.includes(action.id)) return state;
      return {
        ...state,
        alertOrder: moveArrayItemByStep(state.alertOrder, action.id, action.direction),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'TOGGLE_ALERT_VISIBILITY': {
      if (!policy.allowedAlerts.includes(action.id)) return state;
      return {
        ...state,
        hiddenAlerts: toggleVisibilityList(
          state.hiddenAlerts,
          action.id,
          policy.lockedVisibleAlerts
        ),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'SHOW_ALL_ALERTS':
      return {
        ...state,
        hiddenAlerts: [],
        updatedAtIso: new Date().toISOString(),
      };

    case 'SET_ALERTS_VIEW_MODE':
      return {
        ...state,
        alertsViewMode: action.mode,
        updatedAtIso: new Date().toISOString(),
      };

    case 'REORDER_SECTION': {
      if (
        !policy.allowedSections.includes(action.fromId) ||
        !policy.allowedSections.includes(action.toId)
      ) {
        return state;
      }
      return {
        ...state,
        sectionOrder: reorderArrayItem(state.sectionOrder, action.fromId, action.toId),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'MOVE_SECTION': {
      if (!policy.allowedSections.includes(action.id)) return state;
      return {
        ...state,
        sectionOrder: moveArrayItemByStep(state.sectionOrder, action.id, action.direction),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'TOGGLE_SECTION_VISIBILITY': {
      if (!policy.allowedSections.includes(action.id)) return state;
      return {
        ...state,
        hiddenSections: toggleVisibilityList(state.hiddenSections, action.id),
        updatedAtIso: new Date().toISOString(),
      };
    }

    case 'RESET_TO_ROLE_DEFAULT':
      return {
        ...buildDefaultDashboardWidgetConfig({
          organizationId: action.organizationId,
          userId: action.userId,
          policy,
        }),
        updatedAtIso: new Date().toISOString(),
      };
  }
}
