import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  BookOpenCheck,
  ClipboardCheck,
  FileBarChart2,
  FileSearch,
  FolderArchive,
  GraduationCap,
  LayoutDashboard,
  Scale,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { REGULA_SECTIONS } from '../../engine/regulaEngine';
import type { RegulaSectionId } from '../../types/regula';
import { useRegulaWorkspace } from './useRegulaWorkspace';
import { RegulaDashboardView } from './RegulaDashboardView';
import { RegulaComplianceView } from './RegulaComplianceView';
import { RegulaPlaftView } from './RegulaPlaftView';
import { RegulaRiskView } from './RegulaRiskView';
import { RegulaControlAuditView } from './RegulaControlAuditView';
import { RegulaOperationsGovernanceView } from './RegulaOperationsGovernanceView';
import { RegulaAiView } from './RegulaAiView';
import { RegulaReportsConfigView } from './RegulaReportsConfigView';

const SECTION_ICONS: Record<RegulaSectionId, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  cumplimiento: BookOpenCheck,
  plaftpadm: Scale,
  riesgos: ShieldAlert,
  control_interno: ShieldCheck,
  auditoria: FileSearch,
  evidencias: FolderArchive,
  incidentes: AlertOctagon,
  planes_accion: ClipboardCheck,
  cultura: GraduationCap,
  regula_ai: Sparkles,
  reportes: FileBarChart2,
  configuracion: Settings2,
};

export function RegulaWorkspaceView() {
  const ws = useRegulaWorkspace();
  const [activeSection, setActiveSection] = useState<RegulaSectionId>('dashboard');
  const [globalQuery, setGlobalQuery] = useState('');

  const visibleSections = useMemo(
    () => REGULA_SECTIONS.filter((s) => ws.can(s.id, 'ver')),
    [ws]
  );

  const searchMatches = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const results: Array<{ section: RegulaSectionId; type: string; code: string; title: string }> = [];

    for (const o of ws.data.obligaciones) {
      if (!o.deletedAt && `${o.code} ${o.title} ${o.regulator}`.toLowerCase().includes(q)) {
        results.push({ section: 'cumplimiento', type: 'Obligación', code: o.code, title: o.title });
      }
    }
    for (const r of ws.data.riesgos) {
      if (!r.deletedAt && `${r.code} ${r.name} ${r.category}`.toLowerCase().includes(q)) {
        results.push({ section: 'riesgos', type: 'Riesgo', code: r.code, title: r.name });
      }
    }
    for (const c of ws.data.controles) {
      if (!c.deletedAt && `${c.code} ${c.name}`.toLowerCase().includes(q)) {
        results.push({ section: 'control_interno', type: 'Control', code: c.code, title: c.name });
      }
    }
    for (const h of ws.data.hallazgos) {
      if (!h.deletedAt && `${h.code} ${h.title}`.toLowerCase().includes(q)) {
        results.push({ section: 'auditoria', type: 'Hallazgo', code: h.code, title: h.title });
      }
    }
    for (const i of ws.data.incidentes) {
      if (!i.deletedAt && `${i.code} ${i.title}`.toLowerCase().includes(q)) {
        results.push({ section: 'incidentes', type: 'Incidente', code: i.code, title: i.title });
      }
    }
    for (const p of ws.data.planesAccion) {
      if (!p.deletedAt && `${p.code} ${p.title}`.toLowerCase().includes(q)) {
        results.push({ section: 'planes_accion', type: 'Plan de Acción', code: p.code, title: p.title });
      }
    }
    return results.slice(0, 12);
  }, [globalQuery, ws.data]);

  const currentMeta = REGULA_SECTIONS.find((s) => s.id === activeSection) || REGULA_SECTIONS[0];

  return (
    <div className="max-w-[1480px] mx-auto space-y-5">
      {/* Module Top Header + Global REGULA Search */}
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 p-5 text-white shadow-lg">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-[#0066FF]/25 text-[#00D1FF] border border-[#00D1FF]/35">
                AxyCore REGULA
              </span>
              <span className="text-[11px] text-slate-300">
                {ws.effectiveConfig.institutionName} · Rol:{' '}
                <strong className="text-[#E2B35E]">{ws.activeRegulaRole?.name || ws.userProfile?.role}</strong>
              </span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
              Inteligencia Regulatoria, Cumplimiento y Gestión Integral de Riesgos
            </h1>
            <p className="text-xs text-slate-300">
              {currentMeta.label}: {currentMeta.description}
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="Buscar obligaciones, riesgos, controles, hallazgos..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-white/10 border border-white/15 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-[#00D1FF]"
            />
            {globalQuery && (
              <button
                type="button"
                onClick={() => setGlobalQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {searchMatches.length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/30 shadow-2xl divide-y divide-slate-100 dark:divide-white/10 max-h-72 overflow-y-auto text-slate-900 dark:text-white">
                {searchMatches.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveSection(m.section);
                      setGlobalQuery('');
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5 flex items-center justify-between gap-2 text-xs cursor-pointer"
                  >
                    <span className="truncate">
                      <strong className="font-mono text-[#0066FF] dark:text-[#00D1FF] mr-1.5">{m.code}</strong>
                      {m.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 shrink-0">
                      {m.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Horizontal 13-section Navigation Rail */}
        <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap gap-1.5">
          {visibleSections.map((sec) => {
            const Icon = SECTION_ICONS[sec.id];
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  isActive
                    ? 'bg-[#0066FF] text-white shadow-sm'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{sec.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {ws.syncError && (
        <div className="p-3.5 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-800 dark:text-rose-200 text-xs">
          {ws.syncError}
        </div>
      )}

      {/* Active Section View */}
      <div>
        {activeSection === 'dashboard' && (
          <RegulaDashboardView ws={ws} onNavigate={setActiveSection} />
        )}
        {activeSection === 'cumplimiento' && (
          <RegulaComplianceView ws={ws} onNavigate={setActiveSection} />
        )}
        {activeSection === 'plaftpadm' && <RegulaPlaftView ws={ws} />}
        {activeSection === 'riesgos' && <RegulaRiskView ws={ws} />}
        {activeSection === 'control_interno' && (
          <RegulaControlAuditView ws={ws} mode="control_interno" />
        )}
        {activeSection === 'auditoria' && (
          <RegulaControlAuditView ws={ws} mode="auditoria" />
        )}
        {activeSection === 'evidencias' && (
          <RegulaOperationsGovernanceView ws={ws} mode="evidencias" />
        )}
        {activeSection === 'incidentes' && (
          <RegulaOperationsGovernanceView ws={ws} mode="incidentes" />
        )}
        {activeSection === 'planes_accion' && (
          <RegulaOperationsGovernanceView ws={ws} mode="planes_accion" />
        )}
        {activeSection === 'cultura' && (
          <RegulaOperationsGovernanceView ws={ws} mode="cultura" />
        )}
        {activeSection === 'regula_ai' && <RegulaAiView ws={ws} />}
        {activeSection === 'reportes' && (
          <RegulaReportsConfigView ws={ws} mode="reportes" />
        )}
        {activeSection === 'configuracion' && (
          <RegulaReportsConfigView ws={ws} mode="configuracion" />
        )}
      </div>
    </div>
  );
}
