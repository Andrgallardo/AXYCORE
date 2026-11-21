import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  prepareAppSheetMigrationPlan,
  type PreparedAppSheetMigrationPlan,
  type RawAppSheetDataset,
} from '../engine/appsheetMigrationEngine';
import { ensureSuGloriaManoAmigaExists, generateId } from './axycoreStore';
import { syncDisbursedLoansAndDailyCutoff } from './collectionsStore';
import { isSuperAdminUser } from '../engine/multiTenantEngine';
import type { UserProfile } from '../types/axycore';

export const AUTO_REMIGRATION_KEY = 'su_gloria_full_remigration_v2';

export interface PortfolioRemigrationResult {
  executed: boolean;
  reason?: 'NOT_SUPERADMIN' | 'ALREADY_COMPLETED' | 'NO_PENDING_BUNDLE';
  executedAtIso?: string;
  organizationId?: string;
  deletedTotalDocs?: number;
  writtenCustomers?: number;
  writtenLoans?: number;
  writtenInstallments?: number;
  writtenPayments?: number;
  writtenActions?: number;
  writtenPromises?: number;
  activePortfolioCapitalDop?: number;
  activePortfolioCapitalUsd?: number;
}

function cleanObject<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

async function commitBatchedOps(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  pathLabel: string
): Promise<void> {
  if (ops.length === 0) return;
  const CHUNK_SIZE = 320;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((fn) => fn(batch));
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, pathLabel);
    }
  }
}

const PORTFOLIO_RESET_COLLECTIONS = [
  'collection_accounts',
  'collection_assignments',
  'collection_actions',
  'collection_tasks',
  'payment_promises',
  'payment_agreements',
  'payment_allocations',
  'collection_receipts',
  'payment_intents',
  'payments',
  'loan_installments',
  'loans',
  'customers',
] as const;

async function writeCleanPlanToFirestore(params: {
  plan: PreparedAppSheetMigrationPlan;
  actor: UserProfile;
}): Promise<{
  writtenCustomers: number;
  writtenLoans: number;
  writtenInstallments: number;
  writtenPayments: number;
  writtenActions: number;
  writtenPromises: number;
}> {
  const { plan, actor } = params;
  if (plan.organizationId === 'org_axycore_main') {
    await ensureSuGloriaManoAmigaExists(actor.uid);
  }

  const stage1Ops: Array<(b: ReturnType<typeof writeBatch>) => void> = [];
  const stage2PromiseStatusUpdates: Array<(b: ReturnType<typeof writeBatch>) => void> = [];

  for (const cust of plan.customers) {
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'customers', cust.id),
        cleanObject({
          ...cust,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  for (const loan of plan.loans) {
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'loans', loan.id),
        cleanObject({
          ...loan,
          createdBy: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  for (const inst of plan.installments) {
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'loan_installments', inst.id),
        cleanObject({
          ...inst,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  for (const pay of plan.payments) {
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'payments', pay.id),
        cleanObject({
          ...pay,
          reportedByUserId: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  for (const act of plan.actions) {
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'collection_actions', act.id),
        cleanObject({
          ...act,
          collectorId: actor.uid,
          isClosed: true,
          createdAt: serverTimestamp(),
        })
      )
    );
  }

  for (const prom of plan.promises) {
    const initialStatus =
      prom.status === 'PENDIENTE_VERIFICACION' ? 'PENDIENTE_VERIFICACION' : 'VIGENTE';
    stage1Ops.push((b) =>
      b.set(
        doc(db, 'payment_promises', prom.id),
        cleanObject({
          ...prom,
          createdByUserId: actor.uid,
          status: initialStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
    if (prom.status !== initialStatus) {
      stage2PromiseStatusUpdates.push((b) =>
        b.update(doc(db, 'payment_promises', prom.id), {
          status: prom.status,
          updatedAt: serverTimestamp(),
        })
      );
    }
  }

  await commitBatchedOps(stage1Ops, 'portfolio_remigration_write_stage1');
  if (stage2PromiseStatusUpdates.length > 0) {
    await commitBatchedOps(stage2PromiseStatusUpdates, 'portfolio_remigration_write_stage2');
  }

  return {
    writtenCustomers: plan.customers.length,
    writtenLoans: plan.loans.length,
    writtenInstallments: plan.installments.length,
    writtenPayments: plan.payments.length,
    writtenActions: plan.actions.length,
    writtenPromises: plan.promises.length,
  };
}

/**
 * Automatically executes the pending one-time clean portfolio wipe & full re-migration
 * when the bootstrapped Superadmin opens AxyCore.
 * - Verifies via system_parameters that it has not already run.
 * - Fetches the one-time server-verified snapshot using the Superadmin's Firebase ID Token.
 * - Deletes all stale portfolio docs in org_axycore_main and writes the complete portfolio.
 * - Persists completion marker + immutable audit log and deletes the temporary snapshot on the server.
 */
export async function runPendingAutoPortfolioRemigrationIfNeeded(params: {
  firebaseUser: FirebaseUser;
  actor: UserProfile;
  onProgress?: (stageText: string) => void;
}): Promise<PortfolioRemigrationResult> {
  const { firebaseUser, actor, onProgress } = params;
  if (!isSuperAdminUser(actor, firebaseUser.emailVerified)) {
    return { executed: false, reason: 'NOT_SUPERADMIN' };
  }

  const targetOrgId = 'org_axycore_main';

  // 1. Check completion marker in Firestore (list query is safe even when 0 docs exist)
  const existingMarkerSnap = await getDocs(
    query(
      collection(db, 'system_parameters'),
      where('organizationId', '==', targetOrgId),
      where('key', '==', AUTO_REMIGRATION_KEY)
    )
  );
  if (!existingMarkerSnap.empty) {
    return { executed: false, reason: 'ALREADY_COMPLETED' };
  }

  // 2. Request the one-time server snapshot with verified Firebase Auth ID token
  const idToken = await firebaseUser.getIdToken();
  const bundleResp = await fetch('/api/internal/su-gloria-remigration-bundle', {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!bundleResp.ok) {
    return { executed: false, reason: 'NO_PENDING_BUNDLE' };
  }
  const bundleJson = (await bundleResp.json()) as {
    available?: boolean;
    organizationId?: string;
    dataset?: RawAppSheetDataset;
  };
  if (!bundleJson.available || !bundleJson.dataset) {
    return { executed: false, reason: 'NO_PENDING_BUNDLE' };
  }

  const orgId = bundleJson.organizationId || targetOrgId;

  // 3. Delete ALL existing portfolio records in org_axycore_main
  onProgress?.('Eliminando clientes, préstamos, cuotas y cobros anteriores...');
  const refsToDelete: DocumentReference[] = [];
  const deletedByCollection: Record<string, number> = {};

  for (const colName of PORTFOLIO_RESET_COLLECTIONS) {
    try {
      const snap = await getDocs(
        query(collection(db, colName), where('organizationId', '==', orgId))
      );
      deletedByCollection[colName] = snap.size;
      snap.forEach((docSnap) => refsToDelete.push(docSnap.ref));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colName);
    }
  }

  if (refsToDelete.length > 0) {
    onProgress?.(`Borrando ${refsToDelete.length} registros antiguos en lotes seguros...`);
    await commitBatchedOps(
      refsToDelete.map((ref) => (batch) => batch.delete(ref)),
      'auto_portfolio_remigration_wipe'
    );
  }

  // 4. Prepare clean-slate plan and write 100% of verified portfolio
  onProgress?.('Construyendo cartera limpia (clientes, préstamos, cuotas y pagos)...');
  const cleanPlan = prepareAppSheetMigrationPlan({
    dataset: bundleJson.dataset,
    organizationId: orgId,
    actorUid: actor.uid,
    actorName: actor.displayName || actor.email || 'Superadmin AxyCore',
    existingCustomers: [],
    existingLoans: [],
  });

  onProgress?.(
    `Migrando ${cleanPlan.customers.length} clientes, ${cleanPlan.loans.length} préstamos, ${cleanPlan.installments.length} cuotas y ${cleanPlan.payments.length} pagos...`
  );
  const written = await writeCleanPlanToFirestore({ plan: cleanPlan, actor });

  // 4b. Immediately sync active collection accounts with the freshly migrated arrays
  onProgress?.('Sincronizando cuentas activas de cobranza y totales de cartera...');
  try {
    await syncDisbursedLoansAndDailyCutoff({
      user: { ...actor, organizationId: orgId },
      loans: cleanPlan.loans,
      installments: cleanPlan.installments,
      customers: cleanPlan.customers,
      existingAccounts: [],
      promises: cleanPlan.promises,
      payments: cleanPlan.payments,
      actions: cleanPlan.actions,
      disputes: [],
      exceptions: [],
      existingAlerts: [],
      existingTasks: [],
      saveSnapshot: true,
    });
  } catch {
    // Non-blocking: collections sync will also refresh automatically on next cutoff
  }

  // 5. Write completion marker + immutable audit log
  onProgress?.('Registrando auditoría y sellando migración...');
  const executedAtIso = new Date().toISOString();
  const auditId = generateId('audit');
  await setDoc(doc(db, 'system_parameters', AUTO_REMIGRATION_KEY), {
    id: AUTO_REMIGRATION_KEY,
    organizationId: orgId,
    key: AUTO_REMIGRATION_KEY,
    value: {
      completed: true,
      executedAtIso,
      deletedTotalDocs: refsToDelete.length,
      writtenCustomers: written.writtenCustomers,
      writtenLoans: written.writtenLoans,
      writtenInstallments: written.writtenInstallments,
      writtenPayments: written.writtenPayments,
      activePortfolioCapitalDop: cleanPlan.summary.dop.activePortfolioCapital,
      activePortfolioCapitalUsd: cleanPlan.summary.usd.activePortfolioCapital,
    },
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(collection(db, 'audit_logs'), auditId), {
    id: auditId,
    organizationId: orgId,
    eventType: 'PORTFOLIO_CLEAN_REMIGRATION_EXECUTED',
    entityType: 'portfolio_migration',
    entityId: orgId,
    action: `Re-migración completa directa: ${refsToDelete.length} borrados -> ${written.writtenCustomers} clientes y ${written.writtenLoans} préstamos.`.slice(
      0,
      195
    ),
    previousState: JSON.stringify(deletedByCollection).slice(0, 3900),
    newState: JSON.stringify({
      ...written,
      activePortfolioCapitalDop: cleanPlan.summary.dop.activePortfolioCapital,
      activePortfolioCapitalUsd: cleanPlan.summary.usd.activePortfolioCapital,
    }),
    transactionId: generateId('tx'),
    userId: actor.uid,
    userEmail: actor.email,
    userRole: actor.role,
    timestamp: serverTimestamp(),
  });

  // 6. Delete temporary server snapshot so zero migration file remains on disk
  try {
    await fetch('/api/internal/su-gloria-remigration-complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    // Non-blocking cleanup
  }

  return {
    executed: true,
    executedAtIso,
    organizationId: orgId,
    deletedTotalDocs: refsToDelete.length,
    ...written,
    activePortfolioCapitalDop: cleanPlan.summary.dop.activePortfolioCapital,
    activePortfolioCapitalUsd: cleanPlan.summary.usd.activePortfolioCapital,
  };
}
