import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  GripVertical,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_WORKFLOW_CONFIG,
  GATE_TYPE_LABELS,
  WORKFLOW_STAGE_PALETTE,
  cloneWorkflowConfig,
  insertWorkflowStageAt,
  normalizeWorkflowThresholds,
  reorderWorkflowStages,
  simulateWorkflowRoute,
} from '../engine/workflowBuilder';
import {
  ROLE_LABELS,
  type CurrencyCode,
  type PolicyWorkflowConfig,
  type RiskBandCode,
  type UserRole,
  type WorkflowStageCode,
  type WorkflowStageConfig,
  type WorkflowStageGateType,
} from '../types/axycore';

interface WorkflowBuilderProps {
  workflowConfig?: PolicyWorkflowConfig | null;
  dopPerUsd: number;
  capacityDtiRatio: number;
  capacityMinCoverage: number;
  canEdit: boolean;
  onChange: (nextWorkflow: PolicyWorkflowConfig) => void;
  onSyncCapacityFromWorkflow?: (params: {
    maxProjectedDti: number;
    minCoverageRatio: number;
    autoRejectMaxScore: number;
    syncCriticalBand: boolean;
  }) => void;
}

const ASSIGNABLE_ROLES: UserRole[] = [
  'BUSINESS_OFFICER',
  'CREDIT_ANALYST',
  'RISK_OFFICER',
  'COMMITTEE_MEMBER',
  'FORMALIZATION',
  'OPERATIONS',
  'FINANCE',
  'ADMIN',
];

const RISK_BAND_OPTIONS: Array<{ code: RiskBandCode; label: string }> = [
  { code: 'MUY_BAJO', label: 'Muy bajo' },
  { code: 'BAJO', label: 'Bajo' },
  { code: 'MODERADO', label: 'Moderado' },
  { code: 'MEDIO_ALTO', label: 'Medio-alto' },
  { code: 'ALTO', label: 'Alto' },
  { code: 'CRITICO', label: 'Crítico' },
];

export function WorkflowBuilder({
  workflowConfig,
  dopPerUsd,
  capacityDtiRatio,
  capacityMinCoverage,
  canEdit,
  onChange,
  onSyncCapacityFromWorkflow,
}: WorkflowBuilderProps) {
  const wf = useMemo(() => cloneWorkflowConfig(workflowConfig), [workflowConfig]);
  const thresholds = wf.decisionThresholds;
  const stages = wf.stages;

  const [selectedStageId, setSelectedStageId] = useState<string>(
    stages[0]?.id ?? 'stage_precalificacion_v2'
  );
  const [dragStageIdx, setDragStageIdx] = useState<number | null>(null);
  const [dragPaletteCode, setDragPaletteCode] = useState<WorkflowStageCode | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  // Interactive Threshold Track Dragging
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'REJECT' | 'APPROVE' | null>(null);

  // Route Simulator State
  const [simScore, setSimScore] = useState<number>(84);
  const [simAmount, setSimAmount] = useState<number>(220000);
  const [simCurrency, setSimCurrency] = useState<CurrencyCode>('DOP');
  const [simDtiPct, setSimDtiPct] = useState<number>(Math.round(capacityDtiRatio * 100) || 28);

  const selectedStage = useMemo(
    () => stages.find((s) => s.id === selectedStageId) ?? stages[0] ?? null,
    [stages, selectedStageId]
  );

  const simulation = useMemo(
    () =>
      simulateWorkflowRoute({
        workflowConfig: wf,
        score: simScore,
        amount: simAmount,
        currency: simCurrency,
        dopPerUsd: dopPerUsd || 60,
        projectedDtiPct: simDtiPct,
      }),
    [wf, simScore, simAmount, simCurrency, dopPerUsd, simDtiPct]
  );

  const updateThresholds = (patch: Partial<PolicyWorkflowConfig['decisionThresholds']>) => {
    const nextThresholds = normalizeWorkflowThresholds({
      ...thresholds,
      ...patch,
    });
    const nextWf: PolicyWorkflowConfig = {
      ...wf,
      decisionThresholds: nextThresholds,
      updatedAtIso: new Date().toISOString(),
    };
    onChange(nextWf);
    onSyncCapacityFromWorkflow?.({
      maxProjectedDti: Number((nextThresholds.maxAutoDtiPct / 100).toFixed(4)),
      minCoverageRatio: nextThresholds.minCoverageRatio,
      autoRejectMaxScore: nextThresholds.autoRejectMaxScore,
      syncCriticalBand: nextThresholds.syncCriticalBandWithAutoReject,
    });
  };

  const updateStages = (nextStages: WorkflowStageConfig[]) => {
    onChange({
      ...wf,
      stages: nextStages,
      updatedAtIso: new Date().toISOString(),
    });
  };

  const updateSingleStage = (stageId: string, patch: Partial<WorkflowStageConfig>) => {
    updateStages(stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
  };

  // Pointer drag on Score Spectrum Track
  const resolveScoreFromPointer = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 50;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    return Math.round(ratio * 100);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canEdit || !draggingHandle) return;
    const score = resolveScoreFromPointer(e.clientX);
    if (draggingHandle === 'REJECT') {
      const clampedReject = Math.max(10, Math.min(thresholds.autoApproveMinScore - 6, Math.min(75, score)));
      updateThresholds({
        autoRejectMaxScore: clampedReject,
        committeeReviewMinScore: clampedReject + 1,
      });
    } else if (draggingHandle === 'APPROVE') {
      const clampedApprove = Math.max(thresholds.committeeReviewMinScore + 5, Math.min(100, score));
      updateThresholds({
        autoApproveMinScore: clampedApprove,
      });
    }
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingHandle) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingHandle(null);
  };

  // HTML5 Drag & Drop Handlers for Pipeline Stages
  const handleStageDragStart = (e: React.DragEvent, index: number) => {
    if (!canEdit) return;
    setDragStageIdx(index);
    setDragPaletteCode(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-axycore-stage-idx', String(index));
  };

  const handlePaletteDragStart = (e: React.DragEvent, code: WorkflowStageCode) => {
    if (!canEdit) return;
    setDragPaletteCode(code);
    setDragStageIdx(null);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-axycore-palette', code);
  };

  const handleDropOnSlot = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (!canEdit) return;

    const stageIdxRaw = e.dataTransfer.getData('application/x-axycore-stage-idx');
    const paletteCodeRaw = e.dataTransfer.getData('application/x-axycore-palette') as WorkflowStageCode | '';

    if (stageIdxRaw !== '') {
      const fromIdx = Number(stageIdxRaw);
      if (Number.isInteger(fromIdx) && fromIdx !== targetIndex) {
        const reordered = reorderWorkflowStages(stages, fromIdx, targetIndex);
        updateStages(reordered);
      }
    } else if (paletteCodeRaw || dragPaletteCode) {
      const code = (paletteCodeRaw || dragPaletteCode) as WorkflowStageCode;
      const inserted = insertWorkflowStageAt(stages, code, targetIndex);
      updateStages(inserted);
      const created = inserted[targetIndex];
      if (created) setSelectedStageId(created.id);
    }

    setDragStageIdx(null);
    setDragPaletteCode(null);
    setDropTargetIdx(null);
  };

  const resetDragState = () => {
    setDragStageIdx(null);
    setDragPaletteCode(null);
    setDropTargetIdx(null);
  };

  const handleRestoreDefaults = () => {
    if (!canEdit) return;
    const restored = cloneWorkflowConfig(DEFAULT_WORKFLOW_CONFIG);
    onChange(restored);
    setSelectedStageId(restored.stages[0]?.id ?? '');
    onSyncCapacityFromWorkflow?.({
      maxProjectedDti: Number((restored.decisionThresholds.maxAutoDtiPct / 100).toFixed(4)),
      minCoverageRatio: restored.decisionThresholds.minCoverageRatio,
      autoRejectMaxScore: restored.decisionThresholds.autoRejectMaxScore,
      syncCriticalBand: restored.decisionThresholds.syncCriticalBandWithAutoReject,
    });
  };

  const formatGateLabel = (stage: WorkflowStageConfig): string => {
    if (stage.gateType === 'ALWAYS') return 'Siempre obligatoria';
    if (stage.gateType === 'ABOVE_AMOUNT') {
      return `Monto > RD$ ${(stage.gateAmountDop ?? 250000).toLocaleString('en-US')}`;
    }
    if (stage.gateType === 'SCORE_BELOW') {
      return `Score ≤ ${stage.gateMaxScore ?? 75} pts`;
    }
    return `Banda ≥ ${stage.gateMinRiskBand ?? 'MODERADO'}`;
  };

  const rejectPct = thresholds.autoRejectMaxScore;
  const approvePct = thresholds.autoApproveMinScore;

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <GitBranch className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Diseñador Visual de Flujo de Aprobación y Umbrales Motor V2
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Arrastra etapas para reordenar la ruta de evaluación, agrega controles desde el catálogo y desliza los umbrales de decisión automática sobre el espectro de score (0–100).
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar Flujo Estándar V2
          </button>
        )}
      </div>

      {/* Part 1: Interactive Drag-and-Drop Auto Decision Score Threshold Spectrum */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              Umbrales de Decisión Automática (Espectro Score Motor V2: 0–100 pts)
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Rechazo 0–{thresholds.autoRejectMaxScore} · Evaluación/Comité {thresholds.committeeReviewMinScore}–
            {thresholds.autoApproveMinScore - 1} · Fast-Track {thresholds.autoApproveMinScore}–100
          </span>
        </div>

        {/* Visual Spectrum Track with Draggable Handles */}
        <div className="pt-2 pb-1 select-none">
          <div
            ref={trackRef}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
            onPointerCancel={handleTrackPointerUp}
            className="relative h-9 rounded-lg overflow-visible border border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-900 flex touch-none"
          >
            {/* Zone 1: Auto Reject */}
            <div
              style={{ width: `${rejectPct}%` }}
              className="h-full rounded-l-lg bg-rose-500/85 dark:bg-rose-600/80 text-white flex items-center justify-center px-2 overflow-hidden transition-[width] duration-75"
            >
              <span className="text-[11px] font-semibold truncate">
                Sin Oferta (0–{rejectPct})
              </span>
            </div>

            {/* Zone 2: Manual / Committee Evaluation */}
            <div
              style={{ width: `${Math.max(0, approvePct - rejectPct)}%` }}
              className="h-full bg-amber-400/85 dark:bg-amber-600/75 text-slate-950 dark:text-white flex items-center justify-center px-2 overflow-hidden transition-[width] duration-75"
            >
              <span className="text-[11px] font-semibold truncate">
                Evaluación &amp; Comité ({thresholds.committeeReviewMinScore}–{approvePct - 1})
              </span>
            </div>

            {/* Zone 3: Auto Pre-approval / Fast-Track */}
            <div
              style={{ width: `${Math.max(0, 100 - approvePct)}%` }}
              className="h-full rounded-r-lg bg-emerald-500/85 dark:bg-emerald-600/80 text-white flex items-center justify-center px-2 overflow-hidden transition-[width] duration-75"
            >
              <span className="text-[11px] font-semibold truncate">
                {thresholds.enableFastTrackAutoApproval ? 'Fast-Track' : 'Preoferta Máx.'} ({approvePct}–100)
              </span>
            </div>

            {/* Handle 1: Auto-Reject Max Score */}
            <button
              type="button"
              disabled={!canEdit}
              aria-label="Arrastrar umbral de rechazo automático"
              onPointerDown={(e) => {
                if (!canEdit) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDraggingHandle('REJECT');
              }}
              onKeyDown={(e) => {
                if (!canEdit) return;
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  updateThresholds({ autoRejectMaxScore: thresholds.autoRejectMaxScore - 1 });
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateThresholds({
                    autoRejectMaxScore: Math.min(
                      thresholds.autoApproveMinScore - 6,
                      thresholds.autoRejectMaxScore + 1
                    ),
                  });
                }
              }}
              style={{ left: `${rejectPct}%` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-11 rounded-md border-2 border-white dark:border-slate-900 bg-rose-700 text-white shadow-md flex items-center justify-center transition-transform ${
                canEdit ? 'cursor-ew-resize hover:scale-105' : 'cursor-not-allowed opacity-70'
              }`}
              title={`Umbral Rechazo Automático: ≤ ${rejectPct} pts`}
            >
              <GripVertical className="w-3 h-3" />
            </button>

            {/* Handle 2: Auto-Approve Min Score */}
            <button
              type="button"
              disabled={!canEdit}
              aria-label="Arrastrar umbral de pre-aprobación Fast-Track"
              onPointerDown={(e) => {
                if (!canEdit) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDraggingHandle('APPROVE');
              }}
              onKeyDown={(e) => {
                if (!canEdit) return;
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  updateThresholds({
                    autoApproveMinScore: Math.max(
                      thresholds.committeeReviewMinScore + 5,
                      thresholds.autoApproveMinScore - 1
                    ),
                  });
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  updateThresholds({ autoApproveMinScore: thresholds.autoApproveMinScore + 1 });
                }
              }}
              style={{ left: `${approvePct}%` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-11 rounded-md border-2 border-white dark:border-slate-900 bg-emerald-700 text-white shadow-md flex items-center justify-center transition-transform ${
                canEdit ? 'cursor-ew-resize hover:scale-105' : 'cursor-not-allowed opacity-70'
              }`}
              title={`Umbral Pre-Aprobación Directa: ≥ ${approvePct} pts`}
            >
              <GripVertical className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Fine-Grained Threshold Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-1">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Score Máx. Rechazo Auto
            </label>
            <input
              type="number"
              min={10}
              max={75}
              disabled={!canEdit}
              value={thresholds.autoRejectMaxScore}
              onChange={(e) =>
                updateThresholds({ autoRejectMaxScore: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Score Mín. Fast-Track
            </label>
            <input
              type="number"
              min={thresholds.committeeReviewMinScore + 5}
              max={100}
              disabled={!canEdit}
              value={thresholds.autoApproveMinScore}
              onChange={(e) =>
                updateThresholds({ autoApproveMinScore: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Tope Fast-Track DOP
            </label>
            <input
              type="number"
              step={5000}
              disabled={!canEdit}
              value={thresholds.maxAutoApproveAmountDop}
              onChange={(e) =>
                updateThresholds({ maxAutoApproveAmountDop: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Tope Fast-Track USD
            </label>
            <input
              type="number"
              step={100}
              disabled={!canEdit}
              value={thresholds.maxAutoApproveAmountUsd}
              onChange={(e) =>
                updateThresholds({ maxAutoApproveAmountUsd: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              DTI Proyectado Máx (%)
            </label>
            <input
              type="number"
              min={10}
              max={75}
              disabled={!canEdit}
              value={thresholds.maxAutoDtiPct}
              onChange={(e) =>
                updateThresholds({ maxAutoDtiPct: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              Cobertura Mínima (x)
            </label>
            <input
              type="number"
              step="0.05"
              min={1}
              max={3}
              disabled={!canEdit}
              value={thresholds.minCoverageRatio ?? capacityMinCoverage}
              onChange={(e) =>
                updateThresholds({ minCoverageRatio: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs tabular-nums"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={thresholds.enableFastTrackAutoApproval}
              onChange={(e) =>
                updateThresholds({ enableFastTrackAutoApproval: e.target.checked })
              }
            />
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Habilitar ruta Fast-Track (omite etapas opcionales cuando Score ≥ {thresholds.autoApproveMinScore})
            </span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={thresholds.syncCriticalBandWithAutoReject}
              onChange={(e) =>
                updateThresholds({ syncCriticalBandWithAutoReject: e.target.checked })
              }
            />
            <span className="text-slate-600 dark:text-slate-400">
              Sincronizar banda Crítico con umbral de rechazo automático
            </span>
          </label>
        </div>
      </div>

      {/* Part 2: Palette + Drag-and-Drop Stage Pipeline Canvas */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Palette: Reusable Stage Blocks */}
        <div className="xl:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3.5 space-y-2.5">
          <div>
            <h5 className="text-xs font-bold text-slate-900 dark:text-white">
              Catálogo de Etapas ({WORKFLOW_STAGE_PALETTE.length})
            </h5>
            <p className="text-[11px] text-slate-500">
              Arrastra una etapa hacia el flujo o presiona + para añadirla.
            </p>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {WORKFLOW_STAGE_PALETTE.map((tpl) => (
              <div
                key={tpl.code}
                draggable={canEdit && stages.length < 12}
                onDragStart={(e) => handlePaletteDragStart(e, tpl.code)}
                onDragEnd={resetDragState}
                className={`p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-start justify-between gap-2 ${
                  canEdit && stages.length < 12
                    ? 'cursor-grab active:cursor-grabbing hover:border-sky-400 dark:hover:border-sky-600'
                    : 'opacity-65'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {tpl.name}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 pl-5 truncate">
                    {ROLE_LABELS[tpl.defaultRole]} · SLA {tpl.defaultSlaHours}h
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    disabled={stages.length >= 12}
                    onClick={() => {
                      const insertPos = Math.max(0, stages.length - 1);
                      const next = insertWorkflowStageAt(stages, tpl.code, insertPos);
                      updateStages(next);
                      const added = next[insertPos];
                      if (added) setSelectedStageId(added.id);
                    }}
                    title="Agregar al flujo"
                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-sky-700 dark:text-sky-300 shrink-0 cursor-pointer disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Canvas: Connected Drag-and-Drop Pipeline */}
        <div className="xl:col-span-9 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                Secuencia Visual de Aprobación ({stages.filter((s) => s.enabled).length} activas de {stages.length})
              </h5>
              <p className="text-[11px] text-slate-500">
                Haz clic en cualquier nodo para editar su rol RBAC, regla de activación o SLA. Arrastra para cambiar el orden.
              </p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              Máx. 12 etapas
            </span>
          </div>

          <div className="flex flex-wrap items-stretch gap-y-3 gap-x-1.5 py-2">
            {stages.map((stage, idx) => {
              const isSelected = selectedStage?.id === stage.id;
              const isDragging = dragStageIdx === idx;
              const isDropTarget = dropTargetIdx === idx;

              return (
                <React.Fragment key={stage.id}>
                  <div
                    draggable={canEdit}
                    onDragStart={(e) => handleStageDragStart(e, idx)}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      setDropTargetIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (dropTargetIdx === idx) setDropTargetIdx(null);
                    }}
                    onDrop={(e) => handleDropOnSlot(e, idx)}
                    onDragEnd={resetDragState}
                    onClick={() => setSelectedStageId(stage.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedStageId(stage.id);
                      }
                    }}
                    className={`group relative w-52 rounded-xl border p-3 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isDropTarget
                        ? 'border-sky-500 ring-2 ring-sky-500/40 bg-sky-50/70 dark:bg-sky-950/40'
                        : isSelected
                        ? 'border-sky-600 bg-sky-50/50 dark:bg-sky-950/25 shadow-sm'
                        : stage.enabled
                        ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        : 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 opacity-60'
                    } ${isDragging ? 'opacity-40 scale-[0.98]' : ''}`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {canEdit && (
                            <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0 cursor-grab" />
                          )}
                          <span className="font-mono text-[11px] font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate">
                            {stage.required ? 'Troncal' : 'Configurable'}
                          </span>
                        </div>

                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSingleStage(stage.id, { enabled: !stage.enabled });
                          }}
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer disabled:cursor-not-allowed ${
                            stage.enabled
                              ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                              : 'text-slate-500 bg-slate-200/70 dark:bg-slate-800'
                          }`}
                        >
                          {stage.enabled ? 'Activa' : 'Omitida'}
                        </button>
                      </div>

                      <p className="text-xs font-bold text-slate-900 dark:text-white leading-snug line-clamp-2">
                        {stage.name}
                      </p>

                      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
                        {ROLE_LABELS[stage.ownerRole]}
                      </p>
                    </div>

                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1 text-[10px] text-slate-500">
                      <span className="truncate">{formatGateLabel(stage)}</span>
                      <span className="inline-flex items-center gap-0.5 font-mono tabular-nums shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {stage.slaHours}h
                      </span>
                    </div>

                    {/* Accessible quick move arrows */}
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1 pt-1.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStages(reorderWorkflowStages(stages, idx, idx - 1));
                          }}
                          aria-label={`Mover ${stage.name} antes`}
                          className="p-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === stages.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStages(reorderWorkflowStages(stages, idx, idx + 1));
                          }}
                          aria-label={`Mover ${stage.name} después`}
                          className="p-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {idx < stages.length - 1 && (
                    <div className="flex items-center justify-center px-0.5 text-slate-400 dark:text-slate-600">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* End-of-Pipeline Drop Zone */}
            {canEdit && stages.length < 12 && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTargetIdx(stages.length);
                }}
                onDragLeave={() => {
                  if (dropTargetIdx === stages.length) setDropTargetIdx(null);
                }}
                onDrop={(e) => handleDropOnSlot(e, stages.length)}
                className={`w-36 min-h-[116px] rounded-xl border border-dashed flex flex-col items-center justify-center p-3 text-center text-[11px] transition-colors ${
                  dropTargetIdx === stages.length
                    ? 'border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300'
                    : 'border-slate-300 dark:border-slate-700 text-slate-400'
                }`}
              >
                <Plus className="w-4 h-4 mb-1" />
                <span>Suelta aquí para añadir al final</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Part 3: Selected Stage Inspector & Live Route Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Stage Inspector */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-sky-600" />
              Inspector de Etapa Seleccionada
            </h5>
            {canEdit && selectedStage && !selectedStage.required && (
              <button
                type="button"
                onClick={() => {
                  const next = stages.filter((s) => s.id !== selectedStage.id);
                  updateStages(next);
                  setSelectedStageId(next[0]?.id ?? '');
                }}
                className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar etapa
              </button>
            )}
          </div>

          {selectedStage ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Nombre de la Etapa
                  </label>
                  <input
                    disabled={!canEdit}
                    value={selectedStage.name}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, { name: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Rol Responsable (RBAC)
                  </label>
                  <select
                    disabled={!canEdit}
                    value={selectedStage.ownerRole}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, {
                        ownerRole: e.target.value as UserRole,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  Descripción / Alcance del Control
                </label>
                <input
                  disabled={!canEdit}
                  value={selectedStage.description}
                  onChange={(e) =>
                    updateSingleStage(selectedStage.id, { description: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Condición de Activación
                  </label>
                  <select
                    disabled={!canEdit}
                    value={selectedStage.gateType}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, {
                        gateType: e.target.value as WorkflowStageGateType,
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    {Object.entries(GATE_TYPE_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedStage.gateType === 'ABOVE_AMOUNT' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Umbral Monto (DOP)
                    </label>
                    <input
                      type="number"
                      step={10000}
                      disabled={!canEdit}
                      value={selectedStage.gateAmountDop ?? 250000}
                      onChange={(e) =>
                        updateSingleStage(selectedStage.id, {
                          gateAmountDop: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
                    />
                  </div>
                )}

                {selectedStage.gateType === 'SCORE_BELOW' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Score Máx. Activación
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!canEdit}
                      value={selectedStage.gateMaxScore ?? 75}
                      onChange={(e) =>
                        updateSingleStage(selectedStage.id, {
                          gateMaxScore: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
                    />
                  </div>
                )}

                {selectedStage.gateType === 'RISK_BAND_BELOW' && (
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Desde Banda de Riesgo
                    </label>
                    <select
                      disabled={!canEdit}
                      value={selectedStage.gateMinRiskBand ?? 'MODERADO'}
                      onChange={(e) =>
                        updateSingleStage(selectedStage.id, {
                          gateMinRiskBand: e.target.value as RiskBandCode,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      {RISK_BAND_OPTIONS.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    SLA Objetivo (Horas)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    disabled={!canEdit}
                    value={selectedStage.slaHours}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, {
                        slaHours: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canEdit || selectedStage.required}
                    checked={selectedStage.autoSkipOnFastTrack}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, {
                        autoSkipOnFastTrack: e.target.checked,
                      })
                    }
                  />
                  <span>Omitir automáticamente en Fast-Track</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={selectedStage.enabled}
                    onChange={(e) =>
                      updateSingleStage(selectedStage.id, {
                        enabled: e.target.checked,
                      })
                    }
                  />
                  <span>Etapa habilitada en esta versión</span>
                </label>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Selecciona una etapa en el flujo visual para ver sus propiedades.
            </p>
          )}
        </div>

        {/* Live Decision & Route Simulator */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Play className="w-4 h-4 text-sky-600" />
              Simulador de Ruta y Umbrales en Tiempo Real
            </h5>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              SLA Total: {simulation.estimatedTotalSlaHours}h
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Score V2 (0–100)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={simScore}
                onChange={(e) =>
                  setSimScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Monto Solicitado</label>
              <input
                type="number"
                min={0}
                step={10000}
                value={simAmount}
                onChange={(e) => setSimAmount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Moneda</label>
              <select
                value={simCurrency}
                onChange={(e) => setSimCurrency(e.target.value as CurrencyCode)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">DTI Proy. (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={simDtiPct}
                onChange={(e) =>
                  setSimDtiPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono tabular-nums"
              />
            </div>
          </div>

          <div
            className={`p-3 rounded-lg border text-xs space-y-1 ${
              simulation.decisionRoute === 'PREOFERTA_FAST_TRACK'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : simulation.decisionRoute === 'RECHAZO_AUTOMATICO'
                ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                : 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {simulation.decisionRoute === 'PREOFERTA_FAST_TRACK' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : simulation.decisionRoute === 'RECHAZO_AUTOMATICO' ? (
                <XCircle className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{simulation.headline}</span>
            </div>
            <p className="opacity-90">{simulation.reason}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Etapas que se Ejecutan ({simulation.activeStages.length})
              </p>
              <ul className="space-y-1 max-h-32 overflow-y-auto">
                {simulation.activeStages.map(({ stage, triggerNote }, idx) => (
                  <li
                    key={stage.id}
                    className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300"
                  >
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    <div>
                      <span className="font-medium">{stage.name}</span>
                      <span className="block text-[10px] text-slate-500">{triggerNote}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-semibold text-slate-500 mb-1">
                Etapas Omitidas ({simulation.skippedStages.length})
              </p>
              {simulation.skippedStages.length === 0 ? (
                <p className="text-slate-400">Ninguna etapa omitida para este caso.</p>
              ) : (
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {simulation.skippedStages.map(({ stage, skipReason }) => (
                    <li key={stage.id} className="text-slate-500">
                      <span className="line-through font-medium">{stage.name}</span>
                      <span className="block text-[10px] text-slate-400">{skipReason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
