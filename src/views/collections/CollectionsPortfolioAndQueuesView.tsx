import React, { useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Eye,
  Flame,
  Gavel,
  Handshake,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildCobrosDelDiaQueue,
  buildCobrosLegalQueue,
  buildCobrosUrgentesQueue,
  type CobrosQueueEntry,
} from '../../engine/collections/priorityAndTasksEngine';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import type {
  CollectionAccountRecord,
  CollectionBucket,
  CollectionStage,
  CurrencyCode,
} from '../../types/axycore';
import { formatMoney, PRODUCT_LABELS } from '../../utils/formatters';
import { PaymentAgreementModal } from './PaymentAgreementModal';

export function CollectionsPortfolioAndQueuesView({
  mode,
}: {
  mode: 'portfolio' | 'daily' | 'urgent' | 'legal';
}) {
  const {
    userProfile,
    loans,
    collectionAccounts,
    paymentPromises,
    paymentAgreements,
    riskAlerts,
    setSelectedCollectionLoanId,
    setActiveSection,
    runDailyCollectionsSync,
    rbac,
  } = useAxyCore();

  const [search, setSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | CurrencyCode>('ALL');
  const [stageFilter, setStageFilter] = useState<'ALL' | CollectionStage>('ALL');
  const [bucketFilter, setBucketFilter] = useState<'ALL' | CollectionBucket>('ALL');
  const [onlyMyPortfolio, setOnlyMyPortfolio] = useState(
    rbac.role === 'COLLECTION_AGENT'
  );
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [agreementModalAccount, setAgreementModalAccount] =
    useState<CollectionAccountRecord | null>(null);

  const todayIso = getSantoDomingoTodayIso();
  const collectorScopeId =
    rbac.role === 'COLLECTION_AGENT' || onlyMyPortfolio ? userProfile?.uid ?? null : null;

  const canRegisterAgreement =
    rbac.hasPermission('MANAGE_PROMISES') ||
    rbac.hasPermission('LOG_COLLECTION_ACTIONS') ||
    rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS');

  const activeAgreementsByLoan = useMemo(() => {
    const map = new Map<string, number>();
    for (const agr of paymentAgreements) {
      if (['PROPUESTO', 'APROBADO', 'ACTIVO', 'INCUMPLIDO'].includes(agr.status)) {
        map.set(agr.loanId, (map.get(agr.loanId) ?? 0) + 1);
      }
    }
    return map;
  }, [paymentAgreements]);

  const filteredPortfolio = useMemo(() => {
    const q = search.trim().toLowerCase();
    return collectionAccounts
      .filter((acc) => {
        if (collectorScopeId && acc.assignedCollectorId !== collectorScopeId) return false;
        if (currencyFilter !== 'ALL' && acc.currency !== currencyFilter) return false;
        if (stageFilter !== 'ALL' && acc.stage !== stageFilter) return false;
        if (bucketFilter !== 'ALL' && acc.bucket !== bucketFilter) return false;
        if (q) {
          const hay = `${acc.loanNumber} ${acc.applicantDisplayName} ${acc.province || ''} ${acc.assignedCollectorName || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.dpd - a.dpd || b.overdueTotalAmount - a.overdueTotalAmount);
  }, [
    collectionAccounts,
    collectorScopeId,
    currencyFilter,
    stageFilter,
    bucketFilter,
    search,
  ]);

  const dailyQueue = useMemo(
    () =>
      buildCobrosDelDiaQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        asOfDateIso: todayIso,
        collectorId: collectorScopeId,
      }),
    [collectionAccounts, paymentPromises, riskAlerts, todayIso, collectorScopeId]
  );

  const urgentQueue = useMemo(
    () =>
      buildCobrosUrgentesQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        asOfDateIso: todayIso,
        collectorId: collectorScopeId,
      }),
    [collectionAccounts, paymentPromises, riskAlerts, todayIso, collectorScopeId]
  );

  const legalQueue = useMemo(
    () =>
      buildCobrosLegalQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        asOfDateIso: todayIso,
        collectorId: collectorScopeId,
      }),
    [collectionAccounts, paymentPromises, riskAlerts, todayIso, collectorScopeId]
  );

  const activeQueue = useMemo<CobrosQueueEntry[]>(() => {
    const base =
      mode === 'daily'
        ? dailyQueue
        : mode === 'urgent'
        ? urgentQueue
        : mode === 'legal'
        ? legalQueue
        : [];
    const q = search.trim().toLowerCase();
    return base.filter((item) => {
      if (currencyFilter !== 'ALL' && item.account.currency !== currencyFilter) return false;
      if (q) {
        const hay = `${item.account.loanNumber} ${item.account.applicantDisplayName} ${item.account.assignedCollectorName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [mode, dailyQueue, urgentQueue, legalQueue, search, currencyFilter]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await runDailyCollectionsSync({ saveSnapshot: true });
      setSyncMsg(
        `Cartera sincronizada (${res.syncedLoans} préstamos, ${res.newAlerts} alertas nuevas, ${res.newTasks} tareas automáticas).`
      );
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Error al sincronizar cartera.');
    } finally {
      setSyncing(false);
    }
  };

  const unsyncedCount = Math.max(0, loans.length - collectionAccounts.length);

  const headerConfig = {
    portfolio: {
      title: 'Clientes en Cobros (Cartera General)',
      subtitle:
        'Todos los clientes y préstamos en gestión de cobros. Registra acuerdos de pago o consulta su Ficha 360° directamente.',
    },
    daily: {
      title: 'Cobros del Día (1 a 5 Días de Atraso)',
      subtitle: `Clientes que tienen desde 1 hasta 5 días de atraso al corte (${todayIso}, America/Santo_Domingo).`,
    },
    urgent: {
      title: 'Cobros Urgentes (6 a 30 Días de Atraso)',
      subtitle:
        'Clientes que tienen desde 6 hasta 30 días de atraso. Requieren seguimiento intensivo o acuerdo de pago formal.',
    },
    legal: {
      title: 'Cobros en Legal (+31 Días de Atraso)',
      subtitle:
        'Clientes con 31 días o más de atraso en proceso pre-jurídico o legal. Gestiona acuerdos de recuperación o apertura 360°.',
    },
  }[mode];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {mode === 'portfolio' && <Wallet className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'daily' && <ClipboardCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'urgent' && <Flame className="w-5 h-5 text-amber-500" />}
            {mode === 'legal' && <Gavel className="w-5 h-5 text-rose-500" />}
            {headerConfig.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {headerConfig.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {rbac.role !== 'COLLECTION_AGENT' && (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={onlyMyPortfolio}
                onChange={(e) => setOnlyMyPortfolio(e.target.checked)}
              />
              Solo mi cartera asignada
            </label>
          )}
          <button
            type="button"
            disabled={syncing}
            onClick={handleSync}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing
              ? 'Sincronizando...'
              : `Sincronizar Cartera${unsyncedCount > 0 ? ` (+${unsyncedCount})` : ''}`}
          </button>
        </div>
      </div>

      {/* Tramo Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <button
          type="button"
          onClick={() => setActiveSection('cobranza_daily')}
          className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
            mode === 'daily'
              ? 'bg-[#040C1E] border-[#00B8FF]/50 text-white shadow-md'
              : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/15 hover:border-[#00B8FF]/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={mode === 'daily' ? 'text-[#00D1FF] font-semibold' : 'text-slate-500 dark:text-slate-400 font-semibold'}>
              Cobros del Día (1–5 DPD)
            </span>
            <ClipboardCheck className="w-4 h-4 text-[#00B8FF]" />
          </div>
          <p className="font-mono tabular-nums text-xl font-bold mt-1">{dailyQueue.length}</p>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('cobranza_urgent')}
          className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
            mode === 'urgent'
              ? 'bg-[#040C1E] border-amber-400/60 text-white shadow-md'
              : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/15 hover:border-amber-400/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={mode === 'urgent' ? 'text-amber-300 font-semibold' : 'text-slate-500 dark:text-slate-400 font-semibold'}>
              Cobros Urgentes (6–30 DPD)
            </span>
            <Flame className="w-4 h-4 text-amber-500" />
          </div>
          <p className="font-mono tabular-nums text-xl font-bold mt-1">{urgentQueue.length}</p>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('cobranza_legal')}
          className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
            mode === 'legal'
              ? 'bg-[#040C1E] border-rose-400/60 text-white shadow-md'
              : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/15 hover:border-rose-400/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={mode === 'legal' ? 'text-rose-300 font-semibold' : 'text-slate-500 dark:text-slate-400 font-semibold'}>
              Cobros en Legal (31+ DPD)
            </span>
            <Gavel className="w-4 h-4 text-rose-500" />
          </div>
          <p className="font-mono tabular-nums text-xl font-bold mt-1">{legalQueue.length}</p>
        </button>
      </div>

      {syncMsg && (
        <div className="p-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200 text-xs">
          {syncMsg}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div
        className={`p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] grid grid-cols-1 ${
          mode === 'portfolio' ? 'sm:grid-cols-4' : 'sm:grid-cols-2'
        } gap-3 text-xs`}
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar préstamo, cliente, gestor..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
          />
        </div>
        <select
          value={currencyFilter}
          onChange={(e) => setCurrencyFilter(e.target.value as 'ALL' | CurrencyCode)}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
        >
          <option value="ALL">Todas las monedas (DOP y USD)</option>
          <option value="DOP">Solo DOP</option>
          <option value="USD">Solo USD</option>
        </select>

        {mode === 'portfolio' && (
          <>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as 'ALL' | CollectionStage)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
            >
              <option value="ALL">Todas las etapas</option>
              <option value="AL_DIA">Al Día</option>
              <option value="PREVENTIVA">Preventiva</option>
              <option value="TEMPRANA">Mora Temprana (1-15)</option>
              <option value="INTERMEDIA">Mora Intermedia (16-30)</option>
              <option value="AVANZADA">Mora Avanzada (31-60)</option>
              <option value="CRITICA">Mora Crítica (61+)</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value as 'ALL' | CollectionBucket)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
            >
              <option value="ALL">Todos los tramos DPD</option>
              <option value="AL_DIA">0 DPD</option>
              <option value="1_5">1–5 días</option>
              <option value="6_15">6–15 días</option>
              <option value="16_30">16–30 días</option>
              <option value="31_60">31–60 días</option>
              <option value="61_90">61–90 días</option>
              <option value="90_MAS">90+ días</option>
            </select>
          </>
        )}
      </div>

      {mode === 'portfolio' && (
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-x-auto text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-semibold">Préstamo / Cliente</th>
                <th className="py-3 px-3 font-semibold">Moneda</th>
                <th className="py-3 px-3 font-semibold">DPD / Tramo</th>
                <th className="py-3 px-3 font-semibold">Etapa</th>
                <th className="py-3 px-3 font-semibold text-right">Saldo Capital</th>
                <th className="py-3 px-3 font-semibold text-right">Monto Vencido</th>
                <th className="py-3 px-3 font-semibold">Gestor</th>
                <th className="py-3 px-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
              {filteredPortfolio.map((acc) => {
                const agrCount = activeAgreementsByLoan.get(acc.loanId) ?? 0;
                return (
                  <tr
                    key={acc.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-white/[0.025] transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <p className="font-mono font-bold text-slate-950 dark:text-white">{acc.loanNumber}</p>
                      <p className="text-slate-700 dark:text-slate-300">{acc.applicantDisplayName}</p>
                      <p className="text-[11px] text-slate-400">
                        {PRODUCT_LABELS[acc.productCode as keyof typeof PRODUCT_LABELS] || acc.productCode}
                        {agrCount > 0 ? ` · ${agrCount} acuerdo(s)` : ''}
                      </p>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold">{acc.currency}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      <span
                        className={
                          acc.dpd >= 31
                            ? 'text-rose-700 dark:text-rose-400 font-bold'
                            : acc.dpd >= 6
                            ? 'text-amber-700 dark:text-amber-400 font-bold'
                            : acc.dpd >= 1
                            ? 'text-sky-700 dark:text-[#00D1FF] font-bold'
                            : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        }
                      >
                        {acc.dpd} DPD
                      </span>
                      <span className="block text-[11px] text-slate-500">{acc.bucket}</span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold">{acc.stage}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right">
                      {formatMoney(acc.totalOutstandingPrincipal, acc.currency)}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-rose-700 dark:text-rose-400 font-semibold">
                      {formatMoney(acc.overdueTotalAmount, acc.currency)}
                    </td>
                    <td className="py-2.5 px-3">{acc.assignedCollectorName || 'Sin asignar'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {canRegisterAgreement && acc.stage !== 'CANCELADO' && (
                          <button
                            type="button"
                            onClick={() => setAgreementModalAccount(acc)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#040C1E] hover:bg-[#0B1E47] border border-[#00B8FF]/30 text-[#00D1FF] font-semibold cursor-pointer whitespace-nowrap"
                          >
                            <Handshake className="w-3.5 h-3.5" />
                            Acuerdo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionLoanId(acc.loanId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-sky-50 dark:hover:bg-sky-950/50 text-sky-700 dark:text-sky-400 font-semibold cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Abrir 360°
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredPortfolio.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No hay cuentas de cobranza que coincidan con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(mode === 'daily' || mode === 'urgent' || mode === 'legal') && (
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-x-auto text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-semibold">Cliente / Préstamo</th>
                <th className="py-3 px-3 font-semibold">Días de Atraso</th>
                <th className="py-3 px-3 font-semibold">Prioridad / Motivos</th>
                <th className="py-3 px-3 font-semibold text-right">Monto Vencido</th>
                <th className="py-3 px-3 font-semibold text-right">Saldo Capital</th>
                <th className="py-3 px-3 font-semibold">Gestor</th>
                <th className="py-3 px-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
              {activeQueue.map((item) => {
                const agrCount = activeAgreementsByLoan.get(item.loanId) ?? 0;
                return (
                  <tr
                    key={item.loanId}
                    className="hover:bg-slate-50/80 dark:hover:bg-white/[0.025] transition-colors"
                  >
                    <td className="py-3 px-4">
                      <p className="font-mono font-bold text-slate-950 dark:text-white">
                        {item.account.loanNumber}
                      </p>
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {item.account.applicantDisplayName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Tel: {item.account.customerPhone || '—'}
                        {agrCount > 0 ? ` · ${agrCount} acuerdo(s) registrado(s)` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums">
                      <span
                        className={`font-bold ${
                          mode === 'legal'
                            ? 'text-rose-700 dark:text-rose-400'
                            : mode === 'urgent'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-[#0052CC] dark:text-[#00D1FF]'
                        }`}
                      >
                        {item.account.dpd} días
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {mode === 'daily' ? 'Tramo 1–5d' : mode === 'urgent' ? 'Tramo 6–30d' : 'Tramo 31+d'}
                      </span>
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {item.priorityEval.priority} ({item.priorityEval.score})
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.priorityEval.reasons.join(' · ')}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right font-semibold text-rose-700 dark:text-rose-400">
                      {formatMoney(item.account.overdueTotalAmount, item.account.currency)}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right">
                      {formatMoney(item.account.totalOutstandingPrincipal, item.account.currency)}
                    </td>
                    <td className="py-3 px-3">{item.account.assignedCollectorName || 'Sin asignar'}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {canRegisterAgreement && (
                          <button
                            type="button"
                            onClick={() => setAgreementModalAccount(item.account)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#040C1E] hover:bg-[#0B1E47] border border-[#00B8FF]/30 text-[#00D1FF] font-semibold cursor-pointer whitespace-nowrap"
                          >
                            <Handshake className="w-3.5 h-3.5" />
                            Registrar Acuerdo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionLoanId(item.loanId)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Gestionar 360°
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {activeQueue.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {mode === 'daily'
                      ? 'No hay clientes con 1 a 5 días de atraso en este momento.'
                      : mode === 'urgent'
                      ? 'No hay clientes con 6 a 30 días de atraso en este momento.'
                      : 'No hay clientes con 31 o más días de atraso en Cobros en Legal.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PaymentAgreementModal
        account={agreementModalAccount}
        onClose={() => setAgreementModalAccount(null)}
        onSaved={(msg) => setSyncMsg(msg)}
      />
    </div>
  );
}
