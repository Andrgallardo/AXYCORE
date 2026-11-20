import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  ListChecks,
  Plus,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  createRegulaEntity,
  recordRegulaApproval,
  updateRegulaEntity,
} from '../../services/regulaStore';
import type {
  RegulaAuditoriaRecord,
  RegulaControlAutomation,
  RegulaControlEffectiveness,
  RegulaControlNature,
  RegulaControlRecord,
  RegulaFrequency,
  RegulaHallazgoRecord,
  RegulaPlanAccionRecord,
  RegulaProgramaAuditoriaRecord,
  RegulaPruebaControlRecord,
  RegulaSeverity,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

export function RegulaControlAuditView({
  ws,
  mode,
}: {
  ws: RegulaWorkspaceState;
  mode: 'control_interno' | 'auditoria';
}) {
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Control Interno state
  const [ctrlTab, setCtrlTab] = useState<'matriz' | 'pruebas' | 'debilidades'>('matriz');
  const [showCtrlForm, setShowCtrlForm] = useState(false);
  const [ctrlForm, setCtrlForm] = useState({
    code: '',
    name: '',
    objective: '',
    description: '',
    nature: 'PREVENTIVO' as RegulaControlNature,
    automation: 'SEMIAUTOMATIZADO' as RegulaControlAutomation,
    frequency: 'MENSUAL' as RegulaFrequency,
    department: ws.effectiveConfig.departments[0] || 'Operaciones',
    ownerName: ws.userProfile?.displayName || '',
    expectedEvidence: '',
    linkedRiskId: '',
  });
  const [showTestForm, setShowTestForm] = useState(false);
  const [testForm, setTestForm] = useState({
    controlId: '',
    sampleSize: 20,
    exceptionsFound: 0,
    procedureSummary: '',
    result: 'EFECTIVO' as RegulaControlEffectiveness,
    observations: '',
  });

  // Auditoria state
  const [audTab, setAudTab] = useState<'plan' | 'programas' | 'hallazgos'>('plan');
  const [showAudForm, setShowAudForm] = useState(false);
  const [audForm, setAudForm] = useState({
    code: '',
    title: '',
    planYear: Number(ws.todayIso.slice(0, 4)) || 2026,
    auditType: ws.effectiveConfig.auditTypes[0] || 'Cumplimiento Regulatorio',
    scope: '',
    objectives: '',
    auditedArea: ws.effectiveConfig.departments[0] || 'Crédito y Originación',
    leadAuditorName: ws.userProfile?.displayName || 'Auditor Interno',
    startDate: ws.todayIso,
    endDate: ws.todayIso,
  });
  const [showProgForm, setShowProgForm] = useState(false);
  const [progForm, setProgForm] = useState({
    auditoriaId: '',
    stepCode: 'P-01',
    procedureTitle: '',
    checklistItem: '',
    assignedAuditorName: ws.userProfile?.displayName || 'Auditor Interno',
  });
  const [showHallForm, setShowHallForm] = useState(false);
  const [hallForm, setHallForm] = useState({
    auditoriaId: '',
    code: '',
    title: '',
    criterio: '',
    condicion: '',
    causa: '',
    efecto: '',
    severity: 'ALTA' as RegulaSeverity,
    auditedArea: ws.effectiveConfig.departments[0] || 'Operaciones',
    responsibleName: '',
    recommendation: '',
    dueDate: ws.todayIso,
  });

  const canCreateCtrl = ws.can('control_interno', 'crear');
  const canCreateAud = ws.can('auditoria', 'crear');
  const canEditAud = ws.can('auditoria', 'editar');
  const canApproveAud = ws.can('auditoria', 'aprobar');

  const controles = useMemo(() => ws.data.controles.filter((c) => !c.deletedAt), [ws.data.controles]);
  const pruebas = useMemo(() => ws.data.pruebasControl.filter((p) => !p.deletedAt), [ws.data.pruebasControl]);
  const auditorias = useMemo(() => ws.data.auditorias.filter((a) => !a.deletedAt), [ws.data.auditorias]);
  const programas = useMemo(() => ws.data.programasAuditoria.filter((p) => !p.deletedAt), [ws.data.programasAuditoria]);
  const hallazgos = useMemo(() => ws.data.hallazgos.filter((h) => !h.deletedAt), [ws.data.hallazgos]);

  // Handlers: Control Interno
  const handleCreateControl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreateCtrl) return;
    const code = ctrlForm.code.trim() || `CTR-${String(controles.length + 1).padStart(3, '0')}`;
    try {
      await createRegulaEntity<RegulaControlRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_controles',
        prefix: 'rgctr',
        entityCode: code,
        auditAction: 'CREACION_CONTROL_INTERNO',
        data: {
          code,
          name: ctrlForm.name.trim(),
          objective: ctrlForm.objective.trim(),
          description: ctrlForm.description.trim(),
          nature: ctrlForm.nature,
          automation: ctrlForm.automation,
          frequency: ctrlForm.frequency,
          department: ctrlForm.department,
          ownerName: ctrlForm.ownerName.trim() || ws.userProfile.displayName || 'Responsable',
          effectiveness: 'NO_EVALUADO',
          expectedEvidence: ctrlForm.expectedEvidence.trim(),
          linkedRiskIds: ctrlForm.linkedRiskId ? [ctrlForm.linkedRiskId] : [],
          linkedObligationIds: [],
          weaknessIdentified: false,
          linkedActionPlanIds: [],
          status: 'ACTIVO',
        },
      });
      setShowCtrlForm(false);
      setCtrlForm({ ...ctrlForm, code: '', name: '', objective: '', description: '', expectedEvidence: '' });
      setMsg({ type: 'ok', text: `Control ${code} registrado en la Matriz de Control Interno.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando control.' });
    }
  };

  const handleCreateControlTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreateCtrl) return;
    const ctrl = controles.find((c) => c.id === testForm.controlId);
    if (!ctrl) return;
    try {
      await createRegulaEntity<RegulaPruebaControlRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_pruebas_control',
        prefix: 'rgpct',
        entityCode: ctrl.code,
        auditAction: 'PRUEBA_EFECTIVIDAD_CONTROL',
        data: {
          controlId: ctrl.id,
          controlCode: ctrl.code,
          controlName: ctrl.name,
          testDate: ws.todayIso,
          testerName: ws.userProfile.displayName || 'Evaluador',
          sampleSize: Number(testForm.sampleSize) || 1,
          exceptionsFound: Number(testForm.exceptionsFound) || 0,
          procedureSummary: testForm.procedureSummary.trim(),
          result: testForm.result,
          observations: testForm.observations.trim(),
          linkedEvidenceIds: [],
        },
      });
      const isWeak = testForm.result === 'INEFECTIVO' || testForm.result === 'PARCIALMENTE_EFECTIVO';
      await updateRegulaEntity<RegulaControlRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_controles',
        id: ctrl.id,
        entityCode: ctrl.code,
        auditAction: 'ACTUALIZACION_EFECTIVIDAD_CONTROL',
        previousSummary: ctrl.effectiveness,
        newSummary: testForm.result,
        patch: {
          effectiveness: testForm.result,
          lastTestedDate: ws.todayIso,
          weaknessIdentified: isWeak,
          weaknessDescription: isWeak ? testForm.observations.trim() : undefined,
          status: isWeak ? 'DEBILIDAD_ABIERTA' : 'ACTIVO',
        },
      });
      setShowTestForm(false);
      setTestForm({ ...testForm, procedureSummary: '', observations: '' });
      setMsg({ type: 'ok', text: `Prueba de control registrada. Efectividad de ${ctrl.code}: ${testForm.result}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando prueba.' });
    }
  };

  const handleCreateCorrectivePlanFromWeakness = async (ctrl: RegulaControlRecord) => {
    if (!ws.userProfile) return;
    try {
      const code = `PA-${String(ws.data.planesAccion.length + 1).padStart(3, '0')}`;
      const due = new Date(`${ws.todayIso}T12:00:00Z`);
      due.setUTCDate(due.getUTCDate() + 30);
      const created = await createRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        prefix: 'rgpa',
        entityCode: code,
        auditAction: 'PLAN_CORRECTIVO_DESDE_DEBILIDAD_CONTROL',
        data: {
          code,
          title: `Remediar debilidad de control ${ctrl.code}: ${ctrl.name}`,
          description: ctrl.weaknessDescription || `Control evaluado como ${ctrl.effectiveness}.`,
          actionType: 'CORRECTIVA',
          originType: 'CONTROL',
          originEntityId: ctrl.id,
          originEntityCode: ctrl.code,
          department: ctrl.department,
          responsibleName: ctrl.ownerName,
          priority: ctrl.effectiveness === 'INEFECTIVO' ? 'ALTA' : 'MEDIA',
          startDate: ws.todayIso,
          dueDate: due.toISOString().slice(0, 10),
          progressPct: 0,
          status: 'PENDIENTE',
          effectivenessVerified: false,
          reopenCount: 0,
          linkedEvidenceIds: [],
          statusHistory: [
            {
              timestampIso: new Date().toISOString(),
              actorUid: ws.userProfile.uid,
              actorName: ws.userProfile.displayName || 'Usuario',
              fromStatus: 'NUEVO',
              toStatus: 'PENDIENTE',
              notes: `Generado desde debilidad del control ${ctrl.code}.`,
            },
          ],
        },
      });
      await updateRegulaEntity<RegulaControlRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_controles',
        id: ctrl.id,
        entityCode: ctrl.code,
        auditAction: 'VINCULO_PLAN_CORRECTIVO',
        patch: { linkedActionPlanIds: [...(ctrl.linkedActionPlanIds || []), created.id] },
      });
      setMsg({ type: 'ok', text: `Plan correctivo ${code} creado y vinculado al control ${ctrl.code}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando plan correctivo.' });
    }
  };

  // Handlers: Auditoría Interna
  const handleCreateAuditoria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreateAud) return;
    const code = audForm.code.trim() || `AUD-${audForm.planYear}-${String(auditorias.length + 1).padStart(2, '0')}`;
    try {
      await createRegulaEntity<RegulaAuditoriaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_auditorias',
        prefix: 'rgaud',
        entityCode: code,
        auditAction: 'CREACION_PLAN_AUDITORIA',
        data: {
          code,
          title: audForm.title.trim(),
          planYear: Number(audForm.planYear),
          auditType: audForm.auditType,
          scope: audForm.scope.trim(),
          objectives: audForm.objectives.trim(),
          auditedArea: audForm.auditedArea,
          leadAuditorName: audForm.leadAuditorName.trim(),
          startDate: audForm.startDate,
          endDate: audForm.endDate,
          status: 'PLANIFICADA',
          progressPct: 0,
        },
      });
      setShowAudForm(false);
      setAudForm({ ...audForm, code: '', title: '', scope: '', objectives: '' });
      setMsg({ type: 'ok', text: `Auditoría ${code} incorporada al Plan Anual.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando auditoría.' });
    }
  };

  const handleApproveAuditoria = async (aud: RegulaAuditoriaRecord) => {
    if (!ws.userProfile || !canApproveAud) return;
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaAuditoriaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_auditorias',
        id: aud.id,
        entityCode: aud.code,
        auditAction: 'APROBACION_PLAN_AUDITORIA',
        patch: {
          status: 'APROBADA',
          planApprovedBy: ws.userProfile.displayName || ws.userProfile.uid,
          planApprovedAt: nowIso,
        },
      });
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_auditorias',
        entityId: aud.id,
        entityCode: aud.code,
        approvalAction: 'APROBAR_PLAN_AUDITORIA',
        decision: 'APROBADO',
        justification: `Aprobación de plan de auditoría ${aud.code}`,
      });
      setMsg({ type: 'ok', text: `Auditoría ${aud.code} aprobada formalmente.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error aprobando auditoría.' });
    }
  };

  const handleCreatePrograma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreateAud) return;
    const aud = auditorias.find((a) => a.id === progForm.auditoriaId);
    if (!aud) return;
    try {
      await createRegulaEntity<RegulaProgramaAuditoriaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_programas_auditoria',
        prefix: 'rgprg',
        entityCode: `${aud.code}-${progForm.stepCode}`,
        auditAction: 'CREACION_PROCEDIMIENTO_AUDITORIA',
        data: {
          auditoriaId: aud.id,
          auditoriaCode: aud.code,
          stepCode: progForm.stepCode.trim(),
          procedureTitle: progForm.procedureTitle.trim(),
          checklistItem: progForm.checklistItem.trim(),
          assignedAuditorName: progForm.assignedAuditorName.trim(),
          status: 'PENDIENTE',
          linkedEvidenceIds: [],
        },
      });
      setShowProgForm(false);
      setProgForm({ ...progForm, procedureTitle: '', checklistItem: '' });
      setMsg({ type: 'ok', text: `Procedimiento agregado al programa de ${aud.code}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando procedimiento.' });
    }
  };

  const handleCreateHallazgo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreateAud) return;
    const aud = auditorias.find((a) => a.id === hallForm.auditoriaId);
    if (!aud) return;
    const code = hallForm.code.trim() || `HAL-${String(hallazgos.length + 1).padStart(3, '0')}`;
    try {
      await createRegulaEntity<RegulaHallazgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_hallazgos',
        prefix: 'rghal',
        entityCode: code,
        auditAction: 'REGISTRO_HALLAZGO_AUDITORIA',
        data: {
          code,
          auditoriaId: aud.id,
          auditoriaCode: aud.code,
          title: hallForm.title.trim(),
          criterio: hallForm.criterio.trim(),
          condicion: hallForm.condicion.trim(),
          causa: hallForm.causa.trim(),
          efecto: hallForm.efecto.trim(),
          severity: hallForm.severity,
          auditedArea: hallForm.auditedArea,
          responsibleName: hallForm.responsibleName.trim(),
          recommendation: hallForm.recommendation.trim(),
          dueDate: hallForm.dueDate,
          status: 'ABIERTO',
          linkedRiskIds: [],
          linkedControlIds: [],
          linkedActionPlanIds: [],
          linkedEvidenceIds: [],
          reopenCount: 0,
        },
      });
      setShowHallForm(false);
      setHallForm({ ...hallForm, code: '', title: '', criterio: '', condicion: '', causa: '', efecto: '', recommendation: '' });
      setMsg({ type: 'ok', text: `Hallazgo ${code} registrado con estructura Criterio/Condición/Causa/Efecto.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando hallazgo.' });
    }
  };

  const handleTransitionHallazgo = async (h: RegulaHallazgoRecord, nextStatus: RegulaHallazgoRecord['status']) => {
    if (!ws.userProfile || !canEditAud) return;
    if (nextStatus === 'CERRADO' && !canApproveAud) {
      setMsg({ type: 'err', text: 'Cerrar un hallazgo de auditoría requiere facultad de aprobación autorizada.' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaHallazgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_hallazgos',
        id: h.id,
        entityCode: h.code,
        auditAction: `HALLAZGO_${nextStatus}`,
        previousSummary: h.status,
        newSummary: nextStatus,
        patch: {
          status: nextStatus,
          closedBy: nextStatus === 'CERRADO' ? ws.userProfile.displayName || ws.userProfile.uid : h.closedBy,
          closedAt: nextStatus === 'CERRADO' ? nowIso : h.closedAt,
          reopenCount: nextStatus === 'REABIERTO' ? (h.reopenCount || 0) + 1 : h.reopenCount,
        },
      });
      if (nextStatus === 'CERRADO') {
        await recordRegulaApproval({
          user: ws.userProfile,
          organizationId: ws.orgId,
          config: ws.effectiveConfig,
          entityType: 'regula_hallazgos',
          entityId: h.id,
          entityCode: h.code,
          approvalAction: 'APROBAR_CIERRE_HALLAZGO',
          decision: 'APROBADO',
          justification: `Cierre verificado del hallazgo ${h.code}`,
        });
      }
      setMsg({ type: 'ok', text: `Hallazgo ${h.code} actualizado a ${nextStatus}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando hallazgo.' });
    }
  };

  // ============================================================================
  // MODE 1: CONTROL INTERNO
  // ============================================================================
  if (mode === 'control_interno') {
    const weaknesses = controles.filter((c) => c.weaknessIdentified || c.effectiveness === 'INEFECTIVO' || c.effectiveness === 'PARCIALMENTE_EFECTIVO');
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'matriz' as const, label: `Matriz de Controles (${controles.length})`, icon: ShieldCheck },
              { id: 'pruebas' as const, label: `Evaluación y Pruebas (${pruebas.length})`, icon: ClipboardCheck },
              { id: 'debilidades' as const, label: `Debilidades Identificadas (${weaknesses.length})`, icon: AlertTriangle },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => setCtrlTab(t.id)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${ctrlTab === t.id ? 'axy-brand-gradient text-white' : 'axy-surface text-slate-700 dark:text-slate-300'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          {canCreateCtrl && (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setCtrlTab('matriz'); setShowCtrlForm((v) => !v); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>Nuevo Control</span>
              </button>
              <button type="button" onClick={() => { setCtrlTab('pruebas'); setShowTestForm((v) => !v); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-btn-secondary text-xs cursor-pointer">
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>Registrar Prueba</span>
              </button>
            </div>
          )}
        </div>

        {msg && (
          <div className={`px-4 py-2.5 rounded-xl text-xs flex justify-between ${msg.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200' : 'bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200'}`}>
            <span>{msg.text}</span>
            <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">Cerrar</button>
          </div>
        )}

        {ctrlTab === 'matriz' && (
          <div className="space-y-4">
            {showCtrlForm && (
              <form onSubmit={handleCreateControl} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                <input placeholder="Código (CTR-001)" className="axy-input px-3 py-2 text-xs" value={ctrlForm.code} onChange={(e) => setCtrlForm({ ...ctrlForm, code: e.target.value })} />
                <input required placeholder="Nombre del control *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={ctrlForm.name} onChange={(e) => setCtrlForm({ ...ctrlForm, name: e.target.value })} />
                <select className="axy-input px-3 py-2 text-xs" value={ctrlForm.nature} onChange={(e) => setCtrlForm({ ...ctrlForm, nature: e.target.value as RegulaControlNature })}>
                  <option value="PREVENTIVO">Preventivo</option>
                  <option value="DETECTIVO">Detectivo</option>
                  <option value="CORRECTIVO">Correctivo</option>
                </select>
                <select className="axy-input px-3 py-2 text-xs" value={ctrlForm.automation} onChange={(e) => setCtrlForm({ ...ctrlForm, automation: e.target.value as RegulaControlAutomation })}>
                  <option value="MANUAL">Manual</option>
                  <option value="SEMIAUTOMATIZADO">Semiautomatizado</option>
                  <option value="AUTOMATIZADO">Automatizado</option>
                </select>
                <select className="axy-input px-3 py-2 text-xs" value={ctrlForm.frequency} onChange={(e) => setCtrlForm({ ...ctrlForm, frequency: e.target.value as RegulaFrequency })}>
                  {ws.effectiveConfig.frequencies.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select className="axy-input px-3 py-2 text-xs" value={ctrlForm.department} onChange={(e) => setCtrlForm({ ...ctrlForm, department: e.target.value })}>
                  {ws.effectiveConfig.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input required placeholder="Responsable del control *" className="axy-input px-3 py-2 text-xs" value={ctrlForm.ownerName} onChange={(e) => setCtrlForm({ ...ctrlForm, ownerName: e.target.value })} />
                <select className="axy-input px-3 py-2 text-xs" value={ctrlForm.linkedRiskId} onChange={(e) => setCtrlForm({ ...ctrlForm, linkedRiskId: e.target.value })}>
                  <option value="">Vincular a riesgo (opcional)</option>
                  {ws.data.riesgos.filter((r) => !r.deletedAt).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
                <input required placeholder="Objetivo del control *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={ctrlForm.objective} onChange={(e) => setCtrlForm({ ...ctrlForm, objective: e.target.value })} />
                <input required placeholder="Evidencia esperada *" className="axy-input px-3 py-2 text-xs" value={ctrlForm.expectedEvidence} onChange={(e) => setCtrlForm({ ...ctrlForm, expectedEvidence: e.target.value })} />
                <textarea required rows={2} placeholder="Descripción detallada del procedimiento de control *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={ctrlForm.description} onChange={(e) => setCtrlForm({ ...ctrlForm, description: e.target.value })} />
                <div className="md:col-span-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowCtrlForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                  <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Control</button>
                </div>
              </form>
            )}

            <div className="axy-surface rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Código / Control</th>
                    <th className="px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Frecuencia</th>
                    <th className="px-3 py-3">Área / Responsable</th>
                    <th className="px-3 py-3">Efectividad</th>
                    <th className="px-3 py-3">Última Prueba</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {controles.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No hay controles internos registrados.</td></tr>
                  ) : (
                    controles.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{c.code}</div>
                          <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                        </td>
                        <td className="px-3 py-3">{c.nature} · {c.automation}</td>
                        <td className="px-3 py-3">{c.frequency}</td>
                        <td className="px-3 py-3">{c.department} · {c.ownerName}</td>
                        <td className="px-3 py-3 font-bold">{c.effectiveness}</td>
                        <td className="px-3 py-3 font-mono">{c.lastTestedDate || 'Sin pruebas'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {ctrlTab === 'pruebas' && (
          <div className="space-y-4">
            {showTestForm && (
              <form onSubmit={handleCreateControlTest} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                <select required className="axy-input px-3 py-2 text-xs" value={testForm.controlId} onChange={(e) => setTestForm({ ...testForm, controlId: e.target.value })}>
                  <option value="">Selecciona control a probar...</option>
                  {controles.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
                <input type="number" min={1} placeholder="Tamaño de muestra" className="axy-input px-3 py-2 text-xs" value={testForm.sampleSize} onChange={(e) => setTestForm({ ...testForm, sampleSize: Number(e.target.value) })} />
                <input type="number" min={0} placeholder="Excepciones encontradas" className="axy-input px-3 py-2 text-xs" value={testForm.exceptionsFound} onChange={(e) => setTestForm({ ...testForm, exceptionsFound: Number(e.target.value) })} />
                <select className="axy-input px-3 py-2 text-xs" value={testForm.result} onChange={(e) => setTestForm({ ...testForm, result: e.target.value as RegulaControlEffectiveness })}>
                  <option value="EFECTIVO">Efectivo</option>
                  <option value="PARCIALMENTE_EFECTIVO">Parcialmente Efectivo</option>
                  <option value="INEFECTIVO">Inefectivo</option>
                </select>
                <input required placeholder="Procedimiento de prueba ejecutado *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={testForm.procedureSummary} onChange={(e) => setTestForm({ ...testForm, procedureSummary: e.target.value })} />
                <textarea required rows={2} placeholder="Observaciones y conclusión de efectividad *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={testForm.observations} onChange={(e) => setTestForm({ ...testForm, observations: e.target.value })} />
                <div className="md:col-span-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowTestForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                  <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Prueba</button>
                </div>
              </form>
            )}
            <div className="axy-surface rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Fecha / Control</th>
                    <th className="px-3 py-3">Muestra / Excep.</th>
                    <th className="px-3 py-3">Resultado</th>
                    <th className="px-3 py-3">Evaluador</th>
                    <th className="px-3 py-3">Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {pruebas.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No hay pruebas de control registradas.</td></tr>
                  ) : (
                    pruebas.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 font-semibold">{p.testDate} · {p.controlCode} ({p.controlName})</td>
                        <td className="px-3 py-3 font-mono">{p.sampleSize} / {p.exceptionsFound}</td>
                        <td className="px-3 py-3 font-bold">{p.result}</td>
                        <td className="px-3 py-3">{p.testerName}</td>
                        <td className="px-3 py-3">{p.observations}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {ctrlTab === 'debilidades' && (
          <div className="axy-surface rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Debilidades de Control Interno y Remediación
            </h3>
            {weaknesses.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">No se registran debilidades abiertas de control interno.</div>
            ) : (
              weaknesses.map((w) => (
                <div key={w.id} className="p-4 rounded-xl axy-surface-tonal flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-rose-700 dark:text-rose-300">{w.code} · {w.name} ({w.effectiveness})</div>
                    <div className="text-slate-600 dark:text-slate-300">{w.weaknessDescription || 'Evaluado con debilidad operativa.'}</div>
                    <div className="text-[11px] text-slate-500">Planes correctivos vinculados: {w.linkedActionPlanIds.length}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCreateCorrectivePlanFromWeakness(w)}
                    className="px-3 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer"
                  >
                    Crear Plan Correctivo
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // MODE 2: AUDITORÍA INTERNA
  // ============================================================================
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'plan' as const, label: `Plan Anual (${auditorias.length})`, icon: FileSearch },
            { id: 'programas' as const, label: `Programas y Checklists (${programas.length})`, icon: ListChecks },
            { id: 'hallazgos' as const, label: `Hallazgos y Seguimiento (${hallazgos.length})`, icon: AlertTriangle },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => setAudTab(t.id)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${audTab === t.id ? 'axy-brand-gradient text-white' : 'axy-surface text-slate-700 dark:text-slate-300'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
        {canCreateAud && (
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAudTab('plan'); setShowAudForm((v) => !v); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>Nueva Auditoría</span>
            </button>
            <button type="button" onClick={() => { setAudTab('hallazgos'); setShowHallForm((v) => !v); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-btn-secondary text-xs cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>Registrar Hallazgo</span>
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div className={`px-4 py-2.5 rounded-xl text-xs flex justify-between ${msg.type === 'ok' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200' : 'bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">Cerrar</button>
        </div>
      )}

      {audTab === 'plan' && (
        <div className="space-y-4">
          {showAudForm && (
            <form onSubmit={handleCreateAuditoria} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <input placeholder="Código (AUD-2026-01)" className="axy-input px-3 py-2 text-xs" value={audForm.code} onChange={(e) => setAudForm({ ...audForm, code: e.target.value })} />
              <input required placeholder="Título de la auditoría *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={audForm.title} onChange={(e) => setAudForm({ ...audForm, title: e.target.value })} />
              <input type="number" className="axy-input px-3 py-2 text-xs" value={audForm.planYear} onChange={(e) => setAudForm({ ...audForm, planYear: Number(e.target.value) })} />
              <select className="axy-input px-3 py-2 text-xs" value={audForm.auditType} onChange={(e) => setAudForm({ ...audForm, auditType: e.target.value })}>
                {ws.effectiveConfig.auditTypes.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="axy-input px-3 py-2 text-xs" value={audForm.auditedArea} onChange={(e) => setAudForm({ ...audForm, auditedArea: e.target.value })}>
                {ws.effectiveConfig.departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input required placeholder="Auditor Líder *" className="axy-input px-3 py-2 text-xs" value={audForm.leadAuditorName} onChange={(e) => setAudForm({ ...audForm, leadAuditorName: e.target.value })} />
              <input type="date" className="axy-input px-3 py-2 text-xs" value={audForm.startDate} onChange={(e) => setAudForm({ ...audForm, startDate: e.target.value })} />
              <input type="date" className="axy-input px-3 py-2 text-xs" value={audForm.endDate} onChange={(e) => setAudForm({ ...audForm, endDate: e.target.value })} />
              <input required placeholder="Alcance de auditoría *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={audForm.scope} onChange={(e) => setAudForm({ ...audForm, scope: e.target.value })} />
              <input required placeholder="Objetivos de revisión *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={audForm.objectives} onChange={(e) => setAudForm({ ...audForm, objectives: e.target.value })} />
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAudForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Auditoría</button>
              </div>
            </form>
          )}
          <div className="axy-surface rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Código / Auditoría</th>
                  <th className="px-3 py-3">Área Auditada</th>
                  <th className="px-3 py-3">Fechas</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Gobierno</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {auditorias.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Plan anual sin auditorías registradas.</td></tr>
                ) : (
                  auditorias.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{a.code} ({a.planYear})</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{a.title}</div>
                      </td>
                      <td className="px-3 py-3">{a.auditedArea} · {a.leadAuditorName}</td>
                      <td className="px-3 py-3 font-mono">{a.startDate} → {a.endDate}</td>
                      <td className="px-3 py-3 font-semibold">{a.status}</td>
                      <td className="px-4 py-3 text-right">
                        {canApproveAud && a.status === 'PLANIFICADA' && (
                          <button type="button" onClick={() => handleApproveAuditoria(a)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Aprobar Plan</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {audTab === 'programas' && (
        <div className="space-y-4">
          {canCreateAud && (
            <button type="button" onClick={() => setShowProgForm((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar Procedimiento / Checklist</span>
            </button>
          )}
          {showProgForm && (
            <form onSubmit={handleCreatePrograma} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <select required className="axy-input px-3 py-2 text-xs" value={progForm.auditoriaId} onChange={(e) => setProgForm({ ...progForm, auditoriaId: e.target.value })}>
                <option value="">Selecciona auditoría...</option>
                {auditorias.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.title}</option>)}
              </select>
              <input required placeholder="Paso (P-01)" className="axy-input px-3 py-2 text-xs" value={progForm.stepCode} onChange={(e) => setProgForm({ ...progForm, stepCode: e.target.value })} />
              <input required placeholder="Auditor asignado" className="axy-input px-3 py-2 text-xs" value={progForm.assignedAuditorName} onChange={(e) => setProgForm({ ...progForm, assignedAuditorName: e.target.value })} />
              <input required placeholder="Título del procedimiento *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={progForm.procedureTitle} onChange={(e) => setProgForm({ ...progForm, procedureTitle: e.target.value })} />
              <textarea required rows={2} placeholder="Ítem de verificación / checklist *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={progForm.checklistItem} onChange={(e) => setProgForm({ ...progForm, checklistItem: e.target.value })} />
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowProgForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Procedimiento</button>
              </div>
            </form>
          )}
          <div className="axy-surface rounded-2xl p-4 divide-y divide-slate-100 dark:divide-white/[0.06]">
            {programas.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">Sin procedimientos en programas de auditoría.</div>
            ) : (
              programas.map((p) => (
                <div key={p.id} className="py-3 flex flex-wrap justify-between gap-2 text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{p.auditoriaCode} · {p.stepCode} — {p.procedureTitle}</div>
                    <div className="text-slate-600 dark:text-slate-300">{p.checklistItem}</div>
                  </div>
                  <span className="font-mono font-semibold">{p.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {audTab === 'hallazgos' && (
        <div className="space-y-4">
          {showHallForm && (
            <form onSubmit={handleCreateHallazgo} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <select required className="axy-input px-3 py-2 text-xs" value={hallForm.auditoriaId} onChange={(e) => setHallForm({ ...hallForm, auditoriaId: e.target.value })}>
                <option value="">Selecciona auditoría...</option>
                {auditorias.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.title}</option>)}
              </select>
              <input placeholder="Código (HAL-001)" className="axy-input px-3 py-2 text-xs" value={hallForm.code} onChange={(e) => setHallForm({ ...hallForm, code: e.target.value })} />
              <select className="axy-input px-3 py-2 text-xs" value={hallForm.severity} onChange={(e) => setHallForm({ ...hallForm, severity: e.target.value as RegulaSeverity })}>
                <option value="BAJA">Baja</option>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Alta</option>
                <option value="CRITICA">Crítica</option>
              </select>
              <input required placeholder="Título del hallazgo *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={hallForm.title} onChange={(e) => setHallForm({ ...hallForm, title: e.target.value })} />
              <input required type="date" className="axy-input px-3 py-2 text-xs" value={hallForm.dueDate} onChange={(e) => setHallForm({ ...hallForm, dueDate: e.target.value })} />
              <textarea required rows={2} placeholder="Criterio (norma/política exigida) *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={hallForm.criterio} onChange={(e) => setHallForm({ ...hallForm, criterio: e.target.value })} />
              <textarea required rows={2} placeholder="Condición (situación real encontrada) *" className="axy-input md:col-span-3 px-3 py-2 text-xs" value={hallForm.condicion} onChange={(e) => setHallForm({ ...hallForm, condicion: e.target.value })} />
              <input required placeholder="Causa raíz *" className="axy-input md:col-span-1 px-3 py-2 text-xs" value={hallForm.causa} onChange={(e) => setHallForm({ ...hallForm, causa: e.target.value })} />
              <input required placeholder="Efecto / exposición *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={hallForm.efecto} onChange={(e) => setHallForm({ ...hallForm, efecto: e.target.value })} />
              <input required placeholder="Responsable del área *" className="axy-input px-3 py-2 text-xs" value={hallForm.responsibleName} onChange={(e) => setHallForm({ ...hallForm, responsibleName: e.target.value })} />
              <input required placeholder="Recomendación formal *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={hallForm.recommendation} onChange={(e) => setHallForm({ ...hallForm, recommendation: e.target.value })} />
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowHallForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Registrar Hallazgo</button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {hallazgos.length === 0 ? (
              <div className="axy-surface rounded-2xl py-8 text-center text-xs text-slate-500">No hay hallazgos de auditoría registrados.</div>
            ) : (
              hallazgos.map((h) => (
                <div key={h.id} className="axy-surface rounded-2xl p-4 space-y-2 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF] mr-2">{h.code} ({h.auditoriaCode})</span>
                      <span className="font-bold text-slate-950 dark:text-white">{h.title}</span>
                      <span className="ml-2 px-2 py-0.5 rounded bg-rose-500/12 text-rose-700 dark:text-rose-300 font-bold text-[10px]">{h.severity}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold">{h.status}</span>
                      {canEditAud && h.status !== 'CERRADO' && (
                        <button type="button" onClick={() => handleTransitionHallazgo(h, 'CERRADO')} className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer">
                          Aprobar Cierre
                        </button>
                      )}
                      {canEditAud && h.status === 'CERRADO' && (
                        <button type="button" onClick={() => handleTransitionHallazgo(h, 'REABIERTO')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 text-white text-[11px] font-semibold cursor-pointer">
                          <RotateCcw className="w-3 h-3" />
                          <span>Reabrir</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    <div><strong>Criterio:</strong> {h.criterio}</div>
                    <div><strong>Condición:</strong> {h.condicion}</div>
                    <div><strong>Causa:</strong> {h.causa}</div>
                    <div><strong>Efecto:</strong> {h.efecto}</div>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <strong>Recomendación:</strong> {h.recommendation} · Responsable: {h.responsibleName} · Vence: {h.dueDate} · Reaperturas: {h.reopenCount}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
