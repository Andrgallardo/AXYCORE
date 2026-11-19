import type { BiometricMatchVerdict, BiometricVerificationResult } from '../types/axycore';

export const SUPPORTED_SELFIE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export const BIOMETRIC_VERDICT_LABELS: Record<BiometricMatchVerdict, string> = {
  COINCIDE: 'Coincidencia Biométrica Verificada',
  REVISION_MANUAL: 'Coincidencia Parcial (Revisión Manual)',
  NO_COINCIDE: 'No Coincide con el Documento',
  NO_CONCLUYENTE: 'No Concluyente / Calidad Insuficiente',
};

export function isSupportedSelfieMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return SUPPORTED_SELFIE_MIME_TYPES.includes(mimeType.toLowerCase().trim());
}

/**
 * Calibra de forma determinística el veredicto biométrico combinando detección facial,
 * calidad/prueba de vida y el puntaje de similitud facial retornado por visión artificial.
 */
export function calibrateBiometricVerdict(params: {
  rawVerdict?: string;
  similarityScore: number;
  idPhotoDetected: boolean;
  selfieFaceDetected: boolean;
}): BiometricMatchVerdict {
  const score = Math.max(0, Math.min(100, Math.round(Number(params.similarityScore) || 0)));

  if (!params.idPhotoDetected || !params.selfieFaceDetected) {
    return 'NO_CONCLUYENTE';
  }
  if (params.rawVerdict === 'NO_CONCLUYENTE' && score < 55) {
    return 'NO_CONCLUYENTE';
  }
  if (score >= 78) {
    return 'COINCIDE';
  }
  if (score >= 52) {
    return 'REVISION_MANUAL';
  }
  return 'NO_COINCIDE';
}

/**
 * Construye una nota concisa (<= 480 caracteres para cumplir firestore.rules max 500)
 * con el resumen de la verificación facial y documental.
 */
export function buildBiometricAuditNote(result: BiometricVerificationResult): string {
  const label = BIOMETRIC_VERDICT_LABELS[result.verdict] || result.verdict;
  const docPart = result.extractedDocNumber ? ` · Doc OCR: ${result.extractedDocNumber}` : '';
  const raw = `[Biometría IA · ${label} · Similitud ${Math.round(
    result.similarityScore
  )}% · Liveness: ${result.livenessAssessment}${docPart}] ${result.comparisonRationale}`;
  return raw.slice(0, 480);
}
