import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

const VAULT_DIR = path.resolve(process.cwd(), '.dgii-vault');
const LOCAL_DEV_KEY_FILE = path.join(VAULT_DIR, '.master.key');

function ensureVaultDir() {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
}

function getMasterKeyBuffer(): { key: Buffer; usingEnvKey: boolean } {
  const envKey = (process.env.DGII_CERT_MASTER_KEY || '').trim();
  if (envKey.length >= 16) {
    return {
      key: crypto.createHash('sha256').update(envKey).digest(),
      usingEnvKey: true,
    };
  }
  ensureVaultDir();
  if (!fs.existsSync(LOCAL_DEV_KEY_FILE)) {
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(LOCAL_DEV_KEY_FILE, generated, { mode: 0o600 });
  }
  const raw = fs.readFileSync(LOCAL_DEV_KEY_FILE, 'utf8').trim();
  return {
    key: crypto.createHash('sha256').update(raw).digest(),
    usingEnvKey: false,
  };
}

export interface ParsedPkcs12Summary {
  subjectCn: string;
  subjectRnc: string;
  issuerCn: string;
  serialNumber: string;
  fingerprintSha256: string;
  validFrom: string;
  validTo: string;
  privateKeyPem: string;
  certificatePem: string;
}

export function parsePkcs12Certificate(p12Base64: string, password: string): ParsedPkcs12Summary {
  const cleanB64 = String(p12Base64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!cleanB64) {
    throw new Error('El archivo de certificado (.p12/.pfx) está vacío.');
  }
  const derBytes = forge.util.decode64(cleanB64);
  const asn1 = forge.asn1.fromDer(derBytes);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const keyObj =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key ||
    plainKeyBags[forge.pki.oids.keyBag]?.[0]?.key;

  if (!keyObj) {
    throw new Error('No se encontró clave privada RSA válida dentro del archivo PKCS#12.');
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (certBags[forge.pki.oids.certBag] || [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));

  if (certs.length === 0) {
    throw new Error('No se encontró certificado X.509 dentro del archivo PKCS#12.');
  }

  // Pick the end-entity leaf certificate (prefer one matching private key or non-CA)
  const leafCert =
    certs.find((c) => {
      const bc = c.getExtension('basicConstraints') as { cA?: boolean } | undefined;
      return !bc?.cA;
    }) || certs[0];

  const privateKeyPem = forge.pki.privateKeyToPem(keyObj);
  const certificatePem = forge.pki.certificateToPem(leafCert);
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(leafCert)).getBytes();
  const fingerprintSha256 = crypto
    .createHash('sha256')
    .update(Buffer.from(certDer, 'binary'))
    .digest('hex')
    .toUpperCase();

  const cnAttr = leafCert.subject.getField('CN');
  const serialAttr = leafCert.subject.getField('serialNumber');
  const ouAttr = leafCert.subject.getField('OU');
  const subjectCn = String(cnAttr?.value || 'Titular Certificado Digital');
  const issuerCn = String(leafCert.issuer.getField('CN')?.value || 'Autoridad Certificadora INDOTEL');

  const rncCandidate = [serialAttr?.value, ouAttr?.value, subjectCn]
    .filter(Boolean)
    .map((v) => String(v))
    .join(' ');
  const rncMatch = rncCandidate.match(/\b(\d{9}|\d{11})\b/);
  const subjectRnc = rncMatch ? rncMatch[1] : '';

  return {
    subjectCn,
    subjectRnc,
    issuerCn,
    serialNumber: leafCert.serialNumber.toUpperCase(),
    fingerprintSha256,
    validFrom: leafCert.validity.notBefore.toISOString(),
    validTo: leafCert.validity.notAfter.toISOString(),
    privateKeyPem,
    certificatePem,
  };
}

interface EncryptedVaultRecord {
  vaultKeyId: string;
  organizationId: string;
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  createdAtIso: string;
}

export function storeEncryptedCertificateInVault(params: {
  organizationId: string;
  vaultKeyId: string;
  privateKeyPem: string;
  certificatePem: string;
}): { usingEnvMasterKey: boolean } {
  ensureVaultDir();
  const { key, usingEnvKey } = getMasterKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const secretPayload = JSON.stringify({
    organizationId: params.organizationId,
    privateKeyPem: params.privateKeyPem,
    certificatePem: params.certificatePem,
  });
  const encrypted = Buffer.concat([cipher.update(secretPayload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const vaultFile = path.join(VAULT_DIR, `${params.vaultKeyId}.enc.json`);
  const payload: EncryptedVaultRecord = {
    vaultKeyId: params.vaultKeyId,
    organizationId: params.organizationId,
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: encrypted.toString('hex'),
    createdAtIso: new Date().toISOString(),
  };
  fs.writeFileSync(vaultFile, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return { usingEnvMasterKey: usingEnvKey };
}

export function loadDecryptedCertificateFromVault(params: {
  organizationId: string;
  vaultKeyId: string;
}): { privateKeyPem: string; certificatePem: string } {
  const safeId = params.vaultKeyId.replace(/[^a-zA-Z0-9_-]/g, '');
  const vaultFile = path.join(VAULT_DIR, `${safeId}.enc.json`);
  if (!fs.existsSync(vaultFile)) {
    throw new Error(
      'Certificado digital no encontrado en la bóveda cifrada del servidor. Por favor cárguelo nuevamente en Certificados Digitales.'
    );
  }
  const raw: EncryptedVaultRecord = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
  if (raw.organizationId !== params.organizationId) {
    throw new Error('Violación Multi-Tenant: el certificado solicitado pertenece a otra organización.');
  }
  const { key } = getMasterKeyBuffer();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(raw.authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(raw.ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = JSON.parse(decrypted) as {
    organizationId: string;
    privateKeyPem: string;
    certificatePem: string;
  };
  if (parsed.organizationId !== params.organizationId) {
    throw new Error('Violación de integridad Multi-Tenant en bóveda de certificados.');
  }
  return {
    privateKeyPem: parsed.privateKeyPem,
    certificatePem: parsed.certificatePem,
  };
}

function pemCertToRawBase64(certPem: string): string {
  return certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * Signs DGII XML (<ECF>, <RFCE>, <ACECF>, <ANECF>, <ARECF>, or <SemillaModel>) using XMLDSig RSA-SHA256
 * with enveloped-signature transform and X509Data KeyInfo, returning signed XML and 6-char CodigoSeguridad.
 */
export function signDgiiXmlEnveloped(params: {
  xml: string;
  privateKeyPem: string;
  certificatePem: string;
}): { signedXml: string; securityCode: string; sha256Hex: string } {
  const { xml, privateKeyPem, certificatePem } = params;
  const rawCertB64 = pemCertToRawBase64(certificatePem);

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${rawCertB64}</X509Certificate></X509Data>`,
  });

  sig.addReference({
    xpath: '/*',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    isEmptyUri: true,
  });

  sig.computeSignature(xml, {
    location: { reference: '/*', action: 'append' },
  });

  const signedXml = sig.getSignedXml();
  const match = signedXml.match(/<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/i);
  const sigValue = (match?.[1] || '').replace(/\s+/g, '');
  const securityCode = sigValue.slice(0, 6);
  const sha256Hex = crypto.createHash('sha256').update(signedXml, 'utf8').digest('hex');

  return {
    signedXml,
    securityCode,
    sha256Hex,
  };
}

/**
 * Verifies an enveloped XMLDSig signature on an incoming supplier e-CF XML.
 */
export function verifySupplierXmlSignature(signedXml: string): {
  valid: boolean;
  signerCn?: string;
  securityCode?: string;
  reason?: string;
} {
  try {
    const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
    const sigNodes = doc.getElementsByTagName('Signature');
    if (!sigNodes || sigNodes.length === 0) {
      return { valid: false, reason: 'El XML no contiene elemento <Signature> de firma digital.' };
    }
    const certNodes = doc.getElementsByTagName('X509Certificate');
    if (!certNodes || certNodes.length === 0 || !certNodes[0].textContent) {
      return { valid: false, reason: 'El XML no incluye certificado X509Certificate embebido.' };
    }
    const rawB64 = certNodes[0].textContent.replace(/\s+/g, '');
    const certPem = [
      '-----BEGIN CERTIFICATE-----',
      ...(rawB64.match(/.{1,64}/g) || [rawB64]),
      '-----END CERTIFICATE-----',
    ].join('\n');

    const verifier = new SignedXml({ publicCert: certPem });
    verifier.loadSignature(sigNodes[0] as unknown as Node);
    const valid = verifier.checkSignature(signedXml);

    const parsedCert = forge.pki.certificateFromPem(certPem);
    const signerCn = String(parsedCert.subject.getField('CN')?.value || 'Emisor X.509');
    const sigValMatch = signedXml.match(/<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/i);
    const securityCode = (sigValMatch?.[1] || '').replace(/\s+/g, '').slice(0, 6);

    return {
      valid,
      signerCn,
      securityCode,
      reason: valid ? undefined : 'La firma criptográfica RSA-SHA256 no coincide con el contenido XML.',
    };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Error analizando firma XMLDSig.',
    };
  }
}

/**
 * Generates an ephemeral self-signed X.509 cert + PKCS#12 ONLY for local DESARROLLO sandbox testing
 * when the user explicitly requests a non-official development test certificate.
 */
export function generateDevOnlyTestPkcs12(params: {
  rnc: string;
  legalName: string;
  password: string;
}): { p12Base64: string; summary: ParsedPkcs12Summary } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  const now = new Date();
  cert.validity.notBefore = now;
  const exp = new Date(now.getTime());
  exp.setFullYear(exp.getFullYear() + 1);
  cert.validity.notAfter = exp;

  const attrs = [
    { name: 'commonName', value: `${params.legalName} (SOLO PRUEBAS DEV)` },
    { name: 'serialNumber', value: `RNC-${params.rnc}` },
    { name: 'countryName', value: 'DO' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer([
    { name: 'commonName', value: 'AxyCore Local Sandbox CA (NO OFICIAL)' },
    { name: 'countryName', value: 'DO' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], params.password, {
    algorithm: '3des',
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const p12Base64 = forge.util.encode64(p12Der);
  const summary = parsePkcs12Certificate(p12Base64, params.password);
  return { p12Base64, summary };
}
