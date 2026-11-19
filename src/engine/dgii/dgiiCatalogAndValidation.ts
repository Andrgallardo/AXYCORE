import {
  ALL_ECF_TYPES,
  ECF_TYPE_META,
  type AccountingAccountMapping,
  type AccountingAccountRecord,
  type DgiiEncfSequenceRecord,
  type DgiiEnvironment,
  type DgiiEnvironmentEndpoints,
  type DgiiFiscalConfigRecord,
  type EcfLineItem,
  type EcfTypeCode,
  type OtherTaxCode,
} from '../../types/dgiiEcf';
import type { OrganizationRecord } from '../../types/axycore';

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function cleanDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Validates Dominican RNC (9 digits) using official DGII Mod-11 check digit weights [7,9,8,6,5,4,3,2].
 * Also supports 11-digit Cédula when used as taxpayer ID if explicitly checked via validateDominicanCedula.
 */
export function validateDominicanRnc(raw: string): { valid: boolean; normalized: string; reason?: string } {
  const digits = cleanDigits(raw);
  if (digits.length !== 9) {
    return { valid: false, normalized: digits, reason: 'El RNC debe contener exactamente 9 dígitos.' };
  }
  if (/^(\d)\1{8}$/.test(digits)) {
    return { valid: false, normalized: digits, reason: 'RNC inválido (dígitos repetidos).' };
  }
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }
  const remainder = sum % 11;
  const expectedDigit = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  if (Number(digits[8]) !== expectedDigit) {
    return {
      valid: false,
      normalized: digits,
      reason: `Dígito verificador de RNC inválido (esperado ${expectedDigit}).`,
    };
  }
  return { valid: true, normalized: digits };
}

/**
 * Validates Dominican Cédula (11 digits) using JCE Mod-10 Luhn check digit.
 */
export function validateDominicanCedula(raw: string): { valid: boolean; normalized: string; reason?: string } {
  const digits = cleanDigits(raw);
  if (digits.length !== 11) {
    return { valid: false, normalized: digits, reason: 'La cédula debe contener exactamente 11 dígitos.' };
  }
  if (/^(\d)\1{10}$/.test(digits)) {
    return { valid: false, normalized: digits, reason: 'Cédula inválida (dígitos repetidos).' };
  }
  const weights = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const prod = Number(digits[i]) * weights[i];
    sum += prod >= 10 ? Math.floor(prod / 10) + (prod % 10) : prod;
  }
  const expectedDigit = (10 - (sum % 10)) % 10;
  if (Number(digits[10]) !== expectedDigit) {
    return {
      valid: false,
      normalized: digits,
      reason: `Dígito verificador de Cédula inválido (esperado ${expectedDigit}).`,
    };
  }
  return { valid: true, normalized: digits };
}

export function validateTaxIdByType(
  idType: 'RNC' | 'CEDULA' | 'PASAPORTE' | 'SIN_ID',
  raw: string
): { valid: boolean; normalized: string; reason?: string } {
  if (idType === 'SIN_ID') {
    return { valid: true, normalized: '' };
  }
  if (idType === 'RNC') {
    return validateDominicanRnc(raw);
  }
  if (idType === 'CEDULA') {
    return validateDominicanCedula(raw);
  }
  const clean = String(raw || '').trim().toUpperCase();
  if (clean.length < 5 || clean.length > 20) {
    return { valid: false, normalized: clean, reason: 'Pasaporte debe tener entre 5 y 20 caracteres.' };
  }
  return { valid: true, normalized: clean };
}

export function formatEncf(ecfType: EcfTypeCode, sequenceNumber: number): string {
  const padded = String(Math.max(0, Math.floor(sequenceNumber))).padStart(10, '0');
  return `E${ecfType}${padded}`;
}

export function isValidEncfFormat(encf: string, expectedType?: EcfTypeCode): boolean {
  const clean = String(encf || '').trim().toUpperCase();
  if (!/^E(31|32|33|34|41|43|44|45|46|47)\d{10}$/.test(clean)) {
    return false;
  }
  if (expectedType && clean.slice(1, 3) !== expectedType) {
    return false;
  }
  return true;
}

export const OFFICIAL_DGII_ENV_ENDPOINTS: Record<DgiiEnvironment, DgiiEnvironmentEndpoints> = {
  DESARROLLO: {
    authSeedUrl: 'https://ecf.dgii.gov.do/testeCF/Autenticacion/api/Autenticacion/Semilla',
    authValidateUrl: 'https://ecf.dgii.gov.do/testeCF/Autenticacion/api/Autenticacion/ValidarSemilla',
    receptionUrl: 'https://ecf.dgii.gov.do/testeCF/Recepcion/api/FacturasElectronicas',
    receptionFcUrl: 'https://fc.dgii.gov.do/testeCF/recepcionfc/api/recepcion/ecf',
    trackResultUrl: 'https://ecf.dgii.gov.do/testeCF/ConsultaResultado/api/Consultas/Estado',
    trackListUrl: 'https://ecf.dgii.gov.do/testeCF/ConsultaTrackIds/api/TrackIds/ConsultaTrackIds',
    commercialApprovalUrl: 'https://ecf.dgii.gov.do/testeCF/AprobacionComercial/api/AprobacionComercial',
    voidRangeUrl: 'https://ecf.dgii.gov.do/testeCF/Anulacion/api/Operaciones/AnularRango',
    directoryUrl: 'https://ecf.dgii.gov.do/testeCF/Consultas/api/Consultas/ObtenerDirectorio',
    serviceStatusUrl: 'https://statusecf.dgii.gov.do/api/EstatusServicios/ObtenerEstatus',
  },
  PRECERTIFICACION: {
    authSeedUrl: 'https://ecf.dgii.gov.do/testeCF/Autenticacion/api/Autenticacion/Semilla',
    authValidateUrl: 'https://ecf.dgii.gov.do/testeCF/Autenticacion/api/Autenticacion/ValidarSemilla',
    receptionUrl: 'https://ecf.dgii.gov.do/testeCF/Recepcion/api/FacturasElectronicas',
    receptionFcUrl: 'https://fc.dgii.gov.do/testeCF/recepcionfc/api/recepcion/ecf',
    trackResultUrl: 'https://ecf.dgii.gov.do/testeCF/ConsultaResultado/api/Consultas/Estado',
    trackListUrl: 'https://ecf.dgii.gov.do/testeCF/ConsultaTrackIds/api/TrackIds/ConsultaTrackIds',
    commercialApprovalUrl: 'https://ecf.dgii.gov.do/testeCF/AprobacionComercial/api/AprobacionComercial',
    voidRangeUrl: 'https://ecf.dgii.gov.do/testeCF/Anulacion/api/Operaciones/AnularRango',
    directoryUrl: 'https://ecf.dgii.gov.do/testeCF/Consultas/api/Consultas/ObtenerDirectorio',
    serviceStatusUrl: 'https://statusecf.dgii.gov.do/api/EstatusServicios/ObtenerEstatus',
  },
  CERTIFICACION: {
    authSeedUrl: 'https://ecf.dgii.gov.do/certeCF/Autenticacion/api/Autenticacion/Semilla',
    authValidateUrl: 'https://ecf.dgii.gov.do/certeCF/Autenticacion/api/Autenticacion/ValidarSemilla',
    receptionUrl: 'https://ecf.dgii.gov.do/certeCF/Recepcion/api/FacturasElectronicas',
    receptionFcUrl: 'https://fc.dgii.gov.do/certeCF/recepcionfc/api/recepcion/ecf',
    trackResultUrl: 'https://ecf.dgii.gov.do/certeCF/ConsultaResultado/api/Consultas/Estado',
    trackListUrl: 'https://ecf.dgii.gov.do/certeCF/ConsultaTrackIds/api/TrackIds/ConsultaTrackIds',
    commercialApprovalUrl: 'https://ecf.dgii.gov.do/certeCF/AprobacionComercial/api/AprobacionComercial',
    voidRangeUrl: 'https://ecf.dgii.gov.do/certeCF/Anulacion/api/Operaciones/AnularRango',
    directoryUrl: 'https://ecf.dgii.gov.do/certeCF/Consultas/api/Consultas/ObtenerDirectorio',
    serviceStatusUrl: 'https://statusecf.dgii.gov.do/api/EstatusServicios/ObtenerEstatus',
  },
  PRODUCCION: {
    authSeedUrl: 'https://ecf.dgii.gov.do/eCF/Autenticacion/api/Autenticacion/Semilla',
    authValidateUrl: 'https://ecf.dgii.gov.do/eCF/Autenticacion/api/Autenticacion/ValidarSemilla',
    receptionUrl: 'https://ecf.dgii.gov.do/eCF/Recepcion/api/FacturasElectronicas',
    receptionFcUrl: 'https://fc.dgii.gov.do/eCF/recepcionfc/api/recepcion/ecf',
    trackResultUrl: 'https://ecf.dgii.gov.do/eCF/ConsultaResultado/api/Consultas/Estado',
    trackListUrl: 'https://ecf.dgii.gov.do/eCF/ConsultaTrackIds/api/TrackIds/ConsultaTrackIds',
    commercialApprovalUrl: 'https://ecf.dgii.gov.do/eCF/AprobacionComercial/api/AprobacionComercial',
    voidRangeUrl: 'https://ecf.dgii.gov.do/eCF/Anulacion/api/Operaciones/AnularRango',
    directoryUrl: 'https://ecf.dgii.gov.do/eCF/Consultas/api/Consultas/ObtenerDirectorio',
    serviceStatusUrl: 'https://statusecf.dgii.gov.do/api/EstatusServicios/ObtenerEstatus',
  },
};

export const DEFAULT_ACCOUNTING_MAPPING: AccountingAccountMapping = {
  receivablesAccountCode: '1103',
  cashOrBankAccountCode: '1102',
  salesRevenueAccountCode: '4101',
  interestRevenueAccountCode: '4102',
  itbisPayableAccountCode: '2103',
  itbisCreditableAccountCode: '1104',
  otherTaxesPayableAccountCode: '2104',
  payablesAccountCode: '2101',
  purchasesExpenseAccountCode: '5101',
  creditNoteReturnsAccountCode: '4109',
  minorExpensesAccountCode: '5105',
  withholdingTaxPayableCode: '2105',
};

export const DEFAULT_CHART_OF_ACCOUNTS_TEMPLATE: Array<
  Omit<AccountingAccountRecord, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt'>
> = [
  { code: '1000', name: 'ACTIVOS', accountType: 'ACTIVO', normalBalance: 'DEBITO', isPostable: false, status: 'ACTIVA' },
  { code: '1101', name: 'Caja General y Caja Chica', accountType: 'ACTIVO', normalBalance: 'DEBITO', parentCode: '1000', isPostable: true, systemTag: 'CAJA_GENERAL', status: 'ACTIVA' },
  { code: '1102', name: 'Bancos y Cuentas Corrientes', accountType: 'ACTIVO', normalBalance: 'DEBITO', parentCode: '1000', isPostable: true, systemTag: 'BANCOS', status: 'ACTIVA' },
  { code: '1103', name: 'Cuentas por Cobrar Facturación y Clientes', accountType: 'ACTIVO', normalBalance: 'DEBITO', parentCode: '1000', isPostable: true, systemTag: 'CXC_CLIENTES', status: 'ACTIVA' },
  { code: '1104', name: 'ITBIS Adelantado / Crédito Fiscal por Compensar', accountType: 'ACTIVO', normalBalance: 'DEBITO', parentCode: '1000', isPostable: true, systemTag: 'ITBIS_ADELANTADO', status: 'ACTIVA' },
  { code: '1201', name: 'Cartera de Préstamos por Cobrar', accountType: 'ACTIVO', normalBalance: 'DEBITO', parentCode: '1000', isPostable: true, systemTag: 'CARTERA_PRESTAMOS', status: 'ACTIVA' },

  { code: '2000', name: 'PASIVOS', accountType: 'PASIVO', normalBalance: 'CREDITO', isPostable: false, status: 'ACTIVA' },
  { code: '2101', name: 'Cuentas por Pagar Proveedores', accountType: 'PASIVO', normalBalance: 'CREDITO', parentCode: '2000', isPostable: true, systemTag: 'CXP_PROVEEDORES', status: 'ACTIVA' },
  { code: '2102', name: 'Capital de Inversionistas por Pagar', accountType: 'PASIVO', normalBalance: 'CREDITO', parentCode: '2000', isPostable: true, status: 'ACTIVA' },
  { code: '2103', name: 'ITBIS por Pagar (DGII)', accountType: 'PASIVO', normalBalance: 'CREDITO', parentCode: '2000', isPostable: true, systemTag: 'ITBIS_POR_PAGAR', status: 'ACTIVA' },
  { code: '2104', name: 'Otros Impuestos y Propina Legal por Pagar', accountType: 'PASIVO', normalBalance: 'CREDITO', parentCode: '2000', isPostable: true, systemTag: 'OTROS_IMPUESTOS_PAGAR', status: 'ACTIVA' },
  { code: '2105', name: 'Retenciones ISR / Pagos al Exterior por Pagar', accountType: 'PASIVO', normalBalance: 'CREDITO', parentCode: '2000', isPostable: true, systemTag: 'RETENCIONES_PAGAR', status: 'ACTIVA' },

  { code: '3000', name: 'PATRIMONIO', accountType: 'PATRIMONIO', normalBalance: 'CREDITO', isPostable: false, status: 'ACTIVA' },
  { code: '3101', name: 'Capital Social Autorizado y Pagado', accountType: 'PATRIMONIO', normalBalance: 'CREDITO', parentCode: '3000', isPostable: true, status: 'ACTIVA' },
  { code: '3201', name: 'Resultados Acumulados del Ejercicio', accountType: 'PATRIMONIO', normalBalance: 'CREDITO', parentCode: '3000', isPostable: true, status: 'ACTIVA' },

  { code: '4000', name: 'INGRESOS', accountType: 'INGRESO', normalBalance: 'CREDITO', isPostable: false, status: 'ACTIVA' },
  { code: '4101', name: 'Ingresos por Servicios y Ventas Facturadas', accountType: 'INGRESO', normalBalance: 'CREDITO', parentCode: '4000', isPostable: true, systemTag: 'INGRESOS_VENTAS', status: 'ACTIVA' },
  { code: '4102', name: 'Ingresos por Intereses, Mora y Comisiones', accountType: 'INGRESO', normalBalance: 'CREDITO', parentCode: '4000', isPostable: true, systemTag: 'INGRESOS_INTERESES', status: 'ACTIVA' },
  { code: '4109', name: 'Devoluciones y Notas de Crédito sobre Ventas', accountType: 'INGRESO', normalBalance: 'DEBITO', parentCode: '4000', isPostable: true, systemTag: 'DEVOLUCIONES_VENTAS', status: 'ACTIVA' },

  { code: '5000', name: 'COSTOS Y GASTOS', accountType: 'GASTO', normalBalance: 'DEBITO', isPostable: false, status: 'ACTIVA' },
  { code: '5101', name: 'Compras de Bienes y Servicios Deducibles', accountType: 'COSTO', normalBalance: 'DEBITO', parentCode: '5000', isPostable: true, systemTag: 'COMPRAS_COSTOS', status: 'ACTIVA' },
  { code: '5102', name: 'Gastos de Nómina y Personal', accountType: 'GASTO', normalBalance: 'DEBITO', parentCode: '5000', isPostable: true, status: 'ACTIVA' },
  { code: '5103', name: 'Servicios Profesionales y Tecnología', accountType: 'GASTO', normalBalance: 'DEBITO', parentCode: '5000', isPostable: true, status: 'ACTIVA' },
  { code: '5105', name: 'Gastos Menores sin Comprobante Suplidor', accountType: 'GASTO', normalBalance: 'DEBITO', parentCode: '5000', isPostable: true, systemTag: 'GASTOS_MENORES', status: 'ACTIVA' },
  { code: '5109', name: 'Gastos Financieros y Rendimientos', accountType: 'GASTO', normalBalance: 'DEBITO', parentCode: '5000', isPostable: true, status: 'ACTIVA' },
];

export function buildDefaultDgiiFiscalConfig(
  organization: OrganizationRecord,
  updatedBy = 'system'
): DgiiFiscalConfigRecord {
  const normalizedRnc = cleanDigits(organization.rnc || organization.taxId || '');
  return {
    id: organization.id,
    organizationId: organization.id,
    rnc: normalizedRnc,
    legalName: organization.legalName || organization.name,
    tradeName: organization.tradeName || organization.name,
    fiscalAddress: organization.address || '',
    municipality: organization.city || 'Santo Domingo',
    province: organization.province || 'Santo Domingo',
    phone: organization.phone || '',
    email: organization.corporateEmail || '',
    economicActivity: 'Servicios Financieros y Administrativos',
    taxpayerType: 'PERSONA_JURIDICA',
    defaultCurrency: organization.currency || 'DOP',
    environment: 'DESARROLLO',
    isCertifiedByDgii: false,
    certificationStageNotes:
      'Pendiente de certificación formal ante la DGII. Solo operaciones en ambiente de desarrollo/pruebas internas.',
    enabledEcfTypes: ['31', '32', '33', '34', '41', '43', '44', '45'],
    endpointsByEnv: {
      DESARROLLO: { ...OFFICIAL_DGII_ENV_ENDPOINTS.DESARROLLO },
      PRECERTIFICACION: { ...OFFICIAL_DGII_ENV_ENDPOINTS.PRECERTIFICACION },
      CERTIFICACION: { ...OFFICIAL_DGII_ENV_ENDPOINTS.CERTIFICACION },
      PRODUCCION: { ...OFFICIAL_DGII_ENV_ENDPOINTS.PRODUCCION },
    },
    timeoutMs: 15000,
    maxRetries: 2,
    autoPostAccounting: true,
    accountMapping: { ...DEFAULT_ACCOUNTING_MAPPING },
    updatedBy,
  };
}

export interface DraftLineInput {
  lineNumber?: number;
  productId?: string;
  sku?: string;
  description: string;
  itemType: 'BIEN' | 'SERVICIO';
  quantity: number;
  unitOfMeasure?: string;
  unitPrice: number;
  discountAmount?: number;
  itbisRate: 18 | 16 | 0;
  isExempt?: boolean;
  otherTaxCode?: OtherTaxCode;
  otherTaxRatePct?: number;
  accountCode?: string;
}

export function computeEcfLineItemsAndTotals(
  rawItems: DraftLineInput[],
  ecfType: EcfTypeCode
): {
  items: EcfLineItem[];
  subtotal: number;
  totalDiscount: number;
  exemptAmount: number;
  taxableAmount18: number;
  taxableAmount16: number;
  totalItbis: number;
  otherTaxesTotal: number;
  totalAmount: number;
} {
  const meta = ECF_TYPE_META[ecfType];
  const forceNoItbis = !meta.allowsItbis;

  let subtotal = 0;
  let totalDiscount = 0;
  let exemptAmount = 0;
  let taxableAmount18 = 0;
  let taxableAmount16 = 0;
  let totalItbis = 0;
  let otherTaxesTotal = 0;

  const items: EcfLineItem[] = rawItems.map((raw, idx) => {
    const qty = Math.max(0, Number(raw.quantity) || 0);
    const unitPrice = Math.max(0, Number(raw.unitPrice) || 0);
    const gross = round2(qty * unitPrice);
    const discountAmount = round2(Math.min(gross, Math.max(0, Number(raw.discountAmount) || 0)));
    const lineSubtotal = round2(gross - discountAmount);

    const isExempt = forceNoItbis || Boolean(raw.isExempt) || raw.itbisRate === 0;
    const effectiveRate: 18 | 16 | 0 = isExempt ? 0 : raw.itbisRate === 16 ? 16 : 18;
    const itbisAmount = isExempt ? 0 : round2((lineSubtotal * effectiveRate) / 100);

    const otherTaxCode: OtherTaxCode = raw.otherTaxCode || 'NINGUNO';
    const otherTaxRatePct =
      otherTaxCode === 'NINGUNO' ? 0 : Math.max(0, Number(raw.otherTaxRatePct) || 0);
    const otherTaxAmount =
      otherTaxCode === 'NINGUNO'
        ? 0
        : otherTaxCode === 'ISC_ESPECIFICO'
        ? round2(otherTaxRatePct * qty)
        : round2((lineSubtotal * otherTaxRatePct) / 100);

    const lineTotal = round2(lineSubtotal + itbisAmount + otherTaxAmount);

    subtotal = round2(subtotal + gross);
    totalDiscount = round2(totalDiscount + discountAmount);
    if (isExempt) {
      exemptAmount = round2(exemptAmount + lineSubtotal);
    } else if (effectiveRate === 18) {
      taxableAmount18 = round2(taxableAmount18 + lineSubtotal);
    } else if (effectiveRate === 16) {
      taxableAmount16 = round2(taxableAmount16 + lineSubtotal);
    }
    totalItbis = round2(totalItbis + itbisAmount);
    otherTaxesTotal = round2(otherTaxesTotal + otherTaxAmount);

    return {
      lineNumber: raw.lineNumber ?? idx + 1,
      productId: raw.productId,
      sku: raw.sku,
      description: String(raw.description || '').trim(),
      itemType: raw.itemType || 'SERVICIO',
      quantity: qty,
      unitOfMeasure: raw.unitOfMeasure || 'UND',
      unitPrice: round2(unitPrice),
      discountAmount,
      itbisRate: effectiveRate,
      isExempt,
      itbisAmount,
      otherTaxCode,
      otherTaxRatePct,
      otherTaxAmount,
      lineSubtotal,
      lineTotal,
      accountCode: raw.accountCode,
    };
  });

  const totalAmount = round2(subtotal - totalDiscount + totalItbis + otherTaxesTotal);

  return {
    items,
    subtotal,
    totalDiscount,
    exemptAmount,
    taxableAmount18,
    taxableAmount16,
    totalItbis,
    otherTaxesTotal,
    totalAmount,
  };
}

export interface EcfPreIssuanceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  availableSequenceRange?: DgiiEncfSequenceRecord;
  nextSequenceNumber?: number;
  projectedEncf?: string;
}

export function validateEcfBeforeIssuance(params: {
  config: DgiiFiscalConfigRecord;
  ecfType: EcfTypeCode;
  issueDate: string;
  receiverIdType: 'RNC' | 'CEDULA' | 'PASAPORTE' | 'SIN_ID';
  receiverTaxId: string;
  receiverName: string;
  items: EcfLineItem[];
  totalAmount: number;
  currency: string;
  referenceEcf?: string;
  referenceDate?: string;
  modificationCode?: string;
  sequences: DgiiEncfSequenceRecord[];
  isDraftOnly?: boolean;
}): EcfPreIssuanceValidationResult {
  const {
    config,
    ecfType,
    issueDate,
    receiverIdType,
    receiverTaxId,
    receiverName,
    items,
    totalAmount,
    referenceEcf,
    referenceDate,
    modificationCode,
    sequences,
    isDraftOnly = false,
  } = params;

  const errors: string[] = [];
  const warnings: string[] = [];
  const meta = ECF_TYPE_META[ecfType];

  // 1. Tenant Entitlement Check
  if (!config.enabledEcfTypes.includes(ecfType)) {
    errors.push(
      `La empresa no tiene habilitado el tipo de comprobante e-CF ${ecfType} (${meta.name}) en su configuración fiscal.`
    );
  }

  // 2. Issuer RNC & Fiscal Data
  const issuerRncCheck = validateDominicanRnc(config.rnc);
  if (!issuerRncCheck.valid) {
    errors.push(`RNC del emisor inválido o no configurado: ${issuerRncCheck.reason || config.rnc}`);
  }
  if (!config.legalName || config.legalName.trim().length < 2) {
    errors.push('La razón social del emisor es obligatoria.');
  }
  if (!config.fiscalAddress || config.fiscalAddress.trim().length < 4) {
    errors.push('La dirección fiscal del emisor es obligatoria.');
  }

  // 3. Date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    errors.push('La fecha de emisión debe tener formato válido YYYY-MM-DD.');
  }

  // 4. Receiver rules per e-CF type (Ley 32-23 / DGII Norma 06-18 & e-CF)
  if (meta.requiresBuyerRnc) {
    if (ecfType === '41') {
      if (receiverIdType !== 'RNC' && receiverIdType !== 'CEDULA') {
        errors.push('El Comprobante de Compras (41) requiere RNC o Cédula válida del proveedor informal.');
      } else {
        const res = validateTaxIdByType(receiverIdType, receiverTaxId);
        if (!res.valid) errors.push(`Identificación del proveedor inválida (e-CF 41): ${res.reason}`);
      }
    } else {
      if (receiverIdType !== 'RNC') {
        errors.push(`El comprobante e-CF ${ecfType} (${meta.shortName}) exige un comprador con RNC válido.`);
      } else {
        const rncRes = validateDominicanRnc(receiverTaxId);
        if (!rncRes.valid) errors.push(`RNC del comprador inválido: ${rncRes.reason}`);
      }
    }
    if (!receiverName || receiverName.trim().length < 2) {
      errors.push('La razón social / nombre del receptor es obligatoria.');
    }
  } else if (ecfType === '32') {
    if (totalAmount >= 250000) {
      if (receiverIdType === 'SIN_ID' || !receiverTaxId.trim()) {
        errors.push(
          'Las Facturas de Consumo (32) iguales o mayores a RD$250,000.00 requieren obligatoriamente identificación (RNC/Cédula/Pasaporte) y nombre del comprador.'
        );
      } else {
        const res = validateTaxIdByType(receiverIdType, receiverTaxId);
        if (!res.valid) errors.push(`Identificación del comprador inválida (E32 ≥ 250,000): ${res.reason}`);
      }
      if (!receiverName || receiverName.trim().length < 2) {
        errors.push('El nombre del comprador es obligatorio para E32 ≥ RD$250,000.00.');
      }
    } else if (receiverIdType !== 'SIN_ID' && receiverTaxId.trim().length > 0) {
      const res = validateTaxIdByType(receiverIdType, receiverTaxId);
      if (!res.valid) errors.push(`Identificación del receptor inválida: ${res.reason}`);
    }
  } else if (ecfType === '33' || ecfType === '34') {
    if (!referenceEcf || !isValidEncfFormat(referenceEcf)) {
      errors.push(
        `Las ${meta.name} (${ecfType}) requieren un e-NCF de referencia válido (ej. E310000000001).`
      );
    }
    if (!referenceDate || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      errors.push(`La fecha del comprobante modificado es obligatoria para e-CF ${ecfType}.`);
    }
    if (!modificationCode || !['1', '2', '3', '4', '5'].includes(modificationCode)) {
      errors.push(`Debe indicar el Código de Modificación oficial DGII (1..5) para e-CF ${ecfType}.`);
    }
    if (receiverIdType !== 'SIN_ID' && receiverTaxId.trim().length > 0) {
      const res = validateTaxIdByType(receiverIdType, receiverTaxId);
      if (!res.valid) errors.push(`Identificación del receptor inválida: ${res.reason}`);
    }
  } else if (receiverIdType !== 'SIN_ID' && receiverTaxId.trim().length > 0) {
    const res = validateTaxIdByType(receiverIdType, receiverTaxId);
    if (!res.valid) errors.push(`Identificación del receptor inválida: ${res.reason}`);
  }

  // 5. Line Items & Totals
  if (!items || items.length === 0) {
    errors.push('Debe incluir al menos una línea de producto o servicio.');
  } else {
    items.forEach((it, idx) => {
      if (!it.description || it.description.trim().length < 2) {
        errors.push(`Línea #${idx + 1}: la descripción es obligatoria.`);
      }
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        errors.push(`Línea #${idx + 1}: la cantidad debe ser mayor a cero.`);
      }
      if (!Number.isFinite(it.unitPrice) || it.unitPrice < 0) {
        errors.push(`Línea #${idx + 1}: el precio unitario no puede ser negativo.`);
      }
    });
  }
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    errors.push('El monto total del comprobante debe ser mayor a cero.');
  }

  // 6. Sequence Range Check (required on issuance, optional warning on draft)
  const activeSequence = sequences.find(
    (s) =>
      s.ecfType === ecfType &&
      s.status === 'ACTIVA' &&
      s.lastUsedSequence < s.endSequence &&
      s.expiryDate >= issueDate
  );

  if (!activeSequence) {
    const msg = `No existe un rango de secuencias e-NCF ACTIVO y vigente con folios disponibles para tipo ${ecfType} (E${ecfType}).`;
    if (isDraftOnly) {
      warnings.push(msg);
    } else {
      errors.push(msg);
    }
  } else {
    const remaining = activeSequence.endSequence - activeSequence.lastUsedSequence;
    if (remaining <= 10) {
      warnings.push(`Quedan solo ${remaining} secuencias e-NCF disponibles en el rango ${activeSequence.prefix}.`);
    }
  }

  if (config.environment === 'PRODUCCION' && !config.isCertifiedByDgii) {
    errors.push(
      'Bloqueo de seguridad fiscal: La empresa aún no está marcada como certificada ante la DGII; no se permite emitir en Producción hasta completar la certificación oficial.'
    );
  }

  const nextSeq = activeSequence ? activeSequence.lastUsedSequence + 1 : undefined;
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    availableSequenceRange: activeSequence,
    nextSequenceNumber: nextSeq,
    projectedEncf: nextSeq !== undefined ? formatEncf(ecfType, nextSeq) : undefined,
  };
}

export function getEnabledEcfTypeMetaList(enabledTypes: EcfTypeCode[]) {
  return ALL_ECF_TYPES.map((code) => ({
    ...ECF_TYPE_META[code],
    enabled: enabledTypes.includes(code),
  }));
}
