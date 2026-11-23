import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { assertAiRateLimit } from './geminiAssistant';

const IMPULSA_GEMINI_MODEL = 'gemini-4-hydrogen';
const REQUEST_TIMEOUT_MS = 28_000;

function getImpulsaGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Impulsa IA excedió el tiempo máximo de respuesta.'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const IMPULSA_AI_SYSTEM_RULES = `Eres Impulsa IA, el analista comercial inteligente del Motor de Crecimiento Crediticio de AxyCore.
REGLAS ESTRICTAS DE GOBERNANZA Y VERACIDAD:
1. NUNCA inventes clientes, préstamos, cifras, tasas, oficiales ni oportunidades que no figuren explícitamente en el JSON de contexto suministrado.
2. Cita los códigos exactos de oportunidad (ej. IMP-REN-XXXXXX) en citedOpportunityCodes cuando menciones casos específicos.
3. Si faltan datos para responder alguna parte de la consulta, decláralo de forma transparente en missingData.
4. NUNCA confundas probabilidad de conversión comercial con aprobación crediticia: toda recomendación es comercial y debe pasar por el Motor de Decisiones V2, validación de capacidad de pago y Comité.
5. Nunca sugieras refinanciamientos para maquillar morosidad ni incrementos de monto sin capacidad de pago validada.
6. Responde siempre en español claro, ejecutivo y accionable para equipos comerciales y directivos financieros.`;

export async function runImpulsaAiAssistant(params: {
  question: string;
  impulsaContext: Record<string, unknown>;
  actorId?: string;
}): Promise<{
  available: boolean;
  model: string;
  answer: string;
  keyFindings: string[];
  recommendedActions: string[];
  citedOpportunityCodes: string[];
  missingData: string[];
}> {
  assertAiRateLimit(`impulsa_ai:${params.actorId || 'anon'}`);
  const ai = getImpulsaGeminiClient();
  if (!ai) {
    return {
      available: false,
      model: 'unavailable',
      answer: '',
      keyFindings: [],
      recommendedActions: [],
      citedOpportunityCodes: [],
      missingData: ['GEMINI_API_KEY no configurada en el servidor; usando motor determinista local.'],
    };
  }

  const response = await withTimeout(
    ai.models.generateContent({
      model: IMPULSA_GEMINI_MODEL,
      contents: `Consulta comercial en AxyCore Impulsa:
${params.question}

Datos reales actuales de la institución en Impulsa (JSON):
${JSON.stringify(params.impulsaContext).slice(0, 28000)}`,
      config: {
        systemInstruction: IMPULSA_AI_SYSTEM_RULES,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
            citedOpportunityCodes: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'answer',
            'keyFindings',
            'recommendedActions',
            'citedOpportunityCodes',
            'missingData',
          ],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    available: true,
    model: IMPULSA_GEMINI_MODEL,
    answer: String(parsed.answer || ''),
    keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map(String) : [],
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions.map(String)
      : [],
    citedOpportunityCodes: Array.isArray(parsed.citedOpportunityCodes)
      ? parsed.citedOpportunityCodes.map(String)
      : [],
    missingData: Array.isArray(parsed.missingData) ? parsed.missingData.map(String) : [],
  };
}
