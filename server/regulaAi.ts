import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { assertAiRateLimit } from './geminiAssistant';

const REGULA_GEMINI_MODEL = 'gemini-4-hydrogen';
const REQUEST_TIMEOUT_MS = 32_000;

function getRegulaGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el servidor. Configúrala para habilitar REGULA AI.'
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('REGULA AI excedió el tiempo máximo de respuesta. Intenta con un texto más conciso.'));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const COMMON_GOVERNANCE_RULES = `REGLAS INQUEBRANTABLES DE AXYCORE REGULA AI:
1. NUNCA inventes leyes, artículos, circulares, fechas, multas, métricas ni registros que no figuren explícitamente en el texto o contexto JSON suministrado.
2. Cita siempre los códigos o identificadores exactos de las fuentes utilizadas (en citedSources).
3. Si faltan datos, registros, evidencias o normativa base en el contexto, decláralo explícitamente en missingData en lugar de asumir o fabricar información.
4. Toda obligación extraída, brecha, recomendación o informe es una PROPUESTA / BORRADOR que requiere validación y aprobación humana antes de considerarse oficial.
5. Nunca declares culpabilidad ni afirmes que un caso PLAFTPADM debe enviarse automáticamente a autoridades; limita tu rol a análisis objetivo y sugerencias de investigación para el Oficial de Cumplimiento.
6. Responde siempre en español técnico financiero y regulatorio.`;

export async function runRegulaAiAssistant(params: {
  question: string;
  regulaContext: Record<string, unknown>;
  actorId?: string;
}) {
  assertAiRateLimit(`regula_ai:${params.actorId || 'anon'}`);
  const ai = getRegulaGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: REGULA_GEMINI_MODEL,
      contents: `Consulta del usuario en REGULA:
${params.question}

Contexto real autorizado de AxyCore REGULA (JSON):
${JSON.stringify(params.regulaContext).slice(0, 28000)}`,
      config: {
        systemInstruction: `Eres REGULA AI, el asistente especializado de Inteligencia Regulatoria, Cumplimiento, PLAFTPADM, Riesgos, Control Interno y Auditoría de AxyCore.\n${COMMON_GOVERNANCE_RULES}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
            citedSources: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['answer', 'keyFindings', 'suggestedActions', 'citedSources', 'missingData'],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    model: REGULA_GEMINI_MODEL,
    humanApprovalRequired: true,
    ...parsed,
  };
}

export async function runRegulaNormativeAnalysis(params: {
  normativeTitle: string;
  regulator: string;
  normativeText: string;
  institutionProfile?: Record<string, unknown>;
  actorId?: string;
}) {
  assertAiRateLimit(`regula_ai:${params.actorId || 'anon'}`);
  const ai = getRegulaGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: REGULA_GEMINI_MODEL,
      contents: `Título / referencia de la norma: ${params.normativeTitle}
Regulador: ${params.regulator}
Perfil institucional (si existe): ${JSON.stringify(params.institutionProfile || {})}

TEXTO NORMATIVO A ANALIZAR:
${params.normativeText.slice(0, 24000)}`,
      config: {
        systemInstruction: `Eres REGULA AI en modo ANÁLISIS NORMATIVO. Extrae exclusivamente las obligaciones, plazos, áreas impactadas y controles sugeridos que se desprendan directamente del texto provisto. Marca todo como propuesta sujeta a validación humana.\n${COMMON_GOVERNANCE_RULES}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            proposedObligations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  frequency: { type: Type.STRING },
                  suggestedDepartment: { type: Type.STRING },
                  criticality: { type: Type.STRING },
                  requiredEvidence: { type: Type.STRING },
                  sourceClause: { type: Type.STRING },
                },
                required: ['title', 'description', 'frequency', 'suggestedDepartment', 'criticality'],
              },
            },
            affectedAreas: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedControls: { type: Type.ARRAY, items: { type: Type.STRING } },
            citedSources: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['executiveSummary', 'proposedObligations', 'affectedAreas', 'suggestedControls', 'citedSources', 'missingData'],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    model: REGULA_GEMINI_MODEL,
    humanApprovalRequired: true,
    validationStatus: 'PENDIENTE_VALIDACION_HUMANA',
    ...parsed,
  };
}

export async function runRegulaGapDiagnosis(params: {
  focusArea?: string;
  regulaContext: Record<string, unknown>;
  actorId?: string;
}) {
  assertAiRateLimit(`regula_ai:${params.actorId || 'anon'}`);
  const ai = getRegulaGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: REGULA_GEMINI_MODEL,
      contents: `Enfoque solicitado: ${params.focusArea || 'Diagnóstico integral de brechas institucionales'}

Datos reales registrados en AxyCore REGULA (obligaciones, controles, riesgos, documentos, hallazgos, planes y KYC):
${JSON.stringify(params.regulaContext).slice(0, 28000)}`,
      config: {
        systemInstruction: `Eres REGULA AI en modo DIAGNÓSTICO DE BRECHAS. Compara obligaciones, riesgos, controles, políticas y evidencias reales de la entidad para identificar brechas verificables, riesgos sin mitigación, controles débiles o evidencias ausentes.\n${COMMON_GOVERNANCE_RULES}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagnosisSummary: { type: Type.STRING },
            gaps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  domain: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  recommendedActionPlan: { type: Type.STRING },
                  sourceRef: { type: Type.STRING },
                },
                required: ['title', 'severity', 'domain', 'detail', 'recommendedActionPlan'],
              },
            },
            citedSources: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['diagnosisSummary', 'gaps', 'citedSources', 'missingData'],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    model: REGULA_GEMINI_MODEL,
    humanApprovalRequired: true,
    ...parsed,
  };
}

export async function runRegulaDocumentEvaluation(params: {
  documentTitle: string;
  documentType: string;
  documentText: string;
  actorId?: string;
}) {
  assertAiRateLimit(`regula_ai:${params.actorId || 'anon'}`);
  const ai = getRegulaGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: REGULA_GEMINI_MODEL,
      contents: `Documento a evaluar: ${params.documentTitle} (${params.documentType})

CONTENIDO DEL DOCUMENTO:
${params.documentText.slice(0, 24000)}`,
      config: {
        systemInstruction: `Eres REGULA AI en modo EVALUACIÓN DE DOCUMENTOS. Revisa el manual, política o procedimiento provisto para detectar vacíos de control, ambigüedades, ausencia de responsables, vigencia/revisión faltante o contradicciones internas.\n${COMMON_GOVERNANCE_RULES}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallAssessment: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            gapsAndAmbiguities: { type: Type.ARRAY, items: { type: Type.STRING } },
            contradictions: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvementProposals: { type: Type.ARRAY, items: { type: Type.STRING } },
            citedSources: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['overallAssessment', 'strengths', 'gapsAndAmbiguities', 'contradictions', 'improvementProposals', 'citedSources', 'missingData'],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    model: REGULA_GEMINI_MODEL,
    humanApprovalRequired: true,
    ...parsed,
  };
}

export async function runRegulaReportDraft(params: {
  reportType: string;
  audience: string;
  regulaContext: Record<string, unknown>;
  actorId?: string;
}) {
  assertAiRateLimit(`regula_ai:${params.actorId || 'anon'}`);
  const ai = getRegulaGeminiClient();

  const response = await withTimeout(
    ai.models.generateContent({
      model: REGULA_GEMINI_MODEL,
      contents: `Tipo de informe solicitado: ${params.reportType}
Audiencia objetivo: ${params.audience}

Datos reales registrados en AxyCore REGULA:
${JSON.stringify(params.regulaContext).slice(0, 28000)}`,
      config: {
        systemInstruction: `Eres REGULA AI en modo GENERACIÓN DE INFORMES. Redacta un BORRADOR estructurado de informe técnico/ejecutivo basado exclusivamente en los datos reales del JSON. Incluye explícitamente que requiere revisión y aprobación humana antes de su emisión oficial.\n${COMMON_GOVERNANCE_RULES}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            draftTitle: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  content: { type: Type.STRING },
                },
                required: ['heading', 'content'],
              },
            },
            prioritizedRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            citedSources: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['draftTitle', 'executiveSummary', 'sections', 'prioritizedRecommendations', 'citedSources', 'missingData'],
        },
      },
    }),
    REQUEST_TIMEOUT_MS
  );

  const parsed = JSON.parse(response.text || '{}');
  return {
    model: REGULA_GEMINI_MODEL,
    draftStatus: 'BORRADOR_PENDIENTE_APROBACION',
    humanApprovalRequired: true,
    ...parsed,
  };
}
