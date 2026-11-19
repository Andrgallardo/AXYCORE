import type {
  CollectionAccountRecord,
  CollectionPriority,
  CollectionTaskRecord,
  CollectionTaskType,
  LoanInstallmentRecord,
  PaymentPromiseRecord,
  RiskAlertRecord,
} from '../../types/axycore';
import { diffCalendarDays, getSantoDomingoTodayIso } from './delinquencyEngine';

export interface PriorityEvaluation {
  priority: CollectionPriority;
  score: number;
  reasons: string[];
}

export function computeCollectionPriority(params: {
  account: CollectionAccountRecord;
  promises?: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
}): PriorityEvaluation {
  const { account, promises = [], alerts = [], asOfDateIso = getSantoDomingoTodayIso() } = params;

  if (account.stage === 'CANCELADO') {
    return { priority: 'BAJA', score: 0, reasons: ['Préstamo cancelado / saldo cero'] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (account.dpd >= 61) {
    score += 45;
    reasons.push(`Mora crítica (${account.dpd} DPD)`);
  } else if (account.dpd >= 31) {
    score += 36;
    reasons.push(`Mora avanzada (${account.dpd} DPD)`);
  } else if (account.dpd >= 16) {
    score += 26;
    reasons.push(`Mora intermedia (${account.dpd} DPD)`);
  } else if (account.dpd >= 6) {
    score += 18;
    reasons.push(`Mora temprana (${account.dpd} DPD)`);
  } else if (account.dpd >= 1) {
    score += 14;
    reasons.push(`Mora reciente (${account.dpd} DPD · ventana crítica de recuperación)`);
  }

  const loanPromises = promises.filter((p) => p.loanId === account.loanId);
  const brokenCount = Math.max(
    account.brokenPromisesCount || 0,
    loanPromises.filter((p) => p.status === 'INCUMPLIDA').length
  );
  if (brokenCount > 0) {
    score += Math.min(25, brokenCount * 15);
    reasons.push(
      brokenCount === 1 ? '1 promesa incumplida' : `${brokenCount} promesas incumplidas`
    );
  }

  const promiseDueToday = loanPromises.find(
    (p) => p.status === 'VIGENTE' && p.promisedDate === asOfDateIso
  );
  if (promiseDueToday) {
    score += 18;
    reasons.push(`Promesa vigente vence hoy (${promiseDueToday.promisedDate})`);
  }

  if (account.nextDueDate === asOfDateIso && account.dpd === 0) {
    score += 15;
    reasons.push('Cuota vence hoy');
  }

  // Days without contact
  if (account.dpd > 0) {
    if (!account.lastActionAt) {
      score += 15;
      reasons.push('Sin gestiones de contacto registradas');
    } else {
      const daysNoContact = diffCalendarDays(account.lastActionAt.slice(0, 10), asOfDateIso);
      if (daysNoContact >= 5) {
        score += 14;
        reasons.push(`Sin gestión efectiva hace ${daysNoContact} días`);
      } else if (daysNoContact >= 3) {
        score += 8;
        reasons.push(`Seguimiento pendiente (${daysNoContact} días desde última gestión)`);
      }
    }
  }

  const activeCriticalAlerts = alerts.filter(
    (a) => a.loanId === account.loanId && a.status === 'ACTIVA' && ['CRITICA', 'ALTA'].includes(a.severity)
  );
  if (activeCriticalAlerts.length > 0) {
    score += 12;
    reasons.push(`Alerta Centinela activa (${activeCriticalAlerts[0].title})`);
  }

  if (account.hasOpenDispute) {
    reasons.push('Reclamación abierta (gestionar revisión antes de presión)');
  }

  if (account.overdueTotalAmount > 0 && account.totalOutstandingPrincipal > 0) {
    const overdueRatio = account.overdueTotalAmount / account.totalOutstandingPrincipal;
    if (overdueRatio >= 0.25) {
      score += 10;
      reasons.push('Alto porcentaje de cuota vencida vs saldo');
    }
  }

  const clampedScore = Math.min(100, Math.max(0, score));
  const priority: CollectionPriority =
    clampedScore >= 60 ? 'CRITICA' : clampedScore >= 35 ? 'ALTA' : clampedScore >= 15 ? 'MEDIA' : 'BAJA';

  if (reasons.length === 0) {
    reasons.push('Cartera al día en seguimiento preventivo');
  }

  return {
    priority,
    score: clampedScore,
    reasons,
  };
}

export interface DailyQueueItem {
  loanId: string;
  account: CollectionAccountRecord;
  categories: Array<'VENCE_HOY' | 'PROMESA_HOY' | 'MORA_1_5' | 'PAGO_PARCIAL' | 'SEGUIMIENTO_HOY'>;
  priorityEval: PriorityEvaluation;
}

export function buildDailyCollectionsQueue(params: {
  accounts: CollectionAccountRecord[];
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  tasks: CollectionTaskRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): DailyQueueItem[] {
  const {
    accounts,
    installments,
    promises,
    tasks,
    alerts = [],
    asOfDateIso = getSantoDomingoTodayIso(),
    collectorId,
  } = params;

  const map = new Map<string, DailyQueueItem>();

  const ensureEntry = (acc: CollectionAccountRecord) => {
    let entry = map.get(acc.loanId);
    if (!entry) {
      entry = {
        loanId: acc.loanId,
        account: acc,
        categories: [],
        priorityEval: computeCollectionPriority({ account: acc, promises, alerts, asOfDateIso }),
      };
      map.set(acc.loanId, entry);
    }
    return entry;
  };

  for (const acc of accounts) {
    if (acc.stage === 'CANCELADO') continue;
    if (collectorId && acc.assignedCollectorId !== collectorId) continue;

    const loanInsts = installments.filter((i) => i.loanId === acc.loanId);
    const hasDueToday = loanInsts.some(
      (i) => i.dueDate === asOfDateIso && i.status !== 'PAGADA'
    );
    const hasPartial = loanInsts.some((i) => i.status === 'PARCIAL');
    const hasPromiseToday = promises.some(
      (p) => p.loanId === acc.loanId && p.status === 'VIGENTE' && p.promisedDate === asOfDateIso
    );
    const hasFollowUpToday =
      acc.nextFollowUpDate === asOfDateIso ||
      tasks.some(
        (t) =>
          t.loanId === acc.loanId &&
          ['PENDIENTE', 'EN_PROCESO'].includes(t.status) &&
          t.dueDate <= asOfDateIso
      );

    if (hasDueToday) ensureEntry(acc).categories.push('VENCE_HOY');
    if (hasPromiseToday) ensureEntry(acc).categories.push('PROMESA_HOY');
    if (acc.dpd >= 1 && acc.dpd <= 5) ensureEntry(acc).categories.push('MORA_1_5');
    if (hasPartial) ensureEntry(acc).categories.push('PAGO_PARCIAL');
    if (hasFollowUpToday) ensureEntry(acc).categories.push('SEGUIMIENTO_HOY');
  }

  return Array.from(map.values()).sort((a, b) => {
    const scoreDiff = b.priorityEval.score - a.priorityEval.score;
    if (scoreDiff !== 0) return scoreDiff;
    return b.account.overdueTotalAmount - a.account.overdueTotalAmount;
  });
}

export interface UrgentQueueItem {
  loanId: string;
  account: CollectionAccountRecord;
  priorityEval: PriorityEvaluation;
}

export function buildUrgentCollectionsQueue(params: {
  accounts: CollectionAccountRecord[];
  promises: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): UrgentQueueItem[] {
  const {
    accounts,
    promises,
    alerts = [],
    asOfDateIso = getSantoDomingoTodayIso(),
    collectorId,
  } = params;

  const seen = new Set<string>();
  const items: UrgentQueueItem[] = [];

  for (const acc of accounts) {
    if (seen.has(acc.loanId)) continue;
    if (acc.stage === 'CANCELADO') continue;
    if (collectorId && acc.assignedCollectorId !== collectorId) continue;

    const priorityEval = computeCollectionPriority({
      account: acc,
      promises,
      alerts,
      asOfDateIso,
    });

    if (acc.dpd > 0 || priorityEval.score >= 30 || acc.brokenPromisesCount > 0) {
      seen.add(acc.loanId);
      items.push({
        loanId: acc.loanId,
        account: acc,
        priorityEval,
      });
    }
  }

  return items.sort((a, b) => {
    const scoreDiff = b.priorityEval.score - a.priorityEval.score;
    if (scoreDiff !== 0) return scoreDiff;
    const dpdDiff = b.account.dpd - a.account.dpd;
    if (dpdDiff !== 0) return dpdDiff;
    return b.account.overdueTotalAmount - a.account.overdueTotalAmount;
  });
}

export type CobrosTramoBucket = 'COBROS_DEL_DIA' | 'COBROS_URGENTES' | 'COBROS_LEGAL';

export interface CobrosQueueEntry {
  loanId: string;
  account: CollectionAccountRecord;
  tramo: CobrosTramoBucket;
  priorityEval: PriorityEvaluation;
}

function buildDpdTramoQueue(params: {
  accounts: CollectionAccountRecord[];
  promises?: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
  tramo: CobrosTramoBucket;
  minDpd: number;
  maxDpd: number | null;
}): CobrosQueueEntry[] {
  const {
    accounts,
    promises = [],
    alerts = [],
    asOfDateIso = getSantoDomingoTodayIso(),
    collectorId,
    tramo,
    minDpd,
    maxDpd,
  } = params;

  const seen = new Set<string>();
  const items: CobrosQueueEntry[] = [];

  for (const acc of accounts) {
    if (seen.has(acc.loanId)) continue;
    if (acc.stage === 'CANCELADO') continue;
    if (collectorId && acc.assignedCollectorId !== collectorId) continue;
    if (acc.dpd < minDpd) continue;
    if (maxDpd !== null && acc.dpd > maxDpd) continue;

    seen.add(acc.loanId);
    const priorityEval = computeCollectionPriority({
      account: acc,
      promises,
      alerts,
      asOfDateIso,
    });
    items.push({
      loanId: acc.loanId,
      account: acc,
      tramo,
      priorityEval,
    });
  }

  return items.sort((a, b) => {
    const dpdDiff = b.account.dpd - a.account.dpd;
    if (dpdDiff !== 0) return dpdDiff;
    const scoreDiff = b.priorityEval.score - a.priorityEval.score;
    if (scoreDiff !== 0) return scoreDiff;
    return b.account.overdueTotalAmount - a.account.overdueTotalAmount;
  });
}

/** Cobros del día: clientes con 1 a 5 días de atraso */
export function buildCobrosDelDiaQueue(params: {
  accounts: CollectionAccountRecord[];
  promises?: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): CobrosQueueEntry[] {
  return buildDpdTramoQueue({
    ...params,
    tramo: 'COBROS_DEL_DIA',
    minDpd: 1,
    maxDpd: 5,
  });
}

/** Cobros Urgentes: clientes con 6 a 30 días de atraso */
export function buildCobrosUrgentesQueue(params: {
  accounts: CollectionAccountRecord[];
  promises?: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): CobrosQueueEntry[] {
  return buildDpdTramoQueue({
    ...params,
    tramo: 'COBROS_URGENTES',
    minDpd: 6,
    maxDpd: 30,
  });
}

/** Cobros en Legal: clientes con 31 o más días de atraso (> 30 días) */
export function buildCobrosLegalQueue(params: {
  accounts: CollectionAccountRecord[];
  promises?: PaymentPromiseRecord[];
  alerts?: RiskAlertRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): CobrosQueueEntry[] {
  return buildDpdTramoQueue({
    ...params,
    tramo: 'COBROS_LEGAL',
    minDpd: 31,
    maxDpd: null,
  });
}

export function buildTaskDocId(sourceEventKey: string): string {
  return `task_${sourceEventKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110)}`;
}

export function generateAutomatedCollectionTasks(params: {
  organizationId: string;
  accounts: CollectionAccountRecord[];
  promises: PaymentPromiseRecord[];
  alerts: RiskAlertRecord[];
  existingTasks: CollectionTaskRecord[];
  asOfDateIso?: string;
  fallbackAssigneeId: string;
  fallbackAssigneeName: string;
}): CollectionTaskRecord[] {
  const {
    organizationId,
    accounts,
    promises,
    alerts,
    existingTasks,
    asOfDateIso = getSantoDomingoTodayIso(),
    fallbackAssigneeId,
    fallbackAssigneeName,
  } = params;

  const existingKeys = new Set(existingTasks.map((t) => t.sourceEventKey));
  const newTasks: CollectionTaskRecord[] = [];
  const monthYm = asOfDateIso.slice(0, 7);

  const pushIfNew = (candidate: {
    loanId: string;
    loanNumber: string;
    customerId: string;
    customerName: string;
    assignedToUserId: string;
    assignedToUserName: string;
    taskType: CollectionTaskType;
    sourceEventKey: string;
    priority: CollectionPriority;
    title: string;
    description: string;
    dueDate: string;
  }) => {
    if (existingKeys.has(candidate.sourceEventKey)) return;
    existingKeys.add(candidate.sourceEventKey);
    newTasks.push({
      id: buildTaskDocId(candidate.sourceEventKey),
      organizationId,
      loanId: candidate.loanId,
      loanNumber: candidate.loanNumber,
      customerId: candidate.customerId,
      customerName: candidate.customerName,
      assignedToUserId: candidate.assignedToUserId,
      assignedToUserName: candidate.assignedToUserName,
      taskType: candidate.taskType,
      sourceEventKey: candidate.sourceEventKey,
      priority: candidate.priority,
      title: candidate.title,
      description: candidate.description,
      dueDate: candidate.dueDate,
      status: 'PENDIENTE',
    });
  };

  for (const acc of accounts) {
    if (acc.stage === 'CANCELADO') continue;
    const assigneeId = acc.assignedCollectorId || fallbackAssigneeId;
    const assigneeName = acc.assignedCollectorName || fallbackAssigneeName;

    if (acc.nextDueDate === asOfDateIso && acc.dpd === 0) {
      pushIfNew({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'VENCIMIENTO_HOY',
        sourceEventKey: `${acc.loanId}_VENCIMIENTO_HOY_${asOfDateIso}`,
        priority: 'MEDIA',
        title: `Recordatorio de vencimiento hoy · ${acc.loanNumber}`,
        description: `Cuota vence hoy (${asOfDateIso}). Realizar gestión preventiva antes del cierre de caja.`,
        dueDate: asOfDateIso,
      });
    }

    if (acc.dpd >= 1 && acc.dpd <= 5 && !acc.lastActionAt) {
      pushIfNew({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'MORA_TEMPRANA_1_5',
        sourceEventKey: `${acc.loanId}_MORA_1_5_${monthYm}`,
        priority: 'ALTA',
        title: `Primer contacto mora temprana (${acc.dpd} DPD) · ${acc.loanNumber}`,
        description: 'Préstamo entró en mora temprana sin contacto registrado. Contactar de inmediato.',
        dueDate: asOfDateIso,
      });
    }

    if (acc.dpd >= 61) {
      pushIfNew({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'CARTERA_CRITICA',
        sourceEventKey: `${acc.loanId}_CRITICA_${monthYm}`,
        priority: 'CRITICA',
        title: `Escalamiento mora crítica (${acc.dpd} DPD) · ${acc.loanNumber}`,
        description: 'Cuenta en etapa crítica. Coordinar visita/acuerdo formal o revisión con Supervisor.',
        dueDate: asOfDateIso,
      });
    }

    if (acc.pendingVerificationAmount > 0) {
      pushIfNew({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'VERIFICACION_PAGO_PENDIENTE',
        sourceEventKey: `${acc.loanId}_PAGO_PENDIENTE_${asOfDateIso}`,
        priority: 'ALTA',
        title: `Validar pago reportado pendiente · ${acc.loanNumber}`,
        description: `Existe pago reportado por ${acc.currency} ${acc.pendingVerificationAmount.toFixed(2)} pendiente de verificación en Finanzas.`,
        dueDate: asOfDateIso,
      });
    }
  }

  for (const prom of promises) {
    const acc = accounts.find((a) => a.loanId === prom.loanId);
    if (!acc || acc.stage === 'CANCELADO') continue;
    const assigneeId = acc.assignedCollectorId || prom.createdByUserId || fallbackAssigneeId;
    const assigneeName = acc.assignedCollectorName || prom.createdByUserName || fallbackAssigneeName;

    if (prom.status === 'VIGENTE' && prom.promisedDate === asOfDateIso) {
      pushIfNew({
        loanId: prom.loanId,
        loanNumber: prom.loanNumber,
        customerId: prom.customerId,
        customerName: prom.customerName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'PROMESA_HOY',
        sourceEventKey: `${prom.loanId}_PROMESA_HOY_${prom.id}`,
        priority: 'ALTA',
        title: `Verificar cumplimiento de promesa hoy · ${prom.loanNumber}`,
        description: `Promesa por ${prom.currency} ${prom.promisedAmount.toFixed(2)} pactada para hoy (${prom.promisedDate}).`,
        dueDate: asOfDateIso,
      });
    }

    if (prom.status === 'INCUMPLIDA') {
      pushIfNew({
        loanId: prom.loanId,
        loanNumber: prom.loanNumber,
        customerId: prom.customerId,
        customerName: prom.customerName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'PROMESA_INCUMPLIDA',
        sourceEventKey: `${prom.loanId}_PROMESA_INCUMPLIDA_${prom.id}`,
        priority: 'CRITICA',
        title: `Seguimiento promesa incumplida · ${prom.loanNumber}`,
        description: `La promesa de ${prom.promisedDate} (${prom.currency} ${prom.promisedAmount.toFixed(2)}) fue incumplida. Recontactar hoy.`,
        dueDate: asOfDateIso,
      });
    }
  }

  for (const alert of alerts) {
    if (alert.status !== 'ACTIVA') continue;
    const acc = accounts.find((a) => a.loanId === alert.loanId);
    if (!acc || acc.stage === 'CANCELADO') continue;
    const assigneeId = acc.assignedCollectorId || fallbackAssigneeId;
    const assigneeName = acc.assignedCollectorName || fallbackAssigneeName;

    if (['CRITICA', 'ALTA'].includes(alert.severity)) {
      pushIfNew({
        loanId: alert.loanId,
        loanNumber: alert.loanNumber,
        customerId: alert.customerId,
        customerName: alert.customerName,
        assignedToUserId: assigneeId,
        assignedToUserName: assigneeName,
        taskType: 'ALERTA_CENTINELA',
        sourceEventKey: `${alert.loanId}_ALERTA_${alert.id}`,
        priority: alert.severity,
        title: `Atender alerta Centinela: ${alert.title}`,
        description: alert.description,
        dueDate: asOfDateIso,
      });
    }
  }

  return newTasks;
}
