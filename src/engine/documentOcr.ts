import type { DocumentOcrFieldMatchStatus, DocumentOcrResult, DocumentOcrVerdict } from '../types/axycore';

export const SUPPORTED_OCR_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
];

export interface ParsedDataUrl {
  mimeType: string;
  base64Data: string;
}

/**
 * Extrae el tipo MIME y la carga Base64 desde un Data URL (data:<mime>;base64,<data>).
 */
export function parseDataUrlForOcr(dataUrl: string, fallbackMimeType?: string): ParsedDataUrl | null {
  const trimmed = String(dataUrl || '').trim();
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(trimmed);
  if (!match) return null;
  const rawMime = (match[1] || fallbackMimeType || '').toLowerCase().trim();
  const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  const base64Data = match[2].replace(/\s+/g, '');
  if (!mimeType || !base64Data) return null;
  return { mimeType, base64Data };
}

export function isSupportedOcrMimeType(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false;
  const norm = mimeType.toLowerCase().trim();
  return SUPPORTED_OCR_MIME_TYPES.includes(norm);
}

/**
 * Calcula la variación porcentual absoluta entre un monto declarado y uno extraído por OCR.
 */
export function computeNumericVariancePct(
  declared: number | null | undefined,
  extracted: number | null | undefined
): number | null {
  if (
    declared === null ||
    declared === undefined ||
    extracted === null ||
    extracted === undefined ||
    !Number.isFinite(declared) ||
    !Number.isFinite(extracted)
  ) {
    return null;
  }
  if (declared === 0 && extracted === 0) return 0;
  const denominator = Math.max(Math.abs(declared), 1);
  return Math.round((Math.abs(extracted - declared) / denominator) * 1000) / 10;
}

/**
 * Clasifica coincidencia numérica según tolerancia estándar de validación documental.
 */
export function classifyAmountMatch(
  declared: number | null | undefined,
  extracted: number | null | undefined
): { matchStatus: DocumentOcrFieldMatchStatus; variancePct: number | null } {
  const variancePct = computeNumericVariancePct(declared, extracted);
  if (variancePct === null) {
    return { matchStatus: 'NOT_FOUND', variancePct: null };
  }
  if (variancePct <= 5) {
    return { matchStatus: 'MATCH', variancePct };
  }
  if (variancePct <= 15) {
    return { matchStatus: 'MINOR_DIFF', variancePct };
  }
  return { matchStatus: 'MISMATCH', variancePct };
}

/**
 * Normaliza cadenas de nombres o cédulas/RNC para comparación tolerante a acentos, guiones y mayúsculas.
 */
export function normalizeComparableText(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeComparableIdNumber(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export const OCR_VERDICT_LABELS: Record<DocumentOcrVerdict, string> = {
  COINCIDE: 'Coincide con la Solicitud',
  DISCREPANCIA_MENOR: 'Discrepancia Menor (Revisar)',
  DISCREPANCIA_CRITICA: 'Discrepancia Crítica',
  ILEGIBLE_O_NO_CORRESPONDE: 'Ilegible o No Corresponde',
};

/**
 * Construye una nota concisa (<= 480 caracteres para cumplir firestore.rules max 500) con el resumen OCR.
 */
export function buildOcrDocumentNote(result: DocumentOcrResult): string {
  const verdict = OCR_VERDICT_LABELS[result.overallVerdict] || result.overallVerdict;
  const incomePart =
    result.extractedFields.monthlyIncome !== null
      ? ` · Ingreso OCR: ${result.extractedFields.currency ?? ''} ${result.extractedFields.monthlyIncome.toLocaleString('en-US')}`
      : '';
  const raw = `[Gemini OCR · ${verdict} · Confianza ${Math.round(result.confidenceScore)}%${incomePart}] ${result.summary}`;
  return raw.slice(0, 480);
}
