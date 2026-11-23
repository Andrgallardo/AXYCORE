import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock,
  DollarSign,
  Target,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type ImpulsaChartDatasets,
  type ImpulsaCommercialMetrics,
  type ImpulsaInternalAlert,
} from '../../types/impulsa';

interface ImpulsaOverviewTabProps {
  metrics: ImpulsaCommercialMetrics;
  charts: ImpulsaChartDatasets;
  alerts: ImpulsaInternalAlert[];
  onSelectOpportunityById: (oppId: string) => void;
  onGoToTab: (tab: 'opportunities' | 'crm' | 'assistant' | 'reports' | 'automation') => void;
}

function fmtDop(val: number): string {
  return `RD$${Math.round(val || 0).toLocaleString('en-US')}`;
}

function fmtCompactDop(val: number): string {
  const n = Number(val) || 0;
  if (Math.abs(n) >= 1_000_000) return `RD$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `RD$${(n / 1_000).toFixed(0)}k`;
  return `RD$${Math.round(n)}`;
}

export const ImpulsaOverviewTab: React.FC<ImpulsaOverviewTabProps> = ({
  metrics,
  charts,
  alerts,
  onSelectOpportunityById,
  onGoToTab,
}) => {
  const funnelStages = [
    { label: 'Identificadas', value: metrics.totalOpportunities, color: 'bg-slate-800 dark:bg-slate-200' },
    { label: 'Nuevas', value: metrics.newOpportunities, color: 'bg-blue-600' },
    { label: 'Pend. Gestión', value: metrics.pendingManagement, color: 'bg-amber-500' },
    { label: 'Contactadas', value: metrics.contactedOpportunities, color: 'bg-indigo-600' },
    { label: 'Interesados', value: metrics.interestedClients, color: 'bg-cyan-600' },
    { label: 'Solicitudes', value: metrics.applicationsGenerated, color: 'bg-violet-600' },
    { label: 'En Evaluación', value: metrics.applicationsInEvaluation, color: 'bg-sky-600' },
    { label: 'Aprobadas', value: metrics.approvedCredits, color: 'bg-teal-600' },
    { label: 'Desembolsadas', value: metrics.disbursedCredits, color: 'bg-emerald-600' },
  ];

  const primaryKpis = [
    {
      label: 'Total Oportunidades',
      value: metrics.totalOpportunities.toLocaleString('en-US'),
      sub: `${metrics.activeCriticalCount} críticas · ${metrics.activeHighCount} altas`,
      icon: Target,
      accent: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Monto Potencial Colocación',
      value: fmtDop(metrics.potentialPlacementAmountDop),
      sub: `Ticket promedio ${fmtDop(metrics.averageTicketDop)}`,
      icon: DollarSign,
      accent: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      label: 'Monto Efectivamente Desembolsado',
      value: fmtDop(metrics.disbursedAmountDop),
      sub: `${metrics.disbursedCredits} crédito(s) generado(s) por Impulsa`,
      icon: CheckCircle2,
      accent: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Tasa de Conversión Comercial',
      value: `${metrics.conversionRatePct.toFixed(1)}%`,
      sub: `${metrics.applicationConversionRatePct.toFixed(1)}% convertidas a solicitud`,
      icon: TrendingUp,
      accent: 'text-teal-600 dark:text-teal-400',
    },
    {
      label: 'Rentabilidad Bruta Estimada',
      value: fmtDop(metrics.estimatedProfitabilityDop),
      sub: 'Margen financiero estimado sobre pipeline vigente',
      icon: ArrowUpRight,
      accent: 'text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Primary Executive KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {primaryKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {kpi.label}
                </span>
                <Icon className={`w-4 h-4 shrink-0 ${kpi.accent}`} />
              </div>
              <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {kpi.value}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{kpi.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Commercial Funnel Counters (Real Pipeline) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Embudo Comercial Real de Impulsa
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cifras calculadas en vivo desde oportunidades persistidas, solicitudes y préstamos de AxyCore.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onGoToTab('crm')}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Abrir Bandeja de Gestión
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5">
          {funnelStages.map((stage) => (
            <div
              key={stage.label}
              className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 flex flex-col justify-between"
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2 h-2 rounded-full ${stage.color}`} />
                <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 leading-tight">
                  {stage.label}
                </span>
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                {stage.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Internal Alerts Panel */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Alertas Internas de Seguimiento Comercial ({alerts.length})
              </h3>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Solo uso interno · Sin envíos automáticos externos al cliente
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {alerts.slice(0, 6).map((al) => (
              <button
                key={al.id}
                type="button"
                onClick={() => onSelectOpportunityById(al.opportunityId)}
                className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wide ${
                      al.severity === 'CRITICA'
                        ? 'text-red-600 dark:text-red-400'
                        : al.severity === 'ALTA'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {al.severity} · {al.opportunityCode}
                  </span>
                  {al.dueDate && (
                    <span className="text-[11px] text-slate-500 tabular-nums inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {al.dueDate}
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {al.title}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                  {al.detail}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Charts Row 1: Evolution & Conversion by Period */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Evolución de Oportunidades y Colocación
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Detectadas, solicitudes generadas y desembolsos efectivos por mes
            </p>
          </div>
          {charts.evolutionByMonth.length === 0 ? (
            <EmptyChartState text="Sin datos históricos todavía. Ejecuta el detector para registrar evolución real." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.evolutionByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="detectadas" name="Detectadas" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="solicitudes" name="Solicitudes" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="desembolsadas"
                    name="Desembolsadas"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 3.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Conversión Comercial por Período (%)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Porcentaje de oportunidades convertidas en desembolso efectivo
            </p>
          </div>
          {charts.conversionByPeriod.length === 0 ? (
            <EmptyChartState text="Sin conversiones registradas por período aún." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={charts.conversionByPeriod}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="convertidas" name="Solicitudes" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="tasaConversionPct"
                    name="Conversión (%)"
                    stroke="#0d9488"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Charts Row 2: By Product & By Branch/Province */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Oportunidades por Producto Crediticio
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monto potencial (RD$) vs monto desembolsado sobre catálogo real vigente
            </p>
          </div>
          {charts.byProduct.length === 0 ? (
            <EmptyChartState text="No existen oportunidades clasificadas por producto todavía." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.byProduct}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                  <XAxis dataKey="productLabel" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtCompactDop} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: unknown) => fmtDop(Number(value))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="potentialAmount" name="Potencial (RD$)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="disbursedAmount" name="Desembolsado (RD$)" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Oportunidades por Sucursal / Provincia
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Distribución geográfica real de la cartera con potencial comercial
            </p>
          </div>
          {charts.byBranch.length === 0 ? (
            <EmptyChartState text="Sin distribución geográfica disponible todavía." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.byBranch.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.4} />
                  <XAxis type="number" tickFormatter={fmtCompactDop} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="branch" type="category" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: unknown) => fmtDop(Number(value))} />
                  <Bar dataKey="potentialAmount" name="Monto Potencial" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Officer Performance + Renewals vs New Clients + Impulsa Share */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Officers Table */}
        <div className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Oportunidades y Conversión por Oficial de Negocios
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seguimiento real de carga asignada, contactos, solicitudes y desembolsos
              </p>
            </div>
          </div>
          {charts.byOfficer.length === 0 ? (
            <EmptyChartState text="Sin oportunidades asignadas a oficiales aún." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-medium">Oficial</th>
                    <th className="py-2 px-2 font-medium text-right">Asignadas</th>
                    <th className="py-2 px-2 font-medium text-right">Contactadas</th>
                    <th className="py-2 px-2 font-medium text-right">Solicitudes</th>
                    <th className="py-2 px-2 font-medium text-right">Desembolsadas</th>
                    <th className="py-2 px-2 font-medium text-right">Potencial</th>
                    <th className="py-2 pl-2 font-medium text-right">Conv. %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {charts.byOfficer.map((off) => (
                    <tr key={off.officerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3 font-medium text-slate-900 dark:text-white">
                        {off.officerName}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{off.assigned}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{off.contacted}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{off.converted}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        {off.disbursed}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums">
                        {fmtDop(off.potentialAmount)}
                      </td>
                      <td className="py-2.5 pl-2 text-right tabular-nums font-semibold">
                        {off.conversionRatePct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Renewals vs New Clients & Impulsa Placements Share */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Renovaciones vs Clientes Nuevos
            </h3>
            <div className="space-y-3">
              {charts.renewalsVsNewClients.map((seg) => {
                const totalLoans = charts.renewalsVsNewClients.reduce((s, x) => s + x.count, 0);
                const pct = totalLoans > 0 ? Math.round((seg.count / totalLoans) * 100) : 0;
                return (
                  <div key={seg.segment}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {seg.segment}
                      </span>
                      <span className="tabular-nums font-semibold text-slate-900 dark:text-white">
                        {seg.count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          seg.segment.startsWith('Renovaciones') ? 'bg-blue-600' : 'bg-slate-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                      Colocación histórica: {fmtDop(seg.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              Colocaciones Generadas por Impulsa
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Participación real sobre la cartera desembolsada de la institución
            </p>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {charts.impulsaPlacementsShare.shareByAmountPct.toFixed(1)}%
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {charts.impulsaPlacementsShare.impulsaGeneratedLoansCount} de{' '}
                {charts.impulsaPlacementsShare.totalPortfolioLoansCount} préstamos
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-3">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{
                  width: `${Math.min(100, charts.impulsaPlacementsShare.shareByAmountPct)}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              <span>Impulsa: {fmtDop(charts.impulsaPlacementsShare.impulsaGeneratedAmountDop)}</span>
              <span>Cartera: {fmtDop(charts.impulsaPlacementsShare.totalPortfolioAmountDop)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Category Distribution Breakdown */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Oportunidades por Motor de Detección (7 Categorías)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Volumen real detectado en cada regla comercial responsable
            </p>
          </div>
          <button
            type="button"
            onClick={() => onGoToTab('opportunities')}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Explorar expedientes
          </button>
        </div>
        {charts.byCategory.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
            <AlertTriangle className="w-4 h-4 text-slate-400" />
            Aún no se han detectado oportunidades. Presiona “Ejecutar Detector” en la barra superior para analizar la cartera real.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {charts.byCategory.map((cat) => (
              <div
                key={cat.category}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5"
              >
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {cat.label}
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {cat.count}
                  </span>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                    {fmtDop(cat.potentialAmount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyChartState: React.FC<{ text: string }> = ({ text }) => (
  <div className="h-56 flex items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-800 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
    {text}
  </div>
);
