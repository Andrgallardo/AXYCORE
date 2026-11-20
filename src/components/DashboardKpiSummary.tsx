import React, { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, TrendingUp } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { formatMoney } from '../utils/formatters';
import type { ApplicationRecord, LoanRecord } from '../types/axycore';

interface DashboardKpiSummaryProps {
  applications: ApplicationRecord[];
  loans: LoanRecord[];
}

interface MonthlyOriginationPoint {
  monthKey: string;
  monthLabel: string;
  originatedCount: number;
  approvedCount: number;
  rejectedCount: number;
  inProcessCount: number;
  decidedCount: number;
  approvalRatePct: number;
  requestedDop: number;
  approvedDop: number;
  requestedUsd: number;
  approvedUsd: number;
}

const APPROVED_STATUSES = new Set([
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'FORMALIZADA',
  'DESEMBOLSADA',
]);

const MONTH_NAMES_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

function extractDateFromTimestamp(ts: unknown): Date | null {
  if (!ts) return null;
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'object' && ts !== null) {
    if ('toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
      const d = (ts as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if ('seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
      return new Date((ts as { seconds: number }).seconds * 1000);
    }
  }
  return null;
}

function formatMonthLabel(monthKey: string): string {
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const year = parts[0];
  const monthIdx = Number(parts[1]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return monthKey;
  return `${MONTH_NAMES_ES[monthIdx]} ${year.slice(2)}`;
}

function formatCompactMoney(value: number, currency: 'DOP' | 'USD'): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  if (Math.abs(value) >= 1_000_000) {
    return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${prefix}${(value / 1_000).toFixed(0)}k`;
  }
  return `${prefix}${value.toFixed(0)}`;
}

export function DashboardKpiSummary({ applications, loans }: DashboardKpiSummaryProps) {
  const { darkMode } = useAxyCore();
  const [volumeMetric, setVolumeMetric] = useState<'COUNT' | 'DOP' | 'USD'>('COUNT');
  const [approvalView, setApprovalView] = useState<'TREND' | 'BREAKDOWN'>('TREND');

  const summary = useMemo(() => {
    const submitted = applications.filter((a) => a.status !== 'BORRADOR');
    const approvedApps = submitted.filter((a) => APPROVED_STATUSES.has(a.status));
    const rejectedApps = submitted.filter((a) => a.status === 'RECHAZADA');
    const returnedApps = submitted.filter((a) => a.status === 'DEVUELTA');
    const inProcessApps = submitted.filter((a) =>
      ['RECIBIDA', 'EN_EVALUACION', 'EN_COMITE'].includes(a.status)
    );
    const prequalifiedApps = submitted.filter((a) => a.prequalificationStatus === 'PREOFERTA');

    const decidedCount = approvedApps.length + rejectedApps.length;
    const approvalRatePct =
      decidedCount > 0 ? Number(((approvedApps.length / decidedCount) * 100).toFixed(1)) : 0;
    const approvalOverTotalPct =
      submitted.length > 0 ? Number(((approvedApps.length / submitted.length) * 100).toFixed(1)) : 0;
    const prequalificationRatePct =
      submitted.length > 0
        ? Number(((prequalifiedApps.length / submitted.length) * 100).toFixed(1))
        : 0;

    const dopApps = submitted.filter((a) => a.currency === 'DOP');
    const usdApps = submitted.filter((a) => a.currency === 'USD');
    const avgTicketDop =
      dopApps.length > 0
        ? dopApps.reduce((s, a) => s + (Number(a.requestedAmount) || 0), 0) / dopApps.length
        : 0;
    const avgTicketUsd =
      usdApps.length > 0
        ? usdApps.reduce((s, a) => s + (Number(a.requestedAmount) || 0), 0) / usdApps.length
        : 0;

    const monthMap = new Map<string, MonthlyOriginationPoint>();
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    submitted.forEach((app) => {
      const createdDate = extractDateFromTimestamp(app.createdAt) ?? now;
      const monthKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      const existing = monthMap.get(monthKey) ?? {
        monthKey,
        monthLabel: formatMonthLabel(monthKey),
        originatedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        inProcessCount: 0,
        decidedCount: 0,
        approvalRatePct: 0,
        requestedDop: 0,
        approvedDop: 0,
        requestedUsd: 0,
        approvedUsd: 0,
      };

      existing.originatedCount += 1;
      const isApproved = APPROVED_STATUSES.has(app.status);
      const isRejected = app.status === 'RECHAZADA';

      if (isApproved) existing.approvedCount += 1;
      else if (isRejected) existing.rejectedCount += 1;
      else existing.inProcessCount += 1;

      existing.decidedCount = existing.approvedCount + existing.rejectedCount;
      existing.approvalRatePct =
        existing.decidedCount > 0
          ? Number(((existing.approvedCount / existing.decidedCount) * 100).toFixed(1))
          : 0;

      const appReq = Number(app.requestedAmount) || 0;
      const approvedAmt = Number(app.recommendedAmount ?? app.requestedAmount) || 0;
      if (app.currency === 'DOP') {
        existing.requestedDop += appReq;
        if (isApproved) existing.approvedDop += approvedAmt;
      } else {
        existing.requestedUsd += appReq;
        if (isApproved) existing.approvedUsd += approvedAmt;
      }

      monthMap.set(monthKey, existing);
    });

    const monthlySeries = Array.from(monthMap.values()).sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey)
    );

    const currentMonthStats = monthMap.get(currentMonthKey) ?? {
      originatedCount: 0,
      requestedDop: 0,
      requestedUsd: 0,
    };

    const statusBreakdown = [
      {
        name: 'Aprobadas / Desembolsadas',
        value: approvedApps.length,
        color: '#059669',
      },
      {
        name: 'En Evaluación / Comité',
        value: inProcessApps.length,
        color: '#0284c7',
      },
      {
        name: 'Devueltas',
        value: returnedApps.length,
        color: '#d97706',
      },
      {
        name: 'Rechazadas',
        value: rejectedApps.length,
        color: '#dc2626',
      },
    ].filter((item) => item.value > 0);

    return {
      submittedCount: submitted.length,
      approvedCount: approvedApps.length,
      rejectedCount: rejectedApps.length,
      inProcessCount: inProcessApps.length + returnedApps.length,
      decidedCount,
      approvalRatePct,
      approvalOverTotalPct,
      prequalificationRatePct,
      avgTicketDop,
      avgTicketUsd,
      disbursedLoansCount: loans.length,
      currentMonthStats,
      monthlySeries,
      statusBreakdown,
    };
  }, [applications, loans]);

  const axisTickColor = darkMode ? '#94a3b8' : '#64748b';
  const gridStroke = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)';

  if (summary.submittedCount === 0) {
    return null;
  }

  return (
    <section className="space-y-5" aria-label="Resumen ejecutivo de KPIs y gráficos">
      {/* Executive KPI Summary Strip — The Verdict Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl axy-surface">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
            Tasa de Aprobación (Decididas)
          </p>
          <p className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1.5 tracking-tight">
            {summary.decidedCount > 0 ? `${summary.approvalRatePct.toFixed(1)}%` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 tabular-nums">
            {summary.decidedCount > 0
              ? `${summary.approvedCount} aprobadas · ${summary.rejectedCount} rechazadas`
              : `${summary.inProcessCount} expedientes en proceso sin decisión final`}
          </p>
        </div>

        <div className="p-5 rounded-2xl axy-surface">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
            Conversión Total a Aprobación
          </p>
          <p className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400 mt-1.5 tracking-tight">
            {summary.approvalOverTotalPct.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 tabular-nums">
            {summary.approvedCount} de {summary.submittedCount} solicitudes enviadas
          </p>
        </div>

        <div className="p-5 rounded-2xl axy-surface">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
            Originación Mes en Curso
          </p>
          <p className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1.5 tracking-tight">
            {summary.currentMonthStats.originatedCount} solicitudes
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1.5 truncate">
            {formatMoney(summary.currentMonthStats.requestedDop, 'DOP')} ·{' '}
            {formatMoney(summary.currentMonthStats.requestedUsd, 'USD')}
          </p>
        </div>

        <div className="p-5 rounded-2xl axy-surface">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
            Preoferta V2 · Ticket Promedio
          </p>
          <p className="text-2xl sm:text-[26px] font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1.5 tracking-tight">
            {summary.prequalificationRatePct.toFixed(1)}%
          </p>
          <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-1.5 truncate">
            Prom: {formatMoney(summary.avgTicketDop, 'DOP')} · {formatMoney(summary.avgTicketUsd, 'USD')}
          </p>
        </div>
      </div>

      {/* Interactive Recharts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Monthly Origination Volume Chart */}
        <div className="lg:col-span-7 p-5 sm:p-6 rounded-2xl axy-surface space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-950 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-sky-600 shrink-0" />
                <span>Volumen de Originación Mensual</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solicitudes originadas vs. aprobadas por mes calendario
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl axy-surface-tonal text-xs">
              <button
                type="button"
                onClick={() => setVolumeMetric('COUNT')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  volumeMetric === 'COUNT'
                    ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Cantidad
              </button>
              <button
                type="button"
                onClick={() => setVolumeMetric('DOP')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  volumeMetric === 'DOP'
                    ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Monto DOP
              </button>
              <button
                type="button"
                onClick={() => setVolumeMetric('USD')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  volumeMetric === 'USD'
                    ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Monto USD
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary.monthlySeries}
                margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fill: axisTickColor, fontSize: 11 }}
                  axisLine={{ stroke: gridStroke }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: axisTickColor, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val: number) =>
                    volumeMetric === 'COUNT'
                      ? String(val)
                      : formatCompactMoney(val, volumeMetric)
                  }
                />
                <Tooltip
                  cursor={{ fill: darkMode ? 'rgba(30,41,59,0.5)' : 'rgba(241,245,249,0.7)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    return (
                      <div className="p-3 rounded-xl axy-surface text-xs space-y-1">
                        <p className="font-semibold text-slate-900 dark:text-white">{label}</p>
                        {payload.map((entry) => {
                          const raw = Number(entry.value ?? 0);
                          const formatted =
                            volumeMetric === 'COUNT'
                              ? `${raw} solicitudes`
                              : formatMoney(raw, volumeMetric);
                          return (
                            <p
                              key={String(entry.dataKey)}
                              className="flex items-center justify-between gap-4 font-mono tabular-nums text-slate-700 dark:text-slate-200"
                            >
                              <span className="font-sans text-slate-500 dark:text-slate-400">
                                {entry.name}:
                              </span>
                              <span className="font-semibold">{formatted}</span>
                            </p>
                          );
                        })}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {volumeMetric === 'COUNT' && (
                  <>
                    <Bar
                      dataKey="originatedCount"
                      name="Originadas"
                      fill="#0066FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Bar
                      dataKey="approvedCount"
                      name="Aprobadas"
                      fill="#00B8FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                  </>
                )}
                {volumeMetric === 'DOP' && (
                  <>
                    <Bar
                      dataKey="requestedDop"
                      name="Solicitado DOP"
                      fill="#0066FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Bar
                      dataKey="approvedDop"
                      name="Aprobado DOP"
                      fill="#00B8FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                  </>
                )}
                {volumeMetric === 'USD' && (
                  <>
                    <Bar
                      dataKey="requestedUsd"
                      name="Solicitado USD"
                      fill="#0066FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                    <Bar
                      dataKey="approvedUsd"
                      name="Aprobado USD"
                      fill="#00B8FF"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={42}
                    />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Credit Approval Rate Chart */}
        <div className="lg:col-span-5 p-5 sm:p-6 rounded-2xl axy-surface space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-950 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Tasa de Aprobación de Solicitudes</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tendencia mensual y distribución de dictámenes
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 rounded-xl axy-surface-tonal text-xs">
              <button
                type="button"
                onClick={() => setApprovalView('TREND')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  approvalView === 'TREND'
                    ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Tendencia %
              </button>
              <button
                type="button"
                onClick={() => setApprovalView('BREAKDOWN')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  approvalView === 'BREAKDOWN'
                    ? 'bg-[var(--axy-surface)] text-[#0052CC] dark:text-[#00D1FF] shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                Desglose
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            {approvalView === 'TREND' ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={summary.monthlySeries}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="axyApprovalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00B8FF" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0066FF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fill: axisTickColor, fontSize: 11 }}
                    axisLine={{ stroke: gridStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: axisTickColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0]?.payload as MonthlyOriginationPoint | undefined;
                      if (!pt) return null;
                      return (
                        <div className="p-3 rounded-xl axy-surface text-xs space-y-1 font-mono tabular-nums">
                          <p className="font-sans font-semibold text-slate-900 dark:text-white">
                            {label}
                          </p>
                          <p className="text-[#0066FF] dark:text-[#00D1FF]">
                            Tasa Aprobación: {pt.approvalRatePct.toFixed(1)}%
                          </p>
                          <p className="text-slate-600 dark:text-slate-300">
                            Aprobadas: {pt.approvedCount} · Rechazadas: {pt.rejectedCount}
                          </p>
                          <p className="text-slate-500">En Proceso: {pt.inProcessCount}</p>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Area
                    type="monotone"
                    dataKey="approvalRatePct"
                    name="Tasa de Aprobación (%)"
                    stroke="#00B8FF"
                    strokeWidth={2}
                    fill="url(#axyApprovalFill)"
                  />
                  <Line
                    type="monotone"
                    dataKey="approvalRatePct"
                    legendType="none"
                    stroke="#0066FF"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#00D1FF', strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-12 items-center h-full gap-2">
                <div className="sm:col-span-7 h-56 sm:h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary.statusBreakdown}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {summary.statusBreakdown.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const item = payload[0];
                          const val = Number(item.value ?? 0);
                          const pct =
                            summary.submittedCount > 0
                              ? ((val / summary.submittedCount) * 100).toFixed(1)
                              : '0.0';
                          return (
                            <div className="p-2.5 rounded-xl axy-surface text-xs font-mono tabular-nums">
                              <p className="font-sans font-semibold text-slate-900 dark:text-white">
                                {item.name}
                              </p>
                              <p className="text-slate-600 dark:text-slate-300">
                                {val} ({pct}%)
                              </p>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="sm:col-span-5 space-y-2 text-xs">
                  {summary.statusBreakdown.map((item) => {
                    const pct =
                      summary.submittedCount > 0
                        ? ((item.value / summary.submittedCount) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <div key={item.name} className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 dark:text-slate-300 truncate">
                          {item.name}
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                          {item.value} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
