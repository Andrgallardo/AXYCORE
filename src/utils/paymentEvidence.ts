import type { PaymentRecord, PaymentStatus } from '../types/collections';

export interface EncodedPaymentEvidence {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export const MAX_EVIDENCE_DATA_URL_LENGTH = 680_000;
export const MAX_PDF_EVIDENCE_BYTES = 500_000;
export const MAX_IMAGE_INPUT_BYTES = 10_000_000;

export function isPaymentPendingValidation(status: PaymentStatus | string | undefined): boolean {
  return (
    status === 'REPORTADO' ||
    status === 'RECIBIDO_PENDIENTE_VERIFICACION' ||
    status === 'VERIFICADO'
  );
}

export function getPaymentValidationStatusLabel(status: PaymentStatus | string): string {
  switch (status) {
    case 'REPORTADO':
    case 'RECIBIDO_PENDIENTE_VERIFICACION':
    case 'VERIFICADO':
      return 'Pendiente de Validación';
    case 'APLICADO':
      return 'Validado y Aplicado';
    case 'RECHAZADO':
      return 'Rechazado';
    case 'REVERTIDO':
      return 'Revertido';
    default:
      return status;
  }
}

export function formatEvidenceFileSize(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer el comprobante seleccionado.'));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(rawDataUrl: string, maxDimension = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDimension / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(rawDataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const attempts = [0.78, 0.62, 0.45];
      for (const quality of attempts) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        if (candidate.length <= MAX_EVIDENCE_DATA_URL_LENGTH) {
          resolve(candidate);
          return;
        }
      }
      resolve(canvas.toDataURL('image/jpeg', 0.35));
    };
    img.onerror = () => reject(new Error('No se pudo procesar la imagen del comprobante.'));
    img.src = rawDataUrl;
  });
}

/**
 * Validates and encodes a payment comprobante (image or PDF) so it safely fits within
 * Firestore's document size limit while preserving legibility for accounting validation.
 */
export async function processPaymentEvidenceFile(file: File): Promise<EncodedPaymentEvidence> {
  const mime = (file.type || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isImage && !isPdf) {
    throw new Error('Formato no soportado. Sube una imagen (JPG, PNG, WEBP) o un archivo PDF.');
  }

  if (isPdf) {
    if (file.size > MAX_PDF_EVIDENCE_BYTES) {
      throw new Error(
        'El comprobante PDF supera 500 KB. Comprímelo o sube una captura de imagen del comprobante.'
      );
    }
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl.length > MAX_EVIDENCE_DATA_URL_LENGTH) {
      throw new Error('El archivo PDF codificado supera el límite permitido (~500 KB).');
    }
    return {
      fileName: file.name.slice(0, 220),
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      dataUrl,
    };
  }

  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error('La imagen supera 10 MB. Selecciona una foto o captura más liviana.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const finalDataUrl =
    rawDataUrl.length <= MAX_EVIDENCE_DATA_URL_LENGTH
      ? rawDataUrl
      : await compressImageDataUrl(rawDataUrl);

  if (finalDataUrl.length > MAX_EVIDENCE_DATA_URL_LENGTH) {
    throw new Error(
      'No fue posible comprimir la imagen por debajo del límite permitido. Intenta con una captura más pequeña.'
    );
  }

  const finalMime = finalDataUrl.startsWith('data:image/jpeg')
    ? 'image/jpeg'
    : mime || 'image/jpeg';

  return {
    fileName: file.name.slice(0, 220),
    mimeType: finalMime,
    sizeBytes: Math.round((finalDataUrl.length * 3) / 4),
    dataUrl: finalDataUrl,
  };
}

export function downloadPaymentEvidence(payment: PaymentRecord): void {
  if (!payment.receiptEvidenceDataUrl) return;
  const link = document.createElement('a');
  link.href = payment.receiptEvidenceDataUrl;
  link.download =
    payment.receiptEvidenceName || `comprobante_${payment.loanNumber}_${payment.referenceNumber}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
