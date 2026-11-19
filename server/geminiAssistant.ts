import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { DirectorAnalysisResponse, NavSectionId } from '../src/types/axycore';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const REQUEST_TIMEOUT_MS = 28_000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el servidor. Configúrala para habilitar AxyCore Director y Bela.'
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
const AI_RATE_LIMIT_MAX = 25;
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
  'credit_dashboard',
  'director',
  'bela',
  'new_application',
  'applications',
  'decision_engine',
  'evaluation',
  'committee',
  'formalization',
  'disbursements',
  'loans',
  'customers',
  'documents',
  'reports',
  'policies',
  'audit',
  'cobranza_dashboard',
  'cobranza_anticipate',
  'cobranza_portfolio',
  'cobranza_daily',
  'cobranza_urgent',
  'cobranza_actions',
  'cobranza_promises',
  'cobranza_payments',
  'cobranza_reconciliation',
  'cobranza_sentinel',
  'cobranza_bot',
  'cobranza_reports',
];

function sanitizeTargetSection(raw: unknown): NavSectionId | undefined {
  if (typeof raw !== 'string') return undefined;
  return VALID_NAV_SECTIONS.includes(raw as NavSectionId) ? (raw as NavSectionId) : undefined;
}

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

export async function runAxyCoreDirectorAnalysis(params: {
  question?: string;
  scopedContext: Record<string, unknown>;
  actorId?: string;
}): Promise<DirectorAnalysisResponse> {
  const actorKey = `director:${params.actorId || 'anon'}`;
  assertAiRateLimit(actorKey);
  const ai = getGeminiClient();

  const question =
    params.question?.trim() ||
    'Analiza integralmente el estado actual de mi operación financiera, originación, morosidad y cobranza según el contexto autorizado.';

  const systemInstruction = `Eres AxyCore Director, el motor de inteligencia ejecutiva financiera de AxyCore.
REGLAS INQUEBRANTABLES:
1. Basarte EXCLUSIVAMENTE en los datos reales suministrados en el JSON de contexto autorizado del usuario.
2. NUNCA inventar cifras, montos, tasas, porcentajes, clientes, préstamos ni tendencias si no figuran explícitamente en el JSON.
3. Si faltan registros, la base previa es 0 o una sección indica "Restringido por RBAC" / null, indícalo claramente en dataLimitations sin estimar valores ficticios.
4. Nunca mezcles DOP y USD sin aclararlo; reporta cada moneda por separado exactamente como viene en el contexto.
5. Distingue con rigor entre:
   - executiveSummary: resumen ejecutivo claro de la situación real observada.
   - verifiedObservations: hechos y métricas 100% verificados en los datos reales.
   - inferences: interpretaciones analíticas prudentes derivadas de esos hechos.
   - recommendedActions: acciones operativas concretas que el usuario puede tomar en los módulos reales de AxyCore (sin ejecutar cambios automáticos ni prometer aprobaciones/desembolsos automáticos).
6. Responde siempre en español profesional bancario/financiero, conciso y accionable.`;

  const prompt = `Pregunta o foco solicitado:
${question}

Contexto operativo autorizado en tiempo real (JSON):
${JSON.stringify(params.scopedContext).slice(0, 26000)}`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            verifiedObservations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            inferences: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            recommendedActions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  targetSection: { type: Type.STRING },
                },
                required: ['title', 'detail'],
              },
            },
            dataLimitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'executiveSummary',
            'verifiedObservations',
            'inferences',
            'recommendedActions',
            'dataLimitations',
          ],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const rawText = response.text?.trim() || '{}';
  const parsed = JSON.parse(rawText) as Partial<DirectorAnalysisResponse>;

  return {
    modelUsed: GEMINI_MODEL,
    generatedAtIso: new Date().toISOString(),
    executiveSummary:
      typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : 'Análisis ejecutivo generado sobre el contexto operativo autorizado.',
    verifiedObservations: Array.isArray(parsed.verifiedObservations)
      ? parsed.verifiedObservations.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [],
    inferences: Array.isArray(parsed.inferences)
      ? parsed.inferences.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [],
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions
          .filter((a) => a && typeof a.title === 'string' && typeof a.detail === 'string')
          .map((a) => ({
            title: a.title,
            detail: a.detail,
            targetSection: sanitizeTargetSection(a.targetSection),
          }))
      : [],
    dataLimitations: Array.isArray(parsed.dataLimitations)
      ? parsed.dataLimitations.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
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
${JSON.stringify(params.scopedContext).slice(0, 22000)}`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
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
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const rawText = response.text?.trim() || '{}';
  const parsed = JSON.parse(rawText) as Partial<BelaServerResponse>;

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
    modelUsed: GEMINI_MODEL,
  };
}
