import type {
  ApplicationDocumentRecord,
  BusinessRecord,
  CollectionAccountRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanRecord,
  ReconciliationExceptionRecord,
  RiskAlertRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';
import type { DgiiEcfDocumentRecord } from '../types/dgiiEcf';
import type { AlteraRecommendationRecord } from '../types/altera';
import {
  ALL_REGULA_ACTION_PERMISSIONS,
  type RegulaActionPermission,
  type RegulaActionPlanStatus,
  type RegulaAlertaRecord,
  type RegulaConfiguracionRecord,
  type RegulaControlEffectiveness,
  type RegulaControlRecord,
  type RegulaDashboardKpis,
  type RegulaEcosystemSignals,
  type RegulaFrequency,
  type RegulaIncidentType,
  type RegulaObligacionRecord,
  type RegulaPerfilRiesgoFactorScore,
  type RegulaPlanAccionRecord,
  type RegulaReportCode,
  type RegulaRiesgoRecord,
  type RegulaRiskCategory,
  type RegulaRiskLevel,
  type RegulaRoleDefinition,
  type RegulaSectionId,
  type RegulaSeverity,
  type RegulaWorkspaceData,
} from '../types/regula';

export const REGULA_SECTIONS: Array<{
  id: RegulaSectionId;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { id: 'dashboard', label: 'Dashboard Ejecutivo', shortLabel: 'Dashboard', description: 'Indicadores reales de cumplimiento, exposición de riesgo y alertas prioritarias.' },
  { id: 'cumplimiento', label: 'Cumplimiento Regulatorio', shortLabel: 'Cumplimiento', description: 'Radar regulatorio, biblioteca normativa, obligaciones, calendario y matriz de aplicabilidad.' },
  { id: 'plaftpadm', label: 'PLAFTPADM', shortLabel: 'PLAFTPADM', description: 'KYC vinculado a AxyCore, debida diligencia, beneficiarios finales, perfil de riesgo y casos.' },
  { id: 'riesgos', label: 'Gestión Integral de Riesgos', shortLabel: 'Riesgos', description: 'Matriz institucional de 14 categorías, evaluación inherente/residual y mapa de calor 5×5.' },
  { id: 'control_interno', label: 'Control Interno', shortLabel: 'Control Interno', description: 'Matriz de controles preventivos/detectivos/correctivos, pruebas y debilidades.' },
  { id: 'auditoria', label: 'Auditoría Interna', shortLabel: 'Auditoría', description: 'Plan anual, programas, ejecución, hallazgos Criterio/Condición/Causa/Efecto y seguimiento.' },
  { id: 'evidencias', label: 'Evidencias y Documentación', shortLabel: 'Evidencias', description: 'Centro de evidencias versionadas, políticas, manuales, vigencias y control de acceso.' },
  { id: 'incidentes', label: 'Incidentes y Eventos', shortLabel: 'Incidentes', description: 'Registro de 11 tipos de eventos, causa raíz, pérdidas financieras y lecciones aprendidas.' },
  { id: 'planes_accion', label: 'Planes de Acción', shortLabel: 'Planes de Acción', description: 'Acciones correctivas y preventivas con verificación de efectividad y aprobación de cierre.' },
  { id: 'cultura', label: 'Cultura de Cumplimiento', shortLabel: 'Cultura', description: 'Plan anual de capacitación, asistencia, evaluaciones, certificaciones y cobertura.' },
  { id: 'regula_ai', label: 'REGULA AI', shortLabel: 'REGULA AI', description: 'Asistente regulatorio, análisis normativo, brechas, revisión documental e informes supervisados.' },
  { id: 'reportes', label: 'Reportes e Indicadores', shortLabel: 'Reportes', description: 'Centro de 18 reportes institucionales y regulatorios exportables a PDF y Excel/CSV.' },
  { id: 'configuracion', label: 'Configuración del Módulo', shortLabel: 'Configuración', description: 'Catálogos, escalas, matrices de riesgo, roles granulares, escalamientos e integraciones.' },
];

export const REGULA_RISK_CATEGORY_LABELS: Record<RegulaRiskCategory, string> = {
  OPERACIONAL: 'Riesgo Operacional',
  CREDITICIO: 'Riesgo Crediticio',
  FINANCIERO: 'Riesgo Financiero',
  LIQUIDEZ: 'Riesgo de Liquidez',
  MERCADO: 'Riesgo de Mercado',
  TECNOLOGICO: 'Riesgo Tecnológico',
  CIBERSEGURIDAD: 'Ciberseguridad',
  LEGAL: 'Riesgo Legal',
  REGULATORIO: 'Riesgo Regulatorio',
  REPUTACIONAL: 'Riesgo Reputacional',
  ESTRATEGICO: 'Riesgo Estratégico',
  FRAUDE: 'Riesgo de Fraude',
  CONTINUIDAD: 'Continuidad de Negocio',
  TERCEROS: 'Riesgo de Terceros',
};

export const REGULA_INCIDENT_TYPE_LABELS: Record<RegulaIncidentType, string> = {
  FALLA_OPERATIVA: 'Falla operativa',
  INCUMPLIMIENTO_NORMATIVO: 'Incumplimiento normativo',
  FRAUDE_INTERNO: 'Fraude interno',
  FRAUDE_EXTERNO: 'Fraude externo',
  INCIDENTE_TECNOLOGICO: 'Incidente tecnológico',
  BRECHA_SEGURIDAD: 'Brecha de seguridad',
  FALLA_PROVEEDOR: 'Falla de proveedor',
  RECLAMO_CRITICO: 'Reclamo crítico',
  ERROR_FINANCIERO_CONTABLE: 'Error financiero o contable',
  EVENTO_PLAFT: 'Evento relacionado con PLAFTPADM',
  INTERRUPCION_SERVICIO: 'Interrupción de servicio',
};

export const REGULA_REPORT_CATALOG: Array<{
  code: RegulaReportCode;
  title: string;
  category: 'CUMPLIMIENTO' | 'RIESGOS' | 'PLAFTPADM' | 'AUDITORIA' | 'EJECUTIVO';
  description: string;
}> = [
  { code: 'CUMPLIMIENTO_GENERAL', title: '1. Reporte General de Cumplimiento', category: 'CUMPLIMIENTO', description: 'Estado consolidado de obligaciones normativas, porcentaje de cumplimiento y vencimientos.' },
  { code: 'OBLIGACIONES_VENCIDAS_PROXIMAS', title: '2. Obligaciones Vencidas y Próximas a Vencer', category: 'CUMPLIMIENTO', description: 'Detalle priorizado de obligaciones vencidas o exigibles en los próximos 30 días.' },
  { code: 'MATRIZ_APLICABILIDAD', title: '3. Matriz de Aplicabilidad Normativa', category: 'CUMPLIMIENTO', description: 'Normativas evaluadas por tipo de entidad, actividad, justificación y estado de aprobación.' },
  { code: 'MATRIZ_RIESGOS', title: '4. Matriz de Riesgos Institucionales', category: 'RIESGOS', description: 'Inventario de riesgos con calificación inherente, controles vinculados y riesgo residual.' },
  { code: 'MAPA_CALOR_RIESGOS', title: '5. Mapa de Calor de Riesgos (5×5)', category: 'RIESGOS', description: 'Distribución de riesgos por probabilidad e impacto inherente y residual.' },
  { code: 'CONTROLES_EFECTIVIDAD', title: '6. Controles Internos y Efectividad', category: 'RIESGOS', description: 'Resultados de pruebas de control, efectividad vigente y debilidades abiertas.' },
  { code: 'AUDITORIAS_HALLAZGOS', title: '7. Auditorías y Hallazgos', category: 'AUDITORIA', description: 'Plan de auditoría, avance, hallazgos (Criterio/Condición/Causa/Efecto) y estado.' },
  { code: 'PLANES_ACCION_ESTADO', title: '8. Planes de Acción por Estado y Responsable', category: 'CUMPLIMIENTO', description: 'Seguimiento de acciones correctivas/preventivas, avance, verificación y vencimientos.' },
  { code: 'INCIDENTES_PERDIDAS', title: '9. Incidentes y Pérdidas por Eventos de Riesgo', category: 'RIESGOS', description: 'Eventos reportados, causa raíz, pérdidas estimadas vs. reales y estado de resolución.' },
  { code: 'CUMPLIMIENTO_PLAFTPADM', title: '10. Cumplimiento PLAFTPADM (KYC, DD y UBO)', category: 'PLAFTPADM', description: 'Cobertura KYC, niveles de debida diligencia, beneficiarios finales y perfiles de riesgo.' },
  { code: 'ALERTAS_CASOS_INVESTIGACION', title: '11. Alertas y Casos en Investigación', category: 'PLAFTPADM', description: 'Casos PLAFTPADM y alertas regulatorias abiertas, responsables y decisiones documentadas.' },
  { code: 'DOCUMENTOS_VENCIDOS_PENDIENTES', title: '12. Documentos y Evidencias Vencidos o Pendientes', category: 'CUMPLIMIENTO', description: 'Políticas, manuales y evidencias próximas a vencer, vencidas o en aprobación.' },
  { code: 'CAPACITACION_COBERTURA', title: '13. Capacitación y Cobertura de Cultura', category: 'CUMPLIMIENTO', description: 'Plan anual de capacitación, asistencia, aprobados, certificaciones vigentes y cobertura %.' },
  { code: 'INFORME_EJECUTIVO_DIRECCION', title: '14. Informe Ejecutivo para Dirección General', category: 'EJECUTIVO', description: 'Síntesis integral de cumplimiento, exposición de riesgo, auditoría e incidentes.' },
  { code: 'INFORME_COMITE_RIESGOS', title: '15. Informe para Comité de Riesgos', category: 'EJECUTIVO', description: 'Riesgos críticos/altos, mapa de calor, pérdidas por incidentes y mitigación.' },
  { code: 'INFORME_COMITE_CUMPLIMIENTO', title: '16. Informe para Comité de Cumplimiento', category: 'EJECUTIVO', description: 'Avance regulatorio, obligaciones críticas, PLAFTPADM, casos y capacitación.' },
  { code: 'INFORME_COMITE_AUDITORIA', title: '17. Informe para Comité de Auditoría', category: 'EJECUTIVO', description: 'Ejecución del plan anual, hallazgos abiertos/vencidos, controles inefectivos y cierres.' },
  { code: 'TRAZABILIDAD_AUDITORIA_REGULA', title: '18. Reporte de Trazabilidad y Auditoría del Módulo', category: 'AUDITORIA', description: 'Bitácora inmutable de cambios, aprobaciones, descargas de evidencias y consultas IA.' },
];

function buildAllSectionsPerms(perms: RegulaActionPermission[]): Record<RegulaSectionId, RegulaActionPermission[]> {
  return REGULA_SECTIONS.reduce((acc, s) => {
    acc[s.id] = [...perms];
    return acc;
  }, {} as Record<RegulaSectionId, RegulaActionPermission[]>);
}

export function buildDefaultRegulaRoles(): RegulaRoleDefinition[] {
  const full = buildAllSectionsPerms(ALL_REGULA_ACTION_PERMISSIONS);
  const readOnly = buildAllSectionsPerms(['ver', 'exportar']);
  const execReadApprove = buildAllSectionsPerms(['ver', 'aprobar', 'rechazar', 'exportar', 'descargar']);

  const complianceOfficer = buildAllSectionsPerms([
    'ver', 'crear', 'editar', 'eliminar_anular', 'aprobar', 'rechazar', 'asignar', 'cerrar', 'exportar', 'descargar', 'configurar',
  ]);

  const complianceAnalyst = buildAllSectionsPerms(['ver', 'crear', 'editar', 'exportar', 'descargar']);
  complianceAnalyst.configuracion = ['ver'];

  const riskManager = buildAllSectionsPerms([
    'ver', 'crear', 'editar', 'aprobar', 'rechazar', 'asignar', 'cerrar', 'exportar', 'descargar',
  ]);
  riskManager.configuracion = ['ver', 'configurar'];

  const riskAnalyst = buildAllSectionsPerms(['ver', 'crear', 'editar', 'exportar', 'descargar']);
  riskAnalyst.configuracion = ['ver'];

  const internalAuditor = buildAllSectionsPerms(['ver', 'exportar', 'descargar']);
  internalAuditor.auditoria = ['ver', 'crear', 'editar', 'aprobar', 'rechazar', 'asignar', 'cerrar', 'exportar', 'descargar'];
  internalAuditor.control_interno = ['ver', 'crear', 'editar', 'exportar', 'descargar'];
  internalAuditor.planes_accion = ['ver', 'aprobar', 'rechazar', 'cerrar', 'exportar'];
  internalAuditor.evidencias = ['ver', 'crear', 'descargar', 'exportar'];
  internalAuditor.regula_ai = ['ver', 'crear', 'exportar'];

  const areaOwner = buildAllSectionsPerms(['ver']);
  areaOwner.cumplimiento = ['ver', 'editar'];
  areaOwner.evidencias = ['ver', 'crear', 'descargar'];
  areaOwner.incidentes = ['ver', 'crear', 'editar'];
  areaOwner.planes_accion = ['ver', 'editar'];
  areaOwner.cultura = ['ver'];

  return [
    { code: 'SUPER_ADMIN_REGULA', name: 'Super Administrador de REGULA', description: 'Control total de catálogos, matrices, roles, aprobaciones y auditoría del módulo.', isSystemRole: true, permissions: full },
    { code: 'ADMIN_INSTITUCIONAL', name: 'Administrador Institucional', description: 'Gobierno operativo, configuración de parámetros y administración de usuarios en REGULA.', isSystemRole: true, permissions: full },
    { code: 'OFICIAL_CUMPLIMIENTO', name: 'Oficial de Cumplimiento', description: 'Dirección del programa normativo, PLAFTPADM, aplicabilidad, alertas y cierre de acciones.', isSystemRole: true, permissions: complianceOfficer },
    { code: 'ANALISTA_CUMPLIMIENTO', name: 'Analista de Cumplimiento', description: 'Gestión operativa de obligaciones, KYC, debida diligencia, evidencias y capacitación.', isSystemRole: true, permissions: complianceAnalyst },
    { code: 'GERENTE_RIESGOS', name: 'Gerente de Riesgos', description: 'Gobierno de matriz de riesgos, mapa de calor, incidentes, controles y planes de mitigación.', isSystemRole: true, permissions: riskManager },
    { code: 'ANALISTA_RIESGOS', name: 'Analista de Riesgos', description: 'Registro y evaluación de riesgos, incidentes y pruebas de controles.', isSystemRole: true, permissions: riskAnalyst },
    { code: 'AUDITOR_INTERNO', name: 'Auditor Interno', description: 'Plan anual de auditoría, ejecución, hallazgos, verificación de efectividad y acceso de lectura transversal.', isSystemRole: true, permissions: internalAuditor },
    { code: 'AUDITOR_EXTERNO_LECTURA', name: 'Auditor Externo (Solo Lectura)', description: 'Inspección independiente de solo lectura y exportación autorizada sin capacidad de modificación.', isSystemRole: true, permissions: readOnly },
    { code: 'RESPONSABLE_AREA', name: 'Responsable de Área / Proceso', description: 'Atención de obligaciones asignadas, carga de evidencias, reporte de incidentes y avance de planes.', isSystemRole: true, permissions: areaOwner },
    { code: 'GERENCIA_GENERAL', name: 'Gerencia General / Dirección', description: 'Visión ejecutiva, aprobaciones de gobierno, cierre estratégico y reportes de dirección.', isSystemRole: true, permissions: execReadApprove },
    { code: 'CONSEJO_COMITE', name: 'Consejo / Comité', description: 'Supervisión de comités de Riesgos, Cumplimiento y Auditoría con facultad de aprobación.', isSystemRole: true, permissions: execReadApprove },
  ];
}

export function buildDefaultRegulaConfig(params: {
  organizationId: string;
  institutionName?: string;
  createdBy?: string;
}): RegulaConfiguracionRecord {
  return {
    id: `regula_cfg_${params.organizationId}`,
    organizationId: params.organizationId,
    createdBy: params.createdBy || 'system',
    institutionName: params.institutionName || 'Institución Financiera',
    entityType: 'Entidad de Financiamiento / Intermediación Financiera',
    economicActivity: 'Otorgamiento de préstamos personales y empresariales',
    jurisdiction: 'República Dominicana',
    primarySupervisor: 'Superintendencia de Bancos (SIB) / Ente Regulador Local',
    secondarySupervisors: ['DGII', 'UAF (Unidad de Análisis Financiero)', 'ProConsumidor'],
    branches: ['Oficina Principal', 'Sucursal Norte', 'Sucursal Este'],
    departments: [
      'Cumplimiento',
      'Riesgos',
      'Crédito y Originación',
      'Cobranzas',
      'Operaciones',
      'Finanzas y Contabilidad',
      'Tecnología y Seguridad',
      'Legal y Formalización',
      'Auditoría Interna',
      'Dirección General',
    ],
    regulatoryCategories: [
      'Regulación Financiera y Crediticia',
      'PLAFTPADM (Ley 155-17)',
      'Fiscal y Tributario (DGII / e-CF)',
      'Protección al Usuario Financiero',
      'Seguridad de la Información y Ciberseguridad',
      'Gobierno Corporativo y Control Interno',
      'Protección de Datos y Privacidad',
      'Laboral y Societario',
    ],
    obligationTypes: [
      'Reporte Regulatorio Periódico',
      'Política / Manual Obligatorio',
      'Control y Validación Interna',
      'Declaración Tributaria',
      'Debida Diligencia / Revisión KYC',
      'Capacitación Anual Obligatoria',
      'Auditoría o Revisión Independiente',
    ],
    frequencies: ['UNICA', 'DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'EVENTUAL'],
    criticalityLevels: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'],
    probabilityScale: [
      { level: 1, label: 'Raro', description: 'Puede ocurrir solo en circunstancias excepcionales (<5%).' },
      { level: 2, label: 'Improbable', description: 'Poca probabilidad en el año operativo (5%–20%).' },
      { level: 3, label: 'Posible', description: 'Podría ocurrir en algún momento del período (21%–50%).' },
      { level: 4, label: 'Probable', description: 'Es probable que ocurra más de una vez (51%–80%).' },
      { level: 5, label: 'Casi Seguro', description: 'Se espera que ocurra con alta recurrencia (>80%).' },
    ],
    impactScale: [
      { level: 1, label: 'Insignificante', description: 'Impacto financiero u operativo mínimo sin sanción.' },
      { level: 2, label: 'Menor', description: 'Desviación acotada o observación menor corregible.' },
      { level: 3, label: 'Moderado', description: 'Pérdida financiera moderada o requerimiento formal.' },
      { level: 4, label: 'Mayor', description: 'Sanción regulatoria relevante, interrupción o daño reputacional.' },
      { level: 5, label: 'Catastrófico', description: 'Multa severa, intervención regulatoria o pérdida crítica de capital.' },
    ],
    riskThresholds: [
      { level: 'BAJO', minScore: 1, maxScore: 4, colorHex: '#16A34A', actionRequired: 'Monitoreo rutinario y mantenimiento de controles.' },
      { level: 'MEDIO', minScore: 5, maxScore: 9, colorHex: '#D97706', actionRequired: 'Seguimiento periódico y fortalecimiento de controles.' },
      { level: 'ALTO', minScore: 10, maxScore: 15, colorHex: '#EA580C', actionRequired: 'Plan de mitigación obligatorio con seguimiento mensual.' },
      { level: 'CRITICO', minScore: 16, maxScore: 25, colorHex: '#DC2626', actionRequired: 'Escalamiento inmediato a Dirección/Comité y mitigación urgente.' },
    ],
    plaftFactorWeights: [
      { code: 'TIPO_CLIENTE', label: 'Tipo de cliente / estructura jurídica', weightPct: 15, description: 'Persona física asalariada vs. estructura societaria compleja.', enabled: true },
      { code: 'ACTIVIDAD_ECONOMICA', label: 'Actividad económica y manejo de efectivo', weightPct: 20, description: 'Exposición sectorial a lavado de activos o efectivo intensivo.', enabled: true },
      { code: 'PRODUCTO_SERVICIO', label: 'Productos y montos operados', weightPct: 15, description: 'Complejidad, moneda y volumen de productos financieros.', enabled: true },
      { code: 'CANAL_OPERACION', label: 'Canal de vinculación y operación', weightPct: 10, description: 'Presencial verificado vs. no presencial / terceros.', enabled: true },
      { code: 'ZONA_GEOGRAFICA', label: 'Zona geográfica y jurisdicción', weightPct: 15, description: 'Jurisdicción local vs. zonas de riesgo o transfronterizas.', enabled: true },
      { code: 'PEP_EXPOSICION', label: 'Condición PEP o vinculación política', weightPct: 15, description: 'Persona Expuesta Políticamente directa o vinculada.', enabled: true },
      { code: 'COMPORTAMIENTO_TRANSACCIONAL', label: 'Comportamiento transaccional y alertas', weightPct: 10, description: 'Coherencia con perfil declarado y alertas Centinela/PLAFT.', enabled: true },
    ],
    controlTypes: ['PREVENTIVO', 'DETECTIVO', 'CORRECTIVO'],
    auditTypes: ['Cumplimiento Regulatorio', 'PLAFTPADM', 'Crédito y Cartera', 'Operaciones y Tesorería', 'TI y Ciberseguridad', 'Contabilidad y Fiscal'],
    findingTypes: ['Incumplimiento Normativo', 'Debilidad de Control Interno', 'Deficiencia Documental', 'Brecha Tecnológica', 'Riesgo Operativo'],
    incidentTypes: Object.keys(REGULA_INCIDENT_TYPE_LABELS) as RegulaIncidentType[],
    escalationRules: [
      { id: 'esc_obl_15', triggerType: 'OBLIGACION_POR_VENCER', daysBeforeOrAfter: 15, severity: 'MEDIA', notifyRoles: ['OFICIAL_CUMPLIMIENTO', 'RESPONSABLE_AREA'], enabled: true },
      { id: 'esc_obl_overdue', triggerType: 'OBLIGACION_VENCIDA', daysBeforeOrAfter: 1, severity: 'CRITICA', notifyRoles: ['OFICIAL_CUMPLIMIENTO', 'GERENCIA_GENERAL'], escalateToRole: 'CONSEJO_COMITE', enabled: true },
      { id: 'esc_plan_overdue', triggerType: 'PLAN_ACCION_VENCIDO', daysBeforeOrAfter: 1, severity: 'ALTA', notifyRoles: ['OFICIAL_CUMPLIMIENTO', 'AUDITOR_INTERNO'], escalateToRole: 'GERENCIA_GENERAL', enabled: true },
      { id: 'esc_finding_crit', triggerType: 'HALLAZGO_CRITICO', daysBeforeOrAfter: 0, severity: 'CRITICA', notifyRoles: ['AUDITOR_INTERNO', 'GERENCIA_GENERAL', 'CONSEJO_COMITE'], enabled: true },
      { id: 'esc_inc_crit', triggerType: 'INCIDENTE_CRITICO', daysBeforeOrAfter: 0, severity: 'CRITICA', notifyRoles: ['GERENTE_RIESGOS', 'OFICIAL_CUMPLIMIENTO', 'GERENCIA_GENERAL'], enabled: true },
      { id: 'esc_kyc_exp', triggerType: 'KYC_DESACTUALIZADO', daysBeforeOrAfter: 30, severity: 'ALTA', notifyRoles: ['OFICIAL_CUMPLIMIENTO', 'ANALISTA_CUMPLIMIENTO'], enabled: true },
      { id: 'esc_ctrl_inef', triggerType: 'CONTROL_INEFECTIVO', daysBeforeOrAfter: 0, severity: 'ALTA', notifyRoles: ['GERENTE_RIESGOS', 'AUDITOR_INTERNO'], enabled: true },
    ],
    roles: buildDefaultRegulaRoles(),
    userRoleAssignments: {},
    aiEnabled: true,
    aiRequireHumanValidation: true,
    aiCiteSourcesStrict: true,
    aiAllowedSections: REGULA_SECTIONS.map((s) => s.id),
    reportTemplates: REGULA_REPORT_CATALOG.map((r) => ({
      code: r.code,
      title: r.title,
      headerNote: 'Documento emitido desde AxyCore REGULA — Trazabilidad y Gobierno Institucional.',
      includeSignatures: r.category === 'EJECUTIVO' || r.category === 'AUDITORIA',
    })),
    externalIntegrations: {
      regulatoryFeedsConfigured: false,
      regulatoryFeedsNote: 'La sincronización automática con portales externos (SIB, DGII, UAF, BCRD) requiere integración API/RSS autorizada y credenciales oficiales. Puede registrar normativas manualmente o analizarlas con REGULA AI.',
      emailSmtpConfigured: false,
      whatsappConfigured: false,
      sanctionsListsApiConfigured: false,
    },
  };
}

// ============================================================================
// Granular RBAC Permission Resolution
// ============================================================================
export function mapAxyCoreRoleToDefaultRegulaRole(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'SUPER_ADMIN_REGULA';
    case 'RISK_OFFICER':
      return 'OFICIAL_CUMPLIMIENTO';
    case 'AUDITOR':
      return 'AUDITOR_INTERNO';
    case 'MANAGEMENT':
      return 'GERENCIA_GENERAL';
    case 'COMMITTEE_MEMBER':
      return 'CONSEJO_COMITE';
    case 'FINANCE':
    case 'OPERATIONS':
    case 'COLLECTION_COORDINATOR':
    case 'SUPERVISOR':
      return 'GERENTE_RIESGOS';
    case 'CREDIT_ANALYST':
      return 'ANALISTA_RIESGOS';
    default:
      return 'RESPONSABLE_AREA';
  }
}

export function resolveUserRegulaRole(
  user: UserProfile | null | undefined,
  config: RegulaConfiguracionRecord | null | undefined
): RegulaRoleDefinition | null {
  if (!user || user.role === 'EXTERNAL_CLIENT') return null;
  const roles = config?.roles?.length ? config.roles : buildDefaultRegulaRoles();
  const assignedCode = config?.userRoleAssignments?.[user.uid];
  const fallbackCode = mapAxyCoreRoleToDefaultRegulaRole(user.role);
  return (
    roles.find((r) => r.code === assignedCode) ||
    roles.find((r) => r.code === fallbackCode) ||
    roles.find((r) => r.code === 'RESPONSABLE_AREA') ||
    null
  );
}

export function hasRegulaPermission(params: {
  user: UserProfile | null | undefined;
  config: RegulaConfiguracionRecord | null | undefined;
  section: RegulaSectionId;
  action: RegulaActionPermission;
}): boolean {
  if (!params.user || params.user.role === 'EXTERNAL_CLIENT') return false;
  if (params.user.role === 'ADMIN' || params.user.isSuperAdmin) return true;
  const roleDef = resolveUserRegulaRole(params.user, params.config);
  if (!roleDef) return false;
  const sectionPerms = roleDef.permissions?.[params.section] || [];
  return sectionPerms.includes(params.action);
}

// ============================================================================
// Risk Scoring, Residual Risk & 5x5 Heatmap Engine
// ============================================================================
export function classifyRiskLevel(
  score: number,
  thresholds?: RegulaConfiguracionRecord['riskThresholds']
): RegulaRiskLevel {
  const list = thresholds?.length
    ? thresholds
    : buildDefaultRegulaConfig({ organizationId: 'default' }).riskThresholds;
  for (const t of list) {
    if (score >= t.minScore && score <= t.maxScore) {
      return t.level;
    }
  }
  if (score >= 16) return 'CRITICO';
  if (score >= 10) return 'ALTO';
  if (score >= 5) return 'MEDIO';
  return 'BAJO';
}

export function computeRiskEvaluation(params: {
  inherentProbability: 1 | 2 | 3 | 4 | 5;
  inherentImpact: 1 | 2 | 3 | 4 | 5;
  linkedControls?: Array<{ effectiveness: RegulaControlEffectiveness }>;
  manualResidualProbability?: 1 | 2 | 3 | 4 | 5;
  manualResidualImpact?: 1 | 2 | 3 | 4 | 5;
  thresholds?: RegulaConfiguracionRecord['riskThresholds'];
}): {
  inherentScore: number;
  inherentLevel: RegulaRiskLevel;
  residualProbability: 1 | 2 | 3 | 4 | 5;
  residualImpact: 1 | 2 | 3 | 4 | 5;
  residualScore: number;
  residualLevel: RegulaRiskLevel;
  mitigationFactorPct: number;
} {
  const inherentScore = params.inherentProbability * params.inherentImpact;
  const inherentLevel = classifyRiskLevel(inherentScore, params.thresholds);

  let residualProbability = params.manualResidualProbability ?? params.inherentProbability;
  let residualImpact = params.manualResidualImpact ?? params.inherentImpact;
  let mitigationFactorPct = 0;

  if (
    params.manualResidualProbability === undefined &&
    params.manualResidualImpact === undefined &&
    params.linkedControls &&
    params.linkedControls.length > 0
  ) {
    const effectiveCount = params.linkedControls.filter((c) => c.effectiveness === 'EFECTIVO').length;
    const partialCount = params.linkedControls.filter((c) => c.effectiveness === 'PARCIALMENTE_EFECTIVO').length;

    if (effectiveCount >= 2) {
      mitigationFactorPct = 50;
      residualProbability = Math.max(1, params.inherentProbability - 2) as 1 | 2 | 3 | 4 | 5;
      residualImpact = Math.max(1, params.inherentImpact - 1) as 1 | 2 | 3 | 4 | 5;
    } else if (effectiveCount === 1) {
      mitigationFactorPct = 35;
      residualProbability = Math.max(1, params.inherentProbability - 1) as 1 | 2 | 3 | 4 | 5;
      residualImpact = Math.max(1, params.inherentImpact - 1) as 1 | 2 | 3 | 4 | 5;
    } else if (partialCount >= 1) {
      mitigationFactorPct = 15;
      residualProbability = Math.max(1, params.inherentProbability - 1) as 1 | 2 | 3 | 4 | 5;
    }
  } else {
    const manualScore = residualProbability * residualImpact;
    mitigationFactorPct =
      inherentScore > 0 ? Math.max(0, Math.round(((inherentScore - manualScore) / inherentScore) * 100)) : 0;
  }

  const residualScore = residualProbability * residualImpact;
  const residualLevel = classifyRiskLevel(residualScore, params.thresholds);

  return {
    inherentScore,
    inherentLevel,
    residualProbability,
    residualImpact,
    residualScore,
    residualLevel,
    mitigationFactorPct,
  };
}

export interface RegulaHeatmapCell {
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  score: number;
  level: RegulaRiskLevel;
  risks: RegulaRiesgoRecord[];
}

export function buildRiskHeatmap5x5(
  riesgos: RegulaRiesgoRecord[],
  mode: 'RESIDUAL' | 'INHERENTE' = 'RESIDUAL',
  thresholds?: RegulaConfiguracionRecord['riskThresholds']
): RegulaHeatmapCell[][] {
  const activeRisks = riesgos.filter((r) => !r.deletedAt && r.status !== 'CERRADO');
  const rows: RegulaHeatmapCell[][] = [];
  for (let prob = 5; prob >= 1; prob--) {
    const row: RegulaHeatmapCell[] = [];
    for (let imp = 1; imp <= 5; imp++) {
      const score = prob * imp;
      const cellRisks = activeRisks.filter((r) =>
        mode === 'RESIDUAL'
          ? r.residualProbability === prob && r.residualImpact === imp
          : r.inherentProbability === prob && r.inherentImpact === imp
      );
      row.push({
        probability: prob as 1 | 2 | 3 | 4 | 5,
        impact: imp as 1 | 2 | 3 | 4 | 5,
        score,
        level: classifyRiskLevel(score, thresholds),
        risks: cellRisks,
      });
    }
    rows.push(row);
  }
  return rows;
}

// ============================================================================
// PLAFTPADM Configurable Risk Profile Engine
// ============================================================================
export function evaluatePlaftRiskProfile(params: {
  factorInputs: Array<{ code: string; rawScore: 1 | 2 | 3 | 4 | 5; rationale?: string }>;
  isPep?: boolean;
  config?: RegulaConfiguracionRecord | null;
}): {
  factors: RegulaPerfilRiesgoFactorScore[];
  totalScore: number;
  riskLevel: RegulaRiskLevel;
  recommendedDdLevel: 'SIMPLIFICADA' | 'ESTANDAR' | 'AMPLIADA';
  explanation: string;
} {
  const weights = (
    params.config?.plaftFactorWeights?.length
      ? params.config.plaftFactorWeights
      : buildDefaultRegulaConfig({ organizationId: 'default' }).plaftFactorWeights
  ).filter((w) => w.enabled);

  const totalWeight = weights.reduce((acc, w) => acc + w.weightPct, 0) || 100;

  const factors: RegulaPerfilRiesgoFactorScore[] = weights.map((w) => {
    const input = params.factorInputs.find((i) => i.code === w.code);
    const rawScore = input?.rawScore ?? (w.code === 'PEP_EXPOSICION' && params.isPep ? 5 : 2);
    const normalizedWeight = (w.weightPct / totalWeight) * 100;
    const weightedContribution = Number((((rawScore / 5) * normalizedWeight)).toFixed(2));
    return {
      code: w.code,
      label: w.label,
      rawScore,
      weightPct: Number(normalizedWeight.toFixed(1)),
      weightedContribution,
      rationale: input?.rationale?.trim() || w.description,
    };
  });

  const rawTotal = Math.round(factors.reduce((acc, f) => acc + f.weightedContribution, 0));
  const totalScore = Math.min(100, Math.max(0, rawTotal));

  let riskLevel: RegulaRiskLevel;
  if (totalScore >= 80) riskLevel = 'CRITICO';
  else if (totalScore >= 60) riskLevel = 'ALTO';
  else if (totalScore >= 35) riskLevel = 'MEDIO';
  else riskLevel = 'BAJO';

  // PEP always elevates DD to AMPLIADA (Law 155-17 best practice)
  const recommendedDdLevel: 'SIMPLIFICADA' | 'ESTANDAR' | 'AMPLIADA' =
    params.isPep || riskLevel === 'ALTO' || riskLevel === 'CRITICO'
      ? 'AMPLIADA'
      : riskLevel === 'MEDIO'
      ? 'ESTANDAR'
      : 'SIMPLIFICADA';

  const topDrivers = [...factors]
    .sort((a, b) => b.weightedContribution - a.weightedContribution)
    .slice(0, 3)
    .map((f) => `${f.label} (${f.rawScore}/5 → ${f.weightedContribution} pts)`)
    .join('; ');

  const explanation = `Puntaje ponderado ${totalScore}/100 → Nivel ${riskLevel}. Debida Diligencia recomendada: ${recommendedDdLevel}.${
    params.isPep ? ' Cliente identificado como PEP (eleva requerimiento a Debida Diligencia Ampliada).' : ''
  } Principales factores: ${topDrivers}.`;

  return {
    factors,
    totalScore,
    riskLevel,
    recommendedDdLevel,
    explanation,
  };
}

// ============================================================================
// Governance State Machines (Action Plans & Obligations)
// ============================================================================
export function validateActionPlanUpdate(params: {
  existing: RegulaPlanAccionRecord;
  nextStatus: RegulaActionPlanStatus;
  nextProgressPct: number;
  effectivenessVerified?: boolean;
  canApproveClosure: boolean;
  reopenNotes?: string;
}): {
  allowed: boolean;
  effectiveStatus: RegulaActionPlanStatus;
  reason?: string;
} {
  const { existing, nextStatus, nextProgressPct, effectivenessVerified, canApproveClosure } = params;

  // CRITICAL RULE: Reaching 100% progress must NEVER auto-close; it transitions to PENDIENTE_VERIFICACION
  if (nextStatus === 'CERRADA') {
    const isVerified = effectivenessVerified ?? existing.effectivenessVerified;
    if (!isVerified) {
      return {
        allowed: false,
        effectiveStatus: 'PENDIENTE_VERIFICACION',
        reason: 'Un plan de acción no puede cerrarse sin verificación previa de efectividad documentada.',
      };
    }
    if (!canApproveClosure) {
      return {
        allowed: false,
        effectiveStatus: 'PENDIENTE_VERIFICACION',
        reason: 'Tu rol no tiene facultad para aprobar el cierre definitivo de un plan de acción.',
      };
    }
    return { allowed: true, effectiveStatus: 'CERRADA' };
  }

  if (nextStatus === 'REABIERTA' && existing.status === 'CERRADA') {
    if (!params.reopenNotes || params.reopenNotes.trim().length < 5) {
      return {
        allowed: false,
        effectiveStatus: existing.status,
        reason: 'Reabrir un plan cerrado requiere registrar una justificación auditable.',
      };
    }
    return { allowed: true, effectiveStatus: 'REABIERTA' };
  }

  // Automatic shift to PENDIENTE_VERIFICACION if progress reaches 100% and user didn't explicitly close
  if (
    nextProgressPct >= 100 &&
    !['PENDIENTE_VERIFICACION', 'EN_REVISION', 'IMPLEMENTADA', 'REABIERTA'].includes(nextStatus)
  ) {
    return {
      allowed: true,
      effectiveStatus: 'PENDIENTE_VERIFICACION',
    };
  }

  return { allowed: true, effectiveStatus: nextStatus };
}

export function validateNonApplicableObligation(params: {
  justification?: string;
  canApprove: boolean;
}): { allowed: boolean; reason?: string } {
  if (!params.justification || params.justification.trim().length < 15) {
    return {
      allowed: false,
      reason: 'Marcar una obligación como No Aplicable exige una justificación técnica documentada (mínimo 15 caracteres).',
    };
  }
  if (!params.canApprove) {
    return {
      allowed: false,
      reason: 'Marcar una obligación como No Aplicable requiere facultad de aprobación autorizada.',
    };
  }
  return { allowed: true };
}

export function computeNextDueDateByFrequency(dueDateIso: string, frequency: RegulaFrequency): string | undefined {
  if (!dueDateIso || frequency === 'UNICA' || frequency === 'EVENTUAL') return undefined;
  const d = new Date(`${dueDateIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  switch (frequency) {
    case 'DIARIA':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'SEMANAL':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'QUINCENAL':
      d.setUTCDate(d.getUTCDate() + 15);
      break;
    case 'MENSUAL':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'TRIMESTRAL':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'SEMESTRAL':
      d.setUTCMonth(d.getUTCMonth() + 6);
      break;
    case 'ANUAL':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ============================================================================
// Real KPI & Analytics Calculator (Zero Fake Numbers — Empty = null / 0)
// ============================================================================
export function computeRegulaDashboardKpis(
  data: RegulaWorkspaceData,
  todayIso: string
): RegulaDashboardKpis {
  const activeObl = data.obligaciones.filter((o) => !o.deletedAt);
  const applicableObl = activeObl.filter((o) => o.status !== 'NO_APLICABLE');
  const fulfilledObl = applicableObl.filter((o) => o.status === 'CUMPLIDA');
  const overdueObl = applicableObl.filter(
    (o) =>
      o.status === 'VENCIDA' ||
      (o.status !== 'CUMPLIDA' && Boolean(o.dueDate) && daysBetweenIso(todayIso, o.dueDate) < 0)
  );
  const upcomingObl = applicableObl.filter(
    (o) =>
      o.status !== 'CUMPLIDA' &&
      Boolean(o.dueDate) &&
      daysBetweenIso(todayIso, o.dueDate) >= 0 &&
      daysBetweenIso(todayIso, o.dueDate) <= 30
  );

  const generalComplianceIndexPct =
    applicableObl.length > 0
      ? Number(
          (
            applicableObl.reduce(
              (sum, o) => sum + (o.status === 'CUMPLIDA' ? 100 : Math.max(0, Math.min(100, o.compliancePct || 0))),
              0
            ) / applicableObl.length
          ).toFixed(1)
        )
      : null;

  const activeRisks = data.riesgos.filter((r) => !r.deletedAt && r.status !== 'CERRADO');
  const criticalRisks = activeRisks.filter((r) => r.residualLevel === 'CRITICO');
  const highRisks = activeRisks.filter((r) => r.residualLevel === 'ALTO');

  const activeControls = data.controles.filter((c) => !c.deletedAt && c.status !== 'INACTIVO');
  const evaluatedControls = activeControls.filter((c) => c.effectiveness !== 'NO_EVALUADO');
  const controlEffectivenessPct =
    evaluatedControls.length > 0
      ? Number(
          (
            evaluatedControls.reduce((sum, c) => {
              if (c.effectiveness === 'EFECTIVO') return sum + 100;
              if (c.effectiveness === 'PARCIALMENTE_EFECTIVO') return sum + 50;
              return sum;
            }, 0) / evaluatedControls.length
          ).toFixed(1)
        )
      : null;

  const activeFindings = data.hallazgos.filter((h) => !h.deletedAt && h.status !== 'CERRADO');
  const criticalFindings = activeFindings.filter((h) => h.severity === 'CRITICA');

  const activePlans = data.planesAccion.filter((p) => !p.deletedAt && p.status !== 'CERRADA');
  const overduePlans = activePlans.filter(
    (p) => p.status === 'VENCIDA' || (Boolean(p.dueDate) && daysBetweenIso(todayIso, p.dueDate) < 0)
  );

  const openIncidents = data.incidentes.filter((i) => !i.deletedAt && i.status !== 'CERRADO');
  const plaftActiveAlerts = data.casosPlaft.filter(
    (c) => !c.deletedAt && !['CERRADO', 'DESCARTADO_JUSTIFICADO'].includes(c.status)
  );

  const expiredOrPendingDocs =
    data.documentos.filter(
      (d) =>
        !d.deletedAt &&
        (d.status === 'PENDIENTE_ACTUALIZACION' ||
          d.status === 'PENDIENTE_APROBACION' ||
          (Boolean(d.expiryDate) && daysBetweenIso(todayIso, d.expiryDate!) < 0))
    ).length +
    data.evidencias.filter(
      (e) =>
        !e.deletedAt &&
        (e.status === 'VENCIDA' ||
          (Boolean(e.validUntil) && daysBetweenIso(todayIso, e.validUntil!) < 0))
    ).length;

  const activeTrainings = data.capacitaciones.filter((c) => !c.deletedAt && c.status !== 'CANCELADA');
  const totalTargetAudience = activeTrainings.reduce((s, t) => s + (t.targetAudienceCount || 0), 0);
  const completedParticipants = data.participantes.filter(
    (p) => !p.deletedAt && p.attendanceStatus === 'ASISTIO'
  ).length;
  const trainingCoveragePct =
    totalTargetAudience > 0
      ? Number(Math.min(100, (completedParticipants / totalTargetAudience) * 100).toFixed(1))
      : null;

  const institutionalRiskExposureScore =
    activeRisks.length > 0
      ? Number(
          Math.min(
            100,
            (activeRisks.reduce((sum, r) => sum + r.residualScore, 0) / (activeRisks.length * 25)) * 100
          ).toFixed(1)
        )
      : null;

  const hasAnyData =
    activeObl.length > 0 ||
    activeRisks.length > 0 ||
    activeControls.length > 0 ||
    data.auditorias.filter((a) => !a.deletedAt).length > 0 ||
    data.hallazgos.filter((h) => !h.deletedAt).length > 0 ||
    data.planesAccion.filter((p) => !p.deletedAt).length > 0 ||
    data.incidentes.filter((i) => !i.deletedAt).length > 0 ||
    data.kyc.filter((k) => !k.deletedAt).length > 0 ||
    data.documentos.filter((d) => !d.deletedAt).length > 0 ||
    data.evidencias.filter((e) => !e.deletedAt).length > 0 ||
    activeTrainings.length > 0;

  return {
    hasAnyData,
    generalComplianceIndexPct,
    applicableObligationsCount: applicableObl.length,
    fulfilledObligationsCount: fulfilledObl.length,
    upcomingObligationsCount: upcomingObl.length,
    overdueObligationsCount: overdueObl.length,
    activeRisksCount: activeRisks.length,
    criticalRisksCount: criticalRisks.length,
    highRisksCount: highRisks.length,
    evaluatedControlsCount: evaluatedControls.length,
    controlEffectivenessPct,
    openFindingsCount: activeFindings.length,
    criticalFindingsCount: criticalFindings.length,
    activeActionPlansCount: activePlans.length,
    overdueActionPlansCount: overduePlans.length,
    openIncidentsCount: openIncidents.length,
    plaftActiveAlertsCount: plaftActiveAlerts.length,
    expiredOrPendingDocumentsCount: expiredOrPendingDocs,
    trainingCoveragePct,
    institutionalRiskExposureScore,
  };
}

// ============================================================================
// Dashboard Chart Builders (100% Real Data — Zero Fabricated Series)
// ============================================================================
export function buildRegulaDashboardCharts(data: RegulaWorkspaceData, todayIso: string) {
  const activeObl = data.obligaciones.filter((o) => !o.deletedAt);
  const activeRisks = data.riesgos.filter((r) => !r.deletedAt && r.status !== 'CERRADO');
  const activeFindings = data.hallazgos.filter((h) => !h.deletedAt);
  const activePlans = data.planesAccion.filter((p) => !p.deletedAt);
  const activeIncidents = data.incidentes.filter((i) => !i.deletedAt);

  // 1. Risk distribution by level
  const riskByLevel = (['CRITICO', 'ALTO', 'MEDIO', 'BAJO'] as RegulaRiskLevel[]).map((level) => ({
    name: level,
    value: activeRisks.filter((r) => r.residualLevel === level).length,
  }));

  // 2. Compliance by department
  const deptMap = new Map<string, { total: number; scoreSum: number }>();
  for (const o of activeObl.filter((x) => x.status !== 'NO_APLICABLE')) {
    const dept = o.department || 'Sin asignar';
    const cur = deptMap.get(dept) || { total: 0, scoreSum: 0 };
    cur.total += 1;
    cur.scoreSum += o.status === 'CUMPLIDA' ? 100 : o.compliancePct || 0;
    deptMap.set(dept, cur);
  }
  const complianceByArea = Array.from(deptMap.entries()).map(([area, v]) => ({
    area,
    cumplimientoPct: Math.round(v.scoreSum / v.total),
    obligaciones: v.total,
  }));

  // 3. Obligations by status
  const oblStatuses = ['CUMPLIDA', 'EN_PROGRESO', 'PENDIENTE', 'PARCIAL', 'EN_REVISION', 'VENCIDA', 'NO_APLICABLE'] as const;
  const obligationsByStatus = oblStatuses
    .map((status) => ({
      status,
      cantidad: activeObl.filter((o) => o.status === status).length,
    }))
    .filter((item) => item.cantidad > 0);

  // 4. Findings by severity
  const findingsBySeverity = (['CRITICA', 'ALTA', 'MEDIA', 'BAJA'] as RegulaSeverity[]).map((sev) => ({
    severidad: sev,
    abiertos: activeFindings.filter((h) => h.severity === sev && h.status !== 'CERRADO').length,
    cerrados: activeFindings.filter((h) => h.severity === sev && h.status === 'CERRADO').length,
  }));

  // 5. Action plans by status
  const planStatuses: RegulaActionPlanStatus[] = [
    'PENDIENTE',
    'EN_PROCESO',
    'EN_REVISION',
    'IMPLEMENTADA',
    'PENDIENTE_VERIFICACION',
    'CERRADA',
    'VENCIDA',
    'REABIERTA',
  ];
  const actionPlansByStatus = planStatuses
    .map((status) => ({
      status,
      cantidad: activePlans.filter((p) => p.status === status).length,
    }))
    .filter((item) => item.cantidad > 0);

  // 6. Compliance evolution by month (derived strictly from obligation dueDate months)
  const monthMap = new Map<string, { total: number; sum: number }>();
  for (const o of activeObl.filter((x) => x.status !== 'NO_APLICABLE' && x.dueDate)) {
    const ym = o.dueDate.slice(0, 7);
    const cur = monthMap.get(ym) || { total: 0, sum: 0 };
    cur.total += 1;
    cur.sum += o.status === 'CUMPLIDA' ? 100 : o.compliancePct || 0;
    monthMap.set(ym, cur);
  }
  const complianceEvolution = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([mes, v]) => ({
      mes,
      cumplimientoPct: Math.round(v.sum / v.total),
      obligaciones: v.total,
    }));

  // 7. Incidents trend by month
  const incMap = new Map<string, { count: number; loss: number }>();
  for (const inc of activeIncidents) {
    const ym = (inc.occurredAt || todayIso).slice(0, 7);
    const cur = incMap.get(ym) || { count: 0, loss: 0 };
    cur.count += 1;
    cur.loss += inc.actualLossAmount || inc.estimatedLossAmount || 0;
    incMap.set(ym, cur);
  }
  const incidentsTrend = Array.from(incMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([mes, v]) => ({
      mes,
      incidentes: v.count,
      perdida: v.loss,
    }));

  // 8. Upcoming deadlines across obligations, plans, audits, KYC
  const upcomingDeadlines = [
    ...activeObl
      .filter((o) => o.status !== 'CUMPLIDA' && o.status !== 'NO_APLICABLE' && o.dueDate)
      .map((o) => ({
        id: o.id,
        code: o.code,
        title: o.title,
        dueDate: o.dueDate,
        daysLeft: daysBetweenIso(todayIso, o.dueDate),
        type: 'Obligación',
        owner: o.responsibleName,
        section: 'cumplimiento' as RegulaSectionId,
      })),
    ...activePlans
      .filter((p) => p.status !== 'CERRADA' && p.dueDate)
      .map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        dueDate: p.dueDate,
        daysLeft: daysBetweenIso(todayIso, p.dueDate),
        type: 'Plan de Acción',
        owner: p.responsibleName,
        section: 'planes_accion' as RegulaSectionId,
      })),
    ...activeFindings
      .filter((h) => h.status !== 'CERRADO' && h.dueDate)
      .map((h) => ({
        id: h.id,
        code: h.code,
        title: h.title,
        dueDate: h.dueDate,
        daysLeft: daysBetweenIso(todayIso, h.dueDate),
        type: 'Hallazgo',
        owner: h.responsibleName,
        section: 'auditoria' as RegulaSectionId,
      })),
  ]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 12);

  return {
    riskByLevel,
    complianceByArea,
    obligationsByStatus,
    findingsBySeverity,
    actionPlansByStatus,
    complianceEvolution,
    incidentsTrend,
    upcomingDeadlines,
  };
}

// ============================================================================
// Deduplicated Automatic Alert & Escalation Engine
// ============================================================================
export interface DerivedRegulaPriorityAlert {
  dedupKey: string;
  alertType: RegulaAlertaRecord['alertType'];
  severity: RegulaSeverity;
  title: string;
  description: string;
  targetSection: RegulaSectionId;
  relatedEntityType: string;
  relatedEntityId: string;
  dueDate?: string;
  escalated: boolean;
}

export function deriveRegulaPriorityAlerts(
  data: RegulaWorkspaceData,
  todayIso: string
): DerivedRegulaPriorityAlert[] {
  const seen = new Set<string>();
  const alerts: DerivedRegulaPriorityAlert[] = [];

  const pushUnique = (item: DerivedRegulaPriorityAlert) => {
    if (seen.has(item.dedupKey)) return;
    seen.add(item.dedupKey);
    alerts.push(item);
  };

  for (const obl of data.obligaciones.filter((o) => !o.deletedAt && o.status !== 'CUMPLIDA' && o.status !== 'NO_APLICABLE')) {
    const diff = obl.dueDate ? daysBetweenIso(todayIso, obl.dueDate) : 999;
    if (diff < 0 || obl.status === 'VENCIDA') {
      pushUnique({
        dedupKey: `obl_overdue_${obl.id}`,
        alertType: 'OBLIGACION_VENCIDA',
        severity: 'CRITICA',
        title: `Obligación vencida: ${obl.code} · ${obl.title}`,
        description: `Venció el ${obl.dueDate} (${Math.abs(diff)} días de retraso). Responsable: ${obl.responsibleName}.`,
        targetSection: 'cumplimiento',
        relatedEntityType: 'regula_obligaciones',
        relatedEntityId: obl.id,
        dueDate: obl.dueDate,
        escalated: true,
      });
    } else if (diff <= 15) {
      pushUnique({
        dedupKey: `obl_due_${obl.id}`,
        alertType: 'OBLIGACION_POR_VENCER',
        severity: diff <= 5 ? 'ALTA' : 'MEDIA',
        title: `Obligación próxima a vencer (${diff}d): ${obl.code}`,
        description: `${obl.title} vence el ${obl.dueDate}. Responsable: ${obl.responsibleName}.`,
        targetSection: 'cumplimiento',
        relatedEntityType: 'regula_obligaciones',
        relatedEntityId: obl.id,
        dueDate: obl.dueDate,
        escalated: false,
      });
    }
    if (obl.requiredEvidenceDesc && (!obl.linkedEvidenceIds || obl.linkedEvidenceIds.length === 0)) {
      pushUnique({
        dedupKey: `obl_no_ev_${obl.id}`,
        alertType: 'EVIDENCIA_FALTANTE',
        severity: obl.criticality === 'CRITICA' ? 'ALTA' : 'MEDIA',
        title: `Evidencia faltante en obligación ${obl.code}`,
        description: `Requiere respaldo: ${obl.requiredEvidenceDesc}`,
        targetSection: 'evidencias',
        relatedEntityType: 'regula_obligaciones',
        relatedEntityId: obl.id,
        dueDate: obl.dueDate,
        escalated: false,
      });
    }
  }

  for (const ctrl of data.controles.filter((c) => !c.deletedAt && c.effectiveness === 'INEFECTIVO')) {
    pushUnique({
      dedupKey: `ctrl_inef_${ctrl.id}`,
      alertType: 'CONTROL_INEFECTIVO',
      severity: 'ALTA',
      title: `Control inefectivo: ${ctrl.code} · ${ctrl.name}`,
      description: `Área ${ctrl.department}. Requiere plan de acción correctivo y re-prueba.`,
      targetSection: 'control_interno',
      relatedEntityType: 'regula_controles',
      relatedEntityId: ctrl.id,
      escalated: true,
    });
  }

  for (const risk of data.riesgos.filter((r) => !r.deletedAt && r.status !== 'CERRADO' && r.residualLevel === 'CRITICO')) {
    if (!risk.linkedActionPlanIds || risk.linkedActionPlanIds.length === 0) {
      pushUnique({
        dedupKey: `risk_crit_nomit_${risk.id}`,
        alertType: 'RIESGO_CRITICO_SIN_MITIGACION',
        severity: 'CRITICA',
        title: `Riesgo crítico sin plan de mitigación: ${risk.code}`,
        description: `${risk.name} (puntaje residual ${risk.residualScore}/25).`,
        targetSection: 'riesgos',
        relatedEntityType: 'regula_matriz_riesgos',
        relatedEntityId: risk.id,
        escalated: true,
      });
    }
  }

  for (const h of data.hallazgos.filter((x) => !x.deletedAt && x.status !== 'CERRADO')) {
    const diff = h.dueDate ? daysBetweenIso(todayIso, h.dueDate) : 999;
    if (diff < 0 || h.severity === 'CRITICA') {
      pushUnique({
        dedupKey: `hallazgo_${h.id}`,
        alertType: 'HALLAZGO_VENCIDO',
        severity: h.severity === 'CRITICA' || diff < 0 ? 'CRITICA' : 'ALTA',
        title: `${diff < 0 ? 'Hallazgo vencido' : 'Hallazgo crítico abierto'}: ${h.code}`,
        description: `${h.title} · Área: ${h.auditedArea} · Vence: ${h.dueDate}.`,
        targetSection: 'auditoria',
        relatedEntityType: 'regula_hallazgos',
        relatedEntityId: h.id,
        dueDate: h.dueDate,
        escalated: true,
      });
    }
  }

  for (const p of data.planesAccion.filter((x) => !x.deletedAt && x.status !== 'CERRADA')) {
    const diff = p.dueDate ? daysBetweenIso(todayIso, p.dueDate) : 999;
    if (diff < 0 || p.status === 'VENCIDA') {
      pushUnique({
        dedupKey: `plan_overdue_${p.id}`,
        alertType: 'PLAN_ACCION_VENCIDO',
        severity: 'ALTA',
        title: `Plan de acción vencido: ${p.code} · ${p.title}`,
        description: `Venció el ${p.dueDate} (${p.progressPct}% avance). Responsable: ${p.responsibleName}.`,
        targetSection: 'planes_accion',
        relatedEntityType: 'regula_planes_accion',
        relatedEntityId: p.id,
        dueDate: p.dueDate,
        escalated: true,
      });
    }
  }

  for (const inc of data.incidentes.filter((x) => !x.deletedAt && x.status !== 'CERRADO' && x.severity === 'CRITICA')) {
    pushUnique({
      dedupKey: `inc_crit_${inc.id}`,
      alertType: 'INCIDENTE_CRITICO',
      severity: 'CRITICA',
      title: `Incidente crítico abierto: ${inc.code} · ${inc.title}`,
      description: `Tipo: ${REGULA_INCIDENT_TYPE_LABELS[inc.incidentType]} · Área: ${inc.department}.`,
      targetSection: 'incidentes',
      relatedEntityType: 'regula_incidentes',
      relatedEntityId: inc.id,
      escalated: true,
    });
  }

  for (const doc of data.documentos.filter((d) => !d.deletedAt && d.expiryDate && daysBetweenIso(todayIso, d.expiryDate) <= 15)) {
    const diff = daysBetweenIso(todayIso, doc.expiryDate!);
    pushUnique({
      dedupKey: `doc_exp_${doc.id}`,
      alertType: 'DOCUMENTO_VENCIDO',
      severity: diff < 0 ? 'ALTA' : 'MEDIA',
      title: `${diff < 0 ? 'Documento vencido' : 'Documento por vencer'}: ${doc.code}`,
      description: `${doc.title} (v${doc.version}) · Vigencia: ${doc.expiryDate}.`,
      targetSection: 'evidencias',
      relatedEntityType: 'regula_documentos',
      relatedEntityId: doc.id,
      dueDate: doc.expiryDate,
      escalated: diff < 0,
    });
  }

  for (const kyc of data.kyc.filter((k) => !k.deletedAt)) {
    const diff = kyc.nextReviewDate ? daysBetweenIso(todayIso, kyc.nextReviewDate) : 999;
    if (kyc.kycStatus === 'DESACTUALIZADO' || diff < 0) {
      pushUnique({
        dedupKey: `kyc_exp_${kyc.id}`,
        alertType: 'KYC_DESACTUALIZADO',
        severity: kyc.isPep ? 'CRITICA' : 'ALTA',
        title: `KYC desactualizado: ${kyc.clientName}`,
        description: `Revisión programada: ${kyc.nextReviewDate}${kyc.isPep ? ' · Cliente PEP' : ''}.`,
        targetSection: 'plaftpadm',
        relatedEntityType: 'regula_kyc',
        relatedEntityId: kyc.id,
        dueDate: kyc.nextReviewDate,
        escalated: kyc.isPep,
      });
    }
  }

  const sevRank: Record<RegulaSeverity, number> = { CRITICA: 4, ALTA: 3, MEDIA: 2, BAJA: 1 };
  return alerts.sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
}

// ============================================================================
// Read-Only Ecosystem Integration Aggregator (Zero Mutations to Other Modules)
// ============================================================================
export function computeRegulaEcosystemSignals(params: {
  riskAlerts: RiskAlertRecord[];
  alteraRecommendations: AlteraRecommendationRecord[];
  collectionAccounts: CollectionAccountRecord[];
  creditPolicies: CreditPolicyRecord[];
  loans: LoanRecord[];
  reconciliationExceptions: ReconciliationExceptionRecord[];
  dgiiEcfDocuments: DgiiEcfDocumentRecord[];
  documents: ApplicationDocumentRecord[];
  customers: CustomerRecord[];
  businesses: BusinessRecord[];
  regulaKyc: RegulaWorkspaceData['kyc'];
}): RegulaEcosystemSignals {
  const activeCentinela = params.riskAlerts.filter((a) => a.status === 'ACTIVA');
  const criticalCentinela = activeCentinela.filter((a) => a.severity === 'ALTA' || a.severity === 'CRITICA');
  const alteraHigh = params.alteraRecommendations.filter(
    (r) =>
      ['GENERADA', 'PENDIENTE_REVISION'].includes(r.status) &&
      (r.priority === 'ALTA' || r.priority === 'CRITICA')
  );
  const severeDelinquency = params.collectionAccounts.filter((c) => c.dpd >= 60);
  const activePolicy = params.creditPolicies.find((p) => p.status === 'ACTIVA');
  const highDpdLoans = params.collectionAccounts.filter((c) => c.dpd >= 30);
  const openRecon = params.reconciliationExceptions.filter((e) => e.status === 'ABIERTA');
  const ecfIssues = params.dgiiEcfDocuments.filter((d) =>
    ['RECHAZADA', 'ERROR_COMUNICACION', 'PENDIENTE_RESPUESTA'].includes(d.status)
  );
  const pendingDocs = params.documents.filter(
    (d) => d.reviewStatus === 'PENDIENTE' || d.reviewStatus === 'OBSERVADO'
  );

  const kycCustomerIds = new Set(
    params.regulaKyc.filter((k) => !k.deletedAt && k.customerId).map((k) => k.customerId!)
  );
  const customersWithRegulaKyc = params.customers.filter((c) => kycCustomerIds.has(c.id)).length;
  const customersMissingRegulaKyc = Math.max(0, params.customers.length - customersWithRegulaKyc);

  const proposedAlerts: RegulaEcosystemSignals['proposedAlerts'] = [];

  if (criticalCentinela.length > 0) {
    proposedAlerts.push({
      key: 'eco_centinela',
      sourceModule: 'Centinela',
      severity: 'ALTA',
      title: `${criticalCentinela.length} alerta(s) crítica(s) activas en Centinela`,
      detail: 'Evaluar escalamiento a Gestión de Riesgos o apertura de caso PLAFTPADM (sin alterar Centinela).',
      targetSection: 'plaftpadm',
    });
  }
  if (openRecon.length > 0) {
    proposedAlerts.push({
      key: 'eco_recon',
      sourceModule: 'Contabilidad y Conciliación',
      severity: 'MEDIA',
      title: `${openRecon.length} excepción(es) bancaria(s) abierta(s)`,
      detail: 'Revisar posible debilidad de control interno o evento de riesgo financiero/operacional.',
      targetSection: 'control_interno',
    });
  }
  if (ecfIssues.length > 0) {
    proposedAlerts.push({
      key: 'eco_ecf',
      sourceModule: 'DGII e-CF',
      severity: 'ALTA',
      title: `${ecfIssues.length} comprobante(s) e-CF con rechazo o error`,
      detail: 'Monitorear impacto en cumplimiento tributario DGII (Ley 32-23).',
      targetSection: 'cumplimiento',
    });
  }
  if (severeDelinquency.length > 0) {
    proposedAlerts.push({
      key: 'eco_mora60',
      sourceModule: 'Anticípate / Cobranzas',
      severity: 'ALTA',
      title: `${severeDelinquency.length} cuenta(s) con ≥60 días de atraso`,
      detail: 'Actualizar evaluación de Riesgo Crediticio y concentración en Matriz de Riesgos.',
      targetSection: 'riesgos',
    });
  }
  if (customersMissingRegulaKyc > 0) {
    proposedAlerts.push({
      key: 'eco_kyc_gap',
      sourceModule: 'Cliente 360',
      severity: 'MEDIA',
      title: `${customersMissingRegulaKyc} cliente(s) maestro sin ficha KYC en REGULA`,
      detail: 'Vincular clientes existentes de AxyCore a expedientes KYC/Debida Diligencia sin duplicar datos maestros.',
      targetSection: 'plaftpadm',
    });
  }

  return {
    centinelaActiveAlerts: activeCentinela.length,
    centinelaCriticalAlerts: criticalCentinela.length,
    alteraHighRiskRecommendations: alteraHigh.length,
    anticipateSevereDelinquencyLoans: severeDelinquency.length,
    creditPoliciesActiveVersion: activePolicy?.version || 'Sin política activa',
    loansWithHighDpdCount: highDpdLoans.length,
    openReconciliationExceptions: openRecon.length,
    ecfPendingOrErrorCount: ecfIssues.length,
    pendingCreditDocumentsCount: pendingDocs.length,
    totalCustomersMaster: params.customers.length,
    totalBusinessesMaster: params.businesses.length,
    customersWithRegulaKyc,
    customersMissingRegulaKyc,
    proposedAlerts,
  };
}
