import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck,
  FileText,
  FolderArchive,
  GraduationCap,
  Lock,
  Plus,
  RotateCcw,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import {
  daysBetweenIso,
  REGULA_INCIDENT_TYPE_LABELS,
  validateActionPlanUpdate,
} from '../../engine/regulaEngine';
import {
  createRegulaEntity,
  logEvidenceDownloadAndOpen,
  readFileAsBoundedDataUrl,
  recordRegulaApproval,
  updateRegulaEntity,
} from '../../services/regulaStore';
import type {
  RegulaActionPlanStatus,
  RegulaActividadRecord,
  RegulaCapacitacionRecord,
  RegulaDocumentoRecord,
  RegulaEvaluacionCapacitacionRecord,
  RegulaEvidenciaRecord,
  RegulaIncidenteRecord,
  RegulaIncidentType,
  RegulaParticipanteRecord,
  RegulaPlanAccionRecord,
  RegulaSeverity,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

type OpsMode = 'evidencias' | 'incidentes' | 'planes_accion' | 'cultura';

const SEVERITY_BADGE: Record<string, string> = {
  CRITICA: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30',
  ALTA: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30',
  MEDIA: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  BAJA: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
};

const PLAN_STATUS_LABELS: Record<RegulaActionPlanStatus, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  EN_REVISION: 'En revisión',
  IMPLEMENTADA: 'Implementada',
  PENDIENTE_VERIFICACION: 'Pendiente de verificación',
  CERRADA: 'Cerrada (Verificada)',
  VENCIDA: 'Vencida',
  REABIERTA: 'Reabierta',
};

export function RegulaOperationsGovernanceView({
  ws,
  mode,
}: {
  ws: RegulaWorkspaceState;
  mode: OpsMode;
}) {
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [subTab, setSubTab] = useState<string>(
    mode === 'evidencias' ? 'evidencias' : mode === 'cultura' ? 'capacitaciones' : 'main'
  );

  // =========================================================================
  // 1. EVIDENCIAS Y DOCUMENTACIÓN
  // =========================================================================
  const evidencias = useMemo(
    () => ws.data.evidencias.filter((e) => !e.deletedAt),
    [ws.data.evidencias]
  );
  const documentos = useMemo(
    () => ws.data.documentos.filter((d) => !d.deletedAt),
    [ws.data.documentos]
  );

  const [evForm, setEvForm] = useState({
    code: '',
    title: '',
    description: '',
    version: 'v1.0',
    category: 'OBLIGACION' as RegulaEvidenciaRecord['category'],
    relatedEntityCode: '',
    validFrom: ws.todayIso,
    validUntil: '',
    confidential: false,
  });
  const [evFile, setEvFile] = useState<File | null>(null);
  const [savingEv, setSavingEv] = useState(false);

  const [docForm, setDocForm] = useState({
    code: '',
    title: '',
    docType: 'POLITICA' as RegulaDocumentoRecord['docType'],
    department: ws.effectiveConfig.departments[0] || 'Cumplimiento',
    ownerName: ws.userProfile?.displayName || '',
    version: 'v1.0',
    effectiveDate: ws.todayIso,
    expiryDate: '',
    summary: '',
    contentText: '',
    confidential: false,
  });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);

  const handleUploadEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!evForm.title.trim()) {
      setMsg({ type: 'err', text: 'Indica el título de la evidencia.' });
      return;
    }
    setSavingEv(true);
    setMsg(null);
    try {
      let fileMeta = {
        fileName: 'registro-documental.txt',
        mimeType: 'text/plain',
        sizeBytes: 0,
        fileDataUrl: undefined as string | undefined,
        truncatedNote: undefined as string | undefined,
      };
      if (evFile) {
        const read = await readFileAsBoundedDataUrl(evFile);
        fileMeta = {
          fileName: read.fileName,
          mimeType: read.mimeType,
          sizeBytes: read.sizeBytes,
          fileDataUrl: read.fileDataUrl,
          truncatedNote: read.truncatedNote,
        };
      }
      const code = evForm.code.trim() || `EVI-${String(evidencias.length + 1).padStart(4, '0')}`;
      const status: RegulaEvidenciaRecord['status'] =
        evForm.validUntil && daysBetweenIso(ws.todayIso, evForm.validUntil) < 0
          ? 'VENCIDA'
          : evForm.validUntil && daysBetweenIso(ws.todayIso, evForm.validUntil) <= 30
          ? 'POR_VENCER'
          : 'VIGENTE';

      await createRegulaEntity<RegulaEvidenciaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_evidencias',
        prefix: 'rgevi',
        entityCode: code,
        auditAction: 'CARGA_EVIDENCIA',
        data: {
          code,
          title: evForm.title.trim(),
          description: [evForm.description.trim(), fileMeta.truncatedNote].filter(Boolean).join(' · '),
          fileName: fileMeta.fileName,
          mimeType: fileMeta.mimeType,
          sizeBytes: fileMeta.sizeBytes,
          fileDataUrl: fileMeta.fileDataUrl,
          version: evForm.version.trim() || 'v1.0',
          category: evForm.category,
          relatedEntityCode: evForm.relatedEntityCode.trim() || undefined,
          validFrom: evForm.validFrom || ws.todayIso,
          validUntil: evForm.validUntil || undefined,
          confidential: evForm.confidential,
          status,
          downloadCount: 0,
        },
      });
      setEvForm({
        code: '',
        title: '',
        description: '',
        version: 'v1.0',
        category: 'OBLIGACION',
        relatedEntityCode: '',
        validFrom: ws.todayIso,
        validUntil: '',
        confidential: false,
      });
      setEvFile(null);
      setMsg({
        type: 'ok',
        text: fileMeta.truncatedNote
          ? `Evidencia ${code} registrada (metadatos): ${fileMeta.truncatedNote}`
          : `Evidencia ${code} cargada y registrada en bitácora.`,
      });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando evidencia.' });
    } finally {
      setSavingEv(false);
    }
  };

  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!docForm.title.trim()) {
      setMsg({ type: 'err', text: 'Indica el título de la política o manual.' });
      return;
    }
    setSavingDoc(true);
    setMsg(null);
    try {
      let fileMeta: { fileName?: string; mimeType?: string; sizeBytes?: number; fileDataUrl?: string } = {};
      if (docFile) {
        const read = await readFileAsBoundedDataUrl(docFile);
        fileMeta = {
          fileName: read.fileName,
          mimeType: read.mimeType,
          sizeBytes: read.sizeBytes,
          fileDataUrl: read.fileDataUrl,
        };
      }
      const code = docForm.code.trim() || `DOC-${String(documentos.length + 1).padStart(4, '0')}`;
      await createRegulaEntity<RegulaDocumentoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_documentos',
        prefix: 'rgdoc',
        entityCode: code,
        auditAction: 'CREACION_DOCUMENTO_NORMATIVO',
        data: {
          code,
          title: docForm.title.trim(),
          docType: docForm.docType,
          department: docForm.department,
          ownerName: docForm.ownerName.trim() || ws.userProfile.displayName,
          version: docForm.version.trim() || 'v1.0',
          effectiveDate: docForm.effectiveDate || ws.todayIso,
          expiryDate: docForm.expiryDate || undefined,
          status: 'PENDIENTE_APROBACION',
          summary: docForm.summary.trim() || 'Documento institucional registrado en AxyCore REGULA.',
          contentText: docForm.contentText.trim() || undefined,
          ...fileMeta,
          confidential: docForm.confidential,
          versionHistory: [
            {
              version: docForm.version.trim() || 'v1.0',
              date: ws.todayIso,
              authorName: ws.userProfile.displayName,
              notes: 'Emisión inicial registrada en repositorio documental REGULA.',
            },
          ],
        },
      });
      setDocForm({
        ...docForm,
        code: '',
        title: '',
        summary: '',
        contentText: '',
        expiryDate: '',
      });
      setDocFile(null);
      setMsg({ type: 'ok', text: `Documento ${code} registrado en estado Pendiente de Aprobación.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando documento.' });
    } finally {
      setSavingDoc(false);
    }
  };

  const handleApproveDocument = async (docRec: RegulaDocumentoRecord) => {
    if (!ws.userProfile) return;
    if (!ws.can('evidencias', 'aprobar')) {
      setMsg({ type: 'err', text: 'Tu rol no tiene facultad para aprobar documentos institucionales.' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaDocumentoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_documentos',
        id: docRec.id,
        entityCode: docRec.code,
        auditAction: 'APROBACION_DOCUMENTO',
        patch: {
          status: 'VIGENTE',
          approvedBy: ws.userProfile.uid,
          approvedByName: ws.userProfile.displayName,
          approvedAt: nowIso,
        },
        newSummary: `Documento ${docRec.code} aprobado y puesto en vigencia.`,
      });
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_documentos',
        entityId: docRec.id,
        entityCode: docRec.code,
        approvalAction: 'APROBAR_DOCUMENTO',
        decision: 'APROBADO',
        justification: `Aprobación oficial del documento ${docRec.code} (${docRec.version}).`,
      });
      setMsg({ type: 'ok', text: `Documento ${docRec.code} aprobado y vigente.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error aprobando documento.' });
    }
  };

  // =========================================================================
  // 2. INCIDENTES Y EVENTOS DE RIESGO
  // =========================================================================
  const incidentes = useMemo(
    () => ws.data.incidentes.filter((i) => !i.deletedAt),
    [ws.data.incidentes]
  );

  const [incForm, setIncForm] = useState({
    code: '',
    title: '',
    incidentType: 'FALLA_OPERATIVA' as RegulaIncidentType,
    description: '',
    occurredAt: ws.todayIso,
    detectedAt: ws.todayIso,
    department: ws.effectiveConfig.departments[0] || 'Operaciones',
    branch: ws.effectiveConfig.branches[0] || 'Oficina Principal',
    assignedToName: ws.userProfile?.displayName || '',
    severity: 'ALTA' as RegulaSeverity,
    estimatedLossAmount: '0',
    actualLossAmount: '0',
    currency: 'DOP' as 'DOP' | 'USD',
    rootCauseAnalysis: '',
    containmentActions: '',
    lessonsLearned: '',
    linkedRiskId: '',
  });
  const [savingInc, setSavingInc] = useState(false);

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!incForm.title.trim()) {
      setMsg({ type: 'err', text: 'Indica el título del incidente o evento de riesgo.' });
      return;
    }
    setSavingInc(true);
    setMsg(null);
    try {
      const code = incForm.code.trim() || `INC-${String(incidentes.length + 1).padStart(4, '0')}`;
      await createRegulaEntity<RegulaIncidenteRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_incidentes',
        prefix: 'rginc',
        entityCode: code,
        auditAction: 'REGISTRO_INCIDENTE',
        data: {
          code,
          title: incForm.title.trim(),
          incidentType: incForm.incidentType,
          description: incForm.description.trim() || incForm.title.trim(),
          occurredAt: incForm.occurredAt,
          detectedAt: incForm.detectedAt,
          department: incForm.department,
          branch: incForm.branch,
          reportedByName: ws.userProfile.displayName,
          assignedToName: incForm.assignedToName.trim() || ws.userProfile.displayName,
          severity: incForm.severity,
          status: incForm.rootCauseAnalysis.trim() ? 'ANALISIS_CAUSA_RAIZ' : 'REGISTRADO',
          estimatedLossAmount: Math.max(0, Number(incForm.estimatedLossAmount) || 0),
          actualLossAmount: Math.max(0, Number(incForm.actualLossAmount) || 0),
          currency: incForm.currency,
          rootCauseAnalysis: incForm.rootCauseAnalysis.trim() || undefined,
          containmentActions: incForm.containmentActions.trim() || undefined,
          lessonsLearned: incForm.lessonsLearned.trim() || undefined,
          linkedRiskIds: incForm.linkedRiskId ? [incForm.linkedRiskId] : [],
          linkedControlIds: [],
          linkedAuditIds: [],
          linkedActionPlanIds: [],
          linkedEvidenceIds: [],
        },
      });
      setIncForm({
        ...incForm,
        code: '',
        title: '',
        description: '',
        estimatedLossAmount: '0',
        actualLossAmount: '0',
        rootCauseAnalysis: '',
        containmentActions: '',
        lessonsLearned: '',
      });
      setMsg({ type: 'ok', text: `Incidente ${code} registrado con trazabilidad financiera y operativa.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando incidente.' });
    } finally {
      setSavingInc(false);
    }
  };

  const handleAdvanceIncidentStatus = async (
    inc: RegulaIncidenteRecord,
    nextStatus: RegulaIncidenteRecord['status']
  ) => {
    if (!ws.userProfile) return;
    if (nextStatus === 'CERRADO' && !ws.can('incidentes', 'cerrar')) {
      setMsg({ type: 'err', text: 'Tu rol no tiene facultad para cerrar incidentes.' });
      return;
    }
    try {
      await updateRegulaEntity<RegulaIncidenteRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_incidentes',
        id: inc.id,
        entityCode: inc.code,
        auditAction: `CAMBIO_ESTADO_INCIDENTE_${nextStatus}`,
        patch: {
          status: nextStatus,
          ...(nextStatus === 'CERRADO'
            ? { closedBy: ws.userProfile.displayName, closedAt: new Date().toISOString() }
            : {}),
        },
        previousSummary: inc.status,
        newSummary: nextStatus,
      });
      setMsg({ type: 'ok', text: `Incidente ${inc.code} actualizado a ${nextStatus}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando incidente.' });
    }
  };

  // =========================================================================
  // 3. PLANES DE ACCIÓN Y ACTIVIDADES (Cierre supervisado: 100% ≠ CERRADA)
  // =========================================================================
  const planes = useMemo(
    () => ws.data.planesAccion.filter((p) => !p.deletedAt),
    [ws.data.planesAccion]
  );
  const actividades = useMemo(
    () => ws.data.actividades.filter((a) => !a.deletedAt),
    [ws.data.actividades]
  );

  const [planForm, setPlanForm] = useState({
    code: '',
    title: '',
    description: '',
    actionType: 'CORRECTIVA' as RegulaPlanAccionRecord['actionType'],
    originType: 'MANUAL' as RegulaPlanAccionRecord['originType'],
    originEntityCode: '',
    department: ws.effectiveConfig.departments[0] || 'Cumplimiento',
    responsibleName: ws.userProfile?.displayName || '',
    priority: 'ALTA' as RegulaSeverity,
    startDate: ws.todayIso,
    dueDate: ws.todayIso,
  });
  const [savingPlan, setSavingPlan] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [verificationNote, setVerificationNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!planForm.title.trim()) {
      setMsg({ type: 'err', text: 'Indica el título del plan de acción.' });
      return;
    }
    setSavingPlan(true);
    setMsg(null);
    try {
      const code = planForm.code.trim() || `PA-${String(planes.length + 1).padStart(4, '0')}`;
      const created = await createRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        prefix: 'rgpa',
        entityCode: code,
        auditAction: 'CREACION_PLAN_ACCION',
        data: {
          code,
          title: planForm.title.trim(),
          description: planForm.description.trim() || planForm.title.trim(),
          actionType: planForm.actionType,
          originType: planForm.originType,
          originEntityCode: planForm.originEntityCode.trim() || undefined,
          department: planForm.department,
          responsibleName: planForm.responsibleName.trim() || ws.userProfile.displayName,
          priority: planForm.priority,
          startDate: planForm.startDate,
          dueDate: planForm.dueDate,
          progressPct: 0,
          status: 'PENDIENTE',
          effectivenessVerified: false,
          reopenCount: 0,
          linkedEvidenceIds: [],
          statusHistory: [
            {
              timestampIso: new Date().toISOString(),
              actorUid: ws.userProfile.uid,
              actorName: ws.userProfile.displayName,
              fromStatus: 'NUEVO',
              toStatus: 'PENDIENTE',
              notes: 'Plan de acción creado en AxyCore REGULA.',
            },
          ],
        },
      });
      setPlanForm({ ...planForm, code: '', title: '', description: '', originEntityCode: '' });
      setSelectedPlanId(created.id);
      setMsg({ type: 'ok', text: `Plan de acción ${code} creado.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando plan de acción.' });
    } finally {
      setSavingPlan(false);
    }
  };

  const handleUpdatePlanProgress = async (plan: RegulaPlanAccionRecord, nextProgress: number) => {
    if (!ws.userProfile) return;
    const desiredStatus: RegulaActionPlanStatus =
      nextProgress >= 100
        ? 'PENDIENTE_VERIFICACION'
        : nextProgress > 0
        ? 'EN_PROCESO'
        : 'PENDIENTE';

    const check = validateActionPlanUpdate({
      existing: plan,
      nextStatus: desiredStatus,
      nextProgressPct: nextProgress,
      canApproveClosure: ws.can('planes_accion', 'cerrar') || ws.can('planes_accion', 'aprobar'),
    });
    if (!check.allowed) {
      setMsg({ type: 'err', text: check.reason || 'Transición de estado no permitida.' });
      return;
    }

    try {
      const entry = {
        timestampIso: new Date().toISOString(),
        actorUid: ws.userProfile.uid,
        actorName: ws.userProfile.displayName,
        fromStatus: plan.status,
        toStatus: check.effectiveStatus,
        notes:
          nextProgress >= 100
            ? 'Avance alcanzó 100%: enviado automáticamente a Pendiente de Verificación (no se cierra sin verificación y aprobación).'
            : `Avance actualizado a ${nextProgress}%.`,
      };
      await updateRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        id: plan.id,
        entityCode: plan.code,
        auditAction: 'ACTUALIZACION_AVANCE_PLAN_ACCION',
        patch: {
          progressPct: nextProgress,
          status: check.effectiveStatus,
          statusHistory: [...(plan.statusHistory || []), entry],
        },
        previousSummary: `${plan.progressPct}% (${plan.status})`,
        newSummary: `${nextProgress}% (${check.effectiveStatus})`,
      });
      setMsg({
        type: 'ok',
        text:
          nextProgress >= 100
            ? `Plan ${plan.code} al 100% → Pendiente de Verificación de Efectividad (nunca se cierra automáticamente).`
            : `Avance de ${plan.code} actualizado a ${nextProgress}%.`,
      });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando avance.' });
    }
  };

  const handleVerifyEffectiveness = async (plan: RegulaPlanAccionRecord) => {
    if (!ws.userProfile) return;
    if (!ws.can('planes_accion', 'aprobar')) {
      setMsg({ type: 'err', text: 'Tu rol no tiene facultad para verificar efectividad.' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      const note = verificationNote.trim() || 'Efectividad verificada contra evidencias y pruebas de control.';
      await updateRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        id: plan.id,
        entityCode: plan.code,
        auditAction: 'VERIFICACION_EFECTIVIDAD_PLAN',
        patch: {
          effectivenessVerified: true,
          effectivenessVerifiedBy: ws.userProfile.uid,
          effectivenessVerifiedByName: ws.userProfile.displayName,
          effectivenessVerifiedAt: nowIso,
          effectivenessNotes: note,
          status: 'IMPLEMENTADA',
          statusHistory: [
            ...(plan.statusHistory || []),
            {
              timestampIso: nowIso,
              actorUid: ws.userProfile.uid,
              actorName: ws.userProfile.displayName,
              fromStatus: plan.status,
              toStatus: 'IMPLEMENTADA',
              notes: `Efectividad verificada: ${note}`,
            },
          ],
        },
        newSummary: note,
      });
      setVerificationNote('');
      setMsg({ type: 'ok', text: `Efectividad de ${plan.code} verificada. Ahora puede aprobarse su cierre.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error verificando efectividad.' });
    }
  };

  const handleApproveClosePlan = async (plan: RegulaPlanAccionRecord) => {
    if (!ws.userProfile) return;
    const canClose = ws.can('planes_accion', 'cerrar') && ws.can('planes_accion', 'aprobar');
    const check = validateActionPlanUpdate({
      existing: plan,
      nextStatus: 'CERRADA',
      nextProgressPct: plan.progressPct,
      effectivenessVerified: plan.effectivenessVerified,
      canApproveClosure: canClose,
    });
    if (!check.allowed) {
      setMsg({ type: 'err', text: check.reason || 'No se puede cerrar este plan todavía.' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        id: plan.id,
        entityCode: plan.code,
        auditAction: 'APROBACION_CIERRE_PLAN_ACCION',
        patch: {
          status: 'CERRADA',
          closureApprovedBy: ws.userProfile.uid,
          closureApprovedByName: ws.userProfile.displayName,
          closureApprovedAt: nowIso,
          statusHistory: [
            ...(plan.statusHistory || []),
            {
              timestampIso: nowIso,
              actorUid: ws.userProfile.uid,
              actorName: ws.userProfile.displayName,
              fromStatus: plan.status,
              toStatus: 'CERRADA',
              notes: 'Cierre aprobado formalmente tras verificación de efectividad.',
            },
          ],
        },
        newSummary: 'Cierre definitivo aprobado.',
      });
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_planes_accion',
        entityId: plan.id,
        entityCode: plan.code,
        approvalAction: 'APROBAR_CIERRE_PLAN_ACCION',
        decision: 'APROBADO',
        justification: plan.effectivenessNotes || `Cierre verificado del plan ${plan.code}.`,
      });
      setMsg({ type: 'ok', text: `Plan de acción ${plan.code} cerrado con aprobación formal.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error cerrando plan de acción.' });
    }
  };

  const handleReopenPlan = async (plan: RegulaPlanAccionRecord) => {
    if (!ws.userProfile) return;
    const check = validateActionPlanUpdate({
      existing: plan,
      nextStatus: 'REABIERTA',
      nextProgressPct: plan.progressPct,
      canApproveClosure: ws.can('planes_accion', 'aprobar'),
      reopenNotes: reopenReason,
    });
    if (!check.allowed) {
      setMsg({ type: 'err', text: check.reason || 'Ingresa un motivo de reapertura (mín. 5 caracteres).' });
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        id: plan.id,
        entityCode: plan.code,
        auditAction: 'REAPERTURA_PLAN_ACCION',
        patch: {
          status: 'REABIERTA',
          effectivenessVerified: false,
          reopenCount: (plan.reopenCount || 0) + 1,
          statusHistory: [
            ...(plan.statusHistory || []),
            {
              timestampIso: nowIso,
              actorUid: ws.userProfile.uid,
              actorName: ws.userProfile.displayName,
              fromStatus: plan.status,
              toStatus: 'REABIERTA',
              notes: `Reapertura #${(plan.reopenCount || 0) + 1}: ${reopenReason.trim()}`,
            },
          ],
        },
        newSummary: reopenReason.trim(),
      });
      setReopenReason('');
      setMsg({ type: 'ok', text: `Plan ${plan.code} reabierto conservando todo su historial.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error reabriendo plan.' });
    }
  };

  const handleAddActivity = async (plan: RegulaPlanAccionRecord) => {
    if (!ws.userProfile || !newTaskTitle.trim()) return;
    try {
      await createRegulaEntity<RegulaActividadRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_actividades',
        prefix: 'rgact',
        entityCode: plan.code,
        auditAction: 'CREACION_ACTIVIDAD_PLAN',
        data: {
          planAccionId: plan.id,
          title: newTaskTitle.trim(),
          responsibleName: plan.responsibleName,
          dueDate: plan.dueDate,
          completed: false,
        },
      });
      setNewTaskTitle('');
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error agregando actividad.' });
    }
  };

  const handleToggleActivity = async (act: RegulaActividadRecord) => {
    if (!ws.userProfile) return;
    await updateRegulaEntity<RegulaActividadRecord>({
      user: ws.userProfile,
      organizationId: ws.orgId,
      config: ws.effectiveConfig,
      collectionName: 'regula_actividades',
      id: act.id,
      auditAction: act.completed ? 'REABRIR_ACTIVIDAD' : 'COMPLETAR_ACTIVIDAD',
      patch: {
        completed: !act.completed,
        completedAt: !act.completed ? new Date().toISOString() : undefined,
      },
      newSummary: `${act.title}: ${!act.completed ? 'Completada' : 'Pendiente'}`,
    });
  };

  // =========================================================================
  // 4. CULTURA DE CUMPLIMIENTO (CAPACITACIONES, PARTICIPANTES, EVALUACIONES)
  // =========================================================================
  const capacitaciones = useMemo(
    () => ws.data.capacitaciones.filter((c) => !c.deletedAt),
    [ws.data.capacitaciones]
  );
  const participantes = useMemo(
    () => ws.data.participantes.filter((p) => !p.deletedAt),
    [ws.data.participantes]
  );

  const [capForm, setCapForm] = useState({
    code: '',
    title: '',
    topic: 'PLAFTPADM' as RegulaCapacitacionRecord['topic'],
    planYear: new Date().getFullYear(),
    modality: 'VIRTUAL' as RegulaCapacitacionRecord['modality'],
    instructorName: '',
    scheduledDate: ws.todayIso,
    durationHours: '2',
    targetAudienceCount: '15',
    minPassingScore: '80',
    certificationValidityMonths: '12',
    description: '',
  });
  const [partForm, setPartForm] = useState({
    capacitacionId: '',
    participantName: '',
    department: ws.effectiveConfig.departments[0] || 'Operaciones',
    attendanceStatus: 'ASISTIO' as RegulaParticipanteRecord['attendanceStatus'],
    evaluationScore: '90',
  });
  const [savingCap, setSavingCap] = useState(false);

  const handleCreateTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !capForm.title.trim()) return;
    setSavingCap(true);
    setMsg(null);
    try {
      const code = capForm.code.trim() || `CAP-${capForm.planYear}-${String(capacitaciones.length + 1).padStart(3, '0')}`;
      await createRegulaEntity<RegulaCapacitacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_capacitaciones',
        prefix: 'rgcap',
        entityCode: code,
        auditAction: 'CREACION_CAPACITACION',
        data: {
          code,
          title: capForm.title.trim(),
          topic: capForm.topic,
          planYear: Number(capForm.planYear) || new Date().getFullYear(),
          modality: capForm.modality,
          instructorName: capForm.instructorName.trim() || ws.userProfile.displayName,
          scheduledDate: capForm.scheduledDate,
          durationHours: Number(capForm.durationHours) || 2,
          targetAudienceCount: Math.max(1, Number(capForm.targetAudienceCount) || 1),
          minPassingScore: Number(capForm.minPassingScore) || 80,
          certificationValidityMonths: Number(capForm.certificationValidityMonths) || 12,
          status: 'PLANIFICADA',
          description: capForm.description.trim() || capForm.title.trim(),
        },
      });
      setCapForm({ ...capForm, code: '', title: '', description: '' });
      setMsg({ type: 'ok', text: `Capacitación ${code} agregada al Plan Anual de Cultura.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error creando capacitación.' });
    } finally {
      setSavingCap(false);
    }
  };

  const handleRegisterParticipantAndEval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    const cap = capacitaciones.find((c) => c.id === partForm.capacitacionId) || capacitaciones[0];
    if (!cap) {
      setMsg({ type: 'err', text: 'Primero crea una capacitación en el Plan Anual.' });
      return;
    }
    if (!partForm.participantName.trim()) {
      setMsg({ type: 'err', text: 'Indica el nombre del participante.' });
      return;
    }
    try {
      const score = Math.min(100, Math.max(0, Number(partForm.evaluationScore) || 0));
      const passed = partForm.attendanceStatus === 'ASISTIO' && score >= cap.minPassingScore;
      const certExpiry = new Date(`${ws.todayIso}T12:00:00Z`);
      certExpiry.setUTCMonth(certExpiry.getUTCMonth() + (cap.certificationValidityMonths || 12));

      const createdPart = await createRegulaEntity<RegulaParticipanteRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_participantes',
        prefix: 'rgprt',
        entityCode: cap.code,
        auditAction: 'REGISTRO_PARTICIPANTE_CAPACITACION',
        data: {
          capacitacionId: cap.id,
          capacitacionCode: cap.code,
          capacitacionTitle: cap.title,
          participantName: partForm.participantName.trim(),
          department: partForm.department,
          attendanceStatus: partForm.attendanceStatus,
          completionDate: partForm.attendanceStatus === 'ASISTIO' ? ws.todayIso : undefined,
          certified: passed,
          certificateCode: passed ? `CERT-${cap.code}-${String(participantes.length + 1).padStart(3, '0')}` : undefined,
          certificateExpiresAt: passed ? certExpiry.toISOString().slice(0, 10) : undefined,
        },
      });

      await createRegulaEntity<RegulaEvaluacionCapacitacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_evaluaciones_capacitacion',
        prefix: 'rgevc',
        entityCode: cap.code,
        auditAction: 'EVALUACION_CAPACITACION',
        data: {
          capacitacionId: cap.id,
          participanteId: createdPart.id,
          participantName: partForm.participantName.trim(),
          evaluationDate: ws.todayIso,
          score,
          passed,
          evaluatorNotes: passed
            ? `Aprobado con ${score}/100 (mínimo ${cap.minPassingScore}). Certificación emitida.`
            : `Puntaje ${score}/100 (mínimo requerido ${cap.minPassingScore}).`,
        },
      });

      setPartForm({ ...partForm, participantName: '' });
      setMsg({
        type: 'ok',
        text: passed
          ? `Participante ${createdPart.participantName} aprobado (${score}%) y certificado.`
          : `Participante ${createdPart.participantName} registrado (${score}%).`,
      });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando participante.' });
    }
  };

  // =========================================================================
  // RENDER BY MODE
  // =========================================================================
  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={`px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between gap-2 ${
            msg.type === 'ok'
              ? 'bg-emerald-500/12 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-500/12 border border-rose-500/30 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-[11px] underline cursor-pointer">
            Cerrar
          </button>
        </div>
      )}

      {/* ===================== MODE: EVIDENCIAS Y DOCUMENTACIÓN ===================== */}
      {mode === 'evidencias' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FolderArchive className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Evidencias y Documentación Institucional</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Repositorio versionado con control de vigencia, confidencialidad, aprobaciones y trazabilidad de descargas.
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-[#040C1E] p-1 border border-slate-200 dark:border-white/10">
              {[
                { id: 'evidencias', label: `Evidencias (${evidencias.length})` },
                { id: 'documentos', label: `Políticas y Manuales (${documentos.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    subTab === t.id
                      ? 'bg-[#0066FF] text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {subTab !== 'documentos' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {ws.can('evidencias', 'crear') && (
                <form
                  onSubmit={handleUploadEvidence}
                  className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
                >
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Upload className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    <span>Cargar Evidencia Versionada</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={evForm.code}
                      onChange={(e) => setEvForm({ ...evForm, code: e.target.value })}
                      placeholder="Código (auto)"
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                    <input
                      value={evForm.version}
                      onChange={(e) => setEvForm({ ...evForm, version: e.target.value })}
                      placeholder="Versión (v1.0)"
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </div>
                  <input
                    required
                    value={evForm.title}
                    onChange={(e) => setEvForm({ ...evForm, title: e.target.value })}
                    placeholder="Título de la evidencia *"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={evForm.category}
                      onChange={(e) =>
                        setEvForm({ ...evForm, category: e.target.value as RegulaEvidenciaRecord['category'] })
                      }
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    >
                      {['OBLIGACION', 'CONTROL', 'RIESGO', 'AUDITORIA', 'HALLAZGO', 'INCIDENTE', 'PLAN_ACCION', 'PLAFT', 'CAPACITACION'].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      value={evForm.relatedEntityCode}
                      onChange={(e) => setEvForm({ ...evForm, relatedEntityCode: e.target.value })}
                      placeholder="Cód. vinculado (ej. OBL-001)"
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-500">
                      Vigente desde
                      <input
                        type="date"
                        value={evForm.validFrom}
                        onChange={(e) => setEvForm({ ...evForm, validFrom: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Vence el (opcional)
                      <input
                        type="date"
                        value={evForm.validUntil}
                        onChange={(e) => setEvForm({ ...evForm, validUntil: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={evForm.description}
                    onChange={(e) => setEvForm({ ...evForm, description: e.target.value })}
                    placeholder="Descripción o alcance probatorio"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <input
                    type="file"
                    onChange={(e) => setEvFile(e.target.files?.[0] || null)}
                    className="w-full text-[11px] text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#0066FF]/10 file:text-[#0066FF] file:font-semibold"
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={evForm.confidential}
                      onChange={(e) => setEvForm({ ...evForm, confidential: e.target.checked })}
                    />
                    <span>Marcar como evidencia confidencial (acceso restringido)</span>
                  </label>
                  <button
                    type="submit"
                    disabled={savingEv}
                    className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {savingEv ? 'Registrando...' : 'Registrar Evidencia'}
                  </button>
                </form>
              )}

              <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Inventario de Evidencias ({evidencias.length})
                </h3>
                {evidencias.length === 0 ? (
                  <p className="text-xs text-slate-500 py-8 text-center">
                    No hay evidencias cargadas aún. Sube respaldos de obligaciones, controles, hallazgos o casos PLAFTPADM.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/70 dark:divide-white/10">
                    {evidencias.map((ev) => (
                      <div key={ev.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">
                              {ev.code}
                            </span>
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">{ev.title}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                              {ev.version} · {ev.category}
                            </span>
                            {ev.confidential && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-rose-500/12 text-rose-600 dark:text-rose-300 font-semibold">
                                <Lock className="w-3 h-3" /> Confidencial
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Archivo: {ev.fileName} · Vigencia: {ev.validFrom} → {ev.validUntil || 'Permanente'} ·
                            Consultas/Descargas: {ev.downloadCount || 0}
                            {ev.relatedEntityCode ? ` · Vínculo: ${ev.relatedEntityCode}` : ''}
                          </p>
                        </div>
                        {ws.can('evidencias', 'descargar') && (
                          <button
                            type="button"
                            onClick={() =>
                              ws.userProfile &&
                              logEvidenceDownloadAndOpen({
                                user: ws.userProfile,
                                organizationId: ws.orgId,
                                config: ws.effectiveConfig,
                                evidence: ev,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{ev.fileDataUrl ? 'Descargar' : 'Registrar Consulta'}</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {ws.can('evidencias', 'crear') && (
                <form
                  onSubmit={handleCreateDocument}
                  className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
                >
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    <span>Registrar Política / Manual</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={docForm.code}
                      onChange={(e) => setDocForm({ ...docForm, code: e.target.value })}
                      placeholder="Código (auto)"
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                    <select
                      value={docForm.docType}
                      onChange={(e) =>
                        setDocForm({ ...docForm, docType: e.target.value as RegulaDocumentoRecord['docType'] })
                      }
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    >
                      {['POLITICA', 'MANUAL', 'PROCEDIMIENTO', 'MATRIZ', 'NORMATIVO', 'ACTA', 'INFORME'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    required
                    value={docForm.title}
                    onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                    placeholder="Título del documento institucional *"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={docForm.department}
                      onChange={(e) => setDocForm({ ...docForm, department: e.target.value })}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    >
                      {ws.effectiveConfig.departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <input
                      value={docForm.version}
                      onChange={(e) => setDocForm({ ...docForm, version: e.target.value })}
                      placeholder="Versión (v1.0)"
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-500">
                      Vigencia inicial
                      <input
                        type="date"
                        value={docForm.effectiveDate}
                        onChange={(e) => setDocForm({ ...docForm, effectiveDate: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Próxima revisión
                      <input
                        type="date"
                        value={docForm.expiryDate}
                        onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                      />
                    </label>
                  </div>
                  <textarea
                    rows={2}
                    value={docForm.summary}
                    onChange={(e) => setDocForm({ ...docForm, summary: e.target.value })}
                    placeholder="Resumen ejecutivo del documento"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <input
                    type="file"
                    onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                    className="w-full text-[11px] text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#0066FF]/10 file:text-[#0066FF] file:font-semibold"
                  />
                  <button
                    type="submit"
                    disabled={savingDoc}
                    className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {savingDoc ? 'Guardando...' : 'Registrar Política / Manual'}
                  </button>
                </form>
              )}

              <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Políticas, Manuales y Procedimientos ({documentos.length})
                </h3>
                {documentos.length === 0 ? (
                  <p className="text-xs text-slate-500 py-8 text-center">
                    No hay documentos institucionales registrados. Crea políticas de cumplimiento, manual PLAFTPADM o procedimientos internos.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/70 dark:divide-white/10">
                    {documentos.map((d) => (
                      <div key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">{d.code}</span>
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">{d.title}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                              {d.docType} · {d.version}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                d.status === 'VIGENTE'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {d.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Área: {d.department} · Responsable: {d.ownerName} · Vigencia: {d.effectiveDate} → {d.expiryDate || 'Sin vencimiento'}
                            {d.approvedByName ? ` · Aprobado por ${d.approvedByName}` : ''}
                          </p>
                        </div>
                        {d.status !== 'VIGENTE' && ws.can('evidencias', 'aprobar') && (
                          <button
                            type="button"
                            onClick={() => handleApproveDocument(d)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                          >
                            <FileCheck className="w-3.5 h-3.5" />
                            <span>Aprobar Vigencia</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== MODE: INCIDENTES Y EVENTOS ===================== */}
      {mode === 'incidentes' && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-rose-500" />
              <span>Incidentes y Eventos de Riesgo</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Registro de 11 tipologías de eventos, análisis de causa raíz, cuantificación de pérdidas estimadas vs. reales y lecciones aprendidas.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {ws.can('incidentes', 'crear') && (
              <form
                onSubmit={handleCreateIncident}
                className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-rose-500" />
                  <span>Reportar Incidente / Evento</span>
                </h3>
                <input
                  required
                  value={incForm.title}
                  onChange={(e) => setIncForm({ ...incForm, title: e.target.value })}
                  placeholder="Título del incidente *"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <select
                  value={incForm.incidentType}
                  onChange={(e) => setIncForm({ ...incForm, incidentType: e.target.value as RegulaIncidentType })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                >
                  {(Object.keys(REGULA_INCIDENT_TYPE_LABELS) as RegulaIncidentType[]).map((k) => (
                    <option key={k} value={k}>{REGULA_INCIDENT_TYPE_LABELS[k]}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={incForm.severity}
                    onChange={(e) => setIncForm({ ...incForm, severity: e.target.value as RegulaSeverity })}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map((s) => (
                      <option key={s} value={s}>Severidad {s}</option>
                    ))}
                  </select>
                  <select
                    value={incForm.department}
                    onChange={(e) => setIncForm({ ...incForm, department: e.target.value })}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {ws.effectiveConfig.departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-slate-500">
                    Fecha ocurrencia
                    <input
                      type="date"
                      value={incForm.occurredAt}
                      onChange={(e) => setIncForm({ ...incForm, occurredAt: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Fecha detección
                    <input
                      type="date"
                      value={incForm.detectedAt}
                      onChange={(e) => setIncForm({ ...incForm, detectedAt: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    min="0"
                    value={incForm.estimatedLossAmount}
                    onChange={(e) => setIncForm({ ...incForm, estimatedLossAmount: e.target.value })}
                    placeholder="Pérdida Est."
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <input
                    type="number"
                    min="0"
                    value={incForm.actualLossAmount}
                    onChange={(e) => setIncForm({ ...incForm, actualLossAmount: e.target.value })}
                    placeholder="Pérdida Real"
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                  <select
                    value={incForm.currency}
                    onChange={(e) => setIncForm({ ...incForm, currency: e.target.value as 'DOP' | 'USD' })}
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    <option value="DOP">DOP</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  value={incForm.rootCauseAnalysis}
                  onChange={(e) => setIncForm({ ...incForm, rootCauseAnalysis: e.target.value })}
                  placeholder="Análisis de causa raíz"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <textarea
                  rows={2}
                  value={incForm.lessonsLearned}
                  onChange={(e) => setIncForm({ ...incForm, lessonsLearned: e.target.value })}
                  placeholder="Acciones de contención / lecciones aprendidas"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <button
                  type="submit"
                  disabled={savingInc}
                  className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingInc ? 'Registrando...' : 'Registrar Incidente'}
                </button>
              </form>
            )}

            <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Registro de Incidentes ({incidentes.length})
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  Pérdida Real Acumulada:{' '}
                  <strong className="text-rose-600 dark:text-rose-400">
                    {incidentes.reduce((s, i) => s + (i.actualLossAmount || 0), 0).toLocaleString('es-DO')}
                  </strong>
                </span>
              </div>
              {incidentes.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">
                  No se han reportado incidentes de riesgo. Cualquier falla operativa, brecha, fraude o interrupción se documenta aquí.
                </p>
              ) : (
                <div className="space-y-3">
                  {incidentes.map((inc) => (
                    <div
                      key={inc.id}
                      className="p-4 rounded-xl bg-slate-50/80 dark:bg-[#040C1E]/60 border border-slate-200/70 dark:border-white/10 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">
                            {inc.code}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{inc.title}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${SEVERITY_BADGE[inc.severity]}`}>
                            {inc.severity}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-200 font-semibold">
                            {inc.status}
                          </span>
                        </div>
                        {ws.can('incidentes', 'editar') && inc.status !== 'CERRADO' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAdvanceIncidentStatus(inc, 'ANALISIS_CAUSA_RAIZ')}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-white/15 text-[11px] font-semibold cursor-pointer"
                            >
                              Causa Raíz
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdvanceIncidentStatus(inc, 'RESUELTO')}
                              className="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Resolver
                            </button>
                            {ws.can('incidentes', 'cerrar') && (
                              <button
                                type="button"
                                onClick={() => handleAdvanceIncidentStatus(inc, 'CERRADO')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Cerrar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {REGULA_INCIDENT_TYPE_LABELS[inc.incidentType]} · Área: {inc.department} · Ocurrió: {inc.occurredAt} ·
                        Pérdida Est.: {inc.currency} {(inc.estimatedLossAmount || 0).toLocaleString('es-DO')} · Pérdida Real:{' '}
                        {inc.currency} {(inc.actualLossAmount || 0).toLocaleString('es-DO')}
                      </p>
                      {inc.rootCauseAnalysis && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          <strong>Causa raíz:</strong> {inc.rootCauseAnalysis}
                        </p>
                      )}
                      {inc.lessonsLearned && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          <strong>Lecciones aprendidas:</strong> {inc.lessonsLearned}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODE: PLANES DE ACCIÓN ===================== */}
      {mode === 'planes_accion' && (
        <div className="space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
              <span>Planes de Acción y Seguimiento Verificado</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Regla institucional: alcanzar 100% de avance pasa el plan a <strong>Pendiente de Verificación</strong>; ningún plan se cierra automáticamente sin verificación de efectividad y aprobación autorizada.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {ws.can('planes_accion', 'crear') && (
              <form
                onSubmit={handleCreatePlan}
                className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#0066FF]" />
                  <span>Crear Plan de Acción</span>
                </h3>
                <input
                  required
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  placeholder="Título del plan de acción *"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={planForm.actionType}
                    onChange={(e) =>
                      setPlanForm({ ...planForm, actionType: e.target.value as RegulaPlanAccionRecord['actionType'] })
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    <option value="CORRECTIVA">Correctiva</option>
                    <option value="PREVENTIVA">Preventiva</option>
                    <option value="MEJORA">Mejora Continua</option>
                  </select>
                  <select
                    value={planForm.originType}
                    onChange={(e) =>
                      setPlanForm({ ...planForm, originType: e.target.value as RegulaPlanAccionRecord['originType'] })
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {['OBLIGACION', 'RIESGO', 'CONTROL', 'HALLAZGO', 'INCIDENTE', 'PLAFT', 'BRECHA_IA', 'MANUAL'].map((o) => (
                      <option key={o} value={o}>Origen: {o}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={planForm.department}
                    onChange={(e) => setPlanForm({ ...planForm, department: e.target.value })}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {ws.effectiveConfig.departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={planForm.priority}
                    onChange={(e) => setPlanForm({ ...planForm, priority: e.target.value as RegulaSeverity })}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].map((p) => (
                      <option key={p} value={p}>Prioridad {p}</option>
                    ))}
                  </select>
                </div>
                <input
                  value={planForm.responsibleName}
                  onChange={(e) => setPlanForm({ ...planForm, responsibleName: e.target.value })}
                  placeholder="Responsable asignado"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-slate-500">
                    Fecha inicio
                    <input
                      type="date"
                      value={planForm.startDate}
                      onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Fecha límite
                    <input
                      type="date"
                      value={planForm.dueDate}
                      onChange={(e) => setPlanForm({ ...planForm, dueDate: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                </div>
                <textarea
                  rows={2}
                  value={planForm.description}
                  onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                  placeholder="Descripción del remedio y criterio de efectividad"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingPlan ? 'Creando...' : 'Crear Plan de Acción'}
                </button>
              </form>
            )}

            <div className="lg:col-span-2 space-y-3">
              {planes.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 text-center text-xs text-slate-500">
                  No hay planes de acción registrados aún. Crea acciones correctivas o preventivas desde hallazgos, riesgos, controles o incidentes.
                </div>
              ) : (
                planes.map((plan) => {
                  const planTasks = actividades.filter((a) => a.planAccionId === plan.id);
                  const isExpanded = selectedPlanId === plan.id;
                  const overdue = plan.status !== 'CERRADA' && daysBetweenIso(ws.todayIso, plan.dueDate) < 0;
                  return (
                    <div
                      key={plan.id}
                      className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">
                              {plan.code}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">{plan.title}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${SEVERITY_BADGE[plan.priority]}`}>
                              {plan.priority}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                plan.status === 'CERRADA'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : overdue
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                  : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                              }`}
                            >
                              {PLAN_STATUS_LABELS[plan.status] || plan.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {plan.actionType} · Origen: {plan.originType} · Área: {plan.department} · Responsable:{' '}
                            {plan.responsibleName} · Vence: {plan.dueDate}
                            {plan.reopenCount > 0 ? ` · Reaperturas: ${plan.reopenCount}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedPlanId(isExpanded ? null : plan.id)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold cursor-pointer"
                        >
                          {isExpanded ? 'Ocultar gestión' : 'Gestionar / Verificar'}
                        </button>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              plan.status === 'CERRADA' ? 'bg-emerald-500' : 'bg-[#0066FF]'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, plan.progressPct))}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                          {plan.progressPct}%
                        </span>
                        {plan.effectivenessVerified && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                            <ShieldCheck className="w-3.5 h-3.5" /> Efectividad Verificada
                          </span>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-3">
                          {plan.status !== 'CERRADA' && ws.can('planes_accion', 'editar') && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                Actualizar avance:
                              </span>
                              {[25, 50, 75, 100].map((pct) => (
                                <button
                                  key={pct}
                                  type="button"
                                  onClick={() => handleUpdatePlanProgress(plan, pct)}
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold hover:bg-[#0066FF] hover:text-white cursor-pointer"
                                >
                                  {pct}%
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Subtasks */}
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                              Actividades / Subtareas ({planTasks.length})
                            </p>
                            {planTasks.map((t) => (
                              <label
                                key={t.id}
                                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={t.completed}
                                  onChange={() => handleToggleActivity(t)}
                                />
                                <span className={t.completed ? 'line-through text-slate-400' : ''}>{t.title}</span>
                              </label>
                            ))}
                            {plan.status !== 'CERRADA' && ws.can('planes_accion', 'editar') && (
                              <div className="flex gap-2 pt-1">
                                <input
                                  value={newTaskTitle}
                                  onChange={(e) => setNewTaskTitle(e.target.value)}
                                  placeholder="Nueva actividad concreta..."
                                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddActivity(plan)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white/10 text-white text-xs font-semibold cursor-pointer"
                                >
                                  Agregar
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Verification & Formal Closure Governance */}
                          {plan.status !== 'CERRADA' ? (
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E]/80 border border-slate-200/70 dark:border-white/10 space-y-2">
                              <input
                                value={verificationNote}
                                onChange={(e) => setVerificationNote(e.target.value)}
                                placeholder="Nota de verificación de efectividad (evidencia comprobada)"
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B] text-xs"
                              />
                              <div className="flex flex-wrap gap-2">
                                {!plan.effectivenessVerified && ws.can('planes_accion', 'aprobar') && (
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyEffectiveness(plan)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>1. Verificar Efectividad</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleApproveClosePlan(plan)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>2. Aprobar Cierre Definitivo</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/25 flex flex-wrap items-center gap-2">
                              <input
                                value={reopenReason}
                                onChange={(e) => setReopenReason(e.target.value)}
                                placeholder="Justificación para reabrir plan cerrado..."
                                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-amber-500/30 bg-white dark:bg-[#08132B] text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => handleReopenPlan(plan)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reabrir Plan</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODE: CULTURA DE CUMPLIMIENTO ===================== */}
      {mode === 'cultura' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Cultura de Cumplimiento y Capacitación</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Plan anual de formación regulatoria y PLAFTPADM, asistencia, evaluaciones, certificaciones vigentes y cobertura real.
              </p>
            </div>
            <div className="px-4 py-2 rounded-xl bg-[#040C1E] text-white border border-[#00B8FF]/25 text-xs">
              Cobertura Global:{' '}
              <strong className="font-mono text-[#00D1FF]">
                {ws.kpis.trainingCoveragePct !== null ? `${ws.kpis.trainingCoveragePct}%` : 'Sin meta aún'}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {ws.can('cultura', 'crear') && (
              <form
                onSubmit={handleCreateTraining}
                className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#0066FF]" />
                  <span>Programar Capacitación Anual</span>
                </h3>
                <input
                  required
                  value={capForm.title}
                  onChange={(e) => setCapForm({ ...capForm, title: e.target.value })}
                  placeholder="Título (ej. Inducción Anual Ley 155-17 PLAFTPADM) *"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={capForm.topic}
                    onChange={(e) =>
                      setCapForm({ ...capForm, topic: e.target.value as RegulaCapacitacionRecord['topic'] })
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {['PLAFTPADM', 'CUMPLIMIENTO_REGULATORIO', 'GESTION_RIESGOS', 'CONTROL_INTERNO', 'SEGURIDAD_INFORMACION', 'ETICA_GOBIERNO'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={capForm.modality}
                    onChange={(e) =>
                      setCapForm({ ...capForm, modality: e.target.value as RegulaCapacitacionRecord['modality'] })
                    }
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {['VIRTUAL', 'PRESENCIAL', 'MIXTA', 'AUTOAPRENDIZAJE'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-slate-500">
                    Fecha
                    <input
                      type="date"
                      value={capForm.scheduledDate}
                      onChange={(e) => setCapForm({ ...capForm, scheduledDate: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Meta Personas
                    <input
                      type="number"
                      min="1"
                      value={capForm.targetAudienceCount}
                      onChange={(e) => setCapForm({ ...capForm, targetAudienceCount: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Nota Mínima
                    <input
                      type="number"
                      min="50"
                      max="100"
                      value={capForm.minPassingScore}
                      onChange={(e) => setCapForm({ ...capForm, minPassingScore: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={savingCap}
                  className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingCap ? 'Guardando...' : 'Agregar al Plan Anual'}
                </button>
              </form>
            )}

            {ws.can('cultura', 'crear') && (
              <form
                onSubmit={handleRegisterParticipantAndEval}
                className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-500" />
                  <span>Registrar Asistencia, Evaluación y Certificación</span>
                </h3>
                <select
                  value={partForm.capacitacionId || capacitaciones[0]?.id || ''}
                  onChange={(e) => setPartForm({ ...partForm, capacitacionId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                >
                  {capacitaciones.length === 0 ? (
                    <option value="">Crea primero una capacitación</option>
                  ) : (
                    capacitaciones.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.title}
                      </option>
                    ))
                  )}
                </select>
                <input
                  required
                  value={partForm.participantName}
                  onChange={(e) => setPartForm({ ...partForm, participantName: e.target.value })}
                  placeholder="Nombre del colaborador *"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                />
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={partForm.department}
                    onChange={(e) => setPartForm({ ...partForm, department: e.target.value })}
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    {ws.effectiveConfig.departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={partForm.attendanceStatus}
                    onChange={(e) =>
                      setPartForm({
                        ...partForm,
                        attendanceStatus: e.target.value as RegulaParticipanteRecord['attendanceStatus'],
                      })
                    }
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  >
                    <option value="ASISTIO">Asistió</option>
                    <option value="INSCRITO">Inscrito</option>
                    <option value="INASISTENCIA">Inasistencia</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={partForm.evaluationScore}
                    onChange={(e) => setPartForm({ ...partForm, evaluationScore: e.target.value })}
                    placeholder="Nota (0-100)"
                    className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={capacitaciones.length === 0}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  Registrar Evaluación y Emitir Certificado
                </button>
              </form>
            )}
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Award className="w-4 h-4 text-[#E2B35E]" />
              <span>Capacitaciones y Certificaciones ({capacitaciones.length})</span>
            </h3>
            {capacitaciones.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Aún no hay capacitaciones programadas. Crea el Plan Anual de Cumplimiento y PLAFTPADM arriba.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/70 dark:divide-white/10">
                {capacitaciones.map((c) => {
                  const parts = participantes.filter((p) => p.capacitacionId === c.id);
                  const attended = parts.filter((p) => p.attendanceStatus === 'ASISTIO').length;
                  const certified = parts.filter((p) => p.certified).length;
                  const cov = Math.min(100, Math.round((attended / Math.max(1, c.targetAudienceCount)) * 100));
                  return (
                    <div key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                          <span className="font-mono text-[#0066FF] dark:text-[#00D1FF] mr-2">{c.code}</span>
                          {c.title}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {c.topic} · {c.modality} · Fecha: {c.scheduledDate} · Meta: {c.targetAudienceCount} ·
                          Asistieron: {attended} · Certificados: {certified}
                        </p>
                      </div>
                      <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00D1FF]">
                        Cobertura {cov}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
