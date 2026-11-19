import type { ApplicationStatus, CurrencyCode, ProductCode, ScoringStatus } from '../types/axycore';

export function formatMoney(amount: number | null | undefined, currency: CurrencyCode = 'DOP'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizeMonthlyRateDecimal(
  rawRate: number | null | undefined,
  fallback = 0
): number {
  if (rawRate === null || rawRate === undefined || !Number.isFinite(rawRate) || rawRate < 0) {
    return fallback;
  }
  return rawRate > 1 ? Math.round((rawRate / 100) * 100000) / 100000 : rawRate;
}

export function formatRatePct(monthlyRate: number | null | undefined): string {
  if (monthlyRate === null || monthlyRate === undefined || !Number.isFinite(monthlyRate)) return '—';
  const normalized = normalizeMonthlyRateDecimal(monthlyRate, 0);
  return `${(normalized * 100).toFixed(2)}%`;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  try {
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
      return (ts as { toDate: () => Date }).toDate().toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
    }
    if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
      const secs = (ts as { seconds: number }).seconds;
      return new Date(secs * 1000).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
    }
  } catch {
    return '—';
  }
  return '—';
}

export function toIsoDateOnly(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export const PRODUCT_LABELS: Record<ProductCode, string> = {
  PERSONAL_DOP: 'Personal DOP',
  EMPRESARIAL_DOP: 'Empresarial DOP',
  PERSONAL_USD: 'Personal USD',
  EMPRESARIAL_USD: 'Empresarial USD',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  BORRADOR: 'Borrador',
  RECIBIDA: 'Recibida',
  EN_EVALUACION: 'En Evaluación',
  EN_COMITE: 'En Comité',
  APROBADA: 'Aprobada',
  APROBADA_CONDICIONADA: 'Aprobada Condicionada',
  DEVUELTA: 'Devuelta',
  RECHAZADA: 'Rechazada',
  FORMALIZADA: 'Formalizada',
  DESEMBOLSADA: 'Desembolsada',
};

export const SCORING_STATUS_LABELS: Record<ScoringStatus, string> = {
  PREOFERTA: 'Precalificado (Preoferta)',
  SIN_OFERTA: 'Sin oferta automática',
  SIN_OFERTA_CAPACIDAD: 'Sin oferta por capacidad',
  DATOS_INSUFICIENTES: 'Datos insuficientes',
  DATOS_INSUFICIENTES_DEUDA: 'Falta detalle de deudas',
  DATOS_INSUFICIENTES_CAMBIO: 'Sin tipo de cambio válido',
  SOLICITUD_FUERA_POLITICA: 'Fuera de política',
  ERROR_CALCULO: 'Error de cálculo',
};

export function maskAccountNumber(raw: string): string {
  const clean = raw.replace(/\s+/g, '');
  if (clean.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`;
}

export function sanitizeIdSegment(val: string): string {
  return val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export function formatUserFacingError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return fallback;
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string; path?: string | null; operationType?: string };
      const inner = String(parsed.error || '').trim();
      const pathSuffix = parsed.path ? ` (${parsed.path})` : '';
      if (/permission|insufficient/i.test(inner)) {
        return `Permisos insuficientes o estado inconsistente al actualizar el expediente${pathSuffix}. Verifica el estado actual o tu rol asignado.`;
      }
      if (/not-found|no document to update/i.test(inner)) {
        return `El documento aún no estaba sincronizado en la base de datos${pathSuffix}. Intenta nuevamente.`;
      }
      if (inner) {
        return `${inner}${pathSuffix}`;
      }
    } catch {
      // Fall through to raw message
    }
  }
  return raw;
}

