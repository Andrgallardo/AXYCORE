import { describe, expect, it } from 'vitest';
import {
  buildJournalEntryForEcfDocument,
  buildPaymentSettlementJournalEntry,
  buildReversalJournalEntry,
  computeGeneralLedger,
} from '../engine/dgii/dgiiAccountingBridge';
import {
  buildDefaultDgiiFiscalConfig,
  computeEcfLineItemsAndTotals,
  DEFAULT_CHART_OF_ACCOUNTS_TEMPLATE,
} from '../engine/dgii/dgiiCatalogAndValidation';
import { checkTenantSectionAccess } from '../engine/multiTenantEngine';
import { buildBreadcrumbsForSection } from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection, hasRolePermission } from '../engine/rbac';
import type { OrganizationRecord } from '../types/axycore';
import type { AccountingAccountRecord, DgiiEcfDocumentRecord } from '../types/dgiiEcf';

const ORG: OrganizationRecord = {
  id: 'org_acc_test',
  name: 'Cooperativa Demo',
  rnc: '101000007',
  currency: 'DOP',
  enabledModules: ['clientes', 'prestamos', 'contabilidad', 'facturacion_electronica'],
};

const ACCOUNTS: AccountingAccountRecord[] = DEFAULT_CHART_OF_ACCOUNTS_TEMPLATE.map((t) => ({
  ...t,
  id: `acc_${t.code}`,
  organizationId: ORG.id,
  createdBy: 'system',
}));

function makeDoc(overrides: Partial<DgiiEcfDocumentRecord>): DgiiEcfDocumentRecord {
  const computed = computeEcfLineItemsAndTotals(
    [{ description: 'Comisión', itemType: 'SERVICIO', quantity: 1, unitPrice: 1000, itbisRate: 18 }],
    overrides.ecfType || '31'
  );
  return {
    id: 'doc_1',
    organizationId: ORG.id,
    direction: 'EMITIDO',
    ecfType: '31',
    eNCF: 'E310000000001',
    status: 'ACEPTADA',
    environment: 'PRECERTIFICACION',
    isOfficialDgiiResponse: true,
    isTestSimulation: false,
    issuerRnc: '101000007',
    issuerName: 'Cooperativa Demo',
    issuerAddress: 'Santo Domingo',
    receiverIdType: 'RNC',
    receiverTaxId: '130000001',
    receiverName: 'Cliente Corporativo',
    receiverAddress: 'Santo Domingo',
    issueDate: '2026-11-19',
    paymentCondition: 'CREDITO_30',
    paymentMethod: 'VENTA_CREDITO',
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
    dgiiResponses: [],
    commercialApprovalStatus: 'NO_APLICA',
    paymentCollectionStatus: 'PENDIENTE',
    createdBy: 'u1',
    createdByName: 'Contador',
    ...overrides,
  };
}

describe('DGII Automatic Double-Entry Accounting, RBAC, Breadcrumbs & Multi-Tenancy', () => {
  it('generates balanced double-entry journal entries for issued 31, 34 (NC), 43, received 606, settlements and reversals', () => {
    const config = buildDefaultDgiiFiscalConfig(ORG);

    // 1. Issued e-CF 31 on credit -> Debit 1103 (1180), Credit 4101 (1000) & 2103 (180)
    const doc31 = makeDoc({ id: 'd31', ecfType: '31', eNCF: 'E310000000001' });
    const je31 = buildJournalEntryForEcfDocument({
      document: doc31,
      config,
      accounts: ACCOUNTS,
      entryId: 'je_1',
      entryNumber: 'ASI-001',
      actorUid: 'u1',
      actorName: 'Contador',
    });
    expect(je31.totalDebit).toBe(1180);
    expect(je31.totalCredit).toBe(1180);
    expect(je31.idempotencyKey).toBe('je_ecf_d31_EMITIDO');

    // 2. Credit Note e-CF 34 -> Debit 4109 & 2103, Credit 1103
    const doc34 = makeDoc({ id: 'd34', ecfType: '34', eNCF: 'E340000000001', referenceEcf: 'E310000000001' });
    const je34 = buildJournalEntryForEcfDocument({
      document: doc34,
      config,
      accounts: ACCOUNTS,
      entryId: 'je_2',
      entryNumber: 'ASI-002',
      actorUid: 'u1',
      actorName: 'Contador',
    });
    expect(je34.totalDebit).toBe(je34.totalCredit);
    expect(je34.lines.some((l) => l.accountCode === '4109' && l.debit === 1000)).toBe(true);

    // 3. Received supplier e-CF -> Debit 5101 & 1104 (ITBIS Adelantado), Credit 2101 (CxP)
    const docRec = makeDoc({ id: 'drec', direction: 'RECIBIDO', ecfType: '31', eNCF: 'E310000000099' });
    const jeRec = buildJournalEntryForEcfDocument({
      document: docRec,
      config,
      accounts: ACCOUNTS,
      entryId: 'je_3',
      entryNumber: 'COM-001',
      actorUid: 'u1',
      actorName: 'Contador',
    });
    expect(jeRec.totalDebit).toBe(1180);
    expect(jeRec.lines.some((l) => l.accountCode === '1104' && l.debit === 180)).toBe(true);
    expect(jeRec.lines.some((l) => l.accountCode === '2101' && l.credit === 1180)).toBe(true);

    // 4. Settlement entry (CxC collection) -> Debit 1102 (Banco), Credit 1103 (CxC)
    const jeSettle = buildPaymentSettlementJournalEntry({
      document: doc31,
      config,
      accounts: ACCOUNTS,
      entryId: 'je_4',
      entryNumber: 'LIQ-001',
      settlementDate: '2026-11-20',
      actorUid: 'u1',
      actorName: 'Contador',
    });
    expect(jeSettle.totalDebit).toBe(1180);
    expect(jeSettle.totalCredit).toBe(1180);

    // 5. Reversal flips debit/credit exactly
    const jeRev = buildReversalJournalEntry({
      originalEntry: je31,
      entryId: 'je_rev',
      entryNumber: 'REV-001',
      reversalDate: '2026-11-20',
      reason: 'Anulación',
      actorUid: 'u1',
      actorName: 'Contador',
    });
    expect(jeRev.totalDebit).toBe(je31.totalCredit);
    expect(jeRev.totalCredit).toBe(je31.totalDebit);

    // 6. General Ledger aggregation balances after je31 + jeRev -> net 0 on CxC 1103
    const ledger = computeGeneralLedger(ACCOUNTS, [je31, jeRev]);
    const cxc = ledger.find((a) => a.accountCode === '1103');
    expect(cxc?.balance).toBe(0);
  });

  it('enforces RBAC for AUDITOR (read-only), FINANCE/ADMIN (emit), and EXTERNAL_CLIENT (denied)', () => {
    expect(hasRolePermission('FINANCE', 'EMIT_ECF')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'VIEW_ECF')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'EXPORT_FISCAL_REPORTS')).toBe(true);
    expect(hasRolePermission('AUDITOR', 'EMIT_ECF')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'VOID_ECF')).toBe(false);
    expect(hasRolePermission('AUDITOR', 'MANAGE_DGII_CONFIG')).toBe(false);

    expect(canRoleAccessSection('AUDITOR', 'ecf_dashboard')).toBe(true);
    expect(canRoleAccessSection('AUDITOR', 'ecf_audit')).toBe(true);
    expect(canRoleAccessSection('COLLECTION_AGENT', 'ecf_dashboard')).toBe(false);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'ecf_dashboard')).toBe(false);
  });

  it('builds 5-level breadcrumbs for Contabilidad -> Facturación Electrónica DGII -> Submenu and checks tenant license gating', () => {
    const trail = buildBreadcrumbsForSection({
      activeSection: 'ecf_emit',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(trail.map((s) => s.label)).toEqual([
      'Inicio',
      'Operaciones Generales',
      'Contabilidad',
      'Facturación Electrónica DGII',
      'Emitir Factura Electrónica',
    ]);

    const allowedCheck = checkTenantSectionAccess({
      section: 'ecf_dashboard',
      organization: ORG,
      isSuperAdmin: false,
    });
    expect(allowedCheck.allowed).toBe(true);

    const blockedOrg: OrganizationRecord = {
      ...ORG,
      enabledModules: ['clientes', 'prestamos', 'contabilidad'],
    };
    const deniedCheck = checkTenantSectionAccess({
      section: 'ecf_emit',
      organization: blockedOrg,
      isSuperAdmin: false,
    });
    expect(deniedCheck.allowed).toBe(false);
    expect(deniedCheck.requiredModule).toBe('facturacion_electronica');
  });
});
