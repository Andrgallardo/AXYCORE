import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_V2, evaluateCreditDecisionV2 } from '../engine/decisionEngineV2';
import {
  canExecuteDisbursement,
  canUserApproveCommittee,
  evaluateCollegialCommitteeVotes,
  normalizeRiskBandCode,
} from '../engine/workflowGuards';
import { formatRatePct, formatUserFacingError, normalizeMonthlyRateDecimal } from '../utils/formatters';
import {
  appendMovementHistory,
  buildApplicationConsentPayload,
  buildMaterializedApplicationPayload,
  hasApplicationSchemaDrift,
  sanitizeFirestorePayload,
  sanitizeScoringExecutionPayload,
} from '../services/axycoreStore';
import type {
  ApplicationRecord,
  CommitteeDecisionRecord,
  CustomerRecord,
  FormalizationRecord,
  MovementHistoryEntry,
} from '../types/axycore';

describe('Loan Origination & Lifecycle Flow Regression Suite', () => {
  it('deeply removes undefined values from nested objects and movementHistory arrays while preserving Date and sentinel instances', () => {
    class MockFieldValueSentinel {
      readonly _methodName = 'serverTimestamp';
    }
    const sentinel = new MockFieldValueSentinel();
    const now = new Date('2026-11-19T10:00:00.000Z');

    const payload = {
      status: 'EN_EVALUACION',
      updatedAt: sentinel,
      createdDate: now,
      undefinedTopLevel: undefined,
      nested: {
        keep: 42,
        dropMe: undefined,
        deepArr: [
          { action: 'Pasar a Evaluación', note: undefined, extra: 'ok' },
          undefined,
        ],
      },
    };

    const cleaned = sanitizeFirestorePayload(payload) as Record<string, unknown>;
    expect('undefinedTopLevel' in cleaned).toBe(false);
    expect(cleaned.updatedAt).toBe(sentinel);
    expect(cleaned.createdDate).toBe(now);

    const nested = cleaned.nested as Record<string, unknown>;
    expect('dropMe' in nested).toBe(false);
    const deepArr = nested.deepArr as Array<Record<string, unknown>>;
    expect(deepArr).toHaveLength(1);
    expect('note' in deepArr[0]).toBe(false);
    expect(deepArr[0].action).toBe('Pasar a Evaluación');
    expect(deepArr[0].extra).toBe('ok');
  });

  it('appendMovementHistory omits empty/undefined notes and caps entries to Firestore max 50', () => {
    const existing: MovementHistoryEntry[] = Array.from({ length: 52 }, (_, idx) => ({
      timestamp: `2026-11-01T00:00:${String(idx % 60).padStart(2, '0')}Z`,
      action: `Evento ${idx}`,
      toStatus: 'RECIBIDA',
      userId: 'usr_1',
      userName: 'Sistema',
      note: idx % 2 === 0 ? undefined : `Nota ${idx}`,
    }));

    const updated = appendMovementHistory(existing, {
      timestamp: '2026-11-19T12:00:00Z',
      action: 'Enviada directamente a Evaluación (aprobada monto íntegro por Motor V2)',
      fromStatus: 'RECIBIDA',
      toStatus: 'EN_EVALUACION',
      userId: 'usr_admin',
      userName: 'Admin',
      note: '   ',
    });

    expect(updated).toHaveLength(50);
    const last = updated[updated.length - 1];
    expect(last.toStatus).toBe('EN_EVALUACION');
    expect('note' in last).toBe(false);
    for (const item of updated) {
      expect(Object.values(item).includes(undefined as unknown as string)).toBe(false);
    }
  });

  it('normalizes legacy percentage monthly rates (> 1) to decimal and formats them properly', () => {
    expect(normalizeMonthlyRateDecimal(5)).toBeCloseTo(0.05, 6);
    expect(normalizeMonthlyRateDecimal(4.5)).toBeCloseTo(0.045, 6);
    expect(normalizeMonthlyRateDecimal(0.05)).toBeCloseTo(0.05, 6);
    expect(normalizeMonthlyRateDecimal(0.035)).toBeCloseTo(0.035, 6);
    expect(normalizeMonthlyRateDecimal(null, 0.04)).toBeCloseTo(0.04, 6);

    expect(formatRatePct(5)).toBe('5.00%');
    expect(formatRatePct(0.05)).toBe('5.00%');
    expect(formatRatePct(0.04)).toBe('4.00%');
  });

  it('normalizes legacy risk band letters (A-F) and evaluates committee authority accurately', () => {
    expect(normalizeRiskBandCode('A')).toBe('MUY_BAJO');
    expect(normalizeRiskBandCode('B')).toBe('BAJO');
    expect(normalizeRiskBandCode('C')).toBe('MODERADO');
    expect(normalizeRiskBandCode('D')).toBe('MEDIO_ALTO');
    expect(normalizeRiskBandCode('E')).toBe('ALTO');
    expect(normalizeRiskBandCode('F')).toBe('CRITICO');
    expect(normalizeRiskBandCode('Riesgo Bajo')).toBe('BAJO');

    const migratedApp: ApplicationRecord = {
      id: 'app_mig_giordanny',
      organizationId: 'org_su_gloria_mano_amiga',
      applicationNumber: 'SOL-MIG-001',
      fileNumber: 'EXP-MIG-001',
      channel: 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: 'cust_mig_giordanny',
      applicantDisplayName: 'GIORDANNY DE JESUS FERNANDEZ MIRANDA',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 25000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Personal',
      loanPurposeDescription: 'Migrado',
      financialData: {
        employerOrBusinessName: 'Empleador',
        occupationOrRole: 'Empleado',
        employmentMonths: 24,
        incomeSourceType: 'FIJA_RECURRENTE',
        primaryNetIncome: 45000,
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 45000,
        incomeCurrency: 'DOP',
        essentialExpenses: 18000,
        housingPayment: 6000,
        housingIncludedInExpenses: true,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        debtCount: 0,
        totalDebtBalance: 0,
        currentDebtPayments: 0,
      },
      references: [
        { name: 'Ref Uno', relationship: 'Familiar', phone: '8095550001' },
        { name: 'Ref Dos', relationship: 'Laboral', phone: '8095550002' },
      ],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'EN_COMITE',
      prequalificationStatus: 'PREOFERTA',
      latestScore: 78,
      latestRiskBand: 'B',
      recommendedAmount: 25000,
      recommendedRateMonthly: 5,
      recommendedTermMonths: 12,
      recommendedInstallment: 2800,
      consentVersion: 'v1',
      consentAcceptedAt: '2026-10-08T12:00:00Z',
      movementHistory: [],
      createdBy: 'usr_officer',
      createdAt: '2026-10-08T12:00:00Z',
      updatedAt: '2026-10-08T12:00:00Z',
    };

    const testPolicy = {
      ...DEFAULT_POLICY_V2,
      approvalAuthorities: [
        {
          id: 'auth_cm_bajo',
          role: 'COMMITTEE_MEMBER' as const,
          productCode: 'ALL' as const,
          maxAmount: 500000,
          allowedRiskBands: ['MUY_BAJO', 'BAJO', 'MODERADO'] as Array<'MUY_BAJO' | 'BAJO' | 'MODERADO'>,
          requiresCollegialApproval: true,
          minVotesRequired: 2,
          active: true,
        },
      ],
      createdBy: 'usr_admin',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };

    const check = canUserApproveCommittee({
      userRole: 'COMMITTEE_MEMBER',
      userId: 'usr_committee_1',
      application: migratedApp,
      proposedAmount: 25000,
      policy: testPolicy,
    });
    expect(check.allowed).toBe(true);
  });

  it('completes end-to-end credit decision V2 -> 2-of-3 committee quorum -> disbursement pre-check', () => {
    const customer: CustomerRecord = {
      id: 'cust_e2e_1',
      organizationId: 'org_su_gloria_mano_amiga',
      documentType: 'CEDULA',
      documentNumber: '40211223344',
      documentKey: 'org_su_gloria_mano_amiga_CEDULA_40211223344',
      firstName: 'Giordanny',
      lastName: 'Fernandez Miranda',
      phone: '8095559988',
      email: 'giordanny@example.com',
      address: 'Av. Winston Churchill 100, Santo Domingo',
      residenceMonths: 36,
      housingType: 'ALQUILADA',
      housingPayment: 10000,
      socialMediaDeclared: 'YES',
      socialMediaHandle: '@giordanny',
      createdBy: 'usr_officer',
      createdAt: '2026-11-19T00:00:00Z',
      updatedAt: '2026-11-19T00:00:00Z',
    };

    const application: ApplicationRecord = {
      id: 'app_e2e_1',
      organizationId: 'org_su_gloria_mano_amiga',
      applicationNumber: 'SOL-E2E-001',
      fileNumber: 'EXP-E2E-001',
      channel: 'INTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: customer.id,
      applicantDisplayName: 'Giordanny Fernandez Miranda',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 50000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Consolidación',
      loanPurposeDescription: 'Capital de trabajo personal',
      financialData: {
        employerOrBusinessName: 'Empresa RD',
        occupationOrRole: 'Supervisor',
        employmentMonths: 36,
        incomeSourceType: 'FIJA_RECURRENTE',
        primaryNetIncome: 85000,
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 85000,
        incomeCurrency: 'DOP',
        essentialExpenses: 25000,
        housingPayment: 10000,
        housingIncludedInExpenses: true,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        debtCount: 0,
        totalDebtBalance: 0,
        currentDebtPayments: 0,
      },
      references: [
        { name: 'Ref 1', relationship: 'Familiar', phone: '8095550001' },
        { name: 'Ref 2', relationship: 'Laboral', phone: '8095550002' },
      ],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'RECIBIDA',
      consentVersion: 'v1',
      consentAcceptedAt: '2026-11-19T00:00:00Z',
      movementHistory: [],
      createdBy: 'usr_officer',
      createdAt: '2026-11-19T00:00:00Z',
      updatedAt: '2026-11-19T00:00:00Z',
    };

    const scoring = evaluateCreditDecisionV2({
      application,
      customer,
      policy: DEFAULT_POLICY_V2,
      executionTrigger: 'INITIAL_SUBMIT',
      executedBy: 'usr_officer',
      executedByName: 'Oficial',
    });

    expect(scoring.indicatorDetails).toHaveLength(22);
    expect(scoring.status).toBe('PREOFERTA');
    expect(scoring.recommendedAmount).toBeGreaterThanOrEqual(50000);
    expect(scoring.recommendedRateMonthly).toBeLessThan(1);

    const votes = evaluateCollegialCommitteeVotes(
      [
        {
          userId: 'cm_1',
          userName: 'Miembro 1',
          role: 'COMMITTEE_MEMBER',
          vote: 'APROBADO',
          votedAt: '2026-11-19T01:00:00Z',
        },
        {
          userId: 'cm_2',
          userName: 'Miembro 2',
          role: 'ADMIN',
          vote: 'APROBADO',
          votedAt: '2026-11-19T01:05:00Z',
        },
      ],
      2,
      3
    );
    expect(votes.approveCount).toBe(2);
    expect(votes.resolvedDecision).toBe('APROBADO');

    const decision: CommitteeDecisionRecord = {
      id: 'dec_e2e_1',
      organizationId: application.organizationId,
      applicationId: application.id,
      decision: 'APROBADO',
      approvedAmount: 50000,
      approvedRateMonthly: scoring.recommendedRateMonthly,
      approvedTermMonths: 12,
      approvedFrequency: 'MENSUAL',
      approvedAmortizationMethod: 'SALDO_INSOLUTO',
      conditions: [],
      conditionsFulfilled: true,
      rejectionReason: null,
      observations: 'Aprobado en comité 2/3',
      authorityUsed: 'Comité',
      collegialVotes: votes.uniqueVotes,
      voteStatus: 'RESOLUCION_FINAL',
      decidedBy: 'cm_2',
      decidedByName: 'Miembro 2',
      decidedByRole: 'ADMIN',
      decidedAt: '2026-11-19T01:05:00Z',
      isImmutable: true,
    };

    const formalization: FormalizationRecord = {
      id: `form_${application.id}`,
      organizationId: application.organizationId,
      applicationId: application.id,
      decisionId: decision.id,
      approvedCapital: 50000,
      financedExpenses: 0,
      totalFinanced: 50000,
      deductedExpenses: 0,
      netDisbursementAmount: 50000,
      contractualRateMonthly: scoring.recommendedRateMonthly,
      termMonths: 12,
      frequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      disbursementTargetDate: '2026-11-19',
      firstPaymentDate: '2026-12-19',
      maturityDate: '2027-11-19',
      totalContractualPayable: 63000,
      contractTemplateVersion: 'tpl-v1',
      contractText: 'Contrato',
      promissoryNoteText: 'Pagare',
      requiredDocsChecklist: [
        { key: 'id_doc', label: 'ID', completed: true },
        { key: 'contract_signed', label: 'Contrato', completed: true },
      ],
      conditionsFulfilled: true,
      signatures: [],
      collateralDetails: '',
      legalReviewConfirmed: true,
      promissoryNoteConfirmed: true,
      contractConfirmed: true,
      status: 'LISTA_PARA_DESEMBOLSO',
      formalizedBy: 'usr_form',
      formalizedByName: 'Formalizador',
      createdAt: '2026-11-19T01:10:00Z',
      updatedAt: '2026-11-19T01:10:00Z',
    };

    const disbCheck = canExecuteDisbursement({
      userRole: 'FINANCE',
      application: { ...application, status: 'FORMALIZADA' },
      decision,
      formalization,
      existingDisbursementId: null,
    });
    expect(disbCheck.allowed).toBe(true);
  });

  it('materializes Giordanny live WEB application cleanly to EN_EVALUACION with zero schema drift and repairs corrupt legacy fields', () => {
    const giordannyApp: ApplicationRecord = {
      id: 'WEB-3C463C499EFD4CBBBF3A08DFDFE9583D',
      organizationId: 'org_axycore_main',
      applicationNumber: 'WEB-3C463C499EFD4CBBBF3A08DFDFE9583D',
      fileNumber: 'EXP-WEB-3C463C499EFD4CBBBF3A08DFDFE9583D',
      channel: 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: 'CW-3C463C499EFD4CBBBF3A08DFDFE9583D',
      applicantDisplayName: 'Giordanny de Jesús Fernandez Miranda',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 400000,
      requestedTermMonths: 36,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'INTERES_FIJO',
      loanPurpose: 'Consolidación de deudas',
      loanPurposeDescription: 'Pago de deudas e inversiones',
      proposedCollateral: 'Garantía Pagaré Notarial',
      financialData: {
        activityType: 'Empleado',
        employerOrBusinessName: 'Sns y asistente quirurgico',
        occupationOrRole: 'Médico',
        employmentMonths: 96,
        incomeSourceType: 'MIXTA_RECURRENTE',
        primaryNetIncome: 190000,
        additionalIncomeStatus: 'QUANTIFIED',
        additionalNetIncome: 15000,
        declaredTotalMonthlyIncome: 205000,
        incomeCurrency: 'DOP',
        essentialExpenses: 110000,
        housingPayment: 0,
        housingIncludedInExpenses: true,
        debtDeclarationStatus: 'HAS_DEBTS',
        debtCount: 5,
        totalDebtBalance: 360000,
        currentDebtPayments: 35000,
        cardDebtPayment: 0,
        informalDebtPayment: 35000,
      },
      references: [
        { name: 'Giovanny fernandez', relationship: 'Hermano/a', phone: '8494471847', verified: false },
        { name: 'Samuel Cabrera', relationship: 'Vecino/a', phone: '8098837816', verified: false },
      ],
      declaredDocumentsSummary: {
        hasIdentityDoc: true,
        hasIncomeEvidence: false,
        hasAddressProof: true,
        hasCorporateDocs: false,
      },
      status: 'RECIBIDA',
      prequalificationStatus: 'PREOFERTA',
      latestScore: 67,
      latestRiskBand: 'MODERADO',
      recommendedAmount: 400000,
      recommendedRateMonthly: 0.04,
      recommendedTermMonths: 36,
      recommendedInstallment: 0,
      consentVersion: 'v2.0-migrated',
      consentAcceptedAt: '2026-11-16T13:02:57.000Z',
      movementHistory: [
        {
          timestamp: '2026-11-16T13:02:57.000Z',
          userId: 'system_migrator',
          userName: 'Su Gloria Mano Amiga',
          fromStatus: 'RECIBIDA',
          toStatus: 'RECIBIDA',
          action: 'Recepción integral de expediente histórico en plataforma',
          note: 'Expediente sincronizado con historial financiero.',
        },
      ],
      createdBy: 'system_migrator',
      createdByName: 'Su Gloria Mano Amiga',
      createdAt: '2026-11-16T13:02:57.000Z',
      updatedAt: '2026-11-16T13:02:57.000Z',
    };

    const nextHistory = appendMovementHistory(giordannyApp.movementHistory, {
      timestamp: '2026-11-19T13:20:00.000Z',
      action: 'Solicitud aprobada por Motor de Decisiones -> pasa directamente a Evaluación',
      fromStatus: 'RECIBIDA',
      toStatus: 'EN_EVALUACION',
      userId: 'admin_uid_1',
      userName: 'Andry Gallardo',
      note: null,
    });

    const materialized = buildMaterializedApplicationPayload(
      giordannyApp,
      { status: 'EN_EVALUACION', movementHistory: nextHistory },
      'admin_uid_1',
      'Andry Gallardo',
      {
        preserveOrganizationId: 'org_axycore_main',
        preserveCreatedBy: 'admin_uid_1',
        preserveCreatedAt: '2026-11-16T13:02:57.000Z',
      }
    );

    expect(materialized.status).toBe('EN_EVALUACION');
    expect(materialized.recommendedRateMonthly).toBeCloseTo(0.04, 6);
    expect(hasApplicationSchemaDrift(materialized, giordannyApp.id)).toBe(false);

    // Detect drift on corrupt legacy doc (shadow field + empty latestScoringExecutionId)
    const corruptLegacyDoc: Record<string, unknown> = {
      ...materialized,
      legacyExtraField: 'not_allowed_in_rules',
      latestScoringExecutionId: '',
    };
    expect(hasApplicationSchemaDrift(corruptLegacyDoc, giordannyApp.id)).toBe(true);

    // Self-heal strips shadow key & normalizes empty latestScoringExecutionId to null
    const repaired = buildMaterializedApplicationPayload(
      { ...giordannyApp, latestScoringExecutionId: '' },
      { status: 'EN_EVALUACION', movementHistory: nextHistory },
      'admin_uid_1',
      'Andry Gallardo',
      {
        preserveOrganizationId: 'org_axycore_main',
        preserveCreatedBy: 'system_migrator',
        preserveCreatedAt: '2026-11-16T13:02:57.000Z',
      }
    );
    expect('legacyExtraField' in repaired).toBe(false);
    expect(repaired.latestScoringExecutionId).toBeNull();
    expect(repaired.createdBy).toBe('system_migrator');
    expect(hasApplicationSchemaDrift(repaired, giordannyApp.id)).toBe(false);

    // Detect drift on subtle legacy anomalies (null financialData, bad createdAt, oversized strings)
    expect(
      hasApplicationSchemaDrift(
        { ...materialized, financialData: null },
        giordannyApp.id
      )
    ).toBe(true);
    expect(
      hasApplicationSchemaDrift(
        { ...materialized, createdAt: '' },
        giordannyApp.id
      )
    ).toBe(true);
    expect(
      hasApplicationSchemaDrift(
        { ...materialized, loanPurpose: 'X'.repeat(140) },
        giordannyApp.id
      )
    ).toBe(true);

    const healedEdgeCases = buildMaterializedApplicationPayload(
      {
        ...giordannyApp,
        loanPurpose: 'X'.repeat(140),
        financialData: null as unknown as ApplicationRecord['financialData'],
        declaredDocumentsSummary: null as unknown as ApplicationRecord['declaredDocumentsSummary'],
        recommendedInstallment: 'NaN' as unknown as number,
      },
      { status: 'EN_EVALUACION', movementHistory: nextHistory },
      'admin_uid_1',
      'Andry Gallardo',
      {
        preserveOrganizationId: 'org_axycore_main',
        preserveCreatedBy: 'system_migrator',
        preserveCreatedAt: '',
      }
    );
    expect(String(healedEdgeCases.loanPurpose).length).toBeLessThanOrEqual(120);
    expect('financialData' in healedEdgeCases).toBe(false);
    expect('declaredDocumentsSummary' in healedEdgeCases).toBe(false);
    expect(healedEdgeCases.recommendedInstallment).toBeNull();
    expect(hasApplicationSchemaDrift(healedEdgeCases, giordannyApp.id)).toBe(false);
  });

  it('formats structured FirestoreErrorInfo JSON into readable Spanish messages for UI feedback', () => {
    const jsonErr = new Error(
      JSON.stringify({
        error: 'Missing or insufficient permissions.',
        operationType: 'write',
        path: 'applications/WEB-3C463C499EFD4CBBBF3A08DFDFE9583D',
        authInfo: { userId: 'u1' },
      })
    );
    const formatted = formatUserFacingError(jsonErr, 'Error genérico');
    expect(formatted).toContain('Permisos insuficientes o estado inconsistente');
    expect(formatted).toContain('applications/WEB-3C463C499EFD4CBBBF3A08DFDFE9583D');
    expect(formatted.startsWith('{')).toBe(false);
  });

  it('sanitizes scoring_executions payloads strictly to the 24 Firestore-allowed keys and clamps bounds', () => {
    const allowedKeys = new Set([
      'id',
      'organizationId',
      'applicationId',
      'policyId',
      'policyVersion',
      'policyStatus',
      'executionTrigger',
      'inputSnapshot',
      'capacityResult',
      'totalScore',
      'riskBand',
      'status',
      'recommendedAmount',
      'recommendedRateMonthly',
      'recommendedTermMonths',
      'recommendedInstallment',
      'favorableFactors',
      'alerts',
      'missingData',
      'currencyStressResults',
      'indicatorDetails',
      'executedBy',
      'executedByName',
      'executedAt',
    ]);

    const raw = {
      id: 'exec_1795096682020_test01',
      organizationId: 'org_axycore_main',
      applicationId: 'app_1795096682020_hukuo5',
      policyId: null,
      policyVersion: 'v'.repeat(80),
      policyStatus: 'EN_PRUEBAS_EXTENDED_VALUE_THAT_EXCEEDS_40_CHARACTERS',
      executionTrigger: 'INITIAL_SUBMIT' as const,
      inputSnapshot: { requestedAmount: 100000 },
      capacityResult: {
        eligibleIncome: 75000,
        essentialExpenses: 28000,
        currentDebtPayments: 0,
        availableFlow: 47000,
        currentDti: 0,
        projectedDti: 0.14,
        maxInstallmentAllowed: 22000,
        simulatedReferenceInstallment: 10500,
        simulatedReferenceCoverage: 2.1,
        sustainablePrincipalAtBandRate: 150000,
        incomeCurrency: 'DOP' as const,
        loanCurrency: 'DOP' as const,
        exchangeRateUsed: 1,
      },
      totalScore: 145,
      riskBand: { code: 'BAJO' as const, label: 'Riesgo Bajo', minScore: 70, maxScore: 84 },
      status: 'PREOFERTA' as const,
      recommendedAmount: 100000,
      recommendedRateMonthly: 4.5,
      recommendedTermMonths: 12,
      recommendedInstallment: 10500,
      favorableFactors: Array.from({ length: 40 }, (_, i) => `Factor ${i}`),
      alerts: Array.from({ length: 40 }, (_, i) => `Alerta ${i}`),
      missingData: Array.from({ length: 35 }, (_, i) => `Faltante ${i}`),
      currencyStressResults: null,
      indicatorDetails: Array.from({ length: 22 }, (_, i) => ({
        id: `IND_${i + 1}`,
        name: `Indicador ${i + 1}`,
        category: 'Capacidad',
        rawValue: 1,
        points: 4,
        maxPoints: 5,
        explanation: 'OK',
      })),
      executedBy: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
      executedByName: null,
      unexpectedExtraField: 'must_be_stripped',
    };

    const sanitized = sanitizeScoringExecutionPayload(raw as unknown as Parameters<typeof sanitizeScoringExecutionPayload>[0]);
    for (const key of Object.keys(sanitized)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect('unexpectedExtraField' in sanitized).toBe(false);
    expect('policyId' in sanitized).toBe(false);
    expect(sanitized.policyVersion.length).toBeLessThanOrEqual(40);
    expect(sanitized.policyStatus.length).toBeLessThanOrEqual(40);
    expect(sanitized.totalScore).toBe(100);
    expect(sanitized.recommendedRateMonthly).toBeCloseTo(0.045, 6);
    expect(sanitized.favorableFactors).toHaveLength(30);
    expect(sanitized.alerts).toHaveLength(30);
    expect(sanitized.missingData).toHaveLength(30);
    expect(sanitized.indicatorDetails).toHaveLength(22);
    expect(typeof sanitized.executedByName).toBe('string');
    expect((sanitized.executedByName || '').length).toBeGreaterThan(0);
  });

  it('builds application_consents payload with exact 9 Firestore keys and valid string bounds', () => {
    const shortConsent = buildApplicationConsentPayload({
      consentId: 'cons_1795096682020_a1',
      organizationId: 'org_axycore_main',
      applicationId: 'app_1795096682020_hukuo5',
      customerId: 'cust_1795096682020_c1',
      consentVersion: '',
      consentText: 'ok',
      acceptedBy: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
    });

    expect(Object.keys(shortConsent).sort()).toEqual([
      'accepted',
      'acceptedAt',
      'acceptedBy',
      'acceptedText',
      'applicationId',
      'consentVersion',
      'customerId',
      'id',
      'organizationId',
    ]);
    expect(shortConsent.accepted).toBe(true);
    expect(String(shortConsent.consentVersion).length).toBeGreaterThanOrEqual(1);
    expect(String(shortConsent.consentVersion).length).toBeLessThanOrEqual(40);
    expect(String(shortConsent.acceptedText).length).toBeGreaterThanOrEqual(10);
    expect(String(shortConsent.acceptedText).length).toBeLessThanOrEqual(2000);

    const longConsent = buildApplicationConsentPayload({
      consentId: 'cons_1795096682020_a2',
      organizationId: 'org_axycore_main',
      applicationId: 'app_1795096682020_hukuo5',
      customerId: 'cust_1795096682020_c1',
      consentVersion: 'v'.repeat(100),
      consentText: 'Términos legales '.repeat(250),
      acceptedBy: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
    });
    expect(String(longConsent.consentVersion).length).toBe(40);
    expect(String(longConsent.acceptedText).length).toBe(2000);
  });

  it('materializes Client Portal EXTERNAL application submissions with zero schema drift', () => {
    const portalApp: ApplicationRecord = {
      id: 'app_1795096682020_hukuo5',
      organizationId: 'org_axycore_main',
      applicationNumber: 'SOL-2026-682020',
      fileNumber: 'EXP-2026-682020',
      channel: 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: 'cust_1795096682020_x1',
      businessId: null,
      applicantDisplayName: 'Juan Carlos Perez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 100000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Capital / Consumo personal '.repeat(10),
      loanPurposeDescription: 'Descripción detallada '.repeat(80),
      proposedCollateral: 'Vehículo '.repeat(80),
      financialData: {
        activityType: 'Empleado privado',
        employerOrBusinessName: 'ACME SRL',
        occupationOrRole: 'Analista',
        employmentMonths: 24,
        incomeSourceType: 'FIJA_RECURRENTE',
        primaryNetIncome: 75000,
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 75000,
        incomeCurrency: 'DOP',
        essentialExpenses: 28000,
        housingPayment: 0,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        debtCount: 0,
        totalDebtBalance: 0,
        currentDebtPayments: 0,
      },
      businessFinancialData: null,
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'RECIBIDA',
      consentVersion: 'v1.0-Ley172-13',
      consentAcceptedAt: '2026-11-19T14:00:00.000Z',
      createdBy: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
      createdByName: '',
    };

    const materialized = buildMaterializedApplicationPayload(
      portalApp,
      {
        status: 'RECIBIDA',
        prequalificationStatus: 'PREOFERTA',
        latestScore: 81,
        latestRiskBand: 'BAJO',
        recommendedAmount: 100000,
        recommendedRateMonthly: 0.035,
        recommendedTermMonths: 12,
        recommendedInstallment: 10300,
        latestScoringExecutionId: 'exec_1795096682020_sc1',
        movementHistory: [
          {
            timestamp: '2026-11-19T14:00:00.000Z',
            action: 'Solicitud enviada y precalificada por Motor V2 (PREOFERTA, score 81)',
            toStatus: 'RECIBIDA',
            userId: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
            userName: 'Andry Gallardo',
          },
        ],
      },
      'I6NwYEE654OZ11IHe4c3L1FrpIM2',
      'Andry Gallardo',
      {
        preserveOrganizationId: 'org_axycore_main',
        preserveCreatedBy: 'I6NwYEE654OZ11IHe4c3L1FrpIM2',
      }
    );

    expect(hasApplicationSchemaDrift(materialized, portalApp.id)).toBe(false);
    expect(String(materialized.loanPurpose).length).toBeLessThanOrEqual(120);
    expect(String(materialized.loanPurposeDescription).length).toBeLessThanOrEqual(1000);
    expect(String(materialized.proposedCollateral).length).toBeLessThanOrEqual(500);
    expect(materialized.channel).toBe('EXTERNAL');
  });
});
