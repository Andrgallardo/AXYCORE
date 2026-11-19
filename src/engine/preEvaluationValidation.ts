import type {
  ApplicantType,
  ApplicationDocumentRecord,
  ApplicationRecord,
  BusinessRecord,
  CustomerRecord,
} from '../types/axycore';

export type PreEvaluationIssueGroup =
  | 'CUSTOMER_RECORD'
  | 'CUSTOMER_FIELD'
  | 'BUSINESS_RECORD'
  | 'BUSINESS_FIELD'
  | 'REQUIRED_DOCUMENT'
  | 'APPLICATION_FIELD';

export type PreEvaluationIssueSeverity = 'BLOCKING' | 'WARNING';

export interface PreEvaluationMissingItem {
  id: string;
  group: PreEvaluationIssueGroup;
  severity: PreEvaluationIssueSeverity;
  label: string;
  detail: string;
  fieldKey?: string;
  documentCategory?: string;
  recommendedAction: 'COMPLETE_CUSTOMER' | 'UPLOAD_DOCUMENT' | 'REVIEW_APPLICATION';
}

export interface PreEvaluationValidationResult {
  valid: boolean;
  canProceed: boolean;
  applicationId: string;
  applicationNumber: string;
  applicantDisplayName: string;
  applicantType: ApplicantType;
  customerId: string;
  businessId?: string | null;
  customerExistsInFirestore: boolean;
  businessExistsInFirestore: boolean | null;
  documentsCountInFirestore: number;
  matchedDocumentCategories: string[];
  missingItems: PreEvaluationMissingItem[];
  blockingIssues: PreEvaluationMissingItem[];
  warnings: PreEvaluationMissingItem[];
  summaryMessage: string;
  checkedAtIso: string;
}

export class PreEvaluationValidationError extends Error {
  readonly validation: PreEvaluationValidationResult;

  constructor(validation: PreEvaluationValidationResult) {
    super(validation.summaryMessage);
    this.name = 'PreEvaluationValidationError';
    this.validation = validation;
  }
}

export const IDENTITY_DOCUMENT_CATEGORIES = [
  'CEDULA_IDENTIDAD',
  'IDENTIDAD',
  'CEDULA',
  'PASAPORTE',
  'VERIFICACION_BIOMETRICA',
  'BIOMETRIA',
  'DNI',
  'ID',
] as const;

export const INCOME_DOCUMENT_CATEGORIES = [
  'COMPROBANTE_INGRESOS',
  'INGRESOS',
  'ESTADO_CUENTA',
  'ESTADOS_FINANCIEROS',
  'CARTA_TRABAJO',
  'NOMINA',
  'VOLANTE_PAGO',
] as const;

export const CORPORATE_DOCUMENT_CATEGORIES = [
  'DOCUMENTO_SOCIETARIO',
  'SOCIETARIO',
  'RNC',
  'REGISTRO_MERCANTIL',
  'ACTA_ASAMBLEA',
  'ESTATUTOS',
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_DOC_PATTERN = /^(MIG-|PEND|N\/A$|0+$|SIN[-_ ]?DOC)/i;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCategory(category: unknown): string {
  return normalizeText(category)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function isSyntheticDocumentNumber(value: unknown): boolean {
  const clean = normalizeText(value);
  if (!clean) return false;
  return PLACEHOLDER_DOC_PATTERN.test(clean);
}

export function isSyntheticPhone(value: unknown): boolean {
  const digits = digitsOnly(normalizeText(value));
  if (!digits) return false;
  return digits === '8090000000' || /^0+$/.test(digits);
}

export function hasMatchingDocumentCategory(
  documents: ApplicationDocumentRecord[],
  acceptedCategories: readonly string[]
): ApplicationDocumentRecord[] {
  const accepted = new Set(acceptedCategories.map((c) => normalizeCategory(c)));
  return documents.filter((docItem) => {
    const normalized = normalizeCategory(docItem.category);
    if (!normalized) return false;
    if (accepted.has(normalized)) return true;
    for (const candidate of accepted) {
      if (normalized.includes(candidate) || candidate.includes(normalized)) {
        return true;
      }
    }
    return false;
  });
}

export interface EvaluatePreEvaluationInput {
  application: ApplicationRecord;
  firestoreCustomer: CustomerRecord | null;
  firestoreBusiness?: BusinessRecord | null;
  firestoreDocuments: ApplicationDocumentRecord[];
  checkedAtIso?: string;
}

/**
 * Pure pre-evaluation verification engine.
 * Evaluates live Firestore snapshots for the customer profile, optional business profile,
 * required uploaded documents in `application_documents`, and core application financial inputs.
 */
export function evaluatePreEvaluationRequirements(
  input: EvaluatePreEvaluationInput
): PreEvaluationValidationResult {
  const {
    application,
    firestoreCustomer,
    firestoreBusiness = null,
    firestoreDocuments,
    checkedAtIso = new Date().toISOString(),
  } = input;

  const appDocs = firestoreDocuments.filter((d) => d.applicationId === application.id);
  const missingItems: PreEvaluationMissingItem[] = [];

  const customerExistsInFirestore = Boolean(firestoreCustomer && normalizeText(firestoreCustomer.id));
  const isBusiness = application.applicantType === 'BUSINESS';
  const businessExistsInFirestore = isBusiness
    ? Boolean(firestoreBusiness && normalizeText(firestoreBusiness.id))
    : null;

  // 1. Verify Customer Profile document existence & required fields in Firestore
  if (!normalizeText(application.customerId) || !customerExistsInFirestore || !firestoreCustomer) {
    missingItems.push({
      id: 'customer_missing_firestore',
      group: 'CUSTOMER_RECORD',
      severity: 'BLOCKING',
      label: 'Perfil del cliente no existe en Firestore',
      detail: normalizeText(application.customerId)
        ? `No se encontró el documento del cliente (ID: ${application.customerId}) en la colección de clientes de Firestore. Regístrelo o sincronícelo antes de enviar a Evaluación.`
        : 'La solicitud no tiene un identificador de cliente válido vinculado.',
      fieldKey: 'customerId',
      recommendedAction: 'COMPLETE_CUSTOMER',
    });
  } else {
    const docType = normalizeText(firestoreCustomer.documentType).toUpperCase();
    if (docType !== 'CEDULA' && docType !== 'PASAPORTE') {
      missingItems.push({
        id: 'customer_document_type',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Tipo de documento de identidad',
        detail: 'El perfil del cliente en Firestore debe indicar tipo de documento (CEDULA o PASAPORTE).',
        fieldKey: 'documentType',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const docNum = normalizeText(firestoreCustomer.documentNumber);
    if (docNum.length < 5 || isSyntheticDocumentNumber(docNum)) {
      missingItems.push({
        id: 'customer_document_number',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Cédula / Número de documento',
        detail: isSyntheticDocumentNumber(docNum)
          ? `El número de documento registrado ("${docNum}") es un marcador temporal de migración. Actualícelo con la cédula o pasaporte real del cliente.`
          : 'Falta registrar el número de cédula o pasaporte válido en el perfil del cliente en Firestore.',
        fieldKey: 'documentNumber',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const firstName = normalizeText(firestoreCustomer.firstName);
    if (firstName.length < 2) {
      missingItems.push({
        id: 'customer_first_name',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Nombre del cliente',
        detail: 'El campo de nombre está vacío o incompleto en el perfil del cliente en Firestore.',
        fieldKey: 'firstName',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const lastName = normalizeText(firestoreCustomer.lastName);
    if (lastName.length < 2) {
      missingItems.push({
        id: 'customer_last_name',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Apellido del cliente',
        detail: 'El campo de apellido está vacío o incompleto en el perfil del cliente en Firestore.',
        fieldKey: 'lastName',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const phone = normalizeText(firestoreCustomer.phone);
    const phoneDigits = digitsOnly(phone);
    if (phoneDigits.length < 7 || isSyntheticPhone(phone)) {
      missingItems.push({
        id: 'customer_phone',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Teléfono de contacto',
        detail: isSyntheticPhone(phone)
          ? `El teléfono registrado ("${phone}") es un valor genérico de respaldo. Ingrese el número de contacto real del cliente.`
          : 'Falta registrar un número de teléfono válido (mínimo 7 dígitos) en el perfil del cliente.',
        fieldKey: 'phone',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const email = normalizeText(firestoreCustomer.email);
    if (!email || !EMAIL_PATTERN.test(email)) {
      missingItems.push({
        id: 'customer_email',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Correo electrónico del cliente',
        detail: email
          ? `El correo electrónico "${email}" no tiene un formato válido.`
          : 'Falta el correo electrónico en el perfil del cliente en Firestore (requerido para notificaciones y KYC).',
        fieldKey: 'email',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    const address = normalizeText(firestoreCustomer.address);
    if (address.length < 5) {
      missingItems.push({
        id: 'customer_address',
        group: 'CUSTOMER_FIELD',
        severity: 'BLOCKING',
        label: 'Dirección residencial',
        detail: 'Falta completar la dirección residencial del cliente en su perfil de Firestore.',
        fieldKey: 'address',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    // Non-blocking profile completeness warnings
    if (!normalizeText(firestoreCustomer.birthDate)) {
      missingItems.push({
        id: 'customer_birth_date_warn',
        group: 'CUSTOMER_FIELD',
        severity: 'WARNING',
        label: 'Fecha de nacimiento',
        detail: 'Recomendado completar la fecha de nacimiento en el perfil del cliente antes de formalización.',
        fieldKey: 'birthDate',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }

    if (!normalizeText(firestoreCustomer.province) && !normalizeText(firestoreCustomer.municipality)) {
      missingItems.push({
        id: 'customer_location_warn',
        group: 'CUSTOMER_FIELD',
        severity: 'WARNING',
        label: 'Provincia / Municipio',
        detail: 'No se registró provincia ni municipio en la ficha del cliente.',
        fieldKey: 'province',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    }
  }

  // 2. Verify Business Profile when applicantType === 'BUSINESS'
  if (isBusiness) {
    if (!normalizeText(application.businessId) || !businessExistsInFirestore || !firestoreBusiness) {
      missingItems.push({
        id: 'business_missing_firestore',
        group: 'BUSINESS_RECORD',
        severity: 'BLOCKING',
        label: 'Perfil de empresa no existe en Firestore',
        detail: normalizeText(application.businessId)
          ? `No se encontró el documento empresarial (ID: ${application.businessId}) en Firestore.`
          : 'La solicitud es de tipo empresarial pero no tiene una empresa vinculada.',
        fieldKey: 'businessId',
        recommendedAction: 'COMPLETE_CUSTOMER',
      });
    } else {
      if (normalizeText(firestoreBusiness.rnc).length < 5) {
        missingItems.push({
          id: 'business_rnc',
          group: 'BUSINESS_FIELD',
          severity: 'BLOCKING',
          label: 'RNC de la empresa',
          detail: 'Falta el RNC válido en el perfil empresarial de Firestore.',
          fieldKey: 'rnc',
          recommendedAction: 'COMPLETE_CUSTOMER',
        });
      }
      if (normalizeText(firestoreBusiness.legalName).length < 2) {
        missingItems.push({
          id: 'business_legal_name',
          group: 'BUSINESS_FIELD',
          severity: 'BLOCKING',
          label: 'Razón social de la empresa',
          detail: 'Falta la razón social en el perfil empresarial de Firestore.',
          fieldKey: 'legalName',
          recommendedAction: 'COMPLETE_CUSTOMER',
        });
      }
      if (normalizeText(firestoreBusiness.authorizedRepName).length < 2) {
        missingItems.push({
          id: 'business_rep_name',
          group: 'BUSINESS_FIELD',
          severity: 'BLOCKING',
          label: 'Representante autorizado',
          detail: 'Falta el nombre del representante autorizado en el perfil empresarial.',
          fieldKey: 'authorizedRepName',
          recommendedAction: 'COMPLETE_CUSTOMER',
        });
      }
    }
  }

  // 3. Verify Required Documents in Firestore (application_documents)
  const matchedCategories: string[] = [];

  const identityDocs = hasMatchingDocumentCategory(appDocs, IDENTITY_DOCUMENT_CATEGORIES);
  if (identityDocs.length === 0) {
    const declaredNote = application.declaredDocumentsSummary?.hasIdentityDoc
      ? ' Aunque fue marcado como declarado en el formulario, no existe archivo cargado en Firestore.'
      : '';
    missingItems.push({
      id: 'doc_identity_missing',
      group: 'REQUIRED_DOCUMENT',
      severity: 'BLOCKING',
      label: 'Documento de Identidad (Cédula / Pasaporte)',
      detail: `No se encontró soporte de identidad en Firestore para el expediente ${application.applicationNumber}.${declaredNote}`,
      documentCategory: 'CEDULA_IDENTIDAD',
      recommendedAction: 'UPLOAD_DOCUMENT',
    });
  } else {
    matchedCategories.push('CEDULA_IDENTIDAD');
    if (identityDocs.every((d) => d.reviewStatus === 'OBSERVADO')) {
      missingItems.push({
        id: 'doc_identity_observed',
        group: 'REQUIRED_DOCUMENT',
        severity: 'WARNING',
        label: 'Documento de Identidad con observaciones',
        detail: 'El documento de identidad cargado figura en estado OBSERVADO; verifique si requiere reemplazo.',
        documentCategory: 'CEDULA_IDENTIDAD',
        recommendedAction: 'UPLOAD_DOCUMENT',
      });
    }
  }

  const incomeDocs = hasMatchingDocumentCategory(appDocs, INCOME_DOCUMENT_CATEGORIES);
  if (incomeDocs.length === 0) {
    const declaredNote = application.declaredDocumentsSummary?.hasIncomeEvidence
      ? ' Aunque fue marcado como declarado en el formulario, no existe archivo cargado en Firestore.'
      : '';
    missingItems.push({
      id: 'doc_income_missing',
      group: 'REQUIRED_DOCUMENT',
      severity: 'BLOCKING',
      label: 'Comprobante de Ingresos / Estado de Cuenta',
      detail: `No se encontró evidencia documental de ingresos en Firestore para el expediente ${application.applicationNumber}.${declaredNote}`,
      documentCategory: 'COMPROBANTE_INGRESOS',
      recommendedAction: 'UPLOAD_DOCUMENT',
    });
  } else {
    matchedCategories.push('COMPROBANTE_INGRESOS');
    if (incomeDocs.every((d) => d.reviewStatus === 'OBSERVADO')) {
      missingItems.push({
        id: 'doc_income_observed',
        group: 'REQUIRED_DOCUMENT',
        severity: 'WARNING',
        label: 'Comprobante de Ingresos con observaciones',
        detail: 'El soporte de ingresos cargado está marcado como OBSERVADO.',
        documentCategory: 'COMPROBANTE_INGRESOS',
        recommendedAction: 'UPLOAD_DOCUMENT',
      });
    }
  }

  if (isBusiness) {
    const corporateDocs = hasMatchingDocumentCategory(appDocs, CORPORATE_DOCUMENT_CATEGORIES);
    if (corporateDocs.length === 0) {
      const declaredNote = application.declaredDocumentsSummary?.hasCorporateDocs
        ? ' Aunque fue marcado como declarado en el formulario, no existe archivo cargado en Firestore.'
        : '';
      missingItems.push({
        id: 'doc_corporate_missing',
        group: 'REQUIRED_DOCUMENT',
        severity: 'BLOCKING',
        label: 'Documentación Societaria / RNC',
        detail: `Las solicitudes empresariales requieren documentación societaria o registro mercantil cargado en Firestore.${declaredNote}`,
        documentCategory: 'DOCUMENTO_SOCIETARIO',
        recommendedAction: 'UPLOAD_DOCUMENT',
      });
    } else {
      matchedCategories.push('DOCUMENTO_SOCIETARIO');
      if (corporateDocs.every((d) => d.reviewStatus === 'OBSERVADO')) {
        missingItems.push({
          id: 'doc_corporate_observed',
          group: 'REQUIRED_DOCUMENT',
          severity: 'WARNING',
          label: 'Documentación Societaria con observaciones',
          detail: 'La documentación societaria cargada figura en estado OBSERVADO.',
          documentCategory: 'DOCUMENTO_SOCIETARIO',
          recommendedAction: 'UPLOAD_DOCUMENT',
        });
      }
    }
  }

  // 4. Verify Application core credit parameters
  if (!Number.isFinite(application.requestedAmount) || application.requestedAmount <= 0) {
    missingItems.push({
      id: 'app_requested_amount',
      group: 'APPLICATION_FIELD',
      severity: 'BLOCKING',
      label: 'Monto solicitado válido',
      detail: 'La solicitud debe tener un monto solicitado mayor a cero.',
      fieldKey: 'requestedAmount',
      recommendedAction: 'REVIEW_APPLICATION',
    });
  }

  if (!Number.isFinite(application.requestedTermMonths) || application.requestedTermMonths <= 0) {
    missingItems.push({
      id: 'app_requested_term',
      group: 'APPLICATION_FIELD',
      severity: 'BLOCKING',
      label: 'Plazo solicitado válido',
      detail: 'La solicitud debe indicar un plazo mayor a 0 meses.',
      fieldKey: 'requestedTermMonths',
      recommendedAction: 'REVIEW_APPLICATION',
    });
  }

  const individualIncome = Math.max(
    Number(application.financialData?.primaryNetIncome ?? 0),
    Number(application.financialData?.declaredTotalMonthlyIncome ?? 0)
  );
  const businessIncome = Math.max(
    Number(application.businessFinancialData?.netMonthlyFlow ?? 0),
    Number(application.businessFinancialData?.grossSales ?? 0)
  );
  const hasValidIncome = isBusiness
    ? businessIncome > 0 || individualIncome > 0
    : individualIncome > 0;

  if (!hasValidIncome) {
    missingItems.push({
      id: 'app_declared_income',
      group: 'APPLICATION_FIELD',
      severity: 'BLOCKING',
      label: 'Ingresos mensuales declarados',
      detail: 'La solicitud no registra ingresos mensuales mayores a cero para sustentar la evaluación crediticia.',
      fieldKey: 'primaryNetIncome',
      recommendedAction: 'REVIEW_APPLICATION',
    });
  }

  const blockingIssues = missingItems.filter((item) => item.severity === 'BLOCKING');
  const warnings = missingItems.filter((item) => item.severity === 'WARNING');
  const canProceed = blockingIssues.length === 0;

  const summaryMessage = canProceed
    ? warnings.length > 0
      ? `Validación previa completada para ${application.applicationNumber}: todos los requisitos obligatorios existen en Firestore (${warnings.length} advertencia(s) informativa(s)).`
      : `Validación previa completada para ${application.applicationNumber}: perfil del cliente y documentos obligatorios verificados en Firestore.`
    : `No se puede enviar ${application.applicationNumber} a Evaluación: faltan ${blockingIssues.length} requisito(s) obligatorio(s) en Firestore (${blockingIssues
        .map((b) => b.label)
        .join(', ')}).`;

  return {
    valid: canProceed && warnings.length === 0,
    canProceed,
    applicationId: application.id,
    applicationNumber: application.applicationNumber,
    applicantDisplayName: application.applicantDisplayName,
    applicantType: application.applicantType,
    customerId: application.customerId,
    businessId: application.businessId ?? null,
    customerExistsInFirestore,
    businessExistsInFirestore,
    documentsCountInFirestore: appDocs.length,
    matchedDocumentCategories: matchedCategories,
    missingItems,
    blockingIssues,
    warnings,
    summaryMessage,
    checkedAtIso,
  };
}
