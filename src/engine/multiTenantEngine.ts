import type {
  AxyCoreModuleCategory,
  AxyCoreModuleCode,
  CommercialPlanCode,
  CommercialPlanDefinition,
  CurrencyCode,
  GranularActionPermission,
  LicenseStatus,
  ModuleCatalogItem,
  NavSectionId,
  OrganizationMembershipRecord,
  OrganizationRecord,
  TenantLicenseRecord,
  TenantStatus,
  TenantSubscriptionRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';
import { sanitizeIdSegment } from '../utils/formatters';
import {
  PLATFORM_OWNER_EMAIL,
  SU_GLORIA_ORG_ID,
  SU_GLORIA_TENANT_ID,
  isSuperAdminUser,
} from '../services/tenantService';

export {
  PLATFORM_OWNER_EMAIL,
  SU_GLORIA_ORG_ID,
  SU_GLORIA_TENANT_ID,
  isSuperAdminUser,
};

export const MODULE_CATEGORY_LABELS: Record<AxyCoreModuleCategory, string> = {
  FINANCIEROS: 'Módulos Financieros',
  EMPRESARIALES: 'Módulos Empresariales',
  INTELIGENCIA_AUTOMATIZACION: 'Inteligencia y Automatización',
};

export const AXYCORE_MODULE_CATALOG: ModuleCatalogItem[] = [
  // ==========================================
  // 1. MÓDULOS FINANCIEROS (13)
  // ==========================================
  {
    code: 'clientes',
    name: 'Clientes',
    description: 'Expediente maestro de personas físicas y jurídicas (Cédula, Pasaporte, RNC) con prevención de duplicados por organización.',
    category: 'FINANCIEROS',
    iconKey: 'Users',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Núcleo base de organización activo',
    dependencies: [],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 45,
    mappedSections: ['customers', 'customers_active', 'customers_inactive', 'customers_update'],
    mappedApiRoutes: ['/api/biometrics/verify-identity'],
  },
  {
    code: 'prestamos',
    name: 'Préstamos',
    description: 'Originación omnicanal, bandeja de solicitudes recibidas, cartera activa de préstamos y tablas de amortización.',
    category: 'FINANCIEROS',
    iconKey: 'Landmark',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere módulo de Clientes habilitado',
    dependencies: ['clientes'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 95,
    mappedSections: ['loans', 'applications', 'new_application', 'loan_calculator', 'credit_dashboard'],
    mappedApiRoutes: ['/api/amortization/simulate'],
  },
  {
    code: 'motor_decisiones',
    name: 'Motor de Decisiones',
    description: 'Motor determinístico V2 de 22 indicadores ponderados (0–100 pts), cálculo de DTI, flujo disponible y bandas de precio.',
    category: 'FINANCIEROS',
    iconKey: 'Cpu',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.2.0',
    requirements: 'Requiere Clientes y Préstamos',
    dependencies: ['clientes', 'prestamos'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 85,
    mappedSections: ['decision_engine', 'intelligence_dashboard'],
    mappedApiRoutes: ['/api/engine/score'],
  },
  {
    code: 'evaluacion_crediticia',
    name: 'Evaluación Crediticia',
    description: 'Mesa analítica de depuración financiera verificada, checklist de referencias, dictamen de Oficial de Riesgo y recálculo V2.',
    category: 'FINANCIEROS',
    iconKey: 'CheckSquare',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.3.0',
    requirements: 'Requiere Préstamos y Motor de Decisiones',
    dependencies: ['clientes', 'prestamos', 'motor_decisiones'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 65,
    mappedSections: ['evaluation'],
    mappedApiRoutes: ['/api/documents/verify-ocr'],
  },
  {
    code: 'comite_credito',
    name: 'Comité de Crédito',
    description: 'Gobierno colegiado e individual con segregación de funciones, facultades por monto/banda y resoluciones inmutables.',
    category: 'FINANCIEROS',
    iconKey: 'Gavel',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.3.0',
    requirements: 'Requiere Evaluación Crediticia',
    dependencies: ['clientes', 'prestamos', 'evaluacion_crediticia'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 60,
    mappedSections: ['committee'],
    mappedApiRoutes: ['/api/workflow/check-committee-authority'],
  },
  {
    code: 'formalizacion',
    name: 'Formalización',
    description: 'Generación y control de contratos, pagarés notariales, garantías y validación legal pre-desembolso.',
    category: 'FINANCIEROS',
    iconKey: 'FileSignature',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.1.0',
    requirements: 'Requiere Préstamos y Comité de Crédito',
    dependencies: ['clientes', 'prestamos', 'comite_credito'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 50,
    mappedSections: ['formalization'],
    mappedApiRoutes: [],
  },
  {
    code: 'desembolsos',
    name: 'Desembolsos',
    description: 'Ejecución idempotente de desembolsos, creación del préstamo activo y generación de cuotas contractuales.',
    category: 'FINANCIEROS',
    iconKey: 'Send',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.2.0',
    requirements: 'Requiere Formalización',
    dependencies: ['clientes', 'prestamos', 'formalizacion'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 55,
    mappedSections: ['disbursements'],
    mappedApiRoutes: ['/api/workflow/check-disbursement'],
  },
  {
    code: 'cobranza',
    name: 'Cobranza',
    description: 'Gestión integral de cartera, DPD, buckets PAR 1/7/30/60/90, colas del día, urgentes, gestiones, promesas y acuerdos.',
    category: 'FINANCIEROS',
    iconKey: 'Wallet',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.5.0',
    requirements: 'Requiere Clientes y Préstamos',
    dependencies: ['clientes', 'prestamos'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 110,
    mappedSections: [
      'cobranza_portfolio',
      'cobranza_dashboard',
      'cobranza_daily',
      'cobranza_urgent',
      'cobranza_legal',
      'cobranza_discounts',
      'cobranza_discounts_mora',
      'cobranza_discounts_payoff',
      'cobranza_actions',
      'cobranza_agreements_today',
      'cobranza_agreements_broken',
      'cobranza_my_actions',
      'cobranza_promises',
      'cobranza_agenda',
      'cobranza_assignment',
      'cobranza_params',
      'cobranza_audit',
      'cobranza_reports',
    ],
    mappedApiRoutes: ['/api/collections/cutoff'],
  },
  {
    code: 'pagos',
    name: 'Pagos',
    description: 'Registro, verificación y aplicación contable de pagos con prelación configurable (Mora › Interés › Capital) y reversos auditados.',
    category: 'FINANCIEROS',
    iconKey: 'CreditCard',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere Préstamos y Cobranza',
    dependencies: ['clientes', 'prestamos', 'cobranza'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 75,
    mappedSections: ['cobranza_payments', 'register_payment'],
    mappedApiRoutes: ['/api/collections/apply-payment'],
  },
  {
    code: 'conciliacion_bancaria',
    name: 'Conciliación Bancaria',
    description: 'Cruce determinístico de extractos bancarios contra pagos reportados y bandeja de pagos por identificar.',
    category: 'FINANCIEROS',
    iconKey: 'GitCompare',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.1.0',
    requirements: 'Requiere módulo de Pagos',
    dependencies: ['clientes', 'prestamos', 'cobranza', 'pagos'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 65,
    mappedSections: ['cobranza_reconciliation', 'cobranza_unidentified'],
    mappedApiRoutes: [],
  },
  {
    code: 'finanzas',
    name: 'Finanzas',
    description: 'Control de tesorería, políticas financieras, flujos de caja, contabilidad, gastos, inversionistas y auditoría.',
    category: 'FINANCIEROS',
    iconKey: 'Landmark',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere Préstamos',
    dependencies: ['clientes', 'prestamos'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 70,
    mappedSections: [
      'policies',
      'admin_risk_bands',
      'admin_product_limits',
      'admin_approval_matrix',
      'admin_workflow',
      'audit',
      'admin_users',
      'admin_roles',
      'admin_settings',
      'accounting',
      'accounting_payment_validation',
      'accounting_statements',
      'register_expense',
      'register_investor',
    ],
    mappedApiRoutes: [],
  },
  {
    code: 'contabilidad',
    name: 'Contabilidad',
    description: 'Plan de cuentas, asientos contables de partida doble, libros diario y mayor, CxC, CxP, impuestos, validación de pagos y estados financieros.',
    category: 'FINANCIEROS',
    iconKey: 'BookOpen',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.5.0',
    requirements: 'Requiere Finanzas y Pagos',
    dependencies: ['finanzas', 'pagos'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 90,
    mappedSections: [
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
    ],
    mappedApiRoutes: [],
  },
  {
    code: 'facturacion_electronica',
    name: 'Facturación Electrónica DGII (e-CF)',
    description: 'Emisión, firma XMLDSig, validación XSD, secuencias e-NCF, certificados digitales, envío DGII y puente contable conforme a la Ley 32-23.',
    category: 'FINANCIEROS',
    iconKey: 'Receipt',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '1.0.0',
    requirements: 'Requiere Finanzas y Contabilidad',
    dependencies: ['clientes', 'finanzas', 'contabilidad'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 80,
    mappedSections: [
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
    ],
    mappedApiRoutes: [
      '/api/dgii/certificates/upload',
      '/api/dgii/xml/sign',
      '/api/dgii/ecf/submit',
      '/api/dgii/ecf/status',
    ],
  },

  // ==========================================
  // 2. MÓDULOS EMPRESARIALES (11)
  // ==========================================
  {
    code: 'crm',
    name: 'CRM',
    description: 'Gestión de prospectos comerciales, embudo de conversión y seguimiento de oportunidades.',
    category: 'EMPRESARIALES',
    iconKey: 'Users',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.7.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 60,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'ventas',
    name: 'Ventas',
    description: 'Cotizaciones, pedidos comerciales y comisiones de fuerza de ventas.',
    category: 'EMPRESARIALES',
    iconKey: 'ShoppingBag',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.6.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 65,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'inventario',
    name: 'Inventario',
    description: 'Control de almacenes, lotes, activos adjudicados y garantías físicas.',
    category: 'EMPRESARIALES',
    iconKey: 'Package',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.5.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 55,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'compras',
    name: 'Compras',
    description: 'Órdenes de compra, requisiciones internas y recepción de bienes/servicios.',
    category: 'EMPRESARIALES',
    iconKey: 'ShoppingCart',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.5.0',
    requirements: 'Requiere Proveedores',
    dependencies: ['proveedores'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 45,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'proveedores',
    name: 'Proveedores',
    description: 'Registro de suplidores, cuentas por pagar y retenciones fiscales.',
    category: 'EMPRESARIALES',
    iconKey: 'Truck',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.5.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 40,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'facturacion',
    name: 'Facturación',
    description: 'Facturación comercial de servicios, notas de crédito y estados de cuenta.',
    category: 'EMPRESARIALES',
    iconKey: 'FileText',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.6.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 50,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'recursos_humanos',
    name: 'Recursos Humanos',
    description: 'Expedientes de colaboradores, nómina TSS y evaluación de desempeño.',
    category: 'EMPRESARIALES',
    iconKey: 'UserCheck',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.5.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 60,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'gestion_documental',
    name: 'Gestión Documental',
    description: 'Bóveda digital de expedientes, OCR con visión artificial, biometría facial y control de acceso auditado.',
    category: 'EMPRESARIALES',
    iconKey: 'FolderOpen',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.3.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 55,
    mappedSections: ['documents'],
    mappedApiRoutes: ['/api/documents/verify-ocr', '/api/biometrics/verify-identity'],
  },
  {
    code: 'proyectos',
    name: 'Proyectos',
    description: 'Seguimiento de hitos, presupuestos y entregables corporativos.',
    category: 'EMPRESARIALES',
    iconKey: 'Briefcase',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.4.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 45,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'servicios',
    name: 'Servicios',
    description: 'Catálogo de servicios empresariales, SLA y mesa de ayuda.',
    category: 'EMPRESARIALES',
    iconKey: 'Wrench',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'EN_DESARROLLO',
    version: '0.4.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 45,
    mappedSections: [],
    mappedApiRoutes: [],
  },
  {
    code: 'contact_center',
    name: 'Contact Center',
    description: 'Productividad de gestores, tasa de contactabilidad, efectividad de promesas y metas operativas.',
    category: 'EMPRESARIALES',
    iconKey: 'Headphones',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.1.0',
    requirements: 'Requiere Cobranza',
    dependencies: ['clientes', 'prestamos', 'cobranza'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 70,
    mappedSections: ['cobranza_contact_center'],
    mappedApiRoutes: [],
  },

  // ==========================================
  // 3. INTELIGENCIA Y AUTOMATIZACIÓN (10)
  // ==========================================
  {
    code: 'axycore_director',
    name: 'AxyCore Director',
    description: 'Analista ejecutivo de inteligencia artificial con lectura transversal de cartera, colocación y riesgo por organización.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'BrainCircuit',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere Inteligencia Artificial activa',
    dependencies: ['inteligencia_artificial'],
    licenseType: 'ENTERPRISE',
    monthlyPriceUsd: 120,
    mappedSections: ['director'],
    mappedApiRoutes: ['/api/ai/director'],
  },
  {
    code: 'bela',
    name: 'Bela',
    description: 'Asistente virtual financiera contextualizada en tiempo real dentro del espacio de trabajo de la empresa activa.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'MessageSquare',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere Inteligencia Artificial activa',
    dependencies: ['inteligencia_artificial'],
    licenseType: 'ENTERPRISE',
    monthlyPriceUsd: 95,
    mappedSections: ['bela'],
    mappedApiRoutes: ['/api/ai/bela'],
  },
  {
    code: 'axyrecovery_bot',
    name: 'AxyRecovery Bot',
    description: 'Orquestador omnicanal de recordatorios preventivos, avisos de vencimiento y seguimiento de promesas.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Bot',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.2.0',
    requirements: 'Requiere Cobranza',
    dependencies: ['clientes', 'prestamos', 'cobranza'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 85,
    mappedSections: ['cobranza_bot'],
    mappedApiRoutes: [],
  },
  {
    code: 'centinela',
    name: 'Centinela',
    description: 'Motor de detección temprana de anomalías operativas, promesas rotas reiteradas y riesgos de fraude.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Radar',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.3.0',
    requirements: 'Requiere Cobranza',
    dependencies: ['clientes', 'prestamos', 'cobranza'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 90,
    mappedSections: ['cobranza_sentinel'],
    mappedApiRoutes: [],
  },
  {
    code: 'anticipate',
    name: 'Anticípate',
    description: 'Proyección determinística de flujo de caja esperado y estrés de morosidad a 30, 60 y 90 días.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'TrendingUp',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.2.0',
    requirements: 'Requiere Cobranza',
    dependencies: ['clientes', 'prestamos', 'cobranza'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 80,
    mappedSections: ['cobranza_anticipate'],
    mappedApiRoutes: [],
  },
  {
    code: 'impulsa',
    name: 'Impulsa',
    description: 'Motor Inteligente de Crecimiento Crediticio: detección de oportunidades comerciales, renovaciones anticipadas, crecimiento crediticio, CRM comercial, conversión a solicitud e Impulsa IA.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Activity',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '1.0.0',
    requirements: 'Requiere Clientes, Préstamos y Motor de Decisiones',
    dependencies: ['clientes', 'prestamos', 'motor_decisiones'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 75,
    mappedSections: ['intelligence_impulsa'],
    mappedApiRoutes: ['/api/impulsa'],
  },
  {
    code: 'altera',
    name: 'Altera',
    description: 'Laboratorio de Decisiones Inteligentes: Gemelo Digital Crediticio, ADN Financiero, Universos Alternativos y Plan B Preventivo.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Compass',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '1.0.0',
    requirements: 'Requiere Clientes, Préstamos y Motor de Decisiones',
    dependencies: ['clientes', 'prestamos', 'motor_decisiones'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 75,
    mappedSections: ['intelligence_altera'],
    mappedApiRoutes: [],
  },
  {
    code: 'regula',
    name: 'AxyCore REGULA',
    description: 'Inteligencia Regulatoria, Cumplimiento Normativo, PLAFTPADM, Gestión Integral de Riesgos, Control Interno, Auditoría, Evidencias, Incidentes, Planes de Acción y REGULA AI.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'ShieldCheck',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '1.0.0',
    requirements: 'Núcleo base de organización activo',
    dependencies: ['clientes'],
    licenseType: 'ADDON_COMERCIAL',
    monthlyPriceUsd: 135,
    mappedSections: ['regula'],
    mappedApiRoutes: ['/api/regula'],
  },
  {
    code: 'analitica_reportes',
    name: 'Analítica y Reportes',
    description: ' Centro de reportería ejecutiva, exportación PDF/CSV y mapas de calor de concentración de riesgo.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'BarChart3',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Requiere Clientes',
    dependencies: ['clientes'],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 60,
    mappedSections: ['reports'],
    mappedApiRoutes: [],
  },
  {
    code: 'automatizaciones',
    name: 'Automatizaciones',
    description: 'Alertas automáticas por correo SMTP, notificaciones Web Push FCM y cortes diarios de mora.',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Zap',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.1.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'INCLUIDO_PLAN',
    monthlyPriceUsd: 50,
    mappedSections: [],
    mappedApiRoutes: ['/api/notifications/dispatch-email'],
  },
  {
    code: 'inteligencia_artificial',
    name: 'Inteligencia Artificial',
    description: 'Infraestructura transversal de IA generativa y visión artificial (OCR documental, biometría facial, Director y Bela).',
    category: 'INTELIGENCIA_AUTOMATIZACION',
    iconKey: 'Sparkles',
    availabilityStatus: 'PUBLICADO',
    developmentStatus: 'DISPONIBLE',
    version: '2.4.0',
    requirements: 'Núcleo base de organización',
    dependencies: [],
    licenseType: 'ENTERPRISE',
    monthlyPriceUsd: 110,
    mappedSections: [],
    mappedApiRoutes: ['/api/ai/status'],
  },
];

// Default modules enabled for SU GLORIA MANO AMIGA (Section 5 & Section 7)
export const SU_GLORIA_ENABLED_MODULES: AxyCoreModuleCode[] = [
  'clientes',
  'prestamos',
  'motor_decisiones',
  'evaluacion_crediticia',
  'comite_credito',
  'formalizacion',
  'desembolsos',
  'cobranza',
  'pagos',
  'conciliacion_bancaria',
  'finanzas',
  'contabilidad',
  'facturacion_electronica',
  'gestion_documental',
  'contact_center',
  'axycore_director',
  'bela',
  'axyrecovery_bot',
  'centinela',
  'anticipate',
  'impulsa',
  'altera',
  'regula',
  'analitica_reportes',
  'automatizaciones',
  'inteligencia_artificial',
];

export const COMMERCIAL_PLANS_CATALOG: Record<CommercialPlanCode, CommercialPlanDefinition> = {
  BASICO: {
    code: 'BASICO',
    name: 'Plan Básico',
    tagline: 'Originación esencial, clientes y cartera de préstamos para financieras en etapa inicial.',
    includedModules: [
      'clientes',
      'prestamos',
      'formalizacion',
      'desembolsos',
      'gestion_documental',
      'analitica_reportes',
    ],
    maxUsers: 5,
    maxStorageGb: 10,
    maxMonthlyOperations: 500,
    includesAi: false,
    monthlyPriceUsd: 249,
    currency: 'USD',
    validityMonths: 12,
    commercialTerms: 'Facturación mensual o anual. Soporte estándar 8x5.',
  },
  PROFESIONAL: {
    code: 'PROFESIONAL',
    name: 'Plan Profesional',
    tagline: 'Flujo crediticio completo con Motor V2, Comité, Cobranza y Pagos.',
    includedModules: [
      'clientes',
      'prestamos',
      'motor_decisiones',
      'evaluacion_crediticia',
      'comite_credito',
      'formalizacion',
      'desembolsos',
      'cobranza',
      'pagos',
      'finanzas',
      'contabilidad',
      'gestion_documental',
      'analitica_reportes',
      'automatizaciones',
    ],
    maxUsers: 15,
    maxStorageGb: 50,
    maxMonthlyOperations: 2500,
    includesAi: false,
    monthlyPriceUsd: 499,
    currency: 'USD',
    validityMonths: 12,
    commercialTerms: 'Incluye actualizaciones de Motor V2 y soporte prioritario.',
  },
  EMPRESARIAL: {
    code: 'EMPRESARIAL',
    name: 'Plan Empresarial',
    tagline: 'Suite financiera integral con Conciliación, Centinela, Anticípate, AxyCore Director y Bela IA.',
    includedModules: SU_GLORIA_ENABLED_MODULES,
    maxUsers: 40,
    maxStorageGb: 200,
    maxMonthlyOperations: 10000,
    includesAi: true,
    monthlyPriceUsd: 899,
    currency: 'USD',
    validityMonths: 12,
    commercialTerms: 'Incluye suite de Inteligencia Artificial (Director, Bela, OCR, Biometría) y SLA 99.9%.',
  },
  CORPORATIVO: {
    code: 'CORPORATIVO',
    name: 'Plan Corporativo',
    tagline: 'Capacidad ilimitada multi-sucursal, gobierno avanzado y todos los módulos publicados.',
    includedModules: SU_GLORIA_ENABLED_MODULES,
    maxUsers: 150,
    maxStorageGb: 1000,
    maxMonthlyOperations: 100000,
    includesAi: true,
    monthlyPriceUsd: 1699,
    currency: 'USD',
    validityMonths: 12,
    commercialTerms: 'Contrato corporativo dedicado, auditoría extendida y acompañamiento técnico 24/7.',
  },
  PERSONALIZADO: {
    code: 'PERSONALIZADO',
    name: 'Plan Personalizado (A la Medida)',
    tagline: 'Selección modular flexible de servicios financieros, empresariales o de IA según contratación.',
    includedModules: ['clientes'],
    maxUsers: 25,
    maxStorageGb: 100,
    maxMonthlyOperations: 5000,
    includesAi: true,
    monthlyPriceUsd: 350,
    currency: 'USD',
    validityMonths: 12,
    commercialTerms: 'Configuración comercial a la medida con módulos individuales.',
  },
};

export const SU_GLORIA_MANO_AMIGA_ORG: OrganizationRecord = {
  id: SU_GLORIA_ORG_ID,
  organizationId: SU_GLORIA_ORG_ID,
  tenantId: SU_GLORIA_TENANT_ID,
  tenant_id: SU_GLORIA_TENANT_ID,
  accessCode: 'SGMA-001',
  name: 'SU GLORIA MANO AMIGA',
  legalName: 'SU GLORIA MANO AMIGA, S.R.L.',
  tradeName: 'SU GLORIA MANO AMIGA',
  taxId: '1-31-98421-2',
  rnc: '1-31-98421-2',
  country: 'República Dominicana',
  province: 'Santo Domingo',
  city: 'Santo Domingo Este',
  address: 'Av. Sabana Larga #48, Ensanche Ozama',
  phone: '809-555-0190',
  corporateEmail: 'operaciones@sugloriamanoamiga.do',
  currency: 'DOP',
  timezone: 'America/Santo_Domingo',
  status: 'ACTIVA',
  onboardingDate: '2026-01-15',
  planCode: 'EMPRESARIAL',
  licenseId: 'lic_org_axycore_main',
  licenseStatus: 'ACTIVA',
  licenseStartDate: '2026-01-15',
  licenseEndDate: '2027-01-15',
  maxUsers: 40,
  enabledModules: SU_GLORIA_ENABLED_MODULES,
  modulesEnabled: SU_GLORIA_ENABLED_MODULES,
  primaryAdminName: 'Administración General Su Gloria Mano Amiga',
  primaryAdminEmail: PLATFORM_OWNER_EMAIL,
  primaryAdminPhone: '809-555-0190',
  notes: 'Primera empresa cliente incorporada en la cartera oficial de AxyCore.',
  primaryColor: '#0B1220',
  accentColor: '#2563EB',
};

export const DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE: Record<UserRole, GranularActionPermission[]> = {
  ADMIN: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR', 'ELIMINAR', 'EXPORTAR', 'ADMINISTRAR'],
  MANAGEMENT: ['CONSULTAR', 'APROBAR', 'EXPORTAR'],
  SUPERVISOR: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR', 'EXPORTAR'],
  COLLECTION_COORDINATOR: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR', 'EXPORTAR', 'ADMINISTRAR'],
  BUSINESS_OFFICER: ['CONSULTAR', 'CREAR', 'EDITAR', 'EXPORTAR'],
  CREDIT_ANALYST: ['CONSULTAR', 'CREAR', 'EDITAR', 'EXPORTAR'],
  RISK_OFFICER: ['CONSULTAR', 'EDITAR', 'APROBAR', 'EXPORTAR'],
  COMMITTEE_MEMBER: ['CONSULTAR', 'APROBAR', 'EXPORTAR'],
  FORMALIZATION: ['CONSULTAR', 'CREAR', 'EDITAR', 'EXPORTAR'],
  OPERATIONS: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR', 'EXPORTAR'],
  FINANCE: ['CONSULTAR', 'CREAR', 'EDITAR', 'APROBAR', 'EXPORTAR'],
  COLLECTION_AGENT: ['CONSULTAR', 'CREAR', 'EDITAR'],
  CASHIER: ['CONSULTAR', 'CREAR'],
  AUDITOR: ['CONSULTAR', 'EXPORTAR'],
  EXTERNAL_CLIENT: ['CONSULTAR', 'CREAR'],
};

export function getModuleByCode(
  code: AxyCoreModuleCode,
  customCatalog: ModuleCatalogItem[] = AXYCORE_MODULE_CATALOG
): ModuleCatalogItem | undefined {
  return customCatalog.find((m) => m.code === code);
}

export function resolveModuleForNavSection(section: NavSectionId): AxyCoreModuleCode | null {
  if (
    section === 'dashboard' ||
    section === 'system_guide' ||
    section === 'system_sitemap' ||
    section === 'platform_control'
  ) {
    return null;
  }
  for (const mod of AXYCORE_MODULE_CATALOG) {
    if (mod.mappedSections.includes(section)) {
      return mod.code;
    }
  }
  return null;
}

export interface ModuleToggleValidationResult {
  allowed: boolean;
  reason?: string;
  updatedModules: AxyCoreModuleCode[];
  missingDependencies?: AxyCoreModuleCode[];
  dependentActiveModules?: AxyCoreModuleCode[];
}

export function validateModuleToggle(params: {
  currentModules: AxyCoreModuleCode[];
  targetModule: AxyCoreModuleCode;
  enable: boolean;
  catalog?: ModuleCatalogItem[];
}): ModuleToggleValidationResult {
  const { currentModules, targetModule, enable, catalog = AXYCORE_MODULE_CATALOG } = params;
  const modItem = getModuleByCode(targetModule, catalog);

  if (!modItem) {
    return {
      allowed: false,
      reason: `El módulo «${targetModule}» no existe en el catálogo maestro de AxyCore.`,
      updatedModules: currentModules,
    };
  }

  const currentSet = new Set<AxyCoreModuleCode>(currentModules);

  if (enable) {
    if (modItem.availabilityStatus === 'RETIRADO') {
      return {
        allowed: false,
        reason: `El módulo «${modItem.name}» se encuentra retirado del catálogo comercial.`,
        updatedModules: currentModules,
      };
    }
    if (modItem.developmentStatus !== 'DISPONIBLE') {
      return {
        allowed: false,
        reason: `El módulo «${modItem.name}» aún está en estado «En Desarrollo (${modItem.version})» y no puede activarse como disponible en producción.`,
        updatedModules: currentModules,
      };
    }

    const missingDeps = modItem.dependencies.filter((dep) => !currentSet.has(dep));
    if (missingDeps.length > 0) {
      const missingNames = missingDeps
        .map((d) => getModuleByCode(d, catalog)?.name || d)
        .join(', ');
      return {
        allowed: false,
        reason: `No se puede activar «${modItem.name}» porque requiere tener habilitados previamente: ${missingNames}.`,
        updatedModules: currentModules,
        missingDependencies: missingDeps,
      };
    }

    currentSet.add(targetModule);
    return {
      allowed: true,
      updatedModules: Array.from(currentSet),
    };
  }

  // Disabling a module: check if any currently active module depends on it
  const dependents = catalog
    .filter((m) => currentSet.has(m.code) && m.dependencies.includes(targetModule))
    .map((m) => m.code);

  if (dependents.length > 0) {
    const depNames = dependents.map((d) => getModuleByCode(d, catalog)?.name || d).join(', ');
    return {
      allowed: false,
      reason: `No se puede desactivar «${modItem.name}» mientras estén activos módulos que dependen de él: ${depNames}.`,
      updatedModules: currentModules,
      dependentActiveModules: dependents,
    };
  }

  currentSet.delete(targetModule);
  return {
    allowed: true,
    updatedModules: Array.from(currentSet),
  };
}

export interface TenantSectionAccessCheck {
  allowed: boolean;
  reason?: string;
  requiredModule?: AxyCoreModuleCode | null;
  moduleName?: string;
  isLicenseBlocked?: boolean;
  isTenantSuspended?: boolean;
}

export function checkTenantSectionAccess(params: {
  section: NavSectionId;
  organization: OrganizationRecord;
  isSuperAdmin: boolean;
}): TenantSectionAccessCheck {
  const { section, organization, isSuperAdmin } = params;

  // Platform Control is strictly exclusive to AxyCore Superadministrador
  if (section === 'platform_control') {
    if (!isSuperAdmin) {
      return {
        allowed: false,
        reason:
          'Acceso denegado: AxyCore Platform Control es exclusivo del Superadministrador propietario de la plataforma.',
      };
    }
    return { allowed: true };
  }

  // Check tenant operational state
  const tenantStatus: TenantStatus = organization.status ?? 'ACTIVA';
  if (tenantStatus === 'SUSPENDIDA' || tenantStatus === 'DESACTIVADA') {
    return {
      allowed: false,
      isTenantSuspended: true,
      reason: `El espacio de trabajo de «${organization.name}» se encuentra en estado ${tenantStatus}. Contacte a AxyCore Platform Control.`,
    };
  }

  // Check license state
  const licenseStatus: LicenseStatus = organization.licenseStatus ?? 'ACTIVA';
  if (
    (licenseStatus === 'VENCIDA' ||
      licenseStatus === 'SUSPENDIDA' ||
      licenseStatus === 'CANCELADA') &&
    section !== 'dashboard'
  ) {
    return {
      allowed: false,
      isLicenseBlocked: true,
      reason: `La licencia comercial de «${organization.name}» está ${licenseStatus}. Las operaciones de módulos están restringidas hasta su renovación.`,
    };
  }

  // Dashboard, System Guide & System Sitemap are always accessible if tenant is active
  if (section === 'dashboard' || section === 'system_guide' || section === 'system_sitemap') {
    return { allowed: true, requiredModule: null };
  }

  const requiredModule = resolveModuleForNavSection(section);
  if (!requiredModule) {
    return { allowed: true, requiredModule: null };
  }

  const modMeta = getModuleByCode(requiredModule);
  const enabledList = organization.enabledModules ?? SU_GLORIA_ENABLED_MODULES;

  if (!enabledList.includes(requiredModule)) {
    return {
      allowed: false,
      requiredModule,
      moduleName: modMeta?.name || requiredModule,
      reason: `El módulo «${modMeta?.name || requiredModule}» no está contratado o habilitado en la licencia de ${organization.name}. Los datos históricos se conservan íntegros.`,
    };
  }

  return {
    allowed: true,
    requiredModule,
    moduleName: modMeta?.name || requiredModule,
  };
}

export function checkTenantApiAccess(params: {
  apiPath: string;
  organization: Pick<OrganizationRecord, 'id' | 'name' | 'status' | 'licenseStatus' | 'enabledModules'>;
}): { allowed: boolean; status: number; reason?: string } {
  const { apiPath, organization } = params;
  const tenantStatus = organization.status ?? 'ACTIVA';
  if (tenantStatus === 'SUSPENDIDA' || tenantStatus === 'DESACTIVADA') {
    return {
      allowed: false,
      status: 403,
      reason: `Organización ${organization.name} (${organization.id}) en estado ${tenantStatus}. API bloqueada.`,
    };
  }

  const licenseStatus = organization.licenseStatus ?? 'ACTIVA';
  if (
    licenseStatus === 'VENCIDA' ||
    licenseStatus === 'SUSPENDIDA' ||
    licenseStatus === 'CANCELADA'
  ) {
    return {
      allowed: false,
      status: 403,
      reason: `Licencia de ${organization.name} en estado ${licenseStatus}. Operación bloqueada por control de licencias.`,
    };
  }

  const enabledList = organization.enabledModules ?? SU_GLORIA_ENABLED_MODULES;
  const matchedModule = AXYCORE_MODULE_CATALOG.find((m) =>
    m.mappedApiRoutes.some((route) => apiPath.startsWith(route))
  );

  if (matchedModule && !enabledList.includes(matchedModule.code)) {
    return {
      allowed: false,
      status: 403,
      reason: `El módulo «${matchedModule.name}» (${matchedModule.code}) está desactivado para la empresa ${organization.name}.`,
    };
  }

  return { allowed: true, status: 200 };
}

export interface RegisterNewCompanyInput {
  companyName: string;
  legalName: string;
  tradeName: string;
  rnc: string;
  country: string;
  province: string;
  city: string;
  address: string;
  phone: string;
  corporateEmail: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  planCode: CommercialPlanCode;
  startDate: string;
  endDate: string;
  status: TenantStatus;
  requestedModules: AxyCoreModuleCode[];
  maxUsers?: number;
  currency?: CurrencyCode;
  timezone?: string;
  notes?: string;
  accessCode?: string;
  createdByUid: string;
}

export interface RegisteredCompanyBundle {
  organization: OrganizationRecord;
  license: TenantLicenseRecord;
  subscription: TenantSubscriptionRecord;
  adminMembership: OrganizationMembershipRecord;
  invitationTokenId: string;
  invitationLink: string;
}

export function buildNewCompanyRegistrationBundle(
  input: RegisterNewCompanyInput
): RegisteredCompanyBundle {
  const cleanName = input.companyName.trim();
  if (cleanName.length < 2) {
    throw new Error('El nombre de la empresa debe tener al menos 2 caracteres.');
  }
  const cleanRnc = input.rnc.trim();
  if (cleanRnc.length < 5) {
    throw new Error('El RNC o identificación fiscal es obligatorio.');
  }
  const cleanAdminEmail = input.adminEmail.trim().toLowerCase();
  if (!cleanAdminEmail.includes('@')) {
    throw new Error('El correo del administrador principal no es válido.');
  }

  const plan = COMMERCIAL_PLANS_CATALOG[input.planCode] ?? COMMERCIAL_PLANS_CATALOG.EMPRESARIAL;

  // Validate requested modules (only allow available published modules and auto-resolve dependencies)
  const resolvedModules = new Set<AxyCoreModuleCode>();
  const seedModules =
    input.requestedModules.length > 0 ? input.requestedModules : plan.includedModules;

  for (const modCode of seedModules) {
    const modItem = getModuleByCode(modCode);
    if (!modItem || modItem.developmentStatus !== 'DISPONIBLE') continue;
    for (const dep of modItem.dependencies) {
      const depItem = getModuleByCode(dep);
      if (depItem && depItem.developmentStatus === 'DISPONIBLE') {
        resolvedModules.add(dep);
      }
    }
    resolvedModules.add(modCode);
  }

  if (resolvedModules.size === 0) {
    resolvedModules.add('clientes');
  }

  const slug = sanitizeIdSegment(
    (input.tradeName || input.companyName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  ).slice(0, 36);
  const suffix = Math.random().toString(36).slice(2, 7);
  const orgId = `org_${slug || 'empresa'}_${suffix}`;
  const tenantId = `${(slug || 'empresa').replace(/_/g, '-')}-${suffix}`;
  const accessCode = input.accessCode?.trim()
    ? input.accessCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
    : generateCorporateAccessCode(input.tradeName || input.companyName, suffix);
  const licenseId = `lic_${orgId}`;
  const subscriptionId = `sub_${orgId}`;
  const adminPlaceholderUid = `inv_${sanitizeIdSegment(cleanAdminEmail)}_${suffix}`;
  const membershipId = `mem_${orgId}_${adminPlaceholderUid}`;
  const enabledModules = Array.from(resolvedModules);
  const addonModules = enabledModules.filter((m) => !plan.includedModules.includes(m));
  const maxUsers = input.maxUsers && input.maxUsers >= 1 ? input.maxUsers : plan.maxUsers;
  const currency: CurrencyCode = input.currency ?? 'DOP';
  const timezone = input.timezone || 'America/Santo_Domingo';
  const licenseStatus: LicenseStatus =
    input.status === 'ACTIVA'
      ? 'ACTIVA'
      : input.status === 'PENDIENTE'
      ? 'PENDIENTE'
      : 'SUSPENDIDA';

  const organization: OrganizationRecord = {
    id: orgId,
    organizationId: orgId,
    tenantId,
    tenant_id: tenantId,
    accessCode,
    name: input.tradeName.trim() || cleanName,
    legalName: input.legalName.trim() || cleanName,
    tradeName: input.tradeName.trim() || cleanName,
    taxId: cleanRnc,
    rnc: cleanRnc,
    country: input.country.trim() || 'República Dominicana',
    province: input.province.trim() || 'Santo Domingo',
    city: input.city.trim() || 'Santo Domingo',
    address: input.address.trim() || 'Dirección comercial registrada',
    phone: input.phone.trim() || '809-000-0000',
    corporateEmail: input.corporateEmail.trim().toLowerCase() || cleanAdminEmail,
    currency,
    timezone,
    status: input.status,
    onboardingDate: input.startDate,
    planCode: input.planCode,
    licenseId,
    licenseStatus,
    licenseStartDate: input.startDate,
    licenseEndDate: input.endDate,
    maxUsers,
    enabledModules,
    modulesEnabled: enabledModules,
    primaryAdminUid: adminPlaceholderUid,
    primaryAdminName: input.adminName.trim() || 'Administrador Principal',
    primaryAdminEmail: cleanAdminEmail,
    primaryAdminPhone: input.adminPhone.trim() || input.phone.trim() || '',
    notes: input.notes?.trim() || '',
    primaryColor: '#0B1220',
    accentColor: '#2563EB',
  };

  const license: TenantLicenseRecord = {
    id: licenseId,
    organizationId: orgId,
    organizationName: organization.name,
    planCode: input.planCode,
    status: licenseStatus,
    startDate: input.startDate,
    endDate: input.endDate,
    maxUsers,
    maxStorageGb: plan.maxStorageGb,
    maxMonthlyOperations: plan.maxMonthlyOperations,
    enabledModules,
    addonModules,
    aiEnabled: enabledModules.includes('inteligencia_artificial'),
    monthlyFeeUsd: plan.monthlyPriceUsd,
    currency: 'USD',
    notes: input.notes?.trim() || '',
    updatedBy: input.createdByUid,
  };

  const subscription: TenantSubscriptionRecord = {
    id: subscriptionId,
    organizationId: orgId,
    organizationName: organization.name,
    licenseId,
    planCode: input.planCode,
    billingCycle: 'MENSUAL',
    amount: plan.monthlyPriceUsd,
    currency: 'USD',
    status: input.status === 'ACTIVA' ? 'ACTIVA' : 'PENDIENTE_PAGO',
    nextBillingDate: input.endDate,
    createdBy: input.createdByUid,
  };

  const adminMembership: OrganizationMembershipRecord = {
    id: membershipId,
    userId: adminPlaceholderUid,
    userEmail: cleanAdminEmail,
    userDisplayName: organization.primaryAdminName || 'Administrador Principal',
    organizationId: orgId,
    tenantId,
    tenant_id: tenantId,
    organizationName: organization.name,
    role: 'ADMIN',
    granularPermissions: DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE.ADMIN,
    status: 'INVITED',
    isPrimaryAdmin: true,
    invitedBy: input.createdByUid,
    createdBy: input.createdByUid,
  };

  const invitationTokenId = `inv_tok_${orgId}_${suffix}`;
  const invitationLink = `/?tenantInvite=${encodeURIComponent(invitationTokenId)}&orgId=${encodeURIComponent(orgId)}&email=${encodeURIComponent(cleanAdminEmail)}`;

  return {
    organization,
    license,
    subscription,
    adminMembership,
    invitationTokenId,
    invitationLink,
  };
}

// ==========================================================
// Strict Multi-Tenant Data Isolation & Controlled Migration
// ==========================================================

export function filterRecordsByTenant<T extends { organizationId?: string }>(
  records: T[],
  activeOrganizationId: string
): T[] {
  if (!activeOrganizationId) return [];
  return records.filter((r) => r.organizationId === activeOrganizationId);
}

export function canUserAccessRecordByTenant(params: {
  recordOrganizationId: string;
  activeOrganizationId: string;
  userProfile: UserProfile;
  memberships?: OrganizationMembershipRecord[];
}): boolean {
  const { recordOrganizationId, activeOrganizationId, userProfile, memberships = [] } = params;
  if (!recordOrganizationId || !activeOrganizationId) return false;
  if (userProfile.status !== 'ACTIVE') return false;

  // Record must belong to the active organization workspace
  if (recordOrganizationId !== activeOrganizationId) {
    return false;
  }

  // User must belong to the active organization either directly or via an active membership
  if (userProfile.organizationId === activeOrganizationId) {
    return true;
  }

  return memberships.some(
    (m) =>
      (m.userId === userProfile.uid ||
        m.userEmail.toLowerCase() === userProfile.email.toLowerCase()) &&
      m.organizationId === activeOrganizationId &&
      m.status === 'ACTIVE'
  );
}

export function switchUserOrganizationWorkspace(params: {
  userProfile: UserProfile;
  targetOrganizationId: string;
  organizations: OrganizationRecord[];
  memberships: OrganizationMembershipRecord[];
  isSuperAdmin?: boolean;
}): {
  allowed: boolean;
  reason?: string;
  updatedProfile?: UserProfile;
  targetOrganization?: OrganizationRecord;
  effectiveRole?: UserRole;
} {
  const {
    userProfile,
    targetOrganizationId,
    organizations,
    memberships,
    isSuperAdmin = false,
  } = params;

  const targetOrg = organizations.find((o) => o.id === targetOrganizationId);
  if (!targetOrg) {
    return {
      allowed: false,
      reason: `La organización solicitada (${targetOrganizationId}) no existe.`,
    };
  }

  if (
    !isSuperAdmin &&
    (targetOrg.status === 'SUSPENDIDA' || targetOrg.status === 'DESACTIVADA')
  ) {
    return {
      allowed: false,
      reason: `La organización «${targetOrg.name}» se encuentra ${targetOrg.status}.`,
    };
  }

  if (isSuperAdmin) {
    return {
      allowed: true,
      targetOrganization: targetOrg,
      effectiveRole: 'ADMIN',
      updatedProfile: {
        ...userProfile,
        organizationId: targetOrg.id,
        role: 'ADMIN',
      },
    };
  }

  const membership = memberships.find(
    (m) =>
      (m.userId === userProfile.uid ||
        m.userEmail.toLowerCase() === userProfile.email.toLowerCase()) &&
      m.organizationId === targetOrganizationId &&
      m.status === 'ACTIVE'
  );

  if (!membership && userProfile.organizationId !== targetOrganizationId) {
    return {
      allowed: false,
      reason: `El usuario ${userProfile.email} no posee una membresía activa en «${targetOrg.name}».`,
    };
  }

  const effectiveRole: UserRole = membership?.role ?? userProfile.role;
  return {
    allowed: true,
    targetOrganization: targetOrg,
    effectiveRole,
    updatedProfile: {
      ...userProfile,
      organizationId: targetOrg.id,
      role: effectiveRole,
    },
  };
}

export interface ControlledMigrationSummary<T extends { id: string; organizationId?: string }> {
  targetOrganizationId: string;
  targetOrganizationName: string;
  totalInputCount: number;
  migratedToSuGloriaCount: number;
  alreadyAssignedSuGloriaCount: number;
  otherTenantsPreservedCount: number;
  duplicateIdsDetected: number;
  records: T[];
}

export function runControlledSuGloriaMigration<
  T extends { id: string; organizationId?: string }
>(records: T[]): ControlledMigrationSummary<T> {
  const seenById = new Map<string, T>();
  let migratedToSuGloriaCount = 0;
  let alreadyAssignedSuGloriaCount = 0;
  let otherTenantsPreservedCount = 0;
  let duplicateIdsDetected = 0;

  for (const rec of records) {
    if (seenById.has(rec.id)) {
      duplicateIdsDetected += 1;
      continue;
    }

    const rawOrg = rec.organizationId?.trim();
    if (!rawOrg || rawOrg === 'org_default' || rawOrg === SU_GLORIA_ORG_ID) {
      if (rawOrg === SU_GLORIA_ORG_ID) {
        alreadyAssignedSuGloriaCount += 1;
        seenById.set(rec.id, rec);
      } else {
        migratedToSuGloriaCount += 1;
        seenById.set(rec.id, {
          ...rec,
          organizationId: SU_GLORIA_ORG_ID,
        });
      }
    } else {
      otherTenantsPreservedCount += 1;
      seenById.set(rec.id, rec);
    }
  }

  return {
    targetOrganizationId: SU_GLORIA_ORG_ID,
    targetOrganizationName: SU_GLORIA_MANO_AMIGA_ORG.name,
    totalInputCount: records.length,
    migratedToSuGloriaCount,
    alreadyAssignedSuGloriaCount,
    otherTenantsPreservedCount,
    duplicateIdsDetected,
    records: Array.from(seenById.values()),
  };
}

// =========================================================================
// Esquemas de Colecciones Multi-Tenant: 'organizations' y 'organization_memberships'
// =========================================================================

export const ORGANIZATIONS_COLLECTION = 'organizations';
export const ORGANIZATION_MEMBERSHIPS_COLLECTION = 'organization_memberships';

export interface CollectionFieldSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'timestamp' | 'object';
  required: boolean;
  description: string;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  enum?: readonly string[];
  default?: unknown;
}

export interface CollectionSchemaDefinition {
  collectionName: string;
  description: string;
  primaryKey: string;
  tenantKey: string;
  slugKey?: string;
  requiredFields: string[];
  fields: Record<string, CollectionFieldSchema>;
}

export const ORGANIZATIONS_COLLECTION_SCHEMA: CollectionSchemaDefinition = {
  collectionName: ORGANIZATIONS_COLLECTION,
  description:
    'Expediente maestro de organizaciones clientes (tenants) para aislamiento de datos y licenciamiento SaaS.',
  primaryKey: 'id',
  tenantKey: 'organizationId',
  slugKey: 'tenant_id',
  requiredFields: ['id', 'name', 'createdAt', 'updatedAt'],
  fields: {
    id: {
      name: 'id',
      type: 'string',
      required: true,
      pattern: '^[a-zA-Z0-9_\\-]+$',
      maxLength: 128,
      description: 'Identificador único del documento de la organización en Firestore.',
    },
    organizationId: {
      name: 'organizationId',
      type: 'string',
      required: true,
      pattern: '^[a-zA-Z0-9_\\-]+$',
      maxLength: 128,
      description: 'Identificador canónico de la organización coincidente con el ID de documento.',
    },
    tenantId: {
      name: 'tenantId',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'Slug o código corto de tenant para URL y subdominios.',
    },
    tenant_id: {
      name: 'tenant_id',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'Identificador de aislamiento tenant_id (snake_case) para compatibilidad multiempresa.',
    },
    name: {
      name: 'name',
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 160,
      description: 'Nombre general o comercial de la organización.',
    },
    legalName: {
      name: 'legalName',
      type: 'string',
      required: false,
      maxLength: 200,
      description: 'Razón social legalmente registrada ante autoridades tributarias.',
    },
    tradeName: {
      name: 'tradeName',
      type: 'string',
      required: false,
      maxLength: 160,
      description: 'Nombre comercial de la empresa.',
    },
    taxId: {
      name: 'taxId',
      type: 'string',
      required: false,
      maxLength: 40,
      description: 'Identificación fiscal o RNC de la empresa.',
    },
    rnc: {
      name: 'rnc',
      type: 'string',
      required: false,
      maxLength: 40,
      description: 'RNC formal registrado para República Dominicana.',
    },
    country: {
      name: 'country',
      type: 'string',
      required: false,
      maxLength: 80,
      default: 'República Dominicana',
      description: 'País de operación principal.',
    },
    province: {
      name: 'province',
      type: 'string',
      required: false,
      maxLength: 80,
      default: 'Santo Domingo',
      description: 'Provincia o estado.',
    },
    city: {
      name: 'city',
      type: 'string',
      required: false,
      maxLength: 80,
      default: 'Santo Domingo',
      description: 'Ciudad o municipio.',
    },
    address: {
      name: 'address',
      type: 'string',
      required: false,
      maxLength: 300,
      description: 'Dirección física principal.',
    },
    phone: {
      name: 'phone',
      type: 'string',
      required: false,
      maxLength: 40,
      description: 'Teléfono corporativo oficial.',
    },
    corporateEmail: {
      name: 'corporateEmail',
      type: 'string',
      required: false,
      maxLength: 254,
      description: 'Correo electrónico corporativo para notificaciones.',
    },
    currency: {
      name: 'currency',
      type: 'string',
      required: false,
      enum: ['DOP', 'USD'],
      default: 'DOP',
      description: 'Moneda base de operación.',
    },
    timezone: {
      name: 'timezone',
      type: 'string',
      required: false,
      maxLength: 64,
      default: 'America/Santo_Domingo',
      description: 'Zona horaria operativa.',
    },
    status: {
      name: 'status',
      type: 'string',
      required: false,
      enum: ['ACTIVA', 'SUSPENDIDA', 'INACTIVA', 'PRUEBA', 'EN_REVISION', 'DESACTIVADA', 'PENDIENTE'],
      default: 'ACTIVA',
      description: 'Estado operativo del tenant en AxyCore.',
    },
    planCode: {
      name: 'planCode',
      type: 'string',
      required: false,
      enum: ['BASICO', 'PROFESIONAL', 'EMPRESARIAL', 'CORPORATIVO', 'PERSONALIZADO'],
      default: 'EMPRESARIAL',
      description: 'Plan comercial suscrito.',
    },
    licenseId: {
      name: 'licenseId',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'ID de la licencia SaaS asociada.',
    },
    licenseStatus: {
      name: 'licenseStatus',
      type: 'string',
      required: false,
      enum: ['PENDIENTE', 'ACTIVA', 'PROXIMA_A_VENCER', 'VENCIDA', 'SUSPENDIDA', 'CANCELADA'],
      default: 'ACTIVA',
      description: 'Estado de validez de la licencia.',
    },
    maxUsers: {
      name: 'maxUsers',
      type: 'number',
      required: false,
      default: 40,
      description: 'Límite máximo de usuarios permitidos en el espacio de trabajo.',
    },
    enabledModules: {
      name: 'enabledModules',
      type: 'array',
      required: false,
      description: 'Lista de módulos activos contratados.',
    },
    modulesEnabled: {
      name: 'modulesEnabled',
      type: 'array',
      required: false,
      description: 'Lista de módulos autorizados (alias para compatibilidad).',
    },
    primaryAdminUid: {
      name: 'primaryAdminUid',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'UID del usuario designado como Administrador Principal.',
    },
    primaryAdminName: {
      name: 'primaryAdminName',
      type: 'string',
      required: false,
      maxLength: 160,
      description: 'Nombre del administrador principal.',
    },
    primaryAdminEmail: {
      name: 'primaryAdminEmail',
      type: 'string',
      required: false,
      maxLength: 254,
      description: 'Correo del administrador principal.',
    },
    primaryAdminPhone: {
      name: 'primaryAdminPhone',
      type: 'string',
      required: false,
      maxLength: 40,
      description: 'Teléfono de contacto del administrador.',
    },
    notes: {
      name: 'notes',
      type: 'string',
      required: false,
      maxLength: 1500,
      description: 'Notas y observaciones administrativas.',
    },
    primaryColor: {
      name: 'primaryColor',
      type: 'string',
      required: false,
      maxLength: 32,
      default: '#0B1220',
      description: 'Color primario de la marca corporativa.',
    },
    accentColor: {
      name: 'accentColor',
      type: 'string',
      required: false,
      maxLength: 32,
      default: '#2563EB',
      description: 'Color de acento de la marca corporativa.',
    },
    createdAt: {
      name: 'createdAt',
      type: 'timestamp',
      required: true,
      description: 'Fecha y hora de incorporación en la plataforma.',
    },
    updatedAt: {
      name: 'updatedAt',
      type: 'timestamp',
      required: true,
      description: 'Fecha y hora de última modificación.',
    },
  },
};

export const ORGANIZATION_MEMBERSHIPS_COLLECTION_SCHEMA: CollectionSchemaDefinition = {
  collectionName: ORGANIZATION_MEMBERSHIPS_COLLECTION,
  description:
    'Vínculo de membresía entre un usuario autenticado y una organización tenant con rol y permisos granulares.',
  primaryKey: 'id',
  tenantKey: 'organizationId',
  slugKey: 'tenant_id',
  requiredFields: [
    'id',
    'organizationId',
    'userId',
    'userEmail',
    'userDisplayName',
    'role',
    'status',
    'granularPermissions',
    'createdBy',
    'createdAt',
    'updatedAt',
  ],
  fields: {
    id: {
      name: 'id',
      type: 'string',
      required: true,
      pattern: '^[a-zA-Z0-9_\\-]+$',
      maxLength: 128,
      description: 'Identificador único del documento de membresía.',
    },
    organizationId: {
      name: 'organizationId',
      type: 'string',
      required: true,
      maxLength: 128,
      description: 'ID de la organización a la que pertenece la membresía.',
    },
    tenantId: {
      name: 'tenantId',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'Slug o identificador tenantId de la organización.',
    },
    tenant_id: {
      name: 'tenant_id',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'Identificador de aislamiento tenant_id (snake_case) para compatibilidad multiempresa.',
    },
    organizationName: {
      name: 'organizationName',
      type: 'string',
      required: false,
      maxLength: 160,
      description: 'Nombre comercial de la organización vinculada.',
    },
    userId: {
      name: 'userId',
      type: 'string',
      required: true,
      maxLength: 128,
      description: 'UID del usuario autenticado en Firebase.',
    },
    userEmail: {
      name: 'userEmail',
      type: 'string',
      required: true,
      maxLength: 254,
      description: 'Correo electrónico del usuario vinculado.',
    },
    userDisplayName: {
      name: 'userDisplayName',
      type: 'string',
      required: true,
      maxLength: 160,
      description: 'Nombre completo o nombre para mostrar del usuario.',
    },
    role: {
      name: 'role',
      type: 'string',
      required: true,
      enum: [
        'ADMIN',
        'BUSINESS_OFFICER',
        'CREDIT_ANALYST',
        'RISK_OFFICER',
        'COMMITTEE_MEMBER',
        'FORMALIZATION',
        'OPERATIONS',
        'FINANCE',
        'AUDITOR',
        'COLLECTION_AGENT',
        'SUPERVISOR',
        'COLLECTION_COORDINATOR',
        'CASHIER',
        'MANAGEMENT',
        'EXTERNAL_CLIENT',
      ],
      description: 'Rol funcional del usuario dentro de la organización.',
    },
    status: {
      name: 'status',
      type: 'string',
      required: true,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'INVITED', 'REVOKED'],
      default: 'ACTIVE',
      description: 'Estado de la membresía en la organización.',
    },
    granularPermissions: {
      name: 'granularPermissions',
      type: 'array',
      required: true,
      description: 'Acciones granulares autorizadas (CONSULTAR, CREAR, EDITAR, APROBAR, ELIMINAR, EXPORTAR, ADMINISTRAR).',
    },
    allowedModuleCodes: {
      name: 'allowedModuleCodes',
      type: 'array',
      required: false,
      description: 'Subconjunto de códigos de módulos permitidos al usuario dentro del tenant.',
    },
    isPrimaryAdmin: {
      name: 'isPrimaryAdmin',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Indica si este usuario es el administrador principal del tenant.',
    },
    invitedBy: {
      name: 'invitedBy',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'UID del usuario o superadmin que emitió la invitación.',
    },
    createdBy: {
      name: 'createdBy',
      type: 'string',
      required: false,
      maxLength: 128,
      description: 'UID del autor de creación del registro.',
    },
    createdAt: {
      name: 'createdAt',
      type: 'timestamp',
      required: true,
      description: 'Fecha y hora de creación de la membresía.',
    },
    updatedAt: {
      name: 'updatedAt',
      type: 'timestamp',
      required: true,
      description: 'Fecha y hora de última modificación.',
    },
  },
};

export interface SchemaValidationResult<T> {
  isValid: boolean;
  errors: string[];
  sanitized?: T;
}

export function validateOrganizationSchema(data: unknown): SchemaValidationResult<OrganizationRecord> {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Los datos de la organización deben ser un objeto válido.'] };
  }

  const obj = data as Record<string, unknown>;
  const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';
  const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
  const rawOrgId =
    typeof obj.organizationId === 'string' && obj.organizationId.trim()
      ? obj.organizationId.trim()
      : rawId;

  if (!rawId) {
    errors.push('El campo «id» de la organización es obligatorio.');
  } else if (!/^[a-zA-Z0-9_\-]+$/.test(rawId)) {
    errors.push('El campo «id» contiene caracteres inválidos. Solo se admiten letras, números, guiones y guiones bajos.');
  }

  if (!rawName || rawName.length < 2) {
    errors.push('El nombre de la organización debe contener al menos 2 caracteres.');
  }

  const validStatuses: TenantStatus[] = [
    'ACTIVA',
    'SUSPENDIDA',
    'INACTIVA',
    'PRUEBA',
    'EN_REVISION',
    'DESACTIVADA',
    'PENDIENTE',
  ];
  const status = typeof obj.status === 'string' && validStatuses.includes(obj.status as TenantStatus)
    ? (obj.status as TenantStatus)
    : 'ACTIVA';

  const validPlans: CommercialPlanCode[] = [
    'BASICO',
    'PROFESIONAL',
    'EMPRESARIAL',
    'CORPORATIVO',
    'PERSONALIZADO',
  ];
  const planCode = typeof obj.planCode === 'string' && validPlans.includes(obj.planCode as CommercialPlanCode)
    ? (obj.planCode as CommercialPlanCode)
    : 'EMPRESARIAL';

  const enabledModules = Array.isArray(obj.enabledModules)
    ? (obj.enabledModules as AxyCoreModuleCode[])
    : Array.isArray(obj.modulesEnabled)
    ? (obj.modulesEnabled as AxyCoreModuleCode[])
    : SU_GLORIA_ENABLED_MODULES;

  const tenantId =
    typeof obj.tenantId === 'string' && obj.tenantId.trim()
      ? obj.tenantId.trim()
      : typeof obj.tenant_id === 'string' && obj.tenant_id.trim()
      ? obj.tenant_id.trim()
      : rawId === SU_GLORIA_ORG_ID
      ? SU_GLORIA_TENANT_ID
      : rawId;

  const accessCode =
    typeof obj.accessCode === 'string' && obj.accessCode.trim()
      ? obj.accessCode.trim().toUpperCase()
      : rawId === SU_GLORIA_ORG_ID
      ? 'SGMA-001'
      : generateCorporateAccessCode(rawName, rawId.slice(-4));

  const sanitized: OrganizationRecord = {
    id: rawId,
    organizationId: rawOrgId,
    tenantId,
    tenant_id: tenantId,
    accessCode,
    name: rawName,
    legalName: typeof obj.legalName === 'string' ? obj.legalName.trim() : rawName,
    tradeName: typeof obj.tradeName === 'string' ? obj.tradeName.trim() : rawName,
    taxId: typeof obj.taxId === 'string' ? obj.taxId.trim() : typeof obj.rnc === 'string' ? obj.rnc.trim() : '',
    rnc: typeof obj.rnc === 'string' ? obj.rnc.trim() : typeof obj.taxId === 'string' ? obj.taxId.trim() : '',
    status,
    planCode,
    currency: obj.currency === 'USD' ? 'USD' : 'DOP',
    timezone: typeof obj.timezone === 'string' ? obj.timezone : 'America/Santo_Domingo',
    country: typeof obj.country === 'string' ? obj.country : 'República Dominicana',
    province: typeof obj.province === 'string' ? obj.province : 'Santo Domingo',
    city: typeof obj.city === 'string' ? obj.city : 'Santo Domingo',
    address: typeof obj.address === 'string' ? obj.address : '',
    phone: typeof obj.phone === 'string' ? obj.phone : '',
    corporateEmail: typeof obj.corporateEmail === 'string' ? obj.corporateEmail : '',
    maxUsers: typeof obj.maxUsers === 'number' && obj.maxUsers >= 1 ? obj.maxUsers : 40,
    enabledModules,
    modulesEnabled: enabledModules,
    licenseId: typeof obj.licenseId === 'string' ? obj.licenseId : `lic_${rawId}`,
    licenseStatus: typeof obj.licenseStatus === 'string' ? (obj.licenseStatus as LicenseStatus) : 'ACTIVA',
    primaryAdminUid: typeof obj.primaryAdminUid === 'string' ? obj.primaryAdminUid : undefined,
    primaryAdminName: typeof obj.primaryAdminName === 'string' ? obj.primaryAdminName : undefined,
    primaryAdminEmail: typeof obj.primaryAdminEmail === 'string' ? obj.primaryAdminEmail : undefined,
    primaryAdminPhone: typeof obj.primaryAdminPhone === 'string' ? obj.primaryAdminPhone : undefined,
    notes: typeof obj.notes === 'string' ? obj.notes : '',
    primaryColor: typeof obj.primaryColor === 'string' ? obj.primaryColor : '#0B1220',
    accentColor: typeof obj.accentColor === 'string' ? obj.accentColor : '#2563EB',
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined,
  };
}

export function validateOrganizationMembershipSchema(
  data: unknown
): SchemaValidationResult<OrganizationMembershipRecord> {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { isValid: false, errors: ['Los datos de la membresía deben ser un objeto válido.'] };
  }

  const obj = data as Record<string, unknown>;
  const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';
  const rawOrgId = typeof obj.organizationId === 'string' ? obj.organizationId.trim() : '';
  const rawUserId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  const rawEmail = typeof obj.userEmail === 'string' ? obj.userEmail.trim().toLowerCase() : '';
  const rawDisplayName = typeof obj.userDisplayName === 'string' ? obj.userDisplayName.trim() : '';

  if (!rawId) {
    errors.push('El campo «id» de la membresía es obligatorio.');
  }
  if (!rawOrgId) {
    errors.push('El campo «organizationId» es obligatorio para vincular al tenant.');
  }
  if (!rawUserId) {
    errors.push('El campo «userId» es obligatorio.');
  }
  if (!rawEmail || !rawEmail.includes('@')) {
    errors.push('El correo del usuario no es válido.');
  }
  if (!rawDisplayName) {
    errors.push('El nombre para mostrar del usuario es obligatorio.');
  }

  const validRoles: UserRole[] = [
    'ADMIN',
    'BUSINESS_OFFICER',
    'CREDIT_ANALYST',
    'RISK_OFFICER',
    'COMMITTEE_MEMBER',
    'FORMALIZATION',
    'OPERATIONS',
    'FINANCE',
    'AUDITOR',
    'COLLECTION_AGENT',
    'SUPERVISOR',
    'COLLECTION_COORDINATOR',
    'CASHIER',
    'MANAGEMENT',
    'EXTERNAL_CLIENT',
  ];
  const role: UserRole =
    typeof obj.role === 'string' && validRoles.includes(obj.role as UserRole)
      ? (obj.role as UserRole)
      : 'BUSINESS_OFFICER';

  const validStatuses: Array<'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED' | 'INACTIVE'> = [
    'ACTIVE',
    'INVITED',
    'SUSPENDED',
    'REVOKED',
    'INACTIVE',
  ];
  const status =
    typeof obj.status === 'string' && validStatuses.includes(obj.status as never)
      ? (obj.status as 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED' | 'INACTIVE')
      : 'ACTIVE';

  const granularPermissions: GranularActionPermission[] = Array.isArray(obj.granularPermissions)
    ? (obj.granularPermissions as GranularActionPermission[])
    : DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE[role] || ['CONSULTAR'];

  const tenantId =
    typeof obj.tenantId === 'string' && obj.tenantId.trim()
      ? obj.tenantId.trim()
      : typeof obj.tenant_id === 'string' && obj.tenant_id.trim()
      ? obj.tenant_id.trim()
      : rawOrgId;

  const sanitized: OrganizationMembershipRecord = {
    id: rawId,
    organizationId: rawOrgId,
    tenantId,
    tenant_id: tenantId,
    organizationName: typeof obj.organizationName === 'string' ? obj.organizationName : '',
    userId: rawUserId,
    userEmail: rawEmail,
    userDisplayName: rawDisplayName,
    role,
    status,
    granularPermissions,
    allowedModuleCodes: Array.isArray(obj.allowedModuleCodes)
      ? (obj.allowedModuleCodes as AxyCoreModuleCode[])
      : undefined,
    isPrimaryAdmin: Boolean(obj.isPrimaryAdmin),
    invitedBy: typeof obj.invitedBy === 'string' ? obj.invitedBy : 'system',
    createdBy: typeof obj.createdBy === 'string' ? obj.createdBy : (obj.invitedBy as string) || 'system',
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : undefined,
  };
}

export function isOrganizationRecord(data: unknown): data is OrganizationRecord {
  return validateOrganizationSchema(data).isValid;
}

export function isOrganizationMembershipRecord(data: unknown): data is OrganizationMembershipRecord {
  return validateOrganizationMembershipSchema(data).isValid;
}

export function generateCorporateAccessCode(companyName: string, suffix?: string): string {
  const words = companyName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let prefix = '';
  if (words.length >= 2) {
    prefix = words.slice(0, 4).map((w) => w[0]).join('');
  } else if (words.length === 1) {
    prefix = words[0].slice(0, 4);
  }
  prefix = (prefix || 'AXYC').padEnd(3, 'X').slice(0, 4);
  const codeSuffix = (suffix || Math.random().toString(36).slice(2, 6))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
    .padStart(3, '0');
  return `${prefix}-${codeSuffix}`;
}

export function resolveOrganizationByCorporateCode(
  code: string,
  organizations: OrganizationRecord[]
): OrganizationRecord | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();

  return (
    organizations.find((org) => {
      const orgCode = (org.accessCode || '').trim().toUpperCase();
      const orgTenant = (org.tenantId || org.tenant_id || '').trim().toLowerCase();
      const orgId = (org.id || '').trim().toLowerCase();
      return (
        (orgCode && orgCode === normalized) ||
        (orgTenant && orgTenant === lower) ||
        orgId === lower
      );
    }) ?? null
  );
}

// Re-exportar TenantService transversalmente desde el engine
export {
  TenantService,
  tenantService,
  TENANT_SCOPED_COLLECTIONS,
  type TenantContext,
} from '../services/tenantService';
