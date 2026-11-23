import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  Save,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { OrganizationRecord, UserProfile } from '../../types/axycore';
import {
  IMPULSA_ALL_STATUSES,
  IMPULSA_CATEGORY_LABELS,
  IMPULSA_PRIORITY_LABELS,
  IMPULSA_STATUS_LABELS,
  type ImpulsaAssistantMessage,
  type ImpulsaAssignmentStrategy,
  type ImpulsaAutomationFrequency,
  type ImpulsaChartDatasets,
  type ImpulsaCommercialMetrics,
  type ImpulsaEngineConfig,
  type ImpulsaInternalAlert,
  type ImpulsaOpportunityCategory,
  type ImpulsaOpportunityRecord,
  type ImpulsaOpportunityStatus,
} from '../../types/impulsa';
import { runDeterministicImpulsaQuery } from '../../engine/impulsa/impulsaEngine';
import { hasRolePermission } from '../../engine/rbac';

function fmtCurrency(amount: number, currency: string): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${Math.round(amount || 0).toLocaleString('en-US')}`;
}

/* ============================================================================
 * 1. ASISTENTE IMPULSA IA (Natural-Language Commercial Intelligence)
 * ========================================================================== */

interface ImpulsaAssistantTabProps {
  opportunities: ImpulsaOpportunityRecord[];
  metrics: ImpulsaCommercialMetrics;
  charts: ImpulsaChartDatasets;
  alerts: ImpulsaInternalAlert[];
  organization: OrganizationRecord;
  currentUser: UserProfile;
  onSelectOpportunityById: (id: string) => void;
}

const SUGGESTED_PROMPTS = [
  '¿Qué clientes tienen mayor probabilidad de renovar este mes?',
  '¿Cuáles son las oportunidades de crecimiento crediticio con capacidad validada?',
  '¿Qué oportunidades estamos dejando pasar sin gestionar?',
  '¿Cómo va la tasa de conversión comercial por oficial de negocios?',
  '¿Qué clientes antiguos inactivos con buen historial podemos recuperar?',
];

export const ImpulsaAssistantTab: React.FC<ImpulsaAssistantTabProps> = ({
  opportunities,
  metrics,
  charts,
  alerts,
  organization,
  currentUser,
  onSelectOpportunityById,
}) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ImpulsaAssistantMessage[]>([
    {
      id: 'imp_ai_welcome',
      role: 'assistant',
      timestampIso: new Date().toISOString(),
      content:
        'Soy Impulsa IA. Consulto exclusivamente los datos reales de cartera, oportunidades, oficiales y conversión de esta institución en AxyCore. Pregúntame sobre renovaciones, crecimiento crediticio, clientes inactivos o brechas comerciales.',
      keyFindings: [
        `${metrics.totalOpportunities} oportunidades registradas · Potencial RD$${metrics.potentialPlacementAmountDop.toLocaleString('en-US')}`,
        `${metrics.disbursedCredits} créditos desembolsados desde Impulsa (${metrics.conversionRatePct.toFixed(1)}% conversión)`,
      ],
      modelUsed: 'Impulsa IA Grounded',
    },
  ]);

  const askAssistant = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || loading) return;

    const userMsg: ImpulsaAssistantMessage = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestampIso: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setLoading(true);

    try {
      const compactContext = {
        institutionName: organization.tradeName || organization.name,
        metrics,
        byCategory: charts.byCategory,
        byProduct: charts.byProduct,
        byBranch: charts.byBranch.slice(0, 10),
        byOfficer: charts.byOfficer.slice(0, 12),
        internalAlertsCount: alerts.length,
        topAlerts: alerts.slice(0, 8).map((a) => ({
          code: a.opportunityCode,
          customerName: a.customerName,
          severity: a.severity,
          title: a.title,
        })),
        opportunitiesSample: opportunities.slice(0, 40).map((o) => ({
          code: o.opportunityCode,
          customerName: o.customerName,
          branch: o.branchOrProvince,
          category: o.category,
          priority: o.priority,
          priorityScore: o.priorityScore,
          commercialConversionProbability: o.commercialConversionProbability,
          status: o.status,
          product: o.recommendedProductLabel,
          currency: o.currency,
          suggestedAmount: o.suggestedAmount,
          suggestedTermMonths: o.suggestedTermMonths,
          remainingInstallments: o.remainingInstallments,
          currentDpd: o.currentDpd,
          maxHistoricalDpd: o.maxHistoricalDpd,
          assignedOfficerName: o.assignedOfficerName || 'Sin asignar',
          lastContactAtIso: o.lastContactAtIso || null,
          linkedApplicationNumber: o.linkedApplicationNumber || null,
          summaryReason: o.summaryReason,
        })),
      };

      const resp = await fetch('/api/impulsa/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          impulsaContext: compactContext,
          actorId: currentUser.uid,
          actorRole: currentUser.role,
          organization: {
            id: organization.id,
            status: organization.status,
            enabledModules: organization.enabledModules,
          },
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data?.available && data?.answer) {
          const codeSet = new Set<string>(
            Array.isArray(data.citedOpportunityCodes) ? data.citedOpportunityCodes : []
          );
          const citedOpps = opportunities
            .filter((o) => codeSet.has(o.opportunityCode))
            .slice(0, 8)
            .map((o) => ({
              id: o.id,
              code: o.opportunityCode,
              customerName: o.customerName,
              category: IMPULSA_CATEGORY_LABELS[o.category],
              suggestedAmount: o.suggestedAmount,
              currency: o.currency,
            }));

          setMessages((prev) => [
            ...prev,
            {
              id: `ai_${Date.now()}`,
              role: 'assistant',
              content: data.answer,
              keyFindings: data.keyFindings || [],
              recommendedActions: data.recommendedActions || [],
              citedOpportunities: citedOpps,
              missingData: data.missingData || [],
              modelUsed: data.model || 'gemini-4-hydrogen',
              timestampIso: new Date().toISOString(),
            },
          ]);
          return;
        }
      }

      // Deterministic grounded fallback when server Gemini API key is not configured
      const deterministic = runDeterministicImpulsaQuery({
        question: trimmed,
        opportunities,
        metrics,
        charts,
        alerts,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `det_${Date.now()}`,
          role: 'assistant',
          timestampIso: new Date().toISOString(),
          ...deterministic,
        },
      ]);
    } catch {
      const deterministic = runDeterministicImpulsaQuery({
        question: trimmed,
        opportunities,
        metrics,
        charts,
        alerts,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `det_${Date.now()}`,
          role: 'assistant',
          timestampIso: new Date().toISOString(),
          ...deterministic,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <div className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-[640px]">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Asistente Comercial Impulsa IA
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            100% basado en datos reales de AxyCore · Sin cifras inventadas
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-xl p-3.5 text-xs space-y-2.5 ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[10px] opacity-75">
                  {m.role === 'assistant' && <Bot className="w-3.5 h-3.5" />}
                  <span>
                    {m.role === 'user' ? currentUser.displayName || 'Usuario' : m.modelUsed || 'Impulsa IA'}
                  </span>
                </div>
                <p className="leading-relaxed whitespace-pre-line">{m.content}</p>

                {m.keyFindings && m.keyFindings.length > 0 && (
                  <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-semibold mb-1">Hallazgos clave</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      {m.keyFindings.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.recommendedActions && m.recommendedActions.length > 0 && (
                  <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800">
                    <div className="text-[11px] font-semibold mb-1">Acciones sugeridas</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      {m.recommendedActions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.citedOpportunities && m.citedOpportunities.length > 0 && (
                  <div className="pt-1 border-t border-slate-200/70 dark:border-slate-800 space-y-1.5">
                    <div className="text-[11px] font-semibold">
                      Expedientes citados (clic para abrir)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.citedOpportunities.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => onSelectOpportunityById(c.id)}
                          className="text-left rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 hover:border-blue-500 transition-colors"
                        >
                          <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                            {c.customerName} ({c.code})
                          </div>
                          <div className="text-[10px] text-slate-500 tabular-nums">
                            {c.category} · {fmtCurrency(c.suggestedAmount, c.currency)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {m.missingData && m.missingData.length > 0 && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
                    Nota de datos: {m.missingData.join(' ')}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-xs text-slate-500 animate-pulse">
              Analizando cartera real de AxyCore...
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void askAssistant(question);
          }}
          className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pregunta sobre renovaciones, oficiales, conversión, clientes inactivos..."
            className="flex-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Consultar
          </button>
        </form>
      </div>

      {/* Quick Prompts & Governance Card */}
      <div className="xl:col-span-4 space-y-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Consultas Rápidas de Negocio
          </h4>
          <div className="space-y-2">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={loading}
                onClick={() => void askAssistant(p)}
                className="w-full text-left text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 hover:border-blue-400 dark:hover:border-blue-600 px-3 py-2.5 text-slate-700 dark:text-slate-200 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2 text-xs text-slate-600 dark:text-slate-400">
          <h4 className="font-semibold text-slate-900 dark:text-white">
            Gobernanza de Impulsa IA
          </h4>
          <p>
            Impulsa IA solo lee datos autorizados de tu institución. Nunca inventa registros, no modifica políticas crediticias y no sustituye la evaluación del Motor de Decisiones V2 ni del Comité de Crédito.
          </p>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 2. REPORTES E INDICADORES DE RENDIMIENTO (CSV & PDF EXPORT)
 * ========================================================================== */

interface ImpulsaReportsTabProps {
  opportunities: ImpulsaOpportunityRecord[];
  organization: OrganizationRecord;
  usersList: UserProfile[];
  onSelectOpportunityById: (id: string) => void;
}

export const ImpulsaReportsTab: React.FC<ImpulsaReportsTabProps> = ({
  opportunities,
  organization,
  usersList,
  onSelectOpportunityById,
}) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [officerFilter, setOfficerFilter] = useState('ALL');
  const [productFilter, setProductFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState<ImpulsaOpportunityCategory | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<ImpulsaOpportunityStatus | 'ALL'>('ALL');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const branches = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.branchOrProvince))).sort(),
    [opportunities]
  );
  const products = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.recommendedProductCode))).sort(),
    [opportunities]
  );

  const filtered = useMemo(() => {
    const min = minAmount ? Number(minAmount) : null;
    const max = maxAmount ? Number(maxAmount) : null;
    return opportunities.filter((o) => {
      const detDate = (o.detectedAtIso || '').slice(0, 10);
      if (dateFrom && detDate < dateFrom) return false;
      if (dateTo && detDate > dateTo) return false;
      if (branchFilter !== 'ALL' && o.branchOrProvince !== branchFilter) return false;
      if (officerFilter === 'UNASSIGNED' && o.assignedOfficerId) return false;
      if (officerFilter !== 'ALL' && officerFilter !== 'UNASSIGNED' && o.assignedOfficerId !== officerFilter) {
        return false;
      }
      if (productFilter !== 'ALL' && o.recommendedProductCode !== productFilter) return false;
      if (categoryFilter !== 'ALL' && o.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (min !== null && Number.isFinite(min) && o.suggestedAmount < min) return false;
      if (max !== null && Number.isFinite(max) && o.suggestedAmount > max) return false;
      return true;
    });
  }, [
    opportunities,
    dateFrom,
    dateTo,
    branchFilter,
    officerFilter,
    productFilter,
    categoryFilter,
    statusFilter,
    minAmount,
    maxAmount,
  ]);

  const summary = useMemo(() => {
    const potential = filtered.reduce((s, o) => s + o.suggestedAmount, 0);
    const disbursed = filtered
      .filter((o) => o.status === 'DESEMBOLSADA')
      .reduce((s, o) => s + (o.disbursedAmount ?? o.suggestedAmount), 0);
    const converted = filtered.filter((o) => Boolean(o.linkedApplicationId)).length;
    const disbursedCount = filtered.filter((o) => o.status === 'DESEMBOLSADA').length;
    const rate = filtered.length > 0 ? Math.round((disbursedCount / filtered.length) * 1000) / 10 : 0;
    return { potential, disbursed, converted, disbursedCount, rate };
  }, [filtered]);

  const exportCsv = () => {
    const headers = [
      'Código',
      'Fecha Detección',
      'Cliente',
      'Documento',
      'Sucursal/Provincia',
      'Categoría',
      'Prioridad',
      'Estado CRM',
      'Producto Sugerido',
      'Moneda',
      'Monto Sugerido',
      'Plazo (m)',
      'Prob. Comercial %',
      'Oficial Asignado',
      'Solicitud Vinculada',
      'Monto Desembolsado',
    ];
    const rows = filtered.map((o) => [
      o.opportunityCode,
      (o.detectedAtIso || '').slice(0, 10),
      o.customerName,
      o.customerDocument || '',
      o.branchOrProvince,
      IMPULSA_CATEGORY_LABELS[o.category],
      IMPULSA_PRIORITY_LABELS[o.priority],
      IMPULSA_STATUS_LABELS[o.status],
      o.recommendedProductLabel,
      o.currency,
      o.suggestedAmount,
      o.suggestedTermMonths,
      o.commercialConversionProbability,
      o.assignedOfficerName || 'Sin asignar',
      o.linkedApplicationNumber || '',
      o.disbursedAmount ?? 0,
    ]);

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `impulsa-reporte-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const orgName = organization.tradeName || organization.name || 'AxyCore';
    doc.setFontSize(14);
    doc.text(`${orgName} — Reporte Comercial Impulsa`, 40, 42);
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `Generado: ${new Date().toLocaleString('es-DO')} · Registros: ${filtered.length} · Potencial: RD$${Math.round(summary.potential).toLocaleString('en-US')} · Desembolsado: RD$${Math.round(summary.disbursed).toLocaleString('en-US')} · Conversión: ${summary.rate}%`,
      40,
      58
    );

    autoTable(doc, {
      startY: 72,
      head: [
        [
          'Código',
          'Cliente',
          'Sucursal',
          'Categoría',
          'Prioridad',
          'Estado',
          'Producto',
          'Sugerido',
          'Oficial',
          'Solicitud',
        ],
      ],
      body: filtered.map((o) => [
        o.opportunityCode,
        o.customerName,
        o.branchOrProvince,
        IMPULSA_CATEGORY_LABELS[o.category],
        o.priority,
        IMPULSA_STATUS_LABELS[o.status],
        o.recommendedProductLabel,
        fmtCurrency(o.suggestedAmount, o.currency),
        o.assignedOfficerName || 'Sin asignar',
        o.linkedApplicationNumber || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    doc.save(`impulsa-reporte-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Reportes Comerciales y Conversión de Impulsa
            </h3>
            <p className="text-xs text-slate-500">
              Filtra por fecha, sucursal, oficial, producto, tipo, estado y rango de monto con exportación real.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={filtered.length === 0}
              className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
            >
              <FileText className="w-3.5 h-3.5" />
              Exportar PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Desde fecha</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Hasta fecha</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Sucursal / Provincia</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option value="ALL">Todas</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Oficial</label>
            <select
              value={officerFilter}
              onChange={(e) => setOfficerFilter(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option value="ALL">Todos</option>
              <option value="UNASSIGNED">Sin asignar</option>
              {usersList
                .filter((u) => u.role !== 'EXTERNAL_CLIENT')
                .map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName || u.email}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Producto</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option value="ALL">Todos</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Tipo oportunidad</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as ImpulsaOpportunityCategory | 'ALL')}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option value="ALL">Todos</option>
              {(Object.keys(IMPULSA_CATEGORY_LABELS) as ImpulsaOpportunityCategory[]).map((k) => (
                <option key={k} value={k}>
                  {IMPULSA_CATEGORY_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Estado</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ImpulsaOpportunityStatus | 'ALL')}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
            >
              <option value="ALL">Todos</option>
              {IMPULSA_ALL_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {IMPULSA_STATUS_LABELS[st]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Monto mínimo</label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Monto máximo</label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="Sin tope"
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Filtered Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard label="Oportunidades filtradas" value={String(filtered.length)} />
        <SummaryCard
          label="Potencial filtrado"
          value={`RD$${Math.round(summary.potential).toLocaleString('en-US')}`}
        />
        <SummaryCard label="Convertidas a solicitud" value={String(summary.converted)} />
        <SummaryCard
          label="Desembolsado"
          value={`RD$${Math.round(summary.disbursed).toLocaleString('en-US')} (${summary.disbursedCount})`}
        />
        <SummaryCard label="Tasa conversión" value={`${summary.rate.toFixed(1)}%`} />
      </div>

      {/* Report Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                <th className="py-2.5 px-3 font-medium">Código / Fecha</th>
                <th className="py-2.5 px-3 font-medium">Cliente</th>
                <th className="py-2.5 px-3 font-medium">Sucursal</th>
                <th className="py-2.5 px-3 font-medium">Tipo</th>
                <th className="py-2.5 px-3 font-medium">Producto</th>
                <th className="py-2.5 px-3 font-medium text-right">Sugerido</th>
                <th className="py-2.5 px-3 font-medium">Estado</th>
                <th className="py-2.5 px-3 font-medium">Oficial</th>
                <th className="py-2.5 px-3 font-medium">Solicitud</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No existen registros que coincidan con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filtered.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => onSelectOpportunityById(o.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                  >
                    <td className="py-2.5 px-3 tabular-nums">
                      <div className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {o.opportunityCode}
                      </div>
                      <div className="text-[11px] text-slate-500">{(o.detectedAtIso || '').slice(0, 10)}</div>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                      {o.customerName}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {o.branchOrProvince}
                    </td>
                    <td className="py-2.5 px-3">{IMPULSA_CATEGORY_LABELS[o.category]}</td>
                    <td className="py-2.5 px-3">{o.recommendedProductLabel}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                      {fmtCurrency(o.suggestedAmount, o.currency)}
                    </td>
                    <td className="py-2.5 px-3">{IMPULSA_STATUS_LABELS[o.status]}</td>
                    <td className="py-2.5 px-3">{o.assignedOfficerName || 'Sin asignar'}</td>
                    <td className="py-2.5 px-3 tabular-nums text-emerald-600 dark:text-emerald-400">
                      {o.linkedApplicationNumber || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
    <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
    <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
      {value}
    </div>
  </div>
);

/* ============================================================================
 * 3. AUTOMATIZACIÓN, REGLAS Y BITÁCORA DE EJECUCIONES
 * ========================================================================== */

interface ImpulsaAutomationTabProps {
  config: ImpulsaEngineConfig;
  currentUser: UserProfile;
  onSaveConfig: (cfg: ImpulsaEngineConfig) => Promise<void>;
  onRunDetection: () => Promise<void>;
  runningDetection: boolean;
}

export const ImpulsaAutomationTab: React.FC<ImpulsaAutomationTabProps> = ({
  config,
  currentUser,
  onSaveConfig,
  onRunDetection,
  runningDetection,
}) => {
  const [draft, setDraft] = useState<ImpulsaEngineConfig>(config);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const canConfigure = hasRolePermission(currentUser.role, 'CONFIGURE_IMPULSA');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await onSaveConfig({ ...draft, requireExplicitConsentForExternalContact: true });
      setFeedback({ type: 'ok', text: 'Parámetros de detección y automatización guardados con auditoría.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudieron guardar los parámetros.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-blue-600" />
              Automatización Comercial y Umbrales del Detector
            </h3>
            <p className="text-xs text-slate-500">
              Ajusta criterios de detección y asignación sin modificar políticas crediticias ni el Motor de Decisiones V2.
            </p>
          </div>
          {canConfigure && (
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          )}
        </div>

        {feedback && (
          <div
            className={`rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Frecuencia de análisis automático
            </label>
            <select
              disabled={!canConfigure}
              value={draft.frequency}
              onChange={(e) =>
                setDraft({ ...draft, frequency: e.target.value as ImpulsaAutomationFrequency })
              }
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
            >
              <option value="MANUAL">Solo ejecución manual</option>
              <option value="DIARIA">Diaria (al iniciar sesión operativa)</option>
              <option value="SEMANAL">Semanal</option>
              <option value="QUINCENAL">Quincenal</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Regla de asignación automática
            </label>
            <select
              disabled={!canConfigure}
              value={draft.assignmentStrategy}
              onChange={(e) =>
                setDraft({ ...draft, assignmentStrategy: e.target.value as ImpulsaAssignmentStrategy })
              }
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
            >
              <option value="LOAN_OWNER_FIRST">Priorizar oficial original del crédito (luego balanceado)</option>
              <option value="ROUND_ROBIN_OFFICERS">Distribución equitativa (Round-Robin)</option>
              <option value="MANUAL_ONLY">Solo asignación manual (sin auto-asignar)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Alerta interna por oportunidad sin gestionar (horas)
            </label>
            <input
              type="number"
              min={4}
              max={720}
              disabled={!canConfigure}
              value={draft.unmanagedAlertHours}
              onChange={(e) => setDraft({ ...draft, unmanagedAlertHours: Number(e.target.value) })}
              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 tabular-nums"
            />
          </div>
        </div>

        {/* Thresholds Grid */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Umbrales por Regla de Detección
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <NumberField
              label="Renovación: máx. cuotas restantes"
              value={draft.earlyRenewalMaxRemainingInstallments}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, earlyRenewalMaxRemainingInstallments: v })}
            />
            <NumberField
              label="Renovación: mín. % capital pagado"
              value={draft.earlyRenewalMinPaidRatioPct}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, earlyRenewalMinPaidRatioPct: v })}
            />
            <NumberField
              label="Renovación: máx. días de atraso"
              value={draft.earlyRenewalMaxDpd}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, earlyRenewalMaxDpd: v })}
            />
            <NumberField
              label="Crecimiento: factor máx. (ej. 1.35)"
              step="0.05"
              value={draft.growthMaxIncreaseFactor}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, growthMaxIncreaseFactor: v })}
            />
            <NumberField
              label="Pagos anticipados: mín. eventos"
              value={draft.earlyPaymentMinCount}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, earlyPaymentMinCount: v })}
            />
            <NumberField
              label="Inactivos: días desde último cierre"
              value={draft.inactiveMinDaysSinceClose}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, inactiveMinDaysSinceClose: v })}
            />
            <NumberField
              label="Refinanciamiento: tope prudencial DPD"
              value={draft.refinancingMaxDpd}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, refinancingMaxDpd: v })}
            />
            <NumberField
              label="Vigencia ventana comercial (días)"
              value={draft.opportunityWindowDays}
              disabled={!canConfigure}
              onChange={(v) => setDraft({ ...draft, opportunityWindowDays: v })}
            />
          </div>
        </div>

        {/* Safeguards */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canConfigure}
              checked={draft.blockCommercialOffersOnCriticalCentinela}
              onChange={(e) =>
                setDraft({ ...draft, blockCommercialOffersOnCriticalCentinela: e.target.checked })
              }
            />
            <span>
              Bloquear ofertas de renovación/crecimiento/cross-sell cuando exista una alerta Crítica o Alta abierta en Centinela.
            </span>
          </label>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Lock className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong className="text-slate-900 dark:text-white">
                Protección contra envíos externos no autorizados (bloqueo permanente):
              </strong>{' '}
              Impulsa genera únicamente alertas internas y expedientes accionables. Nunca envía correos, SMS ni mensajes automáticos de WhatsApp a los clientes sin consentimiento explícito y acción autorizada del equipo.
            </div>
          </div>
        </div>
      </form>

      {/* Run Execution History */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" />
              Historial de Ejecuciones del Motor Impulsa
            </h3>
            <p className="text-xs text-slate-500">
              Registro auditable de cada escaneo sobre la cartera real de AxyCore.
            </p>
          </div>
          <button
            type="button"
            disabled={runningDetection}
            onClick={() => void onRunDetection()}
            className="px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-950/70 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 rotate-180" />
            {runningDetection ? 'Analizando...' : 'Ejecutar Ahora'}
          </button>
        </div>

        {(config.recentRuns || []).length === 0 ? (
          <p className="text-xs text-slate-500 py-4">
            Aún no se han registrado ejecuciones del detector en esta organización.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Fecha / Hora</th>
                  <th className="py-2 px-2 font-medium">Disparador</th>
                  <th className="py-2 px-2 font-medium">Ejecutado por</th>
                  <th className="py-2 px-2 font-medium text-right">Clientes / Prést.</th>
                  <th className="py-2 px-2 font-medium text-right">Nuevas</th>
                  <th className="py-2 px-2 font-medium text-right">Actualiz.</th>
                  <th className="py-2 px-2 font-medium text-right">Conciliadas</th>
                  <th className="py-2 pl-2 font-medium text-right">Bloq. Riesgo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {config.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {new Date(run.executedAtIso).toLocaleString('es-DO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-2.5 px-2 font-medium">{run.trigger}</td>
                    <td className="py-2.5 px-2">{run.actorName}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {run.customersAnalyzed} / {run.loansAnalyzed}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                      +{run.createdCount}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{run.updatedCount}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {run.reconciledCount}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {run.skippedByRiskCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  disabled?: boolean;
  step?: string;
  onChange: (v: number) => void;
}> = ({ label, value, disabled, step = '1', onChange }) => (
  <div>
    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
      {label}
    </label>
    <input
      type="number"
      step={step}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 tabular-nums"
    />
  </div>
);
