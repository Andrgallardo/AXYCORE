import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { generateId } from './axycoreStore';
import type { OrganizationRecord, UserProfile } from '../types/axycore';
import type {
  AccountingAccountRecord,
  DgiiAuditLogRecord,
  DgiiCertificateRecord,
  DgiiEcfDocumentRecord,
  DgiiEncfSequenceRecord,
  DgiiFiscalConfigRecord,
  DgiiProductRecord,
  DgiiReceiverRecord,
  DgiiResponseLog,
  EcfLifecycleStatus,
  EcfTypeCode,
  JournalEntryRecord,
} from '../types/dgiiEcf';
import {
  buildDefaultDgiiFiscalConfig,
  DEFAULT_CHART_OF_ACCOUNTS_TEMPLATE,
  formatEncf,
  round2,
  validateEcfBeforeIssuance,
} from '../engine/dgii/dgiiCatalogAndValidation';
import {
  buildDgiiEcfXml,
  buildDgiiRfceXml,
} from '../engine/dgii/dgiiXmlEngine';
import { validateEcfBeforeDigitalSignature } from '../engine/dgii/xmlValidator';
import {
  buildJournalEntryForEcfDocument,
  buildPaymentSettlementJournalEntry,
  buildReversalJournalEntry,
} from '../engine/dgii/dgiiAccountingBridge';
import { buildDgiiQrValidationUrl } from '../engine/dgii/dgiiQrAndPdfEngine';

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function saveDgiiFiscalConfig(params: {
  config: DgiiFiscalConfigRecord;
  user: UserProfile;
}): Promise<void> {
  const { config, user } = params;
  const ref = doc(db, 'dgii_fiscal_configs', config.organizationId);
  const existing = await getDoc(ref).catch(() => null);
  const batch = writeBatch(db);
  const cleanPayload = stripUndefined({
    ...config,
    id: config.organizationId,
    updatedBy: user.uid,
    createdAt: existing?.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(ref, cleanPayload, { merge: true });

  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: config.organizationId,
    eventType: 'CONFIG_UPDATED',
    environment: config.environment,
    summary: `Configuración fiscal DGII actualizada (${config.environment} · RNC ${config.rnc})`,
    details: `Tipos habilitados: ${config.enabledEcfTypes.join(', ')}`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_fiscal_configs/${config.organizationId}`);
  }
}

export async function seedDefaultChartOfAccounts(params: {
  organizationId: string;
  existingAccounts: AccountingAccountRecord[];
  user: UserProfile;
}): Promise<number> {
  const { organizationId, existingAccounts, user } = params;
  const existingCodes = new Set(existingAccounts.map((a) => a.code));
  const missing = DEFAULT_CHART_OF_ACCOUNTS_TEMPLATE.filter((t) => !existingCodes.has(t.code));
  if (missing.length === 0) return 0;

  const batch = writeBatch(db);
  for (const tpl of missing) {
    const id = `acc_${organizationId}_${tpl.code}`;
    batch.set(
      doc(db, 'accounting_accounts', id),
      stripUndefined({
        ...tpl,
        id,
        organizationId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'accounting_accounts');
  }
  return missing.length;
}

export async function createOrUpdateAccountingAccount(params: {
  account: Omit<AccountingAccountRecord, 'createdAt' | 'updatedAt'>;
  isNew: boolean;
}): Promise<void> {
  const { account, isNew } = params;
  const ref = doc(db, 'accounting_accounts', account.id);
  const existing = isNew ? null : await getDoc(ref).catch(() => null);
  try {
    const batch = writeBatch(db);
    batch.set(
      ref,
      stripUndefined({
        ...account,
        createdAt: existing?.exists() ? existing.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `accounting_accounts/${account.id}`);
  }
}

export async function createManualJournalEntry(params: {
  entry: Omit<JournalEntryRecord, 'createdAt' | 'updatedAt'>;
}): Promise<void> {
  const { entry } = params;
  if (round2(entry.totalDebit) !== round2(entry.totalCredit) || entry.totalDebit <= 0) {
    throw new Error('El asiento contable debe estar cuadrado (Débito == Crédito > 0).');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'accounting_journal_entries', entry.id),
    stripUndefined({
      ...entry,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `accounting_journal_entries/${entry.id}`);
  }
}

export async function reverseJournalEntry(params: {
  originalEntry: JournalEntryRecord;
  reason: string;
  user: UserProfile;
}): Promise<JournalEntryRecord> {
  const { originalEntry, reason, user } = params;
  if (originalEntry.status === 'REVERTIDO') {
    throw new Error('Este asiento ya fue revertido anteriormente.');
  }
  const reversalId = `je_rev_${originalEntry.id}`;
  const existingRev = await getDoc(doc(db, 'accounting_journal_entries', reversalId)).catch(() => null);
  if (existingRev?.exists()) {
    throw new Error('Ya existe un asiento de reverso para este comprobante.');
  }
  const reversal = buildReversalJournalEntry({
    originalEntry,
    entryId: reversalId,
    entryNumber: `REV-${originalEntry.entryNumber}`,
    reversalDate: new Date().toISOString().slice(0, 10),
    reason: reason.trim() || 'Ajuste / Reverso contable',
    actorUid: user.uid,
    actorName: user.displayName,
  });

  const batch = writeBatch(db);
  batch.set(
    doc(db, 'accounting_journal_entries', reversal.id),
    stripUndefined({
      ...reversal,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  batch.update(doc(db, 'accounting_journal_entries', originalEntry.id), {
    status: 'REVERTIDO',
    reversedEntryId: reversal.id,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `accounting_journal_entries/${originalEntry.id}`);
  }
  return reversal;
}

export async function saveDgiiReceiver(params: {
  receiver: Omit<DgiiReceiverRecord, 'createdAt' | 'updatedAt'>;
  isNew: boolean;
}): Promise<void> {
  const { receiver, isNew } = params;
  const ref = doc(db, 'dgii_receivers', receiver.id);
  const existing = isNew ? null : await getDoc(ref).catch(() => null);
  const batch = writeBatch(db);
  batch.set(
    ref,
    stripUndefined({
      ...receiver,
      createdAt: existing?.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_receivers/${receiver.id}`);
  }
}

export async function saveDgiiProduct(params: {
  product: Omit<DgiiProductRecord, 'createdAt' | 'updatedAt'>;
  isNew: boolean;
}): Promise<void> {
  const { product, isNew } = params;
  const ref = doc(db, 'dgii_products', product.id);
  const existing = isNew ? null : await getDoc(ref).catch(() => null);
  const batch = writeBatch(db);
  batch.set(
    ref,
    stripUndefined({
      ...product,
      createdAt: existing?.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_products/${product.id}`);
  }
}

export async function createDgiiSequenceRange(params: {
  sequence: Omit<DgiiEncfSequenceRecord, 'createdAt' | 'updatedAt'>;
  user: UserProfile;
  environment: DgiiFiscalConfigRecord['environment'];
}): Promise<void> {
  const { sequence, user, environment } = params;
  if (sequence.endSequence < sequence.startSequence) {
    throw new Error('La secuencia final debe ser mayor o igual a la inicial.');
  }
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'dgii_encf_sequences', sequence.id),
    stripUndefined({
      ...sequence,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: sequence.organizationId,
    eventType: 'SEQUENCE_CREATED',
    environment,
    summary: `Rango e-NCF ${sequence.prefix} registrado (${formatEncf(
      sequence.ecfType,
      sequence.startSequence
    )} - ${formatEncf(sequence.ecfType, sequence.endSequence)})`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `dgii_encf_sequences/${sequence.id}`);
  }
}

export async function updateDgiiSequenceStatus(params: {
  sequence: DgiiEncfSequenceRecord;
  status: DgiiEncfSequenceRecord['status'];
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'dgii_encf_sequences', params.sequence.id), {
    status: params.status,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `dgii_encf_sequences/${params.sequence.id}`);
  }
}

export async function saveDgiiCertificateMetadata(params: {
  cert: Omit<DgiiCertificateRecord, 'createdAt' | 'updatedAt'>;
  previousActiveCerts: DgiiCertificateRecord[];
  user: UserProfile;
  environment: DgiiFiscalConfigRecord['environment'];
}): Promise<void> {
  const { cert, previousActiveCerts, user, environment } = params;
  const batch = writeBatch(db);
  for (const prev of previousActiveCerts) {
    if (prev.id !== cert.id && (prev.status === 'ACTIVO' || prev.status === 'POR_VENCER')) {
      batch.update(doc(db, 'dgii_certificates', prev.id), {
        status: 'REVOCADO',
        updatedAt: serverTimestamp(),
      });
    }
  }
  batch.set(
    doc(db, 'dgii_certificates', cert.id),
    stripUndefined({
      ...cert,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: cert.organizationId,
    eventType: previousActiveCerts.length > 0 ? 'CERT_REPLACED' : 'CERT_UPLOADED',
    environment,
    summary: `Certificado digital cargado (${cert.alias}) · Titular: ${cert.subjectCn} · Vence: ${cert.validTo.slice(0, 10)}`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `dgii_certificates/${cert.id}`);
  }
}

export async function saveEcfDraftDocument(params: {
  document: Omit<DgiiEcfDocumentRecord, 'createdAt' | 'updatedAt'>;
}): Promise<DgiiEcfDocumentRecord> {
  const docToSave: DgiiEcfDocumentRecord = {
    ...params.document,
    eNCF: '',
    status: 'BORRADOR',
    isOfficialDgiiResponse: false,
  };
  const ref = doc(db, 'dgii_ecf_documents', docToSave.id);
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists() && existing.data().status !== 'BORRADOR') {
    throw new Error('Los comprobantes ya emitidos son fiscalmente inmutables y no pueden editarse como borrador.');
  }
  const batch = writeBatch(db);
  batch.set(
    ref,
    stripUndefined({
      ...docToSave,
      createdAt: existing?.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_ecf_documents/${docToSave.id}`);
  }
  return docToSave;
}

/**
 * Full 14-step e-CF issuance pipeline:
 * 1) Validates fiscal rules & tenant entitlement
 * 2) Atomically allocates next e-NCF via Firestore runTransaction (preventing duplicates)
 * 3) Builds & validates XML against DGII XSD rules
 * 4) Signs XML on backend with encrypted PKCS#12 certificate (if active certificate exists)
 * 5) Generates official QR URL
 * 6) Optionally submits to DGII environment (or validates locally in DESARROLLO)
 * 7) Auto-posts balanced double-entry accounting entry if configured
 * 8) Logs immutable dgii_audit_logs
 */
export async function issueAndProcessEcfDocument(params: {
  draft: Omit<DgiiEcfDocumentRecord, 'createdAt' | 'updatedAt'>;
  config: DgiiFiscalConfigRecord;
  sequences: DgiiEncfSequenceRecord[];
  activeCertificate?: DgiiCertificateRecord | null;
  accounts: AccountingAccountRecord[];
  user: UserProfile;
  submitToDgiiAfterSign: boolean;
}): Promise<{
  document: DgiiEcfDocumentRecord;
  journalEntry?: JournalEntryRecord;
  warnings: string[];
}> {
  const {
    draft,
    config,
    sequences,
    activeCertificate,
    accounts,
    user,
    submitToDgiiAfterSign,
  } = params;

  const validation = validateEcfBeforeIssuance({
    config,
    ecfType: draft.ecfType,
    issueDate: draft.issueDate,
    receiverIdType: draft.receiverIdType,
    receiverTaxId: draft.receiverTaxId,
    receiverName: draft.receiverName,
    items: draft.items,
    totalAmount: draft.totalAmount,
    currency: draft.currency,
    referenceEcf: draft.referenceEcf,
    referenceDate: draft.referenceDate,
    modificationCode: draft.modificationCode,
    sequences,
    isDraftOnly: false,
  });

  if (!validation.valid || !validation.availableSequenceRange) {
    throw new Error(validation.errors.join(' | '));
  }

  const seqRangeId = validation.availableSequenceRange.id;
  const seqRef = doc(db, 'dgii_encf_sequences', seqRangeId);
  const docRef = doc(db, 'dgii_ecf_documents', draft.id);
  const issuedAtIso = new Date().toISOString();

  // Atomic transaction: reserve sequence + persist initial PENDIENTE_FIRMA record
  const reservedDoc = await runTransaction(db, async (tx) => {
    const seqSnap = await tx.get(seqRef);
    if (!seqSnap.exists()) {
      throw new Error('El rango de secuencias e-NCF seleccionado no existe.');
    }
    const seqData = seqSnap.data() as DgiiEncfSequenceRecord;
    if (seqData.status !== 'ACTIVA') {
      throw new Error(`El rango ${seqData.prefix} no está ACTIVO (estado: ${seqData.status}).`);
    }
    const nextSeq = seqData.lastUsedSequence + 1;
    if (nextSeq > seqData.endSequence) {
      throw new Error(`El rango ${seqData.prefix} alcanzó su límite máximo (${seqData.endSequence}).`);
    }
    if (seqData.expiryDate < draft.issueDate) {
      throw new Error(`El rango ${seqData.prefix} venció el ${seqData.expiryDate}.`);
    }

    const existingDocSnap = await tx.get(docRef);
    if (existingDocSnap.exists() && existingDocSnap.data().status !== 'BORRADOR') {
      throw new Error('Este comprobante ya consumió un e-NCF y no puede re-emitirse.');
    }

    const allocatedEncf = formatEncf(draft.ecfType, nextSeq);
    const nextSeqStatus = nextSeq >= seqData.endSequence ? 'AGOTADA' : 'ACTIVA';

    tx.update(seqRef, {
      lastUsedSequence: nextSeq,
      status: nextSeqStatus,
      updatedAt: serverTimestamp(),
    });

    const baseDoc: DgiiEcfDocumentRecord = {
      ...draft,
      eNCF: allocatedEncf,
      sequenceRangeId: seqRangeId,
      environment: config.environment,
      status: 'PENDIENTE_FIRMA',
      isOfficialDgiiResponse: false,
      isTestSimulation: config.environment === 'DESARROLLO',
      issuedBy: user.uid,
      issuedAt: issuedAtIso,
      dgiiResponses: draft.dgiiResponses || [],
    };

    const originalXml = buildDgiiEcfXml({
      document: baseDoc,
      config,
      sequenceExpiryDate: seqData.expiryDate,
    });
    const xsdRes = validateEcfBeforeDigitalSignature(originalXml, baseDoc.ecfType);
    if (!xsdRes.valid) {
      throw new Error(`Error de validación XSD DGII (${xsdRes.schemaFileName}): ${xsdRes.errors.join(' ')}`);
    }
    baseDoc.originalXml = originalXml;

    tx.set(
      docRef,
      stripUndefined({
        ...baseDoc,
        createdAt: existingDocSnap.exists() ? existingDocSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    const auditSeqId = generateId('dgaudit');
    tx.set(doc(db, 'dgii_audit_logs', auditSeqId), {
      id: auditSeqId,
      organizationId: baseDoc.organizationId,
      eventType: 'XSD_VALIDATED',
      ecfDocumentId: baseDoc.id,
      eNCF: allocatedEncf,
      environment: config.environment,
      summary: `e-NCF ${allocatedEncf} asignado atómicamente y validado contra esquema oficial ${xsdRes.schemaFileName} (Ley 32-23).`,
      details: xsdRes.checksExecuted.join(' | '),
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      timestampIso: issuedAtIso,
      createdAt: serverTimestamp(),
    });

    return baseDoc;
  });

  // Step 4: Digital signature via secure backend vault (if active certificate exists)
  let currentDoc: DgiiEcfDocumentRecord = { ...reservedDoc };
  if (activeCertificate && activeCertificate.status !== 'VENCIDO' && activeCertificate.status !== 'REVOCADO') {
    const preSignCheck = validateEcfBeforeDigitalSignature(
      currentDoc.originalXml || '',
      currentDoc.ecfType
    );
    if (!preSignCheck.valid) {
      throw new Error(
        `Validación XSD previa a firma digital fallida (${preSignCheck.schemaFileName}): ${preSignCheck.errors.join(' ')}`
      );
    }

    const signRes = await fetch('/api/dgii/xml/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: currentDoc.organizationId,
        vaultKeyId: activeCertificate.vaultKeyId,
        xml: currentDoc.originalXml,
        expectedKind: preSignCheck.schemaKind,
      }),
    });
    const signJson = await signRes.json();
    if (!signRes.ok || !signJson.ok) {
      throw new Error(signJson.error || 'Error firmando digitalmente el comprobante XML.');
    }
    currentDoc = {
      ...currentDoc,
      signedXml: signJson.signedXml,
      securityCode: signJson.securityCode,
      xmlHashSha256: signJson.sha256Hex,
      signedAt: signJson.signedAt,
      certificateId: activeCertificate.id,
      status: submitToDgiiAfterSign ? 'PENDIENTE_ENVIO' : 'FIRMADA',
    };
    currentDoc.qrUrl = buildDgiiQrValidationUrl(currentDoc);
  }

  // Step 5: Submit to DGII endpoint (or DESARROLLO local validation)
  const responseLogs: DgiiResponseLog[] = [...(currentDoc.dgiiResponses || [])];
  if (submitToDgiiAfterSign && currentDoc.signedXml) {
    const isRfceSummary = currentDoc.ecfType === '32' && currentDoc.totalAmount < 250000;
    let xmlToTransmit = currentDoc.signedXml;
    if (isRfceSummary && activeCertificate) {
      const rfceXml = buildDgiiRfceXml({
        document: currentDoc,
        config,
        securityCode: currentDoc.securityCode || '000000',
      });
      const rfceXsd = validateEcfBeforeDigitalSignature(rfceXml, 'RFCE');
      if (!rfceXsd.valid) {
        throw new Error(`Error XSD en resumen RFCE_v.1.0.xsd: ${rfceXsd.errors.join(' ')}`);
      }
      const rfceSignRes = await fetch('/api/dgii/xml/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: currentDoc.organizationId,
          vaultKeyId: activeCertificate.vaultKeyId,
          xml: rfceXml,
          expectedKind: 'RFCE',
        }),
      });
      const rfceSignJson = await rfceSignRes.json();
      if (rfceSignRes.ok && rfceSignJson.ok) {
        xmlToTransmit = rfceSignJson.signedXml;
      }
    }

    const endpoints = config.endpointsByEnv[config.environment];
    const subRes = await fetch('/api/dgii/ecf/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: currentDoc.organizationId,
        environment: config.environment,
        endpoints,
        vaultKeyId: activeCertificate?.vaultKeyId || '',
        signedXml: xmlToTransmit,
        fileName: `${currentDoc.issuerRnc}${currentDoc.eNCF}.xml`,
        isRfceSummary,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      }),
    });
    const subJson = await subRes.json();
    const opType = isRfceSummary ? 'RECEPCION_FC' : 'RECEPCION';

    if (!subRes.ok || !subJson.ok) {
      const errMsg = String(subJson.error || 'Error de comunicación con DGII.');
      currentDoc.status = 'ERROR_COMUNICACION';
      currentDoc.dgiiStatusText = errMsg;
      responseLogs.push({
        timestamp: new Date().toISOString(),
        operation: opType,
        environment: config.environment,
        httpStatus: subRes.status,
        code: 'COMMUNICATION_ERROR',
        message: errMsg,
        isOfficialDgiiResponse: false,
      });
    } else {
      currentDoc.trackId = subJson.trackId || currentDoc.trackId;
      currentDoc.isOfficialDgiiResponse = Boolean(subJson.isOfficialDgiiResponse);
      currentDoc.dgiiStatusText = subJson.message;
      currentDoc.status = subJson.isOfficialDgiiResponse
        ? subJson.httpStatus >= 200 && subJson.httpStatus < 300
          ? 'PENDIENTE_RESPUESTA'
          : 'RECHAZADA'
        : 'ENVIADA_DGII';

      responseLogs.push({
        timestamp: new Date().toISOString(),
        operation: opType,
        environment: config.environment,
        httpStatus: subJson.httpStatus || 200,
        code: subJson.code || 'OK',
        message: subJson.message || '',
        trackId: subJson.trackId,
        isOfficialDgiiResponse: Boolean(subJson.isOfficialDgiiResponse),
        rawPayloadSnippet: subJson.rawBody,
      });
    }
    currentDoc.dgiiResponses = responseLogs;
  }

  // Step 6: Automatic Double-Entry Accounting Posting (mandatory, idempotent)
  let journalEntry: JournalEntryRecord | undefined;
  if (config.autoPostAccounting && !currentDoc.accountingEntryId) {
    const entryId = `je_ecf_${currentDoc.id}_${currentDoc.direction}`;
    journalEntry = buildJournalEntryForEcfDocument({
      document: currentDoc,
      config,
      accounts,
      entryId,
      entryNumber: `ASI-${currentDoc.eNCF}`,
      actorUid: user.uid,
      actorName: user.displayName,
    });
    currentDoc.accountingEntryId = journalEntry.id;
  }

  // Persist updates + journal entry + audit logs
  const batch = writeBatch(db);
  batch.update(
    docRef,
    stripUndefined({
      status: currentDoc.status,
      signedXml: currentDoc.signedXml,
      securityCode: currentDoc.securityCode,
      xmlHashSha256: currentDoc.xmlHashSha256,
      signedAt: currentDoc.signedAt,
      certificateId: currentDoc.certificateId,
      qrUrl: currentDoc.qrUrl,
      trackId: currentDoc.trackId,
      isOfficialDgiiResponse: currentDoc.isOfficialDgiiResponse,
      dgiiStatusText: currentDoc.dgiiStatusText,
      dgiiResponses: currentDoc.dgiiResponses,
      accountingEntryId: currentDoc.accountingEntryId,
      updatedAt: serverTimestamp(),
    })
  );

  if (journalEntry) {
    batch.set(
      doc(db, 'accounting_journal_entries', journalEntry.id),
      stripUndefined({
        ...journalEntry,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    const accAuditId = generateId('dgaudit');
    batch.set(doc(db, 'dgii_audit_logs', accAuditId), {
      id: accAuditId,
      organizationId: currentDoc.organizationId,
      eventType: 'ACCOUNTING_POSTED',
      ecfDocumentId: currentDoc.id,
      eNCF: currentDoc.eNCF,
      environment: config.environment,
      summary: `Asiento contable ${journalEntry.entryNumber} contabilizado automáticamente (${currentDoc.currency} ${journalEntry.totalDebit.toFixed(2)}).`,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      timestampIso: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  }

  if (currentDoc.signedXml) {
    const signAuditId = generateId('dgaudit');
    batch.set(doc(db, 'dgii_audit_logs', signAuditId), {
      id: signAuditId,
      organizationId: currentDoc.organizationId,
      eventType: submitToDgiiAfterSign ? 'DGII_SUBMITTED' : 'XML_SIGNED',
      ecfDocumentId: currentDoc.id,
      eNCF: currentDoc.eNCF,
      environment: config.environment,
      summary: `${currentDoc.eNCF} firmado (Código ${currentDoc.securityCode || '—'})${
        currentDoc.trackId ? ` · TrackId: ${currentDoc.trackId}` : ''
      } · Oficial DGII: ${currentDoc.isOfficialDgiiResponse ? 'Sí' : 'No (Desarrollo/Local)'}`,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      timestampIso: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_ecf_documents/${currentDoc.id}`);
  }

  return {
    document: currentDoc,
    journalEntry,
    warnings: validation.warnings,
  };
}

export async function pollDgiiDocumentStatus(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  activeCertificate?: DgiiCertificateRecord | null;
  user: UserProfile;
}): Promise<DgiiEcfDocumentRecord> {
  const { document: docRec, config, activeCertificate, user } = params;
  if (!docRec.trackId) {
    throw new Error('Este comprobante aún no tiene un TrackId asignado para consultar en DGII.');
  }
  const endpoints = config.endpointsByEnv[docRec.environment || config.environment];
  const res = await fetch('/api/dgii/ecf/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationId: docRec.organizationId,
      environment: docRec.environment || config.environment,
      endpoints,
      vaultKeyId: activeCertificate?.vaultKeyId || '',
      trackId: docRec.trackId,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || 'No se pudo consultar el estado en DGII.');
  }

  const nextStatus: EcfLifecycleStatus = json.mappedStatus || docRec.status;
  const newLog: DgiiResponseLog = {
    timestamp: new Date().toISOString(),
    operation: 'CONSULTA_ESTADO',
    environment: docRec.environment,
    httpStatus: json.httpStatus || 200,
    code: json.dgiiStatusCode || 'STATUS',
    message: (json.messages || []).join(' · '),
    trackId: docRec.trackId,
    isOfficialDgiiResponse: Boolean(json.isOfficialDgiiResponse),
    rawPayloadSnippet: json.rawBody,
  };
  const nextResponses = [...(docRec.dgiiResponses || []), newLog];

  const batch = writeBatch(db);
  batch.update(doc(db, 'dgii_ecf_documents', docRec.id), {
    status: nextStatus,
    isOfficialDgiiResponse: Boolean(json.isOfficialDgiiResponse),
    dgiiStatusText: newLog.message,
    dgiiResponses: nextResponses,
    updatedAt: serverTimestamp(),
  });
  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: docRec.organizationId,
    eventType: 'DGII_STATUS_POLLED',
    ecfDocumentId: docRec.id,
    eNCF: docRec.eNCF,
    environment: docRec.environment,
    summary: `Consulta TrackId ${docRec.trackId}: ${nextStatus} (${newLog.message})`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `dgii_ecf_documents/${docRec.id}`);
  }

  return {
    ...docRec,
    status: nextStatus,
    isOfficialDgiiResponse: Boolean(json.isOfficialDgiiResponse),
    dgiiStatusText: newLog.message,
    dgiiResponses: nextResponses,
  };
}

export async function settleEcfPaymentAndPostAccounting(params: {
  document: DgiiEcfDocumentRecord;
  config: DgiiFiscalConfigRecord;
  accounts: AccountingAccountRecord[];
  settlementDate: string;
  user: UserProfile;
}): Promise<JournalEntryRecord> {
  const { document: docRec, config, accounts, settlementDate, user } = params;
  if (docRec.paymentCollectionStatus === 'COBRADA' || docRec.paymentCollectionStatus === 'PAGADA') {
    throw new Error('Este comprobante ya tiene registrado su cobro o pago contable.');
  }
  const entryId = `je_settle_${docRec.id}`;
  const existing = await getDoc(doc(db, 'accounting_journal_entries', entryId)).catch(() => null);
  if (existing?.exists()) {
    throw new Error('El asiento de cobro/pago ya fue contabilizado.');
  }

  const je = buildPaymentSettlementJournalEntry({
    document: docRec,
    config,
    accounts,
    entryId,
    entryNumber: `LIQ-${docRec.eNCF}`,
    settlementDate,
    actorUid: user.uid,
    actorName: user.displayName,
  });

  const isPayable = docRec.direction === 'RECIBIDO' || ['41', '43', '47'].includes(docRec.ecfType);
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'accounting_journal_entries', je.id),
    stripUndefined({
      ...je,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  batch.update(doc(db, 'dgii_ecf_documents', docRec.id), {
    paymentCollectionStatus: isPayable ? 'PAGADA' : 'COBRADA',
    paymentAccountingEntryId: je.id,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `dgii_ecf_documents/${docRec.id}`);
  }
  return je;
}

export async function recordReceivedSupplierEcf(params: {
  document: Omit<DgiiEcfDocumentRecord, 'createdAt' | 'updatedAt'>;
  config: DgiiFiscalConfigRecord;
  accounts: AccountingAccountRecord[];
  user: UserProfile;
}): Promise<{ document: DgiiEcfDocumentRecord; journalEntry?: JournalEntryRecord }> {
  const { document: docRec, config, accounts, user } = params;
  const entryId = `je_ecf_${docRec.id}_RECIBIDO`;
  const journalEntry = config.autoPostAccounting
    ? buildJournalEntryForEcfDocument({
        document: { ...docRec, direction: 'RECIBIDO' },
        config,
        accounts,
        entryId,
        entryNumber: `COM-${docRec.eNCF}`,
        actorUid: user.uid,
        actorName: user.displayName,
      })
    : undefined;

  const finalDoc: DgiiEcfDocumentRecord = {
    ...docRec,
    direction: 'RECIBIDO',
    accountingEntryId: journalEntry?.id,
  };

  const batch = writeBatch(db);
  batch.set(
    doc(db, 'dgii_ecf_documents', finalDoc.id),
    stripUndefined({
      ...finalDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  if (journalEntry) {
    batch.set(
      doc(db, 'accounting_journal_entries', journalEntry.id),
      stripUndefined({
        ...journalEntry,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }
  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: finalDoc.organizationId,
    eventType: 'RECEIVED_ECF_IMPORTED',
    ecfDocumentId: finalDoc.id,
    eNCF: finalDoc.eNCF,
    environment: finalDoc.environment,
    summary: `e-CF recibido registrado (${finalDoc.eNCF}) de ${finalDoc.issuerName} (RNC ${finalDoc.issuerRnc})`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `dgii_ecf_documents/${finalDoc.id}`);
  }

  return { document: finalDoc, journalEntry };
}

export async function voidIssuedEcfDocument(params: {
  document: DgiiEcfDocumentRecord;
  reason: string;
  journalEntries: JournalEntryRecord[];
  user: UserProfile;
}): Promise<void> {
  const { document: docRec, reason, journalEntries, user } = params;
  if (docRec.status === 'ANULADA') {
    throw new Error('Este comprobante ya se encuentra ANULADO.');
  }
  if (!reason.trim() || reason.trim().length < 5) {
    throw new Error('Debe indicar el motivo fiscal de la anulación (mínimo 5 caracteres).');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'dgii_ecf_documents', docRec.id), {
    status: 'ANULADA',
    voidReason: reason.trim(),
    updatedAt: serverTimestamp(),
  });

  if (docRec.accountingEntryId) {
    const origEntry = journalEntries.find((e) => e.id === docRec.accountingEntryId);
    if (origEntry && origEntry.status !== 'REVERTIDO') {
      const revId = `je_rev_${origEntry.id}`;
      const revEntry = buildReversalJournalEntry({
        originalEntry: origEntry,
        entryId: revId,
        entryNumber: `REV-${origEntry.entryNumber}`,
        reversalDate: new Date().toISOString().slice(0, 10),
        reason: `Anulación ${docRec.eNCF}: ${reason.trim()}`,
        actorUid: user.uid,
        actorName: user.displayName,
      });
      batch.set(
        doc(db, 'accounting_journal_entries', revEntry.id),
        stripUndefined({
          ...revEntry,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      batch.update(doc(db, 'accounting_journal_entries', origEntry.id), {
        status: 'REVERTIDO',
        reversedEntryId: revEntry.id,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const auditId = generateId('dgaudit');
  batch.set(doc(db, 'dgii_audit_logs', auditId), {
    id: auditId,
    organizationId: docRec.organizationId,
    eventType: 'SEQUENCE_VOIDED',
    ecfDocumentId: docRec.id,
    eNCF: docRec.eNCF,
    environment: docRec.environment,
    summary: `Comprobante ${docRec.eNCF} marcado ANULADA · Motivo: ${reason.trim()}`,
    actorUid: user.uid,
    actorEmail: user.email,
    actorRole: user.role,
    timestampIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `dgii_ecf_documents/${docRec.id}`);
  }
}

export function getEffectiveDgiiConfig(
  configs: DgiiFiscalConfigRecord[],
  organization: OrganizationRecord
): DgiiFiscalConfigRecord {
  const existing = configs.find((c) => c.organizationId === organization.id);
  if (existing) return existing;
  return buildDefaultDgiiFiscalConfig(organization);
}

export async function logDgiiCustomAuditEvent(params: {
  organizationId: string;
  eventType: DgiiAuditLogRecord['eventType'];
  environment: DgiiFiscalConfigRecord['environment'];
  summary: string;
  details?: string;
  ecfDocumentId?: string;
  eNCF?: string;
  user: UserProfile;
}): Promise<void> {
  const auditId = generateId('dgaudit');
  const batch = writeBatch(db);
  batch.set(
    doc(db, 'dgii_audit_logs', auditId),
    stripUndefined({
      id: auditId,
      organizationId: params.organizationId,
      eventType: params.eventType,
      ecfDocumentId: params.ecfDocumentId,
      eNCF: params.eNCF,
      environment: params.environment,
      summary: params.summary,
      details: params.details,
      actorUid: params.user.uid,
      actorEmail: params.user.email,
      actorRole: params.user.role,
      timestampIso: new Date().toISOString(),
      createdAt: serverTimestamp(),
    })
  );
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `dgii_audit_logs/${auditId}`);
  }
}
