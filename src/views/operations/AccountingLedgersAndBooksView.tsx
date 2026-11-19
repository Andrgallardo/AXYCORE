import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Hash,
  ListOrdered,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { computeGeneralLedger } from '../../engine/dgii/dgiiAccountingBridge';
import { round2 } from '../../engine/dgii/dgiiCatalogAndValidation';
import {
  createManualJournalEntry,
  createOrUpdateAccountingAccount,
  reverseJournalEntry,
  seedDefaultChartOfAccounts,
  settleEcfPaymentAndPostAccounting,
} from '../../services/dgiiEcfStore';
import { generateId } from '../../services/axycoreStore';
import type {
  AccountingAccountRecord,
  AccountingAccountType,
  JournalEntryLine,
  JournalEntryRecord,
} from '../../types/dgiiEcf';
import { ECF_TYPE_META } from '../../types/dgiiEcf';
import { formatMoney } from '../../utils/formatters';

export type AccountingBookMode =
  | 'chart_of_accounts'
  | 'journal_entries'
  | 'daily_book'
  | 'general_ledger'
  | 'receivables'
  | 'payables'
  | 'taxes';

const ACCOUNT_TYPE_LABELS: Record<AccountingAccountType, string> = {
  ACTIVO: 'Activo',
  PASIVO: 'Pasivo',
  PATRIMONIO: 'Patrimonio',
  INGRESO: 'Ingreso',
  COSTO: 'Costo',
  GASTO: 'Gasto',
};

function downloadCsvFile(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AccountingLedgersAndBooksView({ mode }: { mode: AccountingBookMode }) {
  const {
    organization,
    userProfile,
    rbac,
    accountingAccounts,
    journalEntries,
    dgiiEcfDocuments,
    activeDgiiConfig,
    setActiveSection,
  } = useAxyCore();

  const canWriteAccounting =
    rbac.hasPermission('EMIT_ECF') ||
    rbac.hasPermission('MANAGE_DGII_CONFIG') ||
    rbac.role === 'ADMIN' ||
    rbac.role === 'FINANCE' ||
    rbac.role === 'OPERATIONS';

  const [search, setSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | 'DOP' | 'USD'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Chart of accounts modal
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountingAccountType>('ACTIVO');
  const [accNormalBalance, setAccNormalBalance] = useState<'DEBITO' | 'CREDITO'>('DEBITO');
  const [accParentCode, setAccParentCode] = useState('');
  const [accIsPostable, setAccIsPostable] = useState(true);

  // Manual journal entry modal
  const [jeModalOpen, setJeModalOpen] = useState(false);
  const [jeDate, setJeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [jeCurrency, setJeCurrency] = useState<'DOP' | 'USD'>(organization.currency || 'DOP');
  const [jeDesc, setJeDesc] = useState('');
  const [jeRefDoc, setJeRefDoc] = useState('');
  const [jeLines, setJeLines] = useState<Array<{ accountCode: string; debit: string; credit: string; memo: string }>>([
    { accountCode: '1102', debit: '', credit: '', memo: '' },
    { accountCode: '4101', debit: '', credit: '', memo: '' },
  ]);

  // Selected journal entry / ledger account inspection
  const [expandedJeId, setExpandedJeId] = useState<string | null>(null);
  const [selectedLedgerCode, setSelectedLedgerCode] = useState<string | null>(null);

  const sortedAccounts = useMemo(
    () => [...accountingAccounts].sort((a, b) => a.code.localeCompare(b.code)),
    [accountingAccounts]
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedAccounts;
    return sortedAccounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.accountType.toLowerCase().includes(q)
    );
  }, [sortedAccounts, search]);

  const sortedJournalEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...journalEntries]
      .filter((e) => {
        if (currencyFilter !== 'ALL' && e.currency !== currencyFilter) return false;
        if (dateFrom && e.entryDate < dateFrom) return false;
        if (dateTo && e.entryDate > dateTo) return false;
        if (!q) return true;
        return (
          e.entryNumber.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          (e.referenceDoc || '').toLowerCase().includes(q) ||
          e.sourceType.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.entryNumber.localeCompare(a.entryNumber));
  }, [journalEntries, currencyFilter, dateFrom, dateTo, search]);

  const ledgerCurrency = currencyFilter === 'ALL' ? organization.currency || 'DOP' : currencyFilter;
  const generalLedgerRows = useMemo(
    () =>
      computeGeneralLedger(
        sortedAccounts,
        journalEntries.filter((e) => {
          if (e.currency !== ledgerCurrency) return false;
          if (dateFrom && e.entryDate < dateFrom) return false;
          if (dateTo && e.entryDate > dateTo) return false;
          return true;
        })
      ),
    [sortedAccounts, journalEntries, dateFrom, dateTo, ledgerCurrency]
  );

  const receivableDocs = useMemo(
    () =>
      dgiiEcfDocuments
        .filter(
          (d) =>
            d.direction === 'EMITIDO' &&
            !['41', '43', '47', '34'].includes(d.ecfType) &&
            d.status !== 'BORRADOR' &&
            d.status !== 'ANULADA'
        )
        .filter((d) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return (
            d.eNCF.toLowerCase().includes(q) ||
            d.receiverName.toLowerCase().includes(q) ||
            d.receiverTaxId.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [dgiiEcfDocuments, search]
  );

  const payableDocs = useMemo(
    () =>
      dgiiEcfDocuments
        .filter(
          (d) =>
            (d.direction === 'RECIBIDO' || ['41', '43', '47'].includes(d.ecfType)) &&
            d.status !== 'BORRADOR' &&
            d.status !== 'ANULADA'
        )
        .filter((d) => {
          const q = search.trim().toLowerCase();
          if (!q) return true;
          return (
            d.eNCF.toLowerCase().includes(q) ||
            d.issuerName.toLowerCase().includes(q) ||
            d.receiverName.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [dgiiEcfDocuments, search]
  );

  const taxSummary = useMemo(() => {
    const validDocs = dgiiEcfDocuments.filter((d) => {
      if (d.status === 'BORRADOR' || d.status === 'ANULADA') return false;
      if (currencyFilter !== 'ALL' && d.currency !== currencyFilter) return false;
      if (dateFrom && d.issueDate < dateFrom) return false;
      if (dateTo && d.issueDate > dateTo) return false;
      return true;
    });
    let itbisBilled = 0;
    let itbisCreditNotes = 0;
    let itbisDebitNotes = 0;
    let itbisPurchasesCredit = 0;
    let otherTaxes = 0;
    let totalExemptSales = 0;
    let totalTaxableSales = 0;

    for (const d of validDocs) {
      if (d.direction === 'EMITIDO') {
        if (d.ecfType === '34') {
          itbisCreditNotes = round2(itbisCreditNotes + d.totalItbis);
        } else if (d.ecfType === '33') {
          itbisDebitNotes = round2(itbisDebitNotes + d.totalItbis);
        } else if (['41', '43', '47'].includes(d.ecfType)) {
          itbisPurchasesCredit = round2(itbisPurchasesCredit + d.totalItbis);
          otherTaxes = round2(otherTaxes + d.otherTaxesTotal);
        } else {
          itbisBilled = round2(itbisBilled + d.totalItbis);
          otherTaxes = round2(otherTaxes + d.otherTaxesTotal);
          totalExemptSales = round2(totalExemptSales + d.exemptAmount);
          totalTaxableSales = round2(totalTaxableSales + d.taxableAmount18 + d.taxableAmount16);
        }
      } else {
        itbisPurchasesCredit = round2(itbisPurchasesCredit + d.totalItbis);
      }
    }

    const netItbisPayable = round2(itbisBilled + itbisDebitNotes - itbisCreditNotes - itbisPurchasesCredit);
    return {
      itbisBilled,
      itbisCreditNotes,
      itbisDebitNotes,
      itbisPurchasesCredit,
      otherTaxes,
      totalExemptSales,
      totalTaxableSales,
      netItbisPayable,
      docCount: validDocs.length,
    };
  }, [dgiiEcfDocuments, currencyFilter, dateFrom, dateTo]);

  const handleSeedChart = async () => {
    if (!userProfile) return;
    setBusyId('seed_chart');
    setFeedback(null);
    try {
      const added = await seedDefaultChartOfAccounts({
        organizationId: organization.id,
        existingAccounts: accountingAccounts,
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text:
          added > 0
            ? `Se inicializaron ${added} cuentas contables base según la normativa contable de RD.`
            : 'El Plan de Cuentas ya contiene todas las cuentas base requeridas.',
      });
    } catch (e) {
      setFeedback({ kind: 'err', text: e instanceof Error ? e.message : 'Error inicializando plan de cuentas.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    if (!accCode.trim() || !accName.trim()) {
      setFeedback({ kind: 'err', text: 'Código y nombre de cuenta son obligatorios.' });
      return;
    }
    setBusyId('save_account');
    setFeedback(null);
    try {
      const id = `acc_${organization.id}_${accCode.trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const existing = accountingAccounts.find((a) => a.id === id);
      const record: Omit<AccountingAccountRecord, 'createdAt' | 'updatedAt'> = {
        id,
        organizationId: organization.id,
        code: accCode.trim(),
        name: accName.trim(),
        accountType: accType,
        normalBalance: accNormalBalance,
        ...(accParentCode.trim() ? { parentCode: accParentCode.trim() } : {}),
        isPostable: accIsPostable,
        status: 'ACTIVA',
        createdBy: existing?.createdBy || userProfile.uid,
      };
      await createOrUpdateAccountingAccount({ account: record, isNew: !existing });
      setAccountModalOpen(false);
      setAccCode('');
      setAccName('');
      setAccParentCode('');
      setFeedback({ kind: 'ok', text: `Cuenta ${record.code} – ${record.name} guardada correctamente.` });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error guardando cuenta.' });
    } finally {
      setBusyId(null);
    }
  };

  const manualJeTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of jeLines) {
      debit = round2(debit + (Number(l.debit) || 0));
      credit = round2(credit + (Number(l.credit) || 0));
    }
    return { debit, credit, balanced: debit > 0 && debit === credit };
  }, [jeLines]);

  const handleCreateManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    if (!jeDesc.trim() || !manualJeTotals.balanced) {
      setFeedback({ kind: 'err', text: 'El asiento debe tener descripción y estar cuadrado (Débito == Crédito > 0).' });
      return;
    }
    setBusyId('save_je');
    setFeedback(null);
    try {
      const lines: JournalEntryLine[] = [];
      for (const l of jeLines) {
        const d = round2(Number(l.debit) || 0);
        const c = round2(Number(l.credit) || 0);
        if (d === 0 && c === 0) continue;
        const acc = sortedAccounts.find((a) => a.code === l.accountCode);
        if (!acc) {
          throw new Error(`Cuenta contable ${l.accountCode} no encontrada en el Plan de Cuentas.`);
        }
        lines.push({
          accountId: acc.id,
          accountCode: acc.code,
          accountName: acc.name,
          debit: d,
          credit: c,
          memo: l.memo.trim() || undefined,
        });
      }
      if (lines.length < 2) {
        throw new Error('Un asiento contable requiere al menos 2 líneas válidas.');
      }
      const id = generateId('je_man');
      const entryNumber = `MAN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(journalEntries.length + 1).padStart(4, '0')}`;
      await createManualJournalEntry({
        entry: {
          id,
          organizationId: organization.id,
          entryNumber,
          entryDate: jeDate,
          sourceType: 'MANUAL',
          sourceId: id,
          idempotencyKey: id,
          currency: jeCurrency,
          description: jeDesc.trim(),
          ...(jeRefDoc.trim() ? { referenceDoc: jeRefDoc.trim() } : {}),
          lines,
          totalDebit: manualJeTotals.debit,
          totalCredit: manualJeTotals.credit,
          status: 'CONTABILIZADO',
          createdBy: userProfile.uid,
          createdByName: userProfile.displayName,
        },
      });
      setJeModalOpen(false);
      setJeDesc('');
      setJeRefDoc('');
      setFeedback({ kind: 'ok', text: `Asiento manual ${entryNumber} contabilizado correctamente.` });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error guardando asiento contable.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleReverseEntry = async (entry: JournalEntryRecord) => {
    if (!userProfile) return;
    setBusyId(entry.id);
    setFeedback(null);
    try {
      const rev = await reverseJournalEntry({
        originalEntry: entry,
        reason: `Reverso contable solicitado por ${userProfile.displayName}`,
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `Asiento ${entry.entryNumber} revertido mediante ${rev.entryNumber}.`,
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error revirtiendo asiento.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleSettleEcf = async (docId: string) => {
    const docRec = dgiiEcfDocuments.find((d) => d.id === docId);
    if (!docRec || !userProfile) return;
    setBusyId(docId);
    setFeedback(null);
    try {
      const je = await settleEcfPaymentAndPostAccounting({
        document: docRec,
        config: activeDgiiConfig,
        accounts: accountingAccounts,
        settlementDate: new Date().toISOString().slice(0, 10),
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `Liquidación registrada para ${docRec.eNCF} · Asiento contable ${je.entryNumber} generado.`,
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error registrando liquidación.' });
    } finally {
      setBusyId(null);
    }
  };

  const metaByMode: Record<AccountingBookMode, { title: string; subtitle: string; Icon: React.ComponentType<{ className?: string }> }> = {
    chart_of_accounts: {
      title: 'Plan de Cuentas Contable',
      subtitle: 'Catálogo jerárquico multiempresa alineado con NIIF, DGII y operaciones financieras.',
      Icon: ListOrdered,
    },
    journal_entries: {
      title: 'Asientos Contables (Partida Doble)',
      subtitle: 'Registro automático desde Facturación Electrónica e-CF y asientos manuales auditados.',
      Icon: FileText,
    },
    daily_book: {
      title: 'Libro Diario',
      subtitle: 'Detalle cronológico línea por línea de todos los movimientos contabilizados.',
      Icon: BookOpen,
    },
    general_ledger: {
      title: 'Libro Mayor General',
      subtitle: 'Saldos acumulados y movimientos T-Account por cuenta contable.',
      Icon: Scale,
    },
    receivables: {
      title: 'Cuentas por Cobrar (Facturación e-CF)',
      subtitle: 'Control de comprobantes emitidos a crédito pendientes de cobro y conciliación contable.',
      Icon: ArrowDownLeft,
    },
    payables: {
      title: 'Cuentas por Pagar (Suplidores y Compras e-CF)',
      subtitle: 'Obligaciones fiscales por facturas recibidas de proveedores y comprobantes 41/43/47.',
      Icon: ArrowUpRight,
    },
    taxes: {
      title: 'Impuestos y Posición Fiscal ITBIS / Retenciones',
      subtitle: 'Consolidación de ITBIS facturado (607), ITBIS adelantado (606), notas de ajuste y retenciones.',
      Icon: Hash,
    },
  };

  const { title, subtitle, Icon } = metaByMode[mode];

  return (
    <div className="space-y-5 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <Icon className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>{title}</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {subtitle} · Empresa: <strong className="text-slate-700 dark:text-slate-200">{organization.tradeName || organization.name}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {accountingAccounts.length === 0 && canWriteAccounting && (
            <button
              type="button"
              onClick={() => void handleSeedChart()}
              disabled={busyId === 'seed_chart'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Inicializar Plan de Cuentas Base (RD)</span>
            </button>
          )}

          {mode === 'chart_of_accounts' && canWriteAccounting && (
            <>
              {accountingAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleSeedChart()}
                  disabled={busyId === 'seed_chart'}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] text-slate-800 dark:text-slate-100 font-semibold cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                  <span>Completar Cuentas Base</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setAccountModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva Cuenta</span>
              </button>
            </>
          )}

          {mode === 'journal_entries' && canWriteAccounting && (
            <button
              type="button"
              onClick={() => setJeModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Asiento Manual</span>
            </button>
          )}

          {(mode === 'daily_book' || mode === 'general_ledger' || mode === 'journal_entries') && (
            <button
              type="button"
              onClick={() => {
                if (mode === 'general_ledger') {
                  downloadCsvFile(
                    `libro_mayor_${organization.id}_${ledgerCurrency}.csv`,
                    ['Código', 'Cuenta', 'Tipo', 'Saldo Normal', 'Total Débitos', 'Total Créditos', 'Saldo Neto'],
                    generalLedgerRows.map((r) => [
                      r.accountCode,
                      r.accountName,
                      r.accountType,
                      ['PASIVO', 'PATRIMONIO', 'INGRESO'].includes(r.accountType) ? 'CREDITO' : 'DEBITO',
                      r.totalDebit.toFixed(2),
                      r.totalCredit.toFixed(2),
                      r.balance.toFixed(2),
                    ])
                  );
                } else {
                  downloadCsvFile(
                    `libro_diario_${organization.id}.csv`,
                    ['Fecha', 'Asiento', 'Origen', 'Documento', 'Cuenta', 'Nombre Cuenta', 'Débito', 'Crédito', 'Estado'],
                    sortedJournalEntries.flatMap((e) =>
                      e.lines.map((l) => [
                        e.entryDate,
                        e.entryNumber,
                        e.sourceType,
                        e.referenceDoc || e.description,
                        l.accountCode,
                        l.accountName,
                        l.debit.toFixed(2),
                        l.credit.toFixed(2),
                        e.status,
                      ])
                    )
                  );
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] text-slate-800 dark:text-slate-100 font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Exportar CSV</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center gap-2 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-700/40 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-700/40 text-rose-800 dark:text-rose-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="p-3.5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, cuenta, asiento, e-NCF o contraparte..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
          />
        </div>

        {mode !== 'chart_of_accounts' && (
          <>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value as 'ALL' | 'DOP' | 'USD')}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-slate-800 dark:text-slate-100 font-semibold"
            >
              <option value="ALL">Todas las Monedas</option>
              <option value="DOP">DOP</option>
              <option value="USD">USD</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-slate-800 dark:text-slate-100"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-slate-800 dark:text-slate-100"
            />
          </>
        )}
      </div>

      {/* MODE: CHART OF ACCOUNTS */}
      {mode === 'chart_of_accounts' && (
        <div className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Código</th>
                  <th className="py-2.5 px-4">Nombre de Cuenta</th>
                  <th className="py-2.5 px-4">Clasificación</th>
                  <th className="py-2.5 px-4">Naturaleza</th>
                  <th className="py-2.5 px-4">Asentable</th>
                  <th className="py-2.5 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{acc.code}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {acc.name}
                      {acc.systemTag && (
                        <span className="ml-2 text-[10px] font-mono text-slate-400">({acc.systemTag})</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">{ACCOUNT_TYPE_LABELS[acc.accountType]}</td>
                    <td className="py-2.5 px-4 font-mono">{acc.normalBalance}</td>
                    <td className="py-2.5 px-4">{acc.isPostable ? 'Sí' : 'Agrupadora'}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          acc.status === 'ACTIVA'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {acc.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                      No hay cuentas contables registradas aún. Haz clic en «Inicializar Plan de Cuentas Base (RD)» para cargar el catálogo estándar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODE: JOURNAL ENTRIES */}
      {mode === 'journal_entries' && (
        <div className="space-y-3">
          {sortedJournalEntries.map((je) => {
            const expanded = expandedJeId === je.id;
            return (
              <div
                key={je.id}
                className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden"
              >
                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{je.entryNumber}</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">{je.entryDate}</span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/10 text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                        {je.sourceType}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          je.status === 'CONTABILIZADO'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {je.status}
                      </span>
                    </div>
                    <p className="font-medium text-slate-900 dark:text-white">{je.description}</p>
                    {je.referenceDoc && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">Ref: {je.referenceDoc}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Débito / Crédito</p>
                      <p className="font-bold text-slate-950 dark:text-white">{formatMoney(je.totalDebit, je.currency)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedJeId(expanded ? null : je.id)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 font-semibold hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                    >
                      {expanded ? 'Ocultar Partidas' : `Ver ${je.lines.length} Partidas`}
                    </button>
                    {je.status === 'CONTABILIZADO' && je.sourceType !== 'REVERSO' && canWriteAccounting && (
                      <button
                        type="button"
                        disabled={busyId === je.id}
                        onClick={() => void handleReverseEntry(je)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Revertir</span>
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-[#040C1E]/60 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 dark:border-white/10">
                          <th className="py-2 px-4">Cuenta</th>
                          <th className="py-2 px-4">Nombre</th>
                          <th className="py-2 px-4">Detalle</th>
                          <th className="py-2 px-4 text-right">Débito</th>
                          <th className="py-2 px-4 text-right">Crédito</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {je.lines.map((l, idx) => (
                          <tr key={idx}>
                            <td className="py-2 px-4 font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">{l.accountCode}</td>
                            <td className="py-2 px-4 text-slate-800 dark:text-slate-200">{l.accountName}</td>
                            <td className="py-2 px-4 text-slate-500 dark:text-slate-400">{l.memo || '—'}</td>
                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                              {l.debit > 0 ? formatMoney(l.debit, je.currency) : '—'}
                            </td>
                            <td className="py-2 px-4 text-right font-mono tabular-nums">
                              {l.credit > 0 ? formatMoney(l.credit, je.currency) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {sortedJournalEntries.length === 0 && (
            <div className="p-10 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 text-center text-slate-500 dark:text-slate-400">
              No hay asientos contables registrados con los filtros actuales. Emite un e-CF o registra un asiento manual.
            </div>
          )}
        </div>
      )}

      {/* MODE: DAILY BOOK */}
      {mode === 'daily_book' && (
        <div className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Fecha</th>
                  <th className="py-2.5 px-4">Asiento</th>
                  <th className="py-2.5 px-4">Cuenta</th>
                  <th className="py-2.5 px-4">Concepto / Referencia</th>
                  <th className="py-2.5 px-4 text-right">Débito</th>
                  <th className="py-2.5 px-4 text-right">Crédito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {sortedJournalEntries
                  .filter((e) => e.status === 'CONTABILIZADO')
                  .flatMap((e) =>
                    e.lines.map((l, idx) => (
                      <tr key={`${e.id}_${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                        <td className="py-2 px-4 font-mono whitespace-nowrap">{e.entryDate}</td>
                        <td className="py-2 px-4 font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF] whitespace-nowrap">
                          {e.entryNumber}
                        </td>
                        <td className="py-2 px-4">
                          <span className="font-mono font-semibold">{l.accountCode}</span> · {l.accountName}
                        </td>
                        <td className="py-2 px-4 text-slate-600 dark:text-slate-300">
                          {l.memo || e.description}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {l.debit > 0 ? formatMoney(l.debit, e.currency) : '—'}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {l.credit > 0 ? formatMoney(l.credit, e.currency) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                {sortedJournalEntries.filter((e) => e.status === 'CONTABILIZADO').length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      No hay movimientos contabilizados en el Libro Diario para el período seleccionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODE: GENERAL LEDGER */}
      {mode === 'general_ledger' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Código</th>
                    <th className="py-2.5 px-4">Cuenta</th>
                    <th className="py-2.5 px-4">Tipo</th>
                    <th className="py-2.5 px-4 text-right">Total Débitos ({ledgerCurrency})</th>
                    <th className="py-2.5 px-4 text-right">Total Créditos ({ledgerCurrency})</th>
                    <th className="py-2.5 px-4 text-right">Saldo Neto</th>
                    <th className="py-2.5 px-4 text-right">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {generalLedgerRows.map((row) => (
                    <tr key={row.accountCode} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                      <td className="py-2.5 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                        {row.accountCode}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{row.accountName}</td>
                      <td className="py-2.5 px-4">{row.accountType}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatMoney(row.totalDebit, ledgerCurrency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatMoney(row.totalCredit, ledgerCurrency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                        {formatMoney(row.balance, ledgerCurrency)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedLedgerCode(
                              selectedLedgerCode === row.accountCode ? null : row.accountCode
                            )
                          }
                          className="text-[#0052CC] dark:text-[#00D1FF] font-semibold hover:underline cursor-pointer"
                        >
                          {selectedLedgerCode === row.accountCode ? 'Ocultar' : `${row.movements.length} movs`}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {generalLedgerRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        Sin cuentas registradas en el Libro Mayor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedLedgerCode && (
            <div className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 p-4 space-y-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Auxiliar de Cuenta {selectedLedgerCode} ({ledgerCurrency})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-2 px-3">Fecha</th>
                      <th className="py-2 px-3">Asiento</th>
                      <th className="py-2 px-3">Descripción</th>
                      <th className="py-2 px-3 text-right">Débito</th>
                      <th className="py-2 px-3 text-right">Crédito</th>
                      <th className="py-2 px-3 text-right">Saldo Corrido</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {(
                      generalLedgerRows.find((r) => r.accountCode === selectedLedgerCode)?.movements || []
                    ).map((m, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 font-mono">{m.entryDate}</td>
                        <td className="py-2 px-3 font-mono text-[#0052CC] dark:text-[#00D1FF]">{m.entryNumber}</td>
                        <td className="py-2 px-3">{m.description}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.debit > 0 ? formatMoney(m.debit, ledgerCurrency) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.credit > 0 ? formatMoney(m.credit, ledgerCurrency) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-bold">
                          {formatMoney(m.runningNet, ledgerCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE: RECEIVABLES & PAYABLES */}
      {(mode === 'receivables' || mode === 'payables') && (
        <div className="rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Fecha</th>
                  <th className="py-2.5 px-4">e-NCF</th>
                  <th className="py-2.5 px-4">Tipo</th>
                  <th className="py-2.5 px-4">{mode === 'receivables' ? 'Cliente / Receptor' : 'Suplidor / Emisor'}</th>
                  <th className="py-2.5 px-4 text-right">Monto Total</th>
                  <th className="py-2.5 px-4">Estado Liquidación</th>
                  <th className="py-2.5 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {(mode === 'receivables' ? receivableDocs : payableDocs).map((d) => {
                  const settled =
                    d.paymentCollectionStatus === 'COBRADA' || d.paymentCollectionStatus === 'PAGADA';
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                      <td className="py-2.5 px-4 font-mono">{d.issueDate}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{d.eNCF}</td>
                      <td className="py-2.5 px-4">{ECF_TYPE_META[d.ecfType]?.shortName || d.ecfType}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {mode === 'receivables' ? d.receiverName : d.issuerName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {mode === 'receivables' ? d.receiverTaxId : d.issuerRnc}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold">
                        {formatMoney(d.totalAmount, d.currency)}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            settled
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {d.paymentCollectionStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {!settled && canWriteAccounting ? (
                          <button
                            type="button"
                            disabled={busyId === d.id}
                            onClick={() => void handleSettleEcf(d.id)}
                            className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {mode === 'receivables' ? 'Registrar Cobro' : 'Registrar Pago'}
                          </button>
                        ) : (
                          <span className="text-slate-400 font-mono">{d.paymentAccountingEntryId ? 'Contabilizado' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(mode === 'receivables' ? receivableDocs : payableDocs).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No hay registros en {mode === 'receivables' ? 'Cuentas por Cobrar' : 'Cuentas por Pagar'}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODE: TAXES */}
      {mode === 'taxes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">ITBIS Facturado en Ventas (607)</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
                {formatMoney(taxSummary.itbisBilled + taxSummary.itbisDebitNotes, ledgerCurrency)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Notas Crédito ITBIS: -{formatMoney(taxSummary.itbisCreditNotes, ledgerCurrency)}</p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">ITBIS Adelantado Compras (606)</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-bold text-emerald-700 dark:text-emerald-300">
                {formatMoney(taxSummary.itbisPurchasesCredit, ledgerCurrency)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Deducible de compras y e-CF recibidos</p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">ITBIS Neto Estimado a Pagar</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-bold text-[#0052CC] dark:text-[#00D1FF]">
                {formatMoney(taxSummary.netItbisPayable, ledgerCurrency)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Base en {taxSummary.docCount} comprobantes válidos</p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Otros Impuestos / Retenciones</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-950 dark:text-white">
                {formatMoney(taxSummary.otherTaxes, ledgerCurrency)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">ISC, Propina Legal y Pagos al Exterior</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">Declaración Mensual DGII (Formatos 606 y 607)</p>
              <p className="text-slate-500 dark:text-slate-400">
                Genera los archivos tabulares listos para validación de envíos de compras (606) y ventas (607) desde Reportes Fiscales.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('ecf_reports')}
              className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              Abrir Formatos 606 / 607
            </button>
          </div>
        </div>
      )}

      {/* Modal: New Account */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveAccount(e)}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 p-5 space-y-4 shadow-2xl"
          >
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Agregar / Actualizar Cuenta Contable
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Código</label>
                <input
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  placeholder="Ej. 1105"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Cuenta Padre</label>
                <input
                  value={accParentCode}
                  onChange={(e) => setAccParentCode(e.target.value)}
                  placeholder="Ej. 1100"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nombre de la Cuenta</label>
              <input
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder="Ej. Inventario de Suministros"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Tipo</label>
                <select
                  value={accType}
                  onChange={(e) => setAccType(e.target.value as AccountingAccountType)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Naturaleza</label>
                <select
                  value={accNormalBalance}
                  onChange={(e) => setAccNormalBalance(e.target.value as 'DEBITO' | 'CREDITO')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="DEBITO">Débito</option>
                  <option value="CREDITO">Crédito</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={accIsPostable}
                onChange={(e) => setAccIsPostable(e.target.checked)}
              />
              <span>Cuenta de movimiento (permite asientos contables directos)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busyId === 'save_account'}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                Guardar Cuenta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Manual Journal Entry */}
      {jeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreateManualEntry(e)}
            className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Nuevo Asiento Contable Manual (Partida Doble)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">Fecha</label>
                <input
                  type="date"
                  value={jeDate}
                  onChange={(e) => setJeDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Moneda</label>
                <select
                  value={jeCurrency}
                  onChange={(e) => setJeCurrency(e.target.value as 'DOP' | 'USD')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="DOP">DOP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Documento Ref.</label>
                <input
                  value={jeRefDoc}
                  onChange={(e) => setJeRefDoc(e.target.value)}
                  placeholder="Ej. E310000000001"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Descripción / Glosa</label>
              <input
                value={jeDesc}
                onChange={(e) => setJeDesc(e.target.value)}
                placeholder="Motivo del asiento contable..."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold">Líneas del Asiento</span>
                <button
                  type="button"
                  onClick={() =>
                    setJeLines((prev) => [...prev, { accountCode: sortedAccounts[0]?.code || '1102', debit: '', credit: '', memo: '' }])
                  }
                  className="text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                >
                  + Agregar Línea
                </button>
              </div>
              {jeLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={line.accountCode}
                    onChange={(e) =>
                      setJeLines((prev) => prev.map((x, i) => (i === idx ? { ...x, accountCode: e.target.value } : x)))
                    }
                    className="col-span-5 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                  >
                    {sortedAccounts
                      .filter((a) => a.isPostable && a.status === 'ACTIVA')
                      .map((a) => (
                        <option key={a.id} value={a.code}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Débito"
                    value={line.debit}
                    onChange={(e) =>
                      setJeLines((prev) => prev.map((x, i) => (i === idx ? { ...x, debit: e.target.value, credit: '' } : x)))
                    }
                    className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-right font-mono"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Crédito"
                    value={line.credit}
                    onChange={(e) =>
                      setJeLines((prev) => prev.map((x, i) => (i === idx ? { ...x, credit: e.target.value, debit: '' } : x)))
                    }
                    className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-right font-mono"
                  />
                  <input
                    placeholder="Detalle"
                    value={line.memo}
                    onChange={(e) =>
                      setJeLines((prev) => prev.map((x, i) => (i === idx ? { ...x, memo: e.target.value } : x)))
                    }
                    className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                  />
                  <button
                    type="button"
                    onClick={() => setJeLines((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={jeLines.length <= 2}
                    className="col-span-1 p-1.5 text-rose-500 disabled:opacity-30 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 flex items-center justify-between font-mono tabular-nums">
              <span>Total Débito: {formatMoney(manualJeTotals.debit, jeCurrency)}</span>
              <span>Total Crédito: {formatMoney(manualJeTotals.credit, jeCurrency)}</span>
              <span className={manualJeTotals.balanced ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                {manualJeTotals.balanced ? 'CUADRADO' : 'DESCUADRADO'}
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setJeModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!manualJeTotals.balanced || busyId === 'save_je'}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                Contabilizar Asiento
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
