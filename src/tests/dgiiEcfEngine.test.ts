import { describe, expect, it } from 'vitest';
import {
  buildDefaultDgiiFiscalConfig,
  computeEcfLineItemsAndTotals,
  formatEncf,
  validateDominicanCedula,
  validateDominicanRnc,
  validateEcfBeforeIssuance,
} from '../engine/dgii/dgiiCatalogAndValidation';
import {
  buildDgiiAcecfXml,
  buildDgiiAnecfXml,
  buildDgiiArecfXml,
  buildDgiiEcfXml,
  buildDgiiRfceXml,
  parseReceivedSupplierEcfXml,
  validateDgiiXmlStructure,
} from '../engine/dgii/dgiiXmlEngine';
import { buildFormato606Rows, buildFormato607Rows } from '../engine/dgii/dgiiReportsEngine';
import {
  ALL_ECF_TYPES,
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type DgiiEncfSequenceRecord,
  type EcfTypeCode,
} from '../types/dgiiEcf';
import type { OrganizationRecord } from '../types/axycore';

const TEST_ORG: OrganizationRecord = {
  id: 'org_test_dgii',
  name: 'Financiera Prueba RD S.R.L.',
  legalName: 'Financiera Prueba RD S.R.L.',
  rnc: '101000007',
  address: 'Av. Winston Churchill 101, Santo Domingo',
  currency: 'DOP',
};

function makeSequence(ecfType: EcfTypeCode): DgiiEncfSequenceRecord {
  return {
    id: `seq_${ecfType}`,
    organizationId: TEST_ORG.id,
    ecfType,
    prefix: `E${ecfType}`,
    authorizationNumber: `AUT-${ecfType}-001`,
    authDate: '2026-01-01',
    expiryDate: '2027-12-31',
    startSequence: 1,
    endSequence: 100,
    lastUsedSequence: 0,
    status: 'ACTIVA',
    createdBy: 'tester',
  };
}

describe('DGII Ley 32-23 Validation, Tax Calculation & XML/XSD Engine', () => {
  it('validates Dominican RNC (Mod-11) and Cédula (Mod-10) check digits accurately', () => {
    expect(validateDominicanRnc('101000007').valid).toBe(true);
    expect(validateDominicanRnc('130-00000-1').valid).toBe(true);
    expect(validateDominicanRnc('101000009').valid).toBe(false);
    expect(validateDominicanRnc('111111111').valid).toBe(false);

    expect(validateDominicanCedula('001-0000000-9').valid).toBe(true);
    expect(validateDominicanCedula('00100000001').valid).toBe(false);

    expect(formatEncf('31', 42)).toBe('E310000000042');
  });

  it('computes ITBIS 18%, 16%, exempt items, discounts and other taxes accurately', () => {
    const totals = computeEcfLineItemsAndTotals(
      [
        {
          description: 'Servicio Consultoría',
          itemType: 'SERVICIO',
          quantity: 2,
          unitPrice: 1000,
          discountAmount: 200,
          itbisRate: 18,
          otherTaxCode: 'PROPINA_LEGAL',
          otherTaxRatePct: 10,
        },
        {
          description: 'Café Exportación',
          itemType: 'BIEN',
          quantity: 1,
          unitPrice: 500,
          itbisRate: 16,
        },
        {
          description: 'Servicio Exento',
          itemType: 'SERVICIO',
          quantity: 1,
          unitPrice: 300,
          itbisRate: 0,
          isExempt: true,
        },
      ],
      '31'
    );

    expect(totals.subtotal).toBe(2800);
    expect(totals.totalDiscount).toBe(200);
    expect(totals.taxableAmount18).toBe(1800);
    expect(totals.taxableAmount16).toBe(500);
    expect(totals.exemptAmount).toBe(300);
    expect(totals.totalItbis).toBe(404); // 1800*0.18 (324) + 500*0.16 (80)
    expect(totals.otherTaxesTotal).toBe(180); // 1800*0.10
    expect(totals.totalAmount).toBe(3184); // 2600 + 404 + 180
  });

  it('enforces entitlement, E32 >= 250k buyer ID, NC/ND reference, and PRODUCCION certification lock', () => {
    const config = buildDefaultDgiiFiscalConfig(TEST_ORG);
    config.enabledEcfTypes = ['31', '32', '33', '34'];

    const computed31 = computeEcfLineItemsAndTotals(
      [{ description: 'Cargo', itemType: 'SERVICIO', quantity: 1, unitPrice: 1000, itbisRate: 18 }],
      '31'
    );

    // 1. Disabled e-CF type (46) must be blocked
    const blockedType = validateEcfBeforeIssuance({
      config,
      ecfType: '46',
      issueDate: '2026-11-19',
      receiverIdType: 'SIN_ID',
      receiverTaxId: '',
      receiverName: 'Cliente Exterior',
      items: computed31.items,
      totalAmount: 1000,
      currency: 'USD',
      sequences: [makeSequence('46')],
    });
    expect(blockedType.valid).toBe(false);
    expect(blockedType.errors.some((e) => e.includes('no tiene habilitado'))).toBe(true);

    // 2. E32 >= 250,000 without buyer ID must fail
    const e32High = validateEcfBeforeIssuance({
      config,
      ecfType: '32',
      issueDate: '2026-11-19',
      receiverIdType: 'SIN_ID',
      receiverTaxId: '',
      receiverName: 'CONSUMIDOR FINAL',
      items: computed31.items,
      totalAmount: 260000,
      currency: 'DOP',
      sequences: [makeSequence('32')],
    });
    expect(e32High.valid).toBe(false);
    expect(e32High.errors.some((e) => e.includes('250,000'))).toBe(true);

    // 3. NC (34) without reference NCF must fail
    const ncMissingRef = validateEcfBeforeIssuance({
      config,
      ecfType: '34',
      issueDate: '2026-11-19',
      receiverIdType: 'RNC',
      receiverTaxId: '130000001',
      receiverName: 'Cliente S.A.',
      items: computed31.items,
      totalAmount: 1180,
      currency: 'DOP',
      sequences: [makeSequence('34')],
    });
    expect(ncMissingRef.valid).toBe(false);
    expect(ncMissingRef.errors.some((e) => e.includes('referencia'))).toBe(true);

    // 4. PRODUCCION blocked unless isCertifiedByDgii === true
    const prodBlocked = validateEcfBeforeIssuance({
      config: { ...config, environment: 'PRODUCCION', isCertifiedByDgii: false },
      ecfType: '31',
      issueDate: '2026-11-19',
      receiverIdType: 'RNC',
      receiverTaxId: '130000001',
      receiverName: 'Cliente S.A.',
      items: computed31.items,
      totalAmount: 1180,
      currency: 'DOP',
      sequences: [makeSequence('31')],
    });
    expect(prodBlocked.valid).toBe(false);
    expect(prodBlocked.errors.some((e) => e.includes('Bloqueo de seguridad fiscal'))).toBe(true);
  });

  it('builds and validates XSD structure for ALL 10 e-CF types (31,32,33,34,41,43,44,45,46,47)', () => {
    const config = buildDefaultDgiiFiscalConfig(TEST_ORG);
    config.enabledEcfTypes = [...ALL_ECF_TYPES];

    for (const code of ALL_ECF_TYPES) {
      const meta = ECF_TYPE_META[code];
      const computed = computeEcfLineItemsAndTotals(
        [{ description: `Prueba Tipo ${code}`, itemType: 'SERVICIO', quantity: 1, unitPrice: 1000, itbisRate: 18 }],
        code
      );
      const doc: DgiiEcfDocumentRecord = {
        id: `doc_${code}`,
        organizationId: TEST_ORG.id,
        direction: 'EMITIDO',
        ecfType: code,
        eNCF: formatEncf(code, 5),
        status: 'FIRMADA',
        environment: 'PRECERTIFICACION',
        isOfficialDgiiResponse: false,
        isTestSimulation: false,
        issuerRnc: TEST_ORG.rnc!,
        issuerName: TEST_ORG.legalName!,
        issuerAddress: TEST_ORG.address!,
        receiverIdType: meta.requiresBuyerRnc ? 'RNC' : 'CEDULA',
        receiverTaxId: meta.requiresBuyerRnc ? '130000001' : '00100000009',
        receiverName: 'Receptor Validado S.R.L.',
        receiverAddress: 'Santo Domingo',
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
      };

      const xml = buildDgiiEcfXml({ document: doc, config });
      const validation = validateDgiiXmlStructure(xml, code);
      expect(validation.valid).toBe(true);
      expect(xml).toContain(`<TipoeCF>${code}</TipoeCF>`);
      expect(xml).toContain(`<eNCF>${formatEncf(code, 5)}</eNCF>`);
    }
  });

  it('generates RFCE, ACECF, ARECF, ANECF XMLs, parses received XML, and builds 606/607 reports', () => {
    const config = buildDefaultDgiiFiscalConfig(TEST_ORG);
    const computed = computeEcfLineItemsAndTotals(
      [{ description: 'Comisión Financiera', itemType: 'SERVICIO', quantity: 1, unitPrice: 2000, itbisRate: 18 }],
      '31'
    );
    const sampleDoc: DgiiEcfDocumentRecord = {
      id: 'doc_parse_test',
      organizationId: TEST_ORG.id,
      direction: 'EMITIDO',
      ecfType: '31',
      eNCF: 'E310000000010',
      status: 'ACEPTADA',
      environment: 'PRECERTIFICACION',
      isOfficialDgiiResponse: true,
      isTestSimulation: false,
      issuerRnc: '101000007',
      issuerName: 'Suplidor Demo',
      issuerAddress: 'Santo Domingo',
      receiverIdType: 'RNC',
      receiverTaxId: '130000001',
      receiverName: 'Cliente Demo',
      receiverAddress: 'Santiago',
      issueDate: '2026-11-19',
      paymentCondition: 'CREDITO_30',
      paymentMethod: 'VENTA_CREDITO',
      currency: 'DOP',
      exchangeRate: 1,
      items: computed.items,
      subtotal: computed.subtotal,
      totalDiscount: 0,
      exemptAmount: 0,
      taxableAmount18: 2000,
      taxableAmount16: 0,
      totalItbis: 360,
      otherTaxesTotal: 0,
      totalAmount: 2360,
      dgiiResponses: [],
      commercialApprovalStatus: 'NO_APLICA',
      paymentCollectionStatus: 'PENDIENTE',
      createdBy: 'u1',
      createdByName: 'User',
    };

    const xml = buildDgiiEcfXml({ document: sampleDoc, config });
    const parsed = parseReceivedSupplierEcfXml(xml);
    expect(parsed.eNCF).toBe('E310000000010');
    expect(parsed.totalItbis).toBe(360);
    expect(parsed.totalAmount).toBe(2360);

    expect(buildDgiiRfceXml({ document: { ...sampleDoc, ecfType: '32', eNCF: 'E320000000001' }, config, securityCode: 'ABC123' })).toContain('<RFCE>');
    expect(buildDgiiAcecfXml({ issuerRnc: '101000007', eNCF: 'E310000000010', issueDate: '2026-11-19', totalAmount: 2360, buyerRnc: '130000001', status: '1' })).toContain('<ACECF>');
    expect(buildDgiiArecfXml({ issuerRnc: '101000007', buyerRnc: '130000001', eNCF: 'E310000000010', accepted: true })).toContain('<ARECF>');
    expect(buildDgiiAnecfXml({ issuerRnc: '101000007', ranges: [{ ecfType: '31', fromEncf: 'E310000000011', toEncf: 'E310000000020', quantity: 10 }] })).toContain('<ANECF>');

    const rows607 = buildFormato607Rows([sampleDoc], '2026-11');
    expect(rows607).toHaveLength(1);
    expect(rows607[0].itbisFacturado).toBe(360);

    const receivedDoc: DgiiEcfDocumentRecord = { ...sampleDoc, id: 'doc_rec_1', direction: 'RECIBIDO' };
    const rows606 = buildFormato606Rows([receivedDoc], '2026-11');
    expect(rows606).toHaveLength(1);
    expect(rows606[0].montoFacturadoServicios).toBe(2000);
  });
});
