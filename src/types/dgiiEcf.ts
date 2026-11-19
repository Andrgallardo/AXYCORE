import type { CurrencyCode } from './axycore';

export type EcfTypeCode =
  | '31' // Factura de Crédito Fiscal Electrónica
  | '32' // Factura de Consumo Electrónica
  | '33' // Nota de Débito Electrónica
  | '34' // Nota de Crédito Electrónica
  | '41' // Comprobante de Compras Electrónico
  | '43' // Comprobante de Gastos Menores Electrónico
  | '44' // Comprobante de Régimen Especial Electrónico
  | '45' // Comprobante Gubernamental Electrónico
  | '46' // Comprobante para Exportaciones Electrónico
  | '47'; // Comprobante para Pagos al Exterior Electrónico

export type EcfLifecycleStatus =
  | 'BORRADOR'
  | 'PENDIENTE_FIRMA'
  | 'FIRMADA'
  | 'PENDIENTE_ENVIO'
  | 'ENVIADA_DGII'
  | 'PENDIENTE_RESPUESTA'
  | 'ACEPTADA'
  | 'ACEPTADA_CONDICIONAL'
  | 'RECHAZADA'
  | 'ANULADA'
  | 'ERROR_COMUNICACION';

export type DgiiEnvironment =
  | 'DESARROLLO'
  | 'PRECERTIFICACION'
  | 'CERTIFICACION'
  | 'PRODUCCION';

export type EcfDirection = 'EMITIDO' | 'RECIBIDO';

export type EcfItbisRate = 18 | 16 | 0;

export type EcfPaymentCondition = 'CONTADO' | 'CREDITO_15' | 'CREDITO_30' | 'CREDITO_60' | 'OTRO';

export type EcfPaymentMethodCode =
  | 'EFECTIVO'
  | 'CHEQUE_TRANSFERENCIA'
  | 'TARJETA_CREDITO_DEBITO'
  | 'VENTA_CREDITO'
  | 'BONOS_CERTIFICADOS'
  | 'PERMUTA'
  | 'NOTA_CREDITO'
  | 'OTRAS';

export type EcfModificationCode =
  | '1' // Anula el NCF modificado
  | '2' // Corrige Texto del Comprobante Fiscal modificado
  | '3' // Corrige montos del NCF modificado
  | '4' // Reemplazo NCF emitido en contingencia
  | '5'; // Referencia Factura Consumo Electrónica

export type OtherTaxCode =
  | 'NINGUNO'
  | 'ISC_AD_VALOREM'
  | 'ISC_ESPECIFICO'
  | 'PROPINA_LEGAL'
  | 'CDT_OTROS';

export interface EcfLineItem {
  lineNumber: number;
  productId?: string;
  sku?: string;
  description: string;
  itemType: 'BIEN' | 'SERVICIO';
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  discountAmount: number;
  itbisRate: EcfItbisRate;
  isExempt: boolean;
  itbisAmount: number;
  otherTaxCode: OtherTaxCode;
  otherTaxRatePct: number;
  otherTaxAmount: number;
  lineSubtotal: number; // quantity * unitPrice - discountAmount
  lineTotal: number; // lineSubtotal + itbisAmount + otherTaxAmount
  accountCode?: string;
}

export interface DgiiEnvironmentEndpoints {
  authSeedUrl: string;
  authValidateUrl: string;
  receptionUrl: string;
  receptionFcUrl: string;
  trackResultUrl: string;
  trackListUrl: string;
  commercialApprovalUrl: string;
  voidRangeUrl: string;
  directoryUrl: string;
  serviceStatusUrl: string;
}

export interface AccountingAccountMapping {
  receivablesAccountCode: string; // 1103 CxC Clientes / Facturas
  cashOrBankAccountCode: string; // 1102 Bancos / Caja
  salesRevenueAccountCode: string; // 4101 Ingresos por Servicios / Ventas
  interestRevenueAccountCode: string; // 4102 Ingresos por Intereses y Comisiones
  itbisPayableAccountCode: string; // 2103 ITBIS por Pagar
  itbisCreditableAccountCode: string; // 1104 ITBIS Adelantado / Acreditable
  otherTaxesPayableAccountCode: string; // 2104 Otros Impuestos por Pagar
  payablesAccountCode: string; // 2101 Cuentas por Pagar Proveedores
  purchasesExpenseAccountCode: string; // 5101 Compras / Costos y Gastos Deducibles
  creditNoteReturnsAccountCode: string; // 4109 Devoluciones y Descuentos sobre Ventas
  minorExpensesAccountCode: string; // 5105 Gastos Menores
  withholdingTaxPayableCode: string; // 2105 Retenciones ISR / Pagos al Exterior
}

export interface DgiiFiscalConfigRecord {
  id: string; // equals organizationId
  organizationId: string;
  rnc: string;
  legalName: string;
  tradeName: string;
  fiscalAddress: string;
  municipality: string;
  province: string;
  phone: string;
  email: string;
  economicActivity: string;
  taxpayerType: 'PERSONA_JURIDICA' | 'PERSONA_FISICA' | 'GRAN_CONTRIBUYENTE' | 'REGIMEN_ESPECIAL' | 'GUBERNAMENTAL';
  defaultCurrency: CurrencyCode;
  environment: DgiiEnvironment;
  isCertifiedByDgii: boolean;
  certificationStageNotes?: string;
  enabledEcfTypes: EcfTypeCode[];
  endpointsByEnv: Record<DgiiEnvironment, DgiiEnvironmentEndpoints>;
  timeoutMs: number;
  maxRetries: number;
  autoPostAccounting: boolean;
  accountMapping: AccountingAccountMapping;
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DgiiCertificateStatus = 'ACTIVO' | 'POR_VENCER' | 'VENCIDO' | 'REVOCADO';

export interface DgiiCertificateRecord {
  id: string;
  organizationId: string;
  alias: string;
  subjectCn: string;
  subjectRnc: string;
  issuerCn: string;
  serialNumber: string;
  fingerprintSha256: string;
  validFrom: string; // ISO
  validTo: string; // ISO
  status: DgiiCertificateStatus;
  vaultKeyId: string; // opaque ref to server-side encrypted AES-256-GCM vault
  hasPrivateKey: boolean;
  uploadedBy: string;
  uploadedByName: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DgiiSequenceStatus = 'ACTIVA' | 'AGOTADA' | 'VENCIDA' | 'SUSPENDIDA';

export interface DgiiEncfSequenceRecord {
  id: string;
  organizationId: string;
  ecfType: EcfTypeCode;
  prefix: string; // e.g. E31
  authorizationNumber: string;
  authDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  startSequence: number;
  endSequence: number;
  lastUsedSequence: number; // startSequence - 1 initially
  status: DgiiSequenceStatus;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DgiiReceiverRecord {
  id: string;
  organizationId: string;
  partyRole: 'CLIENTE' | 'PROVEEDOR' | 'AMBOS';
  idType: 'RNC' | 'CEDULA' | 'PASAPORTE';
  taxId: string;
  legalName: string;
  tradeName?: string;
  address: string;
  municipality?: string;
  province?: string;
  email: string;
  phone: string;
  taxRegime: 'ORDINARIO' | 'PST' | 'ZONA_FRANCA' | 'GUBERNAMENTAL' | 'EXTERIOR' | 'CONSUMIDOR_FINAL';
  linkedCustomerId?: string;
  status: 'ACTIVO' | 'INACTIVO';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DgiiProductRecord {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  description: string;
  itemType: 'BIEN' | 'SERVICIO';
  unitOfMeasure: string;
  unitPrice: number;
  currency: CurrencyCode;
  itbisRate: EcfItbisRate;
  isExempt: boolean;
  otherTaxCode: OtherTaxCode;
  otherTaxRatePct: number;
  incomeAccountCode: string;
  expenseAccountCode: string;
  status: 'ACTIVO' | 'INACTIVO';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DgiiResponseLog {
  timestamp: string;
  operation: 'AUTH' | 'RECEPCION' | 'RECEPCION_FC' | 'CONSULTA_ESTADO' | 'APROBACION_COMERCIAL' | 'ANULACION_RANGO' | 'ACUSE_RECIBO';
  environment: DgiiEnvironment;
  httpStatus: number;
  code: string;
  message: string;
  trackId?: string;
  isOfficialDgiiResponse: boolean;
  rawPayloadSnippet?: string;
}

export interface DgiiEcfDocumentRecord {
  id: string;
  organizationId: string;
  direction: EcfDirection;
  ecfType: EcfTypeCode;
  eNCF: string; // empty string if BORRADOR without sequence yet
  sequenceRangeId?: string;
  status: EcfLifecycleStatus;
  environment: DgiiEnvironment;
  isOfficialDgiiResponse: boolean;
  isTestSimulation: boolean;
  issuerRnc: string;
  issuerName: string;
  issuerAddress: string;
  receiverId?: string;
  receiverIdType: 'RNC' | 'CEDULA' | 'PASAPORTE' | 'SIN_ID';
  receiverTaxId: string;
  receiverName: string;
  receiverAddress: string;
  receiverEmail?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  paymentCondition: EcfPaymentCondition;
  paymentMethod: EcfPaymentMethodCode;
  currency: CurrencyCode;
  exchangeRate: number;
  items: EcfLineItem[];
  subtotal: number;
  totalDiscount: number;
  exemptAmount: number;
  taxableAmount18: number;
  taxableAmount16: number;
  totalItbis: number;
  otherTaxesTotal: number;
  totalAmount: number;
  referenceEcf?: string;
  referenceDate?: string;
  modificationCode?: EcfModificationCode;
  notes?: string;
  originalXml?: string;
  signedXml?: string;
  xmlHashSha256?: string;
  securityCode?: string; // 6-char prefix of SignatureValue
  signedAt?: string;
  certificateId?: string;
  qrUrl?: string;
  trackId?: string;
  dgiiStatusText?: string;
  dgiiResponses: DgiiResponseLog[];
  commercialApprovalStatus: 'NO_APLICA' | 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';
  acuseReciboXml?: string;
  aprobacionComercialXml?: string;
  voidReason?: string;
  accountingEntryId?: string;
  paymentCollectionStatus: 'NO_APLICA' | 'PENDIENTE' | 'COBRADA' | 'PAGADA';
  paymentAccountingEntryId?: string;
  emailSentAt?: string;
  emailSentTo?: string;
  createdBy: string;
  createdByName: string;
  issuedBy?: string;
  issuedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AccountingAccountType = 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESO' | 'COSTO' | 'GASTO';

export interface AccountingAccountRecord {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  accountType: AccountingAccountType;
  normalBalance: 'DEBITO' | 'CREDITO';
  parentCode?: string;
  isPostable: boolean;
  systemTag?: string;
  status: 'ACTIVA' | 'INACTIVA';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type JournalEntrySourceType =
  | 'ECF_EMITIDO'
  | 'ECF_RECIBIDO'
  | 'ECF_NOTA_CREDITO'
  | 'ECF_NOTA_DEBITO'
  | 'COBRO_FACTURA'
  | 'PAGO_PROVEEDOR'
  | 'DESEMBOLSO'
  | 'PAGO_PRESTAMO'
  | 'GASTO_OPERATIVO'
  | 'MANUAL'
  | 'REVERSO';

export interface JournalEntryLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface JournalEntryRecord {
  id: string;
  organizationId: string;
  entryNumber: string;
  entryDate: string; // YYYY-MM-DD
  sourceType: JournalEntrySourceType;
  sourceId: string;
  idempotencyKey: string;
  currency: CurrencyCode;
  description: string;
  referenceDoc?: string;
  lines: JournalEntryLine[];
  totalDebit: number;
  totalCredit: number;
  status: 'CONTABILIZADO' | 'REVERTIDO';
  reversedEntryId?: string;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DgiiAuditLogRecord {
  id: string;
  organizationId: string;
  eventType:
    | 'XML_GENERATED'
    | 'XSD_VALIDATED'
    | 'SEQUENCE_RESERVED'
    | 'SEQUENCE_CREATED'
    | 'XML_SIGNED'
    | 'DGII_AUTH_TOKEN'
    | 'DGII_SUBMITTED'
    | 'DGII_STATUS_POLLED'
    | 'COMMERCIAL_APPROVAL'
    | 'ACUSE_RECIBO'
    | 'SEQUENCE_VOIDED'
    | 'CERT_UPLOADED'
    | 'CERT_REPLACED'
    | 'CONFIG_UPDATED'
    | 'ACCOUNTING_POSTED'
    | 'EMAIL_SENT'
    | 'SANDBOX_TEST_RUN'
    | 'RECEIVED_ECF_IMPORTED';
  ecfDocumentId?: string;
  eNCF?: string;
  environment: DgiiEnvironment;
  summary: string;
  details?: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  timestampIso: string;
  createdAt?: unknown;
}

export const ECF_TYPE_META: Record<
  EcfTypeCode,
  {
    code: EcfTypeCode;
    prefix: string;
    name: string;
    shortName: string;
    requiresBuyerRnc: boolean;
    allowsItbis: boolean;
    isCreditFiscal: boolean;
    isAdjustmentNote: boolean;
    isPurchaseOrExpense: boolean;
    description: string;
  }
> = {
  '31': {
    code: '31',
    prefix: 'E31',
    name: 'Factura de Crédito Fiscal Electrónica',
    shortName: 'Crédito Fiscal (31)',
    requiresBuyerRnc: true,
    allowsItbis: true,
    isCreditFiscal: true,
    isAdjustmentNote: false,
    isPurchaseOrExpense: false,
    description: 'Sustenta crédito fiscal de ITBIS y costos/gastos deducibles para contribuyentes con RNC.',
  },
  '32': {
    code: '32',
    prefix: 'E32',
    name: 'Factura de Consumo Electrónica',
    shortName: 'Consumo (32)',
    requiresBuyerRnc: false,
    allowsItbis: true,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: false,
    description: 'Para ventas a consumidores finales. Menores a RD$250,000 utilizan resumen RFCE; ≥ RD$250,000 requieren identificación del comprador.',
  },
  '33': {
    code: '33',
    prefix: 'E33',
    name: 'Nota de Débito Electrónica',
    shortName: 'Nota Débito (33)',
    requiresBuyerRnc: false,
    allowsItbis: true,
    isCreditFiscal: false,
    isAdjustmentNote: true,
    isPurchaseOrExpense: false,
    description: 'Incrementa montos o cargos sobre un e-CF emitido previamente (requiere e-NCF de referencia).',
  },
  '34': {
    code: '34',
    prefix: 'E34',
    name: 'Nota de Crédito Electrónica',
    shortName: 'Nota Crédito (34)',
    requiresBuyerRnc: false,
    allowsItbis: true,
    isCreditFiscal: false,
    isAdjustmentNote: true,
    isPurchaseOrExpense: false,
    description: 'Anula o reduce parcial/totalmente un e-CF emitido previamente mediante referencia obligatoria.',
  },
  '41': {
    code: '41',
    prefix: 'E41',
    name: 'Comprobante de Compras Electrónico',
    shortName: 'Compras (41)',
    requiresBuyerRnc: true,
    allowsItbis: true,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: true,
    description: 'Emitido por el adquirente cuando compra bienes o servicios a personas físicas no registradas como contribuyentes.',
  },
  '43': {
    code: '43',
    prefix: 'E43',
    name: 'Comprobante de Gastos Menores Electrónico',
    shortName: 'Gastos Menores (43)',
    requiresBuyerRnc: false,
    allowsItbis: false,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: true,
    description: 'Sustenta gastos diversos realizados fuera del establecimiento por personal autorizado sin comprobante fiscal del proveedor.',
  },
  '44': {
    code: '44',
    prefix: 'E44',
    name: 'Comprobante de Régimen Especial Electrónico',
    shortName: 'Régimen Especial (44)',
    requiresBuyerRnc: true,
    allowsItbis: false,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: false,
    description: 'Facturación exenta de ITBIS/ISC a contribuyentes acogidos a leyes de regímenes especiales (ej. Zonas Francas, Confotur).',
  },
  '45': {
    code: '45',
    prefix: 'E45',
    name: 'Comprobante Gubernamental Electrónico',
    shortName: 'Gubernamental (45)',
    requiresBuyerRnc: true,
    allowsItbis: true,
    isCreditFiscal: true,
    isAdjustmentNote: false,
    isPurchaseOrExpense: false,
    description: 'Ventas de bienes o prestación de servicios a instituciones del Estado dominicano.',
  },
  '46': {
    code: '46',
    prefix: 'E46',
    name: 'Comprobante para Exportaciones Electrónico',
    shortName: 'Exportaciones (46)',
    requiresBuyerRnc: false,
    allowsItbis: false,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: false,
    description: 'Ventas de bienes o servicios exportados fuera del territorio aduanero dominicano (tasa 0% ITBIS).',
  },
  '47': {
    code: '47',
    prefix: 'E47',
    name: 'Comprobante para Pagos al Exterior Electrónico',
    shortName: 'Pagos al Exterior (47)',
    requiresBuyerRnc: false,
    allowsItbis: false,
    isCreditFiscal: false,
    isAdjustmentNote: false,
    isPurchaseOrExpense: true,
    description: 'Sustenta pagos realizados a proveedores domiciliados en el exterior sujetos a retención de ISR (27%).',
  },
};

export const ALL_ECF_TYPES: EcfTypeCode[] = ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47'];

export const ECF_STATUS_LABELS: Record<EcfLifecycleStatus, string> = {
  BORRADOR: 'Borrador',
  PENDIENTE_FIRMA: 'Pendiente de Firma',
  FIRMADA: 'Firmada',
  PENDIENTE_ENVIO: 'Pendiente de Envío',
  ENVIADA_DGII: 'Enviada a DGII',
  PENDIENTE_RESPUESTA: 'Pendiente de Respuesta',
  ACEPTADA: 'Aceptada DGII',
  ACEPTADA_CONDICIONAL: 'Aceptada Condicional',
  RECHAZADA: 'Rechazada',
  ANULADA: 'Anulada',
  ERROR_COMUNICACION: 'Error de Comunicación',
};
