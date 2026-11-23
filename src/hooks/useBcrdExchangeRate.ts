import { useCallback, useEffect, useState } from 'react';

export interface BcrdExchangeRateState {
  rate: number;
  fecha: string | null;
  fuente: string;
  obtenidaEn: string | null;
  automatica: boolean;
  respaldo: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface BcrdApiPayload {
  ok?: boolean;
  venta?: number;
  fecha?: string | null;
  fuente?: string;
  obtenidaEn?: string | null;
  respaldo?: boolean;
  automatica?: boolean;
  error?: string;
}

const DEFAULT_FALLBACK_RATE = 60.0;

/**
 * Obtiene automáticamente la tasa de cambio oficial de venta USD → DOP
 * publicada por el Banco Central de la República Dominicana (BCRD)
 * mediante el endpoint /api/exchange-rate/bcrd.
 */
export function useBcrdExchangeRate(fallbackRate?: number): BcrdExchangeRateState {
  const safeFallback =
    typeof fallbackRate === 'number' && Number.isFinite(fallbackRate) && fallbackRate > 0
      ? fallbackRate
      : DEFAULT_FALLBACK_RATE;

  const [rate, setRate] = useState<number>(safeFallback);
  const [fecha, setFecha] = useState<string | null>(null);
  const [fuente, setFuente] = useState<string>(
    'Banco Central de la República Dominicana (BCRD)'
  );
  const [obtenidaEn, setObtenidaEn] = useState<string | null>(null);
  const [automatica, setAutomatica] = useState<boolean>(false);
  const [respaldo, setRespaldo] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRate = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const url = forceRefresh
          ? '/api/exchange-rate/bcrd?refresh=1'
          : '/api/exchange-rate/bcrd';
        const resp = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        const data = (await resp.json().catch(() => ({}))) as BcrdApiPayload;
        if (resp.ok && typeof data.venta === 'number' && Number.isFinite(data.venta) && data.venta > 0) {
          setRate(data.venta);
          setFecha(data.fecha || null);
          setFuente(data.fuente || 'Banco Central de la República Dominicana (BCRD)');
          setObtenidaEn(data.obtenidaEn || null);
          setAutomatica(Boolean(data.automatica ?? !data.respaldo));
          setRespaldo(Boolean(data.respaldo));
        } else {
          setError(data.error || 'No se pudo obtener la tasa oficial del BCRD');
          setRespaldo(true);
          setAutomatica(false);
        }
      } catch {
        setError('Sin conexión con el servicio de tasa BCRD; usando tasa de respaldo');
        setRespaldo(true);
        setAutomatica(false);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchRate(false);
  }, [fetchRate]);

  // If still on fallback and policy fallback changes, keep it synchronized
  useEffect(() => {
    if (!automatica && respaldo && !fecha) {
      setRate(safeFallback);
    }
  }, [automatica, respaldo, fecha, safeFallback]);

  const refresh = useCallback(async () => {
    await fetchRate(true);
  }, [fetchRate]);

  return {
    rate,
    fecha,
    fuente,
    obtenidaEn,
    automatica,
    respaldo,
    loading,
    error,
    refresh,
  };
}
