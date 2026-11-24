import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  FileWarning,
  Gavel,
  GripVertical,
  LayoutGrid,
  ListFilter,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type {
  EnrichedActivityEntry,
  HomeSmartAlert,
  IntelligenceInsightItem,
  SmartAlertPriority,
} from '../../engine/homeDashboardEngine';
import {
  ALERT_WIDGET_CATALOG,
  type AlertsViewMode,
  type AlertWidgetId,
} from '../../engine/dashboardWidgetConfig';
import type { DirectorAnalysisResponse, NavSectionId } from '../../types/axycore';
import { prefetchDirectorView } from '../../utils/lazyPrefetch';

const PRIORITY_FILTERS: Array<{ value: 'ALL' | SmartAlertPriority; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'CRITICA', label: 'Crítica' },
  { value: 'ALTA', label: 'Alta' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'INFORMATIVA', label: 'Informativa' },
];

const PRIORITY_META: Record<SmartAlertPriority, { label: string; textClass: string; dotClass: string }> = {
  CRITICA: {
    label: 'Crítica',
    textClass: 'text-rose-700 dark:text-rose-400',
    dotClass: 'bg-rose-600',
  },
  ALTA: {
    label: 'Alta',
    textClass: 'text-amber-700 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  MEDIA: {
    label: 'Media',
    textClass: 'text-[#123B65] dark:text-[#20C4E8]',
    dotClass: 'bg-[#168BFF]',
  },
  INFORMATIVA: {
    label: 'Informativa',
    textClass: 'text-slate-600 dark:text-slate-300',
    dotClass: 'bg-slate-400',
  },
};

const ALERT_WIDGET_ICON: Record<AlertWidgetId, React.ComponentType<{ className?: string }>> = {
  CUOTAS_VENCIDAS: AlertTriangle,
  PROMESAS_INCUMPLIDAS: ShieldAlert,
  PROXIMO_VENCER: CalendarClock,
  EVALUACION: ClipboardList,
  APROBACIONES: Gavel,
  EXPEDIENTES: FileWarning,
  INCIDENCIAS: Bell,
};

export function AxyCoreIntelligencePanel({
  insights,
  aiConfigured,
  canRunAi,
  directorAnalysis,
  directorLoading,
  directorError,
  onRunDeepDiagnosis,
  onNavigate,
}: {
  insights: IntelligenceInsightItem[];
  aiConfigured: boolean;
  canRunAi: boolean;
  directorAnalysis: DirectorAnalysisResponse | null;
  directorLoading: boolean;
  directorError?: string | null;
  onRunDeepDiagnosis: () => void;
  onNavigate: (sec: NavSectionId) => void;
}) {
  const severityColor: Record<IntelligenceInsightItem['severity'], string> = {
    CRITICA: 'text-rose-600 dark:text-rose-400',
    ATENCION: 'text-amber-600 dark:text-amber-300',
    OPORTUNIDAD: 'text-[#0052CC] dark:text-[#00D1FF]',
    OPTIMA: 'text-emerald-600 dark:text-emerald-400',
  };

  const severityLabel: Record<IntelligenceInsightItem['severity'], string> = {
    CRITICA: 'Riesgo Crítico',
    ATENCION: 'Requiere Atención',
    OPORTUNIDAD: 'Oportunidad',
    OPTIMA: 'Desempeño Óptimo',
  };

  const healthMeta: Record<
    NonNullable<DirectorAnalysisResponse['healthStatus']>,
    { label: string; className: string }
  > = {
    OPTIMA: {
      label: 'Salud Óptima',
      className: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 border-emerald-500/30',
    },
    ESTABLE: {
      label: 'Operación Estable',
      className: 'text-[#0052CC] dark:text-[#00D1FF] bg-[#0066FF]/10 border-[#0066FF]/25',
    },
    ATENCION: {
      label: 'Requiere Atención',
      className: 'text-amber-700 dark:text-amber-300 bg-amber-500/12 border-amber-500/30',
    },
    CRITICA: {
      label: 'Riesgo Crítico',
      className: 'text-rose-700 dark:text-rose-300 bg-rose-500/12 border-rose-500/30',
    },
  };

  return (
    <section
      aria-label="AXYCORE INTELLIGENCE — Centro de inteligencia operativa"
      className="axy-surface-ai rounded-2xl"
    >
      <div className="p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF]">
              <BrainCircuit className="w-4 h-4 shrink-0" />
              <span>AxyCore Intelligence</span>
            </div>
            <h3 className="font-display text-base sm:text-lg font-bold text-slate-950 dark:text-white tracking-tight">
              Centro de Inteligencia Operativa y Señales Reales
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Observaciones auditables generadas directamente desde tu cartera, originación y cobros.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canRunAi && aiConfigured && (
              <button
                type="button"
                disabled={directorLoading}
                onClick={onRunDeepDiagnosis}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                {directorLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>{directorLoading ? 'Analizando operación…' : 'Diagnóstico IA en vivo'}</span>
              </button>
            )}
            {canRunAi && (
              <button
                type="button"
                onMouseEnter={() => prefetchDirectorView()}
                onFocus={() => prefetchDirectorView()}
                onClick={() => onNavigate('director')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6 text-xs font-semibold text-slate-800 dark:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <span>Abrir AxyCore Director</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {directorError && (
          <div className="p-3.5 rounded-xl border border-rose-300/70 dark:border-rose-500/35 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <span>{directorError}</span>
            </div>
            {canRunAi && aiConfigured && (
              <button
                type="button"
                disabled={directorLoading}
                onClick={onRunDeepDiagnosis}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50 shrink-0"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {directorAnalysis?.executiveSummary && (
          <div className="p-4 rounded-xl bg-[#0066FF]/6 dark:bg-[#040C1E]/85 border border-[#0066FF]/20 dark:border-[#00B8FF]/25 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#0052CC] dark:text-[#00D1FF] font-semibold">
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Síntesis Ejecutiva IA Verificada</span>
                {directorAnalysis.healthStatus && (
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                      healthMeta[directorAnalysis.healthStatus].className
                    }`}
                  >
                    {healthMeta[directorAnalysis.healthStatus].label}
                  </span>
                )}
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400">
                {directorAnalysis.periodLabel ? `${directorAnalysis.periodLabel} · ` : ''}
                {directorAnalysis.generatedAtIso.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
            {directorAnalysis.executiveHeadline && (
              <p className="font-display text-sm font-bold text-slate-950 dark:text-white">
                {directorAnalysis.executiveHeadline}
              </p>
            )}
            <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-100 leading-relaxed">
              {directorAnalysis.executiveSummary}
            </p>
            {canRunAi && (
              <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {directorAnalysis.priorityRisks?.length
                    ? `${directorAnalysis.priorityRisks.length} riesgo(s) priorizado(s) · `
                    : ''}
                  {directorAnalysis.recommendedActions?.length || 0} acción(es) recomendada(s)
                </span>
                <button
                  type="button"
                  onMouseEnter={() => prefetchDirectorView()}
                  onFocus={() => prefetchDirectorView()}
                  onClick={() => onNavigate('director')}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  <span>Ver dictamen completo en AxyCore Director</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {insights.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 dark:bg-[#040C1E]/60 text-xs text-slate-500 dark:text-slate-400">
            No existen registros suficientes todavía para generar observaciones operativas en esta entidad.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {insights.map((ins) => (
              <div
                key={ins.id}
                className="p-4 rounded-xl bg-slate-50/85 dark:bg-[#040C1E]/70 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`font-semibold ${severityColor[ins.severity]}`}>
                      {severityLabel[ins.severity]}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 truncate">{ins.area}</span>
                  </div>
                  <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white leading-snug">
                    {ins.headline}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ins.detail}</p>
                </div>

                <div className="pt-2.5 border-t border-slate-200/70 dark:border-white/8 flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] truncate">
                    {ins.evidenceMetric}
                  </span>
                  {ins.targetSection && ins.actionLabel && (
                    <button
                      type="button"
                      onClick={() => onNavigate(ins.targetSection!)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-800 dark:text-white hover:text-[#0052CC] dark:hover:text-[#00D1FF] shrink-0 cursor-pointer"
                    >
                      <span>{ins.actionLabel}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function HomeAlertsCenterPanel({
  alerts,
  onSelectAlert,
  visibleAlertWidgets,
  hiddenAlertWidgets = [],
  lockedAlertWidgets = [],
  alertsViewMode = 'CARDS',
  roleLabel,
  canConfigure = true,
  editMode = false,
  onToggleEditMode,
  onChangeViewMode,
  onReorderAlertWidget,
  onMoveAlertWidget,
  onToggleAlertWidgetVisibility,
  onShowAllAlertWidgets,
  onOpenConfigurator,
}: {
  alerts: HomeSmartAlert[];
  onSelectAlert: (alert: HomeSmartAlert) => void;
  visibleAlertWidgets?: AlertWidgetId[];
  hiddenAlertWidgets?: AlertWidgetId[];
  lockedAlertWidgets?: AlertWidgetId[];
  alertsViewMode?: AlertsViewMode;
  roleLabel?: string;
  canConfigure?: boolean;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  onChangeViewMode?: (mode: AlertsViewMode) => void;
  onReorderAlertWidget?: (fromId: AlertWidgetId, toId: AlertWidgetId) => void;
  onMoveAlertWidget?: (id: AlertWidgetId, dir: -1 | 1) => void;
  onToggleAlertWidgetVisibility?: (id: AlertWidgetId) => void;
  onShowAllAlertWidgets?: () => void;
  onOpenConfigurator?: () => void;
}) {
  const [filter, setFilter] = useState<'ALL' | SmartAlertPriority>('ALL');
  const [draggingWidget, setDraggingWidget] = useState<AlertWidgetId | null>(null);
  const [dropTargetWidget, setDropTargetWidget] = useState<AlertWidgetId | null>(null);

  const activeWidgetOrder: AlertWidgetId[] = useMemo(() => {
    if (visibleAlertWidgets) return visibleAlertWidgets;
    return [
      'CUOTAS_VENCIDAS',
      'PROMESAS_INCUMPLIDAS',
      'APROBACIONES',
      'EVALUACION',
      'PROXIMO_VENCER',
      'EXPEDIENTES',
      'INCIDENCIAS',
    ];
  }, [visibleAlertWidgets]);

  const visibleWidgetSet = useMemo(() => new Set(activeWidgetOrder), [activeWidgetOrder]);

  // Filter alerts strictly to visible alert widgets for the user's operational role
  const scopedAlerts = useMemo(
    () => alerts.filter((a) => visibleWidgetSet.has(a.category)),
    [alerts, visibleWidgetSet]
  );

  const counts = useMemo(() => {
    const map: Record<'ALL' | SmartAlertPriority, number> = {
      ALL: scopedAlerts.length,
      CRITICA: 0,
      ALTA: 0,
      MEDIA: 0,
      INFORMATIVA: 0,
    };
    scopedAlerts.forEach((a) => {
      map[a.priority] += 1;
    });
    return map;
  }, [scopedAlerts]);

  const visibleAlerts = useMemo(() => {
    const base =
      filter === 'ALL' ? scopedAlerts : scopedAlerts.filter((a) => a.priority === filter);
    const priorityScore: Record<SmartAlertPriority, number> = {
      CRITICA: 0,
      ALTA: 1,
      MEDIA: 2,
      INFORMATIVA: 3,
    };
    const widgetIndex = new Map(activeWidgetOrder.map((w, idx) => [w, idx]));
    return [...base].sort((a, b) => {
      const pDiff = priorityScore[a.priority] - priorityScore[b.priority];
      if (pDiff !== 0) return pDiff;
      return (widgetIndex.get(a.category) ?? 99) - (widgetIndex.get(b.category) ?? 99);
    });
  }, [scopedAlerts, filter, activeWidgetOrder]);

  const alertsByWidget = useMemo(() => {
    const map = new Map<AlertWidgetId, HomeSmartAlert[]>();
    activeWidgetOrder.forEach((w) => map.set(w, []));
    const filtered =
      filter === 'ALL' ? scopedAlerts : scopedAlerts.filter((a) => a.priority === filter);
    filtered.forEach((a) => {
      const list = map.get(a.category);
      if (list) list.push(a);
    });
    return map;
  }, [activeWidgetOrder, scopedAlerts, filter]);

  const clearDrag = () => {
    setDraggingWidget(null);
    setDropTargetWidget(null);
  };

  return (
    <section className="axy-surface rounded-2xl flex flex-col">
      <div className="p-5 border-b border-slate-100 dark:border-white/[0.06] space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Centro de Alertas Inteligentes</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {roleLabel
                ? `Widgets priorizados para ${roleLabel} · arrastra para reordenar u oculta según tu flujo`
                : 'Priorización automática de riesgos, vencimientos y cuellos de botella'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono tabular-nums text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] mr-1">
              {scopedAlerts.length} activa(s)
            </span>

            {canConfigure && onChangeViewMode && (
              <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => onChangeViewMode('CARDS')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                    alertsViewMode === 'CARDS'
                      ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                  }`}
                  title="Ver como widgets configurables"
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>Widgets</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeViewMode('FEED')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                    alertsViewMode === 'FEED'
                      ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
                  }`}
                  title="Ver como flujo priorizado"
                >
                  <ListFilter className="w-3 h-3" />
                  <span>Flujo</span>
                </button>
              </div>
            )}

            {canConfigure && onToggleEditMode && (
              <button
                type="button"
                onClick={onToggleEditMode}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                  editMode
                    ? 'bg-[#0066FF] text-white border-[#0066FF]'
                    : 'bg-slate-100 dark:bg-[#040C1E] text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-white/10 hover:border-[#0066FF]'
                }`}
              >
                {editMode ? 'Listo' : 'Organizar'}
              </button>
            )}

            {canConfigure && onOpenConfigurator && (
              <button
                type="button"
                onClick={onOpenConfigurator}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#040C1E] text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10 hover:border-[#0066FF] hover:text-[#0066FF] cursor-pointer"
                title="Configurar widgets del Centro de Alertas"
                aria-label="Configurar widgets del Centro de Alertas"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/[0.07]">
          {PRIORITY_FILTERS.map((pf) => (
            <button
              key={pf.value}
              type="button"
              onClick={() => setFilter(pf.value)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filter === pf.value
                  ? 'bg-[#041B4E] dark:bg-[#0066FF] text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'
              }`}
            >
              <span>{pf.label}</span>
              <span className="font-mono tabular-nums opacity-80">{counts[pf.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {activeWidgetOrder.length === 0 ? (
        <div className="p-8 text-center space-y-3 flex-1 flex flex-col items-center justify-center">
          <EyeOff className="w-7 h-7 text-slate-400" />
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Todos los widgets de alertas están ocultos
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
            Puedes volver a activar los widgets habilitados para tu rol en cualquier momento.
          </p>
          {onShowAllAlertWidgets && (
            <button
              type="button"
              onClick={onShowAllAlertWidgets}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#168BFF] text-white text-xs font-semibold cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Mostrar widgets de alertas</span>
            </button>
          )}
        </div>
      ) : alertsViewMode === 'CARDS' ? (
        <div className="p-4 space-y-3 max-h-[460px] overflow-y-auto">
          {activeWidgetOrder.map((widgetId, idx) => {
            const meta = ALERT_WIDGET_CATALOG[widgetId];
            const Icon = ALERT_WIDGET_ICON[widgetId];
            const items = alertsByWidget.get(widgetId) ?? [];
            const isDragging = draggingWidget === widgetId;
            const isDropTarget = dropTargetWidget === widgetId && draggingWidget !== widgetId;
            const isLocked = lockedAlertWidgets.includes(widgetId);

            return (
              <div
                key={widgetId}
                draggable={canConfigure}
                onDragStart={(e) => {
                  if (!canConfigure) return;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', widgetId);
                  setDraggingWidget(widgetId);
                }}
                onDragOver={(e) => {
                  if (!canConfigure || !draggingWidget) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTargetWidget(widgetId);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingWidget && draggingWidget !== widgetId && onReorderAlertWidget) {
                    onReorderAlertWidget(draggingWidget, widgetId);
                  }
                  clearDrag();
                }}
                onDragEnd={clearDrag}
                className={`group rounded-xl border transition-all ${
                  isDragging
                    ? 'opacity-55 scale-[0.985] border-[#168BFF]'
                    : isDropTarget
                    ? 'border-[#168BFF] ring-2 ring-[#168BFF]/35 bg-[#168BFF]/[0.03]'
                    : 'border-slate-200/80 dark:border-white/[0.08] bg-[#F4F7FB]/55 dark:bg-[#040C1E]/55'
                }`}
              >
                <div className="px-3.5 py-2.5 border-b border-slate-200/60 dark:border-white/[0.06] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {canConfigure && (
                      <span
                        className="text-slate-400 group-hover:text-[#168BFF] cursor-grab active:cursor-grabbing shrink-0"
                        title="Arrastra este widget para reordenar"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <Icon className="w-3.5 h-3.5 text-[#168BFF] shrink-0" />
                    <span className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">
                      {meta.label}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] font-semibold text-[#123B65] dark:text-[#20C4E8]">
                      ({items.length})
                    </span>
                  </div>

                  {canConfigure && (
                    <div
                      className={`flex items-center gap-1 shrink-0 transition-opacity ${
                        editMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                      }`}
                    >
                      {onMoveAlertWidget && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveAlertWidget(widgetId, -1)}
                            className="p-1 rounded-md text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white disabled:opacity-30 cursor-pointer"
                            title="Subir widget"
                            aria-label={`Subir ${meta.label}`}
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === activeWidgetOrder.length - 1}
                            onClick={() => onMoveAlertWidget(widgetId, 1)}
                            className="p-1 rounded-md text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white disabled:opacity-30 cursor-pointer"
                            title="Bajar widget"
                            aria-label={`Bajar ${meta.label}`}
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {!isLocked && onToggleAlertWidgetVisibility && (
                        <button
                          type="button"
                          onClick={() => onToggleAlertWidgetVisibility(widgetId)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                          title={`Ocultar ${meta.label}`}
                          aria-label={`Ocultar ${meta.label}`}
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Sin alertas activas en esta categoría para el filtro seleccionado.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/60 dark:divide-white/[0.05]">
                    {items.slice(0, 3).map((alert) => {
                      const pMeta = PRIORITY_META[alert.priority];
                      return (
                        <button
                          key={alert.id}
                          type="button"
                          onClick={() => onSelectAlert(alert)}
                          className="w-full px-3.5 py-2.5 text-left hover:bg-white dark:hover:bg-[#0E1D40]/60 transition-colors flex items-start justify-between gap-3 cursor-pointer"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className={`font-semibold inline-flex items-center gap-1 ${pMeta.textClass}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${pMeta.dotClass}`} aria-hidden="true" />
                                {pMeta.label}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {alert.title}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-1">
                              {alert.detail}
                            </p>
                          </div>

                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="font-mono tabular-nums text-[11px] font-bold text-[#0B1F3A] dark:text-[#20C4E8]">
                              {alert.metricLabel}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#168BFF]">
                              <span>Abrir</span>
                              <ArrowRight className="w-3 h-3" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : visibleAlerts.length === 0 ? (
        <div className="p-8 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Sin alertas pendientes en esta prioridad
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
            No se registran cuotas vencidas, expedientes observados ni incidencias activas dentro de los widgets visibles.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-[420px] overflow-y-auto">
          {visibleAlerts.slice(0, 14).map((alert) => {
            const meta = PRIORITY_META[alert.priority];
            return (
              <button
                key={alert.id}
                type="button"
                onClick={() => onSelectAlert(alert)}
                className="w-full px-5 py-3.5 text-left hover:bg-[#F4F7FB] dark:hover:bg-[#0E1D40]/60 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`font-semibold inline-flex items-center gap-1.5 ${meta.textClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
                      {meta.label}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="font-medium text-slate-500 dark:text-slate-400">
                      {alert.categoryLabel}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {alert.title}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                    {alert.detail}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="font-mono tabular-nums text-xs font-bold text-[#0B1F3A] dark:text-[#20C4E8]">
                    {alert.metricLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#168BFF]">
                    <span>Abrir</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {hiddenAlertWidgets.length > 0 && onToggleAlertWidgetVisibility && (
        <div className="px-4 py-2.5 border-t border-slate-100 dark:border-white/[0.06] bg-[#F4F7FB]/80 dark:bg-[#040C1E]/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">
              Ocultos ({hiddenAlertWidgets.length}):
            </span>
            {hiddenAlertWidgets.map((hid) => (
              <button
                key={hid}
                type="button"
                onClick={() => onToggleAlertWidgetVisibility(hid)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-[#08132B] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-[#168BFF] hover:text-[#168BFF] cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{ALERT_WIDGET_CATALOG[hid].label}</span>
              </button>
            ))}
          </div>
          {onShowAllAlertWidgets && (
            <button
              type="button"
              onClick={onShowAllAlertWidgets}
              className="text-[#168BFF] font-semibold hover:underline cursor-pointer"
            >
              Mostrar todos
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function HomeRecentActivityPanel({
  entries,
  canViewAudit,
  onSelectEntry,
  onOpenAudit,
}: {
  entries: EnrichedActivityEntry[];
  canViewAudit: boolean;
  onSelectEntry: (entry: EnrichedActivityEntry) => void;
  onOpenAudit: () => void;
}) {
  return (
    <section className="axy-surface rounded-2xl flex flex-col">
      <div className="p-5 border-b border-slate-100 dark:border-white/[0.06] flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#00B8FF]" />
            <span>Actividad Reciente</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Últimos acontecimientos auditables de la financiera
          </p>
        </div>
        {canViewAudit && (
          <button
            type="button"
            onClick={onOpenAudit}
            className="text-xs font-semibold text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer whitespace-nowrap"
          >
            Ver bitácora
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="p-8 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-slate-400" />
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Sin eventos recientes dentro de tu alcance
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs">
            Aquí aparecerán registros de clientes, solicitudes, desembolsos, pagos y acuerdos en tiempo real.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-[420px] overflow-y-auto">
          {entries.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectEntry(item)}
              className="w-full px-5 py-3.5 text-left hover:bg-[#F4F7FB] dark:hover:bg-[#0E1D40]/60 transition-colors flex items-start justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-semibold text-[#168BFF]">{item.eventLabel}</span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-500 dark:text-slate-400 font-medium">
                    Estado: {item.statusLabel}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1">
                  {item.action}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Responsable: {item.actorName}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                  {item.timestampDisplay}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#123B65] dark:text-[#20C4E8]">
                  <span>Detalle</span>
                  <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
