import React, { useMemo, useState } from 'react';
import {
  Activity,
  Flame,
  Layers,
  Plus,
  Shield,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  computeRiskEvaluation,
  REGULA_RISK_CATEGORY_LABELS,
} from '../../engine/regulaEngine';
import { createRegulaEntity, updateRegulaEntity } from '../../services/regulaStore';
import type {
  RegulaEvaluacionRiesgoRecord,
  RegulaRiesgoRecord,
  RegulaRiskCategory,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

type RiskTab = 'matriz' | 'evaluacion' | 'mapa_calor' | 'mitigacion';

const QUICK_CATEGORIES: Array<{ id: 'ALL' | RegulaRiskCategory; label: string }> = [
  { id: 'ALL', label: 'Todas las categorías' },
  { id: 'OPERACIONAL', label: 'Operacional' },
  { id: 'CREDITICIO', label: 'Crediticio' },
  { id: 'LIQUIDEZ', label: 'Liquidez' },
  { id: 'TECNOLOGICO', label: 'Tecnológico' },
  { id: 'CIBERSEGURIDAD', label: 'Ciberseguridad' },
  { id: 'LEGAL', label: 'Legal' },
  { id: 'REGULATORIO', label: 'Regulatorio' },
  { id: 'REPUTACIONAL', label: 'Reputacional' },
];

const LEVEL_BADGE: Record<string, string> = {
  CRITICO: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30',
  ALTO: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30',
  MEDIO: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  BAJO: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
};

export function RegulaRiskView({ ws }: { ws: RegulaWorkspaceState }) {
  const [tab, setTab] = useState<RiskTab>('matriz');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | RegulaRiskCategory>('ALL');
  const [heatmapMode, setHeatmapMode] = useState<'RESIDUAL' | 'INHERENTE'>('RESIDUAL');
  const [selectedRisk, setSelectedRisk] = useState<RegulaRiesgoRecord | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const canCreate = ws.can('riesgos', 'crear');
  const canEdit = ws.can('riesgos', 'editar');

  const riesgos = useMemo(() => ws.data.riesgos.filter((r) => !r.deletedAt), [ws.data.riesgos]);
  const controles = useMemo(() => ws.data.controles.filter((c) => !c.deletedAt), [ws.data.controles]);

  const filteredRiesgos = useMemo(
    () => riesgos.filter((r) => (categoryFilter === 'ALL' ? true : r.category === categoryFilter)),
    [riesgos, categoryFilter]
  );

  // Create Risk Form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    category: 'OPERACIONAL' as RegulaRiskCategory,
    processArea: ws.effectiveConfig.departments[0] || 'Operaciones',
    ownerName: ws.userProfile?.displayName || 'Gerente de Riesgos',
    causes: '',
    consequences: '',
    inherentProbability: 3 as 1 | 2 | 3 | 4 | 5,
    inherentImpact: 4 as 1 | 2 | 3 | 4 | 5,
    treatmentStrategy: 'MITIGAR' as RegulaRiesgoRecord['treatmentStrategy'],
    mitigationPlanSummary: '',
    linkedControlIds: [] as string[],
  });

  // Re-evaluation Form
  const [evalTargetId, setEvalTargetId] = useState('');
  const [evalForm, setEvalForm] = useState({
    inherentProbability: 3 as 1 | 2 | 3 | 4 | 5,
    inherentImpact: 3 as 1 | 2 | 3 | 4 | 5,
    residualProbability: 2 as 1 | 2 | 3 | 4 | 5,
    residualImpact: 2 as 1 | 2 | 3 | 4 | 5,
    rationale: '',
  });

  const handleCreateRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    setMsg(null);
    try {
      const code = form.code.trim() || `RSK-${String(riesgos.length + 1).padStart(3, '0')}`;
      const linkedControls = controles.filter((c) => form.linkedControlIds.includes(c.id));
      const calc = computeRiskEvaluation({
        inherentProbability: form.inherentProbability,
        inherentImpact: form.inherentImpact,
        linkedControls,
        thresholds: ws.effectiveConfig.riskThresholds,
      });

      const created = await createRegulaEntity<RegulaRiesgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_matriz_riesgos',
        prefix: 'rgrsk',
        entityCode: code,
        auditAction: 'CREACION_RIESGO',
        data: {
          code,
          name: form.name.trim(),
          description: form.description.trim(),
          category: form.category,
          processArea: form.processArea,
          ownerName: form.ownerName.trim(),
          causes: form.causes.trim(),
          consequences: form.consequences.trim(),
          inherentProbability: form.inherentProbability,
          inherentImpact: form.inherentImpact,
          inherentScore: calc.inherentScore,
          inherentLevel: calc.inherentLevel,
          residualProbability: calc.residualProbability,
          residualImpact: calc.residualImpact,
          residualScore: calc.residualScore,
          residualLevel: calc.residualLevel,
          treatmentStrategy: form.treatmentStrategy,
          mitigationPlanSummary: form.mitigationPlanSummary.trim() || undefined,
          status: 'ACTIVO',
          linkedControlIds: form.linkedControlIds,
          linkedObligationIds: [],
          linkedActionPlanIds: [],
          lastEvaluatedAt: ws.todayIso,
        },
      });

      await createRegulaEntity<RegulaEvaluacionRiesgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_evaluaciones_riesgo',
        prefix: 'rgevr',
        entityCode: code,
        auditAction: 'EVALUACION_INICIAL_RIESGO',
        data: {
          riesgoId: created.id,
          riesgoCode: code,
          evaluationDate: ws.todayIso,
          inherentProbability: form.inherentProbability,
          inherentImpact: form.inherentImpact,
          inherentScore: calc.inherentScore,
          residualProbability: calc.residualProbability,
          residualImpact: calc.residualImpact,
          residualScore: calc.residualScore,
          residualLevel: calc.residualLevel,
          controlEffectivenessApplied: linkedControls.length > 0 ? linkedControls[0].effectiveness : 'NO_EVALUADO',
          evaluatorName: ws.userProfile.displayName || 'Analista',
          rationale: 'Evaluación inicial al registrar el riesgo en matriz institucional.',
        },
      });

      setShowForm(false);
      setForm({ ...form, code: '', name: '', description: '', causes: '', consequences: '', mitigationPlanSummary: '' });
      setMsg({ type: 'ok', text: `Riesgo ${code} registrado (Inherente ${calc.inherentScore} → Residual ${calc.residualScore} ${calc.residualLevel}).` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando riesgo.' });
    }
  };

  const handleReevaluateRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canEdit) return;
    const risk = riesgos.find((r) => r.id === evalTargetId);
    if (!risk) return;
    try {
      const calc = computeRiskEvaluation({
        inherentProbability: evalForm.inherentProbability,
        inherentImpact: evalForm.inherentImpact,
        manualResidualProbability: evalForm.residualProbability,
        manualResidualImpact: evalForm.residualImpact,
        thresholds: ws.effectiveConfig.riskThresholds,
      });

      await createRegulaEntity<RegulaEvaluacionRiesgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_evaluaciones_riesgo',
        prefix: 'rgevr',
        entityCode: risk.code,
        auditAction: 'REEVALUACION_RIESGO',
        data: {
          riesgoId: risk.id,
          riesgoCode: risk.code,
          evaluationDate: ws.todayIso,
          inherentProbability: evalForm.inherentProbability,
          inherentImpact: evalForm.inherentImpact,
          inherentScore: calc.inherentScore,
          residualProbability: calc.residualProbability,
          residualImpact: calc.residualImpact,
          residualScore: calc.residualScore,
          residualLevel: calc.residualLevel,
          controlEffectivenessApplied: 'EFECTIVO',
          evaluatorName: ws.userProfile.displayName || 'Evaluador',
          rationale: evalForm.rationale.trim(),
        },
      });

      await updateRegulaEntity<RegulaRiesgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_matriz_riesgos',
        id: risk.id,
        entityCode: risk.code,
        auditAction: 'ACTUALIZACION_CALIFICACION_RIESGO',
        previousSummary: `Res ${risk.residualScore} (${risk.residualLevel})`,
        newSummary: `Res ${calc.residualScore} (${calc.residualLevel})`,
        patch: {
          inherentProbability: evalForm.inherentProbability,
          inherentImpact: evalForm.inherentImpact,
          inherentScore: calc.inherentScore,
          inherentLevel: calc.inherentLevel,
          residualProbability: calc.residualProbability,
          residualImpact: calc.residualImpact,
          residualScore: calc.residualScore,
          residualLevel: calc.residualLevel,
          lastEvaluatedAt: ws.todayIso,
        },
      });
      setEvalForm({ ...evalForm, rationale: '' });
      setMsg({ type: 'ok', text: `Evaluación registrada para ${risk.code}. Nuevo nivel residual: ${calc.residualLevel}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando evaluación.' });
    }
  };

  const activeHeatmap = heatmapMode === 'RESIDUAL' ? ws.residualHeatmap : ws.inherentHeatmap;

  return (
    <div className="space-y-5">
      {/* Subtabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'matriz' as RiskTab, label: `Matriz de Riesgos (${riesgos.length})`, icon: Layers },
            { id: 'evaluacion' as RiskTab, label: `Evaluación e Historial (${ws.data.evaluacionesRiesgo.length})`, icon: SlidersHorizontal },
            { id: 'mapa_calor' as RiskTab, label: 'Mapa de Calor 5×5', icon: Flame },
            { id: 'mitigacion' as RiskTab, label: 'Planes de Mitigación', icon: Shield },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                  tab === t.id ? 'axy-brand-gradient text-white' : 'axy-surface text-slate-700 dark:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setTab('matriz');
              setShowForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Registrar Riesgo</span>
          </button>
        )}
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-xs flex justify-between ${msg.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200' : 'bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">Cerrar</button>
        </div>
      )}

      {/* TAB 1: MATRIZ DE RIESGOS */}
      {tab === 'matriz' && (
        <div className="space-y-4">
          {/* Quick Category Filters */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryFilter(c.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors ${
                  categoryFilter === c.id
                    ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF]'
                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {showForm && (
            <form onSubmit={handleCreateRisk} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input placeholder="Código (ej. RSK-001)" className="axy-input px-3 py-2 text-xs" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              <input required placeholder="Nombre del Riesgo *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="axy-input px-3 py-2 text-xs" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as RegulaRiskCategory })}>
                {(Object.keys(REGULA_RISK_CATEGORY_LABELS) as RegulaRiskCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{REGULA_RISK_CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
              <select className="axy-input px-3 py-2 text-xs" value={form.processArea} onChange={(e) => setForm({ ...form, processArea: e.target.value })}>
                {ws.effectiveConfig.departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input required placeholder="Dueño del riesgo *" className="axy-input px-3 py-2 text-xs" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
              <div>
                <label className="text-[11px] font-semibold">Probabilidad Inherente (1–5)</label>
                <select className="axy-input mt-1 w-full px-3 py-2 text-xs" value={form.inherentProbability} onChange={(e) => setForm({ ...form, inherentProbability: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}>
                  {ws.effectiveConfig.probabilityScale.map((p) => <option key={p.level} value={p.level}>{p.level} - {p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold">Impacto Inherente (1–5)</label>
                <select className="axy-input mt-1 w-full px-3 py-2 text-xs" value={form.inherentImpact} onChange={(e) => setForm({ ...form, inherentImpact: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}>
                  {ws.effectiveConfig.impactScale.map((i) => <option key={i.level} value={i.level}>{i.level} - {i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold">Estrategia de Tratamiento</label>
                <select className="axy-input mt-1 w-full px-3 py-2 text-xs" value={form.treatmentStrategy} onChange={(e) => setForm({ ...form, treatmentStrategy: e.target.value as RegulaRiesgoRecord['treatmentStrategy'] })}>
                  <option value="MITIGAR">Mitigar</option>
                  <option value="EVITAR">Evitar</option>
                  <option value="TRANSFERIR">Transferir</option>
                  <option value="ACEPTAR">Aceptar</option>
                </select>
              </div>
              <textarea required rows={2} placeholder="Descripción del riesgo *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <input placeholder="Causas principales" className="axy-input md:col-span-1 px-3 py-2 text-xs" value={form.causes} onChange={(e) => setForm({ ...form, causes: e.target.value })} />
              <input placeholder="Consecuencias potenciales" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={form.consequences} onChange={(e) => setForm({ ...form, consequences: e.target.value })} />
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Riesgo</button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Código / Riesgo</th>
                    <th className="px-3 py-3">Categoría</th>
                    <th className="px-3 py-3">Área / Dueño</th>
                    <th className="px-3 py-3">Inherente</th>
                    <th className="px-3 py-3">Residual</th>
                    <th className="px-3 py-3">Tratamiento</th>
                    <th className="px-4 py-3 text-right">Expediente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {filteredRiesgos.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No hay riesgos registrados en esta categoría.</td></tr>
                  ) : (
                    filteredRiesgos.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{r.code}</div>
                          <div className="font-semibold text-slate-900 dark:text-white">{r.name}</div>
                        </td>
                        <td className="px-3 py-3">{REGULA_RISK_CATEGORY_LABELS[r.category]}</td>
                        <td className="px-3 py-3">
                          <div>{r.processArea}</div>
                          <div className="text-[11px] text-slate-500">{r.ownerName}</div>
                        </td>
                        <td className="px-3 py-3 font-mono">{r.inherentScore} ({r.inherentProbability}×{r.inherentImpact})</td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${LEVEL_BADGE[r.residualLevel]}`}>
                            {r.residualScore} · {r.residualLevel}
                          </span>
                        </td>
                        <td className="px-3 py-3">{r.treatmentStrategy}</td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => setSelectedRisk(r)} className="text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer">
                            Ver Expediente
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EVALUACIÓN E HISTORIAL */}
      {tab === 'evaluacion' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <form onSubmit={handleReevaluateRisk} className="lg:col-span-5 axy-surface rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">Registrar Nueva Evaluación</h3>
            <select required className="axy-input w-full px-3 py-2 text-xs" value={evalTargetId} onChange={(e) => setEvalTargetId(e.target.value)}>
              <option value="">Selecciona riesgo a reevaluar...</option>
              {riesgos.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold">Prob. Inherente</label>
                <input type="number" min={1} max={5} className="axy-input mt-1 w-full px-3 py-1.5 text-xs" value={evalForm.inherentProbability} onChange={(e) => setEvalForm({ ...evalForm, inherentProbability: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })} />
              </div>
              <div>
                <label className="text-[11px] font-semibold">Imp. Inherente</label>
                <input type="number" min={1} max={5} className="axy-input mt-1 w-full px-3 py-1.5 text-xs" value={evalForm.inherentImpact} onChange={(e) => setEvalForm({ ...evalForm, inherentImpact: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })} />
              </div>
              <div>
                <label className="text-[11px] font-semibold">Prob. Residual</label>
                <input type="number" min={1} max={5} className="axy-input mt-1 w-full px-3 py-1.5 text-xs" value={evalForm.residualProbability} onChange={(e) => setEvalForm({ ...evalForm, residualProbability: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })} />
              </div>
              <div>
                <label className="text-[11px] font-semibold">Imp. Residual</label>
                <input type="number" min={1} max={5} className="axy-input mt-1 w-full px-3 py-1.5 text-xs" value={evalForm.residualImpact} onChange={(e) => setEvalForm({ ...evalForm, residualImpact: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })} />
              </div>
            </div>
            <textarea required rows={3} placeholder="Fundamento técnico de la reevaluación y efectividad de controles aplicados..." className="axy-input w-full px-3 py-2 text-xs" value={evalForm.rationale} onChange={(e) => setEvalForm({ ...evalForm, rationale: e.target.value })} />
            <button type="submit" disabled={!canEdit} className="w-full py-2 rounded-xl axy-btn-primary text-xs cursor-pointer disabled:opacity-50">
              Guardar Evaluación en Historial
            </button>
          </form>

          <div className="lg:col-span-7 axy-surface rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">Historial de Evaluaciones de Riesgo</h3>
            {ws.data.evaluacionesRiesgo.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">Sin evaluaciones históricas registradas.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-96 overflow-y-auto">
                {ws.data.evaluacionesRiesgo.map((ev) => (
                  <div key={ev.id} className="py-2.5 text-xs space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono text-[#0052CC] dark:text-[#00D1FF]">{ev.riesgoCode} · {ev.evaluationDate}</span>
                      <span className="font-mono">Inh {ev.inherentScore} → Res {ev.residualScore} ({ev.residualLevel})</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{ev.rationale}</p>
                    <div className="text-[10px] text-slate-500">Evaluador: {ev.evaluatorName}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MAPA DE CALOR 5x5 INTERACTIVO */}
      {tab === 'mapa_calor' && (
        <div className="axy-surface rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Mapa de Calor Institucional 5×5 ({heatmapMode})
              </h3>
              <p className="text-xs text-slate-500">Haz clic en cualquier riesgo dentro de una celda para abrir su Expediente de Riesgo.</p>
            </div>
            <div className="flex gap-1.5">
              {(['RESIDUAL', 'INHERENTE'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setHeatmapMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    heatmapMode === m ? 'axy-brand-gradient text-white' : 'axy-btn-secondary'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="grid grid-cols-6 gap-2 min-w-[540px]">
              <div className="text-[11px] font-mono text-slate-500 flex items-end justify-center pb-2">Prob \ Imp</div>
              {ws.effectiveConfig.impactScale.map((imp) => (
                <div key={imp.level} className="text-center text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  {imp.level}. {imp.label}
                </div>
              ))}
              {activeHeatmap.map((row) => (
                <React.Fragment key={row[0].probability}>
                  <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center text-center">
                    P{row[0].probability}
                  </div>
                  {row.map((cell) => {
                    const cls =
                      cell.level === 'CRITICO'
                        ? 'bg-rose-500/20 border-rose-500/40'
                        : cell.level === 'ALTO'
                        ? 'bg-orange-500/20 border-orange-500/40'
                        : cell.level === 'MEDIO'
                        ? 'bg-amber-500/18 border-amber-500/35'
                        : 'bg-emerald-500/15 border-emerald-500/30';
                    return (
                      <div key={`${cell.probability}_${cell.impact}`} className={`min-h-[84px] rounded-xl border p-2 flex flex-col justify-between ${cls}`}>
                        <div className="flex justify-between text-[10px] font-mono font-bold opacity-80">
                          <span>{cell.score}</span>
                          <span>{cell.risks.length}</span>
                        </div>
                        <div className="space-y-1 mt-1">
                          {cell.risks.slice(0, 3).map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setSelectedRisk(r)}
                              className="w-full text-left px-1.5 py-0.5 rounded bg-white/80 dark:bg-slate-900/75 text-[10px] font-semibold truncate hover:underline cursor-pointer"
                            >
                              {r.code}
                            </button>
                          ))}
                          {cell.risks.length > 3 && (
                            <div className="text-[9px] font-mono">+{cell.risks.length - 3} más</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PLANES DE MITIGACIÓN */}
      {tab === 'mitigacion' && (
        <div className="axy-surface rounded-2xl p-5 space-y-3">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#0066FF]" />
            <span>Riesgos Críticos y Altos y su Estrategia de Mitigación</span>
          </h3>
          {riesgos.filter((r) => r.residualLevel === 'CRITICO' || r.residualLevel === 'ALTO').length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">Sin riesgos críticos o altos pendientes de mitigación.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {riesgos
                .filter((r) => r.residualLevel === 'CRITICO' || r.residualLevel === 'ALTO')
                .map((r) => {
                  const linkedPlans = ws.data.planesAccion.filter((p) => !p.deletedAt && (p.originEntityId === r.id || r.linkedActionPlanIds.includes(p.id)));
                  return (
                    <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          <span className="font-mono text-[#0052CC] dark:text-[#00D1FF] mr-2">{r.code}</span>
                          {r.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Dueño: {r.ownerName} · Estrategia: {r.treatmentStrategy} · Planes de acción vinculados: <strong>{linkedPlans.length}</strong>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${LEVEL_BADGE[r.residualLevel]}`}>
                        Res {r.residualScore} · {r.residualLevel}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* RISK DOSSIER DRAWER */}
      {selectedRisk && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white dark:bg-[#0B1221] h-full overflow-y-auto p-6 shadow-2xl border-l border-slate-200 dark:border-white/10 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">{selectedRisk.code}</div>
                <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">{selectedRisk.name}</h3>
                <div className="text-xs text-slate-500">{REGULA_RISK_CATEGORY_LABELS[selectedRisk.category]} · {selectedRisk.processArea}</div>
              </div>
              <button type="button" onClick={() => setSelectedRisk(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl axy-surface-tonal">
                <div className="text-[10px] text-slate-500">Riesgo Inherente</div>
                <div className="font-mono text-lg font-bold">{selectedRisk.inherentScore} ({selectedRisk.inherentLevel})</div>
                <div className="text-[10px] text-slate-500">P{selectedRisk.inherentProbability} × I{selectedRisk.inherentImpact}</div>
              </div>
              <div className="p-3 rounded-xl axy-surface-tonal">
                <div className="text-[10px] text-slate-500">Riesgo Residual</div>
                <div className="font-mono text-lg font-bold">{selectedRisk.residualScore} ({selectedRisk.residualLevel})</div>
                <div className="text-[10px] text-slate-500">P{selectedRisk.residualProbability} × I{selectedRisk.residualImpact}</div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div><strong className="text-slate-900 dark:text-white">Descripción:</strong> <span className="text-slate-600 dark:text-slate-300">{selectedRisk.description}</span></div>
              <div><strong className="text-slate-900 dark:text-white">Causas:</strong> <span className="text-slate-600 dark:text-slate-300">{selectedRisk.causes || 'No especificadas'}</span></div>
              <div><strong className="text-slate-900 dark:text-white">Consecuencias:</strong> <span className="text-slate-600 dark:text-slate-300">{selectedRisk.consequences || 'No especificadas'}</span></div>
              <div><strong className="text-slate-900 dark:text-white">Dueño:</strong> <span className="text-slate-600 dark:text-slate-300">{selectedRisk.ownerName}</span></div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-900 dark:text-white">Controles Vinculados</div>
              {controles.filter((c) => c.linkedRiskIds.includes(selectedRisk.id) || selectedRisk.linkedControlIds.includes(c.id)).length === 0 ? (
                <div className="text-xs text-slate-500">Sin controles vinculados todavía.</div>
              ) : (
                controles
                  .filter((c) => c.linkedRiskIds.includes(selectedRisk.id) || selectedRisk.linkedControlIds.includes(c.id))
                  .map((c) => (
                    <div key={c.id} className="p-2.5 rounded-lg axy-surface-tonal text-xs flex justify-between">
                      <span>{c.code} · {c.name}</span>
                      <span className="font-mono font-bold">{c.effectiveness}</span>
                    </div>
                  ))
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-900 dark:text-white">Historial de Evaluaciones</div>
              {ws.data.evaluacionesRiesgo.filter((e) => e.riesgoId === selectedRisk.id).map((ev) => (
                <div key={ev.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs">
                  <div className="font-mono font-semibold">{ev.evaluationDate} · Inh {ev.inherentScore} → Res {ev.residualScore} ({ev.residualLevel})</div>
                  <div className="text-[11px] text-slate-500">{ev.rationale}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
