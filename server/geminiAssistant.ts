import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  DirectorAnalysisResponse,
  DirectorFocusMode,
  DirectorHealthStatus,
  DirectorPriorityRisk,
  DirectorStrategicOpportunity,
  NavSectionId,
} from '../src/types/axycore';

const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const ATTEMPT_TIMEOUT_MS = 26_000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el servidor. Configúrala en Settings > Secrets para habilitar AxyCore Director y Bela.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Simple per-user sliding window rate limiter to prevent abuse
const aiRateLimitMap = new Map<string, number[]>();
const AI_RATE_LIMIT_MAX = 30;
const AI_RATE_LIMIT_WINDOW_MS = 60_000;

export function assertAiRateLimit(actorKey: string): void {
  const now = Date.now();
  const prev = (aiRateLimitMap.get(actorKey) || []).filter(
    (ts) => now - ts < AI_RATE_LIMIT_WINDOW_MS
  );
  if (prev.length >= AI_RATE_LIMIT_MAX) {
    throw new Error(
      'Límite temporal de consultas de inteligencia alcanzado. Intenta nuevamente en un minuto.'
    );
  }
  prev.push(now);
  aiRateLimitMap.set(actorKey, prev);
}

const VALID_NAV_SECTIONS: NavSectionId[] = [
  'dashboard',
  'system_guide',
  'credit_dashboard',
  'intelligence_dashboard',
  'director',
  'bela',
  'new_application',
  'loan_calculator',
  'applications',
  'decision_engine',
  'evaluation',
  'committee',
  'formalization',
  'disbursements',
  'loans',
  'customers',
  'customers_active',
  'customers_inactive',
  'customers_update',
  'documents',
  'reports',
  'policies',
  'audit',
  'admin_users',
  'admin_roles',
  'admin_settings',
  'admin_risk_bands',
  'admin_product_limits',
  'admin_approval_matrix',
  'admin_workflow',
  'intelligence_altera',
  'intelligence_impulsa',
  'regula',
  'system_sitemap',
  'cobranza_dashboard',
  'cobranza_anticipate',
  'cobranza_portfolio',
  'cobranza_daily',
  'cobranza_urgent',
  'cobranza_legal',
  'cobranza_discounts',
  'cobranza_discounts_mora',
  'cobranza_discounts_payoff',
  'cobranza_my_actions',
  'cobranza_actions',
  'cobranza_agreements_today',
  'cobranza_agreements_broken',
  'cobranza_promises',
  'cobranza_agenda',
  'cobranza_payments',
  'cobranza_reconciliation',
  'cobranza_unidentified',
  'cobranza_contact_center',
  'cobranza_bot',
  'cobranza_sentinel',
  'cobranza_assignment',
  'cobranza_reports',
  'cobranza_params',
  'cobranza_audit',
  'accounting',
  'accounting_chart_of_accounts',
  'accounting_journal_entries',
  'accounting_daily_book',
  'accounting_general_ledger',
  'accounting_receivables',
  'accounting_payables',
  'accounting_taxes',
  'accounting_payment_validation',
  'accounting_statements',
];

export function sanitizeTargetSection(raw: unknown): NavSectionId | undefined {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim() as NavSectionId;
  return VALID_NAV_SECTIONS.includes(normalized) ? normalized : undefined;
}

const VALID_FOCUS_MODES: DirectorFocusMode[] = [
  'INTEGRAL',
  'RIESGO_MORA',
  'ORIGINACION',
  'COBRANZA_FLUJO',
  'ESCENARIOS_STRESS',
];

export function sanitizeFocusMode(raw: unknown): DirectorFocusMode {
  if (typeof raw === 'string' && VALID_FOCUS_MODES.includes(raw as DirectorFocusMode)) {
    return raw as DirectorFocusMode;
  }
  return 'INTEGRAL';
}

const FOCUS_MODE_DIRECTIVES: Record<DirectorFocusMode, string> = {
  INTEGRAL:
    'Modo DIAGNÓSTICO INTEGRAL (CEO / Junta Directiva): evalúa de manera equilibrada la cartera activa (DOP y USD por separado o con tasa BCRD), desembolsos del período, recuperación aplicada, morosidad PAR, embudo de solicitudes y alertas Centinela.',
  RIESGO_MORA:
    'Modo AUDITORÍA DE MOROSIDAD Y RIESGO PAR: profundiza en tramos PAR 1/30/60/90, top cuentas en mora, concentración de saldo por cliente, promesas incumplidas y alertas Centinela activas, priorizando contención y escalamiento a gestión urgente o legal.',
  ORIGINACION:
    'Modo EMBUDO DE ORIGINACIÓN Y CRÉDITO: analiza la distribución del embudo de solicitudes, tasa de aprobación con su denominador real, cuellos de botella en Evaluación, Comité y Formalización, tickets promedio y calidad del flujo comercial.',
  COBRANZA_FLUJO:
    'Modo COBRANZA, LIQUIDEZ Y PRODUCTIVIDAD: examina la recuperación aplicada (desglosando capital e intereses), cobros exigibles vs. confirmados hoy, pagos pendientes de validación, excepciones de conciliación y desempeño por gestor.',
  ESCENARIOS_STRESS:
    'Modo ESCENARIOS Y STRESS-TEST EJECUTIVO: a partir exclusivamente de las cifras reales actuales en el JSON, plantea escenarios prudentes de sensibilidad (ej. contención de cuentas vencidas prioritarias, impacto de promesas incumplidas y metas realistas de recuperación), dejando claro siempre cuáles cifras son datos verificados y cuáles son hipótesis analíticas.',
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('El servicio de inteligencia excedió el tiempo máximo de respuesta.'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Error desconocido en el servicio de inteligencia.';
  }
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = extractRawErrorMessage(err).toUpperCase();
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('OVERLOADED') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('504') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('TIEMPO MÁXIMO') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

export function normalizeGeminiError(err: unknown): { status: number; message: string } {
  const raw = extractRawErrorMessage(err);
  const upper = raw.toUpperCase();

  if (raw.includes('GEMINI_API_KEY no está configurada')) {
    return { status: 503, message: raw };
  }
  if (raw.includes('Límite temporal')) {
    return { status: 429, message: raw };
  }
  if (
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('403') ||
    upper.includes('INVALID API KEY')
  ) {
    return {
      status: 403,
      message:
        'La clave API de Gemini fue rechazada o no tiene permisos activos. Verifica la configuración en Settings > Secrets.',
    };
  }
  if (upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429')) {
    return {
      status: 429,
      message:
        'Se alcanzó temporalmente la cuota de solicitudes de Gemini. Espera unos segundos o verifica tu clave en Settings > Secrets.',
    };
  }
  if (
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return {
      status: 503,
      message:
        'El motor de inteligencia Gemini está experimentando alta demanda temporal. Intenta nuevamente en unos segundos.',
    };
  }
  if (upper.includes('TIEMPO MÁXIMO') || upper.includes('504') || upper.includes('DEADLINE_EXCEEDED')) {
    return {
      status: 504,
      message:
        'El análisis ejecutivo excedió el tiempo de espera. Intenta de nuevo o selecciona un enfoque más específico.',
    };
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404')) {
    return {
      status: 502,
      message:
        'El modelo de inteligencia solicitado no está disponible en este momento. Contacta soporte técnico.',
    };
  }

  return {
    status: 502,
    message: 'No fue posible completar el análisis con el motor de inteligencia. Intenta nuevamente.',
  };
}

function parseStructuredJson<T>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned || '{}') as T;
}

function serializeSafeContext(scopedContext: Record<string, unknown>, maxChars: number): string {
  const full = JSON.stringify(scopedContext);
  if (full.length <= maxChars) return full;

  // Compact verbose sample arrays cleanly instead of breaking JSON syntax mid-string
  const compacted: Record<string, unknown> = { ...scopedContext };
  const trimKeys = [
    'actividadReciente',
    'prestamosRecientesMuestra',
    'solicitudesRecientesMuestra',
    'alertasCentinelaDetalle',
    'topConcentracionCartera',
    'topCuentasEnMora',
  ];
  for (const key of trimKeys) {
    if (Array.isArray(compacted[key]) && (compacted[key] as unknown[]).length > 4) {
      compacted[key] = (compacted[key] as unknown[]).slice(0, 4);
    }
    const candidate = JSON.stringify(compacted);
    if (candidate.length <= maxChars) return candidate;
  }

  // Last resort: drop non-essential sample lists while preserving all core metrics
  delete compacted.actividadReciente;
  delete compacted.prestamosRecientesMuestra;
  delete compacted.solicitudesRecientesMuestra;
  const finalStr = JSON.stringify(compacted);
  return finalStr.length <= maxChars ? finalStr : finalStr.slice(0, maxChars);
}

async function generateStructuredWithResilience(params: {
  ai: GoogleGenAI;
  prompt: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
}): Promise<{ text: string; modelUsed: string }> {
  const { ai, prompt, systemInstruction, responseSchema } = params;

  const attemptPlan: Array<{ model: string; delayBeforeMs: number; useThinkingLow: boolean }> = [
    { model: PRIMARY_GEMINI_MODEL, delayBeforeMs: 0, useThinkingLow: true },
    { model: PRIMARY_GEMINI_MODEL, delayBeforeMs: 1000, useThinkingLow: true },
    { model: FALLBACK_GEMINI_MODEL, delayBeforeMs: 350, useThinkingLow: false },
    { model: FALLBACK_GEMINI_MODEL, delayBeforeMs: 1200, useThinkingLow: false },
  ];

  let lastError: unknown = null;

  for (const step of attemptPlan) {
    if (step.delayBeforeMs > 0) {
      await sleep(step.delayBeforeMs + Math.floor(Math.random() * 250));
    }
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: step.model,
          contents: prompt,
          config: {
            systemInstruction,
            ...(step.useThinkingLow ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        ATTEMPT_TIMEOUT_MS
      );
      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error('Respuesta vacía del motor Gemini.');
      }
      return { text: rawText, modelUsed: step.model };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AxyCore AI] Intento fallido en ${step.model}:`,
        extractRawErrorMessage(err).slice(0, 240)
      );
      if (!isRetryableGeminiError(err)) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error('El motor de inteligencia no respondió tras reintentos.');
}

function sanitizeHealthStatus(raw: unknown): DirectorHealthStatus {
  if (raw === 'OPTIMA' || raw === 'ESTABLE' || raw === 'ATENCION' || raw === 'CRITICA') {
    return raw;
  }
  return 'ESTABLE';
}

function sanitizeRiskSeverity(raw: unknown): 'CRITICA' | 'ALTA' | 'MEDIA' {
  if (raw === 'CRITICA' || raw === 'ALTA' || raw === 'MEDIA') return raw;
  return 'MEDIA';
}

function sanitizeActionPriority(raw: unknown): 'INMEDIATA' | 'CORTO_PLAZO' | 'ESTRATEGICA' {
  if (raw === 'INMEDIATA' || raw === 'CORTO_PLAZO' || raw === 'ESTRATEGICA') return raw;
  return 'CORTO_PLAZO';
}

export async function runAxyCoreDirectorAnalysis(params: {
  question?: string;
  focusMode?: DirectorFocusMode;
  periodLabel?: string;
  currencyScope?: string;
  previousBriefingSummary?: string;
  scopedContext: Record<string, unknown>;
  actorId?: string;
}): Promise<DirectorAnalysisResponse> {
  const actorKey = `director:${params.actorId || 'anon'}`;
  assertAiRateLimit(actorKey);
  const ai = getGeminiClient();

  const focusMode = sanitizeFocusMode(params.focusMode);
  const question =
    params.question?.trim() ||
    'Analiza integralmente el estado actual de mi operación financiera, originación, morosidad y cobranza según el contexto autorizado.';

  const systemInstruction = `Eres AxyCore Director, el motor de inteligencia ejecutiva financiera de AxyCore (CFO / CRO Virtual).
${FOCUS_MODE_DIRECTIVES[focusMode]}

REGLAS INQUEBRANTABLES:
1. Basarte EXCLUSIVAMENTE en los datos reales suministrados en el JSON de contexto autorizado del usuario.
2. NUNCA inventar cifras, montos, tasas, porcentajes, clientes, préstamos ni tendencias si no figuran explícitamente en el JSON.
3. Si faltan registros, la base previa es 0 o una sección indica "Restringido por RBAC" / null, indícalo claramente en dataLimitations sin estimar valores ficticios.
4. Nunca mezcles DOP y USD sin aclararlo; reporta cada moneda por separado o cita la tasa BCRD explícita cuando uses el consolidado en RD$.
5. Clasifica el semáforo operativo (healthStatus) de forma rigurosa:
   - OPTIMA: mora baja / controlada y operación fluida.
   - ESTABLE: indicadores saludables con focos menores por monitorear.
   - ATENCION: focos moderados de mora, promesas incumplidas, pagos por validar o cuellos en originación.
   - CRITICA: PAR 30 elevado, alta concentración vencida o múltiples alertas críticas activas.
6. Distingue con rigor entre:
   - executiveHeadline: titular ejecutivo breve de máximo 14 palabras.
   - executiveSummary: resumen ejecutivo claro, directo y accionable (3-5 líneas).
   - keyMetricsCited: entre 3 y 6 indicadores exactos tomados literalmente del JSON (label, value, context).
   - verifiedObservations: 3 a 6 hechos y métricas 100% verificados en los datos reales.
   - inferences: 2 a 5 interpretaciones analíticas prudentes derivadas de esos hechos.
   - priorityRisks: hasta 4 riesgos reales priorizados (CRITICA/ALTA/MEDIA) con evidencia exacta y mitigación concreta.
   - strategicOpportunities: hasta 3 oportunidades operativas o comerciales reales sustentadas en los datos.
   - recommendedActions: 3 a 5 acciones operativas concretas con prioridad (INMEDIATA/CORTO_PLAZO/ESTRATEGICA), rol sugerido (ownerRole) y targetSection exacto.
   - followUpQuestions: 3 preguntas estratégicas concretas que el ejecutivo puede hacer a continuación sobre sus datos reales.
7. Rutas targetSection válidas que puedes usar (elige solo las pertinentes): dashboard, credit_dashboard, applications, decision_engine, evaluation, committee, formalization, disbursements, loans, customers, documents, reports, policies, audit, cobranza_dashboard, cobranza_anticipate, cobranza_portfolio, cobranza_daily, cobranza_urgent, cobranza_legal, cobranza_promises, cobranza_agreements_broken, cobranza_payments, cobranza_reconciliation, cobranza_sentinel, cobranza_bot, cobranza_reports, accounting, accounting_payment_validation, accounting_statements, intelligence_altera, intelligence_impulsa, regula.
8. Nunca ejecutes ni prometas aprobaciones, desembolsos o cambios automáticos de saldos; todas las recomendaciones requieren supervisión humana.
9. Responde siempre en español profesional bancario/financiero, conciso y de nivel directivo.`;

  const previousContextBlock = params.previousBriefingSummary?.trim()
    ? `\nContexto del dictamen inmediatamente anterior (consulta de profundización):\n${params.previousBriefingSummary.trim().slice(0, 1200)}\n`
    : '';

  const prompt = `Modo de análisis: ${focusMode}
Pregunta o foco solicitado:
${question}
${previousContextBlock}
Contexto operativo autorizado en tiempo real (JSON):
${serializeSafeContext(params.scopedContext, 28_000)}`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      healthStatus: { type: Type.STRING },
      executiveHeadline: { type: Type.STRING },
      executiveSummary: { type: Type.STRING },
      keyMetricsCited: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            value: { type: Type.STRING },
            context: { type: Type.STRING },
          },
          required: ['label', 'value'],
        },
      },
      verifiedObservations: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      inferences: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      priorityRisks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            severity: { type: Type.STRING },
            area: { type: Type.STRING },
            evidence: { type: Type.STRING },
            mitigation: { type: Type.STRING },
            targetSection: { type: Type.STRING },
          },
          required: ['title', 'severity', 'area', 'evidence', 'mitigation'],
        },
      },
      strategicOpportunities: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            detail: { type: Type.STRING },
            expectedImpact: { type: Type.STRING },
            targetSection: { type: Type.STRING },
          },
          required: ['title', 'detail', 'expectedImpact'],
        },
      },
      recommendedActions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            detail: { type: Type.STRING },
            priority: { type: Type.STRING },
            ownerRole: { type: Type.STRING },
            targetSection: { type: Type.STRING },
          },
          required: ['title', 'detail'],
        },
      },
      dataLimitations: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      followUpQuestions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
    required: [
      'healthStatus',
      'executiveHeadline',
      'executiveSummary',
      'keyMetricsCited',
      'verifiedObservations',
      'inferences',
      'priorityRisks',
      'strategicOpportunities',
      'recommendedActions',
      'dataLimitations',
      'followUpQuestions',
    ],
  };

  const { text: rawText, modelUsed } = await generateStructuredWithResilience({
    ai,
    prompt,
    systemInstruction,
    responseSchema,
  });

  const parsed = parseStructuredJson<Partial<DirectorAnalysisResponse>>(rawText);

  const priorityRisks: DirectorPriorityRisk[] = Array.isArray(parsed.priorityRisks)
    ? parsed.priorityRisks
        .filter((r) => r && typeof r.title === 'string' && typeof r.mitigation === 'string')
        .slice(0, 5)
        .map((r) => ({
          title: r.title.trim(),
          severity: sanitizeRiskSeverity(r.severity),
          area: typeof r.area === 'string' && r.area.trim() ? r.area.trim() : 'Cartera y Riesgo',
          evidence: typeof r.evidence === 'string' ? r.evidence.trim() : '',
          mitigation: r.mitigation.trim(),
          targetSection: sanitizeTargetSection(r.targetSection),
        }))
    : [];

  const strategicOpportunities: DirectorStrategicOpportunity[] = Array.isArray(parsed.strategicOpportunities)
    ? parsed.strategicOpportunities
        .filter((o) => o && typeof o.title === 'string' && typeof o.detail === 'string')
        .slice(0, 4)
        .map((o) => ({
          title: o.title.trim(),
          detail: o.detail.trim(),
          expectedImpact:
            typeof o.expectedImpact === 'string' && o.expectedImpact.trim()
              ? o.expectedImpact.trim()
              : 'Mejora operativa medible',
          targetSection: sanitizeTargetSection(o.targetSection),
        }))
    : [];

  const periodFromContext =
    typeof params.periodLabel === 'string' && params.periodLabel.trim()
      ? params.periodLabel.trim()
      : typeof params.scopedContext.periodoConsultado === 'string'
      ? params.scopedContext.periodoConsultado
      : undefined;

  const currencyFromContext =
    typeof params.currencyScope === 'string' && params.currencyScope.trim()
      ? params.currencyScope.trim()
      : typeof params.scopedContext.monedaConsultada === 'string'
      ? params.scopedContext.monedaConsultada
      : undefined;

  return {
    analysisId: `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    modelUsed,
    generatedAtIso: new Date().toISOString(),
    focusMode,
    periodLabel: periodFromContext,
    currencyScope: currencyFromContext,
    questionAsked: question,
    healthStatus: sanitizeHealthStatus(parsed.healthStatus),
    executiveHeadline:
      typeof parsed.executiveHeadline === 'string' && parsed.executiveHeadline.trim()
        ? parsed.executiveHeadline.trim()
        : 'Diagnóstico Ejecutivo AxyCore Director',
    executiveSummary:
      typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : 'Análisis ejecutivo generado sobre el contexto operativo autorizado.',
    keyMetricsCited: Array.isArray(parsed.keyMetricsCited)
      ? parsed.keyMetricsCited
          .filter((m) => m && typeof m.label === 'string' && typeof m.value === 'string')
          .slice(0, 6)
          .map((m) => ({
            label: m.label.trim(),
            value: m.value.trim(),
            context: typeof m.context === 'string' ? m.context.trim() : undefined,
          }))
      : [],
    verifiedObservations: Array.isArray(parsed.verifiedObservations)
      ? parsed.verifiedObservations
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
      : [],
    inferences: Array.isArray(parsed.inferences)
      ? parsed.inferences
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
      : [],
    priorityRisks,
    strategicOpportunities,
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions
          .filter((a) => a && typeof a.title === 'string' && typeof a.detail === 'string')
          .slice(0, 6)
          .map((a) => ({
            title: a.title.trim(),
            detail: a.detail.trim(),
            priority: sanitizeActionPriority(a.priority),
            ownerRole: typeof a.ownerRole === 'string' && a.ownerRole.trim() ? a.ownerRole.trim() : undefined,
            targetSection: sanitizeTargetSection(a.targetSection),
          }))
      : [],
    dataLimitations: Array.isArray(parsed.dataLimitations)
      ? parsed.dataLimitations
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
      : [],
    followUpQuestions: Array.isArray(parsed.followUpQuestions)
      ? parsed.followUpQuestions
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 4)
          .map((x) => x.trim())
      : [],
  };
}

export interface BelaServerResponse {
  reply: string;
  verifiedFacts: string[];
  actions: Array<{
    label: string;
    targetSection?: NavSectionId;
    requiresConfirmation?: boolean;
    confirmationNote?: string;
  }>;
  modelUsed: string;
}

export async function runBelaAssistantTurn(params: {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  scopedContext: Record<string, unknown>;
  actorId?: string;
}): Promise<BelaServerResponse> {
  const actorKey = `bela:${params.actorId || 'anon'}`;
  assertAiRateLimit(actorKey);
  const ai = getGeminiClient();

  const message = params.message?.trim();
  if (!message) {
    throw new Error('Escribe una consulta para que Bela pueda ayudarte.');
  }

  const systemInstruction = `Eres Bela, la asistente virtual inteligente de la plataforma financiera empresarial AxyCore.
Tu personalidad es cercana, clara, ejecutiva, precisa y confiable.
REGLAS CRÍTICAS:
1. Solo puedes consultar y explicar datos que existan explícitamente en el JSON de contexto autorizado del usuario.
2. Si el usuario pregunta por un dato fuera de sus permisos RBAC o inexistente en el sistema, díselo honestamente sin inventar nada.
3. NUNCA ejecutes, apruebes, rechaces ni modifiques préstamos, saldos, desembolsos ni pagos por tu cuenta. Si el usuario pide realizar una acción operativa (ej. abrir evaluación, aprobar en comité, registrar pago, ir a un módulo), oriéntalo mediante un botón en "actions" y marca requiresConfirmation=true si implica una operación sensible.
4. Nunca sumes DOP y USD sin conversión; indícalos separados.
5. Mantén respuestas claras y bien estructuradas en español. En "verifiedFacts" lista los datos exactos citados si corresponde (máx 4). En "actions" sugiere hasta 3 atajos útiles hacia secciones válidas de AxyCore.`;

  const historyLines = (params.history || [])
    .slice(-8)
    .map((h) => `${h.role === 'user' ? 'Usuario' : 'Bela'}: ${h.content}`)
    .join('\n');

  const prompt = `${historyLines ? `Historial reciente:\n${historyLines}\n\n` : ''}Consulta actual del usuario:
${message}

Contexto autorizado en tiempo real (JSON):
${serializeSafeContext(params.scopedContext, 22_000)}`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reply: { type: Type.STRING },
      verifiedFacts: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      actions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            targetSection: { type: Type.STRING },
            requiresConfirmation: { type: Type.BOOLEAN },
            confirmationNote: { type: Type.STRING },
          },
          required: ['label'],
        },
      },
    },
    required: ['reply', 'verifiedFacts', 'actions'],
  };

  const { text: rawText, modelUsed } = await generateStructuredWithResilience({
    ai,
    prompt,
    systemInstruction,
    responseSchema,
  });

  const parsed = parseStructuredJson<Partial<BelaServerResponse>>(rawText);

  return {
    reply:
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : 'He revisado tu espacio de trabajo. ¿Deseas explorar algún módulo o indicador en detalle?',
    verifiedFacts: Array.isArray(parsed.verifiedFacts)
      ? parsed.verifiedFacts.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 4)
      : [],
    actions: Array.isArray(parsed.actions)
      ? parsed.actions
          .filter((a) => a && typeof a.label === 'string')
          .map((a) => ({
            label: a.label,
            targetSection: sanitizeTargetSection(a.targetSection),
            requiresConfirmation: Boolean(a.requiresConfirmation),
            confirmationNote: typeof a.confirmationNote === 'string' ? a.confirmationNote : undefined,
          }))
          .filter((a) => a.targetSection)
          .slice(0, 3)
      : [],
    modelUsed,
  };
}
