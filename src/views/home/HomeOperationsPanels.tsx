import React from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  ClipboardCheck,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  CollectionsOverviewSummary,
  InstitutionalPerformanceItem,
  TeamProductivitySummary,
} from '../../engine/homeDashboardEngine';
import type { CurrencyCode, NavSectionId } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

export interface HomeShortcutItem {
  id: string;
  label: string;
  subtitle: string;
  metricBadge?: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

export function InstitutionalPerformanceSection({
  items,
}: {
  items: InstitutionalPerformanceItem[];
}) {
  return (
    <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#20C4E8]/16 shadow-[0_1px_2px_rgba(11,31,58,0.04)] p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#168BFF]" />
            <span>Rendimiento de la institución</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Eficiencia operativa por área de gestión calculada sobre registros reales
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl bg-[#F4F7FB]/80 dark:bg-[#040C1E]/70 border border-slate-200/75 dark:border-white/[0.08] space-y-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-[#0B1F3A] dark:text-white">
                {item.label}
              </span>
              <span className="font-mono tabular-nums text-base font-bold text-[#168BFF] dark:text-[#20C4E8]">
                {item.pct !== null ? `${item.pct}%` : 'Sin datos'}
              </span>
            </div>

            <div className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#123B65] via-[#168BFF] to-[#20C4E8] transition-all duration-300"
                style={{ width: `${item.pct !== null ? Math.min(100, Math.max(3, item.pct)) : 0}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <span className="font-mono tabular-nums truncate">{item.countLabel}</span>
              <span className="shrink-0 font-medium text-slate-500 dark:text-slate-400">
                {item.trendText}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CollectionsSummaryPanel({
  summary,
  currency,
  canViewCollections,
  onNavigate,
}: {
  summary: CollectionsOverviewSummary;
  currency: CurrencyCode;
  canViewCollections: boolean;
  onNavigate: (sec: NavSectionId) => void;
}) {
  const maxStageAmount = Math.max(...summary.recoveryByStage.map((s) => s.amount), 0);

  return (
    <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#20C4E8]/16 shadow-[0_1px_2px_rgba(11,31,58,0.04)] p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-[#168BFF]" />
            <span>Resumen de Cobros ({currency})</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cumplimiento de meta diaria, contactabilidad, promesas y recuperación por etapa de mora
          </p>
        </div>
        {canViewCollections && (
          <button
            type="button"
            onClick={() => onNavigate('cobranza_daily')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#168BFF] hover:underline cursor-pointer"
          >
            <span>Abrir módulo de cobros</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!canViewCollections ? (
        <div className="p-6 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/60 text-xs text-slate-600 dark:text-slate-400">
          El resumen operativo de cobranza está reservado para roles con acceso a cartera de cobros.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 dark:divide-white/[0.08] rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/75 border border-slate-200/75 dark:border-white/[0.08]">
            <div className="p-4 space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Cobros del día
              </span>
              <p className="font-mono tabular-nums text-base font-bold text-[#0B1F3A] dark:text-white">
                {formatMoney(summary.dailyConfirmedAmount, currency)}
              </p>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                Exigible hoy: {formatMoney(summary.dailyDueAmount, currency)}
              </span>
            </div>

            <div className="p-4 space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Meta diaria
              </span>
              <p className="font-mono tabular-nums text-base font-bold text-[#123B65] dark:text-[#20C4E8]">
                {summary.dailyTargetAmount !== null
                  ? formatMoney(summary.dailyTargetAmount, currency)
                  : 'Sin meta'}
              </p>
              <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 block">
                {summary.dailyTargetPct !== null
                  ? `${summary.dailyTargetPct}% de alcance`
                  : 'Sin meta asignada'}
              </span>
            </div>

            <div className="p-4 space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Clientes contactados
              </span>
              <p className="font-mono tabular-nums text-base font-bold text-[#0B1F3A] dark:text-white">
                {summary.contactedClientsCount}
              </p>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                {summary.effectiveContactCount} contacto(s) efectivo(s)
              </span>
            </div>

            <div className="p-4 space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Compromisos de pago
              </span>
              <p className="font-mono tabular-nums text-base font-bold text-emerald-700 dark:text-emerald-400">
                {summary.activePromisesCount} vigente(s)
              </p>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 block">
                {formatMoney(summary.activePromisesAmount, currency)}
              </span>
            </div>

            <div className="p-4 space-y-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
                Promesas incumplidas
              </span>
              <p className="font-mono tabular-nums text-base font-bold text-rose-700 dark:text-rose-400">
                {summary.brokenPromisesCount}
              </p>
              <span className="font-mono tabular-nums text-[11px] text-rose-600 dark:text-rose-400 block">
                {formatMoney(summary.brokenPromisesAmount, currency)}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#0B1F3A] dark:text-white">
                Recuperación por etapa de mora ({currency})
              </span>
              <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                Pagos aplicados en el período por etapa actual de la cuenta
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.recoveryByStage.map((st) => {
                const widthPct = maxStageAmount > 0 ? Math.max(4, Math.round((st.amount / maxStageAmount) * 100)) : 0;
                return (
                  <div
                    key={st.stage}
                    className="p-3 rounded-xl border border-slate-200/75 dark:border-white/[0.07] bg-white dark:bg-[#040C1E]/50 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {st.label}
                      </span>
                      <span className="font-mono tabular-nums font-bold text-[#0B1F3A] dark:text-[#20C4E8]">
                        {formatMoney(st.amount, currency)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#168BFF]"
                        style={{ width: `${st.amount > 0 ? widthPct : 0}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      <span>{st.paymentsCount} pago(s)</span>
                      <span>{st.accountsCount} cuenta(s) en etapa</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function TeamProductivityPanel({
  team,
  onNavigate,
}: {
  team: TeamProductivitySummary;
  onNavigate: (sec: NavSectionId) => void;
}) {
  return (
    <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#20C4E8]/16 shadow-[0_1px_2px_rgba(11,31,58,0.04)] p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-[#168BFF]" />
            <span>Productividad del Equipo</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {team.canViewFullTeam
              ? 'Actividad consolidada del personal interno y rendimiento por departamento'
              : 'Indicadores de actividad personal y carga institucional respetando privacidad RBAC'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-[#20C4E8]" />
          <span>{team.canViewFullTeam ? 'Vista Gerencial Completa' : 'Vista Acotada a tu Rol'}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 dark:divide-white/[0.08] rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/75 border border-slate-200/75 dark:border-white/[0.08]">
        <div className="p-4">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
            {team.canViewFullTeam ? 'Usuarios activos' : 'Sesión activa'}
          </span>
          <p className="font-mono tabular-nums text-xl font-bold text-[#0B1F3A] dark:text-white mt-0.5">
            {team.activeUsersCount}
          </p>
        </div>
        <div className="p-4">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
            Operaciones realizadas
          </span>
          <p className="font-mono tabular-nums text-xl font-bold text-[#168BFF] mt-0.5">
            {team.operationsCount}
          </p>
        </div>
        <div className="p-4">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
            Solicitudes procesadas
          </span>
          <p className="font-mono tabular-nums text-xl font-bold text-[#0B1F3A] dark:text-white mt-0.5">
            {team.processedApplicationsCount}
          </p>
        </div>
        <div className="p-4">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
            Gestiones de cobros
          </span>
          <p className="font-mono tabular-nums text-xl font-bold text-[#0B1F3A] dark:text-white mt-0.5">
            {team.collectionActionsCount}
          </p>
        </div>
        <div className="p-4 col-span-2 sm:col-span-1">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
            Casos pendientes
          </span>
          <p className="font-mono tabular-nums text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
            {team.pendingCasesCount}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-[#0B1F3A] dark:text-white flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-[#168BFF]" />
          <span>Rendimiento por departamento</span>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-white/[0.08] text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-semibold">Departamento</th>
                <th className="py-2 px-3 font-semibold text-right">Completadas</th>
                <th className="py-2 px-3 font-semibold text-right">Pendientes</th>
                <th className="py-2 px-3 font-semibold w-44">Cumplimiento</th>
                <th className="py-2 pl-3 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {team.departments.map((dept) => (
                <tr key={dept.id} className="hover:bg-[#F4F7FB]/70 dark:hover:bg-[#0E1D40]/40">
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-[#0B1F3A] dark:text-white">{dept.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{dept.summary}</p>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                    {dept.completedCount}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                    {dept.pendingCount}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#168BFF] to-[#20C4E8]"
                          style={{ width: `${dept.efficiencyPct ?? 0}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-700 dark:text-slate-300 w-10 text-right">
                        {dept.efficiencyPct !== null ? `${dept.efficiencyPct}%` : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => onNavigate(dept.targetSection)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#168BFF] hover:underline cursor-pointer whitespace-nowrap"
                    >
                      <span>Abrir</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function SmartShortcutsSection({ shortcuts }: { shortcuts: HomeShortcutItem[] }) {
  if (shortcuts.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#20C4E8]/16 shadow-[0_1px_2px_rgba(11,31,58,0.04)] p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#168BFF]" />
            <span>Accesos Inteligentes</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Flujos operativos frecuentes habilitados para tu perfil de acceso
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {shortcuts.map((sc) => {
          const Icon = sc.icon;
          return (
            <button
              key={sc.id}
              type="button"
              onClick={sc.onClick}
              className="group p-4 rounded-xl border border-slate-200/80 dark:border-white/10 bg-[#F4F7FB]/65 dark:bg-[#040C1E]/65 hover:bg-white dark:hover:bg-[#0E1D40] hover:border-[#168BFF]/40 transition-all text-left flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-[#0B1F3A] text-[#20C4E8] shrink-0 group-hover:bg-[#168BFF] group-hover:text-white transition-colors">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                    {sc.label}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {sc.subtitle}
                  </p>
                  {sc.metricBadge && (
                    <span className="font-mono tabular-nums text-[11px] font-semibold text-[#168BFF] dark:text-[#20C4E8] block mt-0.5">
                      {sc.metricBadge}
                    </span>
                  )}
                </div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#168BFF] shrink-0 transition-colors" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
