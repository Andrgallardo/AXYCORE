import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  APPSHEET_MIGRATION_MARKER_ID,
  DEFAULT_APPSHEET_MIGRATION_ACCESS_KEY,
  DEFAULT_APPSHEET_MIGRATION_APP_ID,
  type AppSheetMigrationBundle,
  type AppSheetMigrationSummary,
} from '../engine/appsheetMigrationEngine';
import type { UserProfile } from '../types/axycore';
import { recordCriticalAuditEvent, sanitizeFirestorePayload } from './axycoreStore';

export interface MigrationProgressState {
  stage:
    | 'IDLE'
    | 'FETCHING_APPSHEET'
    | 'WRITING_CUSTOMERS'
    | 'WRITING_APPLICATIONS'
    | 'WRITING_FORMALIZATIONS'
    | 'WRITING_LOANS'
    | 'WRITING_INSTALLMENTS'
    | 'WRITING_PAYMENTS'
    | 'WRITING_FINANCIALS'
    | 'COMPLETED'
    | 'ERROR';
  message: string;
  completedOps: number;
  totalOps: number;
  percent: number;
}

export async function fetchAppSheetMigrationPreview(params: {
  user: UserProfile;
  appId?: string;
  accessKey?: string;
  forceRefresh?: boolean;
}): Promise<AppSheetMigrationBundle> {
  const {
    user,
    appId = DEFAULT_APPSHEET_MIGRATION_APP_ID,
    accessKey = DEFAULT_APPSHEET_MIGRATION_ACCESS_KEY,
    forceRefresh = false,
  } = params;

  const response = await fetch('/api/migration/appsheet/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId,
      accessKey,
      organizationId: user.organizationId,
      actorUid: user.uid,
      actorName: user.displayName || user.email,
      forceRefresh,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    bundle?: AppSheetMigrationBundle;
    error?: string;
  };

  if (!response.ok || !data.ok || !data.bundle) {
    throw new Error(
      data.error || 'No fue posible obtener los datos desde la plataforma origen AppSheet.'
    );
  }

  return data.bundle;
}

export async function checkAppSheetMigrationCompleted(organizationId: string): Promise<{
  migrated: boolean;
  summary?: AppSheetMigrationSummary;
  migratedAtIso?: string;
}> {
  try {
    const markerId = `${APPSHEET_MIGRATION_MARKER_ID}_${organizationId}`;
    const snap = await getDoc(doc(db, 'system_parameters', markerId));
    if (!snap.exists()) {
      return { migrated: false };
    }
    const data = snap.data();
    const val = (data?.value ?? {}) as {
      completed?: boolean;
      summary?: AppSheetMigrationSummary;
      migratedAtIso?: string;
    };
    return {
      migrated: Boolean(val.completed),
      summary: val.summary,
      migratedAtIso: val.migratedAtIso,
    };
  } catch {
    return { migrated: false };
  }
}

async function commitOperationsInChunks(
  ops: Array<{
    collectionName: string;
    docId: string;
    payload: Record<string, unknown>;
  }>,
  onChunkDone?: (chunkCount: number) => void
): Promise<void> {
  const dedupedMap = new Map<
    string,
    { collectionName: string; docId: string; payload: Record<string, unknown> }
  >();
  for (const op of ops) {
    dedupedMap.set(`${op.collectionName}/${op.docId}`, op);
  }
  const uniqueOps = Array.from(dedupedMap.values());

  const CHUNK_SIZE = 280;
  for (let i = 0; i < uniqueOps.length; i += CHUNK_SIZE) {
    const slice = uniqueOps.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of slice) {
      batch.set(doc(db, op.collectionName, op.docId), sanitizeFirestorePayload(op.payload));
    }
    try {
      await batch.commit();
      if (onChunkDone) onChunkDone(slice.length);
    } catch (error) {
      const firstPath = slice[0] ? `${slice[0].collectionName}/${slice[0].docId}` : 'migration_batch';
      handleFirestoreError(error, OperationType.WRITE, firstPath);
    }
  }
}

export async function executeAppSheetMigrationToFirestore(params: {
  user: UserProfile;
  appId?: string;
  accessKey?: string;
  forceRefresh?: boolean;
  bundle?: AppSheetMigrationBundle;
  onProgress?: (state: MigrationProgressState) => void;
}): Promise<AppSheetMigrationBundle> {
  const { user, appId, accessKey, forceRefresh, onProgress } = params;

  onProgress?.({
    stage: 'FETCHING_APPSHEET',
    message: 'Extrayendo clientes, préstamos, cuotas, pagos y estados financieros desde AppSheet...',
    completedOps: 0,
    totalOps: 100,
    percent: 5,
  });

  const bundle =
    params.bundle ??
    (await fetchAppSheetMigrationPreview({
      user,
      appId,
      accessKey,
      forceRefresh,
    }));

  const step1Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.customers.map((c) => ({
      collectionName: 'customers',
      docId: c.id,
      payload: {
        ...c,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
    ...bundle.businesses.map((b) => ({
      collectionName: 'businesses',
      docId: b.id,
      payload: {
        ...b,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const safeActorDisplayName = (user.displayName || user.email || 'Administrador').trim().slice(0, 160);
  const step2Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.applications.map((a) => ({
      collectionName: 'applications',
      docId: a.id,
      payload: {
        ...a,
        applicantDisplayName: (a.applicantDisplayName || 'Solicitante').slice(0, 200),
        requestedAmount: Math.max(0, Math.min(100_000_000, Number(a.requestedAmount) || 0)),
        requestedTermMonths: Math.max(0, Math.min(360, Math.round(Number(a.requestedTermMonths) || 0))),
        createdBy: user.uid,
        createdByName: safeActorDisplayName,
        assignedTo: user.uid,
        assignedToName: safeActorDisplayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
    ...bundle.applicationDocuments.map((d) => ({
      collectionName: 'application_documents',
      docId: d.id,
      payload: {
        ...d,
        uploadedBy: user.uid,
        uploadedByName: user.displayName || user.email,
        uploadedAt: serverTimestamp(),
      },
    })),
  ];

  const step3Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.committeeDecisions.map((cd) => ({
      collectionName: 'committee_decisions',
      docId: cd.id,
      payload: {
        ...cd,
        decidedBy: user.uid,
        decidedByName: user.displayName || user.email,
        decidedAt: serverTimestamp(),
      },
    })),
    ...bundle.formalizations.map((f) => ({
      collectionName: 'formalizations',
      docId: f.id,
      payload: {
        ...f,
        formalizedBy: user.uid,
        formalizedByName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const step4Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.disbursements.map((ds) => ({
      collectionName: 'disbursements',
      docId: ds.id,
      payload: {
        ...ds,
        responsibleUserId: user.uid,
        responsibleUserName: user.displayName || user.email,
        authorizerUserId: user.uid,
        authorizerUserName: user.displayName || user.email,
        createdAt: serverTimestamp(),
      },
    })),
    ...bundle.loans.map((l) => ({
      collectionName: 'loans',
      docId: l.id,
      payload: {
        ...l,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const step5Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.loanInstallments.map((inst) => ({
      collectionName: 'loan_installments',
      docId: inst.id,
      payload: {
        ...inst,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
    ...bundle.collectionAccounts.map((acc) => ({
      collectionName: 'collection_accounts',
      docId: acc.id,
      payload: {
        ...acc,
        assignedCollectorId: user.uid,
        assignedCollectorName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const step6Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.payments.map((p) => ({
      collectionName: 'payments',
      docId: p.id,
      payload: {
        ...p,
        reportedByUserId: user.uid,
        ...(p.status === 'APLICADO'
          ? {
              verifiedByUserId: user.uid,
              appliedByUserId: user.uid,
            }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
    ...bundle.paymentAllocations.map((pa) => ({
      collectionName: 'payment_allocations',
      docId: pa.id,
      payload: {
        ...pa,
        appliedByUserId: user.uid,
        createdAt: serverTimestamp(),
      },
    })),
    ...bundle.collectionReceipts.map((rc) => ({
      collectionName: 'collection_receipts',
      docId: rc.id,
      payload: {
        ...rc,
        issuedBy: user.uid,
        issuedByName: user.displayName || user.email,
        createdAt: serverTimestamp(),
      },
    })),
    ...bundle.paymentAgreements.map((ag) => ({
      collectionName: 'payment_agreements',
      docId: ag.id,
      payload: {
        ...ag,
        proposedBy: user.uid,
        proposedByName: user.displayName || user.email,
        approvedBy: user.uid,
        approvedByName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const step7Ops: Array<{ collectionName: string; docId: string; payload: Record<string, unknown> }> = [
    ...bundle.investors.map((inv) => ({
      collectionName: 'investors',
      docId: inv.id,
      payload: {
        ...inv,
        createdBy: user.uid,
        createdByName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
    ...bundle.investorTransactions.map((tx) => ({
      collectionName: 'investor_transactions',
      docId: tx.id,
      payload: {
        ...tx,
        createdBy: user.uid,
        createdByName: user.displayName || user.email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    })),
  ];

  const totalOps =
    step1Ops.length +
    step2Ops.length +
    step3Ops.length +
    step4Ops.length +
    step5Ops.length +
    step6Ops.length +
    step7Ops.length;
  let completedOps = 0;

  const advance = (
    stage: MigrationProgressState['stage'],
    message: string,
    delta = 0
  ) => {
    completedOps += delta;
    const percent = Math.min(99, Math.max(8, Math.round((completedOps / Math.max(1, totalOps)) * 90) + 8));
    onProgress?.({
      stage,
      message,
      completedOps,
      totalOps,
      percent,
    });
  };

  advance('WRITING_CUSTOMERS', `Adaptando y guardando ${bundle.customers.length} clientes y empresas...`);
  await commitOperationsInChunks(step1Ops, (n) =>
    advance('WRITING_CUSTOMERS', `Clientes sincronizados (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_APPLICATIONS',
    `Sincronizando ${bundle.applications.length} solicitudes y ${bundle.applicationDocuments.length} expedientes digitales...`
  );
  await commitOperationsInChunks(step2Ops, (n) =>
    advance('WRITING_APPLICATIONS', `Solicitudes y expedientes (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_FORMALIZATIONS',
    `Sincronizando resoluciones de comité y ${bundle.formalizations.length} formalizaciones...`
  );
  await commitOperationsInChunks(step3Ops, (n) =>
    advance('WRITING_FORMALIZATIONS', `Formalizaciones (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_LOANS',
    `Sincronizando ${bundle.disbursements.length} desembolsos y ${bundle.loans.length} préstamos...`
  );
  await commitOperationsInChunks(step4Ops, (n) =>
    advance('WRITING_LOANS', `Préstamos y desembolsos (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_INSTALLMENTS',
    `Sincronizando ${bundle.loanInstallments.length} cuotas de amortización y cuentas de cobro...`
  );
  await commitOperationsInChunks(step5Ops, (n) =>
    advance('WRITING_INSTALLMENTS', `Cuotas y cuentas de cobro (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_PAYMENTS',
    `Sincronizando ${bundle.payments.length} pagos realizados, imputaciones y recibos oficiales...`
  );
  await commitOperationsInChunks(step6Ops, (n) =>
    advance('WRITING_PAYMENTS', `Pagos y recibos contables (${completedOps + n}/${totalOps})...`, n)
  );

  advance(
    'WRITING_FINANCIALS',
    'Sincronizando respaldo financiero patrimonial y cerrando bitácora de migración...'
  );
  await commitOperationsInChunks(step7Ops, (n) =>
    advance('WRITING_FINANCIALS', `Registros financieros (${completedOps + n}/${totalOps})...`, n)
  );

  // Save migration marker if user is ADMIN
  if (user.role === 'ADMIN') {
    const markerId = `${APPSHEET_MIGRATION_MARKER_ID}_${user.organizationId}`;
    try {
      await setDoc(doc(db, 'system_parameters', markerId), {
        id: markerId,
        organizationId: user.organizationId,
        key: 'appsheet_migration_status',
        value: {
          completed: true,
          sourceAppId: bundle.summary.sourceAppId,
          migratedAtIso: new Date().toISOString(),
          summary: bundle.summary,
        },
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking if non-admin role executed migration
    }
  }

  await recordCriticalAuditEvent({
    user,
    eventType: 'PLATFORM_MIGRATION_APPSHEET_COMPLETED',
    entityType: 'organizations',
    entityId: user.organizationId,
    action: `Migración integral desde AppSheet (${bundle.summary.sourceAppId}): ${bundle.summary.customersCount} clientes, ${bundle.summary.loansCount} préstamos, ${bundle.summary.installmentsCount} cuotas y ${bundle.summary.paymentsCount} pagos`,
    newState: `CARTERA_MIGRADA_DOP_${bundle.summary.totalPortfolioFinancedDop}`,
    justification: 'Sincronización de clientes, préstamos, pagos e historial financiero a AxyCore.',
  }).catch(() => {});

  onProgress?.({
    stage: 'COMPLETED',
    message: 'Migración completada exitosamente en AxyCore.',
    completedOps: totalOps,
    totalOps,
    percent: 100,
  });

  return bundle;
}


