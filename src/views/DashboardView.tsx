import React, { useMemo, useState } from 'react';
import { AlertTriangle, Database, Filter, Layers, PlusCircle, RefreshCw } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { seedSyntheticDemoData } from '../services/axycoreStore';
import { APPLICATION_STATUS_LABELS, PRODUCT_LABELS, formatMoney } from '../utils/formatters';
import { DashboardKpiSummary } from '../components/DashboardKpiSummary';
import { RiskConcentrationHeatmap } from '../components/RiskConcentrationHeatmap';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import type {
  ApplicationStatus,
  ChannelType,
  CreditPolicyRecord,
  CurrencyCode,
  ProductCode,
  RiskBandCode,
} from '../types/axycore';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}
class DashboardErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Error capturado en Mapa de Riesgo y Originación:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <span>Ocurrió un problema temporal al visualizar los componentes gráficos</span>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 max-w-md mx-auto">
            {this.state.error?.message || 'Error inesperado en la renderización del mapa de calor.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reintentar carga</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function DashboardView() {
  const {
    applications,
    customers,
    loans,
    evaluations,
    userProfile,
    activeOrTestPolicy,
    setActiveSection,
    dataLoading,
  } = useAxyCore();

  const safePolicy = useMemo<CreditPolicyRecord>(() => {
    const fallback = DEFAULT_POLICY_V2 as unknown as CreditPolicyRecord;
    if (!activeOrTestPolicy) return fallback;
    const bands =
      Array.isArray(activeOrTestPolicy.riskBands) && activeOrTestPolicy.riskBands.length > 0
        ? activeOrTestPolicy.riskBands
        : fallback.riskBands;
    return {
      ...fallback,
      ...activeOrTestPolicy,
      riskBands: bands,
    };
  }, [activeOrTestPolicy]);

  const [filterProduct, setFilterProduct] = useState<string>('ALL');
  const [filterCurrency, setFilterCurrency] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterChannel, setFilterChannel] = useState<string>('ALL');
  const [filterBand, setFilterBand] = useState<string>('ALL');
  const [filterUser, setFilterUser] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const uniqueUsers = useMemo(() => {
    const map = new Map<string, string>();
    applications.forEach((a) => {
      if (a.createdBy) map.set(a.createdBy, a.createdByName || a.createdBy);
    });
    return Array.from(map.entries());
  }, [applications]);

  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      if (filterProduct !== 'ALL' && app.productCode !== (filterProduct as ProductCode)) return false;
      if (filterCurrency !== 'ALL' && app.currency !== (filterCurrency as CurrencyCode)) return false;
      if (filterStatus !== 'ALL' && app.status !== (filterStatus as ApplicationStatus)) return false;
      if (filterChannel !== 'ALL' && app.channel !== (filterChannel as ChannelType)) return false;
      if (filterBand !== 'ALL' && app.latestRiskBand !== (filterBand as RiskBandCode)) return false;
      if (filterUser !== 'ALL' && app.createdBy !== filterUser) return false;
      if (dateFrom || dateTo) {
        const ts = app.createdAt as { seconds?: number } | string | undefined;
        let iso = '';
        if (typeof ts === 'string') {
          iso = ts.slice(0, 10);
        } else if (
          ts &&
          typeof ts === 'object' &&
          typeof ts.seconds === 'number' &&
          !Number.isNaN(ts.seconds)
        ) {
          try {
            iso = new Date(ts.seconds * 1000).toISOString().slice(0, 10);
          } catch {
            iso = '';
          }
        }
        if (dateFrom && iso && iso < dateFrom) return false;
        if (dateTo && iso && iso > dateTo) return false;
      }
      return true;
    });
  }, [applications, filterProduct, filterCurrency, filterStatus, filterChannel, filterBand, filterUser, dateFrom, dateTo]);

  const kpis = useMemo(() => {
    const received = filteredApps.filter((a) => a.status !== 'BORRADOR').length;
    const pending = filteredApps.filter((a) => ['RECIBIDA', 'DEVUELTA'].includes(a.status)).length;
    const prequalified = filteredApps.filter((a) => a.prequalificationStatus === 'PREOFERTA').length;
    const inEval = filteredApps.filter((a) => a.status === 'EN_EVALUACION').length;
    const inCommittee = filteredApps.filter((a) => a.status === 'EN_COMITE').length;
    const approved = filteredApps.filter((a) => a.status === 'APROBADA').length;
    const approvedCond = filteredApps.filter((a) => a.status === 'APROBADA_CONDICIONADA').length;
    const rejected = filteredApps.filter((a) => a.status === 'RECHAZADA').length;
    const pendingFormalization = filteredApps.filter((a) =>
      ['APROBADA', 'APROBADA_CONDICIONADA'].includes(a.status)
    ).length;
    const pendingDisbursement = filteredApps.filter((a) => a.status === 'FORMALIZADA').length;

    const requestedDop = filteredApps
      .filter((a) => a.currency === 'DOP')
      .reduce((s, a) => s + (Number(a.requestedAmount) || 0), 0);
    const requestedUsd = filteredApps
      .filter((a) => a.currency === 'USD')
      .reduce((s, a) => s + (Number(a.requestedAmount) || 0), 0);

    const approvedApps = filteredApps.filter((a) =>
      ['APROBADA', 'APROBADA_CONDICIONADA', 'FORMALIZADA', 'DESEMBOLSADA'].includes(a.status)
    );
    const approvedDop = approvedApps
      .filter((a) => a.currency === 'DOP')
      .reduce((s, a) => s + (Number(a.recommendedAmount ?? a.requestedAmount) || 0), 0);
    const approvedUsd = approvedApps
      .filter((a) => a.currency === 'USD')
      .reduce((s, a) => s + (Number(a.recommendedAmount ?? a.requestedAmount) || 0), 0);

    const disbursedLoans = loans.filter((l) => {
      if (filterProduct !== 'ALL' && l.productCode !== filterProduct) return false;
      if (filterCurrency !== 'ALL' && l.currency !== filterCurrency) return false;
      return true;
    });
    const disbursedDop = disbursedLoans
      .filter((l) => l.currency === 'DOP')
      .reduce((s, l) => s + (Number(l.totalFinancedPrincipal) || 0), 0);
    const disbursedUsd = disbursedLoans
      .filter((l) => l.currency === 'USD')
      .reduce((s, l) => s + (Number(l.totalFinancedPrincipal) || 0), 0);

    // Average evaluation hours based on real timestamps when available
    let avgEvalHours: number | null = null;
    const evalDurations: number[] = [];
    evaluations.forEach((ev) => {
      const c = ev.createdAt as { seconds?: number } | undefined;
      const u = ev.updatedAt as { seconds?: number } | undefined;
      if (c?.seconds && u?.seconds && u.seconds >= c.seconds) {
        evalDurations.push((u.seconds - c.seconds) / 3600);
      }
    });
    if (evalDurations.length > 0) {
      avgEvalHours = evalDurations.reduce((a, b) => a + b, 0) / evalDurations.length;
    }

    const bandCounts: Record<RiskBandCode, number> = {
      MUY_BAJO: 0,
      BAJO: 0,
      MODERADO: 0,
      MEDIO_ALTO: 0,
      ALTO: 0,
      CRITICO: 0,
    };
    filteredApps.forEach((a) => {
      if (a.latestRiskBand && a.latestRiskBand in bandCounts) {
        bandCounts[a.latestRiskBand as RiskBandCode]++;
      }
    });

    return {
      received,
      pending,
      prequalified,
      inEval,
      inCommittee,
      approved,
      approvedCond,
      rejected,
      pendingFormalization,
      pendingDisbursement,
      requestedDop,
      requestedUsd,
      approvedDop,
      approvedUsd,
      disbursedDop,
      disbursedUsd,
      avgEvalHours,
      bandCounts,
    };
  }, [filteredApps, loans, evaluations, filterProduct, filterCurrency]);

  const handleSeedDemo = async () => {
    if (!userProfile) return;
    setSeeding(true);
    setSeedMessage(null);
    try {
      const count = await seedSyntheticDemoData(userProfile, safePolicy);
      setSeedMessage(`Se generaron ${count} solicitudes sintéticas de demostración con scoring V2.`);
    } catch (err) {
      setSeedMessage(err instanceof Error ? err.message : 'Error generando datos de prueba.');
    } finally {
      setSeeding(false);
    }
  };

  if (dataLoading) {
    return (
      <div className="space-y-5">
        <div className="h-28 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 p-5 flex flex-col justify-between">
          <div className="h-3.5 w-48 rounded bg-slate-200/70 dark:bg-white/[0.06]" />
          <div className="grid grid-cols-4 gap-4">
            <div className="h-8 rounded bg-slate-100 dark:bg-white/[0.04]" />
            <div className="h-8 rounded bg-slate-100 dark:bg-white/[0.04]" />
            <div className="h-8 rounded bg-slate-100 dark:bg-white/[0.04]" />
            <div className="h-8 rounded bg-slate-100 dark:bg-white/[0.04]" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 p-4 flex flex-col justify-between"
            >
              <div className="h-3 w-24 rounded bg-slate-200/70 dark:bg-white/[0.06]" />
              <div className="h-6 w-14 rounded bg-slate-100 dark:bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#0052CC]/15 to-[#00B8FF]/20 flex items-center justify-center text-[#0052CC] dark:text-[#00B8FF]">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="font-display text-xl sm:text-[22px] font-bold tracking-tight text-slate-950 dark:text-white">
              Mapa de Riesgo y Originación
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Matriz de concentración geográfica y perfil socioeconómico · Indicadores en tiempo real · Política{' '}
            <span className="font-mono">{safePolicy.version || 'V2'}</span> ({safePolicy.status || 'ACTIVA'})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedDemo}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200/90 dark:border-[#00B8FF]/20 bg-white dark:bg-[#08132B] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#0E1D40] whitespace-nowrap cursor-pointer transition-colors"
          >
            <Database className="w-3.5 h-3.5 text-[#00B8FF]" />
            <span>{seeding ? 'Generando...' : 'Crear Operaciones de Prueba'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('new_application')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold whitespace-nowrap cursor-pointer transition-all shadow-sm"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Nueva Solicitud</span>
          </button>
        </div>
      </div>

      {seedMessage && (
        <div className="p-3.5 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 text-xs text-sky-800 dark:text-sky-200">
          {seedMessage}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filtros del Portafolio de Originación</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Fecha desde"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Fecha hasta"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.04]"
          />
          <select
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Todos los productos</option>
            {Object.entries(PRODUCT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={filterCurrency}
            onChange={(e) => setFilterCurrency(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Monedas (DOP/USD)</option>
            <option value="DOP">DOP</option>
            <option value="USD">USD</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Todos los estados</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={filterChannel}
            onChange={(e) => setFilterChannel(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Todos los canales</option>
            <option value="INTERNAL">Interno</option>
            <option value="EXTERNAL">Externo</option>
          </select>
          <select
            value={filterBand}
            onChange={(e) => setFilterBand(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Todas las bandas</option>
            {safePolicy.riskBands.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label} ({b.minScore}–{b.maxScore})
              </option>
            ))}
          </select>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          >
            <option value="ALL">Todos los usuarios</option>
            {uniqueUsers.map(([uid, name]) => (
              <option key={uid} value={uid}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {applications.length === 0 ? (
        <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-4">
          <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            Sin operaciones registradas en la base de datos
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            AxyCore no muestra cifras ficticias. Registre su primera solicitud de préstamo o cree operaciones sintéticas de prueba para verificar el flujo completo.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setActiveSection('new_application')}
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-sm font-medium cursor-pointer"
            >
              Registrar Primera Solicitud
            </button>
            <button
              type="button"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium cursor-pointer"
            >
              {seeding ? 'Generando...' : 'Crear Operaciones de Prueba'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <DashboardErrorBoundary>
            <DashboardKpiSummary applications={filteredApps} loans={loans} />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary>
            <RiskConcentrationHeatmap
              applications={filteredApps}
              customers={customers}
              loans={loans}
              policy={safePolicy}
            />
          </DashboardErrorBoundary>

          {/* Volume KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {[
              ['Solicitudes Recibidas', String(kpis.received), 'Expedientes enviados'],
              ['Pendientes de Inicio', String(kpis.pending), 'Recibidas o devueltas'],
              ['Precalificadas (Motor V2)', String(kpis.prequalified), 'Con preoferta preliminar'],
              ['En Evaluación', String(kpis.inEval), 'Bandeja analítica'],
              ['En Comité', String(kpis.inCommittee), 'Pendientes de decisión'],
              ['Aprobadas', String(kpis.approved), 'Sin condiciones pendientes'],
              ['Aprobadas Condicionadas', String(kpis.approvedCond), 'Con requisitos previos'],
              ['Rechazadas', String(kpis.rejected), 'Decisión documentada'],
              ['Pendientes Formalización', String(kpis.pendingFormalization), 'Contratos y firmas'],
              ['Pendientes Desembolso', String(kpis.pendingDisbursement), 'Expedientes formalizados'],
            ].map(([title, val, sub]) => (
              <div
                key={title}
                className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">{title}</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1.5 tracking-tight">
                  {val}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{sub}</p>
              </div>
            ))}
          </div>

          {/* Financial Totals & Evaluation Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
                Monto Solicitado
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1.5">
                {formatMoney(kpis.requestedDop, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                {formatMoney(kpis.requestedUsd, 'USD')}
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
                Monto Aprobado / Rec.
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400 mt-1.5">
                {formatMoney(kpis.approvedDop, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                {formatMoney(kpis.approvedUsd, 'USD')}
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
                Total Desembolsado
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1.5">
                {formatMoney(kpis.disbursedDop, 'DOP')}
              </p>
              <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                {formatMoney(kpis.disbursedUsd, 'USD')}
              </p>
            </div>
            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
                Tiempo Prom. Evaluación
              </p>
              <p className="text-xl font-bold font-mono tabular-nums text-slate-950 dark:text-white mt-1.5">
                {kpis.avgEvalHours !== null ? `${kpis.avgEvalHours.toFixed(2)} hrs` : 'Sin evaluaciones'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Basado en {evaluations.length} registros de evaluación
              </p>
            </div>
          </div>

          {/* Risk Band Distribution */}
          <div className="p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-slate-950 dark:text-white">
                Distribución por Banda de Riesgo (Motor V2)
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Bandas operativas preliminares, no probabilidades estadísticas de incumplimiento.
              </span>
            </div>
            <div className="space-y-3">
              {safePolicy.riskBands.map((band) => {
                const count = kpis.bandCounts[band.code] ?? 0;
                const totalWithBand = Object.values(kpis.bandCounts).reduce((a, b) => a + b, 0);
                const share = totalWithBand > 0 ? (count / totalWithBand) * 100 : 0;
                return (
                  <div key={band.code} className="grid grid-cols-12 items-center gap-3 text-xs">
                    <div className="col-span-4 sm:col-span-3 font-medium text-slate-700 dark:text-slate-300">
                      {band.label} ({band.minScore}–{band.maxScore})
                    </div>
                    <div className="col-span-6 sm:col-span-7 h-2 rounded-sm bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-sm bg-gradient-to-r from-[#0052CC] to-[#00B8FF] transition-all"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <div className="col-span-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {count} ({share.toFixed(0)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
