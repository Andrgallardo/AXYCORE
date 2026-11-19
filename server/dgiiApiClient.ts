import type { DgiiEnvironment, DgiiEnvironmentEndpoints } from '../src/types/dgiiEcf';
import {
  loadDecryptedCertificateFromVault,
  signDgiiXmlEnveloped,
} from './dgiiCryptoAndSigner';

interface CachedDgiiToken {
  token: string;
  expiresAtMs: number;
  issuedAtIso: string;
}

const tokenCache = new Map<string, CachedDgiiToken>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs = 15000,
  maxRetries = 2
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(350 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Error de red comunicándose con servicios DGII.');
}

export async function authenticateWithDgii(params: {
  organizationId: string;
  environment: DgiiEnvironment;
  endpoints: DgiiEnvironmentEndpoints;
  vaultKeyId: string;
  timeoutMs?: number;
  maxRetries?: number;
  forceRefresh?: boolean;
}): Promise<{
  token: string;
  expiresAtIso: string;
  isOfficialDgiiResponse: boolean;
  message: string;
}> {
  const {
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    timeoutMs = 15000,
    maxRetries = 2,
    forceRefresh = false,
  } = params;

  if (environment === 'DESARROLLO') {
    return {
      token: 'DEV_LOCAL_SANDBOX_NO_OFFICIAL_TOKEN',
      expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
      isOfficialDgiiResponse: false,
      message:
        'Modo DESARROLLO local activo. No se solicitó token real a DGII (cambie a PRECERTIFICACION o CERTIFICACION para conectar a servidores oficiales).',
    };
  }

  const cacheKey = `${organizationId}:${environment}:${vaultKeyId}`;
  const cached = tokenCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs - Date.now() > 60_000) {
    return {
      token: cached.token,
      expiresAtIso: new Date(cached.expiresAtMs).toISOString(),
      isOfficialDgiiResponse: true,
      message: 'Token oficial DGII reutilizado desde caché vigente.',
    };
  }

  // Step 1: GET Semilla
  const seedRes = await fetchWithRetry(
    endpoints.authSeedUrl,
    { method: 'GET', headers: { Accept: 'application/xml, text/xml' } },
    timeoutMs,
    maxRetries
  );
  if (!seedRes.ok) {
    const body = await seedRes.text().catch(() => '');
    throw new Error(`DGII Semilla respondió HTTP ${seedRes.status}: ${body.slice(0, 300)}`);
  }
  const seedXml = await seedRes.text();

  // Step 2: Sign Semilla XML with organization's PKCS#12 key from AES-256-GCM vault
  const { privateKeyPem, certificatePem } = loadDecryptedCertificateFromVault({
    organizationId,
    vaultKeyId,
  });
  const { signedXml: signedSeedXml } = signDgiiXmlEnveloped({
    xml: seedXml,
    privateKeyPem,
    certificatePem,
  });

  // Step 3: POST ValidarSemilla with multipart/form-data XML file
  const form = new FormData();
  form.append(
    'xml',
    new Blob([signedSeedXml], { type: 'application/xml' }),
    'semilla_firmada.xml'
  );

  const valRes = await fetchWithRetry(
    endpoints.authValidateUrl,
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
    },
    timeoutMs,
    maxRetries
  );

  const valText = await valRes.text();
  if (!valRes.ok) {
    throw new Error(`DGII ValidarSemilla HTTP ${valRes.status}: ${valText.slice(0, 400)}`);
  }

  let parsed: { token?: string; expira?: string } = {};
  try {
    parsed = JSON.parse(valText) as { token?: string; expira?: string };
  } catch {
    throw new Error(`Respuesta inesperada de DGII ValidarSemilla: ${valText.slice(0, 250)}`);
  }

  if (!parsed.token) {
    throw new Error(`DGII ValidarSemilla no devolvió token válido: ${valText.slice(0, 250)}`);
  }

  const expiresAtIso = parsed.expira || new Date(Date.now() + 55 * 60_000).toISOString();
  const expiresAtMs = Date.parse(expiresAtIso) || Date.now() + 55 * 60_000;
  tokenCache.set(cacheKey, {
    token: parsed.token,
    expiresAtMs,
    issuedAtIso: new Date().toISOString(),
  });

  return {
    token: parsed.token,
    expiresAtIso,
    isOfficialDgiiResponse: true,
    message: `Autenticación exitosa ante DGII (${environment}).`,
  };
}

export async function submitSignedEcfToDgii(params: {
  organizationId: string;
  environment: DgiiEnvironment;
  endpoints: DgiiEnvironmentEndpoints;
  vaultKeyId: string;
  signedXml: string;
  fileName: string;
  isRfceSummary?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{
  httpStatus: number;
  trackId?: string;
  code: string;
  message: string;
  isOfficialDgiiResponse: boolean;
  rawBody: string;
}> {
  const {
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    signedXml,
    fileName,
    isRfceSummary = false,
    timeoutMs = 15000,
    maxRetries = 2,
  } = params;

  if (environment === 'DESARROLLO') {
    return {
      httpStatus: 200,
      trackId: `DEV-LOCAL-${Date.now().toString(36).toUpperCase()}`,
      code: 'DEV_SANDBOX_VALIDATED',
      message:
        'Comprobante firmado y validado estructuralmente en Ambiente de Desarrollo local. NO fue transmitido ni aceptado oficialmente por la DGII.',
      isOfficialDgiiResponse: false,
      rawBody: JSON.stringify({
        simulated: true,
        environment: 'DESARROLLO',
        note: 'Use PRECERTIFICACION / CERTIFICACION con certificado INDOTEL para transmisión real a DGII.',
      }),
    };
  }

  const auth = await authenticateWithDgii({
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    timeoutMs,
    maxRetries,
  });

  const targetUrl = isRfceSummary ? endpoints.receptionFcUrl : endpoints.receptionUrl;
  const form = new FormData();
  form.append('xml', new Blob([signedXml], { type: 'text/xml' }), fileName);

  let res = await fetchWithRetry(
    targetUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/json',
      },
      body: form,
    },
    timeoutMs,
    maxRetries
  );

  // Token expired mid-flight -> refresh once and retry
  if (res.status === 401) {
    const refreshed = await authenticateWithDgii({
      organizationId,
      environment,
      endpoints,
      vaultKeyId,
      timeoutMs,
      maxRetries,
      forceRefresh: true,
    });
    const retryForm = new FormData();
    retryForm.append('xml', new Blob([signedXml], { type: 'text/xml' }), fileName);
    res = await fetchWithRetry(
      targetUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${refreshed.token}`,
          Accept: 'application/json',
        },
        body: retryForm,
      },
      timeoutMs,
      maxRetries
    );
  }

  const rawBody = await res.text();
  let parsed: { trackId?: string; codigo?: string; estado?: string; mensajes?: unknown; error?: string } = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // non-json response
  }

  return {
    httpStatus: res.status,
    trackId: parsed.trackId,
    code: parsed.codigo || parsed.estado || `HTTP_${res.status}`,
    message:
      parsed.error ||
      parsed.estado ||
      (res.ok ? 'Recibido por DGII.' : `DGII respondió HTTP ${res.status}`),
    isOfficialDgiiResponse: true,
    rawBody: rawBody.slice(0, 1500),
  };
}

export async function queryDgiiTrackIdStatus(params: {
  organizationId: string;
  environment: DgiiEnvironment;
  endpoints: DgiiEnvironmentEndpoints;
  vaultKeyId: string;
  trackId: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{
  httpStatus: number;
  dgiiStatusCode: string;
  mappedStatus: 'ACEPTADA' | 'ACEPTADA_CONDICIONAL' | 'RECHAZADA' | 'PENDIENTE_RESPUESTA' | 'ERROR_COMUNICACION';
  messages: string[];
  isOfficialDgiiResponse: boolean;
  rawBody: string;
}> {
  const {
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    trackId,
    timeoutMs = 15000,
    maxRetries = 2,
  } = params;

  if (environment === 'DESARROLLO' || trackId.startsWith('DEV-LOCAL-')) {
    return {
      httpStatus: 200,
      dgiiStatusCode: 'DEV_LOCAL_SIMULATION',
      mappedStatus: 'PENDIENTE_RESPUESTA',
      messages: [
        'TrackId perteneciente a Ambiente de Desarrollo local. No existe consulta oficial en servidores DGII.',
      ],
      isOfficialDgiiResponse: false,
      rawBody: JSON.stringify({ trackId, simulated: true }),
    };
  }

  const auth = await authenticateWithDgii({
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    timeoutMs,
    maxRetries,
  });

  const url = `${endpoints.trackResultUrl}?TrackId=${encodeURIComponent(trackId)}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/json',
      },
    },
    timeoutMs,
    maxRetries
  );

  const rawBody = await res.text();
  let parsed: {
    codigo?: string | number;
    estado?: string;
    mensajes?: Array<{ valor?: string; codigo?: string }>;
  } = {};
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // ignore
  }

  const estadoUpper = String(parsed.estado || '').toUpperCase();
  let mappedStatus:
    | 'ACEPTADA'
    | 'ACEPTADA_CONDICIONAL'
    | 'RECHAZADA'
    | 'PENDIENTE_RESPUESTA'
    | 'ERROR_COMUNICACION' = 'PENDIENTE_RESPUESTA';

  if (!res.ok) {
    mappedStatus = 'ERROR_COMUNICACION';
  } else if (estadoUpper.includes('CONDICIONAL')) {
    mappedStatus = 'ACEPTADA_CONDICIONAL';
  } else if (estadoUpper.includes('ACEPTADO') || estadoUpper.includes('ACEPTADA')) {
    mappedStatus = 'ACEPTADA';
  } else if (estadoUpper.includes('RECHAZADO') || estadoUpper.includes('RECHAZADA')) {
    mappedStatus = 'RECHAZADA';
  }

  const messages = (parsed.mensajes || [])
    .map((m) => `${m.codigo ? `[${m.codigo}] ` : ''}${m.valor || ''}`.trim())
    .filter(Boolean);

  return {
    httpStatus: res.status,
    dgiiStatusCode: String(parsed.codigo ?? parsed.estado ?? res.status),
    mappedStatus,
    messages: messages.length > 0 ? messages : [parsed.estado || `HTTP ${res.status}`],
    isOfficialDgiiResponse: true,
    rawBody: rawBody.slice(0, 1500),
  };
}

export async function sendSignedOperationToDgii(params: {
  organizationId: string;
  environment: DgiiEnvironment;
  endpoints: DgiiEnvironmentEndpoints;
  vaultKeyId: string;
  targetUrl: string;
  signedXml: string;
  fileName: string;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<{
  httpStatus: number;
  code: string;
  message: string;
  isOfficialDgiiResponse: boolean;
  rawBody: string;
}> {
  const {
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    targetUrl,
    signedXml,
    fileName,
    timeoutMs = 15000,
    maxRetries = 2,
  } = params;

  if (environment === 'DESARROLLO') {
    return {
      httpStatus: 200,
      code: 'DEV_LOCAL_PREPARED',
      message: 'Documento XML firmado localmente en ambiente DESARROLLO. No enviado a DGII.',
      isOfficialDgiiResponse: false,
      rawBody: JSON.stringify({ simulated: true }),
    };
  }

  const auth = await authenticateWithDgii({
    organizationId,
    environment,
    endpoints,
    vaultKeyId,
    timeoutMs,
    maxRetries,
  });

  const form = new FormData();
  form.append('xml', new Blob([signedXml], { type: 'text/xml' }), fileName);

  const res = await fetchWithRetry(
    targetUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/json',
      },
      body: form,
    },
    timeoutMs,
    maxRetries
  );

  const rawBody = await res.text();
  return {
    httpStatus: res.status,
    code: `HTTP_${res.status}`,
    message: res.ok ? 'Transacción procesada por DGII.' : `DGII respondió HTTP ${res.status}`,
    isOfficialDgiiResponse: true,
    rawBody: rawBody.slice(0, 1500),
  };
}

export async function checkDgiiServiceStatus(serviceStatusUrl: string, timeoutMs = 10000) {
  const res = await fetchWithRetry(
    serviceStatusUrl,
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
    1
  );
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text
  }
  return {
    httpStatus: res.status,
    ok: res.ok,
    data,
  };
}
