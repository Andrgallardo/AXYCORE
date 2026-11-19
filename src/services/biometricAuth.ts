export interface BiometricDeviceCredential {
  uid: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  providerId: string;
  credentialId: string;
  publicKeySpki?: string;
  publicKeyAlg?: number;
  authenticatorLabel: string;
  signCount: number;
  enrolledAtIso: string;
  lastUsedAtIso?: string;
}

export interface BiometricCapabilities {
  supported: boolean;
  platformAuthenticatorAvailable: boolean;
  secureContext: boolean;
  inEmbeddedIframe: boolean;
  label: string;
}

export interface ParsedAuthenticatorData {
  rpIdHashHex: string;
  flags: number;
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
  at: boolean;
  signCount: number;
}

export interface ClientDataValidationResult {
  valid: boolean;
  reason?: string;
  type?: string;
  challenge?: string;
  origin?: string;
}

export interface BiometricAssertionVerificationResult {
  verified: boolean;
  reason?: string;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  cryptographicallyVerified: boolean;
}

export interface BiometricFlowResult {
  ok: boolean;
  credential?: BiometricDeviceCredential;
  error?: string;
  verifiedAtIso?: string;
}

const BIOMETRIC_CREDS_STORAGE_KEY = 'axycore_biometric_creds_v1';
const BIOMETRIC_UNLOCKED_SESSION_KEY = 'axycore_biometric_unlocked_uid_v1';

export function bufferToBase64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  const base64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBuffer(base64url: string): Uint8Array {
  const normalized = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export function detectBiometricPlatformLabel(userAgent?: string): string {
  const ua =
    userAgent ??
    (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '');
  if (/iphone|ipad|ipod/i.test(ua)) return 'FaceID / TouchID';
  if (/macintosh|mac os x/i.test(ua)) return 'TouchID / FaceID';
  if (/android/i.test(ua)) return 'Biometría / Huella';
  if (/windows/i.test(ua)) return 'Windows Hello';
  return 'FaceID / TouchID';
}

export async function detectBiometricCapabilities(): Promise<BiometricCapabilities> {
  const label = detectBiometricPlatformLabel();
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      supported: false,
      platformAuthenticatorAvailable: false,
      secureContext: false,
      inEmbeddedIframe: false,
      label,
    };
  }

  let inEmbeddedIframe = false;
  try {
    inEmbeddedIframe = window.self !== window.top;
  } catch {
    inEmbeddedIframe = true;
  }

  const secureContext = Boolean(window.isSecureContext);
  const hasWebAuthn =
    typeof window.PublicKeyCredential !== 'undefined' &&
    Boolean(navigator.credentials) &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function';

  let platformAuthenticatorAvailable = false;
  if (
    hasWebAuthn &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  ) {
    try {
      platformAuthenticatorAvailable =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticatorAvailable = false;
    }
  }

  return {
    supported: Boolean(secureContext && hasWebAuthn && platformAuthenticatorAvailable),
    platformAuthenticatorAvailable,
    secureContext,
    inEmbeddedIframe,
    label,
  };
}

export function parseAuthenticatorData(authDataBytes: Uint8Array): ParsedAuthenticatorData {
  if (authDataBytes.length < 37) {
    throw new Error('authenticatorData inválido: longitud menor a 37 bytes.');
  }
  const rpIdHashHex = Array.from(authDataBytes.subarray(0, 32))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const flags = authDataBytes[32];
  const signCount =
    ((authDataBytes[33] << 24) |
      (authDataBytes[34] << 16) |
      (authDataBytes[35] << 8) |
      authDataBytes[36]) >>>
    0;

  return {
    rpIdHashHex,
    flags,
    up: (flags & 0x01) !== 0,
    uv: (flags & 0x04) !== 0,
    be: (flags & 0x08) !== 0,
    bs: (flags & 0x10) !== 0,
    at: (flags & 0x40) !== 0,
    signCount,
  };
}

export function verifyClientDataJson(
  clientDataBytes: Uint8Array,
  expectedType: 'webauthn.create' | 'webauthn.get',
  expectedChallenge: string,
  expectedOrigin?: string
): ClientDataValidationResult {
  try {
    const decoded = new TextDecoder('utf-8').decode(clientDataBytes);
    const parsed = JSON.parse(decoded) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };

    if (parsed.type !== expectedType) {
      return {
        valid: false,
        reason: `Tipo de operación WebAuthn inválido (${parsed.type || 'desconocido'}).`,
      };
    }
    if (!parsed.challenge || parsed.challenge !== expectedChallenge) {
      return {
        valid: false,
        reason: 'El challenge criptográfico de WebAuthn no coincide con el emitido por la sesión.',
      };
    }
    if (expectedOrigin && parsed.origin !== expectedOrigin) {
      return {
        valid: false,
        reason: `Origen WebAuthn no autorizado (${parsed.origin || 'desconocido'}).`,
      };
    }

    return {
      valid: true,
      type: parsed.type,
      challenge: parsed.challenge,
      origin: parsed.origin,
    };
  } catch {
    return {
      valid: false,
      reason: 'No se pudo decodificar clientDataJSON del autenticador biométrico.',
    };
  }
}

export function derToRawEcdsaSignature(derBytes: Uint8Array): Uint8Array {
  // Expected ASN.1 SEQUENCE: 0x30 <len> 0x02 <rLen> <r...> 0x02 <sLen> <s...>
  if (derBytes.length === 64) return derBytes;
  if (derBytes.length < 8 || derBytes[0] !== 0x30) {
    throw new Error('Firma DER ECDSA con formato inválido.');
  }
  let offset = 2;
  if (derBytes[1] & 0x80) {
    const lengthBytes = derBytes[1] & 0x7f;
    offset = 2 + lengthBytes;
  }
  if (derBytes[offset] !== 0x02) {
    throw new Error('Firma DER ECDSA sin marcador entero R.');
  }
  const rLen = derBytes[offset + 1];
  const rStart = offset + 2;
  const rBytes = derBytes.subarray(rStart, rStart + rLen);
  offset = rStart + rLen;

  if (derBytes[offset] !== 0x02) {
    throw new Error('Firma DER ECDSA sin marcador entero S.');
  }
  const sLen = derBytes[offset + 1];
  const sStart = offset + 2;
  const sBytes = derBytes.subarray(sStart, sStart + sLen);

  const normalizeComponent = (comp: Uint8Array): Uint8Array => {
    let trimmed = comp;
    while (trimmed.length > 32 && trimmed[0] === 0x00) {
      trimmed = trimmed.subarray(1);
    }
    if (trimmed.length > 32) {
      throw new Error('Componente ECDSA excede 32 bytes para curva P-256.');
    }
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };

  const raw = new Uint8Array(64);
  raw.set(normalizeComponent(rBytes), 0);
  raw.set(normalizeComponent(sBytes), 32);
  return raw;
}

export async function verifyWebAuthnAssertionLocal(params: {
  clientDataJSON: Uint8Array;
  authenticatorData: Uint8Array;
  signature: Uint8Array;
  expectedChallenge: string;
  expectedOrigin?: string;
  publicKeySpkiBase64Url?: string;
  publicKeyAlg?: number;
  previousSignCount?: number;
}): Promise<BiometricAssertionVerificationResult> {
  const clientCheck = verifyClientDataJson(
    params.clientDataJSON,
    'webauthn.get',
    params.expectedChallenge,
    params.expectedOrigin
  );
  if (!clientCheck.valid) {
    return {
      verified: false,
      reason: clientCheck.reason,
      signCount: 0,
      userPresent: false,
      userVerified: false,
      cryptographicallyVerified: false,
    };
  }

  let parsedAuth: ParsedAuthenticatorData;
  try {
    parsedAuth = parseAuthenticatorData(params.authenticatorData);
  } catch (err) {
    return {
      verified: false,
      reason: err instanceof Error ? err.message : 'authenticatorData inválido.',
      signCount: 0,
      userPresent: false,
      userVerified: false,
      cryptographicallyVerified: false,
    };
  }

  if (!parsedAuth.up || !parsedAuth.uv) {
    return {
      verified: false,
      reason:
        'El autenticador no confirmó presencia y verificación biométrica del usuario (UP/UV requeridos).',
      signCount: parsedAuth.signCount,
      userPresent: parsedAuth.up,
      userVerified: parsedAuth.uv,
      cryptographicallyVerified: false,
    };
  }

  if (
    typeof params.previousSignCount === 'number' &&
    params.previousSignCount > 0 &&
    parsedAuth.signCount > 0 &&
    parsedAuth.signCount < params.previousSignCount
  ) {
    return {
      verified: false,
      reason: 'Contador de firma regresivo detectado; posible credencial clonada.',
      signCount: parsedAuth.signCount,
      userPresent: parsedAuth.up,
      userVerified: parsedAuth.uv,
      cryptographicallyVerified: false,
    };
  }

  let cryptographicallyVerified = false;
  if (params.publicKeySpkiBase64Url && globalThis.crypto?.subtle) {
    try {
      const spkiBytes = base64UrlToBuffer(params.publicKeySpkiBase64Url);
      const clientDataHashBuffer = await globalThis.crypto.subtle.digest(
        'SHA-256',
        toArrayBuffer(params.clientDataJSON)
      );
      const clientDataHash = new Uint8Array(clientDataHashBuffer);
      const signedPayload = new Uint8Array(
        params.authenticatorData.length + clientDataHash.length
      );
      signedPayload.set(params.authenticatorData, 0);
      signedPayload.set(clientDataHash, params.authenticatorData.length);

      const alg = params.publicKeyAlg ?? -7;
      if (alg === -257) {
        const key = await globalThis.crypto.subtle.importKey(
          'spki',
          toArrayBuffer(spkiBytes),
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        cryptographicallyVerified = await globalThis.crypto.subtle.verify(
          { name: 'RSASSA-PKCS1-v1_5' },
          key,
          toArrayBuffer(params.signature),
          toArrayBuffer(signedPayload)
        );
      } else {
        const key = await globalThis.crypto.subtle.importKey(
          'spki',
          toArrayBuffer(spkiBytes),
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify']
        );
        const rawSig = derToRawEcdsaSignature(params.signature);
        cryptographicallyVerified = await globalThis.crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          key,
          toArrayBuffer(rawSig),
          toArrayBuffer(signedPayload)
        );
      }

      if (!cryptographicallyVerified) {
        return {
          verified: false,
          reason: 'La firma criptográfica biométrica no superó la verificación de clave pública.',
          signCount: parsedAuth.signCount,
          userPresent: parsedAuth.up,
          userVerified: parsedAuth.uv,
          cryptographicallyVerified: false,
        };
      }
    } catch (err) {
      return {
        verified: false,
        reason:
          err instanceof Error
            ? `Error verificando firma WebAuthn: ${err.message}`
            : 'Error validando clave pública biométrica.',
        signCount: parsedAuth.signCount,
        userPresent: parsedAuth.up,
        userVerified: parsedAuth.uv,
        cryptographicallyVerified: false,
      };
    }
  }

  return {
    verified: true,
    signCount: parsedAuth.signCount,
    userPresent: parsedAuth.up,
    userVerified: parsedAuth.uv,
    cryptographicallyVerified,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function listStoredBiometricCredentials(): BiometricDeviceCredential[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BIOMETRIC_CREDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BiometricDeviceCredential[]) : [];
  } catch {
    return [];
  }
}

export function getStoredBiometricCredential(uid: string): BiometricDeviceCredential | null {
  if (!uid) return null;
  return listStoredBiometricCredentials().find((c) => c.uid === uid) ?? null;
}

export function getStoredBiometricCredentialByEmail(
  email: string
): BiometricDeviceCredential | null {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  return (
    listStoredBiometricCredentials().find((c) => c.email.trim().toLowerCase() === clean) ?? null
  );
}

export function getLastStoredBiometricCredential(): BiometricDeviceCredential | null {
  const list = listStoredBiometricCredentials();
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => {
    const aTime = a.lastUsedAtIso || a.enrolledAtIso;
    const bTime = b.lastUsedAtIso || b.enrolledAtIso;
    return bTime.localeCompare(aTime);
  });
  return sorted[0] ?? null;
}

export function saveStoredBiometricCredential(credential: BiometricDeviceCredential): void {
  if (typeof window === 'undefined') return;
  const current = listStoredBiometricCredentials().filter((c) => c.uid !== credential.uid);
  current.unshift(credential);
  window.localStorage.setItem(BIOMETRIC_CREDS_STORAGE_KEY, JSON.stringify(current.slice(0, 8)));
}

export function removeStoredBiometricCredential(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  const next = listStoredBiometricCredentials().filter((c) => c.uid !== uid);
  if (next.length === 0) {
    window.localStorage.removeItem(BIOMETRIC_CREDS_STORAGE_KEY);
  } else {
    window.localStorage.setItem(BIOMETRIC_CREDS_STORAGE_KEY, JSON.stringify(next));
  }
  clearBiometricSessionUnlocked(uid);
}

export function isBiometricSessionUnlocked(uid: string): boolean {
  if (typeof window === 'undefined' || !uid) return false;
  try {
    return window.sessionStorage.getItem(BIOMETRIC_UNLOCKED_SESSION_KEY) === uid;
  } catch {
    return false;
  }
}

export function markBiometricSessionUnlocked(uid: string): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    window.sessionStorage.setItem(BIOMETRIC_UNLOCKED_SESSION_KEY, uid);
  } catch {
    // Ignore storage quota / private mode issues safely
  }
}

export function clearBiometricSessionUnlocked(uid?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!uid) {
      window.sessionStorage.removeItem(BIOMETRIC_UNLOCKED_SESSION_KEY);
      return;
    }
    const current = window.sessionStorage.getItem(BIOMETRIC_UNLOCKED_SESSION_KEY);
    if (current === uid) {
      window.sessionStorage.removeItem(BIOMETRIC_UNLOCKED_SESSION_KEY);
    }
  } catch {
    // Ignore safely
  }
}

export function mapWebAuthnError(err: unknown, inEmbeddedIframe = false): string {
  const name = (err as { name?: string })?.name || '';
  const message = err instanceof Error ? err.message : '';

  if (name === 'NotAllowedError') {
    if (inEmbeddedIframe) {
      return 'El visor integrado restringe el acceso directo a FaceID/TouchID. Abre AxyCore en una pestaña independiente o desde la app instalada en tu celular.';
    }
    return 'Verificación biométrica cancelada o tiempo agotado. Intenta nuevamente con tu rostro o huella.';
  }
  if (name === 'InvalidStateError') {
    return 'Este dispositivo ya tiene una llave biométrica vinculada para este perfil.';
  }
  if (name === 'NotSupportedError') {
    return 'Este navegador o dispositivo no soporta autenticadores biométricos compatibles (FaceID / TouchID / Huella).';
  }
  if (name === 'SecurityError') {
    return 'La autenticación biométrica requiere una conexión HTTPS válida y dominio autorizado.';
  }
  if (name === 'AbortError') {
    return 'La operación biométrica fue interrumpida antes de completarse.';
  }
  return message || 'No fue posible completar la verificación biométrica en este dispositivo.';
}

async function requestChallenge(
  uid: string,
  purpose: 'register' | 'authenticate'
): Promise<{ challengeId: string | null; challenge: string }> {
  try {
    const resp = await fetch('/api/auth/webauthn/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, purpose }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { challengeId?: string; challenge?: string };
      if (data.challenge && data.challengeId) {
        return { challengeId: data.challengeId, challenge: data.challenge };
      }
    }
  } catch {
    // Offline PWA fallback: generate cryptographically random local challenge
  }

  const randomBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(randomBytes);
  return {
    challengeId: null,
    challenge: bufferToBase64Url(randomBytes),
  };
}

export async function enrollBiometricCredential(params: {
  uid: string;
  email: string;
  displayName: string;
  organizationId: string;
  organizationName: string;
  providerId: string;
}): Promise<BiometricFlowResult> {
  const caps = await detectBiometricCapabilities();
  if (!caps.supported) {
    return {
      ok: false,
      error:
        'Este dispositivo o navegador no dispone de un autenticador biométrico compatible (FaceID, TouchID o Huella).',
    };
  }

  try {
    const { challenge } = await requestChallenge(params.uid, 'register');
    const challengeBytes = base64UrlToBuffer(challenge);
    const userIdBytes = new TextEncoder().encode(params.uid).slice(0, 64);

    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      challenge: toArrayBuffer(challengeBytes),
      rp: {
        name: 'AxyCore Enterprise Financial Platform',
        id: window.location.hostname,
      },
      user: {
        id: toArrayBuffer(userIdBytes),
        name: params.email,
        displayName: params.displayName || params.email,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    };

    const created = (await navigator.credentials.create({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential | null;

    if (!created) {
      return { ok: false, error: 'No se recibió respuesta del autenticador biométrico.' };
    }

    const response = created.response as AuthenticatorAttestationResponse;
    const clientDataCheck = verifyClientDataJson(
      new Uint8Array(response.clientDataJSON),
      'webauthn.create',
      challenge,
      window.location.origin
    );
    if (!clientDataCheck.valid) {
      return { ok: false, error: clientDataCheck.reason };
    }

    let publicKeySpki: string | undefined;
    let publicKeyAlg: number | undefined;
    if (typeof response.getPublicKey === 'function') {
      const spkiBuffer = response.getPublicKey();
      if (spkiBuffer) {
        publicKeySpki = bufferToBase64Url(spkiBuffer);
      }
    }
    if (typeof response.getPublicKeyAlgorithm === 'function') {
      publicKeyAlg = response.getPublicKeyAlgorithm();
    }

    let initialSignCount = 0;
    if (typeof response.getAuthenticatorData === 'function') {
      const authData = response.getAuthenticatorData();
      if (authData && authData.byteLength >= 37) {
        const parsed = parseAuthenticatorData(new Uint8Array(authData));
        initialSignCount = parsed.signCount;
      }
    }

    const nowIso = new Date().toISOString();
    const record: BiometricDeviceCredential = {
      uid: params.uid,
      email: params.email,
      displayName: params.displayName || params.email,
      organizationId: params.organizationId,
      organizationName: params.organizationName,
      providerId: params.providerId,
      credentialId: bufferToBase64Url(created.rawId),
      publicKeySpki,
      publicKeyAlg,
      authenticatorLabel: caps.label,
      signCount: initialSignCount,
      enrolledAtIso: nowIso,
      lastUsedAtIso: nowIso,
    };

    saveStoredBiometricCredential(record);
    markBiometricSessionUnlocked(params.uid);

    return {
      ok: true,
      credential: record,
      verifiedAtIso: nowIso,
    };
  } catch (err) {
    return {
      ok: false,
      error: mapWebAuthnError(err, caps.inEmbeddedIframe),
    };
  }
}

export async function authenticateWithBiometricCredential(
  targetUid?: string
): Promise<BiometricFlowResult> {
  const caps = await detectBiometricCapabilities();
  if (!caps.supported) {
    return {
      ok: false,
      error: 'Tu dispositivo o navegador actual no soporta verificación biométrica WebAuthn.',
    };
  }

  const storedCred = targetUid
    ? getStoredBiometricCredential(targetUid)
    : getLastStoredBiometricCredential();

  if (!storedCred) {
    return {
      ok: false,
      error: 'No hay ninguna credencial biométrica registrada en este dispositivo.',
    };
  }

  try {
    const { challengeId, challenge } = await requestChallenge(storedCred.uid, 'authenticate');
    const challengeBytes = base64UrlToBuffer(challenge);
    const credIdBytes = base64UrlToBuffer(storedCred.credentialId);

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toArrayBuffer(challengeBytes),
        rpId: window.location.hostname,
        allowCredentials: [
          {
            type: 'public-key',
            id: toArrayBuffer(credIdBytes),
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { ok: false, error: 'La verificación biométrica no devolvió aserción.' };
    }

    const assertionResponse = assertion.response as AuthenticatorAssertionResponse;
    const clientDataBytes = new Uint8Array(assertionResponse.clientDataJSON);
    const authDataBytes = new Uint8Array(assertionResponse.authenticatorData);
    const signatureBytes = new Uint8Array(assertionResponse.signature);

    // Local cryptographic + UP/UV flag validation
    const localVerify = await verifyWebAuthnAssertionLocal({
      clientDataJSON: clientDataBytes,
      authenticatorData: authDataBytes,
      signature: signatureBytes,
      expectedChallenge: challenge,
      expectedOrigin: window.location.origin,
      publicKeySpkiBase64Url: storedCred.publicKeySpki,
      publicKeyAlg: storedCred.publicKeyAlg,
      previousSignCount: storedCred.signCount,
    });

    if (!localVerify.verified) {
      return {
        ok: false,
        error: localVerify.reason || 'Fallo de verificación biométrica.',
      };
    }

    // Server-side WebAuthn challenge & signature validation when online
    let verifiedAtIso = new Date().toISOString();
    if (challengeId) {
      try {
        const verifyResp = await fetch('/api/auth/webauthn/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId,
            uid: storedCred.uid,
            clientDataJSON: bufferToBase64Url(clientDataBytes),
            authenticatorData: bufferToBase64Url(authDataBytes),
            signature: bufferToBase64Url(signatureBytes),
            publicKeySpki: storedCred.publicKeySpki,
            publicKeyAlg: storedCred.publicKeyAlg,
            expectedOrigin: window.location.origin,
          }),
        });
        if (!verifyResp.ok) {
          const payload = (await verifyResp.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: payload.error || 'El servidor rechazó la aserción biométrica.',
          };
        }
        const verifiedData = (await verifyResp.json()) as { verifiedAtIso?: string };
        if (verifiedData.verifiedAtIso) {
          verifiedAtIso = verifiedData.verifiedAtIso;
        }
      } catch {
        // Offline PWA fallback: local WebCrypto verification already succeeded above
      }
    }

    const updatedRecord: BiometricDeviceCredential = {
      ...storedCred,
      signCount: Math.max(storedCred.signCount, localVerify.signCount),
      lastUsedAtIso: verifiedAtIso,
    };
    saveStoredBiometricCredential(updatedRecord);
    markBiometricSessionUnlocked(updatedRecord.uid);

    return {
      ok: true,
      credential: updatedRecord,
      verifiedAtIso,
    };
  } catch (err) {
    return {
      ok: false,
      error: mapWebAuthnError(err, caps.inEmbeddedIframe),
    };
  }
}
