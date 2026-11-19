import { describe, expect, it } from 'vitest';
import {
  evaluatePreEvaluationRequirements,
  PreEvaluationValidationError,
} from '../engine/preEvaluationValidation';
import type {
  ApplicationDocumentRecord,
  ApplicationRecord,
  BusinessRecord,
  CustomerRecord,
} from '../types/axycore';

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: 'cust_001',
    organizationId: 'su-gloria-mano-amiga',
    documentType: 'CEDULA',
    documentNumber: '001-1234567-8',
    documentKey: 'su-gloria-mano-amiga_CEDULA_00112345678',
    firstName: 'Giordanny',
    lastName: 'Fernández Miranda',
    birthDate: '1990-05-12',
    phone: '809-555-1234',
    email: 'giordanny@example.com',
    address: 'Calle Principal #45, Ensanche Ozama',
    province: 'Santo Domingo',
    municipality: 'Santo Domingo Este',
    createdBy: 'uid_admin',
    ...overrides,
  };
}

function makeApplication(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: 'app_001',
    organizationId: 'su-gloria-mano-amiga',
    applicationNumber: 'SOL-2026-0001',
    fileNumber: 'EXP-2026-0001',
    channel: 'INTERNAL',
    applicantType: 'INDIVIDUAL',
    customerId: 'cust_001',
    applicantDisplayName: 'Giordanny Fernández Miranda',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    requestedAmount: 75000,
    requestedTermMonths: 12,
    paymentFrequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    financialData: {
      primaryNetIncome: 55000,
      declaredTotalMonthlyIncome: 55000,
      incomeCurrency: 'DOP',
      essentialExpenses: 20000,
      debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
    },
    references: [],
    declaredDocumentsSummary: {
      hasIdentityDoc: true,
      hasIncomeEvidence: true,
    },
    status: 'RECIBIDA',
    prequalificationStatus: 'PREOFERTA',
    recommendedAmount: 75000,
    createdBy: 'uid_admin',
    ...overrides,
  };
}

function makeDoc(overrides: Partial<ApplicationDocumentRecord> = {}): ApplicationDocumentRecord {
  return {
    id: 'doc_1',
    organizationId: 'su-gloria-mano-amiga',
    applicationId: 'app_001',
    category: 'CEDULA_IDENTIDAD',
    fileName: 'cedula.pdf',
    reviewStatus: 'VERIFICADO',
    uploadedBy: 'uid_admin',
    ...overrides,
  };
}

function makeBusiness(overrides: Partial<BusinessRecord> = {}): BusinessRecord {
  return {
    id: 'biz_001',
    organizationId: 'su-gloria-mano-amiga',
    rnc: '131-12345-6',
    rncKey: 'su-gloria-mano-amiga_RNC_131123456',
    legalName: 'Inversiones del Caribe SRL',
    authorizedRepName: 'Giordanny Fernández Miranda',
    createdBy: 'uid_admin',
    ...overrides,
  };
}

describe('Pre-Evaluation Firestore Validation Engine', () => {
  it('passes cleanly when customer profile and required documents exist in Firestore', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication(),
      firestoreCustomer: makeCustomer(),
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'CEDULA_IDENTIDAD' }),
        makeDoc({ id: 'doc_inc', category: 'COMPROBANTE_INGRESOS', fileName: 'ingresos.pdf' }),
      ],
    });

    expect(result.canProceed).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.customerExistsInFirestore).toBe(true);
    expect(result.documentsCountInFirestore).toBe(2);
    expect(result.blockingIssues).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('blocks when the customer document does not exist in Firestore', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication(),
      firestoreCustomer: null,
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'CEDULA_IDENTIDAD' }),
        makeDoc({ id: 'doc_inc', category: 'COMPROBANTE_INGRESOS' }),
      ],
    });

    expect(result.canProceed).toBe(false);
    expect(result.customerExistsInFirestore).toBe(false);
    expect(result.blockingIssues.map((i) => i.id)).toContain('customer_missing_firestore');
    expect(result.summaryMessage).toContain('Perfil del cliente no existe en Firestore');
  });

  it('flags each missing mandatory customer field and detects migration placeholders', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication(),
      firestoreCustomer: makeCustomer({
        documentNumber: 'MIG-CW-123456',
        firstName: '',
        lastName: ' ',
        phone: '809-000-0000',
        email: 'correo-invalido',
        address: '',
        birthDate: '',
        province: '',
        municipality: '',
      }),
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'CEDULA_IDENTIDAD' }),
        makeDoc({ id: 'doc_inc', category: 'ESTADO_CUENTA' }),
      ],
    });

    expect(result.canProceed).toBe(false);
    const blockingIds = result.blockingIssues.map((i) => i.id);
    expect(blockingIds).toEqual(
      expect.arrayContaining([
        'customer_document_number',
        'customer_first_name',
        'customer_last_name',
        'customer_phone',
        'customer_email',
        'customer_address',
      ])
    );

    const docNumberIssue = result.blockingIssues.find((i) => i.id === 'customer_document_number');
    expect(docNumberIssue?.detail).toContain('marcador temporal de migración');

    const phoneIssue = result.blockingIssues.find((i) => i.id === 'customer_phone');
    expect(phoneIssue?.detail).toContain('valor genérico de respaldo');

    const warningIds = result.warnings.map((w) => w.id);
    expect(warningIds).toEqual(
      expect.arrayContaining(['customer_birth_date_warn', 'customer_location_warn'])
    );
  });

  it('blocks when required identity or income documents are absent in Firestore (ignoring docs from other applications)', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication({
        id: 'app_001',
        declaredDocumentsSummary: { hasIdentityDoc: true, hasIncomeEvidence: true },
      }),
      firestoreCustomer: makeCustomer(),
      firestoreDocuments: [
        // Document belonging to a DIFFERENT application must be ignored
        makeDoc({ id: 'other_doc', applicationId: 'app_999', category: 'CEDULA_IDENTIDAD' }),
      ],
    });

    expect(result.canProceed).toBe(false);
    expect(result.documentsCountInFirestore).toBe(0);
    const blockingIds = result.blockingIssues.map((i) => i.id);
    expect(blockingIds).toEqual(expect.arrayContaining(['doc_identity_missing', 'doc_income_missing']));
    const idDocIssue = result.blockingIssues.find((i) => i.id === 'doc_identity_missing');
    expect(idDocIssue?.detail).toContain('no existe archivo cargado en Firestore');
  });

  it('emits non-blocking warnings when required documents exist in Firestore with OBSERVADO status', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication(),
      firestoreCustomer: makeCustomer(),
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'PASAPORTE', reviewStatus: 'OBSERVADO' }),
        makeDoc({ id: 'doc_inc', category: 'INGRESOS', reviewStatus: 'RECIBIDO' }),
      ],
    });

    expect(result.canProceed).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.blockingIssues).toHaveLength(0);
    expect(result.warnings.map((w) => w.id)).toContain('doc_identity_observed');
  });

  it('validates business profile and corporate documents for BUSINESS applications', () => {
    const businessApp = makeApplication({
      applicantType: 'BUSINESS',
      businessId: 'biz_001',
      productCode: 'EMPRESARIAL_DOP',
      businessFinancialData: {
        grossSales: 250000,
        netMonthlyFlow: 95000,
        incomeCurrency: 'DOP',
        debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      },
    });

    // Missing business in Firestore and missing corporate docs
    const failed = evaluatePreEvaluationRequirements({
      application: businessApp,
      firestoreCustomer: makeCustomer(),
      firestoreBusiness: null,
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'CEDULA_IDENTIDAD' }),
        makeDoc({ id: 'doc_inc', category: 'ESTADOS_FINANCIEROS' }),
      ],
    });

    expect(failed.canProceed).toBe(false);
    expect(failed.businessExistsInFirestore).toBe(false);
    expect(failed.blockingIssues.map((i) => i.id)).toEqual(
      expect.arrayContaining(['business_missing_firestore', 'doc_corporate_missing'])
    );

    // Complete business profile + corporate docs
    const passed = evaluatePreEvaluationRequirements({
      application: businessApp,
      firestoreCustomer: makeCustomer(),
      firestoreBusiness: makeBusiness(),
      firestoreDocuments: [
        makeDoc({ id: 'doc_id', category: 'CEDULA_IDENTIDAD' }),
        makeDoc({ id: 'doc_inc', category: 'ESTADOS_FINANCIEROS' }),
        makeDoc({ id: 'doc_corp', category: 'DOCUMENTO_SOCIETARIO' }),
      ],
    });

    expect(passed.canProceed).toBe(true);
    expect(passed.businessExistsInFirestore).toBe(true);
    expect(passed.blockingIssues).toHaveLength(0);
  });

  it('wraps failed validation in PreEvaluationValidationError with full metadata', () => {
    const result = evaluatePreEvaluationRequirements({
      application: makeApplication({ requestedAmount: 0 }),
      firestoreCustomer: makeCustomer(),
      firestoreDocuments: [],
    });

    const err = new PreEvaluationValidationError(result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PreEvaluationValidationError');
    expect(err.validation).toBe(result);
    expect(err.message).toContain('SOL-2026-0001');
  });
});
