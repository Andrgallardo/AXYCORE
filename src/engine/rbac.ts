import {
  ROLE_LABELS,
  type ApplicationRecord,
  type CreditEvaluationRecord,
  type CreditPermission,
  type CreditPolicyRecord,
  type NavSectionId,
  type UserProfile,
  type UserRole,
} from '../types/axycore';
import { canUserApproveCommittee, type PermissionCheckResult } from './workflowGuards';

export interface RoleProfileDefinition {
  role: UserRole;
  label: string;
  scopeSummary: string;
  workflowFocus: string;
}

export const CREDIT_ROLE_PROFILES: Record<UserRole, RoleProfileDefinition> = {
  ADMIN: {
    role: 'ADMIN',
    label: ROLE_LABELS.ADMIN,
    scopeSummary: 'Gobierno total de políticas, parámetros, usuarios RBAC, créditos y cobranza integral.',
    workflowFocus: 'Administración integral y facultades de excepción',
  },
  BUSINESS_OFFICER: {
    role: 'BUSINESS_OFFICER',
    label: ROLE_LABELS.BUSINESS_OFFICER,
    scopeSummary: 'Originación comercial interna, carga de expedientes y consulta de cartera.',
    workflowFocus: 'Originación y atención comercial (sin evaluación ni aprobación)',
  },
  CREDIT_ANALYST: {
    role: 'CREDIT_ANALYST',
    label: ROLE_LABELS.CREDIT_ANALYST,
    scopeSummary: 'Depuración financiera verificada, revisión documental, recálculo Motor V2 e informe técnico.',
    workflowFocus: 'Evaluación técnica y preparación de expediente para Comité',
  },
  RISK_OFFICER: {
    role: 'RISK_OFFICER',
    label: ROLE_LABELS.RISK_OFFICER,
    scopeSummary: 'Validación independiente de riesgos, Motor V2, dictamen de riesgo y alertas Centinela.',
    workflowFocus: 'Segunda línea de defensa: dictamen y control de riesgo',
  },
  COMMITTEE_MEMBER: {
    role: 'COMMITTEE_MEMBER',
    label: ROLE_LABELS.COMMITTEE_MEMBER,
    scopeSummary: 'Resolución colegiada o individual en Comité de Crédito dentro de límites configurados.',
    workflowFocus: 'Decisión inmutable de aprobación, condicionamiento o rechazo',
  },
  FORMALIZATION: {
    role: 'FORMALIZATION',
    label: ROLE_LABELS.FORMALIZATION,
    scopeSummary: 'Emisión contractual, pagarés, revisión legal y habilitación pre-desembolso.',
    workflowFocus: 'Formalización contractual y cumplimiento de condiciones previas',
  },
  OPERATIONS: {
    role: 'OPERATIONS',
    label: ROLE_LABELS.OPERATIONS,
    scopeSummary: 'Verificación pre-desembolso, activación de préstamos y control operativo de cierres.',
    workflowFocus: 'Control operativo, desembolso y cancelación de préstamos',
  },
  FINANCE: {
    role: 'FINANCE',
    label: ROLE_LABELS.FINANCE,
    scopeSummary: 'Desembolsos, verificación/aplicación de pagos, conciliación bancaria, reversos y cierre de préstamos.',
    workflowFocus: 'Tesorería, conciliación financiera y control contable',
  },
  AUDITOR: {
    role: 'AUDITOR',
    label: ROLE_LABELS.AUDITOR,
    scopeSummary: 'Inspección transversal de solo lectura sobre crédito, cobranza, pagos, reversos y bitácoras.',
    workflowFocus: 'Auditoría independiente de solo lectura',
  },
  COLLECTION_AGENT: {
    role: 'COLLECTION_AGENT',
    label: ROLE_LABELS.COLLECTION_AGENT,
    scopeSummary: 'Gestión de cartera asignada, cobros del día, registro de gestiones, promesas y reporte de comprobantes.',
    workflowFocus: 'Recuperación operativa (sin aplicar ni revertir pagos directamente)',
  },
  SUPERVISOR: {
    role: 'SUPERVISOR',
    label: ROLE_LABELS.SUPERVISOR,
    scopeSummary: 'Supervisión de gestores, asignación de cartera, KPIs Contact Center, alertas Centinela y escalamientos.',
    workflowFocus: 'Supervisión táctica de equipos y cumplimiento de promesas',
  },
  COLLECTION_COORDINATOR: {
    role: 'COLLECTION_COORDINATOR',
    label: ROLE_LABELS.COLLECTION_COORDINATOR,
    scopeSummary: 'Gobierno operativo de cobranza, reglas de asignación, AxyRecovery Bot, acuerdos y parámetros de mora.',
    workflowFocus: 'Coordinación integral de recuperación y automatización',
  },
  CASHIER: {
    role: 'CASHIER',
    label: ROLE_LABELS.CASHIER,
    scopeSummary: 'Recepción y reporte de comprobantes en ventanilla sujeto a verificación/conciliación financiera.',
    workflowFocus: 'Recaudo en caja con segregación de aplicación contable',
  },
  MANAGEMENT: {
    role: 'MANAGEMENT',
    label: ROLE_LABELS.MANAGEMENT,
    scopeSummary: 'Supervisión ejecutiva de morosidad PAR, proyecciones Anticípate, KPIs y aprobación de excepciones.',
    workflowFocus: 'Dirección ejecutiva y control de salud de cartera',
  },
  EXTERNAL_CLIENT: {
    role: 'EXTERNAL_CLIENT',
    label: ROLE_LABELS.EXTERNAL_CLIENT,
    scopeSummary: 'Autoservicio externo limitado a crear solicitudes propias y consultar sus préstamos.',
    workflowFocus: 'Portal externo de solicitante',
  },
};

export const ALL_CREDIT_PERMISSIONS: CreditPermission[] = [
  'ORIGINATE_APPLICATION',
  'VIEW_INTERNAL_INBOX',
  'RUN_SCORING_SIMULATION',
  'VERIFY_DOCUMENTS',
  'EDIT_VERIFIED_FINANCIALS',
  'VERIFY_EVALUATION_CHECKLIST',
  'RECALCULATE_SCORING_V2',
  'EDIT_EVALUATION_REPORT',
  'RISK_SIGN_OFF',
  'SUBMIT_TO_COMMITTEE',
  'RETURN_APPLICATION_FROM_EVALUATION',
  'VIEW_COMMITTEE_QUEUE',
  'DECIDE_COMMITTEE',
  'FORMALIZE_LOAN',
  'EXECUTE_DISBURSEMENT',
  'VIEW_REPORTS_AND_EXPORT',
  'VIEW_AUDIT_LOGS',
  'MANAGE_POLICIES_AND_RBAC',
  'VIEW_COLLECTIONS_PORTFOLIO',
  'LOG_COLLECTION_ACTIONS',
  'MANAGE_PROMISES',
  'REPORT_PAYMENTS',
  'VERIFY_AND_APPLY_PAYMENTS',
  'RECONCILE_BANK_TRANSACTIONS',
  'REVERSE_PAYMENTS',
  'ASSIGN_COLLECTIONS_PORTFOLIO',
  'MANAGE_COLLECTION_BOT',
  'RESOLVE_DISPUTES_AND_AGREEMENTS',
  'CLOSE_CANCEL_LOAN',
  'MANAGE_COLLECTION_POLICIES',
  'VIEW_ECF',
  'EMIT_ECF',
  'VOID_ECF',
  'MANAGE_ECF_SEQUENCES',
  'MANAGE_ECF_CERTIFICATES',
  'MANAGE_DGII_CONFIG',
  'VALIDATE_RECEIVED_ECF',
  'EXPORT_FISCAL_REPORTS',
  'VIEW_ALTERA',
  'SIMULATE_ALTERA',
  'PROPOSE_ALTERA_INTERVENTION',
  'APPROVE_ALTERA_INTERVENTION',
  'MANAGE_ALTERA_CONFIG',
  'VIEW_REGULA',
  'MANAGE_REGULA',
  'APPROVE_REGULA',
  'CONFIGURE_REGULA',
  'USE_REGULA_AI',
  'VIEW_IMPULSA',
  'MANAGE_IMPULSA',
  'ASSIGN_IMPULSA',
  'CONVERT_IMPULSA',
  'CONFIGURE_IMPULSA',
];

export const PERMISSION_LABELS: Record<CreditPermission, string> = {
  ORIGINATE_APPLICATION: 'Originar nuevas solicitudes de crédito',
  VIEW_INTERNAL_INBOX: 'Acceder a bandeja interna y alertas de crédito',
  RUN_SCORING_SIMULATION: 'Ejecutar simulaciones en Motor V2',
  VERIFY_DOCUMENTS: 'Validar u observar documentos del expediente',
  EDIT_VERIFIED_FINANCIALS: 'Depurar cifras financieras verificadas',
  VERIFY_EVALUATION_CHECKLIST: 'Confirmar identidad, ingresos, deudas y referencias',
  RECALCULATE_SCORING_V2: 'Recalcular Motor V2 con cifras depuradas',
  EDIT_EVALUATION_REPORT: 'Redactar informe técnico y recomendación analítica',
  RISK_SIGN_OFF: 'Emitir dictamen independiente de Oficial de Riesgo',
  SUBMIT_TO_COMMITTEE: 'Someter o escalar expediente al Comité de Crédito',
  RETURN_APPLICATION_FROM_EVALUATION: 'Devolver expediente por información u observaciones',
  VIEW_COMMITTEE_QUEUE: 'Consultar bandeja y resoluciones del Comité',
  DECIDE_COMMITTEE: 'Emitir resolución inmutable en Comité de Crédito',
  FORMALIZE_LOAN: 'Formalizar contratos, pagarés y habilitar desembolso',
  EXECUTE_DISBURSEMENT: 'Confirmar desembolso idempotente y crear préstamo',
  VIEW_REPORTS_AND_EXPORT: 'Consultar y exportar reportes PDF/CSV',
  VIEW_AUDIT_LOGS: 'Consultar bitácora inmutable de auditoría',
  MANAGE_POLICIES_AND_RBAC: 'Administrar políticas, facultades y roles RBAC',
  VIEW_COLLECTIONS_PORTFOLIO: 'Consultar cartera de cobranza y Ficha 360°',
  LOG_COLLECTION_ACTIONS: 'Registrar gestiones y tareas de seguimiento',
  MANAGE_PROMISES: 'Registrar promesas y propuestas de acuerdo de pago',
  REPORT_PAYMENTS: 'Reportar pagos/comprobantes pendientes de verificación',
  VERIFY_AND_APPLY_PAYMENTS: 'Verificar y aplicar pagos al saldo e intereses',
  RECONCILE_BANK_TRANSACTIONS: 'Cargar extractos y ejecutar conciliación bancaria',
  REVERSE_PAYMENTS: 'Autorizar y ejecutar reversos de pagos aplicados',
  ASSIGN_COLLECTIONS_PORTFOLIO: 'Asignar y reasignar cuentas entre gestores',
  MANAGE_COLLECTION_BOT: 'Configurar campañas y plantillas de AxyRecovery Bot',
  RESOLVE_DISPUTES_AND_AGREEMENTS: 'Aprobar reestructuraciones y resolver reclamaciones',
  CLOSE_CANCEL_LOAN: 'Cerrar y emitir certificado de cancelación de préstamo',
  MANAGE_COLLECTION_POLICIES: 'Configurar parámetros versionados de mora y cobranza',
  VIEW_ECF: 'Consultar módulo y comprobantes electrónicos DGII (e-CF)',
  EMIT_ECF: 'Emitir, firmar y enviar e-CF / Notas de Crédito y Débito',
  VOID_ECF: 'Anular comprobantes emitidos y secuencias e-NCF',
  MANAGE_ECF_SEQUENCES: 'Administrar rangos y secuencias autorizadas e-NCF',
  MANAGE_ECF_CERTIFICATES: 'Cargar y renovar certificados digitales (.p12/.pfx)',
  MANAGE_DGII_CONFIG: 'Configurar RNC, ambientes DGII y mapeo contable fiscal',
  VALIDATE_RECEIVED_ECF: 'Validar e-CF recibidos y emitir aprobaciones comerciales',
  EXPORT_FISCAL_REPORTS: 'Exportar reportes fiscales DGII (606 / 607 / libros)',
  VIEW_ALTERA: 'Consultar ALTERA (Gemelo Digital, ADN Financiero y Diagnósticos)',
  SIMULATE_ALTERA: 'Simular escenarios y Universos Alternativos en ALTERA',
  PROPOSE_ALTERA_INTERVENTION: 'Generar y someter propuestas de intervención ALTERA',
  APPROVE_ALTERA_INTERVENTION: 'Aprobar, rechazar o ejecutar recomendaciones ALTERA',
  MANAGE_ALTERA_CONFIG: 'Configurar parámetros, pesos y umbrales de ALTERA',
  VIEW_REGULA: 'Consultar AxyCore REGULA (Cumplimiento, Riesgos, PLAFTPADM y Auditoría)',
  MANAGE_REGULA: 'Crear y gestionar obligaciones, riesgos, controles, incidentes y planes en REGULA',
  APPROVE_REGULA: 'Aprobar aplicabilidad, debida diligencia, informes y cierres en REGULA',
  CONFIGURE_REGULA: 'Configurar matrices, roles, catálogos y parámetros de REGULA',
  USE_REGULA_AI: 'Utilizar capacidades de inteligencia regulatoria REGULA AI',
  VIEW_IMPULSA: 'Consultar Impulsa (Centro Comercial, Oportunidades y Reportes)',
  MANAGE_IMPULSA: 'Ejecutar detector y gestionar seguimientos comerciales en Impulsa',
  ASSIGN_IMPULSA: 'Asignar y reasignar oportunidades de Impulsa entre oficiales',
  CONVERT_IMPULSA: 'Convertir oportunidades de Impulsa en solicitudes formales de crédito',
  CONFIGURE_IMPULSA: 'Configurar parámetros, umbrales y automatización de Impulsa',
};

const ROLE_ALLOWED_PERMISSIONS: Record<UserRole, CreditPermission[]> = {
  ADMIN: ALL_CREDIT_PERMISSIONS,
  BUSINESS_OFFICER: [
    'ORIGINATE_APPLICATION',
    'VIEW_INTERNAL_INBOX',
    'RUN_SCORING_SIMULATION',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'VIEW_IMPULSA',
    'MANAGE_IMPULSA',
    'CONVERT_IMPULSA',
  ],
  CREDIT_ANALYST: [
    'VIEW_INTERNAL_INBOX',
    'RUN_SCORING_SIMULATION',
    'VERIFY_DOCUMENTS',
    'EDIT_VERIFIED_FINANCIALS',
    'VERIFY_EVALUATION_CHECKLIST',
    'RECALCULATE_SCORING_V2',
    'EDIT_EVALUATION_REPORT',
    'SUBMIT_TO_COMMITTEE',
    'RETURN_APPLICATION_FROM_EVALUATION',
    'VIEW_COMMITTEE_QUEUE',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'VIEW_IMPULSA',
  ],
  RISK_OFFICER: [
    'VIEW_INTERNAL_INBOX',
    'RUN_SCORING_SIMULATION',
    'VERIFY_DOCUMENTS',
    'RECALCULATE_SCORING_V2',
    'RISK_SIGN_OFF',
    'SUBMIT_TO_COMMITTEE',
    'RETURN_APPLICATION_FROM_EVALUATION',
    'VIEW_COMMITTEE_QUEUE',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'RESOLVE_DISPUTES_AND_AGREEMENTS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'APPROVE_ALTERA_INTERVENTION',
    'MANAGE_ALTERA_CONFIG',
    'VIEW_REGULA',
    'MANAGE_REGULA',
    'APPROVE_REGULA',
    'CONFIGURE_REGULA',
    'USE_REGULA_AI',
    'VIEW_IMPULSA',
  ],
  COMMITTEE_MEMBER: [
    'VIEW_INTERNAL_INBOX',
    'RUN_SCORING_SIMULATION',
    'VIEW_COMMITTEE_QUEUE',
    'DECIDE_COMMITTEE',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'APPROVE_ALTERA_INTERVENTION',
    'VIEW_REGULA',
    'APPROVE_REGULA',
    'USE_REGULA_AI',
    'VIEW_IMPULSA',
  ],
  FORMALIZATION: [
    'VIEW_INTERNAL_INBOX',
    'VERIFY_DOCUMENTS',
    'FORMALIZE_LOAN',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_ALTERA',
  ],
  OPERATIONS: [
    'VIEW_INTERNAL_INBOX',
    'EXECUTE_DISBURSEMENT',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'REPORT_PAYMENTS',
    'CLOSE_CANCEL_LOAN',
    'VIEW_ECF',
    'EMIT_ECF',
    'VALIDATE_RECEIVED_ECF',
    'EXPORT_FISCAL_REPORTS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
  ],
  FINANCE: [
    'VIEW_INTERNAL_INBOX',
    'EXECUTE_DISBURSEMENT',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'REPORT_PAYMENTS',
    'VERIFY_AND_APPLY_PAYMENTS',
    'RECONCILE_BANK_TRANSACTIONS',
    'REVERSE_PAYMENTS',
    'RESOLVE_DISPUTES_AND_AGREEMENTS',
    'CLOSE_CANCEL_LOAN',
    'VIEW_ECF',
    'EMIT_ECF',
    'VOID_ECF',
    'MANAGE_ECF_SEQUENCES',
    'MANAGE_ECF_CERTIFICATES',
    'MANAGE_DGII_CONFIG',
    'VALIDATE_RECEIVED_ECF',
    'EXPORT_FISCAL_REPORTS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'VIEW_IMPULSA',
  ],
  AUDITOR: [
    'VIEW_INTERNAL_INBOX',
    'VIEW_COMMITTEE_QUEUE',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'VIEW_ECF',
    'EXPORT_FISCAL_REPORTS',
    'VIEW_ALTERA',
    'VIEW_REGULA',
    'MANAGE_REGULA',
    'APPROVE_REGULA',
    'USE_REGULA_AI',
    'VIEW_IMPULSA',
  ],
  COLLECTION_AGENT: [
    'VIEW_COLLECTIONS_PORTFOLIO',
    'LOG_COLLECTION_ACTIONS',
    'MANAGE_PROMISES',
    'REPORT_PAYMENTS',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
  ],
  SUPERVISOR: [
    'VIEW_COLLECTIONS_PORTFOLIO',
    'LOG_COLLECTION_ACTIONS',
    'MANAGE_PROMISES',
    'ASSIGN_COLLECTIONS_PORTFOLIO',
    'RESOLVE_DISPUTES_AND_AGREEMENTS',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'VIEW_IMPULSA',
    'MANAGE_IMPULSA',
    'ASSIGN_IMPULSA',
    'CONVERT_IMPULSA',
  ],
  COLLECTION_COORDINATOR: [
    'VIEW_COLLECTIONS_PORTFOLIO',
    'LOG_COLLECTION_ACTIONS',
    'MANAGE_PROMISES',
    'ASSIGN_COLLECTIONS_PORTFOLIO',
    'MANAGE_COLLECTION_BOT',
    'RESOLVE_DISPUTES_AND_AGREEMENTS',
    'MANAGE_COLLECTION_POLICIES',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'APPROVE_ALTERA_INTERVENTION',
    'MANAGE_ALTERA_CONFIG',
    'VIEW_IMPULSA',
    'MANAGE_IMPULSA',
    'ASSIGN_IMPULSA',
    'CONVERT_IMPULSA',
    'CONFIGURE_IMPULSA',
  ],
  CASHIER: [
    'VIEW_COLLECTIONS_PORTFOLIO',
    'REPORT_PAYMENTS',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_ALTERA',
  ],
  MANAGEMENT: [
    'VIEW_INTERNAL_INBOX',
    'VIEW_COLLECTIONS_PORTFOLIO',
    'VIEW_REPORTS_AND_EXPORT',
    'VIEW_AUDIT_LOGS',
    'RESOLVE_DISPUTES_AND_AGREEMENTS',
    'VIEW_ECF',
    'EXPORT_FISCAL_REPORTS',
    'VIEW_ALTERA',
    'SIMULATE_ALTERA',
    'PROPOSE_ALTERA_INTERVENTION',
    'APPROVE_ALTERA_INTERVENTION',
    'VIEW_REGULA',
    'APPROVE_REGULA',
    'USE_REGULA_AI',
    'VIEW_IMPULSA',
    'MANAGE_IMPULSA',
    'ASSIGN_IMPULSA',
    'CONVERT_IMPULSA',
    'CONFIGURE_IMPULSA',
  ],
  EXTERNAL_CLIENT: ['ORIGINATE_APPLICATION'],
};

function buildPermissionMap(role: UserRole): Record<CreditPermission, boolean> {
  const allowed = new Set(ROLE_ALLOWED_PERMISSIONS[role] ?? []);
  return ALL_CREDIT_PERMISSIONS.reduce((acc, perm) => {
    acc[perm] = allowed.has(perm);
    return acc;
  }, {} as Record<CreditPermission, boolean>);
}

export const ROLE_PERMISSION_MATRIX: Record<UserRole, Record<CreditPermission, boolean>> = {
  ADMIN: buildPermissionMap('ADMIN'),
  BUSINESS_OFFICER: buildPermissionMap('BUSINESS_OFFICER'),
  CREDIT_ANALYST: buildPermissionMap('CREDIT_ANALYST'),
  RISK_OFFICER: buildPermissionMap('RISK_OFFICER'),
  COMMITTEE_MEMBER: buildPermissionMap('COMMITTEE_MEMBER'),
  FORMALIZATION: buildPermissionMap('FORMALIZATION'),
  OPERATIONS: buildPermissionMap('OPERATIONS'),
  FINANCE: buildPermissionMap('FINANCE'),
  AUDITOR: buildPermissionMap('AUDITOR'),
  COLLECTION_AGENT: buildPermissionMap('COLLECTION_AGENT'),
  SUPERVISOR: buildPermissionMap('SUPERVISOR'),
  COLLECTION_COORDINATOR: buildPermissionMap('COLLECTION_COORDINATOR'),
  CASHIER: buildPermissionMap('CASHIER'),
  MANAGEMENT: buildPermissionMap('MANAGEMENT'),
  EXTERNAL_CLIENT: buildPermissionMap('EXTERNAL_CLIENT'),
};

export const ALL_COBRANZA_SECTIONS: NavSectionId[] = [
  'cobranza_dashboard',
  'cobranza_portfolio',
  'cobranza_daily',
  'cobranza_urgent',
  'cobranza_legal',
  'cobranza_discounts',
  'cobranza_discounts_mora',
  'cobranza_discounts_payoff',
  'cobranza_my_actions',
  'cobranza_actions',
  'cobranza_agreements_today',
  'cobranza_agreements_broken',
  'cobranza_promises',
  'cobranza_agenda',
  'cobranza_payments',
  'cobranza_reconciliation',
  'cobranza_unidentified',
  'cobranza_contact_center',
  'cobranza_bot',
  'cobranza_sentinel',
  'cobranza_assignment',
  'cobranza_reports',
  'cobranza_params',
  'cobranza_audit',
];

const SHARED_STAFF_HOME_SECTIONS: NavSectionId[] = [
  'dashboard',
  'system_guide',
  'director',
  'bela',
  'intelligence_dashboard',
  'intelligence_altera',
  'regula',
  'intelligence_impulsa',
  'system_sitemap',
];

const POLICY_ADMIN_SUBSECTIONS: NavSectionId[] = [
  'policies',
  'admin_risk_bands',
  'admin_product_limits',
  'admin_approval_matrix',
  'admin_workflow',
];

export const ALL_ACCOUNTING_SUBSECTIONS: NavSectionId[] = [
  'accounting',
  'accounting_chart_of_accounts',
  'accounting_journal_entries',
  'accounting_daily_book',
  'accounting_general_ledger',
  'accounting_receivables',
  'accounting_payables',
  'accounting_taxes',
  'accounting_payment_validation',
  'accounting_statements',
];

export const ALL_ECF_SECTIONS: NavSectionId[] = [
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

export const SECTION_ACCESS_BY_ROLE: Record<UserRole, NavSectionId[]> = {
  ADMIN: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'new_application',
    'loan_calculator',
    'applications',
    'decision_engine',
    'evaluation',
    'committee',
    'formalization',
    'disbursements',
    'loans',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'reports',
    ...POLICY_ADMIN_SUBSECTIONS,
    'audit',
    'admin_users',
    'admin_roles',
    'admin_settings',
    ...ALL_ACCOUNTING_SUBSECTIONS,
    ...ALL_ECF_SECTIONS,
    'register_payment',
    'register_expense',
    'register_investor',
    'cobranza_anticipate',
    ...ALL_COBRANZA_SECTIONS,
  ],
  BUSINESS_OFFICER: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'new_application',
    'loan_calculator',
    'applications',
    'decision_engine',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'loans',
    'reports',
    'cobranza_dashboard',
    'cobranza_portfolio',
  ],
  CREDIT_ANALYST: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'decision_engine',
    'evaluation',
    'committee',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'loans',
    'reports',
    ...POLICY_ADMIN_SUBSECTIONS,
    'cobranza_dashboard',
    'cobranza_portfolio',
  ],
  RISK_OFFICER: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'decision_engine',
    'evaluation',
    'committee',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'loans',
    'reports',
    ...POLICY_ADMIN_SUBSECTIONS,
    'audit',
    'cobranza_dashboard',
    'cobranza_anticipate',
    'cobranza_portfolio',
    'cobranza_promises',
    'cobranza_sentinel',
    'cobranza_reports',
    'cobranza_audit',
  ],
  COMMITTEE_MEMBER: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'decision_engine',
    'evaluation',
    'committee',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'loans',
    'reports',
    ...POLICY_ADMIN_SUBSECTIONS,
    'cobranza_dashboard',
    'cobranza_portfolio',
    'cobranza_reports',
  ],
  FORMALIZATION: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'formalization',
    'loans',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'reports',
  ],
  OPERATIONS: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'disbursements',
    'loans',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'documents',
    'reports',
    ...ALL_ACCOUNTING_SUBSECTIONS,
    'ecf_dashboard',
    'ecf_emit',
    'ecf_issued',
    'ecf_received',
    'ecf_credit_notes',
    'ecf_debit_notes',
    'ecf_dgii_status',
    'ecf_customers',
    'ecf_products',
    'ecf_reports',
    'ecf_audit',
    'register_payment',
    'register_expense',
    'register_investor',
    'cobranza_dashboard',
    'cobranza_portfolio',
    'cobranza_discounts',
    'cobranza_discounts_mora',
    'cobranza_discounts_payoff',
    'cobranza_payments',
    'cobranza_reports',
    'cobranza_audit',
  ],
  FINANCE: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'disbursements',
    'loans',
    'customers',
    'customers_active',
    'customers_inactive',
    'customers_update',
    'reports',
    'audit',
    ...ALL_ACCOUNTING_SUBSECTIONS,
    ...ALL_ECF_SECTIONS,
    'register_payment',
    'register_expense',
    'register_investor',
    'cobranza_dashboard',
    'cobranza_anticipate',
    'cobranza_portfolio',
    'cobranza_discounts',
    'cobranza_discounts_mora',
    'cobranza_discounts_payoff',
    'cobranza_promises',
    'cobranza_payments',
    'cobranza_reconciliation',
    'cobranza_unidentified',
    'cobranza_sentinel',
    'cobranza_reports',
    'cobranza_audit',
  ],
  AUDITOR: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'applications',
    'decision_engine',
    'evaluation',
    'committee',
    'formalization',
    'disbursements',
    'loans',
    'customers',
    'customers_active',
    'customers_inactive',
    'documents',
    'reports',
    ...POLICY_ADMIN_SUBSECTIONS,
    'admin_roles',
    'audit',
    ...ALL_ACCOUNTING_SUBSECTIONS,
    ...ALL_ECF_SECTIONS,
    'register_payment',
    'register_expense',
    'register_investor',
    ...ALL_COBRANZA_SECTIONS,
  ],
  COLLECTION_AGENT: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'loan_calculator',
    'register_payment',
    'cobranza_dashboard',
    'cobranza_portfolio',
    'cobranza_daily',
    'cobranza_urgent',
    'cobranza_legal',
    'cobranza_my_actions',
    'cobranza_actions',
    'cobranza_agreements_today',
    'cobranza_agreements_broken',
    'cobranza_promises',
    'cobranza_agenda',
    'cobranza_payments',
    'cobranza_reports',
  ],
  SUPERVISOR: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'loan_calculator',
    'cobranza_dashboard',
    'cobranza_anticipate',
    'cobranza_portfolio',
    'cobranza_daily',
    'cobranza_urgent',
    'cobranza_legal',
    'cobranza_discounts',
    'cobranza_discounts_mora',
    'cobranza_discounts_payoff',
    'cobranza_my_actions',
    'cobranza_actions',
    'cobranza_agreements_today',
    'cobranza_agreements_broken',
    'cobranza_promises',
    'cobranza_agenda',
    'cobranza_contact_center',
    'cobranza_sentinel',
    'cobranza_assignment',
    'cobranza_reports',
    'cobranza_audit',
  ],
  COLLECTION_COORDINATOR: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'loan_calculator',
    'register_payment',
    'cobranza_dashboard',
    'cobranza_anticipate',
    'cobranza_portfolio',
    'cobranza_daily',
    'cobranza_urgent',
    'cobranza_legal',
    'cobranza_discounts',
    'cobranza_discounts_mora',
    'cobranza_discounts_payoff',
    'cobranza_my_actions',
    'cobranza_actions',
    'cobranza_agreements_today',
    'cobranza_agreements_broken',
    'cobranza_promises',
    'cobranza_agenda',
    'cobranza_payments',
    'cobranza_reconciliation',
    'cobranza_unidentified',
    'cobranza_contact_center',
    'cobranza_bot',
    'cobranza_sentinel',
    'cobranza_assignment',
    'cobranza_reports',
    'cobranza_params',
    'cobranza_audit',
  ],
  CASHIER: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'loan_calculator',
    'register_payment',
    'cobranza_portfolio',
    'cobranza_daily',
    'cobranza_payments',
    'cobranza_reports',
  ],
  MANAGEMENT: [
    ...SHARED_STAFF_HOME_SECTIONS,
    'credit_dashboard',
    'loan_calculator',
    'loans',
    'reports',
    'audit',
    ...ALL_ACCOUNTING_SUBSECTIONS,
    'ecf_dashboard',
    'ecf_issued',
    'ecf_received',
    'ecf_credit_notes',
    'ecf_debit_notes',
    'ecf_dgii_status',
    'ecf_reports',
    'ecf_audit',
    'register_payment',
    'register_expense',
    'register_investor',
    'cobranza_dashboard',
    'cobranza_anticipate',
    'cobranza_portfolio',
    'cobranza_discounts',
    'cobranza_discounts_mora',
    'cobranza_discounts_payoff',
    'cobranza_contact_center',
    'cobranza_sentinel',
    'cobranza_reports',
    'cobranza_audit',
  ],
  EXTERNAL_CLIENT: ['new_application', 'applications', 'loans'],
};

export function hasRolePermission(role: UserRole | null | undefined, permission: CreditPermission): boolean {
  if (!role) return false;
  return Boolean(ROLE_PERMISSION_MATRIX[role]?.[permission]);
}

export function canRoleAccessSection(role: UserRole | null | undefined, section: NavSectionId): boolean {
  if (!role) return false;
  return SECTION_ACCESS_BY_ROLE[role]?.includes(section) ?? false;
}

export interface CreditWorkflowAccessReport {
  canEditVerifiedFinancials: PermissionCheckResult;
  canVerifyDocuments: PermissionCheckResult;
  canRecalculateScoring: PermissionCheckResult;
  canSubmitToCommittee: PermissionCheckResult;
  canReturnFromEvaluation: PermissionCheckResult;
  canIssueRiskOpinion: PermissionCheckResult;
  canDecideCommittee: PermissionCheckResult;
  canFormalize: PermissionCheckResult;
  canDisburse: PermissionCheckResult;
}

export function getCreditWorkflowAccess(params: {
  userProfile: UserProfile | null;
  application: ApplicationRecord;
  evaluation?: CreditEvaluationRecord | null;
  policy: CreditPolicyRecord;
  proposedAmount?: number;
}): CreditWorkflowAccessReport {
  const { userProfile, application, evaluation, policy, proposedAmount } = params;

  if (!userProfile) {
    const unauth: PermissionCheckResult = { allowed: false, reason: 'Sesión no autenticada.' };
    return {
      canEditVerifiedFinancials: unauth,
      canVerifyDocuments: unauth,
      canRecalculateScoring: unauth,
      canSubmitToCommittee: unauth,
      canReturnFromEvaluation: unauth,
      canIssueRiskOpinion: unauth,
      canDecideCommittee: unauth,
      canFormalize: unauth,
      canDisburse: unauth,
    };
  }

  if (userProfile.status !== 'ACTIVE') {
    const inactive: PermissionCheckResult = { allowed: false, reason: 'El usuario se encuentra INACTIVO.' };
    return {
      canEditVerifiedFinancials: inactive,
      canVerifyDocuments: inactive,
      canRecalculateScoring: inactive,
      canSubmitToCommittee: inactive,
      canReturnFromEvaluation: inactive,
      canIssueRiskOpinion: inactive,
      canDecideCommittee: inactive,
      canFormalize: inactive,
      canDisburse: inactive,
    };
  }

  const role = userProfile.role;
  const inEvalStage = ['RECIBIDA', 'EN_EVALUACION', 'DEVUELTA'].includes(application.status);
  const roleLabel = ROLE_LABELS[role];

  const canEditVerifiedFinancials: PermissionCheckResult = !hasRolePermission(role, 'EDIT_VERIFIED_FINANCIALS')
    ? {
        allowed: false,
        reason: `El rol ${roleLabel} no tiene permiso para depurar cifras ni editar el informe analítico.`,
      }
    : !inEvalStage
    ? {
        allowed: false,
        reason: `La depuración analítica solo está habilitada en Recibida, En Evaluación o Devuelta (actual: ${application.status}).`,
      }
    : { allowed: true };

  const canVerifyDocuments: PermissionCheckResult = hasRolePermission(role, 'VERIFY_DOCUMENTS')
    ? { allowed: true }
    : {
        allowed: false,
        reason: `El rol ${roleLabel} no tiene permiso para validar o marcar documentos.`,
      };

  const canRecalculateScoring: PermissionCheckResult = !hasRolePermission(role, 'RECALCULATE_SCORING_V2')
    ? {
        allowed: false,
        reason: `El rol ${roleLabel} no puede ejecutar recálculos de evaluación en Motor V2.`,
      }
    : !inEvalStage
    ? {
        allowed: false,
        reason: `No se permiten recálculos de evaluación en estado ${application.status}.`,
      }
    : { allowed: true };

  const canSubmitToCommittee: PermissionCheckResult = !hasRolePermission(role, 'SUBMIT_TO_COMMITTEE')
    ? {
        allowed: false,
        reason: `El rol ${roleLabel} no puede someter expedientes al Comité de Crédito.`,
      }
    : !inEvalStage
    ? {
        allowed: false,
        reason: `Solo expedientes en Recibida, En Evaluación o Devuelta pueden someterse a Comité.`,
      }
    : { allowed: true };

  const canReturnFromEvaluation: PermissionCheckResult = !hasRolePermission(
    role,
    'RETURN_APPLICATION_FROM_EVALUATION'
  )
    ? {
        allowed: false,
        reason: `El rol ${roleLabel} no tiene permiso para devolver expedientes en evaluación.`,
      }
    : !inEvalStage
    ? {
        allowed: false,
        reason: `El expediente ya salió de la etapa de evaluación (${application.status}).`,
      }
    : { allowed: true };

  const canIssueRiskOpinion: PermissionCheckResult = !hasRolePermission(role, 'RISK_SIGN_OFF')
    ? {
        allowed: false,
        reason: `Solo el Oficial de Riesgo o Administrador puede emitir el dictamen independiente de riesgo.`,
      }
    : !inEvalStage
    ? {
        allowed: false,
        reason: `El dictamen de riesgo solo se registra mientras el expediente está en evaluación (${application.status}).`,
      }
    : { allowed: true };

  const canDecideCommittee = canUserApproveCommittee({
    userId: userProfile.uid,
    userRole: role,
    application,
    evaluation,
    proposedAmount: proposedAmount ?? application.recommendedAmount ?? application.requestedAmount,
    policy,
  });

  const canFormalize: PermissionCheckResult = !hasRolePermission(role, 'FORMALIZE_LOAN')
    ? {
        allowed: false,
        reason: `Solo el rol Formalización o Administrador puede formalizar contratos y pagarés.`,
      }
    : !['APROBADA', 'APROBADA_CONDICIONADA'].includes(application.status)
    ? {
        allowed: false,
        reason: `El expediente requiere aprobación del Comité para formalizarse (actual: ${application.status}).`,
      }
    : { allowed: true };

  const canDisburse: PermissionCheckResult = !hasRolePermission(role, 'EXECUTE_DISBURSEMENT')
    ? {
        allowed: false,
        reason: `Solo Operaciones, Finanzas o Administrador pueden ejecutar desembolsos.`,
      }
    : application.status !== 'FORMALIZADA'
    ? {
        allowed: false,
        reason: `El expediente debe estar en estado FORMALIZADA (actual: ${application.status}).`,
      }
    : { allowed: true };

  return {
    canEditVerifiedFinancials,
    canVerifyDocuments,
    canRecalculateScoring,
    canSubmitToCommittee,
    canReturnFromEvaluation,
    canIssueRiskOpinion,
    canDecideCommittee,
    canFormalize,
    canDisburse,
  };
}
