import {
  ECF_TYPE_META,
  type AccountingAccountRecord,
  type DgiiEcfDocumentRecord,
  type DgiiFiscalConfigRecord,
  type JournalEntryLine,
  type JournalEntryRecord,
  type JournalEntrySourceType,
} from '../../types/dgiiEcf';
import { round2 } from './dgiiCatalogAndValidation';

function resolveAccount(
  accounts: AccountingAccountRecord[],
  code: string,
  fallbackName: string
): { accountId: string; accountCode: string; accountName: string } {
  const found = accounts.find((a) => a.code === code);
  if (found) {
    return {
      accountId: found.id,
      accountCode: found.code,
      accountName: found.name,
    };
  }
  return {
    accountId: `acc_virtual_${code}`,
    accountCode: code,
    accountName: fallbackName,
  };
}

/**
 * Generates an immutable, strictly balanced double-entry Journal Entry from an e-CF document.
 * Prevents double posting via deterministic `idempotencyKey`.
 */
export function buildJournalEntryForEcfDocument(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  accounts: AccountingAccountRecord[];
  entryId: string;
  entryNumber: string;
  actorUid: string;
  actorName: string;
}): JournalEntryRecord {
  const { document: doc, config, accounts, entryId, entryNumber, actorUid, actorName } = params;
  const mapping = config.accountMapping;
  const meta = ECF_TYPE_META[doc.ecfType];
  const lines: JournalEntryLine[] = [];

  const netSubtotal = round2(doc.subtotal - doc.totalDiscount);
  const itbisTotal = round2(doc.totalItbis);
  const otherTaxes = round2(doc.otherTaxesTotal);
  const totalAmount = round2(doc.totalAmount);

  const debitSettlementAcct =
    doc.paymentCondition === 'CONTADO'
      ? resolveAccount(accounts, mapping.cashOrBankAccountCode, 'Bancos y Cuentas Corrientes')
      : resolveAccount(accounts, mapping.receivablesAccountCode, 'Cuentas por Cobrar Facturación');

  const payableOrCashAcct =
    doc.paymentCondition === 'CONTADO'
      ? resolveAccount(accounts, mapping.cashOrBankAccountCode, 'Bancos y Cuentas Corrientes')
      : resolveAccount(accounts, mapping.payablesAccountCode, 'Cuentas por Pagar Proveedores');

  const itbisPayableAcct = resolveAccount(accounts, mapping.itbisPayableAccountCode, 'ITBIS por Pagar (DGII)');
  const itbisCreditableAcct = resolveAccount(accounts, mapping.itbisCreditableAccountCode, 'ITBIS Adelantado');
  const otherTaxAcct = resolveAccount(accounts, mapping.otherTaxesPayableAccountCode, 'Otros Impuestos por Pagar');
  const salesAcct = resolveAccount(accounts, mapping.salesRevenueAccountCode, 'Ingresos por Servicios y Ventas');
  const returnsAcct = resolveAccount(accounts, mapping.creditNoteReturnsAccountCode, 'Devoluciones y NC sobre Ventas');
  const purchasesAcct = resolveAccount(
    accounts,
    doc.ecfType === '43' ? mapping.minorExpensesAccountCode : mapping.purchasesExpenseAccountCode,
    doc.ecfType === '43' ? 'Gastos Menores' : 'Compras de Bienes y Servicios'
  );

  let sourceType: JournalEntrySourceType = 'ECF_EMITIDO';

  if (doc.direction === 'RECIBIDO' || meta.isPurchaseOrExpense) {
    sourceType = 'ECF_RECIBIDO';
    // Debit expense/cost + ITBIS adelantado; Credit CxP / Banco (+ Withholding if e-CF 47)
    lines.push({
      ...purchasesAcct,
      debit: netSubtotal,
      credit: 0,
      memo: `${meta.shortName} ${doc.eNCF} · Base compras/gastos`,
    });
    if (itbisTotal > 0) {
      lines.push({
        ...itbisCreditableAcct,
        debit: itbisTotal,
        credit: 0,
        memo: `ITBIS acreditable 606 · ${doc.eNCF}`,
      });
    }
    if (otherTaxes > 0) {
      lines.push({
        ...purchasesAcct,
        debit: otherTaxes,
        credit: 0,
        memo: `Otros impuestos incluidos · ${doc.eNCF}`,
      });
    }
    lines.push({
      ...payableOrCashAcct,
      debit: 0,
      credit: totalAmount,
      memo: `${doc.paymentCondition === 'CONTADO' ? 'Desembolso inmediato' : 'CxP'} · ${doc.receiverName || doc.issuerName}`,
    });
  } else if (doc.ecfType === '34') {
    sourceType = 'ECF_NOTA_CREDITO';
    // Nota de Crédito: Débito Devoluciones + Débito ITBIS por Pagar / Crédito CxC o Banco
    lines.push({
      ...returnsAcct,
      debit: netSubtotal,
      credit: 0,
      memo: `Nota de Crédito ${doc.eNCF} (Ref ${doc.referenceEcf || '—'})`,
    });
    if (itbisTotal > 0) {
      lines.push({
        ...itbisPayableAcct,
        debit: itbisTotal,
        credit: 0,
        memo: `Reversión ITBIS débito fiscal · ${doc.eNCF}`,
      });
    }
    if (otherTaxes > 0) {
      lines.push({
        ...otherTaxAcct,
        debit: otherTaxes,
        credit: 0,
        memo: `Reversión otros impuestos · ${doc.eNCF}`,
      });
    }
    lines.push({
      ...debitSettlementAcct,
      debit: 0,
      credit: totalAmount,
      memo: `Aplicación a favor de ${doc.receiverName}`,
    });
  } else {
    // 31, 32, 33, 44, 45, 46
    sourceType = doc.ecfType === '33' ? 'ECF_NOTA_DEBITO' : 'ECF_EMITIDO';
    lines.push({
      ...debitSettlementAcct,
      debit: totalAmount,
      credit: 0,
      memo: `${meta.shortName} ${doc.eNCF} · ${doc.receiverName}`,
    });
    lines.push({
      ...salesAcct,
      debit: 0,
      credit: netSubtotal,
      memo: `Ingreso facturado ${doc.eNCF}`,
    });
    if (itbisTotal > 0) {
      lines.push({
        ...itbisPayableAcct,
        debit: 0,
        credit: itbisTotal,
        memo: `ITBIS facturado 607 · ${doc.eNCF}`,
      });
    }
    if (otherTaxes > 0) {
      lines.push({
        ...otherTaxAcct,
        debit: 0,
        credit: otherTaxes,
        memo: `Otros impuestos facturados · ${doc.eNCF}`,
      });
    }
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));

  return {
    id: entryId,
    organizationId: doc.organizationId,
    entryNumber,
    entryDate: doc.issueDate,
    sourceType,
    sourceId: doc.id,
    idempotencyKey: `je_ecf_${doc.id}_${doc.direction}`,
    currency: doc.currency,
    description: `${meta.shortName} ${doc.eNCF} · ${doc.direction === 'EMITIDO' ? doc.receiverName : doc.issuerName}`,
    referenceDoc: doc.eNCF,
    lines,
    totalDebit,
    totalCredit,
    status: 'CONTABILIZADO',
    createdBy: actorUid,
    createdByName: actorName,
  };
}

export function buildPaymentSettlementJournalEntry(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  accounts: AccountingAccountRecord[];
  entryId: string;
  entryNumber: string;
  settlementDate: string;
  actorUid: string;
  actorName: string;
}): JournalEntryRecord {
  const { document: doc, config, accounts, entryId, entryNumber, settlementDate, actorUid, actorName } = params;
  const mapping = config.accountMapping;
  const isPayable = doc.direction === 'RECIBIDO' || ECF_TYPE_META[doc.ecfType].isPurchaseOrExpense;

  const bankAcct = resolveAccount(accounts, mapping.cashOrBankAccountCode, 'Bancos y Cuentas Corrientes');
  const arAcct = resolveAccount(accounts, mapping.receivablesAccountCode, 'Cuentas por Cobrar');
  const apAcct = resolveAccount(accounts, mapping.payablesAccountCode, 'Cuentas por Pagar Proveedores');

  const lines: JournalEntryLine[] = isPayable
    ? [
        { ...apAcct, debit: round2(doc.totalAmount), credit: 0, memo: `Cancelación CxP ${doc.eNCF}` },
        { ...bankAcct, debit: 0, credit: round2(doc.totalAmount), memo: `Pago a suplidor ${doc.issuerName}` },
      ]
    : [
        { ...bankAcct, debit: round2(doc.totalAmount), credit: 0, memo: `Cobro recibido ${doc.eNCF}` },
        { ...arAcct, debit: 0, credit: round2(doc.totalAmount), memo: `Liquidación CxC ${doc.receiverName}` },
      ];

  return {
    id: entryId,
    organizationId: doc.organizationId,
    entryNumber,
    entryDate: settlementDate,
    sourceType: isPayable ? 'PAGO_PROVEEDOR' : 'COBRO_FACTURA',
    sourceId: doc.id,
    idempotencyKey: `je_settle_${doc.id}`,
    currency: doc.currency,
    description: `${isPayable ? 'Pago a Proveedor' : 'Cobro de Factura'} ${doc.eNCF}`,
    referenceDoc: doc.eNCF,
    lines,
    totalDebit: round2(doc.totalAmount),
    totalCredit: round2(doc.totalAmount),
    status: 'CONTABILIZADO',
    createdBy: actorUid,
    createdByName: actorName,
  };
}

export function buildReversalJournalEntry(params: {
  originalEntry: JournalEntryRecord;
  entryId: string;
  entryNumber: string;
  reversalDate: string;
  reason: string;
  actorUid: string;
  actorName: string;
}): JournalEntryRecord {
  const { originalEntry, entryId, entryNumber, reversalDate, reason, actorUid, actorName } = params;
  const lines: JournalEntryLine[] = originalEntry.lines.map((l) => ({
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    debit: l.credit,
    credit: l.debit,
    memo: `Reverso (${originalEntry.entryNumber}): ${reason}`,
  }));

  return {
    id: entryId,
    organizationId: originalEntry.organizationId,
    entryNumber,
    entryDate: reversalDate,
    sourceType: 'REVERSO',
    sourceId: originalEntry.id,
    idempotencyKey: `je_rev_${originalEntry.id}`,
    currency: originalEntry.currency,
    description: `Reverso de ${originalEntry.entryNumber} · ${reason}`,
    referenceDoc: originalEntry.referenceDoc,
    lines,
    totalDebit: originalEntry.totalCredit,
    totalCredit: originalEntry.totalDebit,
    status: 'CONTABILIZADO',
    reversedEntryId: originalEntry.id,
    createdBy: actorUid,
    createdByName: actorName,
  };
}

export interface GeneralLedgerAccountSummary {
  accountCode: string;
  accountName: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number; // positive = normal balance side or debit-credit net
  movements: Array<{
    entryId: string;
    entryNumber: string;
    entryDate: string;
    description: string;
    debit: number;
    credit: number;
    runningNet: number;
  }>;
}

function inferAccountTypeFromCode(code: string): {
  accountType: string;
  normalBalance: 'DEBITO' | 'CREDITO';
} {
  const c = (code || '').trim();
  if (c.startsWith('1')) return { accountType: 'ACTIVO', normalBalance: 'DEBITO' };
  if (c.startsWith('2')) return { accountType: 'PASIVO', normalBalance: 'CREDITO' };
  if (c.startsWith('3')) return { accountType: 'PATRIMONIO', normalBalance: 'CREDITO' };
  if (c.startsWith('4109')) return { accountType: 'INGRESO', normalBalance: 'DEBITO' };
  if (c.startsWith('4')) return { accountType: 'INGRESO', normalBalance: 'CREDITO' };
  if (c.startsWith('6')) return { accountType: 'COSTO', normalBalance: 'DEBITO' };
  if (c.startsWith('5')) return { accountType: 'GASTO', normalBalance: 'DEBITO' };
  return { accountType: 'ACTIVO', normalBalance: 'DEBITO' };
}

export function computeGeneralLedger(
  accounts: AccountingAccountRecord[],
  entries: JournalEntryRecord[]
): GeneralLedgerAccountSummary[] {
  const sortedEntries = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const map = new Map<string, GeneralLedgerAccountSummary>();
  const normalBalanceByCode = new Map<string, 'DEBITO' | 'CREDITO'>();

  for (const acc of accounts) {
    if (!acc.isPostable) continue;
    normalBalanceByCode.set(acc.code, acc.normalBalance);
    map.set(acc.code, {
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.accountType,
      totalDebit: 0,
      totalCredit: 0,
      balance: 0,
      movements: [],
    });
  }

  for (const entry of sortedEntries) {
    for (const line of entry.lines) {
      let bucket = map.get(line.accountCode);
      if (!bucket) {
        const inferred = inferAccountTypeFromCode(line.accountCode);
        normalBalanceByCode.set(line.accountCode, inferred.normalBalance);
        bucket = {
          accountCode: line.accountCode,
          accountName: line.accountName,
          accountType: inferred.accountType,
          totalDebit: 0,
          totalCredit: 0,
          balance: 0,
          movements: [],
        };
        map.set(line.accountCode, bucket);
      }
      bucket.totalDebit = round2(bucket.totalDebit + line.debit);
      bucket.totalCredit = round2(bucket.totalCredit + line.credit);
      const normalBal =
        normalBalanceByCode.get(line.accountCode) ||
        (['PASIVO', 'PATRIMONIO', 'INGRESO'].includes(bucket.accountType) ? 'CREDITO' : 'DEBITO');
      bucket.balance =
        normalBal === 'CREDITO'
          ? round2(bucket.totalCredit - bucket.totalDebit)
          : round2(bucket.totalDebit - bucket.totalCredit);
      bucket.movements.push({
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: line.memo || entry.description,
        debit: line.debit,
        credit: line.credit,
        runningNet: bucket.balance,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}
