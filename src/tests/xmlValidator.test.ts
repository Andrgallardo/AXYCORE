import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDefaultDgiiFiscalConfig,
  computeEcfLineItemsAndTotals,
  formatEncf,
} from '../engine/dgii/dgiiCatalogAndValidation';
import {
  buildDgiiAcecfXml,
  buildDgiiAnecfXml,
  buildDgiiArecfXml,
  buildDgiiEcfXml,
  buildDgiiRfceXml,
} from '../engine/dgii/dgiiXmlEngine';
import {
  listLoadedDgiiXsdSchemas,
  loadDgiiXsdSchema,
  registerDgiiXsdSchema,
  validateEcfBeforeDigitalSignature,
  validateXmlAgainstDgiiXsd,
  type DgiiSchemaDocumentKind,
} from '../engine/dgii/xmlValidator';
import {
  ALL_ECF_TYPES,
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type EcfTypeCode,
} from '../types/dgiiEcf';
import type { OrganizationRecord } from '../types/axycore';

const ORG: OrganizationRecord = {
  id: 'org_xsd_test',
  name: 'AxyCore Financiera RD S.R.L.',
  legalName: 'AxyCore Financiera RD S.R.L.',
  rnc: '101000007',
  address: 'Av. Abraham Lincoln 450, Santo Domingo',
  currency: 'DOP',
};

function makeSampleDoc(code: EcfTypeCode, overrides?: Partial<DgiiEcfDocumentRecord>): DgiiEcfDocumentRecord {
  const meta = ECF_TYPE_META[code];
  const computed = computeEcfLineItemsAndTotals(
    [
      {
        description: `Operación Fiscal e-CF ${code}`,
        itemType: 'SERVICIO',
        quantity: 1,
        unitPrice: 1000,
        itbisRate: meta.allowsItbis ? 18 : 0,
        isExempt: !meta.allowsItbis,
      },
    ],
    code
  );
  return {
    id: `doc_xsd_${code}`,
    organizationId: ORG.id,
    direction: 'EMITIDO',
    ecfType: code,
    eNCF: formatEncf(code, 25),
    status: 'PENDIENTE_FIRMA',
    environment: 'PRECERTIFICACION',
    isOfficialDgiiResponse: false,
    isTestSimulation: false,
    issuerRnc: ORG.rnc!,
    issuerName: ORG.legalName!,
    issuerAddress: ORG.address!,
    receiverIdType: meta.requiresBuyerRnc ? 'RNC' : 'CEDULA',
    receiverTaxId: meta.requiresBuyerRnc ? '130000001' : '00100000009',
    receiverName: 'Cliente Corporativo Validado S.R.L.',
    receiverAddress: 'Santo Domingo, RD',
    issueDate: '2026-11-19',
    paymentCondition: 'CONTADO',
    paymentMethod: 'CHEQUE_TRANSFERENCIA',
    currency: 'DOP',
    exchangeRate: 1,
    items: computed.items,
    subtotal: computed.subtotal,
    totalDiscount: computed.totalDiscount,
    exemptAmount: computed.exemptAmount,
    taxableAmount18: computed.taxableAmount18,
    taxableAmount16: computed.taxableAmount16,
    totalItbis: computed.totalItbis,
    otherTaxesTotal: computed.otherTaxesTotal,
    totalAmount: computed.totalAmount,
    referenceEcf: code === '33' || code === '34' ? 'E310000000001' : undefined,
    referenceDate: code === '33' || code === '34' ? '2026-11-18' : undefined,
    modificationCode: code === '33' ? '3' : code === '34' ? '1' : undefined,
    dgiiResponses: [],
    commercialApprovalStatus: 'NO_APLICA',
    paymentCollectionStatus: 'NO_APLICA',
    createdBy: 'tester',
    createdByName: 'Tester',
    ...overrides,
  };
}

describe('DGII Official XSD Loader & Pre-Signature XML Validator (Ley 32-23)', () => {
  it('loads and compiles all 14 official DGII XSD files from public/dgii-xsd on disk', () => {
    const schemas = listLoadedDgiiXsdSchemas();
    expect(schemas).toHaveLength(14);

    const xsdDir = path.resolve(process.cwd(), 'public', 'dgii-xsd');
    expect(fs.existsSync(xsdDir)).toBe(true);

    for (const meta of schemas) {
      const filePath = path.join(xsdDir, meta.fileName);
      expect(fs.existsSync(filePath)).toBe(true);
      const xsdText = fs.readFileSync(filePath, 'utf8');
      const registered = registerDgiiXsdSchema(meta.kind as DgiiSchemaDocumentKind, xsdText);
      expect(registered.source).toBe('REGISTERED_RUNTIME');
      expect(registered.totalElementDefinitions).toBeGreaterThan(5);
      expect(loadDgiiXsdSchema(meta.kind).metadata.fileName).toBe(meta.fileName);
    }
  });

  it('validates pre-signature compliance for ALL 10 e-CF types and 4 auxiliary DGII formats (RFCE, ACECF, ARECF, ANECF)', () => {
    const config = buildDefaultDgiiFiscalConfig(ORG);
    config.enabledEcfTypes = [...ALL_ECF_TYPES];

    for (const code of ALL_ECF_TYPES) {
      const doc = makeSampleDoc(code);
      const xml = buildDgiiEcfXml({ document: doc, config });
      const res = validateEcfBeforeDigitalSignature(xml, code);
      expect(res.valid, `Errores en tipo ${code}: ${res.errors.join(' | ')}`).toBe(true);
      expect(res.schemaFileName).toBe(`e-CF_${code}_v.1.0.xsd`);
      expect(res.checksExecuted.length).toBeGreaterThanOrEqual(4);
    }

    const doc32 = makeSampleDoc('32');
    const rfceXml = buildDgiiRfceXml({ document: doc32, config, securityCode: 'A1B2C3' });
    expect(validateEcfBeforeDigitalSignature(rfceXml, 'RFCE').valid).toBe(true);

    const acecfXml = buildDgiiAcecfXml({
      issuerRnc: '101000007',
      eNCF: 'E310000000001',
      issueDate: '2026-11-19',
      totalAmount: 1180,
      buyerRnc: '130000001',
      status: '1',
    });
    expect(validateEcfBeforeDigitalSignature(acecfXml, 'ACECF').valid).toBe(true);

    const arecfXml = buildDgiiArecfXml({
      issuerRnc: '101000007',
      buyerRnc: '130000001',
      eNCF: 'E310000000001',
      accepted: true,
    });
    expect(validateEcfBeforeDigitalSignature(arecfXml, 'ARECF').valid).toBe(true);

    const anecfXml = buildDgiiAnecfXml({
      issuerRnc: '101000007',
      ranges: [{ ecfType: '31', fromEncf: 'E310000000001', toEncf: 'E310000000010', quantity: 10 }],
    });
    expect(validateEcfBeforeDigitalSignature(anecfXml, 'ANECF').valid).toBe(true);
  });

  it('rejects malformed XML syntax, out-of-order XSD sequence elements, unknown tags, and invalid facets', () => {
    const config = buildDefaultDgiiFiscalConfig(ORG);
    const validXml31 = buildDgiiEcfXml({ document: makeSampleDoc('31'), config });

    // 1. Malformed XML
    const broken = validateEcfBeforeDigitalSignature('<ECF><Encabezado></ECF>', '31');
    expect(broken.valid).toBe(false);
    expect(broken.issues.some((i) => i.ruleSource === 'XML_SYNTAX')).toBe(true);

    // 2. Out-of-order XSD <xs:sequence> (<Emisor> before <IdDoc>)
    const reordered = validXml31.replace(
      /(<IdDoc>[\s\S]*?<\/IdDoc>)\s*(<Emisor>[\s\S]*?<\/Emisor>)/,
      '$2\n$1'
    );
    const seqRes = validateEcfBeforeDigitalSignature(reordered, '31');
    expect(seqRes.valid).toBe(false);
    expect(seqRes.issues.some((i) => i.code === 'XSD_SEQUENCE_ORDER' || i.code === 'XSD_UNEXPECTED_ELEMENT')).toBe(true);

    // 3. Unknown XML element
    const unknownTag = validXml31.replace('</IdDoc>', '  <CampoInventado>ABC</CampoInventado>\n    </IdDoc>');
    const unknownRes = validateEcfBeforeDigitalSignature(unknownTag, '31');
    expect(unknownRes.valid).toBe(false);
    expect(unknownRes.issues.some((i) => i.code === 'XSD_UNEXPECTED_ELEMENT')).toBe(true);

    // 4. Invalid FechaEmision format (ISO YYYY-MM-DD instead of DD-MM-AAAA)
    const badDate = validXml31.replace(/<FechaEmision>[^<]+<\/FechaEmision>/, '<FechaEmision>2026-11-19</FechaEmision>');
    const badDateRes = validateEcfBeforeDigitalSignature(badDate, '31');
    expect(badDateRes.valid).toBe(false);
    expect(badDateRes.issues.some((i) => i.code === 'XSD_FACET_PATTERN')).toBe(true);

    // 5. Missing InformacionReferencia on Nota de Crédito (34)
    const xml34 = buildDgiiEcfXml({ document: makeSampleDoc('34'), config });
    const xml34NoRef = xml34.replace(/<InformacionReferencia>[\s\S]*?<\/InformacionReferencia>/, '');
    const res34NoRef = validateEcfBeforeDigitalSignature(xml34NoRef, '34');
    expect(res34NoRef.valid).toBe(false);
    expect(res34NoRef.issues.some((i) => i.code === 'XSD_MISSING_REQUIRED_ELEMENT')).toBe(true);
  });

  it('enforces Ley 32-23 cross-field rules and rejects already-signed XML prior to signature', () => {
    const config = buildDefaultDgiiFiscalConfig(ORG);

    // 1. Pre-signature validator rejects XML that already contains <Signature>
    const valid31 = buildDgiiEcfXml({ document: makeSampleDoc('31'), config });
    const fakeSigned31 = valid31.replace('</ECF>', '  <Signature><SignatureValue>ABCDEF</SignatureValue></Signature>\n</ECF>');
    const preSignAlreadySigned = validateEcfBeforeDigitalSignature(fakeSigned31, '31');
    expect(preSignAlreadySigned.valid).toBe(false);
    expect(preSignAlreadySigned.issues.some((i) => i.code === 'PRE_SIGN_ALREADY_SIGNED')).toBe(true);

    // While allowSignature: true permits validating already-signed supplier XMLs
    const postSignCheck = validateXmlAgainstDgiiXsd(fakeSigned31, '31', { allowSignature: true });
    expect(postSignCheck.valid).toBe(true);

    // 2. Invalid DGII Mod-11 RNC check digit rejected
    const badRncXml = valid31.replace('<RNCEmisor>101000007</RNCEmisor>', '<RNCEmisor>101000009</RNCEmisor>');
    const badRncRes = validateEcfBeforeDigitalSignature(badRncXml, '31');
    expect(badRncRes.valid).toBe(false);
    expect(badRncRes.issues.some((i) => i.code === 'LEY3223_INVALID_ISSUER_RNC')).toBe(true);

    // 3. E32 >= 250,000 without buyer tax ID rejected
    const highE32 = makeSampleDoc('32', {
      receiverIdType: 'SIN_ID',
      receiverTaxId: '',
      receiverName: 'CONSUMIDOR FINAL',
      subtotal: 260000,
      taxableAmount18: 260000,
      totalItbis: 46800,
      totalAmount: 306800,
      items: [
        {
          lineNumber: 1,
          description: 'Equipo Industrial',
          itemType: 'BIEN',
          quantity: 1,
          unitOfMeasure: 'UND',
          unitPrice: 260000,
          discountAmount: 0,
          itbisRate: 18,
          isExempt: false,
          itbisAmount: 46800,
          otherTaxCode: 'NINGUNO',
          otherTaxRatePct: 0,
          otherTaxAmount: 0,
          lineSubtotal: 260000,
          lineTotal: 306800,
        },
      ],
    });
    const highE32Xml = buildDgiiEcfXml({ document: highE32, config });
    const highE32Res = validateEcfBeforeDigitalSignature(highE32Xml, '32');
    expect(highE32Res.valid).toBe(false);
    expect(highE32Res.issues.some((i) => i.code === 'LEY3223_E32_THRESHOLD_ID')).toBe(true);

    // 4. Arithmetic total mismatch rejected
    const tamperedTotalXml = valid31.replace('<MontoTotal>1180.00</MontoTotal>', '<MontoTotal>9999.00</MontoTotal>');
    const tamperedRes = validateEcfBeforeDigitalSignature(tamperedTotalXml, '31');
    expect(tamperedRes.valid).toBe(false);
    expect(tamperedRes.issues.some((i) => i.code === 'LEY3223_TOTAL_MISMATCH')).toBe(true);

    // 5. Special exempt regime (e-CF 44) with positive ITBIS rejected
    const doc44 = makeSampleDoc('44');
    const xml44BadItbis = buildDgiiEcfXml({ document: doc44, config })
      .replace('<MontoTotal>1000.00</MontoTotal>', '<TotalITBIS>180.00</TotalITBIS>\n      <MontoTotal>1180.00</MontoTotal>')
      .replace('<MontoItem>1000.00</MontoItem>', '<MontoItem>1000.00</MontoItem>\n      <MontoITBIS>180.00</MontoITBIS>');
    const res44 = validateEcfBeforeDigitalSignature(xml44BadItbis, '44');
    expect(res44.valid).toBe(false);
    expect(res44.issues.some((i) => i.code === 'LEY3223_DISALLOWED_ITBIS')).toBe(true);
  });
});
