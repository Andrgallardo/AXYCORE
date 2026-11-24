import type {
  AdditionalIncomeStatus,
  ApplicantType,
  CurrencyCode,
  DebtDeclarationStatus,
  IncomeSourceType,
  ProductLimitConfig,
  SocialMediaStatus,
} from '../types/axycore';

export type ApplicationFormStep = 1 | 2 | 3 | 4 | 5;

export type ApplicationFieldName =
  // Step 1
  | 'documentNumber'
  | 'birthDate'
  | 'firstName'
  | 'lastName'
  | 'phone'
  | 'email'
  | 'residenceMonths'
  | 'housingPayment'
  | 'socialMediaHandle'
  | 'altContactPhone'
  | 'rnc'
  | 'legalName'
  | 'authorizedRepName'
  | 'authorizedRepDoc'
  | 'operationsStartDate'
  // Step 2
  | 'employmentMonths'
  | 'primaryNetIncome'
  | 'additionalNetIncome'
  | 'declaredTotalMonthlyIncome'
  | 'grossSales'
  | 'operatingCosts'
  | 'netMonthlyFlow'
  | 'essentialExpenses'
  | 'debtCount'
  | 'totalDebtBalance'
  | 'currentDebtPayments'
  | 'bankDebtPayment'
  | 'financeDebtPayment'
  | 'cardDebtPayment'
  | 'informalDebtPayment'
  | 'otherDebtPayment'
  // Step 3
  | 'requestedAmount'
  | 'requestedTermMonths'
  | 'loanPurpose'
  // Step 4
  | 'ref1Name'
  | 'ref1Phone'
  | 'ref2Name'
  | 'ref2Phone'
  // Step 5
  | 'consentAccepted';

export interface ApplicationFormValues {
  applicantType: ApplicantType;
  skipExistingCustomerIdentity?: boolean;
  skipExistingBusinessFields?: boolean;
  documentType: 'CEDULA' | 'PASAPORTE';
  documentNumber: string;
  birthDate: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  residenceMonths: number | string;
  housingPayment: number | string;
  socialMediaDeclared: SocialMediaStatus;
  socialMediaHandle: string;
  altContactPhone: string;
  // Business
  rnc: string;
  legalName: string;
  authorizedRepName: string;
  authorizedRepDoc: string;
  operationsStartDate: string;
  // Step 2
  employmentMonths: number | string;
  incomeSourceType: IncomeSourceType;
  primaryNetIncome: string;
  additionalIncomeStatus: AdditionalIncomeStatus;
  additionalNetIncome: string;
  declaredTotalMonthlyIncome: string;
  grossSales: string;
  operatingCosts: string;
  netMonthlyFlow: string;
  essentialExpenses: string;
  debtDeclarationStatus: DebtDeclarationStatus;
  debtCount: string;
  totalDebtBalance: string;
  currentDebtPayments: string;
  bankDebtPayment: string;
  financeDebtPayment: string;
  cardDebtPayment: string;
  informalDebtPayment: string;
  otherDebtPayment: string;
  // Step 3
  currency: CurrencyCode;
  requestedAmount: string;
  requestedTermMonths: string;
  loanPurpose: string;
  // Step 4
  ref1Name: string;
  ref1Rel: string;
  ref1Phone: string;
  ref2Name: string;
  ref2Rel: string;
  ref2Phone: string;
  // Step 5
  consentAccepted: boolean;
}

export interface ApplicationValidationOptions {
  productPolicy?: ProductLimitConfig | null;
  referenceDate?: Date;
}

export interface ApplicationValidationResult {
  errors: Partial<Record<ApplicationFieldName, string>>;
  warnings: Partial<Record<ApplicationFieldName, string>>;
  stepErrorCounts: Record<ApplicationFormStep, number>;
  stepValid: Record<ApplicationFormStep, boolean>;
  isFormValid: boolean;
  firstInvalidStep: ApplicationFormStep | null;
  firstInvalidFieldByStep: Partial<Record<ApplicationFormStep, ApplicationFieldName>>;
}

export const STEP_FIELDS: Record<ApplicationFormStep, ApplicationFieldName[]> = {
  1: [
    'documentNumber',
    'birthDate',
    'firstName',
    'lastName',
    'phone',
    'email',
    'residenceMonths',
    'housingPayment',
    'socialMediaHandle',
    'altContactPhone',
    'rnc',
    'legalName',
    'authorizedRepName',
    'authorizedRepDoc',
    'operationsStartDate',
  ],
  2: [
    'employmentMonths',
    'primaryNetIncome',
    'additionalNetIncome',
    'declaredTotalMonthlyIncome',
    'grossSales',
    'operatingCosts',
    'netMonthlyFlow',
    'essentialExpenses',
    'debtCount',
    'totalDebtBalance',
    'currentDebtPayments',
    'bankDebtPayment',
    'financeDebtPayment',
    'cardDebtPayment',
    'informalDebtPayment',
    'otherDebtPayment',
  ],
  3: ['requestedAmount', 'requestedTermMonths', 'loanPurpose'],
  4: ['ref1Name', 'ref1Phone', 'ref2Name', 'ref2Phone'],
  5: ['consentAccepted'],
};

export const ALL_APPLICATION_FIELDS: ApplicationFieldName[] = [
  ...STEP_FIELDS[1],
  ...STEP_FIELDS[2],
  ...STEP_FIELDS[3],
  ...STEP_FIELDS[4],
  ...STEP_FIELDS[5],
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSPORT_REGEX = /^[A-Za-z0-9-]{6,20}$/;
const NAME_HAS_LETTER_REGEX = /[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/;
const NAME_ALLOWED_CHARS_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s.'-]+$/;
const MAX_MONETARY_VALUE = 100_000_000;

function digitsOnly(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function parseFiniteNumber(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDateParts(dateStr: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function computeAgeYears(
  birth: { year: number; month: number; day: number },
  today: Date
): number {
  const curY = today.getFullYear();
  const curM = today.getMonth() + 1;
  const curD = today.getDate();
  let age = curY - birth.year;
  if (curM < birth.month || (curM === birth.month && curD < birth.day)) {
    age -= 1;
  }
  return age;
}

function validatePhoneString(raw: string, required: boolean): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return required ? 'Ingresa un número de teléfono principal.' : null;
  }
  if (/[^0-9\s()+-]/.test(trimmed)) {
    return 'Solo se permiten números, espacios, guiones, paréntesis o signo +.';
  }
  const digits = digitsOnly(trimmed);
  if (digits.length < 7) {
    return 'El teléfono debe tener al menos 7 dígitos (ej. 809-555-0000).';
  }
  if (digits.length < 10 && required) {
    return 'Ingresa un número completo de 10 dígitos (ej. 809-555-0000).';
  }
  if (digits.length > 15) {
    return 'El teléfono no puede exceder 15 dígitos.';
  }
  return null;
}

function validatePersonName(raw: string, label: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return `Ingresa ${label}.`;
  }
  if (trimmed.length < 2) {
    return `Debe contener al menos 2 caracteres.`;
  }
  if (!NAME_HAS_LETTER_REGEX.test(trimmed) || !NAME_ALLOWED_CHARS_REGEX.test(trimmed)) {
    return 'Usa únicamente letras válidas (sin números ni símbolos especiales).';
  }
  return null;
}

function validateOptionalNonNegativeNumber(
  raw: string | number,
  max = MAX_MONETARY_VALUE,
  label = 'Este monto'
): string | null {
  const str = String(raw ?? '').trim();
  if (str === '') return null;
  const n = parseFiniteNumber(raw);
  if (n === null) return `${label} debe ser un valor numérico válido.`;
  if (n < 0) return `${label} no puede ser negativo.`;
  if (n > max) return `${label} no puede superar ${max.toLocaleString('en-US')}.`;
  return null;
}

export function validateApplicationFormFields(
  values: ApplicationFormValues,
  options: ApplicationValidationOptions = {}
): ApplicationValidationResult {
  const errors: Partial<Record<ApplicationFieldName, string>> = {};
  const warnings: Partial<Record<ApplicationFieldName, string>> = {};
  const today = options.referenceDate ?? new Date();

  // ==================== STEP 1: SOLICITANTE ====================
  if (!values.skipExistingCustomerIdentity) {
    const docTrimmed = values.documentNumber.trim();
    if (!docTrimmed) {
      errors.documentNumber =
        values.documentType === 'CEDULA'
          ? 'Ingresa el número de cédula (11 dígitos).'
          : 'Ingresa el número de pasaporte.';
    } else if (values.documentType === 'CEDULA') {
      if (/[^0-9\s-]/.test(docTrimmed)) {
        errors.documentNumber = 'La cédula solo debe contener números y guiones (ej. 001-0000000-0).';
      } else {
        const digits = digitsOnly(docTrimmed);
        if (digits.length !== 11) {
          errors.documentNumber = `La cédula dominicana debe tener 11 dígitos (llevas ${digits.length}).`;
        }
      }
    } else {
      const compactPassport = docTrimmed.replace(/\s+/g, '');
      if (!PASSPORT_REGEX.test(compactPassport)) {
        errors.documentNumber = 'El pasaporte debe tener entre 6 y 20 caracteres alfanuméricos.';
      }
    }

    const firstNameErr = validatePersonName(values.firstName, 'los nombres del solicitante');
    if (firstNameErr) errors.firstName = firstNameErr;

    const lastNameErr = validatePersonName(values.lastName, 'los apellidos del solicitante');
    if (lastNameErr) errors.lastName = lastNameErr;

    const phoneErr = validatePhoneString(values.phone, true);
    if (phoneErr) errors.phone = phoneErr;
  }

  if (values.birthDate.trim()) {
    const parsedBirth = parseIsoDateParts(values.birthDate);
    if (!parsedBirth) {
      errors.birthDate = 'Selecciona una fecha de nacimiento válida.';
    } else {
      const age = computeAgeYears(parsedBirth, today);
      if (age < 0) {
        errors.birthDate = 'La fecha de nacimiento no puede estar en el futuro.';
      } else if (age < 18) {
        errors.birthDate = 'El solicitante debe ser mayor de 18 años.';
      } else if (age > 110) {
        errors.birthDate = 'Verifica el año de nacimiento ingresado.';
      }
    }
  }

  if (values.email.trim() && !EMAIL_REGEX.test(values.email.trim())) {
    errors.email = 'Ingresa un correo electrónico válido (ej. nombre@dominio.com).';
  }

  const resMonthsNum = parseFiniteNumber(values.residenceMonths);
  if (String(values.residenceMonths ?? '').trim() !== '') {
    if (resMonthsNum === null || resMonthsNum < 0 || !Number.isInteger(resMonthsNum)) {
      errors.residenceMonths = 'Ingresa un número entero mayor o igual a 0.';
    } else if (resMonthsNum > 1200) {
      errors.residenceMonths = 'El tiempo de residencia no puede exceder 1,200 meses.';
    }
  }

  const housingPayErr = validateOptionalNonNegativeNumber(
    values.housingPayment,
    MAX_MONETARY_VALUE,
    'El pago mensual de vivienda'
  );
  if (housingPayErr) errors.housingPayment = housingPayErr;

  if (values.socialMediaDeclared === 'YES' && values.socialMediaHandle.trim()) {
    if (values.socialMediaHandle.trim().length < 2) {
      errors.socialMediaHandle = 'Indica un usuario o enlace válido (mín. 2 caracteres).';
    }
  }

  const altPhoneErr = validatePhoneString(values.altContactPhone, false);
  if (altPhoneErr) errors.altContactPhone = altPhoneErr;

  if (values.applicantType === 'BUSINESS' && !values.skipExistingBusinessFields) {
    const rncTrimmed = values.rnc.trim();
    if (!rncTrimmed) {
      errors.rnc = 'Ingresa el RNC de la empresa (9 u 11 dígitos).';
    } else if (/[^0-9\s-]/.test(rncTrimmed)) {
      errors.rnc = 'El RNC solo debe contener dígitos y guiones (ej. 1-31-99887-2).';
    } else {
      const rncDigits = digitsOnly(rncTrimmed);
      if (rncDigits.length !== 9 && rncDigits.length !== 11) {
        errors.rnc = `El RNC dominicano debe tener 9 u 11 dígitos (llevas ${rncDigits.length}).`;
      }
    }

    if (values.legalName.trim().length < 3) {
      errors.legalName = 'Ingresa la Razón Social completa (mínimo 3 caracteres).';
    }

    const repErr = validatePersonName(
      values.authorizedRepName,
      'el nombre del representante autorizado'
    );
    if (repErr) errors.authorizedRepName = repErr;

    if (values.authorizedRepDoc.trim()) {
      const repDocClean = values.authorizedRepDoc.trim().replace(/[\s-]+/g, '');
      if (repDocClean.length < 5 || repDocClean.length > 25 || /[^A-Za-z0-9]/.test(repDocClean)) {
        errors.authorizedRepDoc = 'Documento de representante inválido (mín. 5 caracteres alfanuméricos).';
      }
    }

    if (values.operationsStartDate.trim()) {
      const opsDate = parseIsoDateParts(values.operationsStartDate);
      if (!opsDate) {
        errors.operationsStartDate = 'Ingresa una fecha de inicio válida.';
      } else {
        const opsTs = new Date(opsDate.year, opsDate.month - 1, opsDate.day).getTime();
        const todayEnd = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          23,
          59,
          59
        ).getTime();
        if (opsTs > todayEnd) {
          errors.operationsStartDate = 'La fecha de inicio de operaciones no puede ser futura.';
        }
      }
    }
  }

  // ==================== STEP 2: LABORAL Y FINANZAS ====================
  const empMonthsNum = parseFiniteNumber(values.employmentMonths);
  if (String(values.employmentMonths ?? '').trim() !== '') {
    if (empMonthsNum === null || empMonthsNum < 0 || !Number.isInteger(empMonthsNum)) {
      errors.employmentMonths = 'Ingresa una antigüedad en meses válida (0 o mayor).';
    } else if (empMonthsNum > 1200) {
      errors.employmentMonths = 'La antigüedad no puede superar 1,200 meses.';
    }
  }

  if (values.applicantType === 'BUSINESS') {
    const grossErr = validateOptionalNonNegativeNumber(
      values.grossSales,
      MAX_MONETARY_VALUE,
      'Las ventas brutas'
    );
    if (grossErr) errors.grossSales = grossErr;

    const costsErr = validateOptionalNonNegativeNumber(
      values.operatingCosts,
      MAX_MONETARY_VALUE,
      'Los costos operativos'
    );
    if (costsErr) errors.operatingCosts = costsErr;

    const netFlowNum = parseFiniteNumber(values.netMonthlyFlow);
    if (netFlowNum === null || netFlowNum <= 0) {
      errors.netMonthlyFlow = 'Indica un flujo neto mensual disponible mayor a 0.';
    } else if (netFlowNum > MAX_MONETARY_VALUE) {
      errors.netMonthlyFlow = 'El flujo neto no puede superar 100,000,000.';
    } else {
      const grossNum = parseFiniteNumber(values.grossSales);
      if (grossNum !== null && grossNum > 0 && netFlowNum > grossNum) {
        warnings.netMonthlyFlow =
          'El flujo neto supera las ventas brutas declaradas; verifica las cifras.';
      }
    }
  } else {
    const primaryIncNum = parseFiniteNumber(values.primaryNetIncome);
    if (values.incomeSourceType !== 'SIN_INGRESOS') {
      if (primaryIncNum === null || primaryIncNum <= 0) {
        errors.primaryNetIncome = 'Indica tu ingreso principal neto mensual (mayor a 0).';
      } else if (primaryIncNum > MAX_MONETARY_VALUE) {
        errors.primaryNetIncome = 'El ingreso no puede superar 100,000,000.';
      }
    } else if (primaryIncNum !== null && (primaryIncNum < 0 || primaryIncNum > MAX_MONETARY_VALUE)) {
      errors.primaryNetIncome = 'Ingresa un monto válido (0 o mayor).';
    }

    if (values.additionalIncomeStatus !== 'EXPLICIT_NONE') {
      const addIncNum = parseFiniteNumber(values.additionalNetIncome);
      if (values.additionalIncomeStatus === 'QUANTIFIED') {
        if (addIncNum === null || addIncNum <= 0) {
          errors.additionalNetIncome = 'Indica el monto de ingresos adicionales cuantificados (> 0).';
        } else if (addIncNum > MAX_MONETARY_VALUE) {
          errors.additionalNetIncome = 'El monto no puede superar 100,000,000.';
        }
      } else {
        const addErr = validateOptionalNonNegativeNumber(
          values.additionalNetIncome,
          MAX_MONETARY_VALUE,
          'Los ingresos adicionales'
        );
        if (addErr) errors.additionalNetIncome = addErr;
      }
    }

    const declErr = validateOptionalNonNegativeNumber(
      values.declaredTotalMonthlyIncome,
      MAX_MONETARY_VALUE,
      'El ingreso total declarado'
    );
    if (declErr) errors.declaredTotalMonthlyIncome = declErr;
  }

  const essNum = parseFiniteNumber(values.essentialExpenses);
  if (values.essentialExpenses.trim() === '' || essNum === null) {
    errors.essentialExpenses = 'Ingresa tus gastos esenciales mensuales (puede ser 0).';
  } else if (essNum < 0) {
    errors.essentialExpenses = 'Los gastos esenciales no pueden ser negativos.';
  } else if (essNum > MAX_MONETARY_VALUE) {
    errors.essentialExpenses = 'Los gastos no pueden superar 100,000,000.';
  }

  if (values.debtDeclarationStatus === 'HAS_DEBTS') {
    const dCount = parseFiniteNumber(values.debtCount);
    if (dCount === null || !Number.isInteger(dCount) || dCount < 1) {
      errors.debtCount = 'Indica al menos 1 deuda activa (número entero).';
    } else if (dCount > 100) {
      errors.debtCount = 'La cantidad de deudas no puede superar 100.';
    }

    const dBal = parseFiniteNumber(values.totalDebtBalance);
    if (dBal === null || dBal <= 0) {
      errors.totalDebtBalance = 'Indica el saldo total adeudado (mayor a 0).';
    } else if (dBal > MAX_MONETARY_VALUE) {
      errors.totalDebtBalance = 'El saldo no puede superar 100,000,000.';
    }

    const dPmt = parseFiniteNumber(values.currentDebtPayments);
    if (dPmt === null || dPmt <= 0) {
      errors.currentDebtPayments = 'Indica el total de cuotas mensuales vigentes (mayor a 0).';
    } else if (dPmt > MAX_MONETARY_VALUE) {
      errors.currentDebtPayments = 'Las cuotas mensuales no pueden superar 100,000,000.';
    }

    const breakdownPairs: Array<[ApplicationFieldName, string]> = [
      ['bankDebtPayment', values.bankDebtPayment],
      ['financeDebtPayment', values.financeDebtPayment],
      ['cardDebtPayment', values.cardDebtPayment],
      ['informalDebtPayment', values.informalDebtPayment],
      ['otherDebtPayment', values.otherDebtPayment],
    ];
    for (const [key, rawVal] of breakdownPairs) {
      const bErr = validateOptionalNonNegativeNumber(rawVal, MAX_MONETARY_VALUE, 'Esta cuota');
      if (bErr) errors[key] = bErr;
    }
  }

  // ==================== STEP 3: CONDICIONES ====================
  const amountNum = parseFiniteNumber(values.requestedAmount);
  if (amountNum === null || amountNum <= 0) {
    errors.requestedAmount = 'Ingresa un monto solicitado mayor a 0.';
  } else if (amountNum > MAX_MONETARY_VALUE) {
    errors.requestedAmount = 'El monto solicitado no puede superar 100,000,000.';
  } else if (options.productPolicy) {
    if (amountNum < options.productPolicy.minAmount) {
      warnings.requestedAmount = `Por debajo del mínimo de política (${options.productPolicy.minAmount.toLocaleString('en-US')} ${values.currency}); requerirá revisión humana.`;
    } else if (amountNum > options.productPolicy.maxAmount) {
      warnings.requestedAmount = `Supera el máximo de política (${options.productPolicy.maxAmount.toLocaleString('en-US')} ${values.currency}); requerirá revisión humana.`;
    }
  }

  const termNum = parseFiniteNumber(values.requestedTermMonths);
  if (termNum === null || !Number.isInteger(termNum) || termNum < 1 || termNum > 360) {
    errors.requestedTermMonths = 'Ingresa un plazo entero entre 1 y 360 meses.';
  } else if (options.productPolicy) {
    if (
      termNum < options.productPolicy.minTermMonths ||
      termNum > options.productPolicy.maxTermMonths
    ) {
      warnings.requestedTermMonths = `Fuera del rango de política (${options.productPolicy.minTermMonths}–${options.productPolicy.maxTermMonths} meses); requerirá revisión humana.`;
    }
  }

  const purposeTrimmed = values.loanPurpose.trim();
  if (purposeTrimmed.length < 3) {
    errors.loanPurpose = 'Indica el destino del financiamiento (mínimo 3 caracteres).';
  } else if (purposeTrimmed.length > 120) {
    errors.loanPurpose = 'El destino no debe exceder 120 caracteres.';
  }

  // ==================== STEP 4: REFERENCIAS ====================
  const ref1Started = Boolean(
    values.ref1Name.trim() || values.ref1Rel.trim() || values.ref1Phone.trim()
  );
  if (ref1Started) {
    if (values.ref1Name.trim().length < 3) {
      errors.ref1Name = 'Completa el nombre de la Referencia 1 (mín. 3 caracteres).';
    }
    const r1PhoneErr = validatePhoneString(values.ref1Phone, true);
    if (r1PhoneErr) errors.ref1Phone = r1PhoneErr;
  }

  const ref2Started = Boolean(
    values.ref2Name.trim() || values.ref2Rel.trim() || values.ref2Phone.trim()
  );
  if (ref2Started) {
    if (values.ref2Name.trim().length < 3) {
      errors.ref2Name = 'Completa el nombre de la Referencia 2 (mín. 3 caracteres).';
    }
    const r2PhoneErr = validatePhoneString(values.ref2Phone, true);
    if (r2PhoneErr) errors.ref2Phone = r2PhoneErr;
  }

  // ==================== STEP 5: CONSENTIMIENTO ====================
  if (!values.consentAccepted) {
    errors.consentAccepted =
      'Debes aceptar los términos y la autorización de tratamiento de datos (Ley 172-13) para enviar.';
  }

  // ==================== STEP SUMMARIES ====================
  const stepErrorCounts: Record<ApplicationFormStep, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const firstInvalidFieldByStep: Partial<Record<ApplicationFormStep, ApplicationFieldName>> = {};

  for (const stepNum of [1, 2, 3, 4, 5] as const) {
    for (const field of STEP_FIELDS[stepNum]) {
      if (errors[field]) {
        stepErrorCounts[stepNum] += 1;
        if (!firstInvalidFieldByStep[stepNum]) {
          firstInvalidFieldByStep[stepNum] = field;
        }
      }
    }
  }

  const stepValid: Record<ApplicationFormStep, boolean> = {
    1: stepErrorCounts[1] === 0,
    2: stepErrorCounts[2] === 0,
    3: stepErrorCounts[3] === 0,
    4: stepErrorCounts[4] === 0,
    5: stepErrorCounts[5] === 0,
  };

  const firstInvalidStep =
    ([1, 2, 3, 4, 5] as const).find((s) => stepErrorCounts[s] > 0) ?? null;

  return {
    errors,
    warnings,
    stepErrorCounts,
    stepValid,
    isFormValid: firstInvalidStep === null,
    firstInvalidStep,
    firstInvalidFieldByStep,
  };
}
