import type { NavSectionId } from '../types/axycore';

export interface BreadcrumbSiblingItem {
  sectionId: NavSectionId;
  label: string;
}

export interface BreadcrumbSegment {
  id: string;
  label: string;
  targetSection?: NavSectionId;
  isCurrent: boolean;
  isHome?: boolean;
  siblings?: BreadcrumbSiblingItem[];
}

export type NavigationGroupKey =
  | 'inicio'
  | 'prestamos'
  | 'clientes'
  | 'cartera'
  | 'contact_center'
  | 'operaciones'
  | 'reportes'
  | 'inteligencia'
  | 'administracion';

interface SectionHierarchyNode {
  sectionId: NavSectionId;
  label: string;
  groupKey: NavigationGroupKey;
  parentSectionId?: NavSectionId;
}

const GROUP_LABELS: Record<NavigationGroupKey, string> = {
  inicio: 'Inicio',
  prestamos: 'Préstamos',
  clientes: 'Clientes',
  cartera: 'Cobros',
  contact_center: 'Contact Center',
  operaciones: 'Operaciones Generales',
  reportes: 'Reportes',
  inteligencia: 'Inteligencia y Control Institucional',
  administracion: 'Administración',
};

const GROUP_DEFAULT_LANDING_ORDER: Record<NavigationGroupKey, NavSectionId[]> = {
  inicio: ['dashboard', 'system_guide', 'platform_control'],
  prestamos: ['applications', 'new_application', 'loan_calculator', 'decision_engine', 'evaluation', 'committee', 'loans'],
  clientes: ['customers', 'customers_active', 'customers_inactive', 'customers_update', 'documents'],
  cartera: ['cobranza_portfolio', 'cobranza_daily', 'cobranza_dashboard', 'cobranza_payments'],
  contact_center: ['cobranza_contact_center'],
  operaciones: [
    'accounting',
    'accounting_chart_of_accounts',
    'accounting_journal_entries',
    'accounting_daily_book',
    'accounting_general_ledger',
    'accounting_receivables',
    'accounting_payables',
    'accounting_taxes',
    'accounting_payment_validation',
    'cobranza_reconciliation',
    'ecf_dashboard',
    'accounting_statements',
    'register_payment',
    'register_expense',
    'register_investor',
  ],
  reportes: ['reports', 'cobranza_reports'],
  inteligencia: ['director', 'intelligence_dashboard', 'cobranza_sentinel', 'cobranza_anticipate', 'intelligence_altera', 'intelligence_impulsa', 'regula', 'system_sitemap'],
  administracion: [
    'admin_users',
    'policies',
    'admin_roles',
    'cobranza_assignment',
    'cobranza_params',
    'admin_settings',
    'audit',
    'admin_risk_bands',
    'admin_product_limits',
    'admin_approval_matrix',
    'admin_workflow',
  ],
};

export const SECTION_HIERARCHY: Record<NavSectionId, SectionHierarchyNode> = {
  // INICIO
  platform_control: { sectionId: 'platform_control', label: 'AxyCore Platform Control', groupKey: 'inicio' },
  dashboard: { sectionId: 'dashboard', label: 'Dashboard', groupKey: 'inicio' },
  system_guide: { sectionId: 'system_guide', label: 'Guía de AxyCore', groupKey: 'inicio' },
  bela: { sectionId: 'bela', label: 'Asistente Bela', groupKey: 'inteligencia' },

  // PRÉSTAMOS
  new_application: { sectionId: 'new_application', label: 'Nueva Solicitud', groupKey: 'prestamos' },
  loan_calculator: { sectionId: 'loan_calculator', label: 'Calculadora de Préstamos', groupKey: 'prestamos' },
  applications: { sectionId: 'applications', label: 'Solicitudes Recibidas', groupKey: 'prestamos' },
  decision_engine: { sectionId: 'decision_engine', label: 'Motor de Decisiones', groupKey: 'prestamos' },
  evaluation: { sectionId: 'evaluation', label: 'Evaluación', groupKey: 'prestamos' },
  committee: { sectionId: 'committee', label: 'Comité', groupKey: 'prestamos' },
  formalization: { sectionId: 'formalization', label: 'Formalización', groupKey: 'prestamos' },
  disbursements: { sectionId: 'disbursements', label: 'Desembolso', groupKey: 'prestamos' },
  loans: { sectionId: 'loans', label: 'Activos', groupKey: 'prestamos' },
  credit_dashboard: { sectionId: 'credit_dashboard', label: 'Mapa de Riesgo y Originación', groupKey: 'prestamos' },

  // CLIENTES
  customers: { sectionId: 'customers', label: 'Todos los Clientes', groupKey: 'clientes' },
  customers_active: {
    sectionId: 'customers_active',
    label: 'Activos',
    groupKey: 'clientes',
    parentSectionId: 'customers',
  },
  customers_inactive: {
    sectionId: 'customers_inactive',
    label: 'Inactivos',
    groupKey: 'clientes',
    parentSectionId: 'customers',
  },
  customers_update: { sectionId: 'customers_update', label: 'Actualizar Datos de Clientes', groupKey: 'clientes' },
  documents: { sectionId: 'documents', label: 'Expedientes Digitales', groupKey: 'clientes' },

  // COBROS
  cobranza_portfolio: { sectionId: 'cobranza_portfolio', label: 'Clientes en Cobros', groupKey: 'cartera' },
  cobranza_daily: { sectionId: 'cobranza_daily', label: 'Cobros del día', groupKey: 'cartera' },
  cobranza_urgent: { sectionId: 'cobranza_urgent', label: 'Cobros Urgentes', groupKey: 'cartera' },
  cobranza_legal: { sectionId: 'cobranza_legal', label: 'Cobros en Legal', groupKey: 'cartera' },
  cobranza_discounts: { sectionId: 'cobranza_discounts', label: 'Descuentos', groupKey: 'cartera' },
  cobranza_discounts_mora: {
    sectionId: 'cobranza_discounts_mora',
    label: 'Mora',
    groupKey: 'cartera',
    parentSectionId: 'cobranza_discounts',
  },
  cobranza_discounts_payoff: {
    sectionId: 'cobranza_discounts_payoff',
    label: 'Saldos',
    groupKey: 'cartera',
    parentSectionId: 'cobranza_discounts',
  },
  cobranza_actions: { sectionId: 'cobranza_actions', label: 'Gestiones de Cobros', groupKey: 'cartera' },
  cobranza_agreements_today: {
    sectionId: 'cobranza_agreements_today',
    label: 'Acuerdos del día',
    groupKey: 'cartera',
    parentSectionId: 'cobranza_actions',
  },
  cobranza_agreements_broken: {
    sectionId: 'cobranza_agreements_broken',
    label: 'Acuerdos Incumplidos',
    groupKey: 'cartera',
    parentSectionId: 'cobranza_actions',
  },
  cobranza_dashboard: { sectionId: 'cobranza_dashboard', label: 'Panel de Cobranza', groupKey: 'cartera' },
  cobranza_promises: { sectionId: 'cobranza_promises', label: 'Todos los Acuerdos y Promesas', groupKey: 'cartera' },
  cobranza_payments: { sectionId: 'cobranza_payments', label: 'Pagos', groupKey: 'cartera' },
  cobranza_bot: { sectionId: 'cobranza_bot', label: 'AxyRecovery Bot', groupKey: 'cartera' },
  cobranza_my_actions: { sectionId: 'cobranza_my_actions', label: 'Mis Gestiones', groupKey: 'cartera' },
  cobranza_agenda: { sectionId: 'cobranza_agenda', label: 'Agenda de Seguimiento', groupKey: 'cartera' },
  cobranza_unidentified: { sectionId: 'cobranza_unidentified', label: 'Pagos por Identificar', groupKey: 'cartera' },
  cobranza_audit: { sectionId: 'cobranza_audit', label: 'Auditoría y Cierre Cobranza', groupKey: 'cartera' },

  // CONTACT CENTER (módulo aparte)
  cobranza_contact_center: { sectionId: 'cobranza_contact_center', label: 'Contact Center KPIs', groupKey: 'contact_center' },

  // OPERACIONES GENERALES · CONTABILIDAD & FACTURACIÓN ELECTRÓNICA DGII
  accounting: { sectionId: 'accounting', label: 'Contabilidad', groupKey: 'operaciones' },
  accounting_chart_of_accounts: {
    sectionId: 'accounting_chart_of_accounts',
    label: 'Plan de Cuentas',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_journal_entries: {
    sectionId: 'accounting_journal_entries',
    label: 'Asientos Contables',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_daily_book: {
    sectionId: 'accounting_daily_book',
    label: 'Libro Diario',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_general_ledger: {
    sectionId: 'accounting_general_ledger',
    label: 'Libro Mayor',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_receivables: {
    sectionId: 'accounting_receivables',
    label: 'Cuentas por Cobrar',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_payables: {
    sectionId: 'accounting_payables',
    label: 'Cuentas por Pagar',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_taxes: {
    sectionId: 'accounting_taxes',
    label: 'Impuestos',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_payment_validation: {
    sectionId: 'accounting_payment_validation',
    label: 'Pagos para Validar',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  cobranza_reconciliation: {
    sectionId: 'cobranza_reconciliation',
    label: 'Conciliación Bancaria',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  accounting_statements: {
    sectionId: 'accounting_statements',
    label: 'Reportes Contables',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },

  // FACTURACIÓN ELECTRÓNICA DGII (dentro de Contabilidad)
  ecf_dashboard: {
    sectionId: 'ecf_dashboard',
    label: 'Facturación Electrónica DGII',
    groupKey: 'operaciones',
    parentSectionId: 'accounting',
  },
  ecf_emit: {
    sectionId: 'ecf_emit',
    label: 'Emitir Factura Electrónica',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_issued: {
    sectionId: 'ecf_issued',
    label: 'Facturas Emitidas',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_received: {
    sectionId: 'ecf_received',
    label: 'Facturas Recibidas',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_credit_notes: {
    sectionId: 'ecf_credit_notes',
    label: 'Notas de Crédito',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_debit_notes: {
    sectionId: 'ecf_debit_notes',
    label: 'Notas de Débito',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_dgii_status: {
    sectionId: 'ecf_dgii_status',
    label: 'Consulta de Estado DGII',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_void: {
    sectionId: 'ecf_void',
    label: 'Anulaciones',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_customers: {
    sectionId: 'ecf_customers',
    label: 'Clientes y Receptores',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_products: {
    sectionId: 'ecf_products',
    label: 'Productos y Servicios',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_sequences: {
    sectionId: 'ecf_sequences',
    label: 'Secuencias e-NCF',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_certificates: {
    sectionId: 'ecf_certificates',
    label: 'Certificados Digitales',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_config: {
    sectionId: 'ecf_config',
    label: 'Configuración DGII',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_sandbox: {
    sectionId: 'ecf_sandbox',
    label: 'Ambiente de Pruebas',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_reports: {
    sectionId: 'ecf_reports',
    label: 'Reportes Fiscales',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },
  ecf_audit: {
    sectionId: 'ecf_audit',
    label: 'Auditoría y Trazabilidad',
    groupKey: 'operaciones',
    parentSectionId: 'ecf_dashboard',
  },

  register_payment: { sectionId: 'register_payment', label: 'Registrar Pagos', groupKey: 'operaciones' },
  register_expense: { sectionId: 'register_expense', label: 'Registrar Gastos', groupKey: 'operaciones' },
  register_investor: { sectionId: 'register_investor', label: 'Registrar Inversionistas', groupKey: 'operaciones' },

  // REPORTES
  reports: { sectionId: 'reports', label: 'Reportes y Analítica', groupKey: 'reportes' },
  cobranza_reports: { sectionId: 'cobranza_reports', label: 'Reportes de Cobranza', groupKey: 'reportes' },

  // INTELIGENCIA
  director: { sectionId: 'director', label: 'AxyCore Director', groupKey: 'inteligencia' },
  intelligence_dashboard: { sectionId: 'intelligence_dashboard', label: 'Inteligencia de Motor', groupKey: 'inteligencia' },
  cobranza_sentinel: { sectionId: 'cobranza_sentinel', label: 'Centinela', groupKey: 'inteligencia' },
  cobranza_anticipate: { sectionId: 'cobranza_anticipate', label: 'Anticípate', groupKey: 'inteligencia' },
  intelligence_altera: { sectionId: 'intelligence_altera', label: 'Altera', groupKey: 'inteligencia' },
  regula: { sectionId: 'regula', label: 'REGULA', groupKey: 'inteligencia' },
  intelligence_impulsa: { sectionId: 'intelligence_impulsa', label: 'Impulsa', groupKey: 'inteligencia' },
  system_sitemap: { sectionId: 'system_sitemap', label: 'Mapa del Sistema', groupKey: 'inteligencia' },

  // ADMINISTRACIÓN & SUBMENÚS
  admin_users: { sectionId: 'admin_users', label: 'Usuarios', groupKey: 'administracion' },
  admin_roles: { sectionId: 'admin_roles', label: 'Roles y Permisos', groupKey: 'administracion' },
  policies: { sectionId: 'policies', label: 'Parámetros Crediticios', groupKey: 'administracion' },
  admin_risk_bands: {
    sectionId: 'admin_risk_bands',
    label: 'Bandas de Riesgo y Tasas',
    groupKey: 'administracion',
    parentSectionId: 'policies',
  },
  admin_product_limits: {
    sectionId: 'admin_product_limits',
    label: 'Límites de Productos',
    groupKey: 'administracion',
    parentSectionId: 'policies',
  },
  admin_approval_matrix: {
    sectionId: 'admin_approval_matrix',
    label: 'Facultades de Aprobación',
    groupKey: 'administracion',
    parentSectionId: 'policies',
  },
  admin_workflow: {
    sectionId: 'admin_workflow',
    label: 'Flujo de Aprobación',
    groupKey: 'administracion',
    parentSectionId: 'policies',
  },
  cobranza_assignment: { sectionId: 'cobranza_assignment', label: 'Asignación de Cartera', groupKey: 'administracion' },
  cobranza_params: { sectionId: 'cobranza_params', label: 'Parámetros de Cobranza', groupKey: 'administracion' },
  admin_settings: { sectionId: 'admin_settings', label: 'Configuración Institucional', groupKey: 'administracion' },
  audit: { sectionId: 'audit', label: 'Auditoría', groupKey: 'administracion' },
};

const ADMIN_TOP_LEVEL_SECTIONS: NavSectionId[] = [
  'admin_users',
  'admin_roles',
  'policies',
  'cobranza_assignment',
  'cobranza_params',
  'admin_settings',
  'audit',
];

const POLICY_SUBMENU_SECTIONS: NavSectionId[] = [
  'policies',
  'admin_risk_bands',
  'admin_product_limits',
  'admin_approval_matrix',
  'admin_workflow',
];

const ACCOUNTING_SUBMENU_SECTIONS: NavSectionId[] = [
  'accounting',
  'accounting_chart_of_accounts',
  'accounting_journal_entries',
  'accounting_daily_book',
  'accounting_general_ledger',
  'accounting_receivables',
  'accounting_payables',
  'accounting_taxes',
  'accounting_payment_validation',
  'cobranza_reconciliation',
  'ecf_dashboard',
  'accounting_statements',
];

const ECF_SUBMENU_SECTIONS: NavSectionId[] = [
  'ecf_dashboard',
  'ecf_emit',
  'ecf_issued',
  'ecf_received',
  'ecf_credit_notes',
  'ecf_debit_notes',
  'ecf_dgii_status',
  'ecf_void',
  'ecf_customers',
  'ecf_products',
  'ecf_sequences',
  'ecf_certificates',
  'ecf_config',
  'ecf_sandbox',
  'ecf_reports',
  'ecf_audit',
];

const COBRANZA_DISCOUNTS_SUBMENU_SECTIONS: NavSectionId[] = [
  'cobranza_discounts_mora',
  'cobranza_discounts_payoff',
];

export function isAdministrationSection(sectionId: NavSectionId): boolean {
  return SECTION_HIERARCHY[sectionId]?.groupKey === 'administracion';
}

function getPermittedSiblings(
  candidateSections: NavSectionId[],
  canAccessSection: (section: NavSectionId) => boolean
): BreadcrumbSiblingItem[] {
  return candidateSections
    .filter((id) => canAccessSection(id))
    .map((id) => ({
      sectionId: id,
      label: SECTION_HIERARCHY[id].label,
    }));
}

/**
 * Pure breadcrumb trail builder automatically synchronized with `activeSection`
 * and RBAC permissions (`canAccessSection`).
 */
export function buildBreadcrumbsForSection(params: {
  activeSection: NavSectionId;
  canAccessSection?: (section: NavSectionId) => boolean;
}): BreadcrumbSegment[] {
  const { activeSection, canAccessSection = () => true } = params;
  const node = SECTION_HIERARCHY[activeSection] ?? SECTION_HIERARCHY.dashboard;

  const segments: BreadcrumbSegment[] = [];

  // 1. Root Home Segment
  const homeTarget: NavSectionId | undefined = canAccessSection('dashboard')
    ? 'dashboard'
    : canAccessSection('platform_control')
    ? 'platform_control'
    : undefined;

  if (node.sectionId === 'dashboard') {
    return [
      {
        id: 'home',
        label: 'Inicio',
        isHome: true,
        isCurrent: false,
        targetSection: homeTarget,
      },
      {
        id: 'section_dashboard',
        label: node.label,
        isCurrent: true,
      },
    ];
  }

  segments.push({
    id: 'home',
    label: 'Inicio',
    targetSection: homeTarget,
    isHome: true,
    isCurrent: false,
  });

  // 2. Group Segment (omitted if already 'inicio' such as platform_control)
  if (node.groupKey !== 'inicio') {
    const groupCandidates = GROUP_DEFAULT_LANDING_ORDER[node.groupKey] ?? [];
    const groupLanding = groupCandidates.find((sec) => canAccessSection(sec));
    const groupSiblings =
      node.groupKey === 'administracion'
        ? getPermittedSiblings(ADMIN_TOP_LEVEL_SECTIONS, canAccessSection)
        : undefined;

    segments.push({
      id: `group_${node.groupKey}`,
      label: GROUP_LABELS[node.groupKey],
      targetSection: groupLanding,
      isCurrent: false,
      siblings: groupSiblings && groupSiblings.length > 1 ? groupSiblings : undefined,
    });
  }

  // 3. Ancestor Section Chain (supports 2+ nested levels e.g. Contabilidad -> Facturación Electrónica DGII -> Vista)
  const ancestors: SectionHierarchyNode[] = [];
  let cursor = node.parentSectionId ? SECTION_HIERARCHY[node.parentSectionId] : undefined;
  let guard = 0;
  while (cursor && guard < 5) {
    ancestors.unshift(cursor);
    cursor = cursor.parentSectionId ? SECTION_HIERARCHY[cursor.parentSectionId] : undefined;
    guard += 1;
  }

  for (const parentNode of ancestors) {
    const parentSiblings =
      parentNode.sectionId === 'policies'
        ? getPermittedSiblings(POLICY_SUBMENU_SECTIONS, canAccessSection)
        : parentNode.sectionId === 'accounting'
        ? getPermittedSiblings(ACCOUNTING_SUBMENU_SECTIONS, canAccessSection)
        : parentNode.sectionId === 'ecf_dashboard'
        ? getPermittedSiblings(ECF_SUBMENU_SECTIONS, canAccessSection)
        : parentNode.sectionId === 'cobranza_discounts'
        ? getPermittedSiblings(COBRANZA_DISCOUNTS_SUBMENU_SECTIONS, canAccessSection)
        : undefined;

    segments.push({
      id: `section_${parentNode.sectionId}`,
      label: parentNode.label,
      targetSection: canAccessSection(parentNode.sectionId) ? parentNode.sectionId : undefined,
      isCurrent: false,
      siblings: parentSiblings && parentSiblings.length > 1 ? parentSiblings : undefined,
    });
  }

  // 4. Current Active Section Segment
  const currentSiblings =
    node.sectionId === 'policies' || node.parentSectionId === 'policies'
      ? getPermittedSiblings(POLICY_SUBMENU_SECTIONS, canAccessSection)
      : node.sectionId === 'ecf_dashboard' || node.parentSectionId === 'ecf_dashboard'
      ? getPermittedSiblings(ECF_SUBMENU_SECTIONS, canAccessSection)
      : node.sectionId === 'accounting' || node.parentSectionId === 'accounting'
      ? getPermittedSiblings(ACCOUNTING_SUBMENU_SECTIONS, canAccessSection)
      : node.sectionId === 'cobranza_discounts' || node.parentSectionId === 'cobranza_discounts'
      ? getPermittedSiblings(COBRANZA_DISCOUNTS_SUBMENU_SECTIONS, canAccessSection)
      : node.groupKey === 'administracion'
      ? getPermittedSiblings(ADMIN_TOP_LEVEL_SECTIONS, canAccessSection)
      : undefined;

  segments.push({
    id: `section_${node.sectionId}`,
    label: node.label,
    isCurrent: true,
    siblings: currentSiblings && currentSiblings.length > 1 ? currentSiblings : undefined,
  });

  return segments;
}
