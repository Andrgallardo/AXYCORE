import React, { useMemo, useState } from 'react';
import {
  Activity,
  Download,
  FileLock2,
  Gavel,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { NavigationBreadcrumbs } from '../components/NavigationBreadcrumbs';
import {
  classifyCriticalAuditEvent,
  CRITICAL_CATEGORY_LABELS,
  summarizeCriticalAuditLogs,
  type CriticalEventCategory,
  type CriticalEventSeverity,
} from '../engine/criticalAudit';
import { formatTimestamp } from '../utils/formatters';

type AuditViewMode = 'CRITICAL' | 'ALL';
type CriticalCategoryFilter = 'ALL_CRITICAL' | CriticalEventCategory;
type SeverityFilter = 'ALL' | CriticalEventSeverity;

export function AuditView() {
  const { auditLogs } = useAxyCore();
  const [viewMode, setViewMode] = useState<AuditViewMode>('CRITICAL');
  const [categoryFilter, setCategoryFilter] = useState<CriticalCategoryFilter>('ALL_CRITICAL');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');

  const summary = useMemo(() => summarizeCriticalAuditLogs(auditLogs), [auditLogs]);

  const enrichedLogs = useMemo(
    () =>
      auditLogs.map((log) => ({
        log,
        classification: classifyCriticalAuditEvent(log),
      })),
    [auditLogs]
  );

  const eventTypes = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.eventType))).sort(),
    [auditLogs]
  );

  const entityTypes = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.entityType))).sort(),
    [auditLogs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedLogs
      .filter(({ log, classification }) => {
        if (viewMode === 'CRITICAL') {
          if (!classification.isCritical) return false;
          if (categoryFilter !== 'ALL_CRITICAL' && classification.category !== categoryFilter) {
            return false;
          }
          if (severityFilter !== 'ALL' && classification.severity !== severityFilter) {
            return false;
          }
        }
        if (eventFilter !== 'ALL' && log.eventType !== eventFilter) return false;
        if (entityFilter !== 'ALL' && log.entityType !== entityFilter) return false;
        if (q) {
          const hay =
            `${log.eventType} ${log.action} ${log.entityId} ${log.transactionId} ${log.userEmail || ''} ${log.justification || ''} ${classification.categoryLabel} ${classification.complianceControl}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => formatTimestamp(b.log.timestamp).localeCompare(formatTimestamp(a.log.timestamp)));
  }, [
    enrichedLogs,
    viewMode,
    categoryFilter,
    severityFilter,
    eventFilter,
    entityFilter,
    search,
  ]);

  const handleExportCsv = () => {
    const headers = [
      'Fecha',
      'Evento Crítico',
      'Severidad',
      'Categoría Normativa',
      'Control de Cumplimiento',
      'Evento',
      'Entidad',
      'ID Entidad',
      'Acción',
      'Estado Anterior',
      'Nuevo Estado',
      'Justificación',
      'Transacción',
      'Usuario',
      'Rol',
    ];
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filtered.map(({ log, classification }) =>
      [
        formatTimestamp(log.timestamp),
        classification.isCritical ? 'SI' : 'NO',
        classification.severity,
        classification.categoryLabel,
        classification.complianceControl,
        log.eventType,
        log.entityType,
        log.entityId,
        log.action,
        log.previousState || '',
        log.newState || '',
        log.justification || '',
        log.transactionId,
        log.userEmail || log.userId,
        log.userRole || '',
      ]
        .map(escape)
        .join(',')
    );
    const csv = '\uFEFF' + [headers.map(escape).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const prefix = viewMode === 'CRITICAL' ? 'AxyCore_EventosCriticos' : 'AxyCore_Auditoria';
    a.download = `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5">
          <NavigationBreadcrumbs variant="inline" showSiblingSwitcher />
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-sky-600" />
            Bitácora de Eventos Críticos y Auditoría Inmutable
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Registro automático e inalterable de cambios de estado, aprobaciones de comité, accesos a documentos confidenciales y controles normativos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('CRITICAL')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                viewMode === 'CRITICAL'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Bitácora Crítica ({summary.totalCritical})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('ALL')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                viewMode === 'ALL'
                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Registro Completo ({summary.totalLogs})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Bitácora CSV
          </button>
        </div>
      </div>

      {/* Compliance KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Eventos Críticos Registrados</span>
            <ShieldCheck className="w-4 h-4 text-sky-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
            {summary.totalCritical}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {summary.criticalSeverityCount} severidad crítica · {summary.uniqueActorsCount} actores únicos
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Cambios de Estado</span>
            <Activity className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
            {summary.statusChangesCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Originación, evaluación, formalización y desembolso
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Aprobaciones de Comité</span>
            <Gavel className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
            {summary.committeeApprovalsCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Dictámenes colegiados inmutables con segregación
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Accesos a Docs. Confidenciales</span>
            <FileLock2 className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
            {summary.confidentialDocAccessCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Vistas previas, descargas, cargas y escaneos OCR IA
          </p>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <Lock className="w-4 h-4 text-sky-600 shrink-0" />
        <span>
          <strong>Cumplimiento Normativo &amp; Integridad Append-Only:</strong> Cada cambio de estado crediticio, decisión de Comité y consulta/descarga/inspección OCR de documentos confidenciales se registra automáticamente en <code className="font-mono">audit_logs</code> con sello de tiempo del servidor y bloqueo total de edición o borrado.
        </span>
      </div>

      {/* Critical Category Navigation Bar */}
      {viewMode === 'CRITICAL' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL_CRITICAL', label: 'Todos los Críticos', count: summary.totalCritical },
              { id: 'STATUS_CHANGE', label: 'Cambios de Estado', count: summary.statusChangesCount },
              { id: 'COMMITTEE_APPROVAL', label: 'Comité de Crédito', count: summary.committeeApprovalsCount },
              {
                id: 'CONFIDENTIAL_DOC_ACCESS',
                label: 'Documentos Confidenciales',
                count: summary.confidentialDocAccessCount,
              },
              {
                id: 'GOVERNANCE_AND_FINANCE',
                label: 'Gobernanza / RBAC / Políticas',
                count: summary.governanceFinanceCount,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id as CriticalCategoryFilter)}
                className={`px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer tabular-nums ${
                  categoryFilter === tab.id
                    ? 'border-sky-700 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          >
            <option value="ALL">Todas las severidades</option>
            <option value="CRITICO">Solo Severidad CRÍTICO</option>
            <option value="ALTO">Solo Severidad ALTO</option>
          </select>
        </div>
      )}

      {/* Search & Field Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por acción, documento confidencial, ID de transacción, usuario o justificación..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
          />
        </div>
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <option value="ALL">Todos los códigos de evento</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <option value="ALL">Todas las entidades</option>
          {entityTypes.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {/* Audit Records Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10">
              <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Fecha / Hora</th>
                <th className="py-2.5 px-3">Clasificación Normativa</th>
                <th className="py-2.5 px-3">Evento / Entidad</th>
                <th className="py-2.5 px-3">Acción / Transición</th>
                <th className="py-2.5 px-3">Usuario / Rol</th>
                <th className="py-2.5 px-3">Transacción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No existen registros de auditoría para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                filtered.map(({ log, classification }) => {
                  const severityClass =
                    classification.severity === 'CRITICO'
                      ? 'text-rose-700 dark:text-rose-400 font-bold'
                      : classification.severity === 'ALTO'
                      ? 'text-amber-700 dark:text-amber-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 font-medium';

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className={severityClass}>{classification.severity}</p>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {classification.category
                            ? CRITICAL_CATEGORY_LABELS[classification.category]
                            : classification.categoryLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {classification.complianceControl}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <p className="font-semibold text-sky-700 dark:text-sky-400">
                          {log.eventType}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {log.entityType} · {log.entityId}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 max-w-md">
                        <p className="font-medium text-slate-900 dark:text-white">{log.action}</p>
                        {(log.previousState || log.newState) && (
                          <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-0.5">
                            {log.previousState || '—'} → {log.newState || '—'}
                          </p>
                        )}
                        {log.justification && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-0.5">
                            {log.justification}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="text-slate-800 dark:text-slate-200">
                          {log.userEmail || log.userId}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {log.userRole || '—'}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {log.transactionId}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
