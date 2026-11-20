// ============================================================================
// AxyCore REGULA — Inteligencia Regulatoria, Cumplimiento y Gestión Integral de Riesgos
// Complete TypeScript Domain Model covering all 32 persisted entities,
// 13 internal navigation sections, granular RBAC permissions, and analytics.
// ============================================================================

export type RegulaSectionId =
  | 'dashboard'
  | 'cumplimiento'
  | 'plaftpadm'
  | 'riesgos'
  | 'control_interno'
  | 'auditoria'
  | 'evidencias'
  | 'incidentes'
  | 'planes_accion'
  | 'cultura'
  | 'regula_ai'
  | 'reportes'
  | 'configuracion';

export const REGULA_COLLECTION_NAMES = [
  'regula_configuracion',
  'regula_normativas',
  'regula_normativa_versiones',
  'regula_obligaciones',
  'regula_aplicabilidad',
  'regula_calendario',
  'regula_responsables',
  'regula_kyc',
  'regula_debida_diligencia',
  'regula_beneficiarios_finales',
  'regula_perfiles_riesgo',
  'regula_casos_plaft',
  'regula_matriz_riesgos',
  'regula_evaluaciones_riesgo',
  'regula_controles',
  'regula_pruebas_control',
  'regula_auditorias',
  'regula_programas_auditoria',
  'regula_hallazgos',
  'regula_evidencias',
  'regula_documentos',
  'regula_incidentes',
  'regula_planes_accion',
  'regula_actividades',
  'regula_capacitaciones',
  'regula_participantes',
  'regula_evaluaciones_capacitacion',
  'regula_alertas',
  'regula_notificaciones',
  'regula_aprobaciones',
  'regula_historial',
  'regula_ai_consultas',
] as const;

export type RegulaCollectionName = (typeof REGULA_COLLECTION_NAMES)[number];

export type RegulaActionPermission =
  | 'ver'
  | 'crear'
  | 'editar'
  | 'eliminar_anular'
  | 'aprobar'
  | 'rechazar'
  | 'asignar'
  | 'cerrar'
  | 'exportar'
  | 'descargar'
  | 'configurar';

export const ALL_REGULA_ACTION_PERMISSIONS: RegulaActionPermission[] = [
  'ver',
  'crear',
  'editar',
  'eliminar_anular',
  'aprobar',
  'rechazar',
  'asignar',
  'cerrar',
  'exportar',
  'descargar',
  'configurar',
];

export const REGULA_ACTION_LABELS: Record<RegulaActionPermission, string> = {
  ver: 'Ver',
  crear: 'Crear',
  editar: 'Editar',
  eliminar_anular: 'Anular / Archivar',
  aprobar: 'Aprobar',
  rechazar: 'Rechazar',
  asignar: 'Asignar',
  cerrar: 'Cerrar',
  exportar: 'Exportar',
  descargar: 'Descargar',
  configurar: 'Configurar',
};

export type RegulaRoleCode =
  | 'SUPER_ADMIN_REGULA'
  | 'ADMIN_INSTITUCIONAL'
  | 'OFICIAL_CUMPLIMIENTO'
  | 'ANALISTA_CUMPLIMIENTO'
  | 'GERENTE_RIESGOS'
  | 'ANALISTA_RIESGOS'
  | 'AUDITOR_INTERNO'
  | 'AUDITOR_EXTERNO_LECTURA'
  | 'RESPONSABLE_AREA'
  | 'GERENCIA_GENERAL'
  | 'CONSEJO_COMITE';

export interface RegulaRoleDefinition {
  code: string;
  name: string;
  description: string;
  isSystemRole?: boolean;
  permissions: Record<RegulaSectionId, RegulaActionPermission[]>;
}

export interface RegulaBaseRecord {
  id: string;
  organizationId: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
}

// ----------------------------------------------------------------------------
// 1. regula_configuracion
// ----------------------------------------------------------------------------
export interface RegulaRiskScaleLevel {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  description: string;
}

export interface RegulaRiskZoneThreshold {
  level: RegulaRiskLevel;
  minScore: number;
  maxScore: number;
  colorHex: string;
  actionRequired: string;
}

export interface RegulaPlaftFactorWeight {
  code: string;
  label: string;
  weightPct: number;
  description: string;
  enabled: boolean;
}

export interface RegulaEscalationRule {
  id: string;
  triggerType:
    | 'OBLIGACION_POR_VENCER'
    | 'OBLIGACION_VENCIDA'
    | 'PLAN_ACCION_VENCIDO'
    | 'HALLAZGO_CRITICO'
    | 'INCIDENTE_CRITICO'
    | 'KYC_DESACTUALIZADO'
    | 'CONTROL_INEFECTIVO';
  daysBeforeOrAfter: number;
  severity: RegulaSeverity;
  notifyRoles: string[];
  escalateToRole?: string;
  enabled: boolean;
}

export interface RegulaConfiguracionRecord extends RegulaBaseRecord {
  institutionName: string;
  entityType: string;
  economicActivity: string;
  jurisdiction: string;
  primarySupervisor: string;
  secondarySupervisors: string[];
  branches: string[];
  departments: string[];
  regulatoryCategories: string[];
  obligationTypes: string[];
  frequencies: RegulaFrequency[];
  criticalityLevels: RegulaSeverity[];
  probabilityScale: RegulaRiskScaleLevel[];
  impactScale: RegulaRiskScaleLevel[];
  riskThresholds: RegulaRiskZoneThreshold[];
  plaftFactorWeights: RegulaPlaftFactorWeight[];
  controlTypes: string[];
  auditTypes: string[];
  findingTypes: string[];
  incidentTypes: RegulaIncidentType[];
  escalationRules: RegulaEscalationRule[];
  roles: RegulaRoleDefinition[];
  userRoleAssignments: Record<string, string>; // uid -> RegulaRoleDefinition.code
  aiEnabled: boolean;
  aiRequireHumanValidation: boolean;
  aiCiteSourcesStrict: boolean;
  aiAllowedSections: RegulaSectionId[];
  reportTemplates: Array<{
    code: RegulaReportCode;
    title: string;
    headerNote: string;
    includeSignatures: boolean;
  }>;
  externalIntegrations: {
    regulatoryFeedsConfigured: boolean;
    regulatoryFeedsNote: string;
    emailSmtpConfigured: boolean;
    whatsappConfigured: boolean;
    sanctionsListsApiConfigured: boolean;
  };
}

// ----------------------------------------------------------------------------
// Shared Domain Enums
// ----------------------------------------------------------------------------
export type RegulaSeverity = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export type RegulaRiskLevel = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';
export type RegulaFrequency =
  | 'UNICA'
  | 'DIARIA'
  | 'SEMANAL'
  | 'QUINCENAL'
  | 'MENSUAL'
  | 'TRIMESTRAL'
  | 'SEMESTRAL'
  | 'ANUAL'
  | 'EVENTUAL';

export type RegulaObligationStatus =
  | 'PENDIENTE'
  | 'EN_PROGRESO'
  | 'CUMPLIDA'
  | 'VENCIDA'
  | 'PARCIAL'
  | 'EN_REVISION'
  | 'NO_APLICABLE';

export type RegulaNormativeStatus =
  | 'VIGENTE'
  | 'EN_CONSULTA'
  | 'MODIFICADA'
  | 'DEROGADA'
  | 'PENDIENTE_REVISION';

export type RegulaRiskCategory =
  | 'OPERACIONAL'
  | 'CREDITICIO'
  | 'FINANCIERO'
  | 'LIQUIDEZ'
  | 'MERCADO'
  | 'TECNOLOGICO'
  | 'CIBERSEGURIDAD'
  | 'LEGAL'
  | 'REGULATORIO'
  | 'REPUTACIONAL'
  | 'ESTRATEGICO'
  | 'FRAUDE'
  | 'CONTINUIDAD'
  | 'TERCEROS';

export type RegulaControlNature = 'PREVENTIVO' | 'DETECTIVO' | 'CORRECTIVO';
export type RegulaControlAutomation = 'MANUAL' | 'SEMIAUTOMATIZADO' | 'AUTOMATIZADO';
export type RegulaControlEffectiveness =
  | 'EFECTIVO'
  | 'PARCIALMENTE_EFECTIVO'
  | 'INEFECTIVO'
  | 'NO_EVALUADO';

export type RegulaActionPlanStatus =
  | 'PENDIENTE'
  | 'EN_PROCESO'
  | 'EN_REVISION'
  | 'IMPLEMENTADA'
  | 'PENDIENTE_VERIFICACION'
  | 'CERRADA'
  | 'VENCIDA'
  | 'REABIERTA';

export type RegulaIncidentType =
  | 'FALLA_OPERATIVA'
  | 'INCUMPLIMIENTO_NORMATIVO'
  | 'FRAUDE_INTERNO'
  | 'FRAUDE_EXTERNO'
  | 'INCIDENTE_TECNOLOGICO'
  | 'BRECHA_SEGURIDAD'
  | 'FALLA_PROVEEDOR'
  | 'RECLAMO_CRITICO'
  | 'ERROR_FINANCIERO_CONTABLE'
  | 'EVENTO_PLAFT'
  | 'INTERRUPCION_SERVICIO';

// ----------------------------------------------------------------------------
// 2–7. Cumplimiento Regulatorio
// ----------------------------------------------------------------------------
export interface RegulaNormativaRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  regulator: string; // e.g., SIB, DGII, UAF, BCRD, ProConsumidor, Ministerio de Hacienda, Interna
  category: string;
  normativeType: 'LEY' | 'REGLAMENTO' | 'CIRCULAR' | 'INSTRUCTIVO' | 'RESOLUCION' | 'POLITICA_INTERNA';
  issueDate: string;
  effectiveDate: string;
  status: RegulaNormativeStatus;
  jurisdiction: string;
  version: string;
  summary: string;
  fullTextExcerpt?: string;
  sourceUrl?: string;
  affectedAreas: string[];
  applicabilityStatus: 'APLICABLE' | 'PARCIALMENTE_APLICABLE' | 'NO_APLICABLE' | 'PENDIENTE_EVALUACION';
  radarOrigin: 'REGISTRO_MANUAL' | 'ANALISIS_IA_VALIDADO' | 'FUENTE_OFICIAL_INTEGRADA';
}

export interface RegulaNormativaVersionRecord extends RegulaBaseRecord {
  normativaId: string;
  normativaCode: string;
  version: string;
  changeDate: string;
  changeSummary: string;
  previousStatus: RegulaNormativeStatus;
  newStatus: RegulaNormativeStatus;
  impactNotes?: string;
}

export interface RegulaObligacionRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  description: string;
  normativaId?: string;
  normativaCode?: string;
  regulator: string;
  category: string;
  obligationType: string;
  frequency: RegulaFrequency;
  dueDate: string; // YYYY-MM-DD
  nextDueDate?: string;
  department: string;
  branch?: string;
  responsibleUid?: string;
  responsibleName: string;
  criticality: RegulaSeverity;
  status: RegulaObligationStatus;
  compliancePct: number;
  requiredEvidenceDesc?: string;
  linkedEvidenceIds: string[];
  linkedControlIds: string[];
  nonApplicableJustification?: string;
  nonApplicableApprovedBy?: string;
  nonApplicableApprovedAt?: string;
  lastReviewedAt?: string;
  originSource?: 'MANUAL' | 'REGULA_AI_VALIDADA';
}

export interface RegulaAplicabilidadRecord extends RegulaBaseRecord {
  normativaId: string;
  normativaCode: string;
  normativaTitle: string;
  entityType: string;
  economicActivity: string;
  applicableProducts: string[];
  jurisdiction: string;
  supervisor: string;
  decision: 'APLICABLE' | 'PARCIALMENTE_APLICABLE' | 'NO_APLICABLE';
  justification: string;
  approvalStatus: 'BORRADOR' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'RECHAZADA';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  nextReviewDate?: string;
}

export interface RegulaCalendarioRecord extends RegulaBaseRecord {
  title: string;
  eventType:
    | 'OBLIGACION'
    | 'AUDITORIA'
    | 'REVISION_KYC'
    | 'PRUEBA_CONTROL'
    | 'CAPACITACION'
    | 'PLAN_ACCION'
    | 'VENCIMIENTO_DOCUMENTO';
  dueDate: string;
  department: string;
  responsibleName: string;
  criticality: RegulaSeverity;
  status: 'PROGRAMADO' | 'EN_CURSO' | 'COMPLETADO' | 'VENCIDO';
  relatedEntityType?: RegulaCollectionName;
  relatedEntityId?: string;
  notes?: string;
}

export interface RegulaResponsableRecord extends RegulaBaseRecord {
  userId?: string;
  fullName: string;
  email: string;
  position: string;
  department: string;
  branch?: string;
  regulaRoleCode: string;
  active: boolean;
}

// ----------------------------------------------------------------------------
// 8–12. PLAFTPADM
// ----------------------------------------------------------------------------
export interface RegulaKycRecord extends RegulaBaseRecord {
  customerId?: string; // Linked to AxyCore customers collection (no master duplication)
  businessId?: string; // Linked to AxyCore businesses collection
  clientType: 'PERSONA_FISICA' | 'PERSONA_JURIDICA';
  clientName: string;
  documentNumber: string;
  economicActivity: string;
  fundsOrigin: string;
  geographicZone: string;
  channel: string;
  productsUsed: string[];
  isPep: boolean;
  pepDetails?: string;
  identityVerified: boolean;
  addressVerified: boolean;
  fundsOriginVerified: boolean;
  kycStatus: 'COMPLETO' | 'PENDIENTE_DOCUMENTOS' | 'DESACTUALIZADO' | 'EN_REVISION' | 'BLOQUEADO_REVISION';
  lastReviewDate: string;
  nextReviewDate: string;
  reviewerName: string;
  notes?: string;
}

export interface RegulaDebidaDiligenciaRecord extends RegulaBaseRecord {
  kycId: string;
  customerId?: string;
  clientName: string;
  level: 'SIMPLIFICADA' | 'ESTANDAR' | 'AMPLIADA';
  status: 'BORRADOR' | 'EN_PROCESO' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'RECHAZADA' | 'VENCIDA';
  reviewDate: string;
  nextReviewDate: string;
  checklist: {
    identificacionVerificada: boolean;
    actividadEconomicaVerificada: boolean;
    origenFondosDocumentado: boolean;
    beneficiarioFinalIdentificado: boolean;
    verificacionPepRealizada: boolean;
    listasRestrictivasVerificadas: boolean;
  };
  sanctionsCheckNote: string; // Explicit note if checked manually or via authorized source
  analystNotes: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
}

export interface RegulaBeneficiarioFinalRecord extends RegulaBaseRecord {
  kycId: string;
  businessId?: string;
  entityName: string;
  beneficiaryName: string;
  documentType: 'CEDULA' | 'PASAPORTE' | 'RNC';
  documentNumber: string;
  nationality: string;
  ownershipPct: number;
  controlType: 'ACCIONARIO_DIRECTO' | 'ACCIONARIO_INDIRECTO' | 'CONTROL_EFECTIVO' | 'REPRESENTACION_LEGAL';
  isPep: boolean;
  verificationStatus: 'VERIFICADO' | 'PENDIENTE' | 'OBSERVADO';
  verifiedDate?: string;
  notes?: string;
}

export interface RegulaPerfilRiesgoFactorScore {
  code: string;
  label: string;
  rawScore: number; // 1 to 5
  weightPct: number;
  weightedContribution: number;
  rationale: string;
}

export interface RegulaPerfilRiesgoRecord extends RegulaBaseRecord {
  kycId: string;
  customerId?: string;
  clientName: string;
  evaluationDate: string;
  nextReviewDate: string;
  factors: RegulaPerfilRiesgoFactorScore[];
  totalScore: number; // 0 to 100
  riskLevel: RegulaRiskLevel;
  recommendedDdLevel: 'SIMPLIFICADA' | 'ESTANDAR' | 'AMPLIADA';
  explanation: string;
  evaluatedByName: string;
}

export interface RegulaCasoPlaftRecord extends RegulaBaseRecord {
  code: string;
  kycId?: string;
  customerId?: string;
  clientName: string;
  alertOrigin:
    | 'MONITOREO_TRANSACCIONAL'
    | 'CENTINELA_AXYCORE'
    | 'REVISION_KYC'
    | 'PEP_IDENTIFICADO'
    | 'OPERACION_INUSUAL'
    | 'REPORTADO_INTERNAMENTE';
  title: string;
  description: string;
  severity: RegulaSeverity;
  status:
    | 'ABIERTO'
    | 'EN_INVESTIGACION'
    | 'PENDIENTE_COMITE_CUMPLIMIENTO'
    | 'DESCARTADO_JUSTIFICADO'
    | 'ESCALADO_OFICIAL_CUMPLIMIENTO'
    | 'CERRADO';
  assignedToName: string;
  investigationFindings?: string;
  humanDecisionSummary?: string;
  requiresExternalReportReview: boolean; // Never auto-filed — requires human review & external official channel
  externalReportDecisionBy?: string;
  externalReportDecisionAt?: string;
  linkedEvidenceIds: string[];
  linkedActionPlanIds: string[];
  openedDate: string;
  closedDate?: string;
}

// ----------------------------------------------------------------------------
// 13–14. Gestión Integral de Riesgos
// ----------------------------------------------------------------------------
export interface RegulaRiesgoRecord extends RegulaBaseRecord {
  code: string;
  name: string;
  description: string;
  category: RegulaRiskCategory;
  processArea: string;
  branch?: string;
  ownerUid?: string;
  ownerName: string;
  causes: string;
  consequences: string;
  inherentProbability: 1 | 2 | 3 | 4 | 5;
  inherentImpact: 1 | 2 | 3 | 4 | 5;
  inherentScore: number; // 1..25
  inherentLevel: RegulaRiskLevel;
  residualProbability: 1 | 2 | 3 | 4 | 5;
  residualImpact: 1 | 2 | 3 | 4 | 5;
  residualScore: number; // 1..25
  residualLevel: RegulaRiskLevel;
  treatmentStrategy: 'MITIGAR' | 'EVITAR' | 'TRANSFERIR' | 'ACEPTAR';
  mitigationPlanSummary?: string;
  status: 'ACTIVO' | 'EN_MITIGACION' | 'ACEPTADO' | 'CERRADO';
  linkedControlIds: string[];
  linkedObligationIds: string[];
  linkedActionPlanIds: string[];
  lastEvaluatedAt: string;
  nextReviewDate?: string;
}

export interface RegulaEvaluacionRiesgoRecord extends RegulaBaseRecord {
  riesgoId: string;
  riesgoCode: string;
  evaluationDate: string;
  inherentProbability: 1 | 2 | 3 | 4 | 5;
  inherentImpact: 1 | 2 | 3 | 4 | 5;
  inherentScore: number;
  residualProbability: 1 | 2 | 3 | 4 | 5;
  residualImpact: 1 | 2 | 3 | 4 | 5;
  residualScore: number;
  residualLevel: RegulaRiskLevel;
  controlEffectivenessApplied: RegulaControlEffectiveness;
  evaluatorName: string;
  rationale: string;
}

// ----------------------------------------------------------------------------
// 15–16. Control Interno
// ----------------------------------------------------------------------------
export interface RegulaControlRecord extends RegulaBaseRecord {
  code: string;
  name: string;
  objective: string;
  description: string;
  nature: RegulaControlNature;
  automation: RegulaControlAutomation;
  frequency: RegulaFrequency;
  department: string;
  ownerName: string;
  effectiveness: RegulaControlEffectiveness;
  expectedEvidence: string;
  lastTestedDate?: string;
  nextTestDate?: string;
  linkedRiskIds: string[];
  linkedObligationIds: string[];
  weaknessIdentified: boolean;
  weaknessDescription?: string;
  linkedActionPlanIds: string[];
  status: 'ACTIVO' | 'EN_DISENO' | 'DEBILIDAD_ABIERTA' | 'INACTIVO';
}

export interface RegulaPruebaControlRecord extends RegulaBaseRecord {
  controlId: string;
  controlCode: string;
  controlName: string;
  testDate: string;
  testerName: string;
  sampleSize: number;
  exceptionsFound: number;
  procedureSummary: string;
  result: RegulaControlEffectiveness;
  observations: string;
  linkedEvidenceIds: string[];
  generatedWeaknessActionPlanId?: string;
}

// ----------------------------------------------------------------------------
// 17–19. Auditoría Interna
// ----------------------------------------------------------------------------
export interface RegulaAuditoriaRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  planYear: number;
  auditType: string;
  scope: string;
  objectives: string;
  auditedArea: string;
  branch?: string;
  leadAuditorName: string;
  startDate: string;
  endDate: string;
  status: 'PLANIFICADA' | 'APROBADA' | 'EN_EJECUCION' | 'BORRADOR_INFORME' | 'FINALIZADA' | 'CANCELADA';
  progressPct: number;
  planApprovedBy?: string;
  planApprovedAt?: string;
  executiveConclusion?: string;
}

export interface RegulaProgramaAuditoriaRecord extends RegulaBaseRecord {
  auditoriaId: string;
  auditoriaCode: string;
  stepCode: string;
  procedureTitle: string;
  checklistItem: string;
  sampleDescription?: string;
  assignedAuditorName: string;
  status: 'PENDIENTE' | 'EN_PROGRESO' | 'COMPLETADO' | 'CON_OBSERVACION';
  resultNotes?: string;
  linkedEvidenceIds: string[];
}

export interface RegulaHallazgoRecord extends RegulaBaseRecord {
  code: string;
  auditoriaId: string;
  auditoriaCode: string;
  title: string;
  criterio: string;
  condicion: string;
  causa: string;
  efecto: string;
  severity: RegulaSeverity;
  auditedArea: string;
  responsibleName: string;
  recommendation: string;
  areaResponse?: string;
  dueDate: string;
  status: 'ABIERTO' | 'EN_ATENCION' | 'PENDIENTE_VERIFICACION' | 'CERRADO' | 'REABIERTO';
  linkedRiskIds: string[];
  linkedControlIds: string[];
  linkedActionPlanIds: string[];
  linkedEvidenceIds: string[];
  closedBy?: string;
  closedAt?: string;
  reopenCount: number;
}

// ----------------------------------------------------------------------------
// 20–21. Evidencias y Documentación
// ----------------------------------------------------------------------------
export interface RegulaEvidenciaRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  description: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileDataUrl?: string; // Stored safely in Firestore when <= 450KB; metadata preserved otherwise
  version: string;
  category: 'OBLIGACION' | 'CONTROL' | 'RIESGO' | 'AUDITORIA' | 'HALLAZGO' | 'INCIDENTE' | 'PLAN_ACCION' | 'PLAFT' | 'CAPACITACION';
  relatedEntityType?: RegulaCollectionName;
  relatedEntityId?: string;
  relatedEntityCode?: string;
  validFrom: string;
  validUntil?: string;
  confidential: boolean;
  allowedRoles?: string[];
  status: 'VIGENTE' | 'POR_VENCER' | 'VENCIDA' | 'ARCHIVADA';
  downloadCount: number;
  lastAccessedBy?: string;
  lastAccessedAt?: string;
}

export interface RegulaDocumentoRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  docType: 'POLITICA' | 'MANUAL' | 'PROCEDIMIENTO' | 'MATRIZ' | 'NORMATIVO' | 'ACTA' | 'INFORME';
  department: string;
  ownerName: string;
  version: string;
  effectiveDate: string;
  expiryDate?: string;
  status: 'BORRADOR' | 'PENDIENTE_APROBACION' | 'VIGENTE' | 'PENDIENTE_ACTUALIZACION' | 'OBSOLETO';
  summary: string;
  contentText?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  fileDataUrl?: string;
  confidential: boolean;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  versionHistory: Array<{
    version: string;
    date: string;
    authorName: string;
    notes: string;
  }>;
}

// ----------------------------------------------------------------------------
// 22. Incidentes y Eventos de Riesgo
// ----------------------------------------------------------------------------
export interface RegulaIncidenteRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  incidentType: RegulaIncidentType;
  description: string;
  occurredAt: string;
  detectedAt: string;
  department: string;
  branch?: string;
  reportedByName: string;
  assignedToName: string;
  severity: RegulaSeverity;
  status:
    | 'REGISTRADO'
    | 'CLASIFICADO'
    | 'EN_INVESTIGACION'
    | 'ANALISIS_CAUSA_RAIZ'
    | 'RESUELTO'
    | 'CERRADO';
  estimatedLossAmount: number;
  actualLossAmount: number;
  currency: 'DOP' | 'USD';
  rootCauseAnalysis?: string;
  containmentActions?: string;
  lessonsLearned?: string;
  linkedRiskIds: string[];
  linkedControlIds: string[];
  linkedAuditIds: string[];
  linkedActionPlanIds: string[];
  linkedEvidenceIds: string[];
  closedBy?: string;
  closedAt?: string;
}

// ----------------------------------------------------------------------------
// 23–24. Planes de Acción y Actividades
// ----------------------------------------------------------------------------
export interface RegulaPlanAccionHistoryEntry {
  timestampIso: string;
  actorUid: string;
  actorName: string;
  fromStatus: string;
  toStatus: string;
  notes: string;
}

export interface RegulaPlanAccionRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  description: string;
  actionType: 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA';
  originType: 'OBLIGACION' | 'RIESGO' | 'CONTROL' | 'HALLAZGO' | 'INCIDENTE' | 'PLAFT' | 'BRECHA_IA' | 'MANUAL';
  originEntityId?: string;
  originEntityCode?: string;
  department: string;
  branch?: string;
  responsibleUid?: string;
  responsibleName: string;
  priority: RegulaSeverity;
  startDate: string;
  dueDate: string;
  progressPct: number; // Reaching 100% NEVER auto-closes; transitions to PENDIENTE_VERIFICACION
  status: RegulaActionPlanStatus;
  effectivenessVerified: boolean;
  effectivenessVerifiedBy?: string;
  effectivenessVerifiedByName?: string;
  effectivenessVerifiedAt?: string;
  effectivenessNotes?: string;
  closureApprovedBy?: string;
  closureApprovedByName?: string;
  closureApprovedAt?: string;
  reopenCount: number;
  linkedEvidenceIds: string[];
  statusHistory: RegulaPlanAccionHistoryEntry[];
}

export interface RegulaActividadRecord extends RegulaBaseRecord {
  planAccionId: string;
  title: string;
  responsibleName: string;
  dueDate: string;
  completed: boolean;
  completedAt?: string;
  notes?: string;
}

// ----------------------------------------------------------------------------
// 25–27. Cultura de Cumplimiento
// ----------------------------------------------------------------------------
export interface RegulaCapacitacionRecord extends RegulaBaseRecord {
  code: string;
  title: string;
  topic: 'PLAFTPADM' | 'CUMPLIMIENTO_REGULATORIO' | 'GESTION_RIESGOS' | 'CONTROL_INTERNO' | 'SEGURIDAD_INFORMACION' | 'ETICA_GOBIERNO';
  planYear: number;
  modality: 'PRESENCIAL' | 'VIRTUAL' | 'MIXTA' | 'AUTOAPRENDIZAJE';
  instructorName: string;
  scheduledDate: string;
  durationHours: number;
  targetAudienceCount: number;
  minPassingScore: number;
  certificationValidityMonths: number;
  status: 'PLANIFICADA' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA';
  description: string;
}

export interface RegulaParticipanteRecord extends RegulaBaseRecord {
  capacitacionId: string;
  capacitacionCode: string;
  capacitacionTitle: string;
  userId?: string;
  participantName: string;
  department: string;
  attendanceStatus: 'INSCRITO' | 'ASISTIO' | 'INASISTENCIA';
  completionDate?: string;
  certified: boolean;
  certificateCode?: string;
  certificateExpiresAt?: string;
}

export interface RegulaEvaluacionCapacitacionRecord extends RegulaBaseRecord {
  capacitacionId: string;
  participanteId: string;
  participantName: string;
  evaluationDate: string;
  score: number; // 0..100
  passed: boolean;
  evaluatorNotes?: string;
}

// ----------------------------------------------------------------------------
// 28–32. Alertas, Notificaciones, Aprobaciones, Historial, REGULA AI
// ----------------------------------------------------------------------------
export interface RegulaAlertaRecord extends RegulaBaseRecord {
  dedupKey: string;
  alertType:
    | 'OBLIGACION_POR_VENCER'
    | 'OBLIGACION_VENCIDA'
    | 'EVIDENCIA_FALTANTE'
    | 'CONTROL_INEFECTIVO'
    | 'RIESGO_CRITICO_SIN_MITIGACION'
    | 'HALLAZGO_VENCIDO'
    | 'PLAN_ACCION_VENCIDO'
    | 'INCIDENTE_CRITICO'
    | 'DOCUMENTO_VENCIDO'
    | 'KYC_DESACTUALIZADO'
    | 'CAPACITACION_PENDIENTE'
    | 'ECOSISTEMA_AXYCORE';
  severity: RegulaSeverity;
  title: string;
  description: string;
  targetSection: RegulaSectionId;
  relatedEntityType?: string;
  relatedEntityId?: string;
  dueDate?: string;
  status: 'ACTIVA' | 'EN_ATENCION' | 'RESUELTA' | 'DESCARTADA';
  escalated: boolean;
  escalatedTo?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface RegulaNotificacionRecord extends RegulaBaseRecord {
  dedupKey: string;
  recipientUid?: string;
  recipientRole?: string;
  title: string;
  message: string;
  severity: RegulaSeverity;
  channel: 'INTERNA_AXYCORE' | 'CORREO_SMTP' | 'WHATSAPP';
  deliveryStatus: 'ENTREGADA_INTERNA' | 'PENDIENTE_CONFIGURACION_EXTERNA' | 'ENVIADA' | 'ERROR';
  read: boolean;
  readAt?: string;
  targetSection: RegulaSectionId;
  relatedEntityId?: string;
}

export interface RegulaAprobacionRecord extends RegulaBaseRecord {
  entityType: RegulaCollectionName;
  entityId: string;
  entityCode?: string;
  approvalAction:
    | 'APROBAR_APLICABILIDAD'
    | 'APROBAR_NO_APLICABLE'
    | 'APROBAR_DEBIDA_DILIGENCIA'
    | 'APROBAR_PLAN_AUDITORIA'
    | 'APROBAR_DOCUMENTO'
    | 'APROBAR_CIERRE_PLAN_ACCION'
    | 'APROBAR_CIERRE_HALLAZGO'
    | 'VALIDAR_OBLIGACION_IA'
    | 'APROBAR_INFORME_IA'
    | 'DECISION_CASO_PLAFT';
  decision: 'APROBADO' | 'RECHAZADO';
  actorUid: string;
  actorName: string;
  actorRole: string;
  justification: string;
  timestampIso: string;
}

export interface RegulaHistorialRecord extends RegulaBaseRecord {
  entityType: RegulaCollectionName | 'regula_system';
  entityId: string;
  entityCode?: string;
  action: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  previousSummary?: string;
  newSummary?: string;
  timestampIso: string;
}

export type RegulaAiMode =
  | 'ASISTENTE'
  | 'ANALISIS_NORMATIVO'
  | 'DIAGNOSTICO_BRECHAS'
  | 'EVALUACION_DOCUMENTO'
  | 'RECOMENDACIONES'
  | 'GENERACION_INFORME';

export interface RegulaAiConsultaRecord extends RegulaBaseRecord {
  mode: RegulaAiMode;
  promptSummary: string;
  model: string;
  responseSummary: string;
  structuredResultJson?: string;
  citedSources: string[];
  missingDataNoted: string[];
  humanValidationStatus: 'PENDIENTE_VALIDACION' | 'VALIDADA_APLICADA' | 'DESCARTADA' | 'INFORMATIVA';
  validatedBy?: string;
  validatedByName?: string;
  validatedAt?: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  timestampIso: string;
}

// ----------------------------------------------------------------------------
// Reports Catalog (All 18 Required Reports)
// ----------------------------------------------------------------------------
export type RegulaReportCode =
  | 'CUMPLIMIENTO_GENERAL'
  | 'OBLIGACIONES_VENCIDAS_PROXIMAS'
  | 'MATRIZ_APLICABILIDAD'
  | 'MATRIZ_RIESGOS'
  | 'MAPA_CALOR_RIESGOS'
  | 'CONTROLES_EFECTIVIDAD'
  | 'AUDITORIAS_HALLAZGOS'
  | 'PLANES_ACCION_ESTADO'
  | 'INCIDENTES_PERDIDAS'
  | 'CUMPLIMIENTO_PLAFTPADM'
  | 'ALERTAS_CASOS_INVESTIGACION'
  | 'DOCUMENTOS_VENCIDOS_PENDIENTES'
  | 'CAPACITACION_COBERTURA'
  | 'INFORME_EJECUTIVO_DIRECCION'
  | 'INFORME_COMITE_RIESGOS'
  | 'INFORME_COMITE_CUMPLIMIENTO'
  | 'INFORME_COMITE_AUDITORIA'
  | 'TRAZABILIDAD_AUDITORIA_REGULA';

export interface RegulaReportFilters {
  branch: string;
  department: string;
  responsible: string;
  dateFrom: string;
  dateTo: string;
  category: string;
  riskLevel: string;
  status: string;
}

// ----------------------------------------------------------------------------
// Aggregated Workspace Dataset & Computed Analytics
// ----------------------------------------------------------------------------
export interface RegulaWorkspaceData {
  config: RegulaConfiguracionRecord | null;
  normativas: RegulaNormativaRecord[];
  normativaVersiones: RegulaNormativaVersionRecord[];
  obligaciones: RegulaObligacionRecord[];
  aplicabilidad: RegulaAplicabilidadRecord[];
  calendario: RegulaCalendarioRecord[];
  responsables: RegulaResponsableRecord[];
  kyc: RegulaKycRecord[];
  debidaDiligencia: RegulaDebidaDiligenciaRecord[];
  beneficiariosFinales: RegulaBeneficiarioFinalRecord[];
  perfilesRiesgo: RegulaPerfilRiesgoRecord[];
  casosPlaft: RegulaCasoPlaftRecord[];
  riesgos: RegulaRiesgoRecord[];
  evaluacionesRiesgo: RegulaEvaluacionRiesgoRecord[];
  controles: RegulaControlRecord[];
  pruebasControl: RegulaPruebaControlRecord[];
  auditorias: RegulaAuditoriaRecord[];
  programasAuditoria: RegulaProgramaAuditoriaRecord[];
  hallazgos: RegulaHallazgoRecord[];
  evidencias: RegulaEvidenciaRecord[];
  documentos: RegulaDocumentoRecord[];
  incidentes: RegulaIncidenteRecord[];
  planesAccion: RegulaPlanAccionRecord[];
  actividades: RegulaActividadRecord[];
  capacitaciones: RegulaCapacitacionRecord[];
  participantes: RegulaParticipanteRecord[];
  evaluacionesCapacitacion: RegulaEvaluacionCapacitacionRecord[];
  alertas: RegulaAlertaRecord[];
  notificaciones: RegulaNotificacionRecord[];
  aprobaciones: RegulaAprobacionRecord[];
  historial: RegulaHistorialRecord[];
  aiConsultas: RegulaAiConsultaRecord[];
}

export interface RegulaDashboardKpis {
  hasAnyData: boolean;
  generalComplianceIndexPct: number | null;
  applicableObligationsCount: number;
  fulfilledObligationsCount: number;
  upcomingObligationsCount: number;
  overdueObligationsCount: number;
  activeRisksCount: number;
  criticalRisksCount: number;
  highRisksCount: number;
  evaluatedControlsCount: number;
  controlEffectivenessPct: number | null;
  openFindingsCount: number;
  criticalFindingsCount: number;
  activeActionPlansCount: number;
  overdueActionPlansCount: number;
  openIncidentsCount: number;
  plaftActiveAlertsCount: number;
  expiredOrPendingDocumentsCount: number;
  trainingCoveragePct: number | null;
  institutionalRiskExposureScore: number | null; // 0..100
}

export interface RegulaEcosystemSignals {
  centinelaActiveAlerts: number;
  centinelaCriticalAlerts: number;
  alteraHighRiskRecommendations: number;
  anticipateSevereDelinquencyLoans: number;
  creditPoliciesActiveVersion: string;
  loansWithHighDpdCount: number;
  openReconciliationExceptions: number;
  ecfPendingOrErrorCount: number;
  pendingCreditDocumentsCount: number;
  totalCustomersMaster: number;
  totalBusinessesMaster: number;
  customersWithRegulaKyc: number;
  customersMissingRegulaKyc: number;
  proposedAlerts: Array<{
    key: string;
    sourceModule: string;
    severity: RegulaSeverity;
    title: string;
    detail: string;
    targetSection: RegulaSectionId;
  }>;
}
