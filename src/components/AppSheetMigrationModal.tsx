import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  DEFAULT_APPSHEET_MIGRATION_ACCESS_KEY,
  DEFAULT_APPSHEET_MIGRATION_APP_ID,
  type AppSheetMigrationBundle,
  type AppSheetMigrationSummary,
} from '../engine/appsheetMigrationEngine';
import {
  executeAppSheetMigrationToFirestore,
  fetchAppSheetMigrationPreview,
  type MigrationProgressState,
} from '../services/appsheetMigrationStore';
import type { UserProfile } from '../types/axycore';

interface AppSheetMigrationModalProps {
  open: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  initialProgress?: MigrationProgressState | null;
  lastSummary?: AppSheetMigrationSummary | null;
  onMigrationCompleted?: (bundle: AppSheetMigrationBundle) => void;
}

function formatDop(amount: number): string {
  return `RD$ ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AppSheetMigrationModal({
  open,
  onClose,
  userProfile,
  initialProgress,
  lastSummary,
  onMigrationCompleted,
}: AppSheetMigrationModalProps) {
  const [appId, setAppId] = useState(DEFAULT_APPSHEET_MIGRATION_APP_ID);
  const [accessKey, setAccessKey] = useState(DEFAULT_APPSHEET_MIGRATION_ACCESS_KEY);
  const [previewBundle, setPreviewBundle] = useState<AppSheetMigrationBundle | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningMigration, setRunningMigration] = useState(false);
  const [progress, setProgress] = useState<MigrationProgressState | null>(initialProgress ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialProgress) {
      setProgress(initialProgress);
      setRunningMigration(
        initialProgress.stage !== 'IDLE' &&
          initialProgress.stage !== 'COMPLETED' &&
          initialProgress.stage !== 'ERROR'
      );
    }
  }, [initialProgress]);

  const handleLoadPreview = async (forceRefresh = false) => {
    setLoadingPreview(true);
    setErrorMsg(null);
    try {
      const bundle = await fetchAppSheetMigrationPreview({
        user: userProfile,
        appId,
        accessKey,
        forceRefresh,
      });
      setPreviewBundle(bundle);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No fue posible consultar la base de datos origen en AppSheet.'
      );
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (open && !previewBundle && !loadingPreview) {
      void handleLoadPreview(false);
    }
  }, [open]);

  if (!open) return null;

  const summary = previewBundle?.summary ?? lastSummary ?? null;

  const handleRunMigration = async () => {
    setRunningMigration(true);
    setErrorMsg(null);
    try {
      const completedBundle = await executeAppSheetMigrationToFirestore({
        user: userProfile,
        appId,
        accessKey,
        bundle: previewBundle ?? undefined,
        onProgress: (st) => setProgress(st),
      });
      setPreviewBundle(completedBundle);
      onMigrationCompleted?.(completedBundle);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Error al escribir los registros migrados en Firestore.'
      );
      setProgress((prev) =>
        prev
          ? { ...prev, stage: 'ERROR', message: 'Fallo durante la escritura en Firestore.' }
          : null
      );
    } finally {
      setRunningMigration(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0B1F3A] via-[#123B65] to-[#0B1F3A] px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#168BFF]/25 border border-[#20C4E8]/40 flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-[#20C4E8]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">
                  Centro de Migración e Integración de Plataforma
                </h2>
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#20C4E8]/20 text-[#20C4E8] border border-[#20C4E8]/30">
                  AppSheet → AxyCore
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Adaptación integral de clientes, solicitudes, préstamos, cuotas, pagos realizados y estados financieros
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={runningMigration}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Source Credentials Bar */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70">
            <div className="md:col-span-5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                App ID Origen (AppSheet)
              </label>
              <div className="relative">
                <Database className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  disabled={runningMigration}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="md:col-span-5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Application Access Key
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  disabled={runningMigration}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="md:col-span-2 flex items-end">
              <button
                type="button"
                onClick={() => void handleLoadPreview(true)}
                disabled={loadingPreview || runningMigration}
                className="w-full py-2 px-3 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
              >
                {loadingPreview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Verificar
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-800 dark:text-rose-200">
                <p className="font-bold">Incidencia en la migración</p>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Progress Bar when running or completed */}
          {progress && progress.stage !== 'IDLE' && (
            <div className="p-4 rounded-2xl bg-blue-50/90 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-blue-950 dark:text-blue-200 flex items-center gap-2">
                  {progress.stage === 'COMPLETED' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                  )}
                  {progress.message}
                </span>
                <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
                  {progress.percent}%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-blue-200/70 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#168BFF] to-[#20C4E8] transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Summary Cards */}
          {loadingPreview && !summary ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#168BFF]" />
              <p className="text-sm font-medium">
                Conectando con AppSheet ({appId}) y analizando tablas origen...
              </p>
            </div>
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
                    <span className="font-semibold">Clientes Adaptados</span>
                    <Users className="w-4 h-4 text-[#168BFF]" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {summary.customersCount}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary.activeCustomersCount} activos · {summary.inactiveCustomersCount} inactivos ·{' '}
                    {summary.businessesCount} empresas
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
                    <span className="font-semibold">Préstamos y Solicitudes</span>
                    <Layers className="w-4 h-4 text-indigo-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {summary.loansCount}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary.activeLoansCount} vigentes · {summary.paidLoansCount} saldados ·{' '}
                    {summary.applicationsCount} solicitudes
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
                    <span className="font-semibold">Cuotas y Cobranza</span>
                    <FileSpreadsheet className="w-4 h-4 text-amber-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {summary.installmentsCount}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary.collectionAccountsCount} cuentas de cobro · {summary.documentsCount} docs digitales
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
                    <span className="font-semibold">Pagos Realizados</span>
                    <Wallet className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                    {summary.paymentsCount}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary.appliedPaymentsCount} aplicados · {summary.pendingPaymentsCount} en verificación
                  </p>
                </div>
              </div>

              {/* Financial Portfolio Breakdown */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#123B65] dark:text-[#20C4E8]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      Conciliación Financiera y Contable a Migrar (DOP)
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Integrado con Estados Financieros, Cobros y Dashboard
                  </span>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white dark:bg-slate-900 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      Total Cartera Financiada / Desembolsada
                    </p>
                    <p className="text-base font-extrabold text-slate-900 dark:text-white mt-1">
                      {formatDop(summary.totalPortfolioFinancedDop)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Neto entregado: {formatDop(summary.totalPortfolioDisbursedDop)}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      Balance de Capital Activo en Calle
                    </p>
                    <p className="text-base font-extrabold text-[#168BFF] mt-1">
                      {formatDop(summary.totalPrincipalBalanceDop)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Capital recuperado: {formatDop(summary.totalPrincipalRecoveredDop)}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">
                      Total Recaudado en Pagos Aplicados
                    </p>
                    <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                      {formatDop(summary.totalPaymentsCollectedDop)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Intereses: {formatDop(summary.totalInterestCollectedDop)} · Mora:{' '}
                      {formatDop(summary.totalLateFeeCollectedDop)}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Los registros se adaptan automáticamente al esquema de AxyCore sin duplicar IDs.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={runningMigration}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => void handleRunMigration()}
              disabled={runningMigration || loadingPreview}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#123B65] to-[#168BFF] hover:opacity-95 text-white text-xs font-bold shadow-md flex items-center gap-2 transition disabled:opacity-50"
            >
              {runningMigration ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando Migración...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  Ejecutar / Actualizar Migración Completa
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
