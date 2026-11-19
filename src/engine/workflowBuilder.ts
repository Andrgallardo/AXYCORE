import type {
  AutoDecisionThresholdsConfig,
  CurrencyCode,
  PolicyWorkflowConfig,
  RiskBandCode,
  RiskBandConfig,
  UserRole,
  WorkflowStageCode,
  WorkflowStageConfig,
  WorkflowStageGateType,
} from '../types/axycore';

export interface WorkflowStagePaletteItem {
  code: WorkflowStageCode;
  name: string;
  description: string;
  defaultRole: UserRole;
  defaultSlaHours: number;
  defaultGateType: WorkflowStageGateType;
  defaultGateAmountDop?: number;
  defaultGateMaxScore?: number;
  defaultAutoSkipOnFastTrack: boolean;
  required: boolean;
}

export const WORKFLOW_STAGE_PALETTE: WorkflowStagePaletteItem[] = [
  {
    code: 'PRECALIFICACION_V2',
    name: 'Precalificación Motor V2',
    description: 'Ejecución automática de los 22 indicadores, capacidad de pago y estrés cambiario.',
    defaultRole: 'BUSINESS_OFFICER',
    defaultSlaHours: 1,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: false,
    required: true,
  },
  {
    code: 'VERIFICACION_BIOMETRIA_OCR',
    name: 'Validación Biométrica y OCR',
    description: 'Cotejo facial en vivo contra documento de identidad y auditoría OCR de ingresos.',
    defaultRole: 'CREDIT_ANALYST',
    defaultSlaHours: 4,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: false,
    required: false,
  },
  {
    code: 'ANALISIS_CREDITO',
    name: 'Análisis Técnico de Crédito',
    description: 'Depuración de ingresos verificados, obligaciones y recálculo determinístico V2.',
    defaultRole: 'CREDIT_ANALYST',
    defaultSlaHours: 12,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: true,
    required: false,
  },
  {
    code: 'PARECER_RIESGO',
    name: 'Parecer Independiente de Riesgo',
    description: 'Control de segunda línea por Oficial de Riesgo para montos elevados o bandas moderadas/altas.',
    defaultRole: 'RISK_OFFICER',
    defaultSlaHours: 12,
    defaultGateType: 'ABOVE_AMOUNT',
    defaultGateAmountDop: 250000,
    defaultAutoSkipOnFastTrack: true,
    required: false,
  },
  {
    code: 'INSPECCION_GARANTIAS',
    name: 'Inspección y Tasación de Garantías',
    description: 'Validación física/registral de garantías propuestas o prendas vehiculares/hipotecarias.',
    defaultRole: 'RISK_OFFICER',
    defaultSlaHours: 24,
    defaultGateType: 'ABOVE_AMOUNT',
    defaultGateAmountDop: 400000,
    defaultAutoSkipOnFastTrack: true,
    required: false,
  },
  {
    code: 'COMITE_CREDITO',
    name: 'Decisión de Comité de Crédito',
    description: 'Aprobación unipersonal o colegiada según matriz de facultades configurada.',
    defaultRole: 'COMMITTEE_MEMBER',
    defaultSlaHours: 24,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: true,
    required: false,
  },
  {
    code: 'FORMALIZACION_LEGAL',
    name: 'Formalización y Pagaré',
    description: 'Emisión de contrato, pagaré notarial, tabla de amortización y verificación de firmas.',
    defaultRole: 'FORMALIZATION',
    defaultSlaHours: 16,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: false,
    required: true,
  },
  {
    code: 'DESEMBOLSO_OPERACIONES',
    name: 'Desembolso y Tesorería',
    description: 'Liquidación idempotente de fondos y activación de cartera crediticia.',
    defaultRole: 'OPERATIONS',
    defaultSlaHours: 8,
    defaultGateType: 'ALWAYS',
    defaultAutoSkipOnFastTrack: false,
    required: true,
  },
];

export const DEFAULT_AUTO_DECISION_THRESHOLDS: AutoDecisionThresholdsConfig = {
  autoApproveMinScore: 90,
  committeeReviewMinScore: 50,
  autoRejectMaxScore: 49,
  enableFastTrackAutoApproval: false,
  maxAutoApproveAmountDop: 150000,
  maxAutoApproveAmountUsd: 2500,
  requireRiskSignOffOverAmountDop: 250000,
  requireCollegialCommitteeOverAmountDop: 500000,
  maxAutoDtiPct: 35,
  minCoverageRatio: 1.25,
  syncCriticalBandWithAutoReject: true,
};

export const DEFAULT_WORKFLOW_STAGES: WorkflowStageConfig[] = [
  {
    id: 'stage_precalificacion_v2',
    code: 'PRECALIFICACION_V2',
    name: 'Precalificación Motor V2',
    description: 'Cálculo de 22 indicadores, capacidad neta, DTI y estrés cambiario.',
    ownerRole: 'BUSINESS_OFFICER',
    enabled: true,
    required: true,
    autoSkipOnFastTrack: false,
    gateType: 'ALWAYS',
    slaHours: 1,
    lockedOrder: true,
  },
  {
    id: 'stage_biometria_ocr',
    code: 'VERIFICACION_BIOMETRIA_OCR',
    name: 'Validación Biométrica y OCR',
    description: 'Cotejo facial biométrico y validación documental automatizada con Gemini.',
    ownerRole: 'CREDIT_ANALYST',
    enabled: true,
    required: false,
    autoSkipOnFastTrack: false,
    gateType: 'ALWAYS',
    slaHours: 4,
  },
  {
    id: 'stage_analisis_credito',
    code: 'ANALISIS_CREDITO',
    name: 'Análisis Técnico de Crédito',
    description: 'Depuración financiera, verificación de referencias y recálculo V2.',
    ownerRole: 'CREDIT_ANALYST',
    enabled: true,
    required: false,
    autoSkipOnFastTrack: true,
    gateType: 'ALWAYS',
    slaHours: 12,
  },
  {
    id: 'stage_parecer_riesgo',
    code: 'PARECER_RIESGO',
    name: 'Parecer de Riesgo',
    description: 'Revisión independiente de segunda línea para operaciones relevantes o de riesgo moderado/alto.',
    ownerRole: 'RISK_OFFICER',
    enabled: true,
    required: false,
    autoSkipOnFastTrack: true,
    gateType: 'ABOVE_AMOUNT',
    gateAmountDop: 250000,
    slaHours: 12,
  },
  {
    id: 'stage_comite_credito',
    code: 'COMITE_CREDITO',
    name: 'Comité de Crédito',
    description: 'Resolución definitiva inmutable con segregación de funciones.',
    ownerRole: 'COMMITTEE_MEMBER',
    enabled: true,
    required: false,
    autoSkipOnFastTrack: true,
    gateType: 'ALWAYS',
    slaHours: 24,
  },
  {
    id: 'stage_formalizacion',
    code: 'FORMALIZACION_LEGAL',
    name: 'Formalización Contractual',
    description: 'Generación de contrato, pagaré, checklist documental y registro de firmas.',
    ownerRole: 'FORMALIZATION',
    enabled: true,
    required: true,
    autoSkipOnFastTrack: false,
    gateType: 'ALWAYS',
    slaHours: 16,
  },
  {
    id: 'stage_desembolso',
    code: 'DESEMBOLSO_OPERACIONES',
    name: 'Desembolso y Activación',
    description: 'Entrega de fondos idempotente y generación de tabla de amortización.',
    ownerRole: 'OPERATIONS',
    enabled: true,
    required: true,
    autoSkipOnFastTrack: false,
    gateType: 'ALWAYS',
    slaHours: 8,
    lockedOrder: true,
  },
];

export const DEFAULT_WORKFLOW_CONFIG: PolicyWorkflowConfig = {
  stages: DEFAULT_WORKFLOW_STAGES,
  decisionThresholds: DEFAULT_AUTO_DECISION_THRESHOLDS,
};

export const GATE_TYPE_LABELS: Record<WorkflowStageGateType, string> = {
  ALWAYS: 'Siempre obligatoria',
  ABOVE_AMOUNT: 'Monto > umbral DOP',
  SCORE_BELOW: 'Score V2 ≤ umbral',
  RISK_BAND_BELOW: 'Banda de riesgo ≥ severidad',
};

const RISK_SEVERITY_ORDER: Record<RiskBandCode, number> = {
  MUY_BAJO: 1,
  BAJO: 2,
  MODERADO: 3,
  MEDIO_ALTO: 4,
  ALTO: 5,
  CRITICO: 6,
};

export function normalizeWorkflowThresholds(
  raw: Partial<AutoDecisionThresholdsConfig> | null | undefined
): AutoDecisionThresholdsConfig {
  const base = { ...DEFAULT_AUTO_DECISION_THRESHOLDS, ...(raw ?? {}) };

  const autoRejectMaxScore = Math.max(
    10,
    Math.min(75, Math.round(Number(base.autoRejectMaxScore) || 49))
  );
  const committeeReviewMinScore = autoRejectMaxScore + 1;

  const rawAutoApprove = Math.round(Number(base.autoApproveMinScore) || 90);
  const autoApproveMinScore = Math.max(
    committeeReviewMinScore + 5,
    Math.min(100, rawAutoApprove)
  );

  return {
    ...base,
    autoRejectMaxScore,
    committeeReviewMinScore,
    autoApproveMinScore,
    enableFastTrackAutoApproval: Boolean(base.enableFastTrackAutoApproval),
    maxAutoApproveAmountDop: Math.max(1000, Number(base.maxAutoApproveAmountDop) || 150000),
    maxAutoApproveAmountUsd: Math.max(100, Number(base.maxAutoApproveAmountUsd) || 2500),
    requireRiskSignOffOverAmountDop: Math.max(
      0,
      Number(base.requireRiskSignOffOverAmountDop) || 250000
    ),
    requireCollegialCommitteeOverAmountDop: Math.max(
      0,
      Number(base.requireCollegialCommitteeOverAmountDop) || 500000
    ),
    maxAutoDtiPct: Math.max(10, Math.min(75, Number(base.maxAutoDtiPct) || 35)),
    minCoverageRatio: Math.max(1.0, Math.min(3.0, Number(base.minCoverageRatio) || 1.25)),
    syncCriticalBandWithAutoReject:
      base.syncCriticalBandWithAutoReject !== undefined
        ? Boolean(base.syncCriticalBandWithAutoReject)
        : true,
  };
}

export function cloneWorkflowConfig(
  raw?: Partial<PolicyWorkflowConfig> | null
): PolicyWorkflowConfig {
  const stages =
    Array.isArray(raw?.stages) && raw.stages.length > 0
      ? raw.stages.map((s) => ({ ...s })).slice(0, 12)
      : DEFAULT_WORKFLOW_STAGES.map((s) => ({ ...s }));

  return {
    stages,
    decisionThresholds: normalizeWorkflowThresholds(raw?.decisionThresholds),
    updatedAtIso: raw?.updatedAtIso,
  };
}

export function reorderWorkflowStages(
  stages: WorkflowStageConfig[],
  fromIndex: number,
  toIndex: number
): WorkflowStageConfig[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= stages.length ||
    toIndex >= stages.length ||
    fromIndex === toIndex
  ) {
    return stages;
  }

  const next = [...stages];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function insertWorkflowStageAt(
  stages: WorkflowStageConfig[],
  templateCode: WorkflowStageCode,
  targetIndex?: number
): WorkflowStageConfig[] {
  if (stages.length >= 12) return stages;
  const tpl = WORKFLOW_STAGE_PALETTE.find((p) => p.code === templateCode);
  const newStage: WorkflowStageConfig = tpl
    ? {
        id: `stage_${tpl.code.toLowerCase()}_${Date.now().toString(36).slice(-4)}`,
        code: tpl.code,
        name: tpl.name,
        description: tpl.description,
        ownerRole: tpl.defaultRole,
        enabled: true,
        required: tpl.required,
        autoSkipOnFastTrack: tpl.defaultAutoSkipOnFastTrack,
        gateType: tpl.defaultGateType,
        gateAmountDop: tpl.defaultGateAmountDop ?? null,
        gateMaxScore: tpl.defaultGateMaxScore ?? null,
        slaHours: tpl.defaultSlaHours,
      }
    : {
        id: `stage_custom_${Date.now().toString(36).slice(-4)}`,
        code: 'ETAPA_PERSONALIZADA',
        name: 'Etapa de Revisión Personalizada',
        description: 'Punto de control adicional configurable dentro del flujo crediticio.',
        ownerRole: 'CREDIT_ANALYST',
        enabled: true,
        required: false,
        autoSkipOnFastTrack: true,
        gateType: 'ALWAYS',
        slaHours: 8,
      };

  const next = [...stages];
  const idx =
    typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= next.length
      ? targetIndex
      : Math.max(0, next.length - 1);
  next.splice(idx, 0, newStage);
  return next;
}

export function syncRiskBandsWithAutoRejectThreshold(
  bands: RiskBandConfig[],
  autoRejectMaxScore: number
): RiskBandConfig[] {
  const safeRejectMax = Math.max(10, Math.min(58, Math.round(autoRejectMaxScore)));
  return bands.map((b) => {
    if (b.code === 'CRITICO') {
      return { ...b, minScore: 0, maxScore: safeRejectMax };
    }
    if (b.code === 'ALTO') {
      const nextMin = safeRejectMax + 1;
      return { ...b, minScore: nextMin, maxScore: Math.max(nextMin, b.maxScore) };
    }
    return b;
  });
}

export interface WorkflowSimulationResult {
  decisionRoute: 'RECHAZO_AUTOMATICO' | 'PREOFERTA_FAST_TRACK' | 'EVALUACION_ESTANDAR';
  headline: string;
  reason: string;
  activeStages: Array<{ stage: WorkflowStageConfig; triggerNote: string }>;
  skippedStages: Array<{ stage: WorkflowStageConfig; skipReason: string }>;
  estimatedTotalSlaHours: number;
}

export function simulateWorkflowRoute(params: {
  workflowConfig: PolicyWorkflowConfig;
  score: number;
  amount: number;
  currency: CurrencyCode;
  dopPerUsd: number;
  projectedDtiPct: number;
  riskBandCode?: RiskBandCode;
  stressFailed?: boolean;
}): WorkflowSimulationResult {
  const {
    workflowConfig,
    score,
    amount,
    currency,
    dopPerUsd,
    projectedDtiPct,
    stressFailed = false,
  } = params;

  const thresholds = normalizeWorkflowThresholds(workflowConfig.decisionThresholds);
  const amountDop = currency === 'USD' ? amount * Math.max(dopPerUsd || 60, 1) : amount;

  const inferredBand: RiskBandCode =
    params.riskBandCode ??
    (score >= 90
      ? 'MUY_BAJO'
      : score >= 80
      ? 'BAJO'
      : score >= 70
      ? 'MODERADO'
      : score >= 60
      ? 'MEDIO_ALTO'
      : score > thresholds.autoRejectMaxScore
      ? 'ALTO'
      : 'CRITICO');

  const isAutoRejected = score <= thresholds.autoRejectMaxScore || (currency === 'USD' && stressFailed);

  const withinFastTrackAmount =
    currency === 'USD'
      ? amount <= thresholds.maxAutoApproveAmountUsd
      : amount <= thresholds.maxAutoApproveAmountDop;

  const isFastTrack =
    !isAutoRejected &&
    thresholds.enableFastTrackAutoApproval &&
    score >= thresholds.autoApproveMinScore &&
    withinFastTrackAmount &&
    projectedDtiPct <= thresholds.maxAutoDtiPct;

  const activeStages: WorkflowSimulationResult['activeStages'] = [];
  const skippedStages: WorkflowSimulationResult['skippedStages'] = [];

  for (const stage of workflowConfig.stages) {
    if (!stage.enabled) {
      skippedStages.push({ stage, skipReason: 'Etapa desactivada en esta política.' });
      continue;
    }

    if (isAutoRejected && stage.code !== 'PRECALIFICACION_V2') {
      skippedStages.push({
        stage,
        skipReason: 'Detenido por rechazo automático (Sin Oferta).',
      });
      continue;
    }

    if (isFastTrack && stage.autoSkipOnFastTrack && !stage.required) {
      skippedStages.push({
        stage,
        skipReason: 'Omitida automáticamente por ruta Fast-Track.',
      });
      continue;
    }

    // Evaluate stage gate conditions
    if (stage.gateType === 'ABOVE_AMOUNT') {
      const gateDop = stage.gateAmountDop ?? thresholds.requireRiskSignOffOverAmountDop;
      if (amountDop <= gateDop) {
        skippedStages.push({
          stage,
          skipReason: `Monto equiv. (${Math.round(amountDop).toLocaleString('en-US')} DOP) ≤ umbral (${gateDop.toLocaleString('en-US')} DOP).`,
        });
        continue;
      }
      activeStages.push({
        stage,
        triggerNote: `Activada por monto > ${gateDop.toLocaleString('en-US')} DOP`,
      });
      continue;
    }

    if (stage.gateType === 'SCORE_BELOW') {
      const maxScore = stage.gateMaxScore ?? 75;
      if (score > maxScore) {
        skippedStages.push({
          stage,
          skipReason: `Score (${score}) supera el umbral de revisión (${maxScore}).`,
        });
        continue;
      }
      activeStages.push({
        stage,
        triggerNote: `Activada por Score ${score} ≤ ${maxScore}`,
      });
      continue;
    }

    if (stage.gateType === 'RISK_BAND_BELOW') {
      const minSevBand = stage.gateMinRiskBand ?? 'MODERADO';
      if (RISK_SEVERITY_ORDER[inferredBand] < RISK_SEVERITY_ORDER[minSevBand]) {
        skippedStages.push({
          stage,
          skipReason: `Banda ${inferredBand} con menor severidad que ${minSevBand}.`,
        });
        continue;
      }
      activeStages.push({
        stage,
        triggerNote: `Activada por banda de riesgo ${inferredBand}`,
      });
      continue;
    }

    activeStages.push({
      stage,
      triggerNote: stage.required ? 'Etapa troncal obligatoria' : 'Etapa estándar activa',
    });
  }

  const estimatedTotalSlaHours = activeStages.reduce((acc, s) => acc + (s.stage.slaHours || 0), 0);

  if (isAutoRejected) {
    return {
      decisionRoute: 'RECHAZO_AUTOMATICO',
      headline: 'Rechazo Automático / Sin Oferta (Motor V2)',
      reason:
        currency === 'USD' && stressFailed
          ? 'Falla en prueba de estrés cambiario USD.'
          : `Score ${score}/100 dentro de zona de rechazo automático (0–${thresholds.autoRejectMaxScore} pts).`,
      activeStages,
      skippedStages,
      estimatedTotalSlaHours,
    };
  }

  if (isFastTrack) {
    return {
      decisionRoute: 'PREOFERTA_FAST_TRACK',
      headline: 'Pre-Aprobación Directa / Fast-Track',
      reason: `Score ${score}/100 ≥ ${thresholds.autoApproveMinScore}, DTI ${projectedDtiPct}% ≤ ${thresholds.maxAutoDtiPct}% y monto dentro del límite automático.`,
      activeStages,
      skippedStages,
      estimatedTotalSlaHours,
    };
  }

  return {
    decisionRoute: 'EVALUACION_ESTANDAR',
    headline: 'Flujo de Evaluación Crediticia y Comité',
    reason: `Score ${score}/100 requiere recorrido por las etapas operativas configuradas (${activeStages.length} etapas activas).`,
    activeStages,
    skippedStages,
    estimatedTotalSlaHours,
  };
}
