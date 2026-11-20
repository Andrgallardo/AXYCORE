import { describe, expect, it } from 'vitest';
import {
  buildDefaultRegulaConfig,
  buildRiskHeatmap5x5,
  computeRegulaDashboardKpis,
  computeRiskEvaluation,
  deriveRegulaPriorityAlerts,
  evaluatePlaftRiskProfile,
  hasRegulaPermission,
  REGULA_REPORT_CATALOG,
  validateActionPlanUpdate,
  validateNonApplicableObligation,
} from '../engine/regulaEngine';
import { buildRegulaReportDataset } from '../engine/regulaReports';
import { createEmptyRegulaWorkspaceData } from '../services/regulaStore';
import {
  canEditApplicationRecord,
  EDITABLE_APPLICATION_STATUSES,
} from '../services/axycoreStore';
import { DEFAULT_POLICY_V2, evaluateCreditDecisionV2 } from '../engine/decisionEngineV2';
import {
  checkTenantSectionAccess,
  COMMERCIAL_PLANS_CATALOG,
  resolveModuleForNavSection,
  SU_GLORIA_ENABLED_MODULES,
  SU_GLORIA_MANO_AMIGA_ORG,
} from '../engine/multiTenantEngine';
import { canRoleAccessSection } from '../engine/rbac';
import type { ApplicationRecord, CustomerRecord, UserProfile, UserRole } from '../types/axycore';
import type { RegulaPlanAccionRecord, RegulaRiesgoRecord } from '../types/regula';

describe('Solicitudes Recibidas: Edición y Reevaluación Motor V2', () => {
  it('permite editar solicitudes en RECIBIDA, BORRADOR, DEVUELTA y EN_EVALUACION al personal interno (no Auditor ni Cliente Externo)', () => {
    expect(EDITABLE_APPLICATION_STATUSES).toEqual(
      expect.arrayContaining(['BORRADOR', 'RECIBIDA', 'DEVUELTA', 'EN_EVALUACION'])
    );

    expect(canEditApplicationRecord('RECIBIDA', 'CREDIT_ANALYST')).toBe(true);
    expect(canEditApplicationRecord('RECIBIDA', 'BUSINESS_OFFICER')).toBe(true);
    expect(canEditApplicationRecord('RECIBIDA', 'ADMIN')).toBe(true);
    expect(canEditApplicationRecord('EN_EVALUACION', 'RISK_OFFICER')).toBe(true);

    // Roles restringidos
    expect(canEditApplicationRecord('RECIBIDA', 'AUDITOR')).toBe(false);
    expect(canEditApplicationRecord('RECIBIDA', 'EXTERNAL_CLIENT')).toBe(false);

    // Estados no editables
    expect(canEditApplicationRecord('APROBADA', 'ADMIN')).toBe(false);
    expect(canEditApplicationRecord('DESEMBOLSADA', 'ADMIN')).toBe(false);
    expect(canEditApplicationRecord('RECHAZADA', 'ADMIN')).toBe(false);
  });

  it('recalcula score y precalificación del Motor V2 al corregir datos financieros mal llenados', () => {
    const customer: CustomerRecord = {
      id: 'cust_test_1',
      organizationId: 'org_axycore_main',
      documentType: 'CEDULA',
      documentNumber: '00112345678',
      documentKey: 'CEDULA:00112345678',
      firstName: 'Carlos',
      lastName: 'Ramírez',
      birthDate: '1990-05-12',
      phone: '8095551234',
      email: 'carlos@example.com',
      address: 'Santo Domingo',
      municipality: 'Distrito Nacional',
      province: 'Distrito Nacional',
      residenceMonths: 36,
      housingType: 'ALQUILADA',
      housingPayment: 12000,
      socialMediaDeclared: 'YES',
      socialMediaHandle: '@carlosr',
      createdBy: 'usr_1',
    };

    const baseApp: ApplicationRecord = {
      id: 'app_test_1',
      organizationId: 'org_axycore_main',
      applicationNumber: 'SOL-2026-0001',
      fileNumber: 'EXP-2026-0001',
      channel: 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: customer.id,
      applicantDisplayName: `${customer.firstName} ${customer.lastName}`,
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 150000,
      requestedTermMonths: 24,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Consolidación de gastos',
      financialData: {
        incomeCurrency: 'DOP',
        incomeSourceType: 'IRREGULAR',
        employmentMonths: 4,
        primaryNetIncome: 25000, // Dato mal digitado por el cliente
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 25000,
        essentialExpenses: 18000,
        housingPayment: 12000,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'HAS_DEBTS',
        debtCount: 2,
        totalDebtBalance: 120000,
        currentDebtPayments: 9000,
      },
      references: [
        { name: 'María Gómez', relationship: 'Hermana', phone: '8095559999' },
        { name: 'Pedro Pérez', relationship: 'Colega', phone: '8095558888' },
      ],
      declaredDocumentsSummary: {
        hasIdentityDoc: true,
        hasIncomeEvidence: true,
        hasAddressProof: true,
      },
      status: 'RECIBIDA',
      createdBy: 'usr_1',
    };

    const initialEval = evaluateCreditDecisionV2({
      application: baseApp,
      customer,
      policy: DEFAULT_POLICY_V2,
      useVerifiedData: false,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'usr_1',
      executedByName: 'Oficial',
    });

    const correctedCustomer: CustomerRecord = {
      ...customer,
      housingType: 'PROPIA',
      housingPayment: 0,
      residenceMonths: 60,
    };

    const correctedApp: ApplicationRecord = {
      ...baseApp,
      requestedAmount: 100000,
      requestedTermMonths: 12,
      financialData: {
        ...baseApp.financialData,
        activityType: 'Empleado Privado',
        employerOrBusinessName: 'Corporación Financiera RD SRL',
        occupationOrRole: 'Gerente de Operaciones',
        incomeSourceType: 'FIJA_RECURRENTE',
        employmentMonths: 60,
        primaryNetIncome: 140000,
        declaredTotalMonthlyIncome: 140000,
        essentialExpenses: 24000,
        housingPayment: 0,
        housingIncludedInExpenses: true,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        debtCount: 0,
        totalDebtBalance: 0,
        currentDebtPayments: 0,
      },
    };

    const reeval = evaluateCreditDecisionV2({
      application: correctedApp,
      customer: correctedCustomer,
      policy: DEFAULT_POLICY_V2,
      useVerifiedData: false,
      executionTrigger: 'MANUAL_RERUN',
      executedBy: 'usr_2',
      executedByName: 'Analista Crédito',
    });

    expect(reeval.totalScore).toBeGreaterThan(initialEval.totalScore);
    expect(reeval.status).toBe('PREOFERTA');
    expect(reeval.recommendedAmount).toBeGreaterThan(initialEval.recommendedAmount);
  });
});

describe('AxyCore REGULA: Motor de Cumplimiento, Riesgos, PLAFTPADM y Gobernanza', () => {
  const todayIso = '2026-11-20';

  it('mantiene KPIs honestos (null / 0 sin cifras simuladas) cuando el espacio está vacío', () => {
    const empty = createEmptyRegulaWorkspaceData();
    const kpis = computeRegulaDashboardKpis(empty, todayIso);
    expect(kpis.hasAnyData).toBe(false);
    expect(kpis.generalComplianceIndexPct).toBeNull();
    expect(kpis.controlEffectivenessPct).toBeNull();
    expect(kpis.trainingCoveragePct).toBeNull();
    expect(kpis.institutionalRiskExposureScore).toBeNull();
    expect(kpis.overdueObligationsCount).toBe(0);
    expect(kpis.activeRisksCount).toBe(0);
  });

  it('calcula riesgo inherente vs. residual con controles efectivos y construye mapa de calor 5×5', () => {
    const evalResult = computeRiskEvaluation({
      inherentProbability: 5,
      inherentImpact: 4,
      linkedControls: [{ effectiveness: 'EFECTIVO' }, { effectiveness: 'EFECTIVO' }],
    });
    expect(evalResult.inherentScore).toBe(20);
    expect(evalResult.inherentLevel).toBe('CRITICO');
    expect(evalResult.residualScore).toBeLessThan(evalResult.inherentScore);
    expect(evalResult.mitigationFactorPct).toBe(50);

    const risk: RegulaRiesgoRecord = {
      id: 'r1',
      organizationId: 'org1',
      createdBy: 'u1',
      code: 'RSK-001',
      name: 'Incumplimiento reporte UAF',
      description: 'Retraso en remisión de ROS',
      category: 'REGULATORIO',
      processArea: 'Cumplimiento',
      ownerName: 'Oficial',
      causes: 'Proceso manual',
      consequences: 'Sanción',
      inherentProbability: 5,
      inherentImpact: 4,
      inherentScore: 20,
      inherentLevel: 'CRITICO',
      residualProbability: evalResult.residualProbability,
      residualImpact: evalResult.residualImpact,
      residualScore: evalResult.residualScore,
      residualLevel: evalResult.residualLevel,
      treatmentStrategy: 'MITIGAR',
      status: 'ACTIVO',
      linkedControlIds: [],
      linkedObligationIds: [],
      linkedActionPlanIds: [],
      lastEvaluatedAt: todayIso,
    };

    const heatmap = buildRiskHeatmap5x5([risk], 'RESIDUAL');
    expect(heatmap).toHaveLength(5);
    expect(heatmap[0]).toHaveLength(5);
    const totalMapped = heatmap.flat().reduce((acc, cell) => acc + cell.risks.length, 0);
    expect(totalMapped).toBe(1);
  });

  it('eleva automáticamente la Debida Diligencia a AMPLIADA cuando el cliente es PEP', () => {
    const profile = evaluatePlaftRiskProfile({
      isPep: true,
      factorInputs: [
        { code: 'TIPO_CLIENTE', rawScore: 2 },
        { code: 'ACTIVIDAD_ECONOMICA', rawScore: 2 },
        { code: 'PEP_EXPOSICION', rawScore: 5 },
      ],
    });
    expect(profile.recommendedDdLevel).toBe('AMPLIADA');
    expect(profile.explanation).toContain('PEP');
  });

  it('impide cierre automático al 100% en Planes de Acción y exige verificación + aprobación formal', () => {
    const basePlan: RegulaPlanAccionRecord = {
      id: 'pa_1',
      organizationId: 'org1',
      createdBy: 'u1',
      code: 'PA-0001',
      title: 'Fortalecer control de conciliación',
      description: 'Automatizar revisión diaria',
      actionType: 'CORRECTIVA',
      originType: 'HALLAZGO',
      department: 'Operaciones',
      responsibleName: 'Ana',
      priority: 'ALTA',
      startDate: '2026-11-01',
      dueDate: '2026-11-30',
      progressPct: 75,
      status: 'EN_PROCESO',
      effectivenessVerified: false,
      reopenCount: 0,
      linkedEvidenceIds: [],
      statusHistory: [],
    };

    // 100% shifts to PENDIENTE_VERIFICACION, never CERRADA
    const at100 = validateActionPlanUpdate({
      existing: basePlan,
      nextStatus: 'EN_PROCESO',
      nextProgressPct: 100,
      canApproveClosure: true,
    });
    expect(at100.allowed).toBe(true);
    expect(at100.effectiveStatus).toBe('PENDIENTE_VERIFICACION');

    // Attempt to close without verification fails
    const closeUnverified = validateActionPlanUpdate({
      existing: basePlan,
      nextStatus: 'CERRADA',
      nextProgressPct: 100,
      effectivenessVerified: false,
      canApproveClosure: true,
    });
    expect(closeUnverified.allowed).toBe(false);

    // Attempt to close with verification AND approval permission succeeds
    const closeVerified = validateActionPlanUpdate({
      existing: { ...basePlan, effectivenessVerified: true },
      nextStatus: 'CERRADA',
      nextProgressPct: 100,
      effectivenessVerified: true,
      canApproveClosure: true,
    });
    expect(closeVerified.allowed).toBe(true);
    expect(closeVerified.effectiveStatus).toBe('CERRADA');

    // Reopening requires justification
    const reopenNoReason = validateActionPlanUpdate({
      existing: { ...basePlan, status: 'CERRADA' },
      nextStatus: 'REABIERTA',
      nextProgressPct: 100,
      canApproveClosure: true,
      reopenNotes: '',
    });
    expect(reopenNoReason.allowed).toBe(false);
  });

  it('exige justificación y facultad de aprobación para marcar obligación como NO_APLICABLE', () => {
    expect(validateNonApplicableObligation({ justification: 'corto', canApprove: true }).allowed).toBe(false);
    expect(
      validateNonApplicableObligation({
        justification: 'La entidad no realiza operaciones cambiarias reguladas por esta circular.',
        canApprove: false,
      }).allowed
    ).toBe(false);
    expect(
      validateNonApplicableObligation({
        justification: 'La entidad no realiza operaciones cambiarias reguladas por esta circular.',
        canApprove: true,
      }).allowed
    ).toBe(true);
  });

  it('aplica RBAC granular en REGULA y bloquea siempre a EXTERNAL_CLIENT', () => {
    const cfg = buildDefaultRegulaConfig({ organizationId: 'org1' });
    const extUser = { uid: 'ext1', role: 'EXTERNAL_CLIENT', displayName: 'Cliente', email: 'c@x.com' } as UserProfile;
    const auditorUser = { uid: 'aud1', role: 'AUDITOR', displayName: 'Auditor', email: 'a@x.com' } as UserProfile;

    expect(hasRegulaPermission({ user: extUser, config: cfg, section: 'dashboard', action: 'ver' })).toBe(false);
    expect(hasRegulaPermission({ user: auditorUser, config: cfg, section: 'auditoria', action: 'crear' })).toBe(true);
    expect(hasRegulaPermission({ user: auditorUser, config: cfg, section: 'configuracion', action: 'configurar' })).toBe(false);
  });

  it('genera datasets válidos para los 18 reportes institucionales de REGULA y alertas prioritarias deduplicadas', () => {
    const data = createEmptyRegulaWorkspaceData();
    const filters = {
      branch: '',
      department: '',
      responsible: '',
      dateFrom: '',
      dateTo: '',
      category: '',
      riskLevel: '',
      status: '',
    };

    expect(REGULA_REPORT_CATALOG).toHaveLength(18);
    for (const rep of REGULA_REPORT_CATALOG) {
      const ds = buildRegulaReportDataset({
        reportCode: rep.code,
        data,
        filters,
        organizationName: 'Financiera Demo',
        generatedByName: 'Oficial Cumplimiento',
        todayIso,
      });
      expect(ds.code).toBe(rep.code);
      expect(ds.columns.length).toBeGreaterThan(0);
    }

    const alerts = deriveRegulaPriorityAlerts(data, todayIso);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('habilita acceso multi-tenant y RBAC a REGULA para todos los roles internos y bloquea EXTERNAL_CLIENT', () => {
    expect(resolveModuleForNavSection('regula')).toBe('regula');
    expect(SU_GLORIA_ENABLED_MODULES).toContain('regula');
    expect(COMMERCIAL_PLANS_CATALOG.EMPRESARIAL.includedModules).toContain('regula');
    expect(COMMERCIAL_PLANS_CATALOG.CORPORATIVO.includedModules).toContain('regula');

    const tenantAccess = checkTenantSectionAccess({
      section: 'regula',
      organization: SU_GLORIA_MANO_AMIGA_ORG,
      isSuperAdmin: false,
    });
    expect(tenantAccess.allowed).toBe(true);

    const internalRoles: UserRole[] = [
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
    ];
    for (const role of internalRoles) {
      expect(canRoleAccessSection(role, 'regula')).toBe(true);
    }
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'regula')).toBe(false);
  });
});
