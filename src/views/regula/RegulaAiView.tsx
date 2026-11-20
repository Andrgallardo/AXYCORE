import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardPlus,
  FileSearch,
  FileText,
  History,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  createRegulaEntity,
  recordRegulaAiQuery,
  recordRegulaApproval,
  validateRegulaAiQuery,
} from '../../services/regulaStore';
import type {
  RegulaAiMode,
  RegulaDocumentoRecord,
  RegulaObligacionRecord,
  RegulaPlanAccionRecord,
  RegulaSeverity,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

interface AiResultState {
  mode: RegulaAiMode;
  queryId?: string;
  payload: Record<string, unknown>;
}

const MODES: Array<{ id: RegulaAiMode; label: string; desc: string }> = [
  { id: 'ASISTENTE', label: '1. Asistente Regulatorio', desc: 'Consultas sobre obligaciones, brechas y riesgos reales de la entidad.' },
  { id: 'ANALISIS_NORMATIVO', label: '2. Análisis Normativo', desc: 'Extrae propuestas de obligaciones y controles desde un texto legal.' },
  { id: 'DIAGNOSTICO_BRECHAS', label: '3. Diagnóstico de Brechas', desc: 'Detecta riesgos sin mitigación, controles débiles y evidencias faltantes.' },
  { id: 'EVALUACION_DOCUMENTO', label: '4. Evaluación de Documentos', desc: 'Revisa políticas y manuales buscando vacíos o ambigüedades.' },
  { id: 'RECOMENDACIONES', label: '5. Recomendaciones Estratégicas', desc: 'Sugiere acciones priorizadas de cumplimiento, control y auditoría.' },
  { id: 'GENERACION_INFORME', label: '6. Borrador de Informe', desc: 'Redacta borrador ejecutivo/comité sujeto a revisión y aprobación humana.' },
];

export function RegulaAiView({ ws }: { ws: RegulaWorkspaceState }) {
  const [activeMode, setActiveMode] = useState<RegulaAiMode>('ASISTENTE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [result, setResult] = useState<AiResultState | null>(null);

  // Inputs by mode
  const [question, setQuestion] = useState('');
  const [normTitle, setNormTitle] = useState('');
  const [normRegulator, setNormRegulator] = useState(ws.effectiveConfig.primarySupervisor);
  const [normText, setNormText] = useState('');
  const [gapFocus, setGapFocus] = useState('Cumplimiento general, PLAFTPADM, riesgos críticos y controles');
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('POLITICA');
  const [docText, setDocText] = useState('');
  const [reportType, setReportType] = useState('Informe Ejecutivo de Cumplimiento y Riesgos');
  const [reportAudience, setReportAudience] = useState('Dirección General y Comité de Cumplimiento');

  const compactRegulaContext = useMemo(
    () => ({
      institution: {
        name: ws.effectiveConfig.institutionName,
        entityType: ws.effectiveConfig.entityType,
        jurisdiction: ws.effectiveConfig.jurisdiction,
        supervisor: ws.effectiveConfig.primarySupervisor,
      },
      kpis: ws.kpis,
      ecosystemSignals: ws.ecosystemSignals,
      obligaciones: ws.data.obligaciones
        .filter((o) => !o.deletedAt)
        .slice(0, 40)
        .map((o) => ({
          code: o.code,
          title: o.title,
          regulator: o.regulator,
          status: o.status,
          dueDate: o.dueDate,
          criticality: o.criticality,
          evidencesCount: o.linkedEvidenceIds?.length || 0,
        })),
      riesgos: ws.data.riesgos
        .filter((r) => !r.deletedAt)
        .slice(0, 40)
        .map((r) => ({
          code: r.code,
          name: r.name,
          category: r.category,
          residualScore: r.residualScore,
          residualLevel: r.residualLevel,
          linkedControls: r.linkedControlIds?.length || 0,
        })),
      controles: ws.data.controles
        .filter((c) => !c.deletedAt)
        .slice(0, 40)
        .map((c) => ({
          code: c.code,
          name: c.name,
          effectiveness: c.effectiveness,
          weaknessIdentified: c.weaknessIdentified,
        })),
      hallazgosAbiertos: ws.data.hallazgos
        .filter((h) => !h.deletedAt && h.status !== 'CERRADO')
        .slice(0, 25)
        .map((h) => ({ code: h.code, title: h.title, severity: h.severity, dueDate: h.dueDate })),
      planesAccion: ws.data.planesAccion
        .filter((p) => !p.deletedAt)
        .slice(0, 25)
        .map((p) => ({ code: p.code, title: p.title, status: p.status, progressPct: p.progressPct, dueDate: p.dueDate })),
    }),
    [ws.effectiveConfig, ws.kpis, ws.ecosystemSignals, ws.data]
  );

  const runAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile) return;
    if (!ws.effectiveConfig.aiEnabled) {
      setError('REGULA AI está deshabilitado en la configuración de esta organización.');
      return;
    }

    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      let endpoint = '/api/regula/ai/assistant';
      let body: Record<string, unknown> = {
        organization: ws.organization,
        actorRole: ws.userProfile.role,
        actorId: ws.userProfile.uid,
      };
      let promptSummary = '';

      if (activeMode === 'ASISTENTE' || activeMode === 'RECOMENDACIONES') {
        const q =
          activeMode === 'RECOMENDACIONES'
            ? question.trim() ||
              'Genera recomendaciones priorizadas de cumplimiento regulatorio, PLAFTPADM, controles internos y planes de acción basadas estrictamente en los datos actuales de la entidad.'
            : question.trim();
        if (!q) throw new Error('Escribe una consulta para REGULA AI.');
        endpoint = '/api/regula/ai/assistant';
        body = { ...body, question: q, regulaContext: compactRegulaContext };
        promptSummary = q.slice(0, 240);
      } else if (activeMode === 'ANALISIS_NORMATIVO') {
        if (normText.trim().length < 20) {
          throw new Error('Pega el texto normativo o extracto completo (mínimo 20 caracteres).');
        }
        endpoint = '/api/regula/ai/normative-analysis';
        body = {
          ...body,
          normativeTitle: normTitle.trim() || 'Normativa regulatoria',
          regulator: normRegulator.trim() || 'Regulador',
          normativeText: normText.trim(),
          institutionProfile: compactRegulaContext.institution,
        };
        promptSummary = `Análisis normativo: ${normTitle || 'Sin título'} (${normRegulator})`;
      } else if (activeMode === 'DIAGNOSTICO_BRECHAS') {
        endpoint = '/api/regula/ai/gap-diagnosis';
        body = { ...body, focusArea: gapFocus.trim(), regulaContext: compactRegulaContext };
        promptSummary = `Diagnóstico de brechas: ${gapFocus}`;
      } else if (activeMode === 'EVALUACION_DOCUMENTO') {
        if (docText.trim().length < 20) {
          throw new Error('Pega el contenido del documento institucional a evaluar (mínimo 20 caracteres).');
        }
        endpoint = '/api/regula/ai/document-evaluation';
        body = {
          ...body,
          documentTitle: docTitle.trim() || 'Documento institucional',
          documentType: docType,
          documentText: docText.trim(),
        };
        promptSummary = `Evaluación de documento: ${docTitle || docType}`;
      } else if (activeMode === 'GENERACION_INFORME') {
        endpoint = '/api/regula/ai/generate-report';
        body = {
          ...body,
          reportType,
          audience: reportAudience,
          regulaContext: compactRegulaContext,
        };
        promptSummary = `Borrador de informe: ${reportType} (${reportAudience})`;
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json?.error || `Error HTTP ${resp.status} en REGULA AI.`);
      }

      const summaryText = String(
        json.answer ||
          json.executiveSummary ||
          json.diagnosisSummary ||
          json.overallAssessment ||
          'Respuesta estructurada generada por REGULA AI.'
      ).slice(0, 600);

      const savedQuery = await recordRegulaAiQuery({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entry: {
          mode: activeMode,
          promptSummary,
          model: String(json.model || 'gemini-4-hydrogen'),
          responseSummary: summaryText,
          structuredResultJson: JSON.stringify(json).slice(0, 12000),
          citedSources: Array.isArray(json.citedSources) ? json.citedSources.map(String) : [],
          missingDataNoted: Array.isArray(json.missingData) ? json.missingData.map(String) : [],
          humanValidationStatus:
            activeMode === 'ASISTENTE' || activeMode === 'RECOMENDACIONES'
              ? 'INFORMATIVA'
              : 'PENDIENTE_VALIDACION',
        },
      });

      setResult({ mode: activeMode, queryId: savedQuery.id, payload: json });
      setOkMsg('Análisis generado y registrado en bitácora auditable de REGULA AI. Toda propuesta requiere validación humana.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible ejecutar REGULA AI.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdoptProposedObligation = async (prop: Record<string, unknown>) => {
    if (!ws.userProfile) return;
    if (!ws.can('cumplimiento', 'crear')) {
      setError('Tu rol no tiene permisos para crear obligaciones oficiales.');
      return;
    }
    try {
      const code = `OBL-IA-${String(ws.data.obligaciones.length + 1).padStart(3, '0')}`;
      const crit = String(prop.criticality || 'ALTA').toUpperCase();
      const validCrit: RegulaSeverity = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(crit)
        ? (crit as RegulaSeverity)
        : 'ALTA';

      const created = await createRegulaEntity<RegulaObligacionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_obligaciones',
        prefix: 'rgobl',
        entityCode: code,
        auditAction: 'VALIDACION_OBLIGACION_PROPUESTA_IA',
        data: {
          code,
          title: String(prop.title || 'Obligación extraída por REGULA AI'),
          description: String(prop.description || ''),
          regulator: normRegulator || ws.effectiveConfig.primarySupervisor,
          category: ws.effectiveConfig.regulatoryCategories[0] || 'Regulación Financiera y Crediticia',
          obligationType: ws.effectiveConfig.obligationTypes[0] || 'Control y Validación Interna',
          department: String(prop.suggestedDepartment || ws.effectiveConfig.departments[0] || 'Cumplimiento'),
          responsibleName: ws.userProfile.displayName,
          frequency: 'MENSUAL',
          dueDate: ws.todayIso,
          criticality: validCrit,
          status: 'PENDIENTE',
          compliancePct: 0,
          requiredEvidenceDesc: String(prop.requiredEvidence || 'Evidencia de cumplimiento verificable'),
          linkedEvidenceIds: [],
          linkedControlIds: [],
          originSource: 'REGULA_AI_VALIDADA',
        },
      });

      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_obligaciones',
        entityId: created.id,
        entityCode: code,
        approvalAction: 'VALIDAR_OBLIGACION_IA',
        decision: 'APROBADO',
        justification: `Validación humana de obligación propuesta por REGULA AI (${String(prop.sourceClause || 'texto normativo')}).`,
      });

      if (result?.queryId) {
        await validateRegulaAiQuery({
          user: ws.userProfile,
          organizationId: ws.orgId,
          config: ws.effectiveConfig,
          queryId: result.queryId,
          status: 'VALIDADA_APLICADA',
        });
      }
      setOkMsg(`Obligación ${code} validada por humano y creada oficialmente en Cumplimiento.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando obligación.');
    }
  };

  const handleAdoptGapAsActionPlan = async (gap: Record<string, unknown>) => {
    if (!ws.userProfile) return;
    if (!ws.can('planes_accion', 'crear')) {
      setError('Tu rol no tiene permisos para crear planes de acción.');
      return;
    }
    try {
      const code = `PA-IA-${String(ws.data.planesAccion.length + 1).padStart(3, '0')}`;
      const sev = String(gap.severity || 'ALTA').toUpperCase();
      const priority: RegulaSeverity = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(sev)
        ? (sev as RegulaSeverity)
        : 'ALTA';

      await createRegulaEntity<RegulaPlanAccionRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_planes_accion',
        prefix: 'rgpa',
        entityCode: code,
        auditAction: 'CREACION_PLAN_DESDE_BRECHA_IA',
        data: {
          code,
          title: String(gap.title || 'Plan de cierre de brecha REGULA AI'),
          description: `${String(gap.detail || '')}\nAcción recomendada: ${String(gap.recommendedActionPlan || '')}`,
          actionType: 'CORRECTIVA',
          originType: 'BRECHA_IA',
          originEntityCode: String(gap.sourceRef || 'REGULA_AI'),
          department: ws.effectiveConfig.departments[0] || 'Cumplimiento',
          responsibleName: ws.userProfile.displayName,
          priority,
          startDate: ws.todayIso,
          dueDate: ws.todayIso,
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
              fromStatus: 'PROPUESTA_IA',
              toStatus: 'PENDIENTE',
              notes: 'Plan creado tras validación humana de diagnóstico de brechas REGULA AI.',
            },
          ],
        },
      });
      if (result?.queryId) {
        await validateRegulaAiQuery({
          user: ws.userProfile,
          organizationId: ws.orgId,
          config: ws.effectiveConfig,
          queryId: result.queryId,
          status: 'VALIDADA_APLICADA',
        });
      }
      setOkMsg(`Plan de acción ${code} creado oficialmente tras validación humana.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando plan de acción.');
    }
  };

  const handleSaveReportDraftAsDocument = async () => {
    if (!ws.userProfile || !result) return;
    if (!ws.can('evidencias', 'crear')) {
      setError('Tu rol no tiene permisos para guardar documentos en el repositorio.');
      return;
    }
    try {
      const code = `INF-IA-${String(ws.data.documentos.length + 1).padStart(3, '0')}`;
      const sections = Array.isArray(result.payload.sections)
        ? (result.payload.sections as Array<{ heading: string; content: string }>)
        : [];
      const fullText = [
        String(result.payload.executiveSummary || ''),
        ...sections.map((s) => `\n## ${s.heading}\n${s.content}`),
      ].join('\n');

      const created = await createRegulaEntity<RegulaDocumentoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_documentos',
        prefix: 'rgdoc',
        entityCode: code,
        auditAction: 'GUARDADO_BORRADOR_INFORME_IA',
        data: {
          code,
          title: String(result.payload.draftTitle || reportType),
          docType: 'INFORME',
          department: 'Cumplimiento',
          ownerName: ws.userProfile.displayName,
          version: 'v0.1-borrador',
          effectiveDate: ws.todayIso,
          status: 'PENDIENTE_APROBACION',
          summary: String(result.payload.executiveSummary || '').slice(0, 400),
          contentText: fullText,
          confidential: true,
          versionHistory: [
            {
              version: 'v0.1-borrador',
              date: ws.todayIso,
              authorName: ws.userProfile.displayName,
              notes: 'Borrador generado por REGULA AI, pendiente de aprobación oficial.',
            },
          ],
        },
      });
      if (result.queryId) {
        await validateRegulaAiQuery({
          user: ws.userProfile,
          organizationId: ws.orgId,
          config: ws.effectiveConfig,
          queryId: result.queryId,
          status: 'VALIDADA_APLICADA',
        });
      }
      setOkMsg(`Borrador guardado como documento ${created.code} en estado Pendiente de Aprobación.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando borrador de informe.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/25 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#0066FF]/20 border border-[#00D1FF]/40 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#00D1FF]" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold">REGULA AI — Inteligencia Regulatoria Supervisada</h2>
              <p className="text-xs text-slate-300">
                Opera exclusivamente con los datos reales de tu institución. Cita fuentes exactas, señala datos faltantes y exige validación humana.
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-[#00D1FF]/15 text-[#00D1FF] border border-[#00D1FF]/30">
            Validación Humana Obligatoria
          </span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setActiveMode(m.id);
              setError(null);
            }}
            className={`p-3 rounded-xl text-left border transition cursor-pointer ${
              activeMode === m.id
                ? 'bg-[#0066FF] text-white border-[#0066FF] shadow-md'
                : 'bg-white dark:bg-[#08132B] border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-[#0066FF]/50'
            }`}
          >
            <p className="text-xs font-bold leading-snug">{m.label}</p>
            <p className={`text-[10px] mt-1 leading-snug ${activeMode === m.id ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>
              {m.desc}
            </p>
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {okMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/12 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{okMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Input Form */}
        <form
          onSubmit={runAi}
          className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3"
        >
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
            <span>{MODES.find((m) => m.id === activeMode)?.label}</span>
          </h3>

          {(activeMode === 'ASISTENTE' || activeMode === 'RECOMENDACIONES') && (
            <textarea
              rows={6}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                activeMode === 'RECOMENDACIONES'
                  ? 'Opcional: enfoca las recomendaciones en un área (ej. PLAFTPADM, controles de cobranza, hallazgos críticos)...'
                  : 'Ej. ¿Cuáles son nuestras obligaciones críticas sin evidencia o riesgos altos sin controles efectivos?'
              }
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
            />
          )}

          {activeMode === 'ANALISIS_NORMATIVO' && (
            <>
              <input
                value={normTitle}
                onChange={(e) => setNormTitle(e.target.value)}
                placeholder="Título / código de la norma o circular"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
              <input
                value={normRegulator}
                onChange={(e) => setNormRegulator(e.target.value)}
                placeholder="Regulador (SIB, UAF, DGII, BCRD...)"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
              <textarea
                rows={7}
                value={normText}
                onChange={(e) => setNormText(e.target.value)}
                placeholder="Pega aquí el articulado o circular regulatoria para extraer obligaciones propuestas..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
            </>
          )}

          {activeMode === 'DIAGNOSTICO_BRECHAS' && (
            <textarea
              rows={5}
              value={gapFocus}
              onChange={(e) => setGapFocus(e.target.value)}
              placeholder="Enfoque del diagnóstico de brechas institucionales"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
            />
          )}

          {activeMode === 'EVALUACION_DOCUMENTO' && (
            <>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Título de la política o manual"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              >
                <option value="POLITICA">Política</option>
                <option value="MANUAL">Manual</option>
                <option value="PROCEDIMIENTO">Procedimiento</option>
              </select>
              <textarea
                rows={7}
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="Pega aquí el texto del documento interno a auditar con REGULA AI..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
            </>
          )}

          {activeMode === 'GENERACION_INFORME' && (
            <>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              >
                <option value="Informe Ejecutivo de Cumplimiento y Riesgos">Informe Ejecutivo para Dirección General</option>
                <option value="Informe para Comité de Riesgos">Informe para Comité de Riesgos</option>
                <option value="Informe para Comité de Cumplimiento y PLAFTPADM">Informe para Comité de Cumplimiento</option>
                <option value="Informe de Auditoría Interna y Control">Informe para Comité de Auditoría</option>
              </select>
              <input
                value={reportAudience}
                onChange={(e) => setReportAudience(e.target.value)}
                placeholder="Audiencia objetivo"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-xs"
              />
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{loading ? 'Analizando con REGULA AI...' : 'Ejecutar Análisis Supervisado'}</span>
          </button>
        </form>

        {/* Output Panel */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
            <span>Resultado Estructurado y Validación Humana</span>
          </h3>

          {!result ? (
            <p className="text-xs text-slate-500 py-10 text-center">
              Selecciona uno de los 6 modos de REGULA AI y ejecuta un análisis. Toda respuesta incluirá fuentes citadas, datos faltantes detectados y botones de validación humana.
            </p>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Primary text summary */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E]/70 border border-slate-200/70 dark:border-white/10 whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-100">
                {String(
                  result.payload.answer ||
                    result.payload.executiveSummary ||
                    result.payload.diagnosisSummary ||
                    result.payload.overallAssessment ||
                    ''
                )}
              </div>

              {/* Proposed Obligations with 1-click human validation */}
              {Array.isArray(result.payload.proposedObligations) &&
                result.payload.proposedObligations.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-bold text-slate-900 dark:text-white">
                      Obligaciones Propuestas (Requieren Validación Humana):
                    </p>
                    {(result.payload.proposedObligations as Array<Record<string, unknown>>).map((ob, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-slate-200 dark:border-white/10 flex flex-wrap items-start justify-between gap-3"
                      >
                        <div className="space-y-1 flex-1 min-w-[220px]">
                          <p className="font-bold text-slate-900 dark:text-white">{String(ob.title)}</p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">{String(ob.description)}</p>
                          <p className="text-[10px] text-slate-500">
                            Área sugerida: {String(ob.suggestedDepartment)} · Criticidad: {String(ob.criticality)}
                            {ob.sourceClause ? ` · Cláusula: ${String(ob.sourceClause)}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAdoptProposedObligation(ob)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Validar y Crear Obligación</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

              {/* Detected Gaps with 1-click conversion to Action Plan */}
              {Array.isArray(result.payload.gaps) && result.payload.gaps.length > 0 && (
                <div className="space-y-2">
                  <p className="font-bold text-slate-900 dark:text-white">Brechas Detectadas:</p>
                  {(result.payload.gaps as Array<Record<string, unknown>>).map((g, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-200 dark:border-white/10 flex flex-wrap items-start justify-between gap-3"
                    >
                      <div className="space-y-1 flex-1 min-w-[220px]">
                        <p className="font-bold text-slate-900 dark:text-white">
                          [{String(g.severity)}] {String(g.title)}
                        </p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">{String(g.detail)}</p>
                        <p className="text-[11px] text-[#0066FF] dark:text-[#00D1FF]">
                          Plan sugerido: {String(g.recommendedActionPlan)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAdoptGapAsActionPlan(g)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] text-white text-[11px] font-semibold cursor-pointer"
                      >
                        <ClipboardPlus className="w-3.5 h-3.5" />
                        <span>Crear Plan de Acción</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Draft Report Sections */}
              {Array.isArray(result.payload.sections) && result.payload.sections.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900 dark:text-white">
                      Secciones del Borrador (Pendiente de Aprobación):
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveReportDraftAsDocument}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Guardar Borrador en Documentos</span>
                    </button>
                  </div>
                  {(result.payload.sections as Array<{ heading: string; content: string }>).map((sec, i) => (
                    <div key={i} className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E]/50 border border-slate-200/70 dark:border-white/10">
                      <p className="font-bold text-slate-900 dark:text-white mb-1">{sec.heading}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{sec.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Bullet lists for Assistant / Document Eval */}
              {['keyFindings', 'suggestedActions', 'strengths', 'gapsAndAmbiguities', 'contradictions', 'improvementProposals', 'prioritizedRecommendations'].map(
                (field) =>
                  Array.isArray(result.payload[field]) &&
                  (result.payload[field] as unknown[]).length > 0 && (
                    <div key={field} className="space-y-1">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{field}</p>
                      <ul className="list-disc pl-5 space-y-1 text-slate-700 dark:text-slate-200">
                        {(result.payload[field] as unknown[]).map((item, idx) => (
                          <li key={idx}>{String(item)}</li>
                        ))}
                      </ul>
                    </div>
                  )
              )}

              {/* Cited Sources & Missing Data */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200/70 dark:border-white/10">
                <div className="p-3 rounded-xl bg-sky-500/8 border border-sky-500/20">
                  <p className="text-[10px] font-bold uppercase text-sky-700 dark:text-sky-300 mb-1">
                    Fuentes Reales Citadas
                  </p>
                  {Array.isArray(result.payload.citedSources) && result.payload.citedSources.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-700 dark:text-slate-200">
                      {(result.payload.citedSources as unknown[]).map((s, i) => (
                        <li key={i}>{String(s)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">Sin referencias específicas.</p>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                  <p className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300 mb-1">
                    Datos Faltantes / Limitaciones Declaradas
                  </p>
                  {Array.isArray(result.payload.missingData) && result.payload.missingData.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-slate-700 dark:text-slate-200">
                      {(result.payload.missingData as unknown[]).map((s, i) => (
                        <li key={i}>{String(s)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">Ninguna limitación adicional reportada.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Audited AI History */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
          <span>Bitácora Auditable de Consultas REGULA AI ({ws.data.aiConsultas.length})</span>
        </h3>
        {ws.data.aiConsultas.length === 0 ? (
          <p className="text-xs text-slate-500">Aún no se registran consultas a REGULA AI en esta organización.</p>
        ) : (
          <div className="divide-y divide-slate-200/70 dark:divide-white/10 max-h-64 overflow-y-auto">
            {ws.data.aiConsultas.slice(0, 20).map((q) => (
              <div key={q.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/10 mr-2 font-bold">
                    {q.mode}
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{q.promptSummary}</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {q.actorName} ({q.actorRole}) · {q.timestampIso.replace('T', ' ').slice(0, 19)} UTC · Modelo: {q.model}
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-500/12 text-sky-700 dark:text-sky-300">
                  {q.humanValidationStatus}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
