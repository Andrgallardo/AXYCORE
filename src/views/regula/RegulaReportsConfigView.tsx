import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  PlugZap,
  Save,
  Settings2,
  Shield,
  Sliders,
} from 'lucide-react';
import { REGULA_REPORT_CATALOG } from '../../engine/regulaEngine';
import {
  buildRegulaReportDataset,
  exportRegulaReportToCsv,
  exportRegulaReportToPdf,
} from '../../engine/regulaReports';
import { saveRegulaConfiguration } from '../../services/regulaStore';
import {
  ALL_REGULA_ACTION_PERMISSIONS,
  type RegulaActionPermission,
  type RegulaConfiguracionRecord,
  type RegulaReportCode,
  type RegulaReportFilters,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

interface IntegrationStatusPayload {
  regulaAiConfigured: boolean;
  model: string;
  smtpConfigured: boolean;
  whatsappConfigured: boolean;
  regulatoryFeedConfigured: boolean;
  sanctionsApiConfigured: boolean;
  regulatoryFeedNote: string;
  sanctionsApiNote: string;
}

export function RegulaReportsConfigView({
  ws,
  mode,
}: {
  ws: RegulaWorkspaceState;
  mode: 'reportes' | 'configuracion';
}) {
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // =========================================================================
  // REPORTES (18 Reportes Institucionales con Filtros + PDF + Excel/CSV)
  // =========================================================================
  const [selectedReport, setSelectedReport] = useState<RegulaReportCode>('CUMPLIMIENTO_GENERAL');
  const [filters, setFilters] = useState<RegulaReportFilters>({
    branch: '',
    department: '',
    responsible: '',
    dateFrom: '',
    dateTo: '',
    category: '',
    riskLevel: '',
    status: '',
  });

  const dataset = useMemo(
    () =>
      buildRegulaReportDataset({
        reportCode: selectedReport,
        data: ws.data,
        filters,
        organizationName: ws.effectiveConfig.institutionName || ws.organization.name,
        generatedByName: ws.userProfile?.displayName || 'Usuario AxyCore',
        todayIso: ws.todayIso,
      }),
    [selectedReport, ws.data, filters, ws.effectiveConfig.institutionName, ws.organization.name, ws.userProfile, ws.todayIso]
  );

  // =========================================================================
  // CONFIGURACIÓN DEL MÓDULO
  // =========================================================================
  const [draftConfig, setDraftConfig] = useState<RegulaConfiguracionRecord>(ws.effectiveConfig);
  const [savingCfg, setSavingCfg] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatusPayload | null>(null);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>(
    ws.effectiveConfig.roles[0]?.code || 'OFICIAL_CUMPLIMIENTO'
  );

  useEffect(() => {
    setDraftConfig(ws.effectiveConfig);
  }, [ws.effectiveConfig]);

  useEffect(() => {
    if (mode !== 'configuracion') return;
    fetch('/api/regula/integrations-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setIntegrations(j))
      .catch(() => undefined);
  }, [mode]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!ws.can('configuracion', 'configurar')) {
      setMsg({ type: 'err', text: 'Tu rol no tiene permisos para modificar la configuración de REGULA.' });
      return;
    }
    setSavingCfg(true);
    setMsg(null);
    try {
      await saveRegulaConfiguration({
        user: ws.userProfile,
        organizationId: ws.orgId,
        institutionName: draftConfig.institutionName,
        existingConfig: ws.data.config,
        updates: {
          institutionName: draftConfig.institutionName,
          entityType: draftConfig.entityType,
          economicActivity: draftConfig.economicActivity,
          jurisdiction: draftConfig.jurisdiction,
          primarySupervisor: draftConfig.primarySupervisor,
          departments: draftConfig.departments,
          branches: draftConfig.branches,
          riskThresholds: draftConfig.riskThresholds,
          plaftFactorWeights: draftConfig.plaftFactorWeights,
          roles: draftConfig.roles,
          userRoleAssignments: draftConfig.userRoleAssignments,
          aiEnabled: draftConfig.aiEnabled,
          aiRequireHumanValidation: draftConfig.aiRequireHumanValidation,
          aiCiteSourcesStrict: draftConfig.aiCiteSourcesStrict,
        },
      });
      setMsg({ type: 'ok', text: 'Configuración institucional de AxyCore REGULA guardada y auditada.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando configuración.' });
    } finally {
      setSavingCfg(false);
    }
  };

  const toggleRolePermission = (
    roleCode: string,
    sectionId: keyof RegulaConfiguracionRecord['roles'][number]['permissions'],
    action: RegulaActionPermission
  ) => {
    setDraftConfig((prev) => ({
      ...prev,
      roles: prev.roles.map((r) => {
        if (r.code !== roleCode) return r;
        const curr = r.permissions[sectionId] || [];
        const next = curr.includes(action) ? curr.filter((a) => a !== action) : [...curr, action];
        return { ...r, permissions: { ...r.permissions, [sectionId]: next } };
      }),
    }));
  };

  const activeRoleObj = draftConfig.roles.find((r) => r.code === selectedRoleCode) || draftConfig.roles[0];

  if (mode === 'reportes') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileBarChart2 className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
              <span>Centro de Reportes e Indicadores (18 Reportes Oficiales)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Genera vistas filtrables en tiempo real sobre los datos de tu organización y exporta directamente a PDF o Excel/CSV.
            </p>
          </div>
          {ws.can('reportes', 'exportar') && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportRegulaReportToPdf(dataset)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar PDF</span>
              </button>
              <button
                type="button"
                onClick={() => exportRegulaReportToCsv(dataset)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#08132B] text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Exportar Excel / CSV</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Report Selector List */}
          <div className="p-3 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-1 max-h-[640px] overflow-y-auto">
            {REGULA_REPORT_CATALOG.map((rep) => (
              <button
                key={rep.code}
                type="button"
                onClick={() => setSelectedReport(rep.code)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition cursor-pointer ${
                  selectedReport === rep.code
                    ? 'bg-[#0066FF] text-white font-semibold'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                <p className="leading-snug">{rep.title}</p>
                <p className={`text-[10px] mt-0.5 ${selectedReport === rep.code ? 'text-blue-100' : 'text-slate-400'}`}>
                  {rep.category}
                </p>
              </button>
            ))}
          </div>

          {/* Filters + Live Preview Table */}
          <div className="lg:col-span-3 space-y-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <select
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              >
                <option value="">Todas las áreas</option>
                {ws.effectiveConfig.departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                value={filters.responsible}
                onChange={(e) => setFilters({ ...filters, responsible: e.target.value })}
                placeholder="Filtrar responsable..."
                className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{dataset.title}</h3>
                <p className="text-xs text-slate-500">{dataset.subtitle}</p>
                <div className="mt-2 space-y-1">
                  {dataset.summaryLines.map((line, i) => (
                    <p key={i} className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      • {line}
                    </p>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      {dataset.columns.map((col, idx) => (
                        <th key={idx} className="px-3 py-2.5 font-bold whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-white/10">
                    {dataset.rows.length === 0 ? (
                      <tr>
                        <td colSpan={dataset.columns.length} className="px-4 py-8 text-center text-slate-500">
                          Sin registros para este reporte con los filtros actuales.
                        </td>
                      </tr>
                    ) : (
                      dataset.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-50/80 dark:hover:bg-white/5">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-2 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400">
                Fuentes: {dataset.dataSources.join(', ')} · Filtros: {dataset.appliedFiltersSummary}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CONFIGURACIÓN DEL MÓDULO
  // =========================================================================
  return (
    <form onSubmit={handleSaveConfig} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
            <span>Configuración Institucional de AxyCore REGULA</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Perfil regulatorio por organización, ponderaciones PLAFTPADM, roles granulares, políticas de IA e integraciones externas.
          </p>
        </div>
        {ws.can('configuracion', 'configurar') && (
          <button
            type="submit"
            disabled={savingCfg}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savingCfg ? 'Guardando...' : 'Guardar Configuración'}</span>
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
            msg.type === 'ok'
              ? 'bg-emerald-500/12 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-500/12 border border-rose-500/30 text-rose-800 dark:text-rose-200'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Institutional Profile */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Perfil Institucional y Jurisdicción</h3>
          <input
            value={draftConfig.institutionName}
            onChange={(e) => setDraftConfig({ ...draftConfig, institutionName: e.target.value })}
            placeholder="Nombre institucional"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
          />
          <input
            value={draftConfig.entityType}
            onChange={(e) => setDraftConfig({ ...draftConfig, entityType: e.target.value })}
            placeholder="Tipo de entidad"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draftConfig.jurisdiction}
              onChange={(e) => setDraftConfig({ ...draftConfig, jurisdiction: e.target.value })}
              placeholder="Jurisdicción"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
            />
            <input
              value={draftConfig.primarySupervisor}
              onChange={(e) => setDraftConfig({ ...draftConfig, primarySupervisor: e.target.value })}
              placeholder="Supervisor Principal"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
            />
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
            <p className="text-xs font-bold text-slate-900 dark:text-white">Gobierno de REGULA AI</p>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={draftConfig.aiEnabled}
                onChange={(e) => setDraftConfig({ ...draftConfig, aiEnabled: e.target.checked })}
              />
              <span>Habilitar REGULA AI para usuarios internos autorizados</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={draftConfig.aiRequireHumanValidation}
                onChange={(e) => setDraftConfig({ ...draftConfig, aiRequireHumanValidation: e.target.checked })}
              />
              <span>Exigir validación humana obligatoria para propuestas de IA</span>
            </label>
          </div>
        </div>

        {/* PLAFT Factor Weights */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#0066FF]" />
            <span>Ponderaciones de Riesgo PLAFTPADM (%)</span>
          </h3>
          <div className="space-y-2">
            {draftConfig.plaftFactorWeights.map((f, idx) => (
              <div key={f.code} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-700 dark:text-slate-200 flex-1">{f.label}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={f.weightPct}
                  onChange={(e) => {
                    const nextVal = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setDraftConfig((prev) => ({
                      ...prev,
                      plaftFactorWeights: prev.plaftFactorWeights.map((item, i) =>
                        i === idx ? { ...item, weightPct: nextVal } : item
                      ),
                    }));
                  }}
                  className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono text-right"
                />
                <span className="text-slate-400">%</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Suma actual:{' '}
            <strong className="font-mono">
              {draftConfig.plaftFactorWeights.reduce((s, f) => s + f.weightPct, 0)}%
            </strong>{' '}
            (el motor normaliza automáticamente sobre 100%).
          </p>
        </div>
      </div>

      {/* Granular Role Assignments & Permissions Matrix */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#0066FF]" />
            <span>Roles Granulares de REGULA y Matriz de 11 Permisos</span>
          </h3>
          <select
            value={selectedRoleCode}
            onChange={(e) => setSelectedRoleCode(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs font-semibold"
          >
            {draftConfig.roles.map((r) => (
              <option key={r.code} value={r.code}>{r.name}</option>
            ))}
          </select>
        </div>

        {activeRoleObj && (
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 dark:bg-[#040C1E] text-slate-500 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Sección REGULA</th>
                  {ALL_REGULA_ACTION_PERMISSIONS.map((act) => (
                    <th key={act} className="px-2 py-2 text-center">{act.replace('_', '/')}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-white/10">
                {(Object.keys(activeRoleObj.permissions) as Array<keyof typeof activeRoleObj.permissions>).map((sec) => (
                  <tr key={sec}>
                    <td className="px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200">{sec}</td>
                    {ALL_REGULA_ACTION_PERMISSIONS.map((act) => (
                      <td key={act} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={(activeRoleObj.permissions[sec] || []).includes(act)}
                          onChange={() => toggleRolePermission(activeRoleObj.code, sec, act)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* User -> REGULA Role Mapping */}
        {ws.usersList.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              Asignación de Rol REGULA por Usuario ({ws.usersList.filter((u) => u.role !== 'EXTERNAL_CLIENT').length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {ws.usersList
                .filter((u) => u.role !== 'EXTERNAL_CLIENT')
                .map((u) => (
                  <div
                    key={u.uid}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E]/70 border border-slate-200/70 dark:border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{u.displayName}</p>
                      <p className="text-[10px] text-slate-500 truncate">{u.role}</p>
                    </div>
                    <select
                      value={draftConfig.userRoleAssignments?.[u.uid] || ''}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          userRoleAssignments: {
                            ...(prev.userRoleAssignments || {}),
                            [u.uid]: e.target.value,
                          },
                        }))
                      }
                      className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-[11px]"
                    >
                      <option value="">Por defecto ({u.role})</option>
                      {draftConfig.roles.map((r) => (
                        <option key={r.code} value={r.code}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Honest External Integrations Status */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <PlugZap className="w-4 h-4 text-[#00D1FF]" />
          <span>Estado Real de Integraciones Externas (Sin Simulaciones)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {[
            {
              label: 'REGULA AI (Gemini Server-Side)',
              ok: integrations?.regulaAiConfigured ?? false,
              note: integrations?.regulaAiConfigured ? `Activo (${integrations.model})` : 'Requiere GEMINI_API_KEY en el servidor.',
            },
            {
              label: 'Fuentes Regulatorias Externas',
              ok: integrations?.regulatoryFeedConfigured ?? false,
              note: integrations?.regulatoryFeedNote || 'Requiere configurar endpoint autorizado (REGULA_OFFICIAL_FEED_URL).',
            },
            {
              label: 'Listas Restrictivas / Sanciones',
              ok: integrations?.sanctionsApiConfigured ?? false,
              note: integrations?.sanctionsApiNote || 'Requiere proveedor autorizado (OFAC/ONU vía REGULA_SANCTIONS_API_URL).',
            },
            {
              label: 'Notificaciones SMTP / WhatsApp',
              ok: Boolean(integrations?.smtpConfigured || integrations?.whatsappConfigured),
              note:
                integrations?.smtpConfigured || integrations?.whatsappConfigured
                  ? 'Canal externo activo junto a notificaciones internas de AxyCore.'
                  : 'Alertas internas de AxyCore activas; correo SMTP/WhatsApp requieren credenciales.',
            },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E]/70 border border-slate-200/70 dark:border-white/10 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-white">{item.label}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    item.ok
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {item.ok ? 'Configurado' : 'No configurado'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.note}</p>
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}
