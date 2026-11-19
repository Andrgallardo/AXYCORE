import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Compass,
  Cpu,
  Dna,
  GitBranch,
  Layers,
  Search,
  Send,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { answerAlteraNaturalQuery } from '../../engine/altera/alteraSimulationEngine';
import type { CreditPolicyRecord, LoanRecord } from '../../types/axycore';
import type {
  AlteraConfigRecord,
  AlteraCreditDigitalTwin,
  AlteraFinancialDna,
  AlteraPortfolioIntelligenceSummary,
  AlteraPreventiveSignal,
  AlteraQueryResponse,
  AlteraRecommendationRecord,
  AlteraSectionTab,
} from '../../types/altera';
import { AlteraExplainabilityPanel, PRIORITY_STYLES, formatAlteraMoney } from './alteraUiShared';

const QUICK_QUERIES = [
  '¿Qué clientes están mostrando señales tempranas de deterioro?',
  '¿Qué pasa si este cliente realiza un abono extraordinario?',
  '¿Cuál es la probabilidad de recuperación de los créditos en atraso?',
  '¿Qué créditos deberían recibir intervención preventiva esta semana?',
  '¿Qué estrategia recomienda ALTERA para reducir el riesgo de cartera?',
  '¿Cuáles préstamos tienen mayor impacto financiero si no se interviene?',
  '¿Qué escenario ofrece mejor resultado para este crédito sin afectar políticas?',
];

export function AlteraHomeSection({
  portfolio,
  twins,
  dnas,
  signals,
  loans,
  creditPolicy,
  alteraConfig,
  onNavigateTab,
  onLogQuery,
}: {
  portfolio: AlteraPortfolioIntelligenceSummary;
  twins: AlteraCreditDigitalTwin[];
  dnas: AlteraFinancialDna[];
  signals: AlteraPreventiveSignal[];
  loans: LoanRecord[];
  creditPolicy?: CreditPolicyRecord;
  alteraConfig: AlteraConfigRecord;
  onNavigateTab: (tab: AlteraSectionTab, opts?: { loanId?: string; customerId?: string }) => void;
  onLogQuery: (response: AlteraQueryResponse) => void;
}) {
  const [queryInput, setQueryInput] = useState('');
  const [queryResponse, setQueryResponse] = useState<AlteraQueryResponse | null>(() =>
    twins.length > 0
      ? answerAlteraNaturalQuery({
          queryText: QUICK_QUERIES[0],
          portfolio,
          twins,
          dnas,
          signals,
          loans,
          creditPolicy,
          alteraConfig,
        })
      : null
  );

  const handleRunQuery = (qText?: string) => {
    const finalQuery = (qText ?? queryInput).trim();
    if (!finalQuery) return;
    if (qText) setQueryInput(qText);
    const res = answerAlteraNaturalQuery({
      queryText: finalQuery,
      portfolio,
      twins,
      dnas,
      signals,
      loans,
      creditPolicy,
      alteraConfig,
    });
    setQueryResponse(res);
    onLogQuery(res);
  };

  const kpiCards = [
    {
      label: 'Resumen Crediticio (Exposición)',
      value: formatAlteraMoney(portfolio.activeExposureDop, 'DOP'),
      sub:
        portfolio.activeExposureUsd > 0
          ? `+ ${formatAlteraMoney(portfolio.activeExposureUsd, 'USD')}`
          : `Deterioro prom.: ${portfolio.averageDeteriorationScore}/100`,
      icon: Layers,
      accent: 'text-[#00D1FF]',
      onClick: () => onNavigateTab('credit_intelligence'),
    },
    {
      label: 'Créditos Analizados',
      value: String(portfolio.totalAnalyzedLoans),
      sub: `${portfolio.totalAnalyzedCustomers} clientes con ADN activo`,
      icon: Cpu,
      accent: 'text-[#00B8FF]',
      onClick: () => onNavigateTab('digital_twin'),
    },
    {
      label: 'Señales Preventivas (Plan B)',
      value: String(portfolio.preventiveSignalsCount),
      sub: 'Casos con desviación temprana o mora',
      icon: Compass,
      accent: 'text-amber-400',
      onClick: () => onNavigateTab('preventive_plan_b'),
    },
    {
      label: 'Intervenciones Pendientes',
      value: String(portfolio.pendingRecommendationsCount),
      sub: `${portfolio.approvedOrExecutingCount} aprobadas o en ejecución`,
      icon: ShieldAlert,
      accent: 'text-sky-400',
      onClick: () => onNavigateTab('recommendations'),
    },
    {
      label: 'Simulaciones Realizadas',
      value: String(portfolio.savedScenariosCount),
      sub: 'Universos alternativos guardados',
      icon: GitBranch,
      accent: 'text-indigo-400',
      onClick: () => onNavigateTab('scenario_simulator'),
    },
    {
      label: 'Recomendaciones Generadas',
      value: String(
        portfolio.pendingRecommendationsCount +
          portfolio.approvedOrExecutingCount +
          portfolio.successfulInterventionsCount
      ),
      sub: 'Flujo supervisado por humanos',
      icon: Activity,
      accent: 'text-[#00D1FF]',
      onClick: () => onNavigateTab('recommendations'),
    },
    {
      label: 'Intervenciones Exitosas',
      value: String(portfolio.successfulInterventionsCount),
      sub: `Recuperación prom. cartera: ${portfolio.averageRecoveryProbabilityPct}%`,
      icon: TrendingUp,
      accent: 'text-emerald-400',
      onClick: () => onNavigateTab('outcome_learning'),
    },
    {
      label: 'Alertas Prioritarias',
      value: String(portfolio.criticalAlertsCount),
      sub: 'Prioridad Crítica o Alta',
      icon: AlertTriangle,
      accent: 'text-rose-400',
      onClick: () => onNavigateTab('preventive_plan_b'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className="text-left p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 hover:border-[#0066FF] dark:hover:border-[#00D1FF]/50 transition-all shadow-sm cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {card.label}
                </span>
                <Icon className={`w-4 h-4 ${card.accent} shrink-0`} />
              </div>
              <p className="mt-2 font-display text-xl font-bold text-slate-950 dark:text-white">
                {card.value}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between gap-1">
                <span className="truncate">{card.sub}</span>
                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-[#0052CC] dark:text-[#00D1FF] transition-opacity shrink-0" />
              </p>
            </button>
          );
        })}
      </div>

      {/* CONSULTA A ALTERA */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-[#040C1E] text-white border-b border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-[#00D1FF]" />
              <span>CONSULTA A ALTERA</span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Consultas estratégicas conectadas en tiempo real a la cartera, cuotas, pagos y políticas de AxyCore.
            </p>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-[#0052CC]/25 border border-[#00B8FF]/30 text-[#00D1FF]">
            Solo Datos Reales · Sin Alucinaciones
          </span>
        </div>

        <div className="p-5 space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunQuery();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ej.: ¿Qué clientes están mostrando señales tempranas de deterioro? o indica un número de préstamo (AX-...)"
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
            />
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0052CC] to-[#00B8FF] hover:brightness-110 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Analizar Cartera</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleRunQuery(q)}
                className="text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#040C1E] hover:bg-slate-200 dark:hover:bg-[#0052CC]/25 border border-slate-200 dark:border-[#00B8FF]/20 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer text-left"
              >
                {q}
              </button>
            ))}
          </div>

          {queryResponse && (
            <div className="pt-2 space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E]/90 border border-slate-200 dark:border-[#00B8FF]/20 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#0052CC] dark:text-[#00D1FF]">
                      Intención analítica: {queryResponse.interpretedIntent}
                    </span>
                    <h4 className="font-display text-base font-bold text-slate-950 dark:text-white mt-0.5">
                      {queryResponse.headline}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onNavigateTab(queryResponse.recommendedNextTab, {
                        loanId: queryResponse.targetLoanId,
                        customerId: queryResponse.targetCustomerId,
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Abrir Vista Recomendada</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {queryResponse.narrative}
                </p>

                {queryResponse.evidenceItems.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                    {queryResponse.evidenceItems.map((ev, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          if (ev.loanId) {
                            onNavigateTab('digital_twin', {
                              loanId: ev.loanId,
                              customerId: ev.customerId,
                            });
                          }
                        }}
                        className={`p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200 dark:border-white/10 ${
                          ev.loanId ? 'cursor-pointer hover:border-[#00B8FF]' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {ev.loanNumber || ev.customerName || ev.metricLabel}
                          </span>
                          {ev.severity !== 'INFO' && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_STYLES[ev.severity]}`}
                            >
                              {ev.severity}
                            </span>
                          )}
                        </div>
                        {ev.customerName && ev.loanNumber && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {ev.customerName}
                          </p>
                        )}
                        <p className="text-xs font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF] mt-1">
                          {ev.metricLabel}: {ev.metricValue}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <AlteraExplainabilityPanel
                explainability={queryResponse.explainability}
                title="Explicabilidad de la Respuesta ALTERA"
              />
            </div>
          )}
        </div>
      </div>

      {portfolio.dataLimitations.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <p className="font-bold">Transparencia sobre calidad y cobertura de datos reales:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {portfolio.dataLimitations.map((lim, idx) => (
              <li key={idx}>{lim}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AlteraCreditIntelligenceSection({
  portfolio,
  twins,
  onSelectTwin,
  onSimulateLoan,
}: {
  portfolio: AlteraPortfolioIntelligenceSummary;
  twins: AlteraCreditDigitalTwin[];
  onSelectTwin: (loanId: string) => void;
  onSimulateLoan: (loanId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [trendFilter, setTrendFilter] = useState<string>('ALL');

  const filteredTwins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return twins
      .filter((t) => {
        if (trendFilter !== 'ALL' && t.trend !== trendFilter) return false;
        if (!q) return true;
        return (
          t.loanNumber.toLowerCase().includes(q) ||
          t.customerName.toLowerCase().includes(q) ||
          t.collectionStage.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.deteriorationScore - a.deteriorationScore);
  }, [twins, search, trendFilter]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-[#00B8FF]" />
            <span>Distribución de Deterioro Crediticio en Cartera</span>
          </h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={portfolio.deteriorationDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.25} />
                <XAxis dataKey="band" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#040C1E',
                    borderColor: '#00B8FF',
                    color: '#fff',
                    borderRadius: '10px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" name="Créditos" radius={[6, 6, 0, 0]}>
                  {portfolio.deteriorationDistribution.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mb-3">
            Exposición por Etapa Operativa (Datos Reales)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3">Etapa</th>
                  <th className="py-2 pr-3 text-right">Créditos</th>
                  <th className="py-2 pr-3 text-right">Saldo DOP</th>
                  <th className="py-2 text-right">Deterioro Prom.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {portfolio.stageExposureSummary.map((row) => (
                  <tr key={row.stage} className="text-slate-800 dark:text-slate-200">
                    <td className="py-2 pr-3 font-medium">{row.stage.replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3 text-right font-mono">{row.loansCount}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {formatAlteraMoney(row.exposureDop, 'DOP')}
                    </td>
                    <td className="py-2 text-right font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                      {row.avgDeteriorationScore}/100
                    </td>
                  </tr>
                ))}
                {portfolio.stageExposureSummary.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      Sin préstamos activos registrados en esta organización.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Ranked Table */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Mapa Analítico de Cartera ({filteredTwins.length} créditos)
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar préstamo o cliente..."
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
            />
            <select
              value={trendFilter}
              onChange={(e) => setTrendFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/25 text-xs text-slate-900 dark:text-white"
            >
              <option value="ALL">Todas las tendencias</option>
              <option value="DETERIORO_ACELERADO">Deterioro Acelerado</option>
              <option value="DETERIORO_MODERADO">Deterioro Moderado</option>
              <option value="SENAL_TEMPRANA">Señal Temprana</option>
              <option value="ESTABLE_SALUDABLE">Estable / Saludable</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
                <th className="py-2.5 px-4">Préstamo / Cliente</th>
                <th className="py-2.5 px-3 text-right">Saldo Capital</th>
                <th className="py-2.5 px-3 text-right">DPD</th>
                <th className="py-2.5 px-3 text-right">Puntualidad</th>
                <th className="py-2.5 px-3 text-right">Deterioro</th>
                <th className="py-2.5 px-3 text-right">Prob. Recup.</th>
                <th className="py-2.5 px-3">Prioridad</th>
                <th className="py-2.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {filteredTwins.map((twin) => (
                <tr
                  key={twin.loanId}
                  className="hover:bg-slate-50/80 dark:hover:bg-[#040C1E]/50 text-slate-800 dark:text-slate-200"
                >
                  <td className="py-2.5 px-4">
                    <p className="font-bold text-slate-900 dark:text-white">{twin.loanNumber}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {twin.customerName}
                    </p>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono">
                    {formatAlteraMoney(twin.currentPrincipalBalance, twin.currency)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold">
                    {twin.dpdCurrent}d
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono">
                    {twin.patterns.punctualityRatePct}%
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold">
                    <span
                      className={
                        twin.deteriorationScore >= 65
                          ? 'text-rose-500'
                          : twin.deteriorationScore >= 35
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                      }
                    >
                      {twin.deteriorationScore}/100
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#0052CC] dark:text-[#00D1FF]">
                    {twin.recoveryProbabilityPct}%
                  </td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${PRIORITY_STYLES[twin.priority]}`}
                    >
                      {twin.priority}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSelectTwin(twin.loanId)}
                      className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#00B8FF]/30 hover:bg-slate-100 dark:hover:bg-[#0052CC]/25 text-[11px] font-semibold cursor-pointer"
                    >
                      Gemelo
                    </button>
                    <button
                      type="button"
                      onClick={() => onSimulateLoan(twin.loanId)}
                      className="px-2.5 py-1 rounded-md bg-[#0052CC] hover:bg-[#0066FF] text-white text-[11px] font-semibold cursor-pointer"
                    >
                      Simular
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AlteraFinancialDnaSection({
  dnas,
  selectedCustomerId,
  onSelectCustomer,
}: {
  dnas: AlteraFinancialDna[];
  selectedCustomerId: string;
  onSelectCustomer: (customerId: string) => void;
}) {
  const dna = dnas.find((d) => d.customerId === selectedCustomerId) || dnas[0];

  if (!dna) {
    return (
      <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-sm text-slate-500">
        No hay clientes registrados en esta organización para construir su ADN Financiero.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Dna className="w-5 h-5 text-[#00D1FF]" />
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              ADN Financiero del Cliente
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Perfil interpretativo basado estrictamente en historial real de créditos, pagos, promesas e ingresos verificados.
            </p>
          </div>
        </div>
        <select
          value={dna.customerId}
          onChange={(e) => onSelectCustomer(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/30 text-xs font-semibold text-slate-900 dark:text-white min-w-[260px]"
        >
          {dnas.map((d) => (
            <option key={d.customerId} value={d.customerId}>
              {d.customerName} ({d.documentNumberMasked}) · Índice {d.adaptiveScore}/100
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#00D1FF]">
              Índice Adaptativo ALTERA
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#0052CC]/30 text-white">
              {dna.dnaClassification.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="font-display text-4xl font-extrabold text-white">
            {dna.adaptiveScore}
            <span className="text-base font-normal text-slate-400"> / 100</span>
          </p>
          <p className="text-xs text-slate-300 leading-relaxed">{dna.interpretativeProfile}</p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-2.5 text-xs">
          <h4 className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Historial de Obligaciones en AxyCore
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-slate-500">Créditos totales</span>
              <p className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                {dna.totalLoansCount} ({dna.activeLoansCount} activos)
              </p>
            </div>
            <div>
              <span className="text-slate-500">Puntualidad histórica</span>
              <p className="font-mono font-bold text-sm text-[#0052CC] dark:text-[#00D1FF]">
                {dna.historicalPunctualityPct}%
              </p>
            </div>
            <div>
              <span className="text-slate-500">Promesas (Cump. / Inc.)</span>
              <p className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                {dna.fulfilledPromisesCount} / {dna.brokenPromisesCount}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Acuerdos / Reestruct.</span>
              <p className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                {dna.agreementsOrRestructuresCount}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Saldo Actual DOP</span>
              <p className="font-mono font-semibold text-slate-900 dark:text-white">
                {formatAlteraMoney(dna.totalCurrentBalanceDop, 'DOP')}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Pagado Aplicado DOP</span>
              <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {formatAlteraMoney(dna.totalPaidAppliedDop, 'DOP')}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-2.5 text-xs">
          <h4 className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Capacidad de Pago Registrada (Sin Invención)
          </h4>
          {dna.incomeDataAvailable ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500">Ingreso mensual real</span>
                <p className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                  {formatAlteraMoney(
                    dna.verifiedMonthlyIncome || 0,
                    dna.verifiedIncomeCurrency || 'DOP'
                  )}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Ratio deuda / ingreso</span>
                <p className="font-mono font-bold text-sm text-[#0052CC] dark:text-[#00D1FF]">
                  {dna.estimatedDebtServiceRatioPct ?? 'N/D'}%
                </p>
              </div>
              <div>
                <span className="text-slate-500">Gastos registrados</span>
                <p className="font-mono text-slate-800 dark:text-slate-200">
                  {dna.verifiedMonthlyExpenses !== null
                    ? formatAlteraMoney(
                        dna.verifiedMonthlyExpenses,
                        dna.verifiedIncomeCurrency || 'DOP'
                      )
                    : 'No registrado'}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Score originación</span>
                <p className="font-mono text-slate-800 dark:text-slate-200">
                  {dna.lastOriginationScore !== null
                    ? `${dna.lastOriginationScore} (${dna.lastOriginationRiskBand || '-'})`
                    : 'No disponible'}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>Datos no disponibles en AxyCore:</strong> Este cliente no posee ingresos o gastos verificados en solicitudes vinculadas. ALTERA no inventa capacidad financiera externa.
            </div>
          )}
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3 text-xs">
        <h4 className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Firma Conductual Detectada
        </h4>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {dna.behavioralSignature.map((sig, i) => (
            <li
              key={i}
              className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200"
            >
              {sig}
            </li>
          ))}
        </ul>
        {dna.dataLimitations.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-300">
            Limitaciones: {dna.dataLimitations.join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

export function AlteraDigitalTwinSection({
  twins,
  selectedLoanId,
  onSelectLoan,
  onSimulateLoan,
}: {
  twins: AlteraCreditDigitalTwin[];
  selectedLoanId: string;
  onSelectLoan: (loanId: string) => void;
  onSimulateLoan: (loanId: string) => void;
}) {
  const twin = twins.find((t) => t.loanId === selectedLoanId) || twins[0];

  if (!twin) {
    return (
      <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-sm text-slate-500">
        No hay préstamos disponibles para generar un Gemelo Digital Crediticio.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Gemelo Digital Crediticio
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Representación dinámica del comportamiento de cuotas, puntualidad, saldos y proyección de deterioro.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={twin.loanId}
            onChange={(e) => onSelectLoan(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-300 dark:border-[#00B8FF]/30 text-xs font-semibold text-slate-900 dark:text-white min-w-[260px]"
          >
            {twins.map((t) => (
              <option key={t.loanId} value={t.loanId}>
                {t.loanNumber} — {t.customerName} (Deterioro {t.deteriorationScore}/100)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSimulateLoan(twin.loanId)}
            className="px-3.5 py-2 rounded-xl bg-[#0052CC] hover:bg-[#0066FF] text-white text-xs font-semibold cursor-pointer"
          >
            Simular Universos Alternativos
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <span className="text-[11px] uppercase font-bold text-slate-500">Saldo Capital Actual</span>
          <p className="text-xl font-display font-bold text-slate-900 dark:text-white mt-1">
            {formatAlteraMoney(twin.currentPrincipalBalance, twin.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Original: {formatAlteraMoney(twin.principalOriginal, twin.currency)} · Tasa {twin.contractualRateMonthlyPct}%/m
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <span className="text-[11px] uppercase font-bold text-slate-500">Total Vencido & Mora</span>
          <p className="text-xl font-display font-bold text-rose-500 mt-1">
            {formatAlteraMoney(twin.totalOverdue, twin.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            DPD: {twin.dpdCurrent}d · Mora acumulada: {formatAlteraMoney(twin.overdueLateFee, twin.currency)}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20">
          <span className="text-[11px] uppercase font-bold text-slate-500">Puntualidad & Cambio</span>
          <p className="text-xl font-display font-bold text-[#0052CC] dark:text-[#00D1FF] mt-1">
            {twin.patterns.punctualityRatePct}%
          </p>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5 text-amber-500" />
            <span>
              Últimas 3 cuotas: {twin.patterns.behavioralShiftDeltaDays >= 0 ? '+' : ''}
              {twin.patterns.behavioralShiftDeltaDays}d vs histórico
            </span>
          </p>
        </div>
        <div className="p-4 rounded-xl bg-[#040C1E] text-white border border-[#00B8FF]/30">
          <span className="text-[11px] uppercase font-bold text-[#00D1FF]">
            Riesgo & Proyección 30d/60d
          </span>
          <p className="text-xl font-display font-bold mt-1">
            Deterioro {twin.deteriorationScore}/100
          </p>
          <p className="text-xs text-slate-300 mt-0.5">
            Recup.: {twin.recoveryProbabilityPct}% · DPD est. 30d: {twin.projected30DayDpd}d
          </p>
        </div>
      </div>

      {/* Timeline Recharts */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Evolución de Cuotas: Monto Programado vs Pagado y Días de Atraso
          </h4>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {twin.recentvsHistoricalSummary}
          </span>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={twin.timelineSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.25} />
              <XAxis dataKey="periodLabel" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#f59e0b' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#040C1E',
                  borderColor: '#00B8FF',
                  color: '#fff',
                  borderRadius: '10px',
                  fontSize: '12px',
                }}
              />
              <Bar yAxisId="left" dataKey="scheduledAmount" name="Programado" fill="#334155" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="paidAmount" name="Pagado" fill="#00B8FF" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="delayDays" name="Días atraso" stroke="#f59e0b" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <AlteraExplainabilityPanel explainability={twin.explainability} defaultOpen />
    </div>
  );
}
