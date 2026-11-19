import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  ALERT_WIDGET_CATALOG,
  DASHBOARD_SECTION_CATALOG,
  EXECUTIVE_KPI_CATALOG,
  type AlertsViewMode,
  type AlertWidgetId,
  type DashboardSectionId,
  type DashboardWidgetConfigState,
  type ExecutiveKpiWidgetId,
  type RoleDashboardPolicy,
} from '../../engine/dashboardWidgetConfig';
import type { WidgetSyncStatus } from '../../hooks/useDashboardWidgetConfig';

function SortableConfigRow<T extends string>({
  id,
  label,
  description,
  domain,
  isHidden,
  isLocked,
  index,
  total,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onToggleVisibility,
}: {
  id: T;
  label: string;
  description: string;
  domain: string;
  isHidden: boolean;
  isLocked?: boolean;
  index: number;
  total: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (id: T) => void;
  onDragOver: (e: React.DragEvent, id: T) => void;
  onDrop: (id: T) => void;
  onDragEnd: () => void;
  onMove: (id: T, dir: -1 | 1) => void;
  onToggleVisibility: (id: T) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        onDragStart(id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(e, id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(id);
      }}
      onDragEnd={onDragEnd}
      className={`group flex items-center justify-between gap-3 p-3 rounded-xl border transition-all select-none ${
        isDragging
          ? 'opacity-50 scale-[0.985] border-[#168BFF] bg-[#168BFF]/5'
          : isDropTarget
          ? 'border-[#168BFF] ring-2 ring-[#168BFF]/35 bg-[#168BFF]/[0.04]'
          : isHidden
          ? 'border-slate-200/75 dark:border-white/[0.06] bg-slate-50/75 dark:bg-[#040C1E]/50 opacity-75'
          : 'border-slate-200/90 dark:border-[#20C4E8]/18 bg-white dark:bg-[#08132B]'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="p-1 rounded-md text-slate-400 group-hover:text-[#168BFF] cursor-grab active:cursor-grabbing shrink-0"
          title="Arrastra para reordenar"
        >
          <GripVertical className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold text-[#0B1F3A] dark:text-white truncate">{label}</p>
            <span className="text-[10px] font-semibold text-[#168BFF] dark:text-[#20C4E8] shrink-0">
              {domain}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{description}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(id, -1)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Subir ${label}`}
          title="Mover arriba"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove(id, 1)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-[#0B1F3A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Bajar ${label}`}
          title="Mover abajo"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>

        {isLocked ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40"
            title="Obligatorio para tu rol operativo"
          >
            <Lock className="w-3 h-3" />
            <span>Fijo</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onToggleVisibility(id)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
              isHidden
                ? 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-[#168BFF] hover:text-white'
                : 'bg-[#168BFF]/10 text-[#123B65] dark:text-[#20C4E8] hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300'
            }`}
            title={isHidden ? 'Mostrar widget' : 'Ocultar widget'}
          >
            {isHidden ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                <span>Oculto</span>
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                <span>Visible</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function DashboardWidgetConfiguratorDrawer({
  roleLabel,
  policy,
  config,
  syncStatus,
  restrictedKpis,
  restrictedAlerts,
  editMode,
  onToggleEditMode,
  onReorderKpi,
  onMoveKpi,
  onToggleKpi,
  onShowAllKpis,
  onReorderAlert,
  onMoveAlert,
  onToggleAlert,
  onShowAllAlerts,
  onChangeAlertsViewMode,
  onReorderSection,
  onMoveSection,
  onToggleSection,
  onResetDefaults,
  onClose,
}: {
  roleLabel: string;
  policy: RoleDashboardPolicy;
  config: DashboardWidgetConfigState;
  syncStatus: WidgetSyncStatus;
  restrictedKpis: ExecutiveKpiWidgetId[];
  restrictedAlerts: AlertWidgetId[];
  editMode: boolean;
  onToggleEditMode: () => void;
  onReorderKpi: (fromId: ExecutiveKpiWidgetId, toId: ExecutiveKpiWidgetId) => void;
  onMoveKpi: (id: ExecutiveKpiWidgetId, dir: -1 | 1) => void;
  onToggleKpi: (id: ExecutiveKpiWidgetId) => void;
  onShowAllKpis: () => void;
  onReorderAlert: (fromId: AlertWidgetId, toId: AlertWidgetId) => void;
  onMoveAlert: (id: AlertWidgetId, dir: -1 | 1) => void;
  onToggleAlert: (id: AlertWidgetId) => void;
  onShowAllAlerts: () => void;
  onChangeAlertsViewMode: (mode: AlertsViewMode) => void;
  onReorderSection: (fromId: DashboardSectionId, toId: DashboardSectionId) => void;
  onMoveSection: (id: DashboardSectionId, dir: -1 | 1) => void;
  onToggleSection: (id: DashboardSectionId) => void;
  onResetDefaults: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'kpi' | 'alerts' | 'sections'>('kpi');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const clearDrag = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B1F3A]/60 backdrop-blur-xs flex justify-end"
      onClick={onClose}
      role="dialog"
      aria-label="Configurador de widgets por rol operativo"
    >
      <div
        className="axy-drawer-in w-full max-w-xl bg-white dark:bg-[#08132B] h-full border-l border-slate-200 dark:border-[#20C4E8]/25 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#0B1F3A] text-white border-b border-[#20C4E8]/20 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-[#20C4E8] flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Gestión de Estado de Widgets</span>
              </p>
              <h3 className="font-display text-base font-bold text-white mt-0.5">
                Configuración personalizada para {roleLabel}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              aria-label="Cerrar configurador"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 rounded-xl bg-[#07162C] border border-[#20C4E8]/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
            <div className="flex items-start gap-2 text-slate-200">
              <ShieldCheck className="w-4 h-4 text-[#20C4E8] shrink-0 mt-0.5" />
              <p className="text-[11px] leading-snug">{policy.roleSummaryNote}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono shrink-0 text-slate-300">
              {syncStatus === 'SAVING' ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-[#20C4E8]" />
                  <span>Guardando…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>{syncStatus === 'LOCAL_ONLY' ? 'Sesión local' : 'Sincronizado'}</span>
                </>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex p-1 rounded-xl bg-[#07162C] border border-white/10">
              {[
                {
                  id: 'kpi' as const,
                  label: `Resumen Ejecutivo (${config.kpiOrder.length - config.hiddenKpis.length}/${config.kpiOrder.length})`,
                },
                {
                  id: 'alerts' as const,
                  label: `Centro de Alertas (${config.alertOrder.length - config.hiddenAlerts.length}/${config.alertOrder.length})`,
                },
                {
                  id: 'sections' as const,
                  label: 'Bloques de Inicio',
                },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    clearDrag();
                    setActiveTab(t.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === t.id
                      ? 'bg-[#168BFF] text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onToggleEditMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors cursor-pointer ${
                editMode
                  ? 'bg-[#20C4E8] text-[#0B1F3A] border-[#20C4E8]'
                  : 'bg-white/[0.08] text-white border-white/15 hover:bg-white/[0.15]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>{editMode ? 'Edición directa activa' : 'Activar edición directa'}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Arrastra y suelta las filas para cambiar el orden en tu pantalla de Inicio, o usa el botón de visibilidad para ocultar widgets.
          </p>

          {activeTab === 'kpi' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#123B65] dark:text-[#20C4E8]">
                  Widgets de Resumen Ejecutivo habilitados
                </h4>
                {config.hiddenKpis.length > 0 && (
                  <button
                    type="button"
                    onClick={onShowAllKpis}
                    className="text-[11px] font-semibold text-[#168BFF] hover:underline cursor-pointer"
                  >
                    Mostrar todos
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {config.kpiOrder.map((kpiId, idx) => {
                  const meta = EXECUTIVE_KPI_CATALOG[kpiId];
                  return (
                    <SortableConfigRow
                      key={kpiId}
                      id={kpiId}
                      label={meta.label}
                      description={meta.shortDesc}
                      domain={meta.requiredDomain}
                      isHidden={config.hiddenKpis.includes(kpiId)}
                      isLocked={policy.lockedVisibleKpis.includes(kpiId)}
                      index={idx}
                      total={config.kpiOrder.length}
                      isDragging={draggingId === kpiId}
                      isDropTarget={dropTargetId === kpiId && draggingId !== kpiId}
                      onDragStart={(id) => setDraggingId(id)}
                      onDragOver={(_, id) => setDropTargetId(id)}
                      onDrop={(toId) => {
                        if (draggingId && draggingId !== toId) {
                          onReorderKpi(draggingId as ExecutiveKpiWidgetId, toId);
                        }
                        clearDrag();
                      }}
                      onDragEnd={clearDrag}
                      onMove={onMoveKpi}
                      onToggleVisibility={onToggleKpi}
                    />
                  );
                })}
              </div>

              {restrictedKpis.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/75 border border-slate-200/75 dark:border-white/[0.06] space-y-2">
                  <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>No disponibles para el rol {roleLabel}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {restrictedKpis.map((rk) => (
                      <span
                        key={rk}
                        className="text-[11px] text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/70 dark:border-white/10"
                      >
                        {EXECUTIVE_KPI_CATALOG[rk].label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'alerts' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#123B65] dark:text-[#20C4E8]">
                  Widgets del Centro de Alertas habilitados
                </h4>
                <div className="flex items-center gap-2">
                  <div className="inline-flex p-0.5 rounded-lg bg-[#F4F7FB] dark:bg-[#040C1E] border border-slate-200/75 dark:border-white/10">
                    {(
                      [
                        { mode: 'CARDS' as const, label: 'Por widgets' },
                        { mode: 'FEED' as const, label: 'Flujo unificado' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.mode}
                        type="button"
                        onClick={() => onChangeAlertsViewMode(m.mode)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                          config.alertsViewMode === m.mode
                            ? 'bg-[#0B1F3A] dark:bg-[#168BFF] text-white'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {config.hiddenAlerts.length > 0 && (
                    <button
                      type="button"
                      onClick={onShowAllAlerts}
                      className="text-[11px] font-semibold text-[#168BFF] hover:underline cursor-pointer"
                    >
                      Mostrar todos
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {config.alertOrder.map((alertId, idx) => {
                  const meta = ALERT_WIDGET_CATALOG[alertId];
                  return (
                    <SortableConfigRow
                      key={alertId}
                      id={alertId}
                      label={meta.label}
                      description={meta.shortDesc}
                      domain={meta.requiredDomain}
                      isHidden={config.hiddenAlerts.includes(alertId)}
                      isLocked={policy.lockedVisibleAlerts.includes(alertId)}
                      index={idx}
                      total={config.alertOrder.length}
                      isDragging={draggingId === alertId}
                      isDropTarget={dropTargetId === alertId && draggingId !== alertId}
                      onDragStart={(id) => setDraggingId(id)}
                      onDragOver={(_, id) => setDropTargetId(id)}
                      onDrop={(toId) => {
                        if (draggingId && draggingId !== toId) {
                          onReorderAlert(draggingId as AlertWidgetId, toId);
                        }
                        clearDrag();
                      }}
                      onDragEnd={clearDrag}
                      onMove={onMoveAlert}
                      onToggleVisibility={onToggleAlert}
                    />
                  );
                })}
              </div>

              {restrictedAlerts.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#F4F7FB] dark:bg-[#040C1E]/75 border border-slate-200/75 dark:border-white/[0.06] space-y-2">
                  <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Alertas restringidas por alcance del rol {roleLabel}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {restrictedAlerts.map((ra) => (
                      <span
                        key={ra}
                        className="text-[11px] text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/70 dark:border-white/10"
                      >
                        {ALERT_WIDGET_CATALOG[ra].label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'sections' && (
            <div className="space-y-3">
              <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#123B65] dark:text-[#20C4E8]">
                Orden y visibilidad de bloques del Inicio
              </h4>
              <div className="space-y-2">
                {config.sectionOrder.map((secId, idx) => {
                  const meta = DASHBOARD_SECTION_CATALOG[secId];
                  return (
                    <SortableConfigRow
                      key={secId}
                      id={secId}
                      label={meta.label}
                      description={meta.shortDesc}
                      domain={meta.requiredDomain}
                      isHidden={config.hiddenSections.includes(secId)}
                      index={idx}
                      total={config.sectionOrder.length}
                      isDragging={draggingId === secId}
                      isDropTarget={dropTargetId === secId && draggingId !== secId}
                      onDragStart={(id) => setDraggingId(id)}
                      onDragOver={(_, id) => setDropTargetId(id)}
                      onDrop={(toId) => {
                        if (draggingId && draggingId !== toId) {
                          onReorderSection(draggingId as DashboardSectionId, toId);
                        }
                        clearDrag();
                      }}
                      onDragEnd={clearDrag}
                      onMove={onMoveSection}
                      onToggleVisibility={onToggleSection}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 bg-[#F4F7FB]/80 dark:bg-[#040C1E]/80">
          <button
            type="button"
            onClick={onResetDefaults}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-white/15 bg-white dark:bg-[#08132B] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#168BFF] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#168BFF]" />
            <span>Restaurar predeterminado de {roleLabel}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#168BFF] hover:bg-[#0E7AE8] text-white text-xs font-semibold cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
