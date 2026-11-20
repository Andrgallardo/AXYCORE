import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Filter,
  GitBranch,
  Layers,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  computeNextDueDateByFrequency,
  daysBetweenIso,
  validateNonApplicableObligation,
} from '../../engine/regulaEngine';
import {
  createRegulaEntity,
  recordRegulaApproval,
  softDeleteRegulaEntity,
  updateRegulaEntity,
} from '../../services/regulaStore';
import type {
  RegulaAplicabilidadRecord,
  RegulaFrequency,
  RegulaNormativaRecord,
  RegulaNormativaVersionRecord,
  RegulaObligacionRecord,
  RegulaObligationStatus,
  RegulaSectionId,
  RegulaSeverity,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

type ComplianceTab = 'radar' | 'biblioteca' | 'obligaciones' | 'calendario' | 'aplicabilidad';

const STATUS_BADGE: Record<RegulaObligationStatus, string> = {
  CUMPLIDA: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25',
  EN_PROGRESO: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border border-sky-500/25',
  PENDIENTE: 'bg-slate-500/12 text-slate-700 dark:text-slate-300 border border-slate-400/25',
  PARCIAL: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/25',
  EN_REVISION: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25',
  VENCIDA: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border border-rose-500/25',
  NO_APLICABLE: 'bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border border-zinc-400/25',
};

export function RegulaComplianceView({
  ws,
  onNavigate,
}: {
  ws: RegulaWorkspaceState;
  onNavigate: (section: RegulaSectionId) => void;
}) {
  const [tab, setTab] = useState<ComplianceTab>('obligaciones');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [integrationInfo, setIntegrationInfo] = useState<{
    regulatoryFeeds?: { configured: boolean; note: string };
  } | null>(null);

  const canCreate = ws.can('cumplimiento', 'crear');
  const canEdit = ws.can('cumplimiento', 'editar');
  const canApprove = ws.can('cumplimiento', 'aprobar');
  const canDelete = ws.can('cumplimiento', 'eliminar_anular');

  useEffect(() => {
    fetch('/api/regula/integrations-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.integrations) setIntegrationInfo(json.integrations);
      })
      .catch(() => {});
  }, []);

  // Normativa form state
  const [showNormForm, setShowNormForm] = useState(false);
  const [normForm, setNormForm] = useState({
    code: '',
    title: '',
    regulator: 'SIB',
    category: ws.effectiveConfig.regulatoryCategories[0] || 'Regulación Financiera y Crediticia',
    normativeType: 'CIRCULAR' as RegulaNormativaRecord['normativeType'],
    issueDate: ws.todayIso,
    effectiveDate: ws.todayIso,
    status: 'VIGENTE' as RegulaNormativaRecord['status'],
    version: 'v1.0',
    summary: '',
    sourceUrl: '',
    affectedAreas: ws.effectiveConfig.departments.slice(0, 2).join(', '),
  });

  // Normativa version update modal
  const [versionTarget, setVersionTarget] = useState<RegulaNormativaRecord | null>(null);
  const [versionForm, setVersionForm] = useState({
    version: '',
    newStatus: 'MODIFICADA' as RegulaNormativaRecord['status'],
    changeSummary: '',
    impactNotes: '',
  });

  // Obligation form state
  const [showOblForm, setShowOblForm] = useState(false);
  const [oblFilter, setOblFilter] = useState({ status: 'ALL', department: 'ALL', criticality: 'ALL', search: '' });
  const [oblForm, setOblForm] = useState({
    code: '',
    title: '',
    description: '',
    normativaId: '',
    regulator: 'SIB',
    category: ws.effectiveConfig.regulatoryCategories[0] || 'Regulación Financiera y Crediticia',
    obligationType: ws.effectiveConfig.obligationTypes[0] || 'Reporte Regulatorio Periódico',
    frequency: 'MENSUAL' as RegulaFrequency,
    dueDate: ws.todayIso,
    department: ws.effectiveConfig.departments[0] || 'Cumplimiento',
    branch: ws.effectiveConfig.branches[0] || 'Oficina Principal',
    responsibleName: ws.userProfile?.displayName || '',
    criticality: 'ALTA' as RegulaSeverity,
    requiredEvidenceDesc: '',
  });

  // Non-applicable modal
  const [naTarget, setNaTarget] = useState<RegulaObligacionRecord | null>(null);
  const [naJustification, setNaJustification] = useState('');

  // Calendar mode
  const [calView, setCalView] = useState<'MENSUAL' | 'SEMANAL' | 'ANUAL'>('MENSUAL');
  const [calMonth, setCalMonth] = useState(ws.todayIso.slice(0, 7));

  // Applicability form
  const [showAppForm, setShowAppForm] = useState(false);
  const [appForm, setAppForm] = useState({
    normativaId: '',
    entityType: ws.effectiveConfig.entityType,
    economicActivity: ws.effectiveConfig.economicActivity,
    applicableProducts: 'Préstamos personales, Préstamos empresariales',
    jurisdiction: ws.effectiveConfig.jurisdiction,
    supervisor: ws.effectiveConfig.primarySupervisor,
    decision: 'APLICABLE' as RegulaAplicabilidadRecord['decision'],
    justification: '',
    nextReviewDate: ws.todayIso,
  });

  const normativas = useMemo(() => ws.data.normativas.filter((n) => !n.deletedAt), [ws.data.normativas]);
  const obligaciones = useMemo(() => ws.data.obligaciones.filter((o) => !o.deletedAt), [ws.data.obligaciones]);
  const aplicabilidad = useMemo(() => ws.data.aplicabilidad.filter((a) => !a.deletedAt), [ws.data.aplicabilidad]);

  const filteredObligaciones = useMemo(() => {
    return obligaciones
      .filter((o) => {
        if (oblFilter.status !== 'ALL' && o.status !== oblFilter.status) return false;
        if (oblFilter.department !== 'ALL' && o.department !== oblFilter.department) return false;
        if (oblFilter.criticality !== 'ALL' && o.criticality !== oblFilter.criticality) return false;
        if (oblFilter.search.trim()) {
          const q = oblFilter.search.toLowerCase();
          if (
            !o.title.toLowerCase().includes(q) &&
            !o.code.toLowerCase().includes(q) &&
            !o.regulator.toLowerCase().includes(q) &&
            !o.responsibleName.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  }, [obligaciones, oblFilter]);

  const calendarItems = useMemo(() => {
    const items = [
      ...obligaciones
        .filter((o) => o.status !== 'NO_APLICABLE' && o.dueDate)
        .map((o) => ({
          id: o.id,
          code: o.code,
          title: o.title,
          type: 'OBLIGACION',
          dueDate: o.dueDate,
          department: o.department,
          responsible: o.responsibleName,
          criticality: o.criticality,
          status: o.status,
        })),
      ...ws.data.planesAccion
        .filter((p) => !p.deletedAt && p.dueDate)
        .map((p) => ({
          id: p.id,
          code: p.code,
          title: p.title,
          type: 'PLAN_ACCION',
          dueDate: p.dueDate,
          department: p.department,
          responsible: p.responsibleName,
          criticality: p.priority,
          status: p.status,
        })),
      ...ws.data.auditorias
        .filter((a) => !a.deletedAt && a.endDate)
        .map((a) => ({
          id: a.id,
          code: a.code,
          title: a.title,
          type: 'AUDITORIA',
          dueDate: a.endDate,
          department: a.auditedArea,
          responsible: a.leadAuditorName,
          criticality: 'MEDIA' as RegulaSeverity,
          status: a.status,
        })),
    ];

    return items
      .filter((item) => {
        if (calView === 'MENSUAL') return item.dueDate.startsWith(calMonth);
        if (calView === 'ANUAL') return item.dueDate.startsWith(calMonth.slice(0, 4));
        const diff = daysBetweenIso(ws.todayIso, item.dueDate);
        return diff >= -3 && diff <= 14;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [obligaciones, ws.data.planesAccion, ws.data.auditorias, calView, calMonth, ws.todayIso]);

  const handleCreateNormativa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    setStatusMsg(null);
    try {
      const code = normForm.code.trim() || `NORM-${String(normativas.length + 1).padStart(3, '0')}`;
      await createRegulaEntity<RegulaNormativaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_normativas',
        prefix: 'rgnorm',
        entityCode: code,
        auditAction: 'CREACION_NORMATIVA',
        data: {
          code,
          title: normForm.title.trim(),
          regulator: normForm.regulator.trim(),
          category: normForm.category,
          normativeType: normForm.normativeType,
          issueDate: normForm.issueDate,
          effectiveDate: normForm.effectiveDate,
          status: normForm.status,
          jurisdiction: ws.effectiveConfig.jurisdiction,
          version: normForm.version.trim() || 'v1.0',
          summary: normForm.summary.trim(),
          sourceUrl: normForm.sourceUrl.trim() || undefined,
          affectedAreas: normForm.affectedAreas
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          applicabilityStatus: 'PENDIENTE_EVALUACION',
          radarOrigin: 'REGISTRO_MANUAL',
        },
      });
      setShowNormForm(false);
      setNormForm({ ...normForm, code: '', title: '', summary: '', sourceUrl: '' });
      setStatusMsg({ type: 'ok', text: `Normativa ${code} registrada en la Biblioteca Normativa.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando normativa.' });
    }
  };

  const handleRegisterNormVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !versionTarget || !canEdit) return;
    setStatusMsg(null);
    try {
      await createRegulaEntity<RegulaNormativaVersionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_normativa_versiones',
        prefix: 'rgnver',
        entityCode: versionTarget.code,
        auditAction: 'NUEVA_VERSION_NORMATIVA',
        data: {
          normativaId: versionTarget.id,
          normativaCode: versionTarget.code,
          version: versionForm.version.trim() || 'v2.0',
          changeDate: ws.todayIso,
          changeSummary: versionForm.changeSummary.trim(),
          previousStatus: versionTarget.status,
          newStatus: versionForm.newStatus,
          impactNotes: versionForm.impactNotes.trim() || undefined,
        },
      });
      await updateRegulaEntity<RegulaNormativaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_normativas',
        id: versionTarget.id,
        entityCode: versionTarget.code,
        auditAction: 'ACTUALIZACION_VERSION_NORMATIVA',
        previousSummary: `${versionTarget.version} (${versionTarget.status})`,
        newSummary: `${versionForm.version} (${versionForm.newStatus})`,
        patch: {
          version: versionForm.version.trim() || versionTarget.version,
          status: versionForm.newStatus,
        },
      });
      setVersionTarget(null);
      setVersionForm({ version: '', newStatus: 'MODIFICADA', changeSummary: '', impactNotes: '' });
      setStatusMsg({ type: 'ok', text: `Versión actualizada y trazabilidad registrada para ${versionTarget.code}.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando versión.' });
    }
  };

  const handleCreateObligation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    setStatusMsg(null);
    try {
      const code = oblForm.code.trim() || `OBL-${String(obligaciones.length + 1).padStart(3, '0')}`;
      const linkedNorm = normativas.find((n) => n.id === oblForm.normativaId);
      const nextDueDate = computeNextDueDateByFrequency(oblForm.dueDate, oblForm.frequency);
      await createRegulaEntity<RegulaObligacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_obligaciones',
        prefix: 'rgobl',
        entityCode: code,
        auditAction: 'CREACION_OBLIGACION',
        data: {
          code,
          title: oblForm.title.trim(),
          description: oblForm.description.trim(),
          normativaId: linkedNorm?.id,
          normativaCode: linkedNorm?.code,
          regulator: linkedNorm?.regulator || oblForm.regulator,
          category: oblForm.category,
          obligationType: oblForm.obligationType,
          frequency: oblForm.frequency,
          dueDate: oblForm.dueDate,
          nextDueDate,
          department: oblForm.department,
          branch: oblForm.branch,
          responsibleName: oblForm.responsibleName.trim() || ws.userProfile.displayName || 'Sin asignar',
          criticality: oblForm.criticality,
          status: 'PENDIENTE',
          compliancePct: 0,
          requiredEvidenceDesc: oblForm.requiredEvidenceDesc.trim() || undefined,
          linkedEvidenceIds: [],
          linkedControlIds: [],
          originSource: 'MANUAL',
        },
      });
      setShowOblForm(false);
      setOblForm({ ...oblForm, code: '', title: '', description: '', requiredEvidenceDesc: '' });
      setStatusMsg({ type: 'ok', text: `Obligación ${code} creada correctamente.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando obligación.' });
    }
  };

  const handleObligationStatusChange = async (obl: RegulaObligacionRecord, nextStatus: RegulaObligationStatus) => {
    if (!ws.userProfile || !canEdit) return;
    if (nextStatus === 'NO_APLICABLE') {
      setNaTarget(obl);
      setNaJustification(obl.nonApplicableJustification || '');
      return;
    }
    setStatusMsg(null);
    try {
      const compliancePct =
        nextStatus === 'CUMPLIDA' ? 100 : nextStatus === 'PARCIAL' ? 50 : nextStatus === 'EN_PROGRESO' ? 35 : nextStatus === 'EN_REVISION' ? 85 : 0;
      const nextDueDate =
        nextStatus === 'CUMPLIDA' ? computeNextDueDateByFrequency(obl.dueDate, obl.frequency) : obl.nextDueDate;
      await updateRegulaEntity<RegulaObligacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_obligaciones',
        id: obl.id,
        entityCode: obl.code,
        auditAction: 'CAMBIO_ESTADO_OBLIGACION',
        previousSummary: `${obl.status} (${obl.compliancePct}%)`,
        newSummary: `${nextStatus} (${compliancePct}%)`,
        patch: {
          status: nextStatus,
          compliancePct,
          nextDueDate,
          lastReviewedAt: new Date().toISOString(),
        },
      });
      setStatusMsg({ type: 'ok', text: `Obligación ${obl.code} actualizada a ${nextStatus}.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando obligación.' });
    }
  };

  const handleConfirmNonApplicable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !naTarget) return;
    const check = validateNonApplicableObligation({
      justification: naJustification,
      canApprove: canApprove,
    });
    if (!check.allowed) {
      setStatusMsg({ type: 'err', text: check.reason || 'Validación rechazada.' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaObligacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_obligaciones',
        id: naTarget.id,
        entityCode: naTarget.code,
        auditAction: 'OBLIGACION_NO_APLICABLE_APROBADA',
        previousSummary: naTarget.status,
        newSummary: `NO_APLICABLE: ${naJustification.trim()}`,
        patch: {
          status: 'NO_APLICABLE',
          nonApplicableJustification: naJustification.trim(),
          nonApplicableApprovedBy: ws.userProfile.displayName || ws.userProfile.uid,
          nonApplicableApprovedAt: nowIso,
          lastReviewedAt: nowIso,
        },
      });
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_obligaciones',
        entityId: naTarget.id,
        entityCode: naTarget.code,
        approvalAction: 'APROBAR_NO_APLICABLE',
        decision: 'APROBADO',
        justification: naJustification.trim(),
      });
      setNaTarget(null);
      setNaJustification('');
      setStatusMsg({ type: 'ok', text: `Obligación ${naTarget.code} marcada como NO_APLICABLE con aprobación registrada.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error aprobando No Aplicable.' });
    }
  };

  const handleCreateApplicability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    const norm = normativas.find((n) => n.id === appForm.normativaId);
    if (!norm) {
      setStatusMsg({ type: 'err', text: 'Selecciona una normativa de la Biblioteca Normativa.' });
      return;
    }
    try {
      await createRegulaEntity<RegulaAplicabilidadRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_aplicabilidad',
        prefix: 'rgapp',
        entityCode: norm.code,
        auditAction: 'EVALUACION_APLICABILIDAD',
        data: {
          normativaId: norm.id,
          normativaCode: norm.code,
          normativaTitle: norm.title,
          entityType: appForm.entityType,
          economicActivity: appForm.economicActivity,
          applicableProducts: appForm.applicableProducts
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          jurisdiction: appForm.jurisdiction,
          supervisor: appForm.supervisor,
          decision: appForm.decision,
          justification: appForm.justification.trim(),
          approvalStatus: 'PENDIENTE_APROBACION',
          nextReviewDate: appForm.nextReviewDate,
        },
      });
      setShowAppForm(false);
      setAppForm({ ...appForm, justification: '' });
      setStatusMsg({ type: 'ok', text: `Matriz de aplicabilidad registrada para ${norm.code} (pendiente aprobación).` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando evaluación de aplicabilidad.' });
    }
  };

  const handleApproveApplicability = async (rec: RegulaAplicabilidadRecord, decision: 'APROBADO' | 'RECHAZADO') => {
    if (!ws.userProfile || !canApprove) return;
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaAplicabilidadRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_aplicabilidad',
        id: rec.id,
        entityCode: rec.normativaCode,
        auditAction: `APLICABILIDAD_${decision}`,
        patch: {
          approvalStatus: decision === 'APROBADO' ? 'APROBADA' : 'RECHAZADA',
          approvedBy: ws.userProfile.uid,
          approvedByName: ws.userProfile.displayName || ws.userProfile.email || 'Aprobador',
          approvedAt: nowIso,
        },
      });
      if (decision === 'APROBADO') {
        await updateRegulaEntity<RegulaNormativaRecord>({
          user: ws.userProfile,
          organizationId: ws.orgId,
          config: ws.effectiveConfig,
          collectionName: 'regula_normativas',
          id: rec.normativaId,
          entityCode: rec.normativaCode,
          auditAction: 'APLICABILIDAD_ACTUALIZADA',
          patch: { applicabilityStatus: rec.decision },
        });
      }
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_aplicabilidad',
        entityId: rec.id,
        entityCode: rec.normativaCode,
        approvalAction: 'APROBAR_APLICABILIDAD',
        decision,
        justification: rec.justification,
      });
      setStatusMsg({ type: 'ok', text: `Aplicabilidad de ${rec.normativaCode} marcada como ${decision}.` });
    } catch (err) {
      setStatusMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando decisión.' });
    }
  };

  const tabs: Array<{ id: ComplianceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'radar', label: 'Radar Regulatorio', icon: Radio },
    { id: 'biblioteca', label: `Biblioteca Normativa (${normativas.length})`, icon: BookOpen },
    { id: 'obligaciones', label: `Obligaciones (${obligaciones.length})`, icon: ClipboardList },
    { id: 'calendario', label: 'Calendario de Cumplimiento', icon: Calendar },
    { id: 'aplicabilidad', label: `Matriz de Aplicabilidad (${aplicabilidad.length})`, icon: Layers },
  ];

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'axy-brand-gradient text-white shadow-sm'
                    : 'axy-surface text-slate-700 dark:text-slate-300 hover:border-[#0066FF]/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onNavigate('regula_ai')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl axy-btn-secondary text-xs cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
          <span>Extraer Obligaciones con REGULA AI</span>
        </button>
      </div>

      {statusMsg && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs flex items-center justify-between gap-2 ${
            statusMsg.type === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button type="button" onClick={() => setStatusMsg(null)} className="underline cursor-pointer">
            Cerrar
          </button>
        </div>
      )}

      {/* TAB 1: RADAR REGULATORIO */}
      {tab === 'radar' && (
        <div className="space-y-4">
          <div className="axy-surface-tonal rounded-2xl p-5 border border-amber-500/25 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300">
              <AlertCircle className="w-4 h-4" />
              <span>Estado Real de Integración con Fuentes Regulatorias Externas</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {integrationInfo?.regulatoryFeeds?.note || ws.effectiveConfig.externalIntegrations.regulatoryFeedsNote}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTab('biblioteca');
                  setShowNormForm(true);
                }}
                className="px-3 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer"
              >
                Registrar Novedad Normativa Manualmente
              </button>
              <button
                type="button"
                onClick={() => onNavigate('regula_ai')}
                className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer"
              >
                Analizar Texto de Circular / Ley con REGULA AI
              </button>
            </div>
          </div>

          <div className="axy-surface rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Novedades y Normativas Monitoreadas ({normativas.length})
            </h3>
            {normativas.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No hay normativas registradas en el radar todavía. Registra una normativa vigente, en consulta o modificada.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {normativas.map((n) => (
                  <div key={n.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">{n.code}</span>
                        <span className="text-xs font-semibold text-slate-950 dark:text-white">{n.title}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-white/10">
                          {n.regulator} · {n.version}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/12 text-sky-700 dark:text-sky-300">
                          {n.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{n.summary}</p>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Vigencia: {n.effectiveDate} · Aplicabilidad: <strong>{n.applicabilityStatus}</strong> · Áreas:{' '}
                        {n.affectedAreas.join(', ') || 'No definidas'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: BIBLIOTECA NORMATIVA */}
      {tab === 'biblioteca' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Biblioteca Normativa Institucional y Control de Versiones
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Leyes, reglamentos, circulares, instructivos y políticas con historial de cambios.
              </p>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowNormForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva Normativa</span>
              </button>
            )}
          </div>

          {showNormForm && (
            <form onSubmit={handleCreateNormativa} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Código</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Ej. LEY-155-17 / CIRC-SIB-001"
                  value={normForm.code}
                  onChange={(e) => setNormForm({ ...normForm, code: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Título de la Normativa *</label>
                <input
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Nombre oficial de la ley, circular o instructivo"
                  value={normForm.title}
                  onChange={(e) => setNormForm({ ...normForm, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Regulador / Emisor *</label>
                <input
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.regulator}
                  onChange={(e) => setNormForm({ ...normForm, regulator: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Tipo Normativo</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.normativeType}
                  onChange={(e) => setNormForm({ ...normForm, normativeType: e.target.value as RegulaNormativaRecord['normativeType'] })}
                >
                  <option value="LEY">Ley</option>
                  <option value="REGLAMENTO">Reglamento</option>
                  <option value="CIRCULAR">Circular</option>
                  <option value="INSTRUCTIVO">Instructivo</option>
                  <option value="RESOLUCION">Resolución</option>
                  <option value="POLITICA_INTERNA">Política Interna</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Categoría</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.category}
                  onChange={(e) => setNormForm({ ...normForm, category: e.target.value })}
                >
                  {ws.effectiveConfig.regulatoryCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Fecha Emisión</label>
                <input
                  type="date"
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.issueDate}
                  onChange={(e) => setNormForm({ ...normForm, issueDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Fecha Vigencia</label>
                <input
                  type="date"
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.effectiveDate}
                  onChange={(e) => setNormForm({ ...normForm, effectiveDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Versión / Estado</label>
                <div className="flex gap-2 mt-1">
                  <input
                    className="axy-input w-24 px-2.5 py-2 text-xs"
                    value={normForm.version}
                    onChange={(e) => setNormForm({ ...normForm, version: e.target.value })}
                  />
                  <select
                    className="axy-input flex-1 px-2.5 py-2 text-xs"
                    value={normForm.status}
                    onChange={(e) => setNormForm({ ...normForm, status: e.target.value as RegulaNormativaRecord['status'] })}
                  >
                    <option value="VIGENTE">Vigente</option>
                    <option value="EN_CONSULTA">En Consulta</option>
                    <option value="MODIFICADA">Modificada</option>
                    <option value="DEROGADA">Derogada</option>
                    <option value="PENDIENTE_REVISION">Pendiente Revisión</option>
                  </select>
                </div>
              </div>
              <div className="md:col-span-3">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Resumen y Alcance *</label>
                <textarea
                  required
                  rows={2}
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.summary}
                  onChange={(e) => setNormForm({ ...normForm, summary: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Áreas Impactadas (separadas por coma)</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={normForm.affectedAreas}
                  onChange={(e) => setNormForm({ ...normForm, affectedAreas: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Enlace Oficial (opcional)</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="https://..."
                  value={normForm.sourceUrl}
                  onChange={(e) => setNormForm({ ...normForm, sourceUrl: e.target.value })}
                />
              </div>
              <div className="md:col-span-3 flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNormForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
                  Guardar Normativa
                </button>
              </div>
            </form>
          )}

          {versionTarget && (
            <form onSubmit={handleRegisterNormVersion} className="axy-surface-ai rounded-2xl p-5 space-y-3">
              <div className="text-xs font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-[#0066FF]" />
                <span>Nueva Versión para {versionTarget.code} — {versionTarget.title}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  required
                  placeholder="Nueva versión (ej. v2.0)"
                  className="axy-input px-3 py-2 text-xs"
                  value={versionForm.version}
                  onChange={(e) => setVersionForm({ ...versionForm, version: e.target.value })}
                />
                <select
                  className="axy-input px-3 py-2 text-xs"
                  value={versionForm.newStatus}
                  onChange={(e) => setVersionForm({ ...versionForm, newStatus: e.target.value as RegulaNormativaRecord['status'] })}
                >
                  <option value="VIGENTE">Vigente</option>
                  <option value="MODIFICADA">Modificada</option>
                  <option value="DEROGADA">Derogada</option>
                  <option value="EN_CONSULTA">En Consulta</option>
                </select>
                <input
                  required
                  placeholder="Resumen del cambio normativo"
                  className="axy-input px-3 py-2 text-xs"
                  value={versionForm.changeSummary}
                  onChange={(e) => setVersionForm({ ...versionForm, changeSummary: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setVersionTarget(null)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
                  Registrar Versión
                </button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Código / Normativa</th>
                    <th className="px-3 py-3">Regulador</th>
                    <th className="px-3 py-3">Versión</th>
                    <th className="px-3 py-3">Vigencia</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-3 py-3">Aplicabilidad</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {normativas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Sin normativas registradas. Haz clic en “Nueva Normativa” para construir tu biblioteca.
                      </td>
                    </tr>
                  ) : (
                    normativas.map((n) => {
                      const versionsCount = ws.data.normativaVersiones.filter((v) => v.normativaId === n.id).length;
                      return (
                        <tr key={n.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                          <td className="px-4 py-3">
                            <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{n.code}</div>
                            <div className="font-semibold text-slate-900 dark:text-white">{n.title}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{n.summary}</div>
                          </td>
                          <td className="px-3 py-3">{n.regulator}</td>
                          <td className="px-3 py-3 font-mono">{n.version} ({versionsCount} hist.)</td>
                          <td className="px-3 py-3 font-mono">{n.effectiveDate}</td>
                          <td className="px-3 py-3">{n.status}</td>
                          <td className="px-3 py-3 font-semibold">{n.applicabilityStatus}</td>
                          <td className="px-4 py-3 text-right space-x-2">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setVersionTarget(n)}
                                className="text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                              >
                                Versionar
                              </button>
                            )}
                            {canDelete && ws.userProfile && (
                              <button
                                type="button"
                                onClick={() =>
                                  softDeleteRegulaEntity({
                                    user: ws.userProfile!,
                                    organizationId: ws.orgId,
                                    config: ws.effectiveConfig,
                                    collectionName: 'regula_normativas',
                                    id: n.id,
                                    entityCode: n.code,
                                    reason: 'Anulación lógica desde Biblioteca Normativa',
                                  })
                                }
                                className="text-rose-500 hover:text-rose-600 cursor-pointer"
                                title="Anular lógicamente"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            )}
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
      )}

      {/* TAB 3: OBLIGACIONES Y REQUERIMIENTOS */}
      {tab === 'obligaciones' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  className="axy-input pl-8 pr-3 py-1.5 text-xs w-52"
                  placeholder="Buscar obligación o responsable..."
                  value={oblFilter.search}
                  onChange={(e) => setOblFilter({ ...oblFilter, search: e.target.value })}
                />
              </div>
              <select
                className="axy-input px-2.5 py-1.5 text-xs"
                value={oblFilter.status}
                onChange={(e) => setOblFilter({ ...oblFilter, status: e.target.value })}
              >
                <option value="ALL">Todos los estados</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="EN_PROGRESO">En Progreso</option>
                <option value="PARCIAL">Parcial</option>
                <option value="EN_REVISION">En Revisión</option>
                <option value="CUMPLIDA">Cumplida</option>
                <option value="VENCIDA">Vencida</option>
                <option value="NO_APLICABLE">No Aplicable</option>
              </select>
              <select
                className="axy-input px-2.5 py-1.5 text-xs"
                value={oblFilter.department}
                onChange={(e) => setOblFilter({ ...oblFilter, department: e.target.value })}
              >
                <option value="ALL">Todas las áreas</option>
                {ws.effectiveConfig.departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowOblForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva Obligación</span>
              </button>
            )}
          </div>

          {showOblForm && (
            <form onSubmit={handleCreateObligation} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Código</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Ej. OBL-001"
                  value={oblForm.code}
                  onChange={(e) => setOblForm({ ...oblForm, code: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Título de la Obligación *</label>
                <input
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Ej. Remisión mensual de reporte de operaciones en efectivo (ROE)"
                  value={oblForm.title}
                  onChange={(e) => setOblForm({ ...oblForm, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Normativa Vinculada</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.normativaId}
                  onChange={(e) => setOblForm({ ...oblForm, normativaId: e.target.value })}
                >
                  <option value="">Sin vincular / Manual</option>
                  {normativas.map((n) => (
                    <option key={n.id} value={n.id}>{n.code} · {n.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Regulador</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.regulator}
                  onChange={(e) => setOblForm({ ...oblForm, regulator: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Periodicidad</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.frequency}
                  onChange={(e) => setOblForm({ ...oblForm, frequency: e.target.value as RegulaFrequency })}
                >
                  {ws.effectiveConfig.frequencies.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Fecha de Vencimiento *</label>
                <input
                  required
                  type="date"
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.dueDate}
                  onChange={(e) => setOblForm({ ...oblForm, dueDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Área Responsable</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.department}
                  onChange={(e) => setOblForm({ ...oblForm, department: e.target.value })}
                >
                  {ws.effectiveConfig.departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Responsable *</label>
                <input
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.responsibleName}
                  onChange={(e) => setOblForm({ ...oblForm, responsibleName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Criticidad</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.criticality}
                  onChange={(e) => setOblForm({ ...oblForm, criticality: e.target.value as RegulaSeverity })}
                >
                  <option value="BAJA">Baja</option>
                  <option value="MEDIA">Media</option>
                  <option value="ALTA">Alta</option>
                  <option value="CRITICA">Crítica</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Evidencia Requerida</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Ej. Acuse de recibo oficial / PDF firmado / captura de envío"
                  value={oblForm.requiredEvidenceDesc}
                  onChange={(e) => setOblForm({ ...oblForm, requiredEvidenceDesc: e.target.value })}
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Descripción Operativa *</label>
                <textarea
                  required
                  rows={2}
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={oblForm.description}
                  onChange={(e) => setOblForm({ ...oblForm, description: e.target.value })}
                />
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowOblForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
                  Guardar Obligación
                </button>
              </div>
            </form>
          )}

          {/* Non-applicable justification + approval gate */}
          {naTarget && (
            <form onSubmit={handleConfirmNonApplicable} className="axy-surface-ai rounded-2xl p-5 space-y-3 border border-amber-500/35">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-950 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                <span>Aprobación de “No Aplicable” para {naTarget.code} — {naTarget.title}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Regla de gobierno: marcar una obligación como <strong>NO_APLICABLE</strong> requiere justificación técnica documentada (mínimo 15 caracteres) y aprobación formal registrada en bitácora.
              </p>
              <textarea
                required
                rows={2}
                placeholder="Documenta el fundamento técnico o regulatorio de no aplicabilidad..."
                className="axy-input w-full px-3 py-2 text-xs"
                value={naJustification}
                onChange={(e) => setNaJustification(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setNaTarget(null)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
                  Aprobar y Marcar No Aplicable
                </button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Código / Obligación</th>
                    <th className="px-3 py-3">Regulador</th>
                    <th className="px-3 py-3">Área / Responsable</th>
                    <th className="px-3 py-3">Vencimiento</th>
                    <th className="px-3 py-3">Criticidad</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Gestión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {filteredObligaciones.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        No hay obligaciones registradas que coincidan con el filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredObligaciones.map((o) => {
                      const days = o.dueDate ? daysBetweenIso(ws.todayIso, o.dueDate) : 0;
                      const evCount = ws.data.evidencias.filter((e) => !e.deletedAt && e.relatedEntityId === o.id).length;
                      return (
                        <tr key={o.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                          <td className="px-4 py-3 max-w-xs">
                            <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{o.code}</div>
                            <div className="font-semibold text-slate-900 dark:text-white">{o.title}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {o.frequency} · Evidencias vinculadas: {evCount}
                              {o.originSource === 'REGULA_AI_VALIDADA' ? ' · Origen: REGULA AI (Validada)' : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3">{o.regulator}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-slate-900 dark:text-white">{o.department}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{o.responsibleName}</div>
                          </td>
                          <td className="px-3 py-3 font-mono">
                            <div>{o.dueDate}</div>
                            {o.status !== 'CUMPLIDA' && o.status !== 'NO_APLICABLE' && (
                              <div className={`text-[10px] font-semibold ${days < 0 ? 'text-rose-600' : days <= 15 ? 'text-amber-600' : 'text-slate-400'}`}>
                                {days < 0 ? `${Math.abs(days)}d vencida` : `en ${days}d`}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 font-semibold">{o.criticality}</td>
                          <td className="px-3 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE[o.status]}`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              {canEdit && (
                                <select
                                  aria-label={`Cambiar estado de ${o.code}`}
                                  className="axy-input px-2 py-1 text-[11px]"
                                  value={o.status}
                                  onChange={(e) => handleObligationStatusChange(o, e.target.value as RegulaObligationStatus)}
                                >
                                  <option value="PENDIENTE">Pendiente</option>
                                  <option value="EN_PROGRESO">En Progreso</option>
                                  <option value="PARCIAL">Parcial</option>
                                  <option value="EN_REVISION">En Revisión</option>
                                  <option value="CUMPLIDA">Cumplida</option>
                                  <option value="VENCIDA">Vencida</option>
                                  <option value="NO_APLICABLE">No Aplicable (Aprob.)</option>
                                </select>
                              )}
                              <button
                                type="button"
                                onClick={() => onNavigate('evidencias')}
                                className="text-[11px] text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                              >
                                Evidencias
                              </button>
                            </div>
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
      )}

      {/* TAB 4: CALENDARIO DE CUMPLIMIENTO */}
      {tab === 'calendario' && (
        <div className="axy-surface rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Calendario Consolidado de Cumplimiento, Auditorías y Planes
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Visualización mensual, semanal (próximos 14 días) o anual sobre fechas reales registradas.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {(['SEMANAL', 'MENSUAL', 'ANUAL'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCalView(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    calView === m ? 'axy-brand-gradient text-white' : 'axy-btn-secondary'
                  }`}
                >
                  {m}
                </button>
              ))}
              {calView !== 'SEMANAL' && (
                <input
                  type="month"
                  className="axy-input px-2.5 py-1.5 text-xs"
                  value={calMonth}
                  onChange={(e) => setCalMonth(e.target.value)}
                />
              )}
            </div>
          </div>

          {calendarItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay hitos ni vencimientos programados en la ventana seleccionada.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {calendarItems.map((item) => {
                const diff = daysBetweenIso(ws.todayIso, item.dueDate);
                return (
                  <div key={`${item.type}_${item.id}`} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10">
                          {item.type}
                        </span>
                        <span className="text-xs font-bold text-slate-950 dark:text-white">
                          {item.code} · {item.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {item.department} · Responsable: {item.responsible} · Estado: {item.status}
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{item.dueDate}</div>
                      <div className={`text-[10px] font-semibold ${diff < 0 ? 'text-rose-600' : diff <= 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {diff < 0 ? `${Math.abs(diff)}d vencido` : `en ${diff}d`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: MATRIZ DE APLICABILIDAD */}
      {tab === 'aplicabilidad' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Matriz de Aplicabilidad Normativa
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Determina con justificación técnica y flujo de aprobación qué normas aplican a la institución.
              </p>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowAppForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Evaluar Aplicabilidad</span>
              </button>
            )}
          </div>

          {showAppForm && (
            <form onSubmit={handleCreateApplicability} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold">Normativa *</label>
                <select
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={appForm.normativaId}
                  onChange={(e) => setAppForm({ ...appForm, normativaId: e.target.value })}
                >
                  <option value="">Selecciona una normativa...</option>
                  {normativas.map((n) => (
                    <option key={n.id} value={n.id}>{n.code} · {n.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold">Decisión de Aplicabilidad</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={appForm.decision}
                  onChange={(e) => setAppForm({ ...appForm, decision: e.target.value as RegulaAplicabilidadRecord['decision'] })}
                >
                  <option value="APLICABLE">Aplicable</option>
                  <option value="PARCIALMENTE_APLICABLE">Parcialmente Aplicable</option>
                  <option value="NO_APLICABLE">No Aplicable</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold">Próxima Revisión</label>
                <input
                  type="date"
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={appForm.nextReviewDate}
                  onChange={(e) => setAppForm({ ...appForm, nextReviewDate: e.target.value })}
                />
              </div>
              <div className="md:col-span-3">
                <label className="text-[11px] font-semibold">Justificación Técnica y Legal *</label>
                <textarea
                  required
                  rows={2}
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Explica por qué la norma aplica, aplica parcialmente o no aplica según tipo de entidad y productos..."
                  value={appForm.justification}
                  onChange={(e) => setAppForm({ ...appForm, justification: e.target.value })}
                />
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAppForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">
                  Enviar a Aprobación
                </button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Normativa</th>
                    <th className="px-3 py-3">Entidad / Supervisor</th>
                    <th className="px-3 py-3">Decisión</th>
                    <th className="px-3 py-3">Justificación</th>
                    <th className="px-3 py-3">Aprobación</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {aplicabilidad.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Sin evaluaciones en la Matriz de Aplicabilidad.
                      </td>
                    </tr>
                  ) : (
                    aplicabilidad.map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                          <span className="font-mono text-[#0052CC] dark:text-[#00D1FF] mr-1.5">{a.normativaCode}</span>
                          {a.normativaTitle}
                        </td>
                        <td className="px-3 py-3">
                          <div>{a.entityType}</div>
                          <div className="text-[10px] text-slate-500">{a.supervisor}</div>
                        </td>
                        <td className="px-3 py-3 font-bold">{a.decision}</td>
                        <td className="px-3 py-3 max-w-xs text-slate-600 dark:text-slate-300">{a.justification}</td>
                        <td className="px-3 py-3">
                          <span className="font-semibold">{a.approvalStatus}</span>
                          {a.approvedByName && (
                            <div className="text-[10px] text-slate-500">Por {a.approvedByName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {canApprove && a.approvalStatus === 'PENDIENTE_APROBACION' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApproveApplicability(a, 'APROBADO')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Aprobar</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApproveApplicability(a, 'RECHAZADO')}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
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
    </div>
  );
}
