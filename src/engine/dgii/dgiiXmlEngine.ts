import {
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type DgiiFiscalConfigRecord,
  type EcfLineItem,
  type EcfPaymentMethodCode,
  type EcfTypeCode,
} from '../../types/dgiiEcf';
import { cleanDigits, round2 } from './dgiiCatalogAndValidation';
import {
  validateXmlAgainstDgiiXsd,
  type XsdValidationResult,
} from './xmlValidator';

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isoToDgiiDate(isoDate: string): string {
  const clean = String(isoDate || '').slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return clean;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export function dgiiDateToIso(dgiiDate: string): string {
  const clean = String(dgiiDate || '').trim();
  const parts = clean.split('-');
  if (parts.length !== 3) return clean;
  if (parts[0].length === 4) return clean;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function mapPaymentMethodToDgiiCode(method: EcfPaymentMethodCode): string {
  const map: Record<EcfPaymentMethodCode, string> = {
    EFECTIVO: '1',
    CHEQUE_TRANSFERENCIA: '2',
    TARJETA_CREDITO_DEBITO: '3',
    VENTA_CREDITO: '4',
    BONOS_CERTIFICADOS: '5',
    PERMUTA: '6',
    NOTA_CREDITO: '7',
    OTRAS: '8',
  };
  return map[method] || '8';
}

function mapItbisRateToIndicadorFacturacion(item: EcfLineItem): string {
  if (item.isExempt || item.itbisRate === 0) return '4'; // Exento (4) o Tasa 0% (3)
  if (item.itbisRate === 16) return '2';
  return '1'; // 18%
}

export function buildDgiiEcfXml(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  sequenceExpiryDate?: string;
}): string {
  const { document: doc, config, sequenceExpiryDate = '2027-12-31' } = params;
  const encf = doc.eNCF || `E${doc.ecfType}0000000000`;
  const tipoPago = doc.paymentCondition === 'CONTADO' ? '1' : '2';
  const formaPago = mapPaymentMethodToDgiiCode(doc.paymentMethod);
  const issuerRnc = cleanDigits(doc.issuerRnc || config.rnc);
  const buyerId = cleanDigits(doc.receiverTaxId || '') || String(doc.receiverTaxId || '').trim();

  const itemsXml = doc.items
    .map((item) => {
      const indFact = mapItbisRateToIndicadorFacturacion(item);
      const indBienServ = item.itemType === 'BIEN' ? '1' : '2';
      const montoBruto = round2(item.quantity * item.unitPrice);
      return [
        '    <Item>',
        `      <NumeroLinea>${item.lineNumber}</NumeroLinea>`,
        `      <IndicadorFacturacion>${indFact}</IndicadorFacturacion>`,
        `      <NombreItem>${escapeXml(item.description.slice(0, 80))}</NombreItem>`,
        `      <IndicadorBienoServicio>${indBienServ}</IndicadorBienoServicio>`,
        `      <CantidadItem>${item.quantity.toFixed(2)}</CantidadItem>`,
        `      <UnidadMedida>${escapeXml(item.unitOfMeasure || '43')}</UnidadMedida>`,
        `      <PrecioUnitarioItem>${item.unitPrice.toFixed(2)}</PrecioUnitarioItem>`,
        item.discountAmount > 0
          ? `      <DescuentoMonto>${item.discountAmount.toFixed(2)}</DescuentoMonto>`
          : '',
        `      <MontoItem>${item.lineSubtotal.toFixed(2)}</MontoItem>`,
        item.itbisAmount > 0 ? `      <MontoITBIS>${item.itbisAmount.toFixed(2)}</MontoITBIS>` : '',
        item.otherTaxAmount > 0
          ? `      <MontoOtrosImpuestos>${item.otherTaxAmount.toFixed(2)}</MontoOtrosImpuestos>`
          : '',
        montoBruto !== item.lineSubtotal ? '' : '',
        '    </Item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const refBlock =
    (doc.ecfType === '33' || doc.ecfType === '34') && doc.referenceEcf
      ? [
          '  <InformacionReferencia>',
          `    <NCFModificado>${escapeXml(doc.referenceEcf)}</NCFModificado>`,
          doc.referenceDate
            ? `    <FechaNCFModificado>${isoToDgiiDate(doc.referenceDate)}</FechaNCFModificado>`
            : '',
          doc.modificationCode
            ? `    <CodigoModificacion>${escapeXml(doc.modificationCode)}</CodigoModificacion>`
            : '',
          '  </InformacionReferencia>',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

  const compradorXml =
    doc.receiverIdType === 'SIN_ID' && !buyerId
      ? [
          '    <Comprador>',
          `      <RazonSocialComprador>${escapeXml(doc.receiverName || 'CONSUMIDOR FINAL')}</RazonSocialComprador>`,
          '    </Comprador>',
        ].join('\n')
      : [
          '    <Comprador>',
          doc.receiverIdType === 'RNC' || doc.receiverIdType === 'CEDULA'
            ? `      <RNCComprador>${escapeXml(buyerId)}</RNCComprador>`
            : `      <IdentificadorExtranjero>${escapeXml(buyerId)}</IdentificadorExtranjero>`,
          `      <RazonSocialComprador>${escapeXml(doc.receiverName || 'RECEPTOR')}</RazonSocialComprador>`,
          doc.receiverEmail
            ? `      <CorreoComprador>${escapeXml(doc.receiverEmail)}</CorreoComprador>`
            : '',
          doc.receiverAddress
            ? `      <DireccionComprador>${escapeXml(doc.receiverAddress)}</DireccionComprador>`
            : '',
          '    </Comprador>',
        ]
          .filter(Boolean)
          .join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ECF>',
    '  <Encabezado>',
    '    <Version>1.0</Version>',
    '    <IdDoc>',
    `      <TipoeCF>${doc.ecfType}</TipoeCF>`,
    `      <eNCF>${escapeXml(encf)}</eNCF>`,
    doc.ecfType !== '32' && doc.ecfType !== '34'
      ? `      <FechaVencimientoSecuencia>${isoToDgiiDate(sequenceExpiryDate)}</FechaVencimientoSecuencia>`
      : '',
    '      <IndicadorMontoGravado>0</IndicadorMontoGravado>',
    `      <TipoPago>${tipoPago}</TipoPago>`,
    doc.dueDate ? `      <FechaLimitePago>${isoToDgiiDate(doc.dueDate)}</FechaLimitePago>` : '',
    '      <TablaFormasPago>',
    '        <FormaDePago>',
    `          <FormaPago>${formaPago}</FormaPago>`,
    `          <MontoPago>${doc.totalAmount.toFixed(2)}</MontoPago>`,
    '        </FormaDePago>',
    '      </TablaFormasPago>',
    '    </IdDoc>',
    '    <Emisor>',
    `      <RNCEmisor>${escapeXml(issuerRnc)}</RNCEmisor>`,
    `      <RazonSocialEmisor>${escapeXml(doc.issuerName || config.legalName)}</RazonSocialEmisor>`,
    config.tradeName
      ? `      <NombreComercial>${escapeXml(config.tradeName)}</NombreComercial>`
      : '',
    `      <DireccionEmisor>${escapeXml(doc.issuerAddress || config.fiscalAddress)}</DireccionEmisor>`,
    `      <FechaEmision>${isoToDgiiDate(doc.issueDate)}</FechaEmision>`,
    '    </Emisor>',
    compradorXml,
    '    <Totales>',
    doc.taxableAmount18 > 0
      ? `      <MontoGravadoTotal>${round2(doc.taxableAmount18 + doc.taxableAmount16).toFixed(2)}</MontoGravadoTotal>`
      : doc.taxableAmount16 > 0
      ? `      <MontoGravadoTotal>${doc.taxableAmount16.toFixed(2)}</MontoGravadoTotal>`
      : '',
    doc.taxableAmount18 > 0
      ? `      <MontoGravadoI1>${doc.taxableAmount18.toFixed(2)}</MontoGravadoI1>`
      : '',
    doc.taxableAmount16 > 0
      ? `      <MontoGravadoI2>${doc.taxableAmount16.toFixed(2)}</MontoGravadoI2>`
      : '',
    doc.exemptAmount > 0 ? `      <MontoExento>${doc.exemptAmount.toFixed(2)}</MontoExento>` : '',
    doc.taxableAmount18 > 0 ? '      <ITBIS1>18</ITBIS1>' : '',
    doc.taxableAmount16 > 0 ? '      <ITBIS2>16</ITBIS2>' : '',
    doc.totalItbis > 0 ? `      <TotalITBIS>${doc.totalItbis.toFixed(2)}</TotalITBIS>` : '',
    doc.otherTaxesTotal > 0
      ? `      <MontoImpuestoAdicional>${doc.otherTaxesTotal.toFixed(2)}</MontoImpuestoAdicional>`
      : '',
    `      <MontoTotal>${doc.totalAmount.toFixed(2)}</MontoTotal>`,
    doc.currency !== 'DOP'
      ? `      <TipoMoneda>${escapeXml(doc.currency)}</TipoMoneda>`
      : '',
    doc.currency !== 'DOP'
      ? `      <TipoCambio>${(doc.exchangeRate || 1).toFixed(4)}</TipoCambio>`
      : '',
    '    </Totales>',
    '  </Encabezado>',
    '  <DetallesItems>',
    itemsXml,
    '  </DetallesItems>',
    refBlock,
    '</ECF>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates RFCE (Resumen Factura de Consumo Electrónica) XML for E32 < RD$250,000.
 */
export function buildDgiiRfceXml(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  securityCode: string;
}): string {
  const { document: doc, config, securityCode } = params;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<RFCE>',
    '  <Encabezado>',
    '    <Version>1.0</Version>',
    '    <IdDoc>',
    '      <TipoeCF>32</TipoeCF>',
    `      <eNCF>${escapeXml(doc.eNCF)}</eNCF>`,
    `      <TipoPago>${doc.paymentCondition === 'CONTADO' ? '1' : '2'}</TipoPago>`,
    '    </IdDoc>',
    '    <Emisor>',
    `      <RNCEmisor>${escapeXml(cleanDigits(doc.issuerRnc || config.rnc))}</RNCEmisor>`,
    `      <RazonSocialEmisor>${escapeXml(doc.issuerName || config.legalName)}</RazonSocialEmisor>`,
    `      <FechaEmision>${isoToDgiiDate(doc.issueDate)}</FechaEmision>`,
    '    </Emisor>',
    '    <Comprador>',
    `      <RazonSocialComprador>${escapeXml(doc.receiverName || 'CONSUMIDOR FINAL')}</RazonSocialComprador>`,
    '    </Comprador>',
    '    <Totales>',
    doc.taxableAmount18 + doc.taxableAmount16 > 0
      ? `      <MontoGravadoTotal>${round2(doc.taxableAmount18 + doc.taxableAmount16).toFixed(2)}</MontoGravadoTotal>`
      : '',
    doc.exemptAmount > 0 ? `      <MontoExento>${doc.exemptAmount.toFixed(2)}</MontoExento>` : '',
    doc.totalItbis > 0 ? `      <TotalITBIS>${doc.totalItbis.toFixed(2)}</TotalITBIS>` : '',
    `      <MontoTotal>${doc.totalAmount.toFixed(2)}</MontoTotal>`,
    '    </Totales>',
    `    <CodigoSeguridadeCF>${escapeXml(securityCode)}</CodigoSeguridadeCF>`,
    '  </Encabezado>',
    '</RFCE>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates ACECF (Aprobación Comercial de e-CF) XML sent by receiver to DGII & supplier.
 */
export function buildDgiiAcecfXml(params: {
  issuerRnc: string;
  eNCF: string;
  issueDate: string;
  totalAmount: number;
  buyerRnc: string;
  status: '1' | '2'; // 1 = Aprobado comercialmente, 2 = Rechazado comercialmente
  reason?: string;
  approvalDateTime?: string;
}): string {
  const {
    issuerRnc,
    eNCF,
    issueDate,
    totalAmount,
    buyerRnc,
    status,
    reason,
    approvalDateTime = new Date().toISOString(),
  } = params;
  const formattedDt = `${isoToDgiiDate(approvalDateTime.slice(0, 10))} ${approvalDateTime.slice(11, 19)}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ACECF>',
    '  <DetalleAprobacionComercial>',
    '    <Version>1.0</Version>',
    `    <RNCEmisor>${escapeXml(cleanDigits(issuerRnc))}</RNCEmisor>`,
    `    <eNCF>${escapeXml(eNCF)}</eNCF>`,
    `    <FechaEmision>${isoToDgiiDate(issueDate)}</FechaEmision>`,
    `    <MontoTotal>${totalAmount.toFixed(2)}</MontoTotal>`,
    `    <RNCComprador>${escapeXml(cleanDigits(buyerRnc))}</RNCComprador>`,
    `    <Estado>${status}</Estado>`,
    reason ? `    <DetalleMotivoRechazo>${escapeXml(reason.slice(0, 250))}</DetalleMotivoRechazo>` : '',
    `    <FechaHoraAprobacionComercial>${escapeXml(formattedDt)}</FechaHoraAprobacionComercial>`,
    '  </DetalleAprobacionComercial>',
    '</ACECF>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates ARECF (Acuse de Recibo Técnico) XML.
 */
export function buildDgiiArecfXml(params: {
  issuerRnc: string;
  buyerRnc: string;
  eNCF: string;
  accepted: boolean;
  errorCode?: string;
}): string {
  const now = new Date().toISOString();
  const formattedDt = `${isoToDgiiDate(now.slice(0, 10))} ${now.slice(11, 19)}`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ARECF>',
    '  <DetalleAcusedeRecibo>',
    '    <Version>1.0</Version>',
    `    <RNCEmisor>${escapeXml(cleanDigits(params.issuerRnc))}</RNCEmisor>`,
    `    <RNCComprador>${escapeXml(cleanDigits(params.buyerRnc))}</RNCComprador>`,
    `    <eNCF>${escapeXml(params.eNCF)}</eNCF>`,
    `    <Estado>${params.accepted ? '0' : '1'}</Estado>`,
    !params.accepted && params.errorCode
      ? `    <CodigoMotivoNoRecibido>${escapeXml(params.errorCode)}</CodigoMotivoNoRecibido>`
      : '',
    `    <FechaHoraAcuseRecibo>${escapeXml(formattedDt)}</FechaHoraAcuseRecibo>`,
    '  </DetalleAcusedeRecibo>',
    '</ARECF>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Generates ANECF (Anulación de Secuencias e-NCF) XML.
 */
export function buildDgiiAnecfXml(params: {
  issuerRnc: string;
  ranges: Array<{
    ecfType: EcfTypeCode;
    fromEncf: string;
    toEncf: string;
    quantity: number;
  }>;
}): string {
  const rangesXml = params.ranges
    .map(
      (r, idx) => [
        '    <Anulacion>',
        `      <NoLinea>${idx + 1}</NoLinea>`,
        `      <TipoeCF>${r.ecfType}</TipoeCF>`,
        '      <TablaRangoSecuenciasAnuladaseNCF>',
        '        <Secuencias>',
        `          <SecuenciaeNCFDesde>${escapeXml(r.fromEncf)}</SecuenciaeNCFDesde>`,
        `          <SecuenciaeNCFHasta>${escapeXml(r.toEncf)}</SecuenciaeNCFHasta>`,
        '        </Secuencias>',
        '      </TablaRangoSecuenciasAnuladaseNCF>',
        `      <CantidadeNCFAnulados>${r.quantity}</CantidadeNCFAnulados>`,
        '    </Anulacion>',
      ].join('\n')
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ANECF>',
    '  <Encabezado>',
    '    <Version>1.0</Version>',
    `    <RncEmisor>${escapeXml(cleanDigits(params.issuerRnc))}</RncEmisor>`,
    `    <CantidadeNCFAnulados>${params.ranges.reduce((s, r) => s + r.quantity, 0)}</CantidadeNCFAnulados>`,
    `    <FechaHoraAnulacioneNCF>${isoToDgiiDate(new Date().toISOString().slice(0, 10))} ${new Date().toISOString().slice(11, 19)}</FechaHoraAnulacioneNCF>`,
    '  </Encabezado>',
    '  <DetalleAnulacion>',
    rangesXml,
    '  </DetalleAnulacion>',
    '</ANECF>',
  ].join('\n');
}

function readXmlTag(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

export type XmlValidationResult = XsdValidationResult;

/**
 * Validates generated or received XML against official DGII e-CF W3C XSD schemas and Ley 32-23 rules.
 */
export function validateDgiiXmlStructure(
  xml: string,
  expectedType?: EcfTypeCode,
  options?: { allowSignature?: boolean }
): XmlValidationResult {
  return validateXmlAgainstDgiiXsd(xml, expectedType, {
    allowSignature: options?.allowSignature ?? true,
    enforceLey3223Rules: true,
  });
}

export interface ParsedSupplierEcf {
  ecfType: EcfTypeCode;
  eNCF: string;
  issuerRnc: string;
  issuerName: string;
  issuerAddress: string;
  issueDateIso: string;
  buyerRnc: string;
  buyerName: string;
  totalItbis: number;
  exemptAmount: number;
  taxableAmount: number;
  totalAmount: number;
  currency: 'DOP' | 'USD';
  hasXmlSignature: boolean;
  securityCode: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    lineSubtotal: number;
    itbisAmount: number;
  }>;
}

export function parseReceivedSupplierEcfXml(xml: string): ParsedSupplierEcf {
  const ecfType = (readXmlTag(xml, 'TipoeCF') || '31') as EcfTypeCode;
  const eNCF = (readXmlTag(xml, 'eNCF') || '').toUpperCase();
  const issuerRnc = cleanDigits(readXmlTag(xml, 'RNCEmisor') || '');
  const issuerName = readXmlTag(xml, 'RazonSocialEmisor') || 'Suplidor Emisor';
  const issuerAddress = readXmlTag(xml, 'DireccionEmisor') || 'República Dominicana';
  const issueDateIso = dgiiDateToIso(readXmlTag(xml, 'FechaEmision') || '') || new Date().toISOString().slice(0, 10);
  const buyerRnc = cleanDigits(readXmlTag(xml, 'RNCComprador') || '');
  const buyerName = readXmlTag(xml, 'RazonSocialComprador') || '';
  const totalItbis = round2(Number(readXmlTag(xml, 'TotalITBIS') || 0));
  const exemptAmount = round2(Number(readXmlTag(xml, 'MontoExento') || 0));
  const taxableAmount = round2(
    Number(readXmlTag(xml, 'MontoGravadoTotal') || readXmlTag(xml, 'MontoGravadoI1') || 0)
  );
  const totalAmount = round2(Number(readXmlTag(xml, 'MontoTotal') || 0));
  const currency = (readXmlTag(xml, 'TipoMoneda') === 'USD' ? 'USD' : 'DOP') as 'DOP' | 'USD';
  const sigVal = readXmlTag(xml, 'SignatureValue') || '';
  const hasXmlSignature = xml.includes('<Signature') && sigVal.length >= 6;
  const securityCode = sigVal.replace(/\s+/g, '').slice(0, 6);

  const itemBlocks = xml.match(/<Item>[\s\S]*?<\/Item>/gi) || [];
  const items = itemBlocks.map((block) => ({
    description: readXmlTag(block, 'NombreItem') || 'Bien / Servicio Facturado',
    quantity: Number(readXmlTag(block, 'CantidadItem') || 1),
    unitPrice: round2(Number(readXmlTag(block, 'PrecioUnitarioItem') || 0)),
    lineSubtotal: round2(Number(readXmlTag(block, 'MontoItem') || 0)),
    itbisAmount: round2(Number(readXmlTag(block, 'MontoITBIS') || 0)),
  }));

  return {
    ecfType: ECF_TYPE_META[ecfType] ? ecfType : '31',
    eNCF,
    issuerRnc,
    issuerName,
    issuerAddress,
    issueDateIso,
    buyerRnc,
    buyerName,
    totalItbis,
    exemptAmount,
    taxableAmount,
    totalAmount,
    currency,
    hasXmlSignature,
    securityCode,
    items,
  };
}
