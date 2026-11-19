import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { isSupportedOcrMimeType, parseDataUrlForOcr } from '../src/engine/documentOcr';
import {
  calibrateBiometricVerdict,
  isSupportedSelfieMimeType,
} from '../src/engine/biometricVerification';
import type { BiometricVerificationResult } from '../src/types/axycore';

const BIOMETRIC_VISION_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el entorno del servidor. Configura el secreto en Settings > Secrets para ejecutar verificación biométrica.'
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

export interface VerifyBiometricIdentityRequest {
  identityDocumentDataUrl: string;
  identityDocumentMimeType?: string;
  identityDocumentFileName?: string;
  selfieDataUrl: string;
  selfieMimeType?: string;
  applicantMeta?: {
    fullName?: string;
    documentType?: string;
    documentNumber?: string;
  };
}

export async function runGeminiBiometricVerification(
  reqBody: VerifyBiometricIdentityRequest
): Promise<BiometricVerificationResult> {
  if (!reqBody?.identityDocumentDataUrl) {
    throw new Error('Debes adjuntar primero el documento de identidad (cédula o pasaporte).');
  }
  if (!reqBody?.selfieDataUrl) {
    throw new Error('Debes capturar una fotografía en vivo con la cámara para realizar la comparación.');
  }

  const idParsed = parseDataUrlForOcr(
    reqBody.identityDocumentDataUrl,
    reqBody.identityDocumentMimeType
  );
  if (!idParsed || !isSupportedOcrMimeType(idParsed.mimeType)) {
    throw new Error(
      'El documento de identidad tiene un formato inválido o no compatible. Usa PNG, JPG, WEBP o PDF.'
    );
  }

  const selfieParsed = parseDataUrlForOcr(reqBody.selfieDataUrl, reqBody.selfieMimeType);
  if (!selfieParsed || !isSupportedSelfieMimeType(selfieParsed.mimeType)) {
    throw new Error(
      'La captura biométrica tiene un formato inválido. Se requiere una imagen JPEG, PNG o WEBP.'
    );
  }

  const ai = getGeminiClient();

  const meta = reqBody.applicantMeta ?? {};
  const promptText = [
    'Realiza una comparación biométrica facial y validación documental estricta entre estas dos entradas:',
    '1) Parte A (primer archivo): Documento oficial de identidad (cédula o pasaporte).',
    '2) Parte B (segundo archivo): Fotografía en vivo capturada desde la cámara del solicitante.',
    '',
    'Instrucciones de auditoría KYC / Visión Artificial:',
    '- Verifica si existe un rostro claramente visible en la foto impresa del documento de identidad (idPhotoDetected).',
    '- Verifica si existe un rostro humano frontal y nítido en la fotografía en vivo de la cámara (selfieFaceDetected).',
    '- Evalúa la similitud geométrica facial (estructura ósea, distancia interpupilar, nariz, ojos, boca, mentón y proporciones) asignando similarityScore de 0 a 100.',
    '- Evalúa indicios de prueba de vida / autenticidad en la foto en vivo (livenessAssessment: APROBADA si parece rostro real vivo ante cámara, DUDOSA si hay signos de foto de pantalla/papel, reflejos anómalos o máscara, NO_DETERMINADA si la calidad o iluminación impide evaluarlo).',
    '- Extrae del documento de identidad el nombre completo visible (extractedDocName) y número de identificación (extractedDocNumber) si son legibles; de lo contrario null.',
    '- Señala en documentIntegrityNotes si el documento está borroso, recortado, con reflejos o aparente alteración.',
    '- No inventes datos ni fuerces coincidencias si no hay visibilidad suficiente.',
    '',
    'Metadatos declarados en el formulario (referencia cruzada):',
    JSON.stringify(
      {
        fullName: meta.fullName?.trim() || null,
        documentType: meta.documentType?.trim() || null,
        documentNumber: meta.documentNumber?.trim() || null,
        identityFileName: reqBody.identityDocumentFileName || null,
      },
      null,
      2
    ),
  ].join('\n');

  const response = await ai.models.generateContent({
    model: BIOMETRIC_VISION_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: idParsed.mimeType,
            data: idParsed.base64Data,
          },
        },
        {
          inlineData: {
            mimeType: selfieParsed.mimeType,
            data: selfieParsed.base64Data,
          },
        },
        {
          text: promptText,
        },
      ],
    },
    config: {
      systemInstruction:
        'Eres un especialista en verificación biométrica KYC y visión artificial bancaria para AxyCore (República Dominicana). Responde exclusivamente en español con JSON estructurado, criterio conservador antifraude y sin fabricar coincidencias.',
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          verdict: {
            type: Type.STRING,
            description: 'Uno de: COINCIDE, REVISION_MANUAL, NO_COINCIDE, NO_CONCLUYENTE',
          },
          similarityScore: {
            type: Type.NUMBER,
            description: 'Puntaje de similitud biométrica facial entre 0 y 100',
          },
          livenessAssessment: {
            type: Type.STRING,
            description: 'Uno de: APROBADA, DUDOSA, NO_DETERMINADA',
          },
          idPhotoDetected: {
            type: Type.BOOLEAN,
            description: 'true si se detecta un rostro legible en la foto del documento de identidad',
          },
          selfieFaceDetected: {
            type: Type.BOOLEAN,
            description: 'true si se detecta un rostro frontal legible en la foto de cámara',
          },
          extractedDocName: {
            type: Type.STRING,
            nullable: true,
            description: 'Nombre del titular leído visualmente en el documento de identidad',
          },
          extractedDocNumber: {
            type: Type.STRING,
            nullable: true,
            description: 'Número de cédula/pasaporte leído en el documento de identidad',
          },
          documentIntegrityNotes: {
            type: Type.STRING,
            description: 'Evaluación breve de nitidez, encuadre e integridad visual del documento',
          },
          comparisonRationale: {
            type: Type.STRING,
            description: 'Explicación técnica concisa (máximo 280 caracteres) del cotejo facial y documental.',
          },
          observations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Lista de hasta 4 observaciones puntuales de la inspección biométrica.',
          },
        },
        required: [
          'verdict',
          'similarityScore',
          'livenessAssessment',
          'idPhotoDetected',
          'selfieFaceDetected',
          'documentIntegrityNotes',
          'comparisonRationale',
        ],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  let modelOut: {
    verdict?: string;
    similarityScore?: number;
    livenessAssessment?: string;
    idPhotoDetected?: boolean;
    selfieFaceDetected?: boolean;
    extractedDocName?: string | null;
    extractedDocNumber?: string | null;
    documentIntegrityNotes?: string;
    comparisonRationale?: string;
    observations?: string[];
  };

  try {
    modelOut = JSON.parse(rawText);
  } catch {
    throw new Error('La API de visión artificial devolvió una respuesta no estructurada.');
  }

  const similarityScore = Math.max(
    0,
    Math.min(100, Math.round(Number(modelOut.similarityScore ?? 0)))
  );
  const idPhotoDetected = Boolean(modelOut.idPhotoDetected);
  const selfieFaceDetected = Boolean(modelOut.selfieFaceDetected);

  const livenessRaw = String(modelOut.livenessAssessment || 'NO_DETERMINADA').toUpperCase();
  const livenessAssessment: BiometricVerificationResult['livenessAssessment'] =
    livenessRaw === 'APROBADA' || livenessRaw === 'DUDOSA' ? livenessRaw : 'NO_DETERMINADA';

  let verdict = calibrateBiometricVerdict({
    rawVerdict: modelOut.verdict,
    similarityScore,
    idPhotoDetected,
    selfieFaceDetected,
  });

  // Regla antifraude: si liveness es DUDOSA nunca otorgar COINCIDE automático
  if (livenessAssessment === 'DUDOSA' && verdict === 'COINCIDE') {
    verdict = 'REVISION_MANUAL';
  }

  return {
    verdict,
    similarityScore,
    livenessAssessment,
    idPhotoDetected,
    selfieFaceDetected,
    extractedDocName: modelOut.extractedDocName ? String(modelOut.extractedDocName).trim() : null,
    extractedDocNumber: modelOut.extractedDocNumber
      ? String(modelOut.extractedDocNumber).trim()
      : null,
    documentIntegrityNotes: String(
      modelOut.documentIntegrityNotes || 'Inspección visual completada.'
    ),
    comparisonRationale: String(
      modelOut.comparisonRationale || 'Comparación facial procesada mediante visión artificial.'
    ),
    observations: Array.isArray(modelOut.observations)
      ? modelOut.observations.map((o) => String(o)).slice(0, 5)
      : [],
    modelUsed: BIOMETRIC_VISION_MODEL,
    verifiedAtIso: new Date().toISOString(),
  };
}
