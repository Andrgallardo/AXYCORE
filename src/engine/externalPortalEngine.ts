import type {
  AmortizationMethod,
  ApplicantType,
  BusinessFinancialInput,
  ClientServiceRequestType,
  ExternalPortalActionIntent,
  IndividualFinancialInput,
  OrganizationRecord,
  PublicApplicantBusinessDetails,
  PublicApplicantCustomerDetails,
  PublicAttachedDocument,
  PublicBiometricSummary,
  PublicInstitutionPortalRecord,
  ReferenceItem,
} from '../types/axycore';
import { isValidInstitutionalLogoUrl } from '../utils/institutionalLogo';

export interface ParsedExternalPortalLink {
  isExternalInstitutionLink: boolean;
  portalCode: string | null;
  actionIntent: ExternalPortalActionIntent;
}

export interface InstitutionExternalPortalLinks {
  portalCode: string;
  portalUrl: string;
  creditApplicationUrl: string;
  registerUrl: string;
}

export interface ClientServiceRequestCatalogItem {
  type: ClientServiceRequestType;
  label: string;
  shortLabel: string;
  description: string;
  requiresLoan: boolean;
  showAmountField: boolean;
  showDateField: boolean;
  placeholderDetails: string;
  estimatedSla: string;
}

export const CLIENT_SERVICE_REQUEST_CATALOG: ClientServiceRequestCatalogItem[] = [
  {
    type: 'CARTA_SALDO',
    label: 'Carta de Saldo / Certificación de Préstamo',
    shortLabel: 'Carta de Saldo',
    description:
      'Solicita una certificación oficial de saldo pendiente o carta de saldo cancelado para fines bancarios o legales.',
    requiresLoan: true,
    showAmountField: false,
    showDateField: false,
    placeholderDetails:
      'Indica a nombre de quién o qué entidad debe emitirse la carta y si prefieres recibirla por correo o retiro físico.',
    estimatedSla: '24 a 48 horas laborables',
  },
  {
    type: 'ESTADO_CUENTA',
    label: 'Estado de Cuenta y Calendario Certificado',
    shortLabel: 'Estado de Cuenta',
    description:
      'Recibe el desglose detallado de capital, intereses, cuotas pagadas y balance actual de tu préstamo.',
    requiresLoan: true,
    showAmountField: false,
    showDateField: false,
    placeholderDetails:
      'Especifica el rango de fechas o período que necesitas reflejado en el estado de cuenta.',
    estimatedSla: '24 horas laborables',
  },
  {
    type: 'ACUERDO_PRORROGA',
    label: 'Prórroga, Reestructuración o Acuerdo de Pago',
    shortLabel: 'Prórroga / Acuerdo',
    description:
      'Propón una nueva fecha de pago, ajuste temporal de cuota o acuerdo de normalización con la institución.',
    requiresLoan: true,
    showAmountField: true,
    showDateField: true,
    placeholderDetails:
      'Explica brevemente tu propuesta de pago, fechas disponibles y motivo de la solicitud.',
    estimatedSla: '24 a 48 horas laborables',
  },
  {
    type: 'AYUDA_ATRASO',
    label: 'Plan de Alivio Financiero por Atraso',
    shortLabel: 'Ayuda por Atraso',
    description:
      'Asistencia prioritaria para clientes con cuotas vencidas: acuerdo de pago, prórroga temporal, reestructuración de plazo o evaluación de descuento de mora.',
    requiresLoan: true,
    showAmountField: true,
    showDateField: true,
    placeholderDetails:
      'Cuéntanos tu situación actual, qué cuota mensual puedes asumir cómodamente y en qué fecha podrías retomar tus pagos.',
    estimatedSla: 'Prioritario · Menos de 24 horas laborables',
  },
  {
    type: 'ABONO_EXTRAORDINARIO',
    label: 'Abono Extraordinario o Cancelación Anticipada',
    shortLabel: 'Abono / Cancelación',
    description:
      'Coordina un abono directo a capital o solicita el monto exacto de liquidación total a una fecha específica.',
    requiresLoan: true,
    showAmountField: true,
    showDateField: true,
    placeholderDetails:
      'Indica si deseas aplicar el abono para reducir cuota o reducir plazo, o si solicitas cancelación total.',
    estimatedSla: '24 horas laborables',
  },
  {
    type: 'ACTUALIZACION_DATOS',
    label: 'Actualización de Datos Personales y Contacto',
    shortLabel: 'Actualizar Datos',
    description:
      'Actualiza tu teléfono, correo electrónico, dirección residencial o lugar de trabajo registrado.',
    requiresLoan: false,
    showAmountField: false,
    showDateField: false,
    placeholderDetails:
      'Indica claramente los nuevos datos (teléfono, dirección, correo o empleo) que deseas actualizar.',
    estimatedSla: '24 horas laborables',
  },
  {
    type: 'VINCULACION_EXPEDIENTE',
    label: 'Vincular Préstamos Existentes a mi Usuario',
    shortLabel: 'Vincular Préstamos',
    description:
      'Si ya eres cliente de la institución y aún no ves tus préstamos vigentes aquí, solicita la vinculación directa de tu expediente.',
    requiresLoan: false,
    showAmountField: false,
    showDateField: false,
    placeholderDetails:
      'Confirma tu número de cédula, teléfono registrado y, si lo recuerdas, el número de tu préstamo.',
    estimatedSla: 'Mismo día laborable',
  },
  {
    type: 'CONSULTA_RECLAMO',
    label: 'Consulta General, Soporte o Reclamación',
    shortLabel: 'Consulta / Soporte',
    description:
      'Envía cualquier inquietud sobre cuotas, pagos aplicados, seguros, cargos o atención al cliente.',
    requiresLoan: false,
    showAmountField: false,
    showDateField: false,
    placeholderDetails:
      'Describe tu consulta o solicitud con la mayor claridad posible para darte una respuesta precisa.',
    estimatedSla: '24 a 48 horas laborables',
  },
];

export const CLIENT_SERVICE_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Recibida · Pendiente',
  EN_PROCESO: 'En atención',
  COMPLETADA: 'Completada',
  RECHAZADA: 'No procedente',
};

export function normalizePortalCode(raw: string | null | undefined): string {
  const cleaned = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  return cleaned.slice(0, 40);
}

export function normalizeDocumentDigits(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function buildCustomerDocumentKey(
  organizationId: string,
  documentNumber: string,
  documentType: 'CEDULA' | 'PASAPORTE' = 'CEDULA'
): string {
  const cleanDigits = normalizeDocumentDigits(documentNumber);
  return `${organizationId}_${documentType}_${cleanDigits}`;
}

export function buildPhoneFormatCandidates(rawPhone: string): string[] {
  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/\D/g, '');
  const set = new Set<string>();
  if (trimmed) set.add(trimmed);
  if (digits) set.add(digits);
  if (digits.length === 10) {
    set.add(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
    set.add(`(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
    set.add(`${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`);
    set.add(`1-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
  } else if (digits.length === 11 && digits.startsWith('1')) {
    const d10 = digits.slice(1);
    set.add(d10);
    set.add(`${d10.slice(0, 3)}-${d10.slice(3, 6)}-${d10.slice(6)}`);
  }
  return Array.from(set).filter((v) => v.length >= 7 && v.length <= 40);
}

export function buildInstitutionExternalPortalLinks(
  org: Pick<OrganizationRecord, 'id' | 'accessCode' | 'tenantId'>,
  origin?: string
): InstitutionExternalPortalLinks {
  const portalCode = normalizePortalCode(org.accessCode || org.tenantId || org.id) || 'SGMA-001';
  const baseOrigin =
    origin ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://axycore.app');
  const cleanOrigin = baseOrigin.replace(/\/+$/, '');
  const encoded = encodeURIComponent(portalCode);
  return {
    portalCode,
    portalUrl: `${cleanOrigin}/?portal=${encoded}`,
    creditApplicationUrl: `${cleanOrigin}/?portal=${encoded}&action=solicitud`,
    registerUrl: `${cleanOrigin}/?portal=${encoded}&action=registro`,
  };
}

export function parseExternalPortalLinkFromLocation(
  search: string,
  pathname = '/'
): ParsedExternalPortalLink {
  const params = new URLSearchParams(search || '');
  let rawCode =
    params.get('portal') || params.get('empresa') || params.get('institucion') || '';

  if (!rawCode && pathname) {
    const match = pathname.match(/^\/portal\/([a-zA-Z0-9_-]{2,40})\/?$/i);
    if (match?.[1]) {
      rawCode = match[1];
    }
  }

  const portalCode = normalizePortalCode(rawCode);
  if (!portalCode) {
    return {
      isExternalInstitutionLink: false,
      portalCode: null,
      actionIntent: 'portal',
    };
  }

  const rawAction = (params.get('action') || params.get('modo') || '').trim().toLowerCase();
  let actionIntent: ExternalPortalActionIntent = 'portal';
  if (rawAction === 'solicitud' || rawAction === 'apply' || rawAction === 'credito') {
    actionIntent = 'solicitud';
  } else if (rawAction === 'registro' || rawAction === 'register' || rawAction === 'crear') {
    actionIntent = 'registro';
  } else if (rawAction === 'ingresar' || rawAction === 'login') {
    actionIntent = 'ingresar';
  }

  return {
    isExternalInstitutionLink: true,
    portalCode,
    actionIntent,
  };
}

/**
 * Produces a strictly whitelisted, PII-free public branding record for `public_portals/{portalCode}`.
 * Never exposes admin emails, RNC/taxIds, internal notes, or private tenant metadata.
 */
export function buildPublicPortalRecordFromOrg(
  org: OrganizationRecord,
  overrides?: {
    portalEnabled?: boolean;
    welcomeHeadline?: string;
    welcomeSubtitle?: string;
  }
): PublicInstitutionPortalRecord {
  const portalCode = normalizePortalCode(org.accessCode || org.tenantId || org.id) || 'SGMA-001';
  const tradeName = (org.tradeName || org.name || 'Institución Financiera').trim().slice(0, 160);
  const name = (org.name || tradeName).trim().slice(0, 160);

  return {
    id: portalCode,
    portalCode,
    organizationId: org.id,
    name,
    tradeName,
    ...(isValidInstitutionalLogoUrl(org.logoUrl) && org.logoUrl!.trim().length <= 350000
      ? { logoUrl: org.logoUrl!.trim() }
      : {}),
    primaryColor: (org.primaryColor || '#0B1220').slice(0, 32),
    accentColor: (org.accentColor || '#0066FF').slice(0, 32),
    currency: org.currency === 'USD' ? 'USD' : 'DOP',
    ...(org.phone ? { phone: org.phone.slice(0, 40) } : {}),
    ...(org.corporateEmail ? { corporateEmail: org.corporateEmail.slice(0, 254) } : {}),
    ...(org.city ? { city: org.city.slice(0, 80) } : {}),
    ...(org.country ? { country: org.country.slice(0, 80) } : {}),
    status: org.status || 'ACTIVA',
    portalEnabled: overrides?.portalEnabled ?? true,
    welcomeHeadline: (
      overrides?.welcomeHeadline ||
      `Portal de Clientes y Solicitudes de Crédito — ${tradeName}`
    ).slice(0, 160),
    welcomeSubtitle: (
      overrides?.welcomeSubtitle ||
      'Completa tu solicitud de crédito en línea o crea tu cuenta para consultar tus préstamos, cuotas, montos y gestionar certificaciones.'
    ).slice(0, 360),
  };
}

export function getServiceRequestCatalogItem(
  type: ClientServiceRequestType
): ClientServiceRequestCatalogItem {
  return (
    CLIENT_SERVICE_REQUEST_CATALOG.find((item) => item.type === type) ||
    CLIENT_SERVICE_REQUEST_CATALOG[CLIENT_SERVICE_REQUEST_CATALOG.length - 1]
  );
}

export const PUBLIC_CREDIT_APPLICATION_STATUS_LABELS: Record<string, string> = {
  RECIBIDA_PUBLICA: 'Pendiente de ingreso al Motor V2',
  INGRESADA_MOTOR: 'Ingresada en Originación y Motor V2',
  DESCARTADA: 'Descartada / Archivada',
};

/**
 * Generates a clean, unique, URL-safe portal code for a registered institution.
 * Avoids collisions with any already-registered portal codes.
 */
export function generateUniquePortalCodeForOrg(
  orgName: string,
  existingCodes: string[] = []
): string {
  const existingSet = new Set(existingCodes.map((c) => normalizePortalCode(c)).filter(Boolean));
  const words = String(orgName || 'INST')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'SRL', 'SA', 'SAS', 'EIRL'].includes(w));

  let prefix = '';
  if (words.length >= 2) {
    prefix = words
      .slice(0, 4)
      .map((w) => w[0])
      .join('');
    if (prefix.length < 3) {
      prefix = (words[0].slice(0, 3) + words[1].slice(0, 2)).slice(0, 5);
    }
  } else if (words.length === 1) {
    prefix = words[0].slice(0, 5);
  } else {
    prefix = 'INST';
  }
  prefix = prefix.replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'INST';

  for (let seq = 1; seq <= 999; seq += 1) {
    const candidate = `${prefix}-${String(seq).padStart(3, '0')}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}-${String(Date.now()).slice(-4)}`;
}

export interface IndicativePublicInstallmentResult {
  installmentAmount: number;
  installmentsCount: number;
  totalPayable: number;
  totalInterest: number;
  monthlyRateUsed: number;
}

/**
 * Computes a fast, deterministic indicative French-amortization installment for the public
 * credit application form (clearly marked as referential prior to Motor V2 policy evaluation).
 */
export function computeIndicativePublicInstallment(params: {
  amount: number;
  termMonths: number;
  frequency: 'MENSUAL' | 'QUINCENAL' | 'SEMANAL' | 'DIARIA';
  monthlyRate?: number;
}): IndicativePublicInstallmentResult {
  const amount = Math.max(0, Number(params.amount) || 0);
  const termMonths = Math.max(1, Math.min(360, Math.round(Number(params.termMonths) || 12)));
  const monthlyRate =
    typeof params.monthlyRate === 'number' && Number.isFinite(params.monthlyRate) && params.monthlyRate > 0
      ? Math.min(0.25, params.monthlyRate)
      : 0.035;

  const periodsPerMonth =
    params.frequency === 'QUINCENAL'
      ? 2
      : params.frequency === 'SEMANAL'
      ? 4
      : params.frequency === 'DIARIA'
      ? 26
      : 1;

  const installmentsCount = Math.max(1, Math.round(termMonths * periodsPerMonth));
  const periodRate = monthlyRate / periodsPerMonth;

  if (amount <= 0) {
    return {
      installmentAmount: 0,
      installmentsCount,
      totalPayable: 0,
      totalInterest: 0,
      monthlyRateUsed: monthlyRate,
    };
  }

  const factor = Math.pow(1 + periodRate, installmentsCount);
  const rawInstallment =
    periodRate > 0 ? (amount * periodRate * factor) / (factor - 1) : amount / installmentsCount;
  const installmentAmount = Math.round(rawInstallment * 100) / 100;
  const totalPayable = Math.round(installmentAmount * installmentsCount * 100) / 100;
  const totalInterest = Math.max(0, Math.round((totalPayable - amount) * 100) / 100);

  return {
    installmentAmount,
    installmentsCount,
    totalPayable,
    totalInterest,
    monthlyRateUsed: monthlyRate,
  };
}

export interface PublicCreditApplicationInput {
  applicantType?: ApplicantType;
  applicantFullName: string;
  documentType: 'CEDULA' | 'PASAPORTE';
  documentNumber: string;
  phone: string;
  email?: string;
  address?: string;
  province?: string;
  productCode: 'PERSONAL_DOP' | 'EMPRESARIAL_DOP' | 'PERSONAL_USD' | 'EMPRESARIAL_USD';
  currency: 'DOP' | 'USD';
  requestedAmount: number;
  requestedTermMonths: number;
  paymentFrequency: 'MENSUAL' | 'QUINCENAL' | 'SEMANAL' | 'DIARIA';
  amortizationMethod?: AmortizationMethod;
  loanPurpose: string;
  loanPurposeDescription?: string;
  proposedCollateral?: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  employerOrActivity?: string;
  customerDetails?: PublicApplicantCustomerDetails;
  businessDetails?: PublicApplicantBusinessDetails | null;
  financialData?: IndividualFinancialInput;
  businessFinancialData?: BusinessFinancialInput | null;
  references?: ReferenceItem[];
  declaredDocumentsSummary?: {
    hasIdentityDoc: boolean;
    hasIncomeEvidence: boolean;
  };
  attachedDocuments?: PublicAttachedDocument[];
  biometricSummary?: PublicBiometricSummary | null;
  consentVersion?: string;
  consentAccepted: boolean;
}

function clampOptionalNum(v: unknown, max = 100_000_000): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(max, Math.round(n * 100) / 100);
}

export function validatePublicCreditApplicationPayload(input: PublicCreditApplicationInput): {
  valid: boolean;
  errors: string[];
  sanitized?: PublicCreditApplicationInput;
} {
  const errors: string[] = [];
  const applicantType: ApplicantType = input.applicantType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
  const applicantFullName = String(input.applicantFullName || '').trim().slice(0, 200);
  const documentType = input.documentType === 'PASAPORTE' ? 'PASAPORTE' : 'CEDULA';
  const documentNumber = String(input.documentNumber || '').trim().slice(0, 40);
  const cleanDocDigits = normalizeDocumentDigits(documentNumber);
  const phone = String(input.phone || '').trim().slice(0, 40);
  const cleanPhoneDigits = phone.replace(/\D/g, '');
  const email = String(input.email || '').trim().toLowerCase().slice(0, 254);
  const address = String(input.address || '').trim().slice(0, 300);
  const province = String(input.province || '').trim().slice(0, 100);
  const loanPurpose = String(input.loanPurpose || '').trim().slice(0, 120);
  const loanPurposeDescription = String(input.loanPurposeDescription || '').trim().slice(0, 1000);
  const proposedCollateral = String(input.proposedCollateral || '').trim().slice(0, 500);
  const employerOrActivity = String(input.employerOrActivity || '').trim().slice(0, 160);
  const consentVersion = String(input.consentVersion || 'v1.0-Ley172-13').trim().slice(0, 40);
  const requestedAmount = Number(input.requestedAmount);
  const requestedTermMonths = Math.round(Number(input.requestedTermMonths));
  const monthlyIncome = Number(input.monthlyIncome || 0);
  const monthlyExpenses = Number(input.monthlyExpenses || 0);

  if (applicantFullName.length < 3) {
    errors.push('Complete los nombres y apellidos del solicitante (mínimo 3 caracteres).');
  }
  if (cleanDocDigits.length < 5 || cleanDocDigits.length > 30) {
    errors.push('Ingresa un número de cédula o pasaporte válido.');
  }
  if (cleanPhoneDigits.length < 7 || cleanPhoneDigits.length > 20) {
    errors.push('Ingresa un número de teléfono principal válido.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('El formato del correo electrónico no es válido.');
  }
  if (applicantType === 'BUSINESS' && input.businessDetails) {
    const rncClean = normalizeDocumentDigits(input.businessDetails.rnc);
    if (rncClean.length < 6) {
      errors.push('Para solicitudes empresariales debe ingresar un RNC válido.');
    }
    if (!String(input.businessDetails.legalName || '').trim()) {
      errors.push('Para solicitudes empresariales debe ingresar la Razón Social.');
    }
    if (!String(input.businessDetails.authorizedRepName || '').trim()) {
      errors.push('Para solicitudes empresariales debe ingresar el Representante Autorizado.');
    }
  }
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 100_000_000) {
    errors.push('El monto solicitado debe ser mayor que 0 y no superar 100,000,000.');
  }
  if (!Number.isFinite(requestedTermMonths) || requestedTermMonths < 1 || requestedTermMonths > 360) {
    errors.push('El plazo solicitado debe estar entre 1 y 360 meses.');
  }
  const allowsZeroIncome = input.financialData?.incomeSourceType === 'SIN_INGRESOS';
  const bizNetFlow = Number(input.businessFinancialData?.netMonthlyFlow || 0);
  const effectiveMonthlyIncome =
    applicantType === 'BUSINESS' && bizNetFlow > 0 ? bizNetFlow : monthlyIncome;
  if (
    !Number.isFinite(effectiveMonthlyIncome) ||
    effectiveMonthlyIncome < 0 ||
    effectiveMonthlyIncome > 100_000_000 ||
    (!allowsZeroIncome && effectiveMonthlyIncome <= 0)
  ) {
    errors.push(
      applicantType === 'BUSINESS'
        ? 'Indica el flujo neto mensual disponible de la empresa (mayor a 0).'
        : 'Indica tu ingreso principal neto mensual (mayor a 0).'
    );
  }
  if (!Number.isFinite(monthlyExpenses) || monthlyExpenses < 0 || monthlyExpenses > 100_000_000) {
    errors.push('Los gastos esenciales mensuales deben ser un valor numérico mayor o igual a 0.');
  }
  if (loanPurpose.length < 3) {
    errors.push('Indica el destino del financiamiento.');
  }
  if (!input.consentAccepted) {
    errors.push('El solicitante debe aceptar los términos y la autorización de datos (Ley 172-13) antes de enviar.');
  }

  // Validate attached documents aggregate payload size to guarantee safe Firestore 1 MiB storage
  const rawDocs = Array.isArray(input.attachedDocuments) ? input.attachedDocuments.slice(0, 3) : [];
  let totalDataUrlChars = 0;
  const sanitizedDocs: PublicAttachedDocument[] = [];
  for (const d of rawDocs) {
    const fileDataUrl = String(d.fileDataUrl || '');
    totalDataUrlChars += fileDataUrl.length;
    if (fileDataUrl.length > 360_000) {
      errors.push(`El archivo "${d.fileName}" excede el tamaño máximo permitido (250 KB) para envío público.`);
      continue;
    }
    sanitizedDocs.push({
      category: String(d.category || 'Documento').trim().slice(0, 80),
      fileName: String(d.fileName || 'archivo').trim().slice(0, 240),
      mimeType: String(d.mimeType || 'application/octet-stream').trim().slice(0, 120),
      sizeBytes: Math.max(0, Math.min(300_000, Number(d.sizeBytes) || 0)),
      fileDataUrl,
      ...(d.notes ? { notes: String(d.notes).trim().slice(0, 500) } : {}),
    });
  }
  if (totalDataUrlChars > 720_000) {
    errors.push('El tamaño combinado de los archivos adjuntos excede el máximo permitido (500 KB en total). Reduce o quita un archivo.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const allowedProducts = ['PERSONAL_DOP', 'EMPRESARIAL_DOP', 'PERSONAL_USD', 'EMPRESARIAL_USD'] as const;
  const currency: 'DOP' | 'USD' = input.currency === 'USD' ? 'USD' : 'DOP';
  const fallbackProduct: PublicCreditApplicationInput['productCode'] =
    applicantType === 'BUSINESS'
      ? currency === 'USD'
        ? 'EMPRESARIAL_USD'
        : 'EMPRESARIAL_DOP'
      : currency === 'USD'
      ? 'PERSONAL_USD'
      : 'PERSONAL_DOP';
  const productCode = (allowedProducts as readonly string[]).includes(input.productCode)
    ? input.productCode
    : fallbackProduct;
  const allowedFreq = ['MENSUAL', 'QUINCENAL', 'SEMANAL', 'DIARIA'] as const;
  const paymentFrequency = (allowedFreq as readonly string[]).includes(input.paymentFrequency)
    ? input.paymentFrequency
    : 'MENSUAL';
  const amortizationMethod: AmortizationMethod =
    input.amortizationMethod === 'INTERES_FIJO' ? 'INTERES_FIJO' : 'SALDO_INSOLUTO';

  const sanitizedCustomerDetails: PublicApplicantCustomerDetails | undefined = input.customerDetails
    ? {
        firstName: String(input.customerDetails.firstName || '').trim().slice(0, 120),
        lastName: String(input.customerDetails.lastName || '').trim().slice(0, 120),
        ...(input.customerDetails.birthDate
          ? { birthDate: String(input.customerDetails.birthDate).trim().slice(0, 20) }
          : {}),
        ...(input.customerDetails.nationality
          ? { nationality: String(input.customerDetails.nationality).trim().slice(0, 80) }
          : {}),
        ...(input.customerDetails.maritalStatus
          ? { maritalStatus: String(input.customerDetails.maritalStatus).trim().slice(0, 60) }
          : {}),
        ...(input.customerDetails.altPhone
          ? { altPhone: String(input.customerDetails.altPhone).trim().slice(0, 40) }
          : {}),
        ...(input.customerDetails.municipality
          ? { municipality: String(input.customerDetails.municipality).trim().slice(0, 100) }
          : {}),
        residenceMonths: Math.max(0, Math.min(1200, Math.round(Number(input.customerDetails.residenceMonths) || 0))),
        ...(input.customerDetails.housingType ? { housingType: input.customerDetails.housingType } : {}),
        housingPayment: Math.max(0, Math.min(100_000_000, Number(input.customerDetails.housingPayment) || 0)),
        ...(input.customerDetails.socialMediaDeclared
          ? { socialMediaDeclared: input.customerDetails.socialMediaDeclared }
          : {}),
        ...(input.customerDetails.socialMediaHandle
          ? { socialMediaHandle: String(input.customerDetails.socialMediaHandle).trim().slice(0, 120) }
          : {}),
        ...(input.customerDetails.altContactName
          ? { altContactName: String(input.customerDetails.altContactName).trim().slice(0, 160) }
          : {}),
        ...(input.customerDetails.altContactPhone
          ? { altContactPhone: String(input.customerDetails.altContactPhone).trim().slice(0, 40) }
          : {}),
      }
    : undefined;

  const sanitizedBusinessDetails: PublicApplicantBusinessDetails | null | undefined =
    applicantType === 'BUSINESS' && input.businessDetails
      ? {
          rnc: String(input.businessDetails.rnc || '').trim().slice(0, 40),
          legalName: String(input.businessDetails.legalName || '').trim().slice(0, 200),
          ...(input.businessDetails.tradeName
            ? { tradeName: String(input.businessDetails.tradeName).trim().slice(0, 200) }
            : {}),
          ...(input.businessDetails.companyType
            ? { companyType: String(input.businessDetails.companyType).trim().slice(0, 80) }
            : {}),
          ...(input.businessDetails.economicActivity
            ? { economicActivity: String(input.businessDetails.economicActivity).trim().slice(0, 160) }
            : {}),
          ...(input.businessDetails.operationsStartDate
            ? { operationsStartDate: String(input.businessDetails.operationsStartDate).trim().slice(0, 20) }
            : {}),
          authorizedRepName: String(input.businessDetails.authorizedRepName || '').trim().slice(0, 160),
          ...(input.businessDetails.authorizedRepDoc
            ? { authorizedRepDoc: String(input.businessDetails.authorizedRepDoc).trim().slice(0, 40) }
            : {}),
          ...(input.businessDetails.corporateDocsSummary
            ? { corporateDocsSummary: String(input.businessDetails.corporateDocsSummary).trim().slice(0, 500) }
            : {}),
        }
      : undefined;

  const sanitizedFinancialData: IndividualFinancialInput | undefined = input.financialData
    ? {
        activityType: String(input.financialData.activityType || '').trim().slice(0, 120),
        employerOrBusinessName: String(input.financialData.employerOrBusinessName || '').trim().slice(0, 160),
        occupationOrRole: String(input.financialData.occupationOrRole || '').trim().slice(0, 120),
        employmentMonths: Math.max(0, Math.min(1200, Math.round(Number(input.financialData.employmentMonths) || 0))),
        incomeSourceType: input.financialData.incomeSourceType || 'FIJA_RECURRENTE',
        primaryNetIncome: clampOptionalNum(input.financialData.primaryNetIncome),
        additionalIncomeStatus: input.financialData.additionalIncomeStatus || 'EXPLICIT_NONE',
        additionalNetIncome: clampOptionalNum(input.financialData.additionalNetIncome) ?? 0,
        declaredTotalMonthlyIncome: clampOptionalNum(input.financialData.declaredTotalMonthlyIncome),
        incomeCurrency: input.financialData.incomeCurrency === 'USD' ? 'USD' : 'DOP',
        essentialExpenses: clampOptionalNum(input.financialData.essentialExpenses),
        housingPayment: Math.max(0, Math.min(100_000_000, Number(input.financialData.housingPayment) || 0)),
        housingIncludedInExpenses: Boolean(input.financialData.housingIncludedInExpenses),
        debtDeclarationStatus: input.financialData.debtDeclarationStatus || 'NO_DEBTS_EXPLICIT',
        debtCount: clampOptionalNum(input.financialData.debtCount, 100),
        totalDebtBalance: clampOptionalNum(input.financialData.totalDebtBalance),
        currentDebtPayments: clampOptionalNum(input.financialData.currentDebtPayments),
        bankDebtPayment: clampOptionalNum(input.financialData.bankDebtPayment),
        financeDebtPayment: clampOptionalNum(input.financialData.financeDebtPayment),
        cardDebtPayment: clampOptionalNum(input.financialData.cardDebtPayment),
        informalDebtPayment: clampOptionalNum(input.financialData.informalDebtPayment),
        otherDebtPayment: clampOptionalNum(input.financialData.otherDebtPayment),
      }
    : undefined;

  const sanitizedBusinessFinancialData: BusinessFinancialInput | null | undefined =
    applicantType === 'BUSINESS' && input.businessFinancialData
      ? {
          grossSales: clampOptionalNum(input.businessFinancialData.grossSales),
          operatingCosts: clampOptionalNum(input.businessFinancialData.operatingCosts),
          netMonthlyFlow: clampOptionalNum(input.businessFinancialData.netMonthlyFlow),
          businessObligationsMonthly: clampOptionalNum(input.businessFinancialData.businessObligationsMonthly),
          totalBusinessDebtBalance: clampOptionalNum(input.businessFinancialData.totalBusinessDebtBalance),
          businessDebtCount: clampOptionalNum(input.businessFinancialData.businessDebtCount, 100),
          repaymentSource: String(input.businessFinancialData.repaymentSource || '').trim().slice(0, 200),
          operationsMonths: Math.max(
            0,
            Math.min(1200, Math.round(Number(input.businessFinancialData.operationsMonths) || 0))
          ),
          incomeCurrency: input.businessFinancialData.incomeCurrency === 'USD' ? 'USD' : 'DOP',
          debtDeclarationStatus: input.businessFinancialData.debtDeclarationStatus || 'NO_DEBTS_EXPLICIT',
        }
      : undefined;

  const sanitizedReferences: ReferenceItem[] = Array.isArray(input.references)
    ? input.references
        .slice(0, 4)
        .map((r) => ({
          name: String(r.name || '').trim().slice(0, 120),
          relationship: String(r.relationship || '').trim().slice(0, 80),
          phone: String(r.phone || '').trim().slice(0, 40),
        }))
        .filter((r) => r.name.length > 0 || r.phone.length > 0)
    : [];

  const sanitizedBiometric: PublicBiometricSummary | null | undefined = input.biometricSummary
    ? {
        verdict: String(input.biometricSummary.verdict || '').slice(0, 40),
        similarityScore: Math.max(0, Math.min(100, Math.round(Number(input.biometricSummary.similarityScore) || 0))),
        livenessAssessment: String(input.biometricSummary.livenessAssessment || '').slice(0, 40),
        ...(input.biometricSummary.summary
          ? { summary: String(input.biometricSummary.summary).trim().slice(0, 400) }
          : {}),
      }
    : undefined;

  return {
    valid: true,
    errors: [],
    sanitized: {
      applicantType,
      applicantFullName,
      documentType,
      documentNumber,
      phone,
      ...(email ? { email } : {}),
      ...(address ? { address } : {}),
      ...(province ? { province } : {}),
      productCode,
      currency,
      requestedAmount: Math.round(requestedAmount * 100) / 100,
      requestedTermMonths,
      paymentFrequency,
      amortizationMethod,
      loanPurpose,
      ...(loanPurposeDescription ? { loanPurposeDescription } : {}),
      ...(proposedCollateral ? { proposedCollateral } : {}),
      monthlyIncome: Math.round(effectiveMonthlyIncome * 100) / 100,
      monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
      ...(employerOrActivity ? { employerOrActivity } : {}),
      ...(sanitizedCustomerDetails ? { customerDetails: sanitizedCustomerDetails } : {}),
      ...(sanitizedBusinessDetails ? { businessDetails: sanitizedBusinessDetails } : {}),
      ...(sanitizedFinancialData ? { financialData: sanitizedFinancialData } : {}),
      ...(sanitizedBusinessFinancialData ? { businessFinancialData: sanitizedBusinessFinancialData } : {}),
      ...(sanitizedReferences.length > 0 ? { references: sanitizedReferences } : {}),
      ...(input.declaredDocumentsSummary
        ? {
            declaredDocumentsSummary: {
              hasIdentityDoc: Boolean(input.declaredDocumentsSummary.hasIdentityDoc),
              hasIncomeEvidence: Boolean(input.declaredDocumentsSummary.hasIncomeEvidence),
            },
          }
        : {}),
      ...(sanitizedDocs.length > 0 ? { attachedDocuments: sanitizedDocs } : {}),
      ...(sanitizedBiometric ? { biometricSummary: sanitizedBiometric } : {}),
      consentVersion,
      consentAccepted: true,
    },
  };
}

export function buildExternalPortalShareMessage(
  institutionName: string,
  links: InstitutionExternalPortalLinks
): string {
  const cleanName = (institutionName || 'Nuestra Institución').trim();
  return [
    `Portal Oficial de Clientes — ${cleanName}`,
    '',
    `Solicita tu crédito en línea aquí: ${links.creditApplicationUrl}`,
    `Consulta tus préstamos y cuotas (o crea tu cuenta): ${links.registerUrl}`,
    `Acceso general al portal: ${links.portalUrl}`,
  ].join('\n');
}

