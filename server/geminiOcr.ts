import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  classifyAmountMatch,
  isSupportedOcrMimeType,
  normalizeComparableIdNumber,
  normalizeComparableText,
  parseDataUrlForOcr,
} from '../src/engine/documentOcr';
import type {
  ApplicationRecord,
  BusinessRecord,
  CustomerRecord,
  DocumentOcrComparisonItem,
  DocumentOcrResult,
} from '../src/types/axycore';

const OCR_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY no está configurada en el entorno del servidor. Configura el secreto en Settings > Secrets para ejecutar OCR.'
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

export interface VerifyDocumentOcrRequest {
  document: {
    id?: string;
    category: string;
    fileName: string;
    mimeType?: string;
    fileDataUrl: string;
  };
  application: Pick<
    ApplicationRecord,
    | 'id'
    | 'applicationNumber'
    | 'applicantDisplayName'
    | 'applicantType'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'financialData'
    | 'businessFinancialData'
  >;
  customer?: Pick<
    CustomerRecord,
    'firstName' | 'lastName' | 'documentType' | 'documentNumber' | 'address' | 'phone'
  > | null;
  business?: Pick<BusinessRecord, 'legalName' | 'tradeName' | 'rnc'> | null;
}

export async function runGeminiDocumentOcrVerification(
  reqBody: VerifyDocumentOcrRequest
): Promise<DocumentOcrResult> {
  const { document: docInput, application, customer, business } = reqBody;

  if (!docInput?.fileDataUrl) {
    throw new Error('El documento seleccionado no contiene un archivo adjunto para procesar por OCR.');
  }

  const parsed = parseDataUrlForOcr(docInput.fileDataUrl, docInput.mimeType);
  if (!parsed) {
    throw new Error('Formato de archivo inválido. Adjunta una imagen (PNG/JPG/WEBP) o PDF en Base64.');
  }

  if (!isSupportedOcrMimeType(parsed.mimeType)) {
    throw new Error(
      `Tipo de archivo no compatible con OCR (${parsed.mimeType}). Usa PNG, JPG, WEBP o PDF.`
    );
  }

  const ai = getGeminiClient();

  const declaredSummary = {
    applicationNumber: application.applicationNumber,
    applicantDisplayName: application.applicantDisplayName,
    applicantType: application.applicantType,
    customerFullName: customer ? `${customer.firstName} ${customer.lastName}`.trim() : application.applicantDisplayName,
    customerDocumentType: customer?.documentType ?? null,
    customerDocumentNumber: customer?.documentNumber ?? null,
    customerAddress: customer?.address ?? null,
    businessLegalName: business?.legalName ?? null,
    businessRnc: business?.rnc ?? null,
    loanCurrency: application.currency,
    employerOrBusinessName: application.financialData?.employerOrBusinessName ?? null,
    incomeCurrency: application.financialData?.incomeCurrency ?? application.currency,
    declaredPrimaryNetIncome: application.financialData?.primaryNetIncome ?? null,
    declaredAdditionalNetIncome: application.financialData?.additionalNetIncome ?? 0,
    declaredEssentialExpenses: application.financialData?.essentialExpenses ?? null,
    declaredDebtPayments: application.financialData?.currentDebtPayments ?? 0,
    declaredBusinessNetFlow: application.businessFinancialData?.netMonthlyFlow ?? null,
    documentCategory: docInput.category,
    documentFileName: docInput.fileName,
  };

  const promptText = [
    'Analiza mediante OCR el documento adjunto de esta solicitud de crédito y compáralo con los datos declarados.',
    'Reglas estrictas:',
    '1. Extrae únicamente los valores visibles en el documento (si un campo no aparece en el documento, devuelve null).',
    '2. Si el comprobante muestra salario quincenal o semanal, indica el monto neto mensual equivalente en monthlyIncome y explícalo en detail/summary.',
    '3. Compara titular/nombre, número de documento/cédula/RNC, empleador/entidad, moneda, ingreso neto mensual y deducciones/deudas si constan en el documento.',
    '4. Evalúa si el documento es legible y corresponde al solicitante.',
    '',
    'Datos declarados en la solicitud (JSON):',
    JSON.stringify(declaredSummary, null, 2),
  ].join('\n');

  const response = await ai.models.generateContent({
    model: OCR_MODEL,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.base64Data,
          },
        },
        {
          text: promptText,
        },
      ],
    },
    config: {
      systemInstruction:
        'Eres un auditor experto en verificación documental y OCR financiero de AxyCore (República Dominicana). Responde exclusivamente en español, con precisión contable y sin inventar datos inexistentes en la imagen o PDF.',
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          overallVerdict: {
            type: Type.STRING,
            description:
              'Uno de: COINCIDE, DISCREPANCIA_MENOR, DISCREPANCIA_CRITICA, ILEGIBLE_O_NO_CORRESPONDE',
          },
          confidenceScore: {
            type: Type.NUMBER,
            description: 'Nivel de confianza del OCR entre 0 y 100',
          },
          detectedDocumentType: {
            type: Type.STRING,
            description: 'Tipo de documento detectado visualmente (ej. Volante de nómina, Carta de ingresos, Cédula, Estado bancario)',
          },
          summary: {
            type: Type.STRING,
            description: 'Resumen técnico conciso (máximo 300 caracteres) de los hallazgos OCR y validación cruzada.',
          },
          extractedFields: {
            type: Type.OBJECT,
            properties: {
              holderName: { type: Type.STRING, nullable: true },
              documentNumber: { type: Type.STRING, nullable: true },
              employerOrEntity: { type: Type.STRING, nullable: true },
              currency: { type: Type.STRING, nullable: true },
              monthlyIncome: { type: Type.NUMBER, nullable: true },
              monthlyDeductionsOrExpenses: { type: Type.NUMBER, nullable: true },
              monthlyDebtPayments: { type: Type.NUMBER, nullable: true },
              documentDate: { type: Type.STRING, nullable: true },
              address: { type: Type.STRING, nullable: true },
              rawKeyLines: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
          additionalNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Observaciones clave detectadas por el OCR (máximo 5 elementos).',
          },
        },
        required: [
          'overallVerdict',
          'confidenceScore',
          'detectedDocumentType',
          'summary',
          'extractedFields',
        ],
      },
    },
  });

  const rawJsonText = (response.text ?? '{}').trim();
  let modelOut: {
    overallVerdict?: string;
    confidenceScore?: number;
    detectedDocumentType?: string;
    summary?: string;
    extractedFields?: {
      holderName?: string | null;
      documentNumber?: string | null;
      employerOrEntity?: string | null;
      currency?: string | null;
      monthlyIncome?: number | null;
      monthlyDeductionsOrExpenses?: number | null;
      monthlyDebtPayments?: number | null;
      documentDate?: string | null;
      address?: string | null;
      rawKeyLines?: string[];
    };
  };

  try {
    modelOut = JSON.parse(rawJsonText);
  } catch {
    throw new Error('Gemini devolvió una respuesta no estructurada al procesar el documento.');
  }

  const ext = modelOut.extractedFields ?? {};
  const extractedCurrency =
    ext.currency === 'USD' || ext.currency === 'DOP' ? ext.currency : null;

  // Deterministic cross-check table combining Gemini OCR extraction + exact tolerance math
  const comparisons: DocumentOcrComparisonItem[] = [];

  // 1. Titular / Nombre completo
  const declName = declaredSummary.customerFullName;
  const extName = ext.holderName ? String(ext.holderName).trim() : null;
  if (extName) {
    const normDecl = normalizeComparableText(declName);
    const normExt = normalizeComparableText(extName);
    const declTokens = normDecl.split(' ').filter((t) => t.length >= 2);
    const matchingTokens = declTokens.filter((t) => normExt.includes(t));
    const ratio = declTokens.length > 0 ? matchingTokens.length / declTokens.length : 0;
    comparisons.push({
      fieldKey: 'holderName',
      fieldLabel: 'Titular / Solicitante',
      declaredValue: declName,
      extractedValue: extName,
      matchStatus: ratio >= 0.65 ? 'MATCH' : ratio >= 0.35 ? 'MINOR_DIFF' : 'MISMATCH',
      variancePct: null,
      detail:
        ratio >= 0.65
          ? 'El nombre extraído coincide con el solicitante.'
          : 'El nombre en el documento difiere del solicitante registrado.',
    });
  } else {
    comparisons.push({
      fieldKey: 'holderName',
      fieldLabel: 'Titular / Solicitante',
      declaredValue: declName,
      extractedValue: 'No detectado',
      matchStatus: 'NOT_FOUND',
      variancePct: null,
      detail: 'No se identificó nombre de titular legible en el documento.',
    });
  }

  // 2. Documento de identidad / RNC
  const declDoc = declaredSummary.customerDocumentNumber || declaredSummary.businessRnc;
  const extDoc = ext.documentNumber ? String(ext.documentNumber).trim() : null;
  if (declDoc && extDoc) {
    const match = normalizeComparableIdNumber(declDoc) === normalizeComparableIdNumber(extDoc);
    comparisons.push({
      fieldKey: 'documentNumber',
      fieldLabel: 'Cédula / Pasaporte / RNC',
      declaredValue: declDoc,
      extractedValue: extDoc,
      matchStatus: match ? 'MATCH' : 'MISMATCH',
      variancePct: null,
      detail: match
        ? 'Identificación coincide exactamente tras normalización.'
        : 'Número de documento extraído no coincide con el expediente.',
    });
  } else if (declDoc) {
    comparisons.push({
      fieldKey: 'documentNumber',
      fieldLabel: 'Cédula / Pasaporte / RNC',
      declaredValue: declDoc,
      extractedValue: extDoc ?? 'No consta en este soporte',
      matchStatus: 'NOT_FOUND',
      variancePct: null,
      detail: 'El documento no muestra explícitamente el número de identificación.',
    });
  }

  // 3. Empleador / Entidad emisora
  const declEmployer =
    declaredSummary.employerOrBusinessName || declaredSummary.businessLegalName || 'No declarado';
  const extEmployer = ext.employerOrEntity ? String(ext.employerOrEntity).trim() : null;
  if (extEmployer) {
    const normDeclEmp = normalizeComparableText(declEmployer);
    const normExtEmp = normalizeComparableText(extEmployer);
    const matchesEmp =
      normDeclEmp !== 'NO DECLARADO' &&
      (normExtEmp.includes(normDeclEmp) ||
        normDeclEmp.includes(normExtEmp) ||
        normDeclEmp
          .split(' ')
          .filter((w) => w.length >= 3)
          .some((w) => normExtEmp.includes(w)));
    comparisons.push({
      fieldKey: 'employerOrEntity',
      fieldLabel: 'Empleador / Emisor',
      declaredValue: declEmployer,
      extractedValue: extEmployer,
      matchStatus:
        normDeclEmp === 'NO DECLARADO' ? 'MINOR_DIFF' : matchesEmp ? 'MATCH' : 'MISMATCH',
      variancePct: null,
      detail: matchesEmp
        ? 'Empleador / entidad emisora consistente con la solicitud.'
        : 'La entidad emisora en el documento difiere de la declarada.',
    });
  }

  // 4. Ingreso mensual neto
  const declIncome =
    application.applicantType === 'BUSINESS' && declaredSummary.declaredBusinessNetFlow !== null
      ? declaredSummary.declaredBusinessNetFlow
      : declaredSummary.declaredPrimaryNetIncome;
  const extIncome =
    typeof ext.monthlyIncome === 'number' && Number.isFinite(ext.monthlyIncome)
      ? ext.monthlyIncome
      : null;
  const incomeCheck = classifyAmountMatch(declIncome, extIncome);
  comparisons.push({
    fieldKey: 'monthlyIncome',
    fieldLabel:
      application.applicantType === 'BUSINESS' ? 'Flujo / Ingreso Neto Mensual' : 'Ingreso Neto Mensual',
    declaredValue:
      declIncome !== null && declIncome !== undefined
        ? `${declaredSummary.incomeCurrency} ${declIncome.toLocaleString('en-US')}`
        : 'N/D',
    extractedValue:
      extIncome !== null
        ? `${extractedCurrency ?? declaredSummary.incomeCurrency} ${extIncome.toLocaleString('en-US')}`
        : 'No detectado',
    matchStatus: incomeCheck.matchStatus,
    variancePct: incomeCheck.variancePct,
    detail:
      incomeCheck.matchStatus === 'MATCH'
        ? `Diferencia de ${incomeCheck.variancePct}% dentro de tolerancia (≤ 5%).`
        : incomeCheck.matchStatus === 'MINOR_DIFF'
        ? `Variación moderada de ${incomeCheck.variancePct}% respecto al monto declarado.`
        : incomeCheck.matchStatus === 'MISMATCH'
        ? `Discrepancia significativa de ${incomeCheck.variancePct}% frente al ingreso declarado.`
        : 'No fue posible extraer ingreso numérico en este documento.',
  });

  // 5. Deducciones / Cuotas de deuda (si aplican)
  const extDebt =
    typeof ext.monthlyDebtPayments === 'number' && Number.isFinite(ext.monthlyDebtPayments)
      ? ext.monthlyDebtPayments
      : null;
  if (extDebt !== null) {
    const debtCheck = classifyAmountMatch(declaredSummary.declaredDebtPayments, extDebt);
    comparisons.push({
      fieldKey: 'monthlyDebtPayments',
      fieldLabel: 'Descuentos / Cuotas de Deuda',
      declaredValue: `${declaredSummary.incomeCurrency} ${declaredSummary.declaredDebtPayments.toLocaleString('en-US')}`,
      extractedValue: `${extractedCurrency ?? declaredSummary.incomeCurrency} ${extDebt.toLocaleString('en-US')}`,
      matchStatus: debtCheck.matchStatus,
      variancePct: debtCheck.variancePct,
      detail:
        debtCheck.matchStatus === 'MATCH'
          ? 'Cuotas/descuentos consistentes.'
          : 'Diferencia detectada en obligaciones o descuentos recurrentes.',
    });
  }

  // Deterministic verdict calibration combined with model verdict
  const hasCriticalMismatch = comparisons.some((c) => c.matchStatus === 'MISMATCH');
  const hasMinorDiff = comparisons.some((c) => c.matchStatus === 'MINOR_DIFF');
  const validVerdicts = [
    'COINCIDE',
    'DISCREPANCIA_MENOR',
    'DISCREPANCIA_CRITICA',
    'ILEGIBLE_O_NO_CORRESPONDE',
  ] as const;

  let overallVerdict: DocumentOcrResult['overallVerdict'] = validVerdicts.includes(
    modelOut.overallVerdict as DocumentOcrResult['overallVerdict']
  )
    ? (modelOut.overallVerdict as DocumentOcrResult['overallVerdict'])
    : 'DISCREPANCIA_MENOR';

  if (overallVerdict !== 'ILEGIBLE_O_NO_CORRESPONDE') {
    if (hasCriticalMismatch) overallVerdict = 'DISCREPANCIA_CRITICA';
    else if (hasMinorDiff && overallVerdict === 'COINCIDE') overallVerdict = 'DISCREPANCIA_MENOR';
  }

  const confidenceScore = Math.max(
    0,
    Math.min(100, Math.round(Number(modelOut.confidenceScore ?? 75)))
  );

  return {
    documentId: docInput.id,
    fileName: docInput.fileName,
    category: docInput.category,
    modelUsed: OCR_MODEL,
    overallVerdict,
    confidenceScore,
    detectedDocumentType: String(modelOut.detectedDocumentType || docInput.category),
    summary: String(modelOut.summary || 'Análisis OCR completado.'),
    extractedFields: {
      holderName: extName,
      documentNumber: extDoc,
      employerOrEntity: extEmployer,
      currency: extractedCurrency,
      monthlyIncome: extIncome,
      monthlyDeductionsOrExpenses:
        typeof ext.monthlyDeductionsOrExpenses === 'number'
          ? ext.monthlyDeductionsOrExpenses
          : null,
      monthlyDebtPayments: extDebt,
      documentDate: ext.documentDate ? String(ext.documentDate) : null,
      address: ext.address ? String(ext.address) : null,
      rawKeyLines: Array.isArray(ext.rawKeyLines)
        ? ext.rawKeyLines.map((l) => String(l)).slice(0, 8)
        : [],
    },
    comparisons,
    suggestedVerifiedFinancials: {
      primaryNetIncome: extIncome,
      additionalNetIncome: null,
      essentialExpenses: null,
      currentDebtPayments: extDebt,
    },
    recommendedReviewStatus: overallVerdict === 'COINCIDE' ? 'VERIFICADO' : 'OBSERVADO',
    analyzedAtIso: new Date().toISOString(),
  };
}
