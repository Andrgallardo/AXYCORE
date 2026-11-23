export const MAX_INSTITUTIONAL_LOGO_RAW_BYTES = 5 * 1024 * 1024; // 5 MB raw upload cap
export const MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH = 340_000; // Strictly under 350,000 Firestore rule cap
const MAX_LOGO_DIMENSION_PX = 512;

const ALLOWED_LOGO_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export function isValidInstitutionalLogoUrl(url?: string | null): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH + 10_000) {
    return false;
  }
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  if (/^https?:\/\/\S+$/i.test(trimmed) && trimmed.length <= 2048) {
    return true;
  }
  if (/^\/assets\/\S+$/i.test(trimmed) && trimmed.length <= 600) {
    return true;
  }
  return false;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer el archivo seleccionado.'));
      }
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo de imagen.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('No se pudo procesar la imagen. Intente con un archivo PNG, JPG o WebP válido.'));
    img.src = src;
  });
}

/**
 * Validates and optimizes an institutional logo file on the client side into a crisp,
 * XSS-safe raster data URL (PNG/WebP/JPEG) that fits cleanly inside Firestore document limits.
 */
export async function processInstitutionalLogoFile(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  bytesApprox: number;
}> {
  if (!file) {
    throw new Error('Seleccione un archivo de imagen.');
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_LOGO_MIME_TYPES.has(mime)) {
    throw new Error('Formato no compatible. Usa una imagen PNG, JPG, WebP o SVG.');
  }
  if (file.size > MAX_INSTITUTIONAL_LOGO_RAW_BYTES) {
    throw new Error('El archivo supera el límite de 5 MB. Selecciona una imagen más ligera.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const naturalWidth = img.naturalWidth || img.width || 256;
  const naturalHeight = img.naturalHeight || img.height || 256;

  // Try progressive dimension & format steps until strictly below MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH
  const dimensionSteps = [MAX_LOGO_DIMENSION_PX, 384, 256, 192];
  for (const maxDim of dimensionSteps) {
    const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('El navegador no pudo inicializar el lienzo para optimizar el logo.');
    }
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Prefer lossless/transparent PNG first when compact, then WebP (keeps transparency), then JPEG
    const pngUrl = canvas.toDataURL('image/png');
    if (pngUrl.length <= MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH) {
      return {
        dataUrl: pngUrl,
        width: targetWidth,
        height: targetHeight,
        bytesApprox: Math.round((pngUrl.length * 3) / 4),
      };
    }

    for (const quality of [0.9, 0.8, 0.7]) {
      const webpUrl = canvas.toDataURL('image/webp', quality);
      if (
        webpUrl.startsWith('data:image/webp;base64,') &&
        webpUrl.length <= MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH
      ) {
        return {
          dataUrl: webpUrl,
          width: targetWidth,
          height: targetHeight,
          bytesApprox: Math.round((webpUrl.length * 3) / 4),
        };
      }
    }

    // Fallback JPEG with crisp white canvas fill if transparency wasn't compact enough
    const jpegCanvas = document.createElement('canvas');
    jpegCanvas.width = targetWidth;
    jpegCanvas.height = targetHeight;
    const jpegCtx = jpegCanvas.getContext('2d');
    if (jpegCtx) {
      jpegCtx.fillStyle = '#FFFFFF';
      jpegCtx.fillRect(0, 0, targetWidth, targetHeight);
      jpegCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
      for (const quality of [0.88, 0.78, 0.68]) {
        const jpegUrl = jpegCanvas.toDataURL('image/jpeg', quality);
        if (jpegUrl.length <= MAX_INSTITUTIONAL_LOGO_DATA_URL_LENGTH) {
          return {
            dataUrl: jpegUrl,
            width: targetWidth,
            height: targetHeight,
            bytesApprox: Math.round((jpegUrl.length * 3) / 4),
          };
        }
      }
    }
  }

  throw new Error(
    'No fue posible comprimir el logo por debajo del tamaño permitido. Intenta con una imagen más pequeña.'
  );
}
