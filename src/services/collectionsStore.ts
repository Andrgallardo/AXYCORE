import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  diffCalendarDays,
  evaluateLoanDelinquency,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from '../engine/collections/delinquencyEngine';
import {
  computeCollectionPriority,
  generateAutomatedCollectionTasks,
} from '../engine/collections/priorityAndTasksEngine';
import {
  canApprovePaymentAgreement,
  evaluatePromiseFulfillment,
  validateContactPermission,
} from '../engine/collections/promisesAndActionsEngine';
import {
  allocatePaymentAcrossInstallments,
  buildBankTxIdempotencyHash,
  buildOfficialReceipt,
  classifyAndMatchBankTransaction,
  computePaymentReversal,
  parseBankStatementText,
} from '../engine/collections/paymentsAndReconciliationEngine';
import {
  buildReproducibleDailySnapshot,
  evaluateBotDispatchEligibility,
  renderBotTemplate,
  runSentinelAlertScan,
  validateLoanCancellationEligibility,
} from '../engine/collections/botAndSentinelEngine';
import { hasRolePermission } from '../engine/rbac';
import { generateId } from './axycoreStore';
import type {
  BankTransactionRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionAssignmentRecord,
  CollectionCampaignRecord,
  CollectionChannel,
  CollectionContactResult,
  CollectionDailySnapshotRecord,
  CollectionPolicyVersionRecord,
  CollectionPriority,
  CollectionTaskRecord,
  CollectionTaskStatus,
  CollectorTargetRecord,
  CurrencyCode,
  CustomerDisputeRecord,
  CustomerRecord,
  DisputeType,
  LoanInstallmentRecord,
  LoanRecord,
  MessageEventRecord,
  MessageTemplateRecord,
  PaymentAgreementRecord,
  PaymentAllocationRecord,
  PaymentChannelMethod,
  PaymentIntentRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  ReconciliationExceptionRecord,
  ReconciliationMatchRecord,
  RiskAlertRecord,
  UserProfile,
} from '../types/axycore';

function cleanObject<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export async function fetchAllOrgInstallments(orgId: string): Promise<LoanInstallmentRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'loan_installments'), where('organizationId', '==', orgId))
    );
    return snap.docs
      .map((d) => d.data() as LoanInstallmentRecord)
      .sort((a, b) => a.installmentNumber - b.installmentNumber);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'loan_installments');
  }
}

export async function syncDisbursedLoansAndDailyCutoff(params: {
  user: UserProfile;
  loans: LoanRecord[];
  installments: LoanInstallmentRecord[];
  customers: CustomerRecord[];
  existingAccounts: CollectionAccountRecord[];
  promises: PaymentPromiseRecord[];
  payments: PaymentRecord[];
  actions: CollectionActionRecord[];
  disputes: CustomerDisputeRecord[];
  exceptions: ReconciliationExceptionRecord[];
  existingAlerts: RiskAlertRecord[];
  existingTasks: CollectionTaskRecord[];
  policy?: CollectionPolicyVersionRecord;
  asOfDateIso?: string;
  saveSnapshot?: boolean;
}): Promise<{ syncedLoans: number; newAlerts: number; newTasks: number }> {
  const {
    user,
    loans,
    installments,
    customers,
    existingAccounts,
    promises,
    payments,
    actions,
    disputes,
    exceptions,
    existingAlerts,
    existingTasks,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    asOfDateIso = getSantoDomingoTodayIso(),
    saveSnapshot = true,
  } = params;

  const orgId = user.organizationId;
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const accMap = new Map(existingAccounts.map((a) => [a.loanId, a]));

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const nextAccounts: CollectionAccountRecord[] = [];
  const nextInstallments: LoanInstallmentRecord[] = [];

  for (const loan of loans) {
    const loanInsts = installments.filter((i) => i.loanId === loan.id);
    const existingAcc = accMap.get(loan.id) ?? null;

    // Evaluate promises for this loan first
    const loanPromises = promises
      .filter((p) => p.loanId === loan.id)
      .map((p) => {
        const res = evaluatePromiseFulfillment({
          promise: p,
          payments,
          asOfDateIso,
          autoMarkBrokenPromises: policy.autoMarkBrokenPromises,
        });
        if (res.changed) {
          ops.push((b) =>
            b.update(doc(db, 'payment_promises', p.id), {
              status: res.promise.status,
              fulfilledAmount: res.promise.fulfilledAmount,
              fulfilledPaymentIds: res.promise.fulfilledPaymentIds,
              verifiedAt: res.promise.verifiedAt ?? null,
              updatedAt: serverTimestamp(),
            })
          );
        }
        return res.promise;
      });

    const evaluated = evaluateLoanDelinquency({
      loan,
      installments: loanInsts,
      customer: custMap.get(loan.customerId) ?? null,
      policy,
      asOfDateIso,
      existingAccount: existingAcc,
      promises: loanPromises,
      payments,
      actions,
      disputes,
    });

    const priorityEval = computeCollectionPriority({
      account: evaluated.account,
      promises: loanPromises,
      alerts: existingAlerts,
      asOfDateIso,
    });

    const fullAccount: CollectionAccountRecord = {
      ...evaluated.account,
      priority: priorityEval.priority,
      priorityScore: priorityEval.score,
      priorityReasons: priorityEval.reasons,
    };
    nextAccounts.push(fullAccount);
    nextInstallments.push(...evaluated.updatedInstallments);

    // Persist collection_accounts create/update
    if (!existingAcc) {
      ops.push((b) =>
        b.set(
          doc(db, 'collection_accounts', loan.id),
          cleanObject({
            ...fullAccount,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
    } else {
      ops.push((b) =>
        b.update(
          doc(db, 'collection_accounts', loan.id),
          cleanObject({
            ...fullAccount,
            createdAt: existingAcc.createdAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
    }

    // Update installment status/accruedLateFee if changed and permitted
    for (const updInst of evaluated.updatedInstallments) {
      const origInst = loanInsts.find((i) => i.id === updInst.id);
      if (!origInst) continue;
      const statusChanged = origInst.status !== updInst.status;
      const lateFeeChanged =
        toCents(origInst.accruedLateFee ?? 0) !== toCents(updInst.accruedLateFee ?? 0);
      if (
        (statusChanged || lateFeeChanged) &&
        ['PENDIENTE', 'VENCIDA', 'PARCIAL'].includes(origInst.status) &&
        ['PENDIENTE', 'VENCIDA', 'PARCIAL'].includes(updInst.status)
      ) {
        ops.push((b) =>
          b.update(doc(db, 'loan_installments', updInst.id), {
            status: updInst.status,
            accruedLateFee: updInst.accruedLateFee ?? 0,
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    // Update loan status ACTIVO <-> VENCIDO when changed (never overwrite CANCELADO/PAGADO)
    if (
      loan.status !== 'CANCELADO' &&
      evaluated.derivedLoanStatus !== loan.status &&
      ['ACTIVO', 'VENCIDO'].includes(evaluated.derivedLoanStatus)
    ) {
      ops.push((b) =>
        b.update(doc(db, 'loans', loan.id), {
          status: evaluated.derivedLoanStatus,
          updatedAt: serverTimestamp(),
        })
      );
    }
  }

  // Generate Centinela alerts
  const newAlerts = runSentinelAlertScan({
    organizationId: orgId,
    accounts: nextAccounts,
    installments: nextInstallments,
    promises,
    payments,
    disputes,
    exceptions,
    existingAlerts,
    asOfDateIso,
  });

  for (const alert of newAlerts) {
    ops.push((b) =>
      b.set(
        doc(db, 'risk_alerts', alert.id),
        cleanObject({
          ...alert,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  // Generate deduplicated automated agenda tasks
  const newTasks = generateAutomatedCollectionTasks({
    organizationId: orgId,
    accounts: nextAccounts,
    promises,
    alerts: [...existingAlerts, ...newAlerts],
    existingTasks,
    asOfDateIso,
    fallbackAssigneeId: user.uid,
    fallbackAssigneeName: user.displayName,
  });

  for (const task of newTasks) {
    ops.push((b) =>
      b.set(
        doc(db, 'collection_tasks', task.id),
        cleanObject({
          ...task,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
    );
  }

  // Reproducible daily PAR snapshot
  if (saveSnapshot && loans.length > 0) {
    const snap = buildReproducibleDailySnapshot({
      organizationId: orgId,
      accounts: nextAccounts,
      cutoffDateIso: asOfDateIso,
      policyVersion: policy.version,
      createdBy: user.uid,
    });
    ops.push((b) =>
      b.set(
        doc(db, 'collection_daily_snapshots', snap.id),
        cleanObject({
          ...snap,
          createdAt: serverTimestamp(),
        })
      )
    );
  }

  // Commit in chunks of 400
  try {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((apply) => apply(batch));
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'collection_accounts');
  }

  return {
    syncedLoans: loans.length,
    newAlerts: newAlerts.length,
    newTasks: newTasks.length,
  };
}

export async function reassignCollectionAccounts(params: {
  assignments: Array<{
    account: CollectionAccountRecord;
    newCollectorId: string;
    newCollectorName: string;
    reason: string;
    ruleApplied?: string;
  }>;
  user: UserProfile;
}): Promise<void> {
  const { assignments, user } = params;
  if (!hasRolePermission(user.role, 'ASSIGN_COLLECTIONS_PORTFOLIO')) {
    throw new Error('Tu rol no tiene permiso para asignar o reasignar cuentas de cobranza.');
  }
  if (assignments.length === 0) return;

  const batch = writeBatch(db);
  for (const item of assignments) {
    const { account, newCollectorId, newCollectorName, reason, ruleApplied } = item;
    batch.update(doc(db, 'collection_accounts', account.id), {
      assignedCollectorId: newCollectorId,
      assignedCollectorName: newCollectorName,
      updatedAt: serverTimestamp(),
    });

    const assignId = generateId('assign');
    const assignRec: CollectionAssignmentRecord = {
      id: assignId,
      organizationId: account.organizationId,
      loanId: account.loanId,
      loanNumber: account.loanNumber,
      collectionAccountId: account.id,
      customerId: account.customerId,
      previousCollectorId: account.assignedCollectorId ?? null,
      previousCollectorName: account.assignedCollectorName ?? null,
      newCollectorId,
      newCollectorName,
      reason,
      ruleApplied: ruleApplied ?? 'MANUAL',
      assignedBy: user.uid,
      assignedByName: user.displayName,
    };
    batch.set(doc(db, 'collection_assignments', assignId), {
      ...assignRec,
      createdAt: serverTimestamp(),
    });

    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      organizationId: account.organizationId,
      eventType: 'COLLECTION_PORTFOLIO_ASSIGNED',
      entityType: 'collection_accounts',
      entityId: account.id,
      action: `Asignación ${account.loanNumber}: ${account.assignedCollectorName || 'Sin asignar'} -> ${newCollectorName}`,
      justification: reason,
      transactionId: assignId,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
      timestamp: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'collection_assignments');
  }
}

export async function recordCollectionAction(params: {
  account: CollectionAccountRecord;
  user: UserProfile;
  channel: CollectionChannel;
  contactResult: CollectionContactResult;
  notes: string;
  nextActionDate?: string | null;
  createPromise?: {
    promisedAmount: number;
    promisedDate: string;
    notes?: string;
  } | null;
  policy?: CollectionPolicyVersionRecord;
  existingActions: CollectionActionRecord[];
  disputes: CustomerDisputeRecord[];
  bypassScheduleWarning?: boolean;
}): Promise<{ actionId: string; promiseId: string | null }> {
  const {
    account,
    user,
    channel,
    contactResult,
    notes,
    nextActionDate,
    createPromise,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    existingActions,
    disputes,
    bypassScheduleWarning = false,
  } = params;

  if (!hasRolePermission(user.role, 'LOG_COLLECTION_ACTIONS')) {
    throw new Error('Tu rol no tiene permiso para registrar gestiones de cobranza.');
  }
  if (notes.trim().length < 3) {
    throw new Error('Debes ingresar un detalle/resultado de la gestión (mínimo 3 caracteres).');
  }

  const guard = validateContactPermission({
    loanId: account.loanId,
    policy,
    actions: existingActions,
    disputes,
    isAutomatedBot: false,
  });
  if (!guard.allowed && !bypassScheduleWarning) {
    throw new Error(guard.reason || 'Contacto bloqueado por política de frecuencia/horario.');
  }

  const batch = writeBatch(db);
  const actionId = generateId('cact');
  const nowIso = new Date().toISOString();
  let promiseId: string | null = null;

  if (createPromise && createPromise.promisedAmount > 0 && createPromise.promisedDate) {
    promiseId = generateId('prom');
    const promiseRec: PaymentPromiseRecord = {
      id: promiseId,
      organizationId: account.organizationId,
      loanId: account.loanId,
      loanNumber: account.loanNumber,
      customerId: account.customerId,
      customerName: account.applicantDisplayName,
      currency: account.currency,
      promisedAmount: Number(createPromise.promisedAmount),
      promisedDate: createPromise.promisedDate,
      channel,
      createdByUserId: user.uid,
      createdByUserName: user.displayName,
      status: 'VIGENTE',
      fulfilledAmount: 0,
      fulfilledPaymentIds: [],
      notes: createPromise.notes || notes.trim(),
    };
    batch.set(doc(db, 'payment_promises', promiseId), {
      ...cleanObject(promiseRec),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const actionRec: CollectionActionRecord = {
    id: actionId,
    organizationId: account.organizationId,
    loanId: account.loanId,
    loanNumber: account.loanNumber,
    customerId: account.customerId,
    customerName: account.applicantDisplayName,
    collectorId: user.uid,
    collectorName: user.displayName,
    channel,
    contactResult,
    notes: notes.trim(),
    dpdAtAction: account.dpd,
    nextActionDate: nextActionDate || null,
    promiseCreatedId: promiseId,
    isClosed: true,
    actionTimeIso: nowIso,
  };
  batch.set(doc(db, 'collection_actions', actionId), {
    ...cleanObject(actionRec),
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, 'collection_accounts', account.id), {
    lastActionAt: nowIso,
    lastActionType: channel,
    lastActionResult: contactResult,
    nextFollowUpDate: nextActionDate || account.nextFollowUpDate || null,
    ...(promiseId
      ? {
          activePromiseId: promiseId,
          activePromiseDate: createPromise!.promisedDate,
          activePromiseAmount: Number(createPromise!.promisedAmount),
        }
      : {}),
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: account.organizationId,
    eventType: 'COLLECTION_ACTION_LOGGED',
    entityType: 'collection_actions',
    entityId: actionId,
    action: `Gestión ${channel} (${contactResult}) en ${account.loanNumber}`,
    justification: notes.trim().slice(0, 300),
    transactionId: actionId,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `collection_actions/${actionId}`);
  }

  return { actionId, promiseId };
}

export async function correctClosedCollectionAction(params: {
  originalAction: CollectionActionRecord;
  user: UserProfile;
  correctedResult: CollectionContactResult;
  correctedNotes: string;
  correctionReason: string;
}): Promise<string> {
  const { originalAction, user, correctedResult, correctedNotes, correctionReason } = params;
  if (!hasRolePermission(user.role, 'LOG_COLLECTION_ACTIONS')) {
    throw new Error('Sin permiso para registrar corrección de gestión.');
  }
  if (correctionReason.trim().length < 5) {
    throw new Error('Debe especificar el motivo de la corrección.');
  }

  const newActionId = generateId('cact');
  const batch = writeBatch(db);
  batch.update(doc(db, 'collection_actions', originalAction.id), {
    supersededByActionId: newActionId,
  });

  const rec: CollectionActionRecord = {
    id: newActionId,
    organizationId: originalAction.organizationId,
    loanId: originalAction.loanId,
    loanNumber: originalAction.loanNumber,
    customerId: originalAction.customerId,
    customerName: originalAction.customerName,
    collectorId: user.uid,
    collectorName: user.displayName,
    channel: originalAction.channel,
    contactResult: correctedResult,
    notes: correctedNotes.trim(),
    dpdAtAction: originalAction.dpdAtAction,
    nextActionDate: originalAction.nextActionDate ?? null,
    isClosed: true,
    correctsActionId: originalAction.id,
    correctionReason: correctionReason.trim(),
    actionTimeIso: new Date().toISOString(),
  };

  batch.set(doc(db, 'collection_actions', newActionId), {
    ...cleanObject(rec),
    createdAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: originalAction.organizationId,
    eventType: 'COLLECTION_ACTION_CORRECTED',
    entityType: 'collection_actions',
    entityId: newActionId,
    action: `Corrección de gestión cerrada ${originalAction.id} -> ${newActionId}`,
    justification: correctionReason.trim(),
    transactionId: newActionId,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `collection_actions/${newActionId}`);
  }
  return newActionId;
}

export async function updateCollectionTaskStatus(params: {
  task: CollectionTaskRecord;
  nextStatus: CollectionTaskStatus;
  outcomeNotes?: string;
  user: UserProfile;
}): Promise<void> {
  const { task, nextStatus, outcomeNotes, user } = params;
  if (!hasRolePermission(user.role, 'LOG_COLLECTION_ACTIONS') && !hasRolePermission(user.role, 'ASSIGN_COLLECTIONS_PORTFOLIO')) {
    throw new Error('Sin permiso para actualizar tareas de agenda.');
  }
  try {
    await updateDoc(doc(db, 'collection_tasks', task.id), {
      status: nextStatus,
      ...(nextStatus === 'COMPLETADA'
        ? { completedBy: user.uid, completedAt: new Date().toISOString() }
        : {}),
      ...(outcomeNotes !== undefined ? { outcomeNotes } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `collection_tasks/${task.id}`);
  }
}

export async function createManualCollectionTask(params: {
  account: CollectionAccountRecord;
  assignedToUserId: string;
  assignedToUserName: string;
  priority: CollectionPriority;
  title: string;
  description: string;
  dueDate: string;
  user: UserProfile;
}): Promise<string> {
  const {
    account,
    assignedToUserId,
    assignedToUserName,
    priority,
    title,
    description,
    dueDate,
    user,
  } = params;
  const taskId = generateId('task_manual');
  const rec: CollectionTaskRecord = {
    id: taskId,
    organizationId: account.organizationId,
    loanId: account.loanId,
    loanNumber: account.loanNumber,
    customerId: account.customerId,
    customerName: account.applicantDisplayName,
    assignedToUserId,
    assignedToUserName,
    taskType: 'TAREA_MANUAL',
    sourceEventKey: taskId,
    priority,
    title: title.trim(),
    description: description.trim(),
    dueDate,
    status: 'PENDIENTE',
  };
  try {
    await setDoc(doc(db, 'collection_tasks', taskId), {
      ...rec,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `collection_tasks/${taskId}`);
  }
  return taskId;
}

function normalizePaymentMethod(rawMethod: string | undefined): PaymentChannelMethod {
  const upper = String(rawMethod || 'TRANSFERENCIA').trim().toUpperCase();
  if (upper === 'CAJA_EFECTIVO' || upper === 'EFECTIVO') return 'CAJA_EFECTIVO';
  if (upper === 'DEPOSITO' || upper === 'DEPOSITO_BANCARIO') return 'DEPOSITO';
  if (upper === 'TARJETA') return 'TARJETA';
  if (upper === 'CHEQUE') return 'CHEQUE';
  if (upper === 'LINK_PAGO') return 'LINK_PAGO';
  return 'TRANSFERENCIA';
}

function buildValidLoanDocForFirestore(loan: LoanRecord, actorUid: string): Record<string, unknown> {
  const approvedPrincipal = Math.max(0.01, Math.round((Number(loan.approvedPrincipal) || 0.01) * 100) / 100);
  const totalFinancedPrincipal = Math.max(
    approvedPrincipal,
    Math.round((Number(loan.totalFinancedPrincipal) || approvedPrincipal) * 100) / 100
  );
  const currentPrincipalBalance = Math.max(
    0,
    Math.round((Number(loan.currentPrincipalBalance) || 0) * 100) / 100
  );
  const rawLoanNum = String(loan.loanNumber || loan.id || 'PRE-001').trim();
  const safeLoanNumber = (rawLoanNum.length >= 3 ? rawLoanNum : `PRE-${rawLoanNum}`).slice(0, 64);

  return cleanObject({
    id: loan.id,
    organizationId: loan.organizationId,
    loanNumber: safeLoanNumber,
    applicationId: loan.applicationId || loan.id,
    disbursementId: loan.disbursementId || loan.applicationId || loan.id,
    customerId: loan.customerId,
    ...(loan.businessId ? { businessId: loan.businessId } : {}),
    applicantDisplayName: (loan.applicantDisplayName || 'Cliente').slice(0, 200),
    productCode: ['PERSONAL_DOP', 'EMPRESARIAL_DOP', 'PERSONAL_USD', 'EMPRESARIAL_USD'].includes(
      loan.productCode
    )
      ? loan.productCode
      : loan.currency === 'USD'
      ? 'PERSONAL_USD'
      : 'PERSONAL_DOP',
    currency: loan.currency === 'USD' ? 'USD' : 'DOP',
    approvedPrincipal,
    financedExpenses: Math.max(0, Math.round((Number(loan.financedExpenses) || 0) * 100) / 100),
    totalFinancedPrincipal,
    currentPrincipalBalance,
    contractualRateMonthly: Math.max(0, Number(loan.contractualRateMonthly) || 0),
    termMonths: Math.max(1, Math.min(360, Math.round(Number(loan.termMonths) || 1))),
    frequency: ['MENSUAL', 'QUINCENAL', 'SEMANAL'].includes(loan.frequency)
      ? loan.frequency
      : 'MENSUAL',
    amortizationMethod: ['SALDO_INSOLUTO', 'INTERES_FIJO'].includes(loan.amortizationMethod)
      ? loan.amortizationMethod
      : 'SALDO_INSOLUTO',
    disbursementDate: (loan.disbursementDate || getSantoDomingoTodayIso()).slice(0, 20),
    firstPaymentDate: (loan.firstPaymentDate || loan.disbursementDate || getSantoDomingoTodayIso()).slice(0, 20),
    maturityDate: (loan.maturityDate || loan.firstPaymentDate || getSantoDomingoTodayIso()).slice(0, 20),
    totalContractualInterest: Math.max(0, Number(loan.totalContractualInterest) || 0),
    totalContractualPayable: Math.max(totalFinancedPrincipal, Number(loan.totalContractualPayable) || totalFinancedPrincipal),
    status: ['ACTIVO', 'PAGADO', 'VENCIDO', 'CANCELADO'].includes(loan.status)
      ? loan.status
      : 'ACTIVO',
    paidPrincipalTotal: Math.max(0, Math.round((Number(loan.paidPrincipalTotal) || 0) * 100) / 100),
    paidInterestTotal: Math.max(0, Math.round((Number(loan.paidInterestTotal) || 0) * 100) / 100),
    paidLateFeeTotal: Math.max(0, Math.round((Number(loan.paidLateFeeTotal) || 0) * 100) / 100),
    ...(loan.closedAt ? { closedAt: String(loan.closedAt).slice(0, 40) } : {}),
    ...(loan.closureCertificateNumber
      ? { closureCertificateNumber: String(loan.closureCertificateNumber).slice(0, 64) }
      : {}),
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function buildValidInstallmentDocForFirestore(
  inst: LoanInstallmentRecord,
  fallbackOrgId: string
): Record<string, unknown> {
  const dueDate =
    inst.dueDate && inst.dueDate.length >= 8 ? inst.dueDate.slice(0, 20) : getSantoDomingoTodayIso();
  return cleanObject({
    id: inst.id,
    organizationId: inst.organizationId || fallbackOrgId,
    loanId: inst.loanId,
    installmentNumber: Math.max(1, Math.min(360, Math.round(Number(inst.installmentNumber) || 1))),
    dueDate,
    principalAmount: Math.max(0, Math.round((Number(inst.principalAmount) || 0) * 100) / 100),
    interestAmount: Math.max(0, Math.round((Number(inst.interestAmount) || 0) * 100) / 100),
    otherCharges: Math.max(0, Math.round((Number(inst.otherCharges) || 0) * 100) / 100),
    totalAmount: Math.max(0, Math.round((Number(inst.totalAmount) || 0) * 100) / 100),
    remainingPrincipalBalance: Math.max(
      0,
      Math.round((Number(inst.remainingPrincipalBalance) || 0) * 100) / 100
    ),
    status: ['PENDIENTE', 'PARCIAL', 'PAGADA', 'VENCIDA'].includes(inst.status)
      ? inst.status
      : 'PENDIENTE',
    paidPrincipal: Math.max(0, Math.round((Number(inst.paidPrincipal) || 0) * 100) / 100),
    paidInterest: Math.max(0, Math.round((Number(inst.paidInterest) || 0) * 100) / 100),
    paidOtherCharges: Math.max(0, Math.round((Number(inst.paidOtherCharges) || 0) * 100) / 100),
    paidLateFee: Math.max(0, Math.round((Number(inst.paidLateFee) || 0) * 100) / 100),
    accruedLateFee: Math.max(0, Math.round((Number(inst.accruedLateFee) || 0) * 100) / 100),
    ...(inst.paidAt ? { paidAt: String(inst.paidAt).slice(0, 40) } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function reportPaymentPendingVerification(params: {
  loan: LoanRecord;
  amount: number;
  paymentDate: string;
  method: PaymentChannelMethod;
  bankName?: string;
  referenceNumber: string;
  receiptEvidenceName?: string;
  receiptEvidenceMimeType?: string;
  receiptEvidenceSizeBytes?: number;
  receiptEvidenceDataUrl?: string;
  notes?: string;
  user: UserProfile;
}): Promise<PaymentRecord> {
  const {
    loan,
    amount,
    paymentDate,
    bankName,
    referenceNumber,
    receiptEvidenceName,
    receiptEvidenceMimeType,
    receiptEvidenceSizeBytes,
    receiptEvidenceDataUrl,
    notes,
    user,
  } = params;
  const method = normalizePaymentMethod(params.method);

  const isClientSelfReport = user.role === 'EXTERNAL_CLIENT' && loan.createdBy === user.uid;
  if (
    !hasRolePermission(user.role, 'REPORT_PAYMENTS') &&
    !hasRolePermission(user.role, 'VERIFY_AND_APPLY_PAYMENTS') &&
    !isClientSelfReport
  ) {
    throw new Error('Tu rol no tiene permiso para reportar pagos.');
  }
  if (loan.status === 'CANCELADO') {
    throw new Error('No se pueden reportar pagos para un préstamo CANCELADO.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto del pago debe ser mayor que cero.');
  }
  if (receiptEvidenceDataUrl && receiptEvidenceDataUrl.length > 700_000) {
    throw new Error('El comprobante adjunto supera el tamaño máximo permitido (~500 KB).');
  }

  const payId = generateId('pay');
  const initialStatus: PaymentRecord['status'] = 'RECIBIDO_PENDIENTE_VERIFICACION';
  const cleanRef = (referenceNumber || '').trim() || payId.toUpperCase();
  const safePayDate = (paymentDate || getSantoDomingoTodayIso()).slice(0, 10);
  const rec: PaymentRecord = {
    id: payId,
    organizationId: loan.organizationId || user.organizationId,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.applicantDisplayName,
    currency: loan.currency,
    amount: Math.round(amount * 100) / 100,
    paymentDate: safePayDate,
    method,
    bankName: bankName?.trim() || '',
    referenceNumber: cleanRef,
    idempotencyKey: `${loan.id}_${toCents(amount)}_${safePayDate}_${cleanRef.toUpperCase()}`,
    receiptEvidenceName: receiptEvidenceName ? receiptEvidenceName.slice(0, 240) : '',
    ...(receiptEvidenceMimeType
      ? { receiptEvidenceMimeType: receiptEvidenceMimeType.slice(0, 120) }
      : {}),
    ...(typeof receiptEvidenceSizeBytes === 'number' && receiptEvidenceSizeBytes >= 0
      ? { receiptEvidenceSizeBytes }
      : {}),
    ...(receiptEvidenceDataUrl ? { receiptEvidenceDataUrl } : {}),
    receiptEvidenceNote: notes || '',
    status: initialStatus,
    reportedByUserId: user.uid,
    reportedByName: user.displayName || user.email,
    notes: notes?.trim() || '',
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'payments', payId), {
    ...cleanObject(rec),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: rec.organizationId,
    eventType: 'PAYMENT_REPORTED_PENDING_VERIFICATION',
    entityType: 'payments',
    entityId: payId,
    action: `Pago registrado para validación contable (${loan.loanNumber}): ${loan.currency} ${rec.amount.toFixed(2)}`.slice(0, 195),
    justification: `Ref: ${rec.referenceNumber}${rec.receiptEvidenceName ? ` · Comprobante: ${rec.receiptEvidenceName}` : ''} · Sin afectar saldo hasta validación en Contabilidad`.slice(0, 950),
    transactionId: payId,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `payments/${payId}`);
  }
  return rec;
}

export async function attachPaymentEvidence(params: {
  payment: PaymentRecord;
  evidence: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
  };
  user: UserProfile;
}): Promise<void> {
  const { payment, evidence, user } = params;
  const isReporterOwner = payment.reportedByUserId === user.uid;
  const canAttach =
    hasRolePermission(user.role, 'REPORT_PAYMENTS') ||
    hasRolePermission(user.role, 'VERIFY_AND_APPLY_PAYMENTS') ||
    isReporterOwner;

  if (!canAttach) {
    throw new Error('Tu rol no tiene permiso para adjuntar comprobantes a este pago.');
  }
  if (!['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(payment.status)) {
    throw new Error('Solo se pueden adjuntar comprobantes a pagos pendientes de validación.');
  }
  if (!evidence.dataUrl || evidence.dataUrl.length > 700_000) {
    throw new Error('El comprobante adjunto supera el tamaño máximo permitido (~500 KB).');
  }

  const payRef = doc(db, 'payments', payment.id);
  const paySnap = await getDoc(payRef).catch(() => null);
  const batch = writeBatch(db);
  if (paySnap?.exists()) {
    batch.update(payRef, {
      receiptEvidenceName: evidence.fileName.slice(0, 240),
      receiptEvidenceMimeType: evidence.mimeType.slice(0, 120),
      receiptEvidenceSizeBytes: evidence.sizeBytes,
      receiptEvidenceDataUrl: evidence.dataUrl,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(payRef, {
      ...cleanObject(payment),
      receiptEvidenceName: evidence.fileName.slice(0, 240),
      receiptEvidenceMimeType: evidence.mimeType.slice(0, 120),
      receiptEvidenceSizeBytes: evidence.sizeBytes,
      receiptEvidenceDataUrl: evidence.dataUrl,
      reportedByUserId: payment.reportedByUserId || user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: payment.organizationId || user.organizationId,
    eventType: 'PAYMENT_EVIDENCE_ATTACHED',
    entityType: 'payments',
    entityId: payment.id,
    action: `Comprobante adjuntado al pago ${payment.loanNumber} (${evidence.fileName})`.slice(0, 195),
    justification: `Ref: ${payment.referenceNumber} · Pendiente de validación contable`.slice(0, 950),
    transactionId: payment.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payments/${payment.id}`);
  }
}

export async function registerAndApplyPaymentAtomicTransaction(params: {
  loan: LoanRecord;
  amount: number;
  paymentDate: string;
  method: PaymentChannelMethod;
  bankName?: string;
  referenceNumber: string;
  receiptEvidenceName?: string;
  notes?: string;
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  policy?: CollectionPolicyVersionRecord;
  user: UserProfile;
}): Promise<{ payment: PaymentRecord; receiptNumber: string; nextPrincipalBalance: number }> {
  const {
    loan,
    amount,
    paymentDate,
    bankName,
    referenceNumber,
    receiptEvidenceName,
    notes,
    installments,
    promises,
    policy,
    user,
  } = params;
  const method = normalizePaymentMethod(params.method);

  if (!hasRolePermission(user.role, 'VERIFY_AND_APPLY_PAYMENTS')) {
    throw new Error('Tu rol no tiene permiso para verificar y aplicar pagos directamente.');
  }
  if (loan.status === 'CANCELADO') {
    throw new Error('No se pueden aplicar pagos a un préstamo CANCELADO.');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto del pago debe ser mayor que cero.');
  }

  const payId = generateId('pay');
  const cleanRef = (referenceNumber || '').trim() || payId.toUpperCase();
  const safePayDate = (paymentDate || getSantoDomingoTodayIso()).slice(0, 10);
  const draftPayment: PaymentRecord = {
    id: payId,
    organizationId: loan.organizationId || user.organizationId,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.applicantDisplayName,
    currency: loan.currency,
    amount: Math.round(amount * 100) / 100,
    paymentDate: safePayDate,
    method,
    bankName: bankName?.trim() || '',
    referenceNumber: cleanRef,
    idempotencyKey: `${loan.id}_${toCents(amount)}_${safePayDate}_${cleanRef.toUpperCase()}`,
    receiptEvidenceName: receiptEvidenceName || '',
    receiptEvidenceNote: notes || '',
    status: 'VERIFICADO',
    reportedByUserId: user.uid,
    reportedByName: user.displayName || user.email,
    notes: notes?.trim() || '',
  };

  const applied = await verifyAndApplyPaymentTransaction({
    payment: draftPayment,
    loan,
    installments,
    promises,
    policy,
    user,
  });

  return {
    payment: {
      ...draftPayment,
      status: 'APLICADO',
      receiptNumber: applied.receiptNumber,
    },
    receiptNumber: applied.receiptNumber,
    nextPrincipalBalance: applied.nextPrincipalBalance,
  };
}

export async function verifyAndApplyPaymentTransaction(params: {
  payment: PaymentRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  policy?: CollectionPolicyVersionRecord;
  user: UserProfile;
  reconciliationMatchId?: string | null;
}): Promise<{
  receiptNumber: string;
  nextPrincipalBalance: number;
  appliedPrincipalTotal: number;
  appliedInterestTotal: number;
  appliedLateFeeTotal: number;
  appliedChargesTotal: number;
  nextLoanStatus: LoanRecord['status'];
}> {
  const {
    payment,
    loan,
    installments,
    promises,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    user,
    reconciliationMatchId = null,
  } = params;

  if (!hasRolePermission(user.role, 'VERIFY_AND_APPLY_PAYMENTS')) {
    throw new Error('Segregación de funciones: solo Finanzas, Contabilidad o Admin pueden validar y aplicar pagos.');
  }

  const loanInsts = installments.filter((i) => i.loanId === loan.id);
  const openPromises = promises.filter(
    (p) => p.loanId === loan.id && !['CANCELADA', 'CUMPLIDA'].includes(p.status)
  );
  let receiptNumber = '';
  let nextPrincipalBalance = loan.currentPrincipalBalance;
  let appliedPrincipalTotal = 0;
  let appliedInterestTotal = 0;
  let appliedLateFeeTotal = 0;
  let appliedChargesTotal = 0;
  let nextLoanStatus: LoanRecord['status'] = loan.status;

  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, 'payments', payment.id);
      const loanRef = doc(db, 'loans', loan.id);
      const accRef = doc(db, 'collection_accounts', loan.id);

      // CRITICAL: Firestore transactions require ALL reads (tx.get) before any writes (tx.set/tx.update)
      const [paySnap, loanSnap, accSnap, instSnaps, promSnaps] = await Promise.all([
        tx.get(payRef),
        tx.get(loanRef),
        tx.get(accRef),
        Promise.all(loanInsts.map((i) => tx.get(doc(db, 'loan_installments', i.id)))),
        Promise.all(openPromises.map((p) => tx.get(doc(db, 'payment_promises', p.id)))),
      ]);

      // Support both persisted Firestore records and in-memory hydrated AppSheet migrated records
      const freshPay: PaymentRecord = paySnap.exists()
        ? ({ ...payment, ...(paySnap.data() as PaymentRecord), id: payment.id } as PaymentRecord)
        : payment;
      const freshLoan: LoanRecord = loanSnap.exists()
        ? ({ ...loan, ...(loanSnap.data() as LoanRecord), id: loan.id } as LoanRecord)
        : loan;
      const existingAcc: CollectionAccountRecord | null = accSnap.exists()
        ? ({ ...(accSnap.data() as CollectionAccountRecord), id: loan.id } as CollectionAccountRecord)
        : null;

      const instExistsInFirestore = new Map<string, boolean>();
      const freshInsts: LoanInstallmentRecord[] = loanInsts.map((inst, idx) => {
        const snap = instSnaps[idx];
        if (snap && snap.exists()) {
          instExistsInFirestore.set(inst.id, true);
          return {
            ...inst,
            ...(snap.data() as LoanInstallmentRecord),
            id: inst.id,
          };
        }
        instExistsInFirestore.set(inst.id, false);
        return inst;
      });

      const allocResult = allocatePaymentAcrossInstallments({
        payment: freshPay,
        loan: freshLoan,
        installments: freshInsts,
        imputationOrder: policy.imputationOrder,
        asOfDateIso: getSantoDomingoTodayIso(),
      });

      nextPrincipalBalance = allocResult.nextLoanPrincipalBalance;
      appliedPrincipalTotal = allocResult.appliedPrincipalTotal;
      appliedInterestTotal = allocResult.appliedInterestTotal;
      appliedLateFeeTotal = allocResult.appliedLateFeeTotal;
      appliedChargesTotal = allocResult.appliedChargesTotal;
      nextLoanStatus = allocResult.nextLoanStatus;
      receiptNumber = `REC-${freshLoan.loanNumber.replace(/^PRE-/, '')}-${freshPay.id.slice(-6).toUpperCase()}`.slice(
        0,
        64
      );
      const resolvedMatchId = reconciliationMatchId ?? freshPay.reconciliationMatchId ?? undefined;

      const appliedPay: PaymentRecord = {
        ...freshPay,
        organizationId: freshLoan.organizationId || freshPay.organizationId || user.organizationId,
        method: normalizePaymentMethod(freshPay.method),
        status: 'APLICADO',
        verifiedByUserId: freshPay.verifiedByUserId || user.uid,
        verifiedByName: freshPay.verifiedByName || user.displayName || user.email,
        appliedByUserId: user.uid,
        appliedByName: user.displayName || user.email,
        appliedAt: new Date().toISOString(),
        appliedDate: freshPay.paymentDate || getSantoDomingoTodayIso(),
        appliedBreakdown: {
          principal: allocResult.appliedPrincipalTotal,
          interest: allocResult.appliedInterestTotal,
          lateFee: allocResult.appliedLateFeeTotal,
          otherCharges: allocResult.appliedChargesTotal,
        },
        receiptNumber,
        ...(resolvedMatchId ? { reconciliationMatchId: resolvedMatchId } : {}),
        imputationOrderUsed: policy.imputationOrder,
      };

      if (paySnap.exists()) {
        tx.update(
          payRef,
          cleanObject({
            status: 'APLICADO',
            verifiedByUserId: appliedPay.verifiedByUserId,
            verifiedByName: appliedPay.verifiedByName,
            appliedByUserId: appliedPay.appliedByUserId,
            appliedByName: appliedPay.appliedByName,
            appliedAt: appliedPay.appliedAt,
            appliedDate: appliedPay.appliedDate,
            appliedBreakdown: appliedPay.appliedBreakdown,
            receiptNumber,
            ...(resolvedMatchId ? { reconciliationMatchId: resolvedMatchId } : {}),
            imputationOrderUsed: policy.imputationOrder,
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        tx.set(payRef, {
          ...cleanObject(appliedPay),
          reportedByUserId: user.uid,
          reportedByName: freshPay.reportedByName || user.displayName || user.email,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const alloc of allocResult.allocations) {
        if (alloc.totalAllocated <= 0) continue;
        tx.set(doc(db, 'payment_allocations', alloc.id), {
          ...cleanObject(alloc),
          organizationId: appliedPay.organizationId,
          createdAt: serverTimestamp(),
        });
      }

      for (const updInst of allocResult.updatedInstallments) {
        const origInst = freshInsts.find((i) => i.id === updInst.id);
        const existsInFs = instExistsInFirestore.get(updInst.id) === true;
        const changed =
          !origInst ||
          origInst.status !== updInst.status ||
          toCents(origInst.paidPrincipal ?? 0) !== toCents(updInst.paidPrincipal ?? 0) ||
          toCents(origInst.paidInterest ?? 0) !== toCents(updInst.paidInterest ?? 0) ||
          toCents(origInst.paidLateFee ?? 0) !== toCents(updInst.paidLateFee ?? 0) ||
          toCents(origInst.paidOtherCharges ?? 0) !== toCents(updInst.paidOtherCharges ?? 0);

        const instRef = doc(db, 'loan_installments', updInst.id);
        if (existsInFs) {
          if (changed) {
            tx.update(instRef, {
              status: updInst.status,
              paidPrincipal: updInst.paidPrincipal ?? 0,
              paidInterest: updInst.paidInterest ?? 0,
              paidOtherCharges: updInst.paidOtherCharges ?? 0,
              paidLateFee: updInst.paidLateFee ?? 0,
              paidAt: updInst.paidAt ? String(updInst.paidAt).slice(0, 40) : null,
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          tx.set(
            instRef,
            buildValidInstallmentDocForFirestore(updInst, appliedPay.organizationId)
          );
        }
      }

      const nextPaidPrincipalTotal = fromCents(
        toCents(freshLoan.paidPrincipalTotal ?? 0) + toCents(allocResult.appliedPrincipalTotal)
      );
      const nextPaidInterestTotal = fromCents(
        toCents(freshLoan.paidInterestTotal ?? 0) + toCents(allocResult.appliedInterestTotal)
      );
      const nextPaidLateFeeTotal = fromCents(
        toCents(freshLoan.paidLateFeeTotal ?? 0) + toCents(allocResult.appliedLateFeeTotal)
      );

      if (loanSnap.exists()) {
        tx.update(loanRef, {
          currentPrincipalBalance: nextPrincipalBalance,
          status: allocResult.nextLoanStatus,
          paidPrincipalTotal: nextPaidPrincipalTotal,
          paidInterestTotal: nextPaidInterestTotal,
          paidLateFeeTotal: nextPaidLateFeeTotal,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(
          loanRef,
          buildValidLoanDocForFirestore(
            {
              ...freshLoan,
              organizationId: appliedPay.organizationId,
              currentPrincipalBalance: nextPrincipalBalance,
              status: allocResult.nextLoanStatus,
              paidPrincipalTotal: nextPaidPrincipalTotal,
              paidInterestTotal: nextPaidInterestTotal,
              paidLateFeeTotal: nextPaidLateFeeTotal,
            },
            user.uid
          )
        );
      }

      const receipt = buildOfficialReceipt({
        payment: appliedPay,
        loan: freshLoan,
        allocations: allocResult.allocations,
        remainingPrincipalAfter: nextPrincipalBalance,
        issuedBy: user.uid,
        issuedByName: user.displayName || user.email,
      });
      tx.set(doc(db, 'collection_receipts', receipt.id), {
        ...cleanObject(receipt),
        organizationId: appliedPay.organizationId,
        createdAt: serverTimestamp(),
      });

      // Re-evaluate open promises against this confirmed APLICADO payment
      const refreshedPromises: PaymentPromiseRecord[] = [];
      for (let idx = 0; idx < openPromises.length; idx++) {
        const prom = openPromises[idx];
        const promSnap = promSnaps[idx];
        if (!promSnap || !promSnap.exists()) {
          refreshedPromises.push(prom);
          continue;
        }
        const res = evaluatePromiseFulfillment({
          promise: prom,
          payments: [appliedPay],
          asOfDateIso: getSantoDomingoTodayIso(),
          autoMarkBrokenPromises: policy.autoMarkBrokenPromises,
        });
        refreshedPromises.push(res.promise);
        if (res.changed) {
          tx.update(doc(db, 'payment_promises', prom.id), {
            status: res.promise.status,
            fulfilledAmount: res.promise.fulfilledAmount,
            fulfilledPaymentIds: Array.from(
              new Set([...(prom.fulfilledPaymentIds ?? []), appliedPay.id])
            ),
            verifiedAt: res.promise.verifiedAt ?? null,
            updatedAt: serverTimestamp(),
          });
        }
      }

      // Atomically recalculate and persist collection_accounts/{loan.id} so queues like
      // "Cobros del día" immediately clear or update DPD, stage, and overdue totals.
      const todayIso = getSantoDomingoTodayIso();
      const updatedLoanForEval: LoanRecord = {
        ...freshLoan,
        organizationId: appliedPay.organizationId,
        currentPrincipalBalance: nextPrincipalBalance,
        status: allocResult.nextLoanStatus,
        paidPrincipalTotal: nextPaidPrincipalTotal,
        paidInterestTotal: nextPaidInterestTotal,
        paidLateFeeTotal: nextPaidLateFeeTotal,
      };
      const evaluatedAcc = evaluateLoanDelinquency({
        loan: updatedLoanForEval,
        installments: allocResult.updatedInstallments,
        policy,
        asOfDateIso: todayIso,
        existingAccount: existingAcc,
        promises: refreshedPromises,
        payments: [appliedPay],
      });
      const remainingPendingCents = Math.max(
        0,
        toCents(existingAcc?.pendingVerificationAmount ?? 0) - toCents(appliedPay.amount)
      );
      const priorityEval = computeCollectionPriority({
        account: evaluatedAcc.account,
        promises: refreshedPromises,
        asOfDateIso: todayIso,
      });
      const nextCollectionAccount: CollectionAccountRecord = {
        ...evaluatedAcc.account,
        id: freshLoan.id,
        loanId: freshLoan.id,
        organizationId: existingAcc?.organizationId || appliedPay.organizationId,
        currency: existingAcc?.currency || freshLoan.currency,
        pendingVerificationAmount: fromCents(remainingPendingCents),
        priority: priorityEval.priority,
        priorityScore: priorityEval.score,
        priorityReasons: priorityEval.reasons,
      };
      if (accSnap.exists()) {
        const { createdAt: _ignoreCreatedAt, ...updateAccPayload } = nextCollectionAccount;
        tx.update(
          accRef,
          cleanObject({
            ...updateAccPayload,
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        tx.set(
          accRef,
          cleanObject({
            ...nextCollectionAccount,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }

      const auditId = generateId('audit');
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        organizationId: appliedPay.organizationId,
        eventType: 'PAYMENT_VERIFIED_AND_APPLIED',
        entityType: 'payments',
        entityId: freshPay.id,
        action: `Pago APLICADO (${receiptNumber}) en ${freshLoan.loanNumber}: ${freshPay.currency} ${freshPay.amount.toFixed(2)}`.slice(
          0,
          195
        ),
        previousState: `Saldo ${freshLoan.currentPrincipalBalance.toFixed(2)}`,
        newState: `Saldo ${nextPrincipalBalance.toFixed(2)} (${allocResult.nextLoanStatus})`,
        justification: `Imputación ${policy.imputationOrder.join(' > ')}`,
        transactionId: freshPay.id,
        userId: user.uid,
        userEmail: user.email,
        userRole: user.role,
        timestamp: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `payments/${payment.id}`);
  }

  return {
    receiptNumber,
    nextPrincipalBalance,
    appliedPrincipalTotal,
    appliedInterestTotal,
    appliedLateFeeTotal,
    appliedChargesTotal,
    nextLoanStatus,
  };
}

export async function rejectReportedPayment(params: {
  payment: PaymentRecord;
  reason: string;
  user: UserProfile;
}): Promise<void> {
  const { payment, reason, user } = params;
  if (!hasRolePermission(user.role, 'VERIFY_AND_APPLY_PAYMENTS')) {
    throw new Error('Solo Finanzas o Admin pueden rechazar pagos reportados.');
  }
  if (payment.status === 'APLICADO') {
    throw new Error('Un pago APLICADO no puede rechazarse; debe ejecutarse un Reverso Autorizado.');
  }
  const payRef = doc(db, 'payments', payment.id);
  const paySnap = await getDoc(payRef).catch(() => null);
  const batch = writeBatch(db);
  if (paySnap?.exists()) {
    batch.update(payRef, {
      status: 'RECHAZADO',
      reversalReason: reason.trim(),
      verifiedByUserId: user.uid,
      verifiedByName: user.displayName || user.email,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(payRef, {
      ...cleanObject(payment),
      status: 'RECHAZADO',
      reversalReason: reason.trim(),
      reportedByUserId: user.uid,
      verifiedByUserId: user.uid,
      verifiedByName: user.displayName || user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: payment.organizationId || user.organizationId,
    eventType: 'PAYMENT_REJECTED',
    entityType: 'payments',
    entityId: payment.id,
    action: `Pago reportado rechazado (${payment.loanNumber})`.slice(0, 195),
    justification: reason.trim().slice(0, 950),
    transactionId: payment.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payments/${payment.id}`);
  }
}

export async function reverseAppliedPaymentTransaction(params: {
  payment: PaymentRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  allocations: PaymentAllocationRecord[];
  reason: string;
  user: UserProfile;
}): Promise<void> {
  const { payment, loan, installments, allocations, reason, user } = params;

  if (!hasRolePermission(user.role, 'REVERSE_PAYMENTS')) {
    throw new Error('Segregación de funciones: solo Finanzas o Admin pueden autorizar reversos.');
  }
  if (reason.trim().length < 5) {
    throw new Error('El reverso requiere una justificación obligatoria (mínimo 5 caracteres).');
  }

  const loanInsts = installments.filter((i) => i.loanId === loan.id);
  const payAllocs = allocations.filter((a) => a.paymentId === payment.id && !a.reversed);
  const asOfDateIso = getSantoDomingoTodayIso();

  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, 'payments', payment.id);
      const loanRef = doc(db, 'loans', loan.id);
      const accRef = doc(db, 'collection_accounts', loan.id);
      const receiptRef = doc(db, 'collection_receipts', `rec_${payment.id}`);

      // Perform ALL reads before writes
      const [paySnap, loanSnap, accSnap, receiptSnap, instSnaps, allocSnaps] = await Promise.all([
        tx.get(payRef),
        tx.get(loanRef),
        tx.get(accRef),
        tx.get(receiptRef),
        Promise.all(loanInsts.map((i) => tx.get(doc(db, 'loan_installments', i.id)))),
        Promise.all(payAllocs.map((a) => tx.get(doc(db, 'payment_allocations', a.id)))),
      ]);

      const freshPay: PaymentRecord = paySnap.exists()
        ? ({ ...payment, ...(paySnap.data() as PaymentRecord), id: payment.id } as PaymentRecord)
        : payment;
      const freshLoan: LoanRecord = loanSnap.exists()
        ? ({ ...loan, ...(loanSnap.data() as LoanRecord), id: loan.id } as LoanRecord)
        : loan;
      const existingAcc: CollectionAccountRecord | null = accSnap.exists()
        ? ({ ...(accSnap.data() as CollectionAccountRecord), id: loan.id } as CollectionAccountRecord)
        : null;

      const instExistsMap = new Map<string, boolean>();
      const freshInsts = loanInsts.map((inst, idx) => {
        const snap = instSnaps[idx];
        if (snap && snap.exists()) {
          instExistsMap.set(inst.id, true);
          return { ...inst, ...(snap.data() as LoanInstallmentRecord), id: inst.id };
        }
        instExistsMap.set(inst.id, false);
        return inst;
      });

      const rev = computePaymentReversal({
        payment: freshPay,
        loan: freshLoan,
        installments: freshInsts,
        allocations: payAllocs,
        asOfDateIso,
      });

      if (paySnap.exists()) {
        tx.update(payRef, {
          status: 'REVERTIDO',
          reversedByUserId: user.uid,
          reversedByName: user.displayName || user.email,
          reversalReason: reason.trim(),
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(payRef, {
          ...cleanObject(freshPay),
          status: 'REVERTIDO',
          reportedByUserId: user.uid,
          reversedByUserId: user.uid,
          reversedByName: user.displayName || user.email,
          reversalReason: reason.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (let idx = 0; idx < payAllocs.length; idx++) {
        const alloc = payAllocs[idx];
        const allocSnap = allocSnaps[idx];
        if (allocSnap && allocSnap.exists()) {
          tx.update(doc(db, 'payment_allocations', alloc.id), {
            reversed: true,
          });
        }
      }

      for (const updInst of rev.updatedInstallments) {
        const origInst = freshInsts.find((i) => i.id === updInst.id);
        const existsInFs = instExistsMap.get(updInst.id) === true;
        const changed =
          !origInst ||
          origInst.status !== updInst.status ||
          toCents(origInst.paidPrincipal ?? 0) !== toCents(updInst.paidPrincipal ?? 0) ||
          toCents(origInst.paidInterest ?? 0) !== toCents(updInst.paidInterest ?? 0);

        const instRef = doc(db, 'loan_installments', updInst.id);
        if (existsInFs) {
          if (changed) {
            tx.update(instRef, {
              status: updInst.status,
              paidPrincipal: updInst.paidPrincipal ?? 0,
              paidInterest: updInst.paidInterest ?? 0,
              paidOtherCharges: updInst.paidOtherCharges ?? 0,
              paidLateFee: updInst.paidLateFee ?? 0,
              paidAt: null,
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          tx.set(
            instRef,
            buildValidInstallmentDocForFirestore(updInst, freshLoan.organizationId)
          );
        }
      }

      if (loanSnap.exists()) {
        tx.update(loanRef, {
          currentPrincipalBalance: rev.restoredLoanPrincipalBalance,
          status: rev.restoredLoanStatus,
          paidPrincipalTotal: rev.restoredPaidPrincipalTotal,
          paidInterestTotal: rev.restoredPaidInterestTotal,
          paidLateFeeTotal: rev.restoredPaidLateFeeTotal,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(
          loanRef,
          buildValidLoanDocForFirestore(
            {
              ...freshLoan,
              currentPrincipalBalance: rev.restoredLoanPrincipalBalance,
              status: rev.restoredLoanStatus,
              paidPrincipalTotal: rev.restoredPaidPrincipalTotal,
              paidInterestTotal: rev.restoredPaidInterestTotal,
              paidLateFeeTotal: rev.restoredPaidLateFeeTotal,
            },
            user.uid
          )
        );
      }

      if (receiptSnap.exists()) {
        tx.update(receiptRef, {
          status: 'ANULADO_POR_REVERSO',
        });
      }

      // Recalculate collection_accounts/{loan.id} atomically after reversal
      const restoredLoanForEval: LoanRecord = {
        ...freshLoan,
        currentPrincipalBalance: rev.restoredLoanPrincipalBalance,
        status: rev.restoredLoanStatus,
        paidPrincipalTotal: rev.restoredPaidPrincipalTotal,
        paidInterestTotal: rev.restoredPaidInterestTotal,
        paidLateFeeTotal: rev.restoredPaidLateFeeTotal,
      };
      const evalAfterRev = evaluateLoanDelinquency({
        loan: restoredLoanForEval,
        installments: rev.updatedInstallments,
        asOfDateIso,
        existingAccount: existingAcc,
      });
      const revPriorityEval = computeCollectionPriority({
        account: evalAfterRev.account,
        asOfDateIso,
      });
      const restoredAcc: CollectionAccountRecord = {
        ...evalAfterRev.account,
        id: freshLoan.id,
        loanId: freshLoan.id,
        organizationId: existingAcc?.organizationId || freshLoan.organizationId,
        currency: existingAcc?.currency || freshLoan.currency,
        priority: revPriorityEval.priority,
        priorityScore: revPriorityEval.score,
        priorityReasons: revPriorityEval.reasons,
      };
      if (accSnap.exists()) {
        const { createdAt: _ignoreCreatedAt, ...updateAccPayload } = restoredAcc;
        tx.update(
          accRef,
          cleanObject({
            ...updateAccPayload,
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        tx.set(
          accRef,
          cleanObject({
            ...restoredAcc,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }

      const revId = generateId('rev');
      tx.set(doc(db, 'payment_reversals', revId), {
        id: revId,
        organizationId: freshLoan.organizationId,
        paymentId: freshPay.id,
        loanId: freshLoan.id,
        loanNumber: freshLoan.loanNumber,
        currency: freshPay.currency,
        reversedAmount: freshPay.amount,
        reason: reason.trim(),
        authorizedByUserId: user.uid,
        authorizedByName: user.displayName || user.email,
        previousReceiptNumber: freshPay.receiptNumber ?? null,
        createdAt: serverTimestamp(),
      });

      const auditId = generateId('audit');
      tx.set(doc(db, 'audit_logs', auditId), {
        id: auditId,
        organizationId: freshLoan.organizationId,
        eventType: 'PAYMENT_REVERSED',
        entityType: 'payments',
        entityId: freshPay.id,
        action: `Reverso autorizado de pago ${freshPay.receiptNumber || freshPay.id} (${freshLoan.loanNumber})`.slice(
          0,
          195
        ),
        previousState: `Saldo ${freshLoan.currentPrincipalBalance.toFixed(2)}`,
        newState: `Saldo restaurado ${rev.restoredLoanPrincipalBalance.toFixed(2)}`,
        justification: reason.trim().slice(0, 950),
        transactionId: revId,
        userId: user.uid,
        userEmail: user.email,
        userRole: user.role,
        timestamp: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('Missing or insufficient permissions')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `payments/${payment.id}`);
  }
}

export async function importBankStatementBatch(params: {
  rawText: string;
  defaultBankName: string;
  defaultCurrency: CurrencyCode;
  existingTransactions: BankTransactionRecord[];
  user: UserProfile;
}): Promise<{ importedCount: number; duplicatesSkipped: number }> {
  const { rawText, defaultBankName, defaultCurrency, existingTransactions, user } = params;
  if (!hasRolePermission(user.role, 'RECONCILE_BANK_TRANSACTIONS')) {
    throw new Error('Solo Finanzas o Admin pueden cargar extractos bancarios.');
  }

  const parsed = parseBankStatementText({
    rawText,
    defaultBankName,
    defaultCurrency,
  });
  if (parsed.length === 0) {
    throw new Error('No se detectaron líneas bancarias válidas (fecha, referencia, monto > 0).');
  }

  const existingHashes = new Set(existingTransactions.map((t) => t.idempotencyHash));
  const batchId = generateId('bankbatch');
  const batch = writeBatch(db);
  let importedCount = 0;
  let duplicatesSkipped = 0;

  for (const row of parsed) {
    const hash = buildBankTxIdempotencyHash({
      organizationId: user.organizationId,
      bankName: row.bankName,
      transactionDate: row.transactionDate,
      referenceNumber: row.referenceNumber,
      amount: row.amount,
      currency: row.currency,
    });
    if (existingHashes.has(hash)) {
      duplicatesSkipped += 1;
      continue;
    }
    existingHashes.add(hash);

    const txId = generateId('btx');
    const rec: BankTransactionRecord = {
      id: txId,
      organizationId: user.organizationId,
      batchId,
      transactionDate: row.transactionDate,
      bankName: row.bankName,
      referenceNumber: row.referenceNumber,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      idempotencyHash: hash,
      status: 'PENDIENTE',
      createdBy: user.uid,
    };
    batch.set(doc(db, 'bank_transactions', txId), {
      ...rec,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    importedCount += 1;
  }

  if (importedCount > 0) {
    const auditId = generateId('audit');
    batch.set(doc(db, 'audit_logs', auditId), {
      id: auditId,
      organizationId: user.organizationId,
      eventType: 'BANK_STATEMENT_IMPORTED',
      entityType: 'bank_transactions',
      entityId: batchId,
      action: `Extracto bancario importado (${importedCount} movimientos nuevos, ${duplicatesSkipped} duplicados omitidos)`,
      transactionId: batchId,
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
      timestamp: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'bank_transactions');
    }
  }

  return { importedCount, duplicatesSkipped };
}

export async function runBankReconciliationEngine(params: {
  bankTransactions: BankTransactionRecord[];
  payments: PaymentRecord[];
  loans: LoanRecord[];
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  policy?: CollectionPolicyVersionRecord;
  user: UserProfile;
}): Promise<{
  exactMatches: number;
  probableMatches: number;
  autoApplied: number;
  exceptionsCreated: number;
}> {
  const {
    bankTransactions,
    payments,
    loans,
    installments,
    promises,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    user,
  } = params;

  if (!hasRolePermission(user.role, 'RECONCILE_BANK_TRANSACTIONS')) {
    throw new Error('Solo Finanzas o Admin pueden ejecutar la conciliación bancaria.');
  }

  const pendingBankTxs = bankTransactions.filter((t) => t.status === 'PENDIENTE');
  let exactMatches = 0;
  let probableMatches = 0;
  let autoApplied = 0;
  let exceptionsCreated = 0;

  const batch = writeBatch(db);
  const autoApplyQueue: Array<{ payment: PaymentRecord; matchId: string; bankTx: BankTransactionRecord }> = [];

  for (const btx of pendingBankTxs) {
    const evalRes = classifyAndMatchBankTransaction({
      bankTx: btx,
      payments,
      existingBankTransactions: bankTransactions,
      policy,
    });

    if (evalRes.confidence === 'EXACTA' && evalRes.matchedPayment) {
      exactMatches += 1;
      const matchId = `rm_${btx.id}`;
      const matchRec: ReconciliationMatchRecord = {
        id: matchId,
        organizationId: btx.organizationId,
        bankTransactionId: btx.id,
        paymentId: evalRes.matchedPayment.id,
        loanId: evalRes.matchedPayment.loanId,
        confidence: 'EXACTA',
        amountDiff: 0,
        score: evalRes.score,
        reason: evalRes.reason,
        autoApplied: evalRes.shouldAutoApply,
        status: evalRes.shouldAutoApply ? 'CONFIRMADO' : 'SUGERIDO',
        confirmedBy: evalRes.shouldAutoApply ? user.uid : null,
      };
      batch.set(doc(db, 'reconciliation_matches', matchId), {
        ...cleanObject(matchRec),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (evalRes.shouldAutoApply) {
        batch.update(doc(db, 'bank_transactions', btx.id), {
          status: 'CONCILIADA',
          matchedPaymentId: evalRes.matchedPayment.id,
          matchedLoanId: evalRes.matchedPayment.loanId,
          updatedAt: serverTimestamp(),
        });
        autoApplyQueue.push({ payment: evalRes.matchedPayment, matchId, bankTx: btx });
      }
    } else if (evalRes.confidence === 'PROBABLE' && evalRes.matchedPayment) {
      probableMatches += 1;
      const matchId = `rm_${btx.id}`;
      const matchRec: ReconciliationMatchRecord = {
        id: matchId,
        organizationId: btx.organizationId,
        bankTransactionId: btx.id,
        paymentId: evalRes.matchedPayment.id,
        loanId: evalRes.matchedPayment.loanId,
        confidence: 'PROBABLE',
        amountDiff: evalRes.amountDiff,
        score: evalRes.score,
        reason: evalRes.reason,
        autoApplied: false,
        status: 'SUGERIDO',
      };
      batch.set(doc(db, 'reconciliation_matches', matchId), {
        ...cleanObject(matchRec),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (evalRes.exceptionType) {
      exceptionsCreated += 1;
      const excId = `rexc_${btx.id}`;
      const excRec: ReconciliationExceptionRecord = {
        id: excId,
        organizationId: btx.organizationId,
        bankTransactionId: btx.id,
        paymentId: evalRes.matchedPayment?.id ?? null,
        loanId: evalRes.matchedPayment?.loanId ?? null,
        exceptionType: evalRes.exceptionType,
        detail: evalRes.reason,
        status: 'ABIERTA',
      };
      batch.set(doc(db, 'reconciliation_exceptions', excId), {
        ...cleanObject(excRec),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'bank_transactions', btx.id), {
        status:
          evalRes.exceptionType === 'REFERENCIA_DUPLICADA'
            ? 'DUPLICADA'
            : 'POR_IDENTIFICAR',
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'reconciliation_matches');
  }

  // Execute auto-applied matches sequentially via atomic payment transactions
  for (const item of autoApplyQueue) {
    const loan = loans.find((l) => l.id === item.payment.loanId);
    if (!loan) continue;
    await verifyAndApplyPaymentTransaction({
      payment: item.payment,
      loan,
      installments,
      promises,
      policy,
      user,
      reconciliationMatchId: item.matchId,
    });
    autoApplied += 1;
  }

  return { exactMatches, probableMatches, autoApplied, exceptionsCreated };
}

export async function confirmSuggestedReconciliationMatch(params: {
  match: ReconciliationMatchRecord;
  bankTx: BankTransactionRecord;
  payment: PaymentRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  policy?: CollectionPolicyVersionRecord;
  user: UserProfile;
}): Promise<void> {
  const { match, bankTx, payment, loan, installments, promises, policy, user } = params;
  if (!hasRolePermission(user.role, 'RECONCILE_BANK_TRANSACTIONS')) {
    throw new Error('Solo Finanzas o Admin pueden confirmar conciliaciones.');
  }

  if (payment.status !== 'APLICADO') {
    await verifyAndApplyPaymentTransaction({
      payment,
      loan,
      installments,
      promises,
      policy,
      user,
      reconciliationMatchId: match.id,
    });
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'reconciliation_matches', match.id), {
    status: 'CONFIRMADO',
    confirmedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'bank_transactions', bankTx.id), {
    status: 'CONCILIADA',
    matchedPaymentId: payment.id,
    matchedLoanId: loan.id,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `reconciliation_matches/${match.id}`);
  }
}

export async function resolveUnidentifiedBankTransaction(params: {
  exception: ReconciliationExceptionRecord;
  bankTx: BankTransactionRecord;
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  policy?: CollectionPolicyVersionRecord;
  resolutionNotes: string;
  user: UserProfile;
}): Promise<void> {
  const { exception, bankTx, loan, installments, promises, policy, resolutionNotes, user } = params;
  if (!hasRolePermission(user.role, 'RECONCILE_BANK_TRANSACTIONS')) {
    throw new Error('Solo Finanzas o Admin pueden identificar y aplicar movimientos bancarios.');
  }
  if (bankTx.currency !== loan.currency) {
    throw new Error(`Moneda del banco (${bankTx.currency}) difiere del préstamo (${loan.currency}).`);
  }

  // Create payment record & immediately verify+apply
  const pay = await reportPaymentPendingVerification({
    loan,
    amount: bankTx.amount,
    paymentDate: bankTx.transactionDate,
    method: 'TRANSFERENCIA',
    bankName: bankTx.bankName,
    referenceNumber: bankTx.referenceNumber,
    notes: `Identificado desde extracto bancario: ${resolutionNotes}`,
    user,
  });

  await verifyAndApplyPaymentTransaction({
    payment: pay,
    loan,
    installments,
    promises,
    policy,
    user,
    reconciliationMatchId: `exc_${exception.id}`,
  });

  const batch = writeBatch(db);
  batch.update(doc(db, 'bank_transactions', bankTx.id), {
    status: 'CONCILIADA',
    matchedPaymentId: pay.id,
    matchedLoanId: loan.id,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'reconciliation_exceptions', exception.id), {
    status: 'RESUELTA',
    paymentId: pay.id,
    loanId: loan.id,
    resolvedBy: user.uid,
    resolutionNotes: resolutionNotes.trim(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `reconciliation_exceptions/${exception.id}`);
  }
}

export async function proposePaymentAgreement(params: {
  account: CollectionAccountRecord;
  agreementType: PaymentAgreementRecord['agreementType'];
  totalAgreedAmount: number;
  downPaymentAmount: number;
  installmentCount: number;
  proposedRateMonthly?: number | null;
  firstDueDate: string;
  notes: string;
  activateImmediately?: boolean;
  user: UserProfile;
}): Promise<{ id: string; status: PaymentAgreementRecord['status'] }> {
  const agrId = generateId('agr');
  const rec: PaymentAgreementRecord = {
    id: agrId,
    organizationId: params.account.organizationId,
    loanId: params.account.loanId,
    loanNumber: params.account.loanNumber,
    customerId: params.account.customerId,
    customerName: params.account.applicantDisplayName,
    currency: params.account.currency,
    agreementType: params.agreementType,
    totalAgreedAmount: params.totalAgreedAmount,
    downPaymentAmount: params.downPaymentAmount,
    installmentCount: params.installmentCount,
    proposedRateMonthly: params.proposedRateMonthly ?? null,
    firstDueDate: params.firstDueDate,
    notes: params.notes.trim(),
    proposedBy: params.user.uid,
    proposedByName: params.user.displayName,
    status: 'PROPUESTO',
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'payment_agreements', agrId), {
    ...cleanObject(rec),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'collection_accounts', params.account.id), {
    nextFollowUpDate: params.firstDueDate,
    updatedAt: serverTimestamp(),
  });
  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: params.account.organizationId,
    eventType: 'PAYMENT_AGREEMENT_PROPOSED',
    entityType: 'payment_agreements',
    entityId: agrId,
    action: `${params.agreementType} registrado para ${params.account.loanNumber} (${params.account.currency} ${params.totalAgreedAmount.toFixed(2)})`,
    justification: params.notes.trim(),
    transactionId: agrId,
    userId: params.user.uid,
    userEmail: params.user.email,
    userRole: params.user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `payment_agreements/${agrId}`);
  }

  let finalStatus: PaymentAgreementRecord['status'] = 'PROPUESTO';
  if (params.activateImmediately) {
    const authCheck = canApprovePaymentAgreement({
      userId: params.user.uid,
      userRole: params.user.role,
      agreement: rec,
    });
    if (authCheck.allowed) {
      try {
        await updateDoc(doc(db, 'payment_agreements', agrId), {
          status: 'ACTIVO',
          approvedBy: params.user.uid,
          approvedByName: params.user.displayName,
          updatedAt: serverTimestamp(),
        });
        finalStatus = 'ACTIVO';
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `payment_agreements/${agrId}`);
      }
    }
  }

  return { id: agrId, status: finalStatus };
}

export async function decidePaymentAgreement(params: {
  agreement: PaymentAgreementRecord;
  decision: 'APROBADO' | 'RECHAZADO';
  rejectedReason?: string;
  user: UserProfile;
}): Promise<void> {
  const { agreement, decision, rejectedReason, user } = params;
  const authCheck = canApprovePaymentAgreement({
    userId: user.uid,
    userRole: user.role,
    agreement,
  });
  if (!authCheck.allowed) {
    throw new Error(authCheck.reason || 'Sin facultad para aprobar acuerdos.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'payment_agreements', agreement.id), {
    status: decision,
    approvedBy: decision === 'APROBADO' ? user.uid : null,
    approvedByName: decision === 'APROBADO' ? user.displayName : null,
    rejectedReason: decision === 'RECHAZADO' ? (rejectedReason || 'Rechazado por supervisión') : null,
    updatedAt: serverTimestamp(),
  });
  if (decision === 'APROBADO' && agreement.agreementType !== 'ACUERDO_PAGO') {
    batch.update(doc(db, 'collection_accounts', agreement.loanId), {
      isRestructured: true,
      updatedAt: serverTimestamp(),
    });
  }
  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: agreement.organizationId,
    eventType: 'PAYMENT_AGREEMENT_DECIDED',
    entityType: 'payment_agreements',
    entityId: agreement.id,
    action: `${agreement.agreementType} ${decision} (${agreement.loanNumber})`,
    justification: rejectedReason || agreement.notes,
    transactionId: agreement.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payment_agreements/${agreement.id}`);
  }
}

export async function updatePaymentAgreementManagementStatus(params: {
  agreement: PaymentAgreementRecord;
  nextStatus: 'ACTIVO' | 'CUMPLIDO' | 'INCUMPLIDO';
  managementNotes: string;
  user: UserProfile;
}): Promise<void> {
  const { agreement, nextStatus, managementNotes, user } = params;
  if (!hasRolePermission(user.role, 'RESOLVE_DISPUTES_AND_AGREEMENTS')) {
    throw new Error(
      'Solo Supervisor, Coordinador, Finanzas, Riesgo, Gerencia o Admin pueden actualizar el estado del acuerdo.'
    );
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'payment_agreements', agreement.id), {
    status: nextStatus,
    ...(nextStatus === 'ACTIVO' && !agreement.approvedBy
      ? { approvedBy: user.uid, approvedByName: user.displayName }
      : {}),
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: agreement.organizationId,
    eventType: 'PAYMENT_AGREEMENT_STATUS_UPDATED',
    entityType: 'payment_agreements',
    entityId: agreement.id,
    action: `Acuerdo ${agreement.loanNumber} marcado como ${nextStatus}`,
    previousState: agreement.status,
    newState: nextStatus,
    justification: managementNotes.trim() || agreement.notes,
    transactionId: agreement.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payment_agreements/${agreement.id}`);
  }
}

export async function openCustomerDispute(params: {
  account: CollectionAccountRecord;
  disputeType: DisputeType;
  description: string;
  pauseAutomatedMessages: boolean;
  user: UserProfile;
}): Promise<string> {
  const dispId = generateId('disp');
  const rec: CustomerDisputeRecord = {
    id: dispId,
    organizationId: params.account.organizationId,
    loanId: params.account.loanId,
    loanNumber: params.account.loanNumber,
    customerId: params.account.customerId,
    customerName: params.account.applicantDisplayName,
    disputeType: params.disputeType,
    description: params.description.trim(),
    pauseAutomatedMessages: params.pauseAutomatedMessages,
    status: 'ABIERTA',
    openedBy: params.user.uid,
    openedByName: params.user.displayName,
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'customer_disputes', dispId), {
    ...rec,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'collection_accounts', params.account.id), {
    hasOpenDispute: true,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `customer_disputes/${dispId}`);
  }
  return dispId;
}

export async function resolveCustomerDispute(params: {
  dispute: CustomerDisputeRecord;
  resolutionStatus: 'EN_INVESTIGACION' | 'RESUELTA_FAVOR_CLIENTE' | 'RESUELTA_IMPROCEDENTE';
  resolutionNotes: string;
  user: UserProfile;
}): Promise<void> {
  const { dispute, resolutionStatus, resolutionNotes, user } = params;
  if (!hasRolePermission(user.role, 'RESOLVE_DISPUTES_AND_AGREEMENTS')) {
    throw new Error('Tu rol no tiene permiso para resolver reclamaciones de clientes.');
  }
  const batch = writeBatch(db);
  batch.update(doc(db, 'customer_disputes', dispute.id), {
    status: resolutionStatus,
    resolutionNotes: resolutionNotes.trim(),
    resolvedBy: resolutionStatus.startsWith('RESUELTA') ? user.uid : null,
    resolvedByName: resolutionStatus.startsWith('RESUELTA') ? user.displayName : null,
    updatedAt: serverTimestamp(),
  });
  if (resolutionStatus.startsWith('RESUELTA')) {
    batch.update(doc(db, 'collection_accounts', dispute.loanId), {
      hasOpenDispute: false,
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `customer_disputes/${dispute.id}`);
  }
}

export async function updateRiskAlertStatus(params: {
  alert: RiskAlertRecord;
  status: RiskAlertRecord['status'];
  notes?: string;
  user: UserProfile;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'risk_alerts', params.alert.id), {
      status: params.status,
      attendedBy: params.user.uid,
      attendedNotes: params.notes?.trim() || '',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `risk_alerts/${params.alert.id}`);
  }
}

export async function saveBotTemplate(params: {
  template: Omit<MessageTemplateRecord, 'updatedAt' | 'updatedBy'>;
  user: UserProfile;
}): Promise<void> {
  if (!hasRolePermission(params.user.role, 'MANAGE_COLLECTION_BOT')) {
    throw new Error('Solo Coordinador de Cobranza o Admin pueden administrar plantillas del bot.');
  }
  try {
    await setDoc(doc(db, 'message_templates', params.template.id), {
      ...params.template,
      updatedBy: params.user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `message_templates/${params.template.id}`);
  }
}

export async function saveBotCampaign(params: {
  campaign: Omit<CollectionCampaignRecord, 'createdAt' | 'updatedAt' | 'createdBy'>;
  user: UserProfile;
}): Promise<void> {
  if (!hasRolePermission(params.user.role, 'MANAGE_COLLECTION_BOT')) {
    throw new Error('Solo Coordinador de Cobranza o Admin pueden administrar campañas.');
  }
  try {
    await setDoc(doc(db, 'collection_campaigns', params.campaign.id), {
      ...params.campaign,
      createdBy: params.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `collection_campaigns/${params.campaign.id}`);
  }
}

export async function dispatchBotMessageWithCompliance(params: {
  account: CollectionAccountRecord;
  template: MessageTemplateRecord;
  campaignId?: string | null;
  messageEvents: MessageEventRecord[];
  disputes: CustomerDisputeRecord[];
  policy?: CollectionPolicyVersionRecord;
  user: UserProfile;
  whatsappApiConfigured: boolean;
}): Promise<MessageEventRecord> {
  const {
    account,
    template,
    campaignId = null,
    messageEvents,
    disputes,
    policy,
    user,
    whatsappApiConfigured,
  } = params;

  const eligibility = evaluateBotDispatchEligibility({
    account,
    template,
    messageEvents,
    disputes,
    policy,
  });

  const renderedBody = renderBotTemplate(template.bodyTemplate, account);
  const eventId = generateId('msg');
  const phone = account.customerPhone || 'Sin teléfono';
  const maskedPhone =
    phone.length > 4 ? `${'*'.repeat(Math.max(4, phone.length - 4))}${phone.slice(-4)}` : '****';

  let deliveryStatus: MessageEventRecord['deliveryStatus'] = 'INTEGRACION_PENDIENTE';
  let externalMessageId: string | null = null;
  let blockReason: string | null = null;

  if (!eligibility.eligible) {
    deliveryStatus = eligibility.deliveryStatusOnBlocked ?? 'BLOQUEADO_FRECUENCIA';
    blockReason = eligibility.reason ?? null;
  } else if (whatsappApiConfigured) {
    const resp = await fetch('/api/collections/bot/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        templateCode: template.code,
        messageBody: renderedBody,
        loanNumber: account.loanNumber,
      }),
    });
    const json = await resp.json().catch(() => ({}));
    if (json.sent) {
      deliveryStatus = 'ENVIADO';
      externalMessageId = json.externalMessageId ?? null;
    } else {
      deliveryStatus = 'INTEGRACION_PENDIENTE';
      blockReason = json.reason ?? 'Credenciales WhatsApp Cloud API no configuradas.';
    }
  } else {
    deliveryStatus = 'INTEGRACION_PENDIENTE';
    blockReason = 'Conector WhatsApp Business Cloud API pendiente de credenciales en servidor.';
  }

  const record: MessageEventRecord = {
    id: eventId,
    organizationId: account.organizationId,
    loanId: account.loanId,
    loanNumber: account.loanNumber,
    customerId: account.customerId,
    campaignId,
    templateId: template.id,
    channel: template.channel,
    direction: 'OUTBOUND',
    recipientMasked: maskedPhone,
    messagePreview: renderedBody,
    deliveryStatus,
    externalMessageId,
    consentVerified: account.consentWhatsAppOptIn,
    blockReason,
    createdBy: user.uid,
  };

  try {
    await setDoc(doc(db, 'message_events', eventId), {
      ...cleanObject(record),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `message_events/${eventId}`);
  }
  return record;
}

export async function registerBotPaymentIntent(params: {
  account: CollectionAccountRecord;
  reportedAmount: number;
  referenceNumber: string;
  notes?: string;
  user: UserProfile;
}): Promise<string> {
  const intentId = generateId('pint');
  const rec: PaymentIntentRecord = {
    id: intentId,
    organizationId: params.account.organizationId,
    loanId: params.account.loanId,
    loanNumber: params.account.loanNumber,
    customerId: params.account.customerId,
    customerName: params.account.applicantDisplayName,
    currency: params.account.currency,
    reportedAmount: params.reportedAmount,
    reportedDate: getSantoDomingoTodayIso(),
    referenceNumber: params.referenceNumber,
    sourceChannel: 'WHATSAPP_BOT',
    status: 'PENDIENTE_VERIFICACION',
    notes: params.notes || 'Reportado vía AxyRecovery Bot (no reduce saldo hasta verificación).',
    createdBy: params.user.uid,
  };
  try {
    await setDoc(doc(db, 'payment_intents', intentId), {
      ...rec,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `payment_intents/${intentId}`);
  }
  return intentId;
}

export async function updateCustomerWhatsAppConsent(params: {
  account: CollectionAccountRecord;
  optIn: boolean;
  user: UserProfile;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'collection_accounts', params.account.id), {
      consentWhatsAppOptIn: params.optIn,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `collection_accounts/${params.account.id}`);
  }
}

export async function saveCollectionPolicyVersion(params: {
  policy: CollectionPolicyVersionRecord;
  previousActivePolicyId?: string | null;
  user: UserProfile;
}): Promise<void> {
  const { policy, previousActivePolicyId, user } = params;
  if (!hasRolePermission(user.role, 'MANAGE_COLLECTION_POLICIES')) {
    throw new Error('Solo Coordinador de Cobranza o Admin pueden modificar parámetros de cobranza.');
  }
  const batch = writeBatch(db);
  if (previousActivePolicyId && previousActivePolicyId !== policy.id && policy.status === 'ACTIVA') {
    batch.update(doc(db, 'collection_policy_versions', previousActivePolicyId), {
      status: 'HISTORICA',
      updatedAt: serverTimestamp(),
    });
  }
  batch.set(doc(db, 'collection_policy_versions', policy.id), {
    ...cleanObject(policy),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: user.organizationId,
    eventType: 'COLLECTION_POLICY_VERSION_SAVED',
    entityType: 'collection_policy_versions',
    entityId: policy.id,
    action: `Parámetros Cobranza ${policy.version} (${policy.status}) · Imputación: ${policy.imputationOrder.join('>')}`,
    transactionId: policy.id,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `collection_policy_versions/${policy.id}`);
  }
}

export async function saveCollectorTarget(params: {
  target: Omit<CollectorTargetRecord, 'updatedAt' | 'updatedBy'>;
  user: UserProfile;
}): Promise<void> {
  try {
    await setDoc(doc(db, 'collector_targets', params.target.id), {
      ...params.target,
      updatedBy: params.user.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `collector_targets/${params.target.id}`);
  }
}

export async function executeFormalLoanClosureTransaction(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  disputes: CustomerDisputeRecord[];
  exceptions: ReconciliationExceptionRecord[];
  user: UserProfile;
}): Promise<string> {
  const { loan, installments, payments, disputes, exceptions, user } = params;
  if (!hasRolePermission(user.role, 'CLOSE_CANCEL_LOAN')) {
    throw new Error('Solo Finanzas, Operaciones o Admin pueden cancelar/cerrar un préstamo.');
  }

  const check = validateLoanCancellationEligibility({
    loan,
    installments,
    payments,
    disputes,
    exceptions,
  });
  if (!check.allowed) {
    throw new Error(`No elegible para cierre: ${check.reasons.join(' | ')}`);
  }

  const closedAt = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(doc(db, 'loans', loan.id), {
    status: 'CANCELADO',
    closedAt,
    closureCertificateNumber: check.certificateNumber,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'collection_accounts', loan.id), {
    stage: 'CANCELADO',
    dpd: 0,
    closedAt,
    closureCertificateNumber: check.certificateNumber,
    updatedAt: serverTimestamp(),
  });

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    id: auditId,
    organizationId: loan.organizationId,
    eventType: 'LOAN_FORMALLY_CANCELLED',
    entityType: 'loans',
    entityId: loan.id,
    action: `Préstamo ${loan.loanNumber} CANCELADO formalmente (${check.certificateNumber})`,
    previousState: loan.status,
    newState: 'CANCELADO',
    justification: 'Saldo 0.00, 0 cuotas pendientes y 0 excepciones/reclamaciones abiertas.',
    transactionId: check.certificateNumber,
    userId: user.uid,
    userEmail: user.email,
    userRole: user.role,
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `loans/${loan.id}`);
  }
  return check.certificateNumber;
}
