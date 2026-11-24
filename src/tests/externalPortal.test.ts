import { describe, expect, it } from 'vitest';
import {
  buildCustomerDocumentKey,
  buildExternalPortalShareMessage,
  buildInstitutionExternalPortalLinks,
  buildPhoneFormatCandidates,
  buildPublicPortalRecordFromOrg,
  CLIENT_SERVICE_REQUEST_CATALOG,
  computeIndicativePublicInstallment,
  generateUniquePortalCodeForOrg,
  getServiceRequestCatalogItem,
  normalizeDocumentDigits,
  normalizePortalCode,
  parseExternalPortalLinkFromLocation,
  validatePublicCreditApplicationPayload,
} from '../engine/externalPortalEngine';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import {
  buildOriginalRequestedConditions,
  runIntegratedDecisionAndCalculation,
} from '../engine/integratedCreditEngine';
import { buildCriticalAuditEntryPayload } from '../engine/criticalAudit';
import {
  buildApplicationConsentPayload,
  buildMaterializedApplicationPayload,
  sanitizeScoringExecutionPayload,
} from '../services/axycoreStore';
import type { ApplicationRecord, CustomerRecord, OrganizationRecord } from '../types/axycore';

const MOCK_ORG: OrganizationRecord = {
  id: 'org_horizonte_01',
  organizationId: 'org_horizonte_01',
  tenantId: 'financiera-horizonte',
  accessCode: 'HORZ-002',
  name: 'Financiera Horizonte, S.R.L.',
  tradeName: 'Financiera Horizonte',
  taxId: '1-31-99887-2',
  country: 'República Dominicana',
  currency: 'DOP',
  primaryColor: '#0f3d91',
  accentColor: '#0284c7',
  phone: '809-555-0199',
  corporateEmail: 'servicio@horizonte.do',
  primaryAdminEmail: 'admin-secreto@horizonte.do',
  notes: 'Nota interna confidencial',
  status: 'ACTIVA',
};

describe('External Institution Portal Engine', () => {
  it('normalizes portal codes and builds unique per-institution external links', () => {
    expect(normalizePortalCode('  sgma-001 ')).toBe('SGMA-001');
    const links = buildInstitutionExternalPortalLinks(MOCK_ORG, 'https://app.axycore.com');
    expect(links.portalCode).toBe('HORZ-002');
    expect(links.portalUrl).toBe('https://app.axycore.com/?portal=HORZ-002');
    expect(links.creditApplicationUrl).toBe('https://app.axycore.com/?portal=HORZ-002&action=solicitud');
    expect(links.registerUrl).toBe('https://app.axycore.com/?portal=HORZ-002&action=registro');
  });

  it('parses ?portal=, ?empresa=, and /portal/<CODE> URLs with action intents', () => {
    expect(parseExternalPortalLinkFromLocation('?portal=HORZ-002&action=solicitud', '/')).toEqual({
      portalCode: 'HORZ-002',
      actionIntent: 'solicitud',
      isExternalInstitutionLink: true,
    });

    expect(parseExternalPortalLinkFromLocation('?action=registro', '/portal/sgma-001')).toEqual({
      portalCode: 'SGMA-001',
      actionIntent: 'registro',
      isExternalInstitutionLink: true,
    });

    expect(parseExternalPortalLinkFromLocation('?empresa=coop-007', '/')).toEqual({
      portalCode: 'COOP-007',
      actionIntent: 'portal',
      isExternalInstitutionLink: true,
    });

    expect(parseExternalPortalLinkFromLocation('', '/')).toEqual({
      portalCode: null,
      actionIntent: 'portal',
      isExternalInstitutionLink: false,
    });
  });

  it('builds a strictly PII-free PublicInstitutionPortalRecord without leaking admin emails, taxId, or internal notes', () => {
    const pub = buildPublicPortalRecordFromOrg(MOCK_ORG, {
      welcomeHeadline: 'Bienvenido a Horizonte',
    });

    expect(pub.portalCode).toBe('HORZ-002');
    expect(pub.organizationId).toBe('org_horizonte_01');
    expect(pub.tradeName).toBe('Financiera Horizonte');
    expect(pub.currency).toBe('DOP');
    expect(pub.phone).toBe('809-555-0199');
    expect(pub.corporateEmail).toBe('servicio@horizonte.do');
    expect(pub.portalEnabled).toBe(true);
    expect(pub.welcomeHeadline).toBe('Bienvenido a Horizonte');
    expect((pub as unknown as Record<string, unknown>).primaryAdminEmail).toBeUndefined();
    expect((pub as unknown as Record<string, unknown>).taxId).toBeUndefined();
    expect((pub as unknown as Record<string, unknown>).notes).toBeUndefined();
  });

  it('propagates valid institutional logos per organization and strips invalid or unsafe logo URLs', () => {
    const sampleDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const withDataUri = buildPublicPortalRecordFromOrg({
      ...MOCK_ORG,
      logoUrl: `  ${sampleDataUri}  `,
    });
    expect(withDataUri.logoUrl).toBe(sampleDataUri);

    const withHttps = buildPublicPortalRecordFromOrg({
      ...MOCK_ORG,
      id: 'org_coop_02',
      organizationId: 'org_coop_02',
      accessCode: 'COOP-002',
      logoUrl: 'https://cdn.coop.do/assets/logo.png',
    });
    expect(withHttps.logoUrl).toBe('https://cdn.coop.do/assets/logo.png');
    expect(withHttps.portalCode).toBe('COOP-002');
    expect(withHttps.organizationId).toBe('org_coop_02');

    const withUnsafeLogo = buildPublicPortalRecordFromOrg({
      ...MOCK_ORG,
      logoUrl: 'javascript:alert(1)',
    });
    expect(withUnsafeLogo.logoUrl).toBeUndefined();

    const parsedLogin = parseExternalPortalLinkFromLocation('?portal=COOP-002&action=ingresar', '/');
    expect(parsedLogin).toEqual({
      portalCode: 'COOP-002',
      actionIntent: 'ingresar',
      isExternalInstitutionLink: true,
    });
  });

  it('normalizes Dominican cédula keys and phone format candidates consistently for Zero-Trust linking', () => {
    expect(normalizeDocumentDigits('001-1234567-8')).toBe('00112345678');
    expect(buildCustomerDocumentKey('org_horizonte_01', '001-1234567-8', 'CEDULA')).toBe(
      'org_horizonte_01_CEDULA_00112345678'
    );

    const candidates = buildPhoneFormatCandidates('8095550199');
    expect(candidates).toContain('8095550199');
    expect(candidates).toContain('809-555-0199');
    expect(candidates).toContain('(809) 555-0199');
    expect(candidates).toContain('1-809-555-0199');
  });

  it('exposes a complete catalog of 8 client self-service request types including AYUDA_ATRASO', () => {
    expect(CLIENT_SERVICE_REQUEST_CATALOG.length).toBe(8);
    expect(getServiceRequestCatalogItem('CARTA_SALDO').requiresLoan).toBe(true);
    expect(getServiceRequestCatalogItem('AYUDA_ATRASO').requiresLoan).toBe(true);
    expect(getServiceRequestCatalogItem('VINCULACION_EXPEDIENTE').requiresLoan).toBe(false);
  });

  it('generates unique collision-free institution portal codes', () => {
    const first = generateUniquePortalCodeForOrg('Financiera Caribe, S.R.L.', []);
    expect(first).toBe('FINCA-001');

    const second = generateUniquePortalCodeForOrg('Financiera Caribe, S.R.L.', ['FINCA-001', 'FINCA-002']);
    expect(second).toBe('FINCA-003');

    const multiWord = generateUniquePortalCodeForOrg('Cooperativa Nacional de Ahorro y Crédito', []);
    expect(multiWord).toBe('CNAC-001');
  });

  it('computes accurate indicative French-amortization installments for the public credit form', () => {
    const monthly = computeIndicativePublicInstallment({
      amount: 100000,
      termMonths: 12,
      frequency: 'MENSUAL',
      monthlyRate: 0.035,
    });
    expect(monthly.installmentsCount).toBe(12);
    expect(monthly.installmentAmount).toBeGreaterThan(10000);
    expect(monthly.totalPayable).toBeGreaterThan(100000);
    expect(monthly.totalInterest).toBeCloseTo(monthly.totalPayable - 100000, 1);

    const biweekly = computeIndicativePublicInstallment({
      amount: 100000,
      termMonths: 12,
      frequency: 'QUINCENAL',
      monthlyRate: 0.035,
    });
    expect(biweekly.installmentsCount).toBe(24);
    expect(biweekly.installmentAmount).toBeLessThan(monthly.installmentAmount);
  });

  it('validates and sanitizes public credit application payloads with strict boundaries and consent enforcement', () => {
    const invalid = validatePublicCreditApplicationPayload({
      applicantFullName: 'A',
      documentType: 'CEDULA',
      documentNumber: '12',
      phone: '123',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 0,
      requestedTermMonths: 0,
      paymentFrequency: 'MENSUAL',
      loanPurpose: 'No',
      monthlyIncome: 0,
      monthlyExpenses: -5,
      consentAccepted: false,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThanOrEqual(6);

    const valid = validatePublicCreditApplicationPayload({
      applicantType: 'INDIVIDUAL',
      applicantFullName: '  Ana María Gómez  ',
      documentType: 'CEDULA',
      documentNumber: '001-1234567-8',
      phone: '809-555-0199',
      email: 'ANA@EJEMPLO.COM ',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 75000,
      requestedTermMonths: 18,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Capital / Consumo personal',
      proposedCollateral: 'Vehículo propio',
      monthlyIncome: 55000,
      monthlyExpenses: 18000,
      customerDetails: {
        firstName: 'Ana María',
        lastName: 'Gómez',
        birthDate: '1992-04-15',
        nationality: 'Dominicana',
        maritalStatus: 'Soltera',
        municipality: 'Santo Domingo Este',
        residenceMonths: 36,
        housingType: 'ALQUILADA',
        housingPayment: 12000,
        socialMediaDeclared: 'YES',
        socialMediaHandle: '@anagomez',
        altContactName: 'Pedro Gómez',
        altContactPhone: '809-555-0100',
      },
      financialData: {
        activityType: 'Empleado privado',
        employerOrBusinessName: 'Distribuidora Central',
        occupationOrRole: 'Analista Contable',
        employmentMonths: 30,
        incomeSourceType: 'FIJA_RECURRENTE',
        primaryNetIncome: 55000,
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 55000,
        incomeCurrency: 'DOP',
        essentialExpenses: 18000,
        housingPayment: 12000,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'HAS_DEBTS',
        debtCount: 1,
        totalDebtBalance: 40000,
        currentDebtPayments: 4500,
        bankDebtPayment: 4500,
      },
      references: [
        { name: 'Luis Pérez', relationship: 'Hermano', phone: '809-555-0122' },
      ],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      consentAccepted: true,
    });
    expect(valid.valid).toBe(true);
    expect(valid.sanitized?.applicantFullName).toBe('Ana María Gómez');
    expect(valid.sanitized?.email).toBe('ana@ejemplo.com');
    expect(valid.sanitized?.customerDetails?.firstName).toBe('Ana María');
    expect(valid.sanitized?.financialData?.bankDebtPayment).toBe(4500);
    expect(valid.sanitized?.references?.length).toBe(1);
    expect(valid.sanitized?.consentAccepted).toBe(true);
  });

  it('validates business corporate details and business cash flow for BUSINESS public applications', () => {
    const missingBizFields = validatePublicCreditApplicationPayload({
      applicantType: 'BUSINESS',
      applicantFullName: 'Inversiones Caribe (Juan Ortiz)',
      documentType: 'CEDULA',
      documentNumber: '001-9876543-2',
      phone: '809-555-0188',
      productCode: 'EMPRESARIAL_DOP',
      currency: 'DOP',
      requestedAmount: 500000,
      requestedTermMonths: 24,
      paymentFrequency: 'MENSUAL',
      loanPurpose: 'Capital de trabajo',
      monthlyIncome: 0,
      monthlyExpenses: 25000,
      businessDetails: {
        rnc: '123',
        legalName: '',
        authorizedRepName: '',
      },
      businessFinancialData: {
        grossSales: 800000,
        operatingCosts: 650000,
        netMonthlyFlow: 150000,
        incomeCurrency: 'DOP',
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      },
      consentAccepted: true,
    });
    expect(missingBizFields.valid).toBe(false);
    expect(missingBizFields.errors.some((e) => e.includes('RNC'))).toBe(true);

    const validBiz = validatePublicCreditApplicationPayload({
      applicantType: 'BUSINESS',
      applicantFullName: 'Inversiones Caribe (Juan Ortiz)',
      documentType: 'CEDULA',
      documentNumber: '001-9876543-2',
      phone: '809-555-0188',
      productCode: 'EMPRESARIAL_DOP',
      currency: 'DOP',
      requestedAmount: 500000,
      requestedTermMonths: 24,
      paymentFrequency: 'MENSUAL',
      loanPurpose: 'Capital de trabajo',
      monthlyIncome: 0,
      monthlyExpenses: 25000,
      businessDetails: {
        rnc: '1-31-99887-2',
        legalName: 'Inversiones Caribe, S.R.L.',
        tradeName: 'Inversiones Caribe',
        companyType: 'SRL',
        economicActivity: 'Comercio al por mayor',
        authorizedRepName: 'Juan Ortiz',
      },
      businessFinancialData: {
        grossSales: 800000,
        operatingCosts: 650000,
        netMonthlyFlow: 150000,
        repaymentSource: 'Ventas mensuales de inventario',
        incomeCurrency: 'DOP',
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      },
      consentAccepted: true,
    });
    expect(validBiz.valid).toBe(true);
    expect(validBiz.sanitized?.monthlyIncome).toBe(150000);
    expect(validBiz.sanitized?.businessDetails?.rnc).toBe('1-31-99887-2');
    expect(validBiz.sanitized?.businessFinancialData?.netMonthlyFlow).toBe(150000);
  });

  it('builds a clean ready-to-share message containing institution links', () => {
    const links = buildInstitutionExternalPortalLinks(MOCK_ORG, 'https://app.axycore.com');
    const msg = buildExternalPortalShareMessage('Financiera Horizonte', links);
    expect(msg).toContain('Financiera Horizonte');
    expect(msg).toContain(links.creditApplicationUrl);
    expect(msg).toContain(links.registerUrl);
    expect(msg).toContain(links.portalUrl);
  });

  it('produces firestore.rules-compliant application, scoring, consent, and audit payloads when converting a public application', () => {
    const customer: CustomerRecord = {
      id: 'cust_org_axycore_main_CEDULA_00112345678',
      organizationId: 'org_axycore_main',
      documentType: 'CEDULA',
      documentNumber: '001-1234567-8',
      documentKey: 'org_axycore_main_CEDULA_00112345678',
      firstName: 'Ana',
      lastName: 'Gómez',
      phone: '809-555-0199',
      createdBy: 'staff_uid_1',
    };

    const appInput: ApplicationRecord = {
      id: 'app_1795345358778_oppc87',
      organizationId: 'org_axycore_main',
      applicationNumber: 'SOL-2026-358778',
      fileNumber: 'EXP-2026-358778',
      channel: 'EXTERNAL',
      applicantType: 'INDIVIDUAL',
      customerId: customer.id,
      businessId: null,
      applicantDisplayName: 'Ana Gómez',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 50000,
      requestedTermMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Capital personal',
      financialData: {
        activityType: 'Empleado privado',
        employerOrBusinessName: 'Comercial Central',
        employmentMonths: 24,
        primaryNetIncome: 65000,
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: 65000,
        essentialExpenses: 18000,
        currentDebtPayments: 0,
        incomeCurrency: 'DOP',
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      },
      businessFinancialData: null,
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      status: 'RECIBIDA',
      consentVersion: 'v1.0-Ley172-13',
      consentAcceptedAt: '2026-11-22T11:00:00.000Z',
      createdBy: 'staff_uid_1',
      createdByName: 'Administrador',
    };

    const originalRequestedConditions = buildOriginalRequestedConditions(appInput);
    const integrated = runIntegratedDecisionAndCalculation({
      application: { ...appInput, originalRequestedConditions },
      customer,
      policy: DEFAULT_POLICY_V2,
      analysisType: 'SOLICITUD_INICIAL',
      version: 1,
      useVerifiedData: false,
      actor: { uid: 'staff_uid_1', displayName: 'Administrador', role: 'ADMIN' },
    });

    const execPayload = sanitizeScoringExecutionPayload({
      ...integrated.scoring,
      organizationId: 'org_axycore_main',
      applicationId: appInput.id,
      executedBy: 'staff_uid_1',
      executedByName: 'Administrador',
    });

    const finalApp = buildMaterializedApplicationPayload(
      appInput,
      {
        status: integrated.canAutoAdvanceToEvaluation ? 'EN_EVALUACION' : 'RECIBIDA',
        prequalificationStatus: execPayload.status,
        latestScoringExecutionId: execPayload.id,
        latestScore: execPayload.totalScore,
        latestRiskBand: execPayload.riskBand?.code ?? 'CRITICO',
        recommendedAmount: execPayload.recommendedAmount,
        recommendedRateMonthly: execPayload.recommendedRateMonthly,
        recommendedTermMonths: execPayload.recommendedTermMonths,
        recommendedInstallment:
          integrated.analysis.financialSummary?.initialInstallment ??
          execPayload.recommendedInstallment,
        originalRequestedConditions,
        activeFinancialAnalysisId: integrated.analysis.id,
        approvedEvaluationAnalysisId: integrated.canAutoAdvanceToEvaluation
          ? integrated.analysis.id
          : null,
        requiresHumanIntervention: !integrated.canAutoAdvanceToEvaluation,
        decisionQualificationStatus: integrated.decisionQualificationStatus,
        financialAnalysisVersion: 1,
        legalFeeMode: originalRequestedConditions.legalFeeMode,
        interestOnlyPeriods: originalRequestedConditions.interestOnlyPeriods,
        installmentCount: originalRequestedConditions.installmentCount,
      },
      'staff_uid_1',
      'Administrador'
    );

    const allowedApplicationKeys = new Set([
      'id',
      'organizationId',
      'applicationNumber',
      'fileNumber',
      'channel',
      'applicantType',
      'customerId',
      'businessId',
      'applicantDisplayName',
      'productCode',
      'currency',
      'requestedAmount',
      'requestedTermMonths',
      'paymentFrequency',
      'amortizationMethod',
      'loanPurpose',
      'loanPurposeDescription',
      'proposedCollateral',
      'financialData',
      'businessFinancialData',
      'verifiedFinancialData',
      'verifiedBusinessFinancialData',
      'references',
      'declaredDocumentsSummary',
      'status',
      'prequalificationStatus',
      'latestScoringExecutionId',
      'latestScore',
      'latestRiskBand',
      'recommendedAmount',
      'recommendedRateMonthly',
      'recommendedTermMonths',
      'recommendedInstallment',
      'authorizedAlternateAmount',
      'alternateAmountAuthorizedBy',
      'originalRequestedConditions',
      'activeFinancialAnalysisId',
      'approvedEvaluationAnalysisId',
      'requiresHumanIntervention',
      'decisionQualificationStatus',
      'financialAnalysisVersion',
      'legalFeeMode',
      'interestOnlyPeriods',
      'installmentCount',
      'consentVersion',
      'consentAcceptedAt',
      'assignedTo',
      'assignedToName',
      'movementHistory',
      'createdBy',
      'createdByName',
      'createdAt',
      'updatedAt',
    ]);

    for (const k of Object.keys(finalApp)) {
      expect(allowedApplicationKeys.has(k)).toBe(true);
    }
    expect(finalApp.id).toBe('app_1795345358778_oppc87');
    expect(finalApp.createdBy).toBe('staff_uid_1');
    expect(execPayload.indicatorDetails.length).toBe(22);

    const consent = buildApplicationConsentPayload({
      consentId: 'consent_test_1',
      organizationId: 'org_axycore_main',
      applicationId: appInput.id,
      customerId: customer.id,
      consentVersion: 'v1.0-Ley172-13',
      consentText: 'Solicitud recibida vía enlace externo público con consentimiento Ley 172-13.',
      acceptedBy: 'staff_uid_1',
    });
    expect(Object.keys(consent).sort()).toEqual(
      [
        'accepted',
        'acceptedAt',
        'acceptedBy',
        'acceptedText',
        'applicationId',
        'consentVersion',
        'customerId',
        'id',
        'organizationId',
      ].sort()
    );

    const audit = buildCriticalAuditEntryPayload({
      id: 'audit_test_1',
      organizationId: 'org_axycore_main',
      eventType: 'APPLICATION_SUBMITTED_REQUIRES_INTERVENTION',
      entityType: 'applications',
      entityId: appInput.id,
      action: 'Originación SOL-2026-358778 (EXTERNAL)',
      newState: 'RECIBIDA',
      transactionId: integrated.analysis.idempotencyKey,
      engineVersion: DEFAULT_POLICY_V2.version,
      userId: 'staff_uid_1',
      userEmail: 'admin@axycore.com',
      userRole: 'ADMIN',
    });
    expect(audit.action.length).toBeLessThanOrEqual(200);
    expect(audit.transactionId.length).toBeGreaterThanOrEqual(4);
  });

  it('guarantees 100% firestore.rules schema parity for public_credit_applications create payloads (INDIVIDUAL & BUSINESS)', () => {
    const allowedPublicAppKeys = new Set([
      'id',
      'trackingNumber',
      'organizationId',
      'portalCode',
      'institutionName',
      'applicantType',
      'applicantFullName',
      'documentType',
      'documentNumber',
      'phone',
      'email',
      'address',
      'province',
      'productCode',
      'currency',
      'requestedAmount',
      'requestedTermMonths',
      'paymentFrequency',
      'amortizationMethod',
      'loanPurpose',
      'loanPurposeDescription',
      'proposedCollateral',
      'monthlyIncome',
      'monthlyExpenses',
      'employerOrActivity',
      'customerDetails',
      'businessDetails',
      'financialData',
      'businessFinancialData',
      'references',
      'declaredDocumentsSummary',
      'attachedDocuments',
      'biometricSummary',
      'indicativeInstallment',
      'indicativeRateMonthly',
      'consentVersion',
      'consentAccepted',
      'consentAcceptedAt',
      'status',
      'convertedApplicationId',
      'convertedBy',
      'convertedByName',
      'convertedAt',
      'reviewNotes',
      'createdAt',
      'updatedAt',
    ]);

    const assertMatchesFirestoreRule = (record: Record<string, unknown>) => {
      for (const key of Object.keys(record)) {
        expect(allowedPublicAppKeys.has(key)).toBe(true);
      }
      expect(String(record.id)).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
      expect(String(record.organizationId)).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
      expect(String(record.portalCode)).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
      expect(String(record.trackingNumber).length).toBeGreaterThanOrEqual(6);
      expect(String(record.trackingNumber).length).toBeLessThanOrEqual(40);
      expect(String(record.institutionName).length).toBeGreaterThanOrEqual(2);
      expect(String(record.institutionName).length).toBeLessThanOrEqual(160);
      expect(['INDIVIDUAL', 'BUSINESS']).toContain(record.applicantType);
      expect(String(record.applicantFullName).length).toBeGreaterThanOrEqual(3);
      expect(String(record.applicantFullName).length).toBeLessThanOrEqual(200);
      expect(['CEDULA', 'PASAPORTE']).toContain(record.documentType);
      expect(String(record.documentNumber).length).toBeGreaterThanOrEqual(5);
      expect(String(record.documentNumber).length).toBeLessThanOrEqual(40);
      expect(String(record.phone).length).toBeGreaterThanOrEqual(7);
      expect(String(record.phone).length).toBeLessThanOrEqual(40);
      expect(['PERSONAL_DOP', 'EMPRESARIAL_DOP', 'PERSONAL_USD', 'EMPRESARIAL_USD']).toContain(
        record.productCode
      );
      expect(['DOP', 'USD']).toContain(record.currency);
      expect(Number(record.requestedAmount)).toBeGreaterThan(0);
      expect(Number(record.requestedAmount)).toBeLessThanOrEqual(100_000_000);
      expect(Number(record.requestedTermMonths)).toBeGreaterThanOrEqual(1);
      expect(Number(record.requestedTermMonths)).toBeLessThanOrEqual(360);
      expect(['DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL']).toContain(record.paymentFrequency);
      expect(['SALDO_INSOLUTO', 'INTERES_FIJO']).toContain(record.amortizationMethod);
      expect(String(record.loanPurpose).length).toBeGreaterThanOrEqual(3);
      expect(String(record.loanPurpose).length).toBeLessThanOrEqual(120);
      expect(Number(record.monthlyIncome)).toBeGreaterThanOrEqual(0);
      expect(Number(record.monthlyIncome)).toBeLessThanOrEqual(100_000_000);
      expect(Number(record.monthlyExpenses)).toBeGreaterThanOrEqual(0);
      expect(Number(record.monthlyExpenses)).toBeLessThanOrEqual(100_000_000);
      expect(Number(record.indicativeInstallment)).toBeGreaterThanOrEqual(0);
      expect(Number(record.indicativeInstallment)).toBeLessThanOrEqual(100_000_000);
      expect(Number(record.indicativeRateMonthly)).toBeGreaterThanOrEqual(0);
      expect(Number(record.indicativeRateMonthly)).toBeLessThanOrEqual(1);
      expect(record.consentAccepted).toBe(true);
      expect(String(record.consentAcceptedAt).length).toBeGreaterThanOrEqual(10);
      expect(String(record.consentAcceptedAt).length).toBeLessThanOrEqual(40);
      expect(record.status).toBe('RECIBIDA_PUBLICA');
      if (Array.isArray(record.references)) {
        expect(record.references.length).toBeLessThanOrEqual(4);
      }
      if (Array.isArray(record.attachedDocuments)) {
        expect(record.attachedDocuments.length).toBeLessThanOrEqual(3);
      }
    };

    // Case 1: Exact individual prospect case (Personal DOP, RD$160,000, 3 meses, MENSUAL)
    const indCheck = validatePublicCreditApplicationPayload({
      applicantType: 'INDIVIDUAL',
      applicantFullName: 'Luis Ángel Rodríguez Rodríguez',
      documentType: 'CEDULA',
      documentNumber: '001-1234567-8',
      phone: '829-641-7360',
      productCode: 'PERSONAL_DOP',
      currency: 'DOP',
      requestedAmount: 160000,
      requestedTermMonths: 3,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      loanPurpose: 'Capital / Consumo personal',
      monthlyIncome: 75000,
      monthlyExpenses: 28000,
      customerDetails: {
        firstName: 'Luis Ángel',
        lastName: 'Rodríguez Rodríguez',
        residenceMonths: 24,
        housingType: 'ALQUILADA',
        housingPayment: 0,
        socialMediaDeclared: 'NO_MEDIA',
      },
      financialData: {
        activityType: 'Empleado privado',
        employerOrBusinessName: 'Empresa Test',
        occupationOrRole: 'Técnico',
        employmentMonths: 24,
        incomeSourceType: 'FIJA_RECURRENTE',
        primaryNetIncome: 75000,
        additionalIncomeStatus: 'EXPLICIT_NONE',
        additionalNetIncome: 0,
        declaredTotalMonthlyIncome: null,
        incomeCurrency: 'DOP',
        essentialExpenses: 28000,
        housingPayment: 0,
        housingIncludedInExpenses: false,
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
        debtCount: 0,
        totalDebtBalance: 0,
        currentDebtPayments: 0,
      },
      references: [],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      attachedDocuments: [],
      biometricSummary: null,
      consentVersion: 'v1.0-Ley172-13',
      consentAccepted: true,
    });
    expect(indCheck.valid).toBe(true);
    const indClean = indCheck.sanitized!;
    const indIndicative = computeIndicativePublicInstallment({
      amount: indClean.requestedAmount,
      termMonths: indClean.requestedTermMonths,
      frequency: indClean.paymentFrequency,
    });
    assertMatchesFirestoreRule({
      id: 'pubapp_1795448060053_tvy0ab',
      trackingNumber: 'PUB-2026-060053',
      organizationId: 'org_axycore_main',
      portalCode: normalizePortalCode(' sgma-001 '),
      institutionName: 'SU GLORIA MANO AMIGA',
      ...indClean,
      indicativeInstallment: indIndicative.installmentAmount,
      indicativeRateMonthly: indIndicative.monthlyRateUsed,
      consentAcceptedAt: '2026-11-24T11:34:20.053Z',
      status: 'RECIBIDA_PUBLICA',
    });

    // Case 2: BUSINESS prospect with references, attached documents, and biometric summary
    const bizCheck = validatePublicCreditApplicationPayload({
      applicantType: 'BUSINESS',
      applicantFullName: 'Comercial Caribe (María Santos)',
      documentType: 'CEDULA',
      documentNumber: '001-7654321-0',
      phone: '809-555-8899',
      email: 'maria@caribe.do',
      productCode: 'EMPRESARIAL_DOP',
      currency: 'DOP',
      requestedAmount: 350000,
      requestedTermMonths: 12,
      paymentFrequency: 'QUINCENAL',
      amortizationMethod: 'INTERES_FIJO',
      loanPurpose: 'Capital de trabajo',
      monthlyIncome: 140000,
      monthlyExpenses: 30000,
      businessDetails: {
        rnc: '1-31-99887-2',
        legalName: 'Comercial Caribe, S.R.L.',
        tradeName: 'Comercial Caribe',
        authorizedRepName: 'María Santos',
      },
      businessFinancialData: {
        grossSales: 450000,
        operatingCosts: 310000,
        netMonthlyFlow: 140000,
        repaymentSource: 'Ventas comerciales',
        incomeCurrency: 'DOP',
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      },
      references: [
        { name: 'Carlos Díaz', relationship: 'Proveedor', phone: '809-555-1010' },
        { name: 'Elena Ruiz', relationship: 'Socia', phone: '809-555-2020' },
      ],
      declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      attachedDocuments: [
        {
          category: 'Identidad',
          fileName: 'cedula.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 120000,
          fileDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        },
      ],
      biometricSummary: {
        verdict: 'COINCIDE',
        similarityScore: 94,
        livenessAssessment: 'ALTA',
        summary: 'Rostro coincide con el documento de identidad.',
      },
      consentVersion: 'v1.0-Ley172-13',
      consentAccepted: true,
    });
    expect(bizCheck.valid).toBe(true);
    const bizClean = bizCheck.sanitized!;
    const bizIndicative = computeIndicativePublicInstallment({
      amount: bizClean.requestedAmount,
      termMonths: bizClean.requestedTermMonths,
      frequency: bizClean.paymentFrequency,
    });
    assertMatchesFirestoreRule({
      id: 'pubapp_1795448099999_biz001',
      trackingNumber: 'PUB-2026-099999',
      organizationId: 'org_axycore_main',
      portalCode: 'SGMA-001',
      institutionName: 'SU GLORIA MANO AMIGA',
      ...bizClean,
      indicativeInstallment: bizIndicative.installmentAmount,
      indicativeRateMonthly: bizIndicative.monthlyRateUsed,
      consentAcceptedAt: '2026-11-24T11:35:00.000Z',
      status: 'RECIBIDA_PUBLICA',
    });
  });
});

