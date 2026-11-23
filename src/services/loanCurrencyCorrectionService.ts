import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { isSuperAdminUser } from '../engine/multiTenantEngine';
import { generateId } from './axycoreStore';
import type {
  ApplicationRecord,
  CurrencyCode,
  CustomerRecord,
  LoanRecord,
  ProductCode,
  UserProfile,
} from '../types/axycore';

export const AUTO_CLIENT_CURRENCY_FIX_KEY = 'currency_fix_jose_pulus_ian_micel_usd_v1';

export interface PendingCurrencyTarget {
  key: 'jose_pulus' | 'ian_micel_francisco_madera';
  displayLabel: string;
  targetCurrency: CurrencyCode;
}

export const PENDING_CLIENT_CURRENCY_TARGETS: readonly PendingCurrencyTarget[] = [
  {
    key: 'jose_pulus',
    displayLabel: 'Jose Pulus',
    targetCurrency: 'USD',
  },
  {
    key: 'ian_micel_francisco_madera',
    displayLabel: 'Ian Micel Francisco Madera',
    targetCurrency: 'USD',
  },
] as const;

export interface CurrencyCascadeCounts {
  loans: number;
  collectionAccounts: number;
  applications: number;
  payments: number;
  paymentAllocations: number;
  paymentPromises: number;
  paymentAgreements: number;
  collectionReceipts: number;
  paymentIntents: number;
}

export interface LoanCurrencyCorrectionResult {
  loanId: string;
  loanNumber: string;
  previousCurrency: CurrencyCode;
  newCurrency: CurrencyCode;
  newProductCode: ProductCode;
  counts: CurrencyCascadeCounts;
  totalDocumentsUpdated: number;
}

export interface ClientCurrencyFixSummaryItem {
  targetKey: PendingCurrencyTarget['key'];
  targetLabel: string;
  organizationId: string;
  matchedCustomerNames: string[];
  loanNumbers: string[];
  counts: CurrencyCascadeCounts;
  totalDocumentsUpdated: number;
  alreadyInTargetCurrency: boolean;
}

export interface AutoClientCurrencyFixResult {
  executed: boolean;
  reason?: 'NOT_ADMIN' | 'ALREADY_COMPLETED' | 'NO_MATCHING_CLIENTS';
  items: ClientCurrencyFixSummaryItem[];
  unmatchedTargetLabels: string[];
  totalDocumentsUpdated: number;
}

/**
 * Strips accents/diacritics, punctuation and collapses whitespace for resilient name matching.
 */
export function normalizeClientName(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Maps productCode cleanly to the equivalent product in the target currency
 * (PERSONAL_DOP <-> PERSONAL_USD, EMPRESARIAL_DOP <-> EMPRESARIAL_USD).
 */
export function mapProductCodeForCurrency(
  currentProductCode: string | undefined | null,
  targetCurrency: CurrencyCode
): ProductCode {
  const isBusiness =
    currentProductCode === 'EMPRESARIAL_DOP' || currentProductCode === 'EMPRESARIAL_USD';
  if (targetCurrency === 'USD') {
    return isBusiness ? 'EMPRESARIAL_USD' : 'PERSONAL_USD';
  }
  return isBusiness ? 'EMPRESARIAL_DOP' : 'PERSONAL_DOP';
}

/**
 * Resiliently matches "Jose Pulus" and "Ian Micel Francisco Madera" across accents,
 * casing, token order, middle names, and minor spelling variations without false positives.
 */
export function matchesPendingCurrencyTarget(
  candidateName: string | null | undefined
): PendingCurrencyTarget | null {
  const normalized = normalizeClientName(candidateName);
  if (!normalized) return null;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;

  // 1. Jose Pulus (exact or 1-edit surname match + Jose first name)
  const hasJose = tokens.includes('jose');
  const hasExactPulus = tokens.includes('pulus');
  const hasClosePulus = tokens.some(
    (tok) => tok.length >= 4 && levenshteinDistance(tok, 'pulus') <= 1
  );
  if (
    (hasJose && hasClosePulus) ||
    (hasExactPulus && tokens.some((tok) => tok === 'j' || tok.startsWith('jos')))
  ) {
    return PENDING_CLIENT_CURRENCY_TARGETS[0];
  }

  // 2. Ian Micel Francisco Madera
  const hasIan = tokens.includes('ian');
  const hasFrancisco = tokens.includes('francisco');
  const hasMadera = tokens.includes('madera') || tokens.includes('maderas');
  const hasMicelVariant = tokens.some(
    (tok) =>
      tok === 'micel' ||
      tok === 'misael' ||
      tok === 'michel' ||
      tok === 'michael' ||
      (tok.length >= 4 && levenshteinDistance(tok, 'micel') <= 1)
  );

  if (
    (hasFrancisco && hasMadera) ||
    (hasIan && hasFrancisco) ||
    (hasIan && hasMadera) ||
    (hasIan && hasMicelVariant)
  ) {
    return PENDING_CLIENT_CURRENCY_TARGETS[1];
  }

  return null;
}

function sumCounts(counts: CurrencyCascadeCounts): number {
  return (
    counts.loans +
    counts.collectionAccounts +
    counts.applications +
    counts.payments +
    counts.paymentAllocations +
    counts.paymentPromises +
    counts.paymentAgreements +
    counts.collectionReceipts +
    counts.paymentIntents
  );
}

async function commitBatchedUpdates(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  pathLabel: string
): Promise<void> {
  if (ops.length === 0) return;
  const CHUNK_SIZE = 300;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((op) => op(batch));
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, pathLabel);
    }
  }
}

interface CascadeUpdateParams {
  organizationId: string;
  targetCurrency: CurrencyCode;
  loanIds: Set<string>;
  customerIds: Set<string>;
  applicationIds: Set<string>;
  actor: UserProfile;
  reason: string;
  auditEntityId: string;
  auditLabel: string;
}

async function executeCurrencyCascadeForOrg(
  params: CascadeUpdateParams
): Promise<{
  counts: CurrencyCascadeCounts;
  affectedLoanNumbers: string[];
  previousCurrencies: string[];
}> {
  const {
    organizationId,
    targetCurrency,
    loanIds,
    customerIds,
    applicationIds,
    actor,
    reason,
    auditEntityId,
    auditLabel,
  } = params;

  const counts: CurrencyCascadeCounts = {
    loans: 0,
    collectionAccounts: 0,
    applications: 0,
    payments: 0,
    paymentAllocations: 0,
    paymentPromises: 0,
    paymentAgreements: 0,
    collectionReceipts: 0,
    paymentIntents: 0,
  };

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const allLoanIds = new Set<string>(loanIds);
  const allApplicationIds = new Set<string>(applicationIds);
  const affectedLoanNumbers = new Set<string>();
  const previousCurrencies = new Set<string>();

  // 1. Loans
  const loansSnap = await getDocs(
    query(collection(db, 'loans'), where('organizationId', '==', organizationId))
  );
  loansSnap.forEach((snap) => {
    const data = snap.data() as LoanRecord;
    const isMatch = allLoanIds.has(snap.id) || (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;
    allLoanIds.add(snap.id);
    if (data.applicationId) allApplicationIds.add(data.applicationId);
    if (data.loanNumber) affectedLoanNumbers.add(data.loanNumber);

    const nextProduct = mapProductCodeForCurrency(data.productCode, targetCurrency);
    if (data.currency !== targetCurrency || data.productCode !== nextProduct) {
      if (data.currency) previousCurrencies.add(data.currency);
      counts.loans++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          productCode: nextProduct,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 2. Applications
  const appsSnap = await getDocs(
    query(collection(db, 'applications'), where('organizationId', '==', organizationId))
  );
  appsSnap.forEach((snap) => {
    const data = snap.data() as ApplicationRecord;
    const isMatch =
      allApplicationIds.has(snap.id) || (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;

    const nextProduct = mapProductCodeForCurrency(data.productCode, targetCurrency);
    if (data.currency !== targetCurrency || data.productCode !== nextProduct) {
      if (data.currency) previousCurrencies.add(data.currency);
      counts.applications++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          productCode: nextProduct,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 3. Collection Accounts
  const colAccountsSnap = await getDocs(
    query(collection(db, 'collection_accounts'), where('organizationId', '==', organizationId))
  );
  colAccountsSnap.forEach((snap) => {
    const data = snap.data() as {
      loanId?: string;
      customerId?: string;
      currency?: string;
      productCode?: string;
    };
    const isMatch =
      allLoanIds.has(snap.id) ||
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;

    const nextProduct = mapProductCodeForCurrency(data.productCode, targetCurrency);
    if (data.currency !== targetCurrency || data.productCode !== nextProduct) {
      counts.collectionAccounts++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          productCode: nextProduct,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 4. Payments
  const paymentsSnap = await getDocs(
    query(collection(db, 'payments'), where('organizationId', '==', organizationId))
  );
  paymentsSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; customerId?: string; currency?: string };
    const isMatch =
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;

    if (data.currency !== targetCurrency) {
      counts.payments++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 5. Payment Allocations (no updatedAt field in schema)
  const allocationsSnap = await getDocs(
    query(collection(db, 'payment_allocations'), where('organizationId', '==', organizationId))
  );
  allocationsSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; currency?: string };
    if (!data.loanId || !allLoanIds.has(data.loanId)) return;
    if (data.currency !== targetCurrency) {
      counts.paymentAllocations++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
        })
      );
    }
  });

  // 6. Payment Promises
  const promisesSnap = await getDocs(
    query(collection(db, 'payment_promises'), where('organizationId', '==', organizationId))
  );
  promisesSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; customerId?: string; currency?: string };
    const isMatch =
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;
    if (data.currency !== targetCurrency) {
      counts.paymentPromises++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 7. Payment Agreements
  const agreementsSnap = await getDocs(
    query(collection(db, 'payment_agreements'), where('organizationId', '==', organizationId))
  );
  agreementsSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; customerId?: string; currency?: string };
    const isMatch =
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;
    if (data.currency !== targetCurrency) {
      counts.paymentAgreements++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 8. Collection Receipts (no updatedAt field in schema)
  const receiptsSnap = await getDocs(
    query(collection(db, 'collection_receipts'), where('organizationId', '==', organizationId))
  );
  receiptsSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; customerId?: string; currency?: string };
    const isMatch =
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;
    if (data.currency !== targetCurrency) {
      counts.collectionReceipts++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
        })
      );
    }
  });

  // 9. Payment Intents
  const intentsSnap = await getDocs(
    query(collection(db, 'payment_intents'), where('organizationId', '==', organizationId))
  );
  intentsSnap.forEach((snap) => {
    const data = snap.data() as { loanId?: string; customerId?: string; currency?: string };
    const isMatch =
      (data.loanId && allLoanIds.has(data.loanId)) ||
      (data.customerId && customerIds.has(data.customerId));
    if (!isMatch) return;
    if (data.currency !== targetCurrency) {
      counts.paymentIntents++;
      ops.push((b) =>
        b.update(snap.ref, {
          currency: targetCurrency,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  if (ops.length > 0) {
    await commitBatchedUpdates(ops, `loan_currency_correction/${organizationId}`);

    const auditId = generateId('audit');
    await setDoc(doc(collection(db, 'audit_logs'), auditId), {
      id: auditId,
      organizationId,
      eventType: 'LOAN_CURRENCY_CORRECTED',
      entityType: 'loan',
      entityId: auditEntityId.slice(0, 128),
      action: `Corrección de moneda a ${targetCurrency} para ${auditLabel} (${ops.length} registros)`.slice(
        0,
        195
      ),
      previousState: JSON.stringify({
        previousCurrencies: Array.from(previousCurrencies),
        loanNumbers: Array.from(affectedLoanNumbers),
      }).slice(0, 3900),
      newState: JSON.stringify({
        targetCurrency,
        counts,
        loanNumbers: Array.from(affectedLoanNumbers),
      }).slice(0, 3900),
      justification: reason.slice(0, 990),
      transactionId: generateId('tx'),
      userId: actor.uid,
      userEmail: actor.email || '',
      userRole: actor.role,
      timestamp: serverTimestamp(),
    });
  }

  return {
    counts,
    affectedLoanNumbers: Array.from(affectedLoanNumbers),
    previousCurrencies: Array.from(previousCurrencies),
  };
}

/**
 * Admin-invocable single-loan currency correction (cascades across loan, collection account,
 * linked application, payments, allocations, promises, agreements, receipts, and intents).
 */
export async function correctSingleLoanCurrency(params: {
  loan: LoanRecord;
  targetCurrency: CurrencyCode;
  actor: UserProfile;
  reason: string;
}): Promise<LoanCurrencyCorrectionResult> {
  const { loan, targetCurrency, actor, reason } = params;
  if (actor.role !== 'ADMIN' && !actor.isSuperAdmin) {
    throw new Error('Solo los administradores pueden corregir la moneda de un préstamo desembolsado.');
  }
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new Error('Indica una justificación clara (mínimo 5 caracteres) para la auditoría.');
  }

  const newProductCode = mapProductCodeForCurrency(loan.productCode, targetCurrency);
  const { counts } = await executeCurrencyCascadeForOrg({
    organizationId: loan.organizationId,
    targetCurrency,
    loanIds: new Set([loan.id]),
    customerIds: new Set<string>(),
    applicationIds: loan.applicationId ? new Set([loan.applicationId]) : new Set<string>(),
    actor,
    reason: cleanReason,
    auditEntityId: loan.id,
    auditLabel: `${loan.applicantDisplayName} (${loan.loanNumber})`,
  });

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    previousCurrency: loan.currency,
    newCurrency: targetCurrency,
    newProductCode,
    counts,
    totalDocumentsUpdated: sumCounts(counts),
  };
}

/**
 * Automatically applies the requested one-time currency correction to USD for:
 *  - Jose Pulus
 *  - Ian Micel Francisco Madera
 *
 * Runs idempotently when an authenticated Admin / Superadmin opens the app, scans
 * accessible organizations, updates all origination/loan/collection/payment documents
 * for both clients to USD, records an immutable audit log, and seals a marker in
 * system_parameters once completed.
 */
export async function runPendingClientCurrencyCorrectionIfNeeded(params: {
  firebaseUser: FirebaseUser;
  actor: UserProfile;
  onProgress?: (stageText: string) => void;
}): Promise<AutoClientCurrencyFixResult> {
  const { firebaseUser, actor, onProgress } = params;
  const isSuperAdmin = isSuperAdminUser(actor, firebaseUser.emailVerified);
  if (!isSuperAdmin && actor.role !== 'ADMIN') {
    return {
      executed: false,
      reason: 'NOT_ADMIN',
      items: [],
      unmatchedTargetLabels: [],
      totalDocumentsUpdated: 0,
    };
  }

  const markerOrgId = actor.organizationId || 'org_axycore_main';

  // 1. Check completion marker in Firestore
  const markerSnap = await getDocs(
    query(
      collection(db, 'system_parameters'),
      where('organizationId', '==', markerOrgId),
      where('key', '==', AUTO_CLIENT_CURRENCY_FIX_KEY)
    )
  );
  if (!markerSnap.empty) {
    const markerData = markerSnap.docs[0].data() as { value?: { completed?: boolean } };
    if (markerData.value?.completed === true) {
      return {
        executed: false,
        reason: 'ALREADY_COMPLETED',
        items: [],
        unmatchedTargetLabels: [],
        totalDocumentsUpdated: 0,
      };
    }
  }

  // 2. Discover candidate organizations accessible to this admin
  const candidateOrgIds = new Set<string>();
  if (actor.organizationId) candidateOrgIds.add(actor.organizationId);
  if (isSuperAdmin) {
    candidateOrgIds.add('org_axycore_main');
    try {
      const orgsSnap = await getDocs(collection(db, 'organizations'));
      orgsSnap.forEach((s) => candidateOrgIds.add(s.id));
    } catch {
      // Fallback to active org + org_axycore_main
    }
  }

  onProgress?.(
    'Verificando expedientes de Jose Pulus e Ian Micel Francisco Madera para corrección de moneda a USD...'
  );

  // Accumulate matches per (orgId + targetKey)
  interface TargetMatchBucket {
    target: PendingCurrencyTarget;
    organizationId: string;
    customerIds: Set<string>;
    loanIds: Set<string>;
    applicationIds: Set<string>;
    matchedCustomerNames: Set<string>;
  }

  const buckets = new Map<string, TargetMatchBucket>();
  const getOrCreateBucket = (
    organizationId: string,
    target: PendingCurrencyTarget
  ): TargetMatchBucket => {
    const mapKey = `${organizationId}::${target.key}`;
    let existing = buckets.get(mapKey);
    if (!existing) {
      existing = {
        target,
        organizationId,
        customerIds: new Set<string>(),
        loanIds: new Set<string>(),
        applicationIds: new Set<string>(),
        matchedCustomerNames: new Set<string>(),
      };
      buckets.set(mapKey, existing);
    }
    return existing;
  };

  for (const orgId of candidateOrgIds) {
    try {
      const [custSnap, loansSnap, appsSnap] = await Promise.all([
        getDocs(query(collection(db, 'customers'), where('organizationId', '==', orgId))),
        getDocs(query(collection(db, 'loans'), where('organizationId', '==', orgId))),
        getDocs(query(collection(db, 'applications'), where('organizationId', '==', orgId))),
      ]);

      custSnap.forEach((snap) => {
        const c = snap.data() as CustomerRecord;
        const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim();
        const target = matchesPendingCurrencyTarget(fullName);
        if (target) {
          const bucket = getOrCreateBucket(orgId, target);
          bucket.customerIds.add(snap.id);
          bucket.matchedCustomerNames.add(fullName);
        }
      });

      loansSnap.forEach((snap) => {
        const l = snap.data() as LoanRecord;
        const target = matchesPendingCurrencyTarget(l.applicantDisplayName);
        if (target) {
          const bucket = getOrCreateBucket(orgId, target);
          bucket.loanIds.add(snap.id);
          if (l.customerId) bucket.customerIds.add(l.customerId);
          if (l.applicationId) bucket.applicationIds.add(l.applicationId);
          if (l.applicantDisplayName) bucket.matchedCustomerNames.add(l.applicantDisplayName);
        }
      });

      appsSnap.forEach((snap) => {
        const a = snap.data() as ApplicationRecord;
        const target = matchesPendingCurrencyTarget(a.applicantDisplayName);
        if (target) {
          const bucket = getOrCreateBucket(orgId, target);
          bucket.applicationIds.add(snap.id);
          if (a.customerId) bucket.customerIds.add(a.customerId);
          if (a.applicantDisplayName) bucket.matchedCustomerNames.add(a.applicantDisplayName);
        }
      });
    } catch {
      // Skip orgs where user has no read access
    }
  }

  if (buckets.size === 0) {
    return {
      executed: false,
      reason: 'NO_MATCHING_CLIENTS',
      items: [],
      unmatchedTargetLabels: PENDING_CLIENT_CURRENCY_TARGETS.map((t) => t.displayLabel),
      totalDocumentsUpdated: 0,
    };
  }

  // 3. Apply full cascading currency correction to USD for each matched client bucket
  const items: ClientCurrencyFixSummaryItem[] = [];
  const resolvedTargetKeys = new Set<PendingCurrencyTarget['key']>();

  for (const bucket of buckets.values()) {
    onProgress?.(
      `Corrigiendo moneda a USD para ${bucket.target.displayLabel} (préstamos, solicitudes, cobranza y pagos)...`
    );
    const { counts, affectedLoanNumbers } = await executeCurrencyCascadeForOrg({
      organizationId: bucket.organizationId,
      targetCurrency: bucket.target.targetCurrency,
      loanIds: bucket.loanIds,
      customerIds: bucket.customerIds,
      applicationIds: bucket.applicationIds,
      actor,
      reason: `Corrección de moneda de originación a USD solicitada por administración para ${bucket.target.displayLabel}.`,
      auditEntityId:
        Array.from(bucket.customerIds)[0] ||
        Array.from(bucket.loanIds)[0] ||
        bucket.target.key,
      auditLabel: bucket.target.displayLabel,
    });

    const totalUpdated = sumCounts(counts);
    resolvedTargetKeys.add(bucket.target.key);
    items.push({
      targetKey: bucket.target.key,
      targetLabel: bucket.target.displayLabel,
      organizationId: bucket.organizationId,
      matchedCustomerNames: Array.from(bucket.matchedCustomerNames),
      loanNumbers: affectedLoanNumbers,
      counts,
      totalDocumentsUpdated: totalUpdated,
      alreadyInTargetCurrency: totalUpdated === 0,
    });
  }

  const unmatchedTargetLabels = PENDING_CLIENT_CURRENCY_TARGETS.filter(
    (t) => !resolvedTargetKeys.has(t.key)
  ).map((t) => t.displayLabel);

  const allTargetsResolved = unmatchedTargetLabels.length === 0;
  const totalDocumentsUpdated = items.reduce((acc, item) => acc + item.totalDocumentsUpdated, 0);

  // 4. Persist completion marker in system_parameters (only mark completed=true when both targets are verified)
  const markerDocId = `${AUTO_CLIENT_CURRENCY_FIX_KEY}_${markerOrgId}`.slice(0, 120);
  await setDoc(doc(db, 'system_parameters', markerDocId), {
    id: markerDocId,
    organizationId: markerOrgId,
    key: AUTO_CLIENT_CURRENCY_FIX_KEY,
    value: {
      completed: allTargetsResolved,
      executedAtIso: new Date().toISOString(),
      resolvedTargetKeys: Array.from(resolvedTargetKeys),
      unmatchedTargetLabels,
      totalDocumentsUpdated,
      items: items.map((i) => ({
        targetKey: i.targetKey,
        organizationId: i.organizationId,
        matchedCustomerNames: i.matchedCustomerNames,
        loanNumbers: i.loanNumbers,
        totalDocumentsUpdated: i.totalDocumentsUpdated,
      })),
    },
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });

  return {
    executed: totalDocumentsUpdated > 0 || allTargetsResolved,
    items,
    unmatchedTargetLabels,
    totalDocumentsUpdated,
  };
}
