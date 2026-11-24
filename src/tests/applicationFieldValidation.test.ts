import { describe, expect, it } from 'vitest';
import {
  validateApplicationFormFields,
  type ApplicationFormValues,
} from '../engine/applicationFieldValidation';
import type { ProductLimitConfig } from '../types/axycore';

function buildValidIndividualValues(
  overrides: Partial<ApplicationFormValues> = {}
): ApplicationFormValues {
  return {
    applicantType: 'INDIVIDUAL',
    documentType: 'CEDULA',
    documentNumber: '001-1234567-8',
    birthDate: '1992-05-14',
    firstName: 'María Elena',
    lastName: 'Rodríguez Pérez',
    phone: '809-555-0192',
    email: 'maria.rodriguez@ejemplo.com',
    residenceMonths: 36,
    housingPayment: 12000,
    socialMediaDeclared: 'YES',
    socialMediaHandle: '@mariaelena',
    altContactPhone: '829-555-0100',
    rnc: '',
    legalName: '',
    authorizedRepName: '',
    authorizedRepDoc: '',
    operationsStartDate: '',
    employmentMonths: 24,
    incomeSourceType: 'FIJA_RECURRENTE',
    primaryNetIncome: '65000',
    additionalIncomeStatus: 'EXPLICIT_NONE',
    additionalNetIncome: '0',
    declaredTotalMonthlyIncome: '65000',
    grossSales: '',
    operatingCosts: '',
    netMonthlyFlow: '',
    essentialExpenses: '22000',
    debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
    debtCount: '0',
    totalDebtBalance: '0',
    currentDebtPayments: '0',
    bankDebtPayment: '0',
    financeDebtPayment: '0',
    cardDebtPayment: '0',
    informalDebtPayment: '0',
    otherDebtPayment: '0',
    currency: 'DOP',
    requestedAmount: '150000',
    requestedTermMonths: '24',
    loanPurpose: 'Consolidación de gastos del hogar',
    ref1Name: 'Carlos Méndez',
    ref1Rel: 'Hermano',
    ref1Phone: '809-555-3322',
    ref2Name: '',
    ref2Rel: '',
    ref2Phone: '',
    consentAccepted: true,
    ...overrides,
  };
}

function buildValidBusinessValues(
  overrides: Partial<ApplicationFormValues> = {}
): ApplicationFormValues {
  return buildValidIndividualValues({
    applicantType: 'BUSINESS',
    rnc: '1-31-99887-2',
    legalName: 'Distribuidora del Caribe SRL',
    authorizedRepName: 'Luis Alberto Gómez',
    authorizedRepDoc: '001-9876543-2',
    operationsStartDate: '2019-03-01',
    grossSales: '850000',
    operatingCosts: '550000',
    netMonthlyFlow: '300000',
    primaryNetIncome: '',
    requestedAmount: '500000',
    requestedTermMonths: '36',
    loanPurpose: 'Capital de trabajo e inventario',
    ...overrides,
  });
}

const SAMPLE_POLICY: ProductLimitConfig = {
  productCode: 'PERSONAL_DOP',
  label: 'Personal DOP',
  currency: 'DOP',
  minAmount: 10000,
  maxAmount: 500000,
  minTermMonths: 6,
  maxTermMonths: 60,
  bandCaps: {
    MUY_BAJO: 500000,
    BAJO: 400000,
    MODERADO: 250000,
    MEDIO_ALTO: 120000,
    ALTO: 50000,
    CRITICO: 0,
  },
  allowedFrequencies: ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'DIARIA'],
  allowedAmortizationMethods: ['SALDO_INSOLUTO', 'INTERES_FIJO'],
};

const REF_DATE = new Date(2026, 10, 24); // 2026-11-24

describe('validateApplicationFormFields', () => {
  it('accepts a complete valid INDIVIDUAL application with zero errors or warnings', () => {
    const res = validateApplicationFormFields(buildValidIndividualValues(), {
      productPolicy: SAMPLE_POLICY,
      referenceDate: REF_DATE,
    });
    expect(res.isFormValid).toBe(true);
    expect(res.errors).toEqual({});
    expect(res.warnings).toEqual({});
    expect(res.firstInvalidStep).toBeNull();
    expect(res.stepErrorCounts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('accepts a complete valid BUSINESS application (9-digit or 11-digit RNC)', () => {
    const res9 = validateApplicationFormFields(buildValidBusinessValues({ rnc: '1-31-99887-2' }), {
      referenceDate: REF_DATE,
    });
    expect(res9.isFormValid).toBe(true);

    const res11 = validateApplicationFormFields(
      buildValidBusinessValues({ rnc: '001-1234567-8' }),
      { referenceDate: REF_DATE }
    );
    expect(res11.isFormValid).toBe(true);
  });

  it('validates Dominican Cédula (11 digits) and Pasaporte (6-20 alphanumeric)', () => {
    const shortCedula = validateApplicationFormFields(
      buildValidIndividualValues({ documentType: 'CEDULA', documentNumber: '001-12345' }),
      { referenceDate: REF_DATE }
    );
    expect(shortCedula.errors.documentNumber).toContain('11 dígitos');
    expect(shortCedula.firstInvalidStep).toBe(1);
    expect(shortCedula.firstInvalidFieldByStep[1]).toBe('documentNumber');

    const letterCedula = validateApplicationFormFields(
      buildValidIndividualValues({ documentType: 'CEDULA', documentNumber: '001-1234567-A' }),
      { referenceDate: REF_DATE }
    );
    expect(letterCedula.errors.documentNumber).toContain('solo debe contener números');

    const validPassport = validateApplicationFormFields(
      buildValidIndividualValues({ documentType: 'PASAPORTE', documentNumber: 'RD902184' }),
      { referenceDate: REF_DATE }
    );
    expect(validPassport.errors.documentNumber).toBeUndefined();

    const shortPassport = validateApplicationFormFields(
      buildValidIndividualValues({ documentType: 'PASAPORTE', documentNumber: 'A12' }),
      { referenceDate: REF_DATE }
    );
    expect(shortPassport.errors.documentNumber).toContain('6 y 20');
  });

  it('rejects invalid phone, email, names, and under-18 or future birth dates', () => {
    const res = validateApplicationFormFields(
      buildValidIndividualValues({
        firstName: 'J123',
        lastName: 'A',
        phone: '809-12',
        email: 'correo-invalido',
        birthDate: '2012-06-10',
      }),
      { referenceDate: REF_DATE }
    );

    expect(res.errors.firstName).toBeDefined();
    expect(res.errors.lastName).toBeDefined();
    expect(res.errors.phone).toBeDefined();
    expect(res.errors.email).toBeDefined();
    expect(res.errors.birthDate).toContain('mayor de 18 años');
    expect(res.stepErrorCounts[1]).toBe(5);

    const futureBirth = validateApplicationFormFields(
      buildValidIndividualValues({ birthDate: '2029-01-01' }),
      { referenceDate: REF_DATE }
    );
    expect(futureBirth.errors.birthDate).toContain('futuro');
  });

  it('skips existing-customer identity validation when skipExistingCustomerIdentity is true', () => {
    const res = validateApplicationFormFields(
      buildValidIndividualValues({
        skipExistingCustomerIdentity: true,
        documentNumber: '',
        firstName: '',
        lastName: '',
        phone: '',
      }),
      { referenceDate: REF_DATE }
    );
    expect(res.stepValid[1]).toBe(true);
    expect(res.isFormValid).toBe(true);
  });

  it('validates business flow and emits a soft warning when netMonthlyFlow exceeds grossSales', () => {
    const invalidBusiness = validateApplicationFormFields(
      buildValidBusinessValues({
        rnc: '1234',
        legalName: 'AB',
        authorizedRepName: '',
        netMonthlyFlow: '0',
      }),
      { referenceDate: REF_DATE }
    );
    expect(invalidBusiness.errors.rnc).toBeDefined();
    expect(invalidBusiness.errors.legalName).toBeDefined();
    expect(invalidBusiness.errors.authorizedRepName).toBeDefined();
    expect(invalidBusiness.errors.netMonthlyFlow).toBeDefined();

    const inconsistentFlow = validateApplicationFormFields(
      buildValidBusinessValues({
        grossSales: '100000',
        netMonthlyFlow: '150000',
      }),
      { referenceDate: REF_DATE }
    );
    expect(inconsistentFlow.errors.netMonthlyFlow).toBeUndefined();
    expect(inconsistentFlow.warnings.netMonthlyFlow).toContain('supera las ventas brutas');
    expect(inconsistentFlow.isFormValid).toBe(true);
  });

  it('requires complete positive debt details when debtDeclarationStatus is HAS_DEBTS', () => {
    const res = validateApplicationFormFields(
      buildValidIndividualValues({
        debtDeclarationStatus: 'HAS_DEBTS',
        debtCount: '0',
        totalDebtBalance: '0',
        currentDebtPayments: '',
        bankDebtPayment: '-100',
      }),
      { referenceDate: REF_DATE }
    );
    expect(res.errors.debtCount).toBeDefined();
    expect(res.errors.totalDebtBalance).toBeDefined();
    expect(res.errors.currentDebtPayments).toBeDefined();
    expect(res.errors.bankDebtPayment).toBeDefined();
    expect(res.stepErrorCounts[2]).toBe(4);
    expect(res.firstInvalidStep).toBe(2);
  });

  it('validates loan amount, term, and purpose hard bounds plus soft policy warnings', () => {
    const hardInvalid = validateApplicationFormFields(
      buildValidIndividualValues({
        requestedAmount: '0',
        requestedTermMonths: '500',
        loanPurpose: 'Hi',
      }),
      { productPolicy: SAMPLE_POLICY, referenceDate: REF_DATE }
    );
    expect(hardInvalid.errors.requestedAmount).toBeDefined();
    expect(hardInvalid.errors.requestedTermMonths).toBeDefined();
    expect(hardInvalid.errors.loanPurpose).toBeDefined();
    expect(hardInvalid.stepErrorCounts[3]).toBe(3);

    const outOfPolicy = validateApplicationFormFields(
      buildValidIndividualValues({
        requestedAmount: '750000',
        requestedTermMonths: '3',
      }),
      { productPolicy: SAMPLE_POLICY, referenceDate: REF_DATE }
    );
    expect(outOfPolicy.isFormValid).toBe(true);
    expect(outOfPolicy.warnings.requestedAmount).toContain('máximo de política');
    expect(outOfPolicy.warnings.requestedTermMonths).toContain('rango de política');
  });

  it('validates partial references and requires consent acceptance on step 5', () => {
    const res = validateApplicationFormFields(
      buildValidIndividualValues({
        ref1Name: 'Ana',
        ref1Phone: '',
        ref2Name: '',
        ref2Rel: 'Amiga',
        ref2Phone: '809',
        consentAccepted: false,
      }),
      { referenceDate: REF_DATE }
    );
    expect(res.errors.ref1Name).toBeUndefined();
    expect(res.errors.ref1Phone).toBeDefined();
    expect(res.errors.ref2Name).toBeDefined();
    expect(res.errors.ref2Phone).toBeDefined();
    expect(res.stepErrorCounts[4]).toBe(3);
    expect(res.errors.consentAccepted).toContain('Ley 172-13');
    expect(res.stepErrorCounts[5]).toBe(1);
    expect(res.firstInvalidStep).toBe(4);
  });
});
