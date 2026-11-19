import type {
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionPolicyVersionRecord,
  CustomerDisputeRecord,
  MessageEventRecord,
  PaymentAgreementRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  UserRole,
} from '../../types/axycore';
import { hasRolePermission } from '../rbac';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  getSantoDomingoHour,
  getSantoDomingoTodayIso,
  getSantoDomingoWeekday,
  toCents,
} from './delinquencyEngine';

export interface ContactGuardResult {
  allowed: boolean;
  reason?: string;
  dailyContactsCount: number;
  maxDailyContacts: number;
  hasOpenDisputePause: boolean;
}

export function validateContactPermission(params: {
  loanId: string;
  policy?: CollectionPolicyVersionRecord;
  actions: CollectionActionRecord[];
  messageEvents?: MessageEventRecord[];
  disputes?: CustomerDisputeRecord[];
  isAutomatedBot?: boolean;
  referenceDate?: Date;
}): ContactGuardResult {
  const {
    loanId,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    actions,
    messageEvents = [],
    disputes = [],
    isAutomatedBot = false,
    referenceDate = new Date(),
  } = params;

  const todayIso = getSantoDomingoTodayIso(referenceDate);
  const hour = getSantoDomingoHour(referenceDate);
  const weekday = getSantoDomingoWeekday(referenceDate);

  const todayActions = actions.filter(
    (a) => a.loanId === loanId && a.actionTimeIso.slice(0, 10) === todayIso
  ).length;
  const todayMessages = messageEvents.filter(
    (m) =>
      m.loanId === loanId &&
      m.direction === 'OUTBOUND' &&
      ['ENVIADO', 'SIMULADO_LOCAL', 'INTEGRACION_PENDIENTE'].includes(m.deliveryStatus) &&
      String(m.createdAt || '').slice(0, 10) === todayIso
  ).length;

  const dailyContactsCount = todayActions + todayMessages;

  const openPauseDispute = disputes.find(
    (d) =>
      d.loanId === loanId &&
      ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status) &&
      d.pauseAutomatedMessages
  );

  if (isAutomatedBot && openPauseDispute) {
    return {
      allowed: false,
      reason: `Envío automático pausado por reclamación abierta (${openPauseDispute.disputeType}).`,
      dailyContactsCount,
      maxDailyContacts: policy.maxDailyContactsPerLoan,
      hasOpenDisputePause: true,
    };
  }

  if (!policy.allowedContactHours.allowSundays && weekday === 0) {
    return {
      allowed: false,
      reason: 'Contacto restringido los domingos según política de horario permitido.',
      dailyContactsCount,
      maxDailyContacts: policy.maxDailyContactsPerLoan,
      hasOpenDisputePause: Boolean(openPauseDispute),
    };
  }

  if (hour < policy.allowedContactHours.startHour || hour >= policy.allowedContactHours.endHour) {
    return {
      allowed: false,
      reason: `Fuera de horario permitido (${policy.allowedContactHours.startHour}:00–${policy.allowedContactHours.endHour}:00 America/Santo_Domingo).`,
      dailyContactsCount,
      maxDailyContacts: policy.maxDailyContactsPerLoan,
      hasOpenDisputePause: Boolean(openPauseDispute),
    };
  }

  if (dailyContactsCount >= policy.maxDailyContactsPerLoan) {
    return {
      allowed: false,
      reason: `Límite diario de contactos alcanzado (${dailyContactsCount}/${policy.maxDailyContactsPerLoan}).`,
      dailyContactsCount,
      maxDailyContacts: policy.maxDailyContactsPerLoan,
      hasOpenDisputePause: Boolean(openPauseDispute),
    };
  }

  return {
    allowed: true,
    dailyContactsCount,
    maxDailyContacts: policy.maxDailyContactsPerLoan,
    hasOpenDisputePause: Boolean(openPauseDispute),
  };
}

export function validateActionEditAttempt(existingAction: CollectionActionRecord): {
  allowed: boolean;
  reason?: string;
} {
  if (existingAction.isClosed) {
    return {
      allowed: false,
      reason:
        'Las gestiones cerradas son inmutables. Debe registrar una gestión correctiva vinculada.',
    };
  }
  return { allowed: true };
}

export interface EvaluatedPromiseResult {
  promise: PaymentPromiseRecord;
  previousStatus: PaymentPromiseRecord['status'];
  changed: boolean;
}

export function evaluatePromiseFulfillment(params: {
  promise: PaymentPromiseRecord;
  payments: PaymentRecord[];
  asOfDateIso?: string;
  autoMarkBrokenPromises?: boolean;
}): EvaluatedPromiseResult {
  const {
    promise,
    payments,
    asOfDateIso = getSantoDomingoTodayIso(),
    autoMarkBrokenPromises = true,
  } = params;

  if (promise.status === 'CANCELADA') {
    return { promise, previousStatus: promise.status, changed: false };
  }

  const promiseCreatedIso =
    typeof promise.createdAt === 'string' ? promise.createdAt.slice(0, 10) : promise.promisedDate;

  // Strictly only APLICADO payments count as confirmed fulfillment!
  const eligibleAppliedPayments = payments.filter(
    (p) =>
      p.loanId === promise.loanId &&
      p.status === 'APLICADO' &&
      p.currency === promise.currency &&
      p.paymentDate >= promiseCreatedIso
  );

  const pendingVerificationPayments = payments.filter(
    (p) =>
      p.loanId === promise.loanId &&
      ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status) &&
      p.currency === promise.currency &&
      p.paymentDate >= promiseCreatedIso
  );

  const appliedCents = eligibleAppliedPayments.reduce((acc, p) => acc + toCents(p.amount), 0);
  const pendingCents = pendingVerificationPayments.reduce((acc, p) => acc + toCents(p.amount), 0);
  const promisedCents = toCents(promise.promisedAmount);

  let nextStatus: PaymentPromiseRecord['status'] = promise.status;

  if (appliedCents >= promisedCents) {
    nextStatus = 'CUMPLIDA';
  } else if (appliedCents > 0 && pendingCents === 0 && asOfDateIso > promise.promisedDate) {
    nextStatus = 'CUMPLIDA_PARCIAL';
  } else if (pendingCents > 0) {
    // Reported or pending bank verification CANNOT mark CUMPLIDA!
    nextStatus = 'PENDIENTE_VERIFICACION';
  } else if (asOfDateIso > promise.promisedDate && autoMarkBrokenPromises) {
    nextStatus = appliedCents > 0 ? 'CUMPLIDA_PARCIAL' : 'INCUMPLIDA';
  } else {
    nextStatus = 'VIGENTE';
  }

  const nextPromise: PaymentPromiseRecord = {
    ...promise,
    status: nextStatus,
    fulfilledAmount: Math.round(appliedCents) / 100,
    fulfilledPaymentIds: eligibleAppliedPayments.map((p) => p.id),
    verifiedAt: nextStatus === 'CUMPLIDA' ? promise.verifiedAt ?? asOfDateIso : null,
  };

  return {
    promise: nextPromise,
    previousStatus: promise.status,
    changed:
      nextStatus !== promise.status ||
      nextPromise.fulfilledAmount !== promise.fulfilledAmount,
  };
}

export function canApprovePaymentAgreement(params: {
  userId: string;
  userRole: UserRole;
  agreement: PaymentAgreementRecord;
}): { allowed: boolean; reason?: string } {
  const { userId, userRole, agreement } = params;
  if (!hasRolePermission(userRole, 'RESOLVE_DISPUTES_AND_AGREEMENTS')) {
    return {
      allowed: false,
      reason: 'Solo Supervisor, Coordinador, Finanzas, Riesgo, Gerencia o Admin pueden aprobar acuerdos/reestructuraciones.',
    };
  }
  if (
    agreement.agreementType !== 'ACUERDO_PAGO' &&
    agreement.proposedBy === userId &&
    userRole !== 'ADMIN'
  ) {
    return {
      allowed: false,
      reason: 'Segregación de funciones: quien propone la reestructuración no puede aprobarla.',
    };
  }
  return { allowed: true };
}

export interface ClassifiedAgreementItem {
  agreement: PaymentAgreementRecord;
  account: CollectionAccountRecord | null;
  fulfilledAmount: number;
  requiredInitialAmount: number;
  category: 'ACUERDO_DEL_DIA' | 'ACUERDO_INCUMPLIDO' | 'VIGENTE_FUTURO' | 'HISTORICO';
  effectiveStatus: PaymentAgreementRecord['status'];
  reason: string;
}

export interface AgreementManagementClassification {
  acuerdosDelDia: ClassifiedAgreementItem[];
  acuerdosIncumplidos: ClassifiedAgreementItem[];
  vigentesFuturos: ClassifiedAgreementItem[];
  historicos: ClassifiedAgreementItem[];
}

export function classifyAgreementsForManagement(params: {
  agreements: PaymentAgreementRecord[];
  accounts: CollectionAccountRecord[];
  payments: PaymentRecord[];
  asOfDateIso?: string;
  collectorId?: string | null;
}): AgreementManagementClassification {
  const {
    agreements,
    accounts,
    payments,
    asOfDateIso = getSantoDomingoTodayIso(),
    collectorId,
  } = params;

  const accMap = new Map(accounts.map((a) => [a.loanId, a]));
  const acuerdosDelDia: ClassifiedAgreementItem[] = [];
  const acuerdosIncumplidos: ClassifiedAgreementItem[] = [];
  const vigentesFuturos: ClassifiedAgreementItem[] = [];
  const historicos: ClassifiedAgreementItem[] = [];

  for (const agr of agreements) {
    const account = accMap.get(agr.loanId) ?? null;
    if (collectorId && account && account.assignedCollectorId !== collectorId) {
      continue;
    }

    const dueIso = (agr.firstDueDate || '').slice(0, 10);
    const createdIso =
      typeof agr.createdAt === 'string' && agr.createdAt.length >= 10
        ? agr.createdAt.slice(0, 10)
        : dueIso;

    const appliedPayments = payments.filter(
      (p) =>
        p.loanId === agr.loanId &&
        p.status === 'APLICADO' &&
        p.currency === agr.currency &&
        p.paymentDate >= createdIso
    );
    const appliedCents = appliedPayments.reduce((sum, p) => sum + toCents(p.amount), 0);
    const fulfilledAmount = Math.round(appliedCents) / 100;

    const installmentAmount =
      agr.installmentCount > 0
        ? Math.round((agr.totalAgreedAmount / agr.installmentCount) * 100) / 100
        : agr.totalAgreedAmount;
    const requiredInitialAmount =
      agr.downPaymentAmount > 0 ? agr.downPaymentAmount : installmentAmount;

    if (agr.status === 'CUMPLIDO' || agr.status === 'RECHAZADO') {
      historicos.push({
        agreement: agr,
        account,
        fulfilledAmount,
        requiredInitialAmount,
        category: 'HISTORICO',
        effectiveStatus: agr.status,
        reason:
          agr.status === 'CUMPLIDO'
            ? 'Acuerdo cumplido y cerrado.'
            : agr.rejectedReason || 'Acuerdo rechazado.',
      });
      continue;
    }

    if (agr.status === 'INCUMPLIDO') {
      acuerdosIncumplidos.push({
        agreement: agr,
        account,
        fulfilledAmount,
        requiredInitialAmount,
        category: 'ACUERDO_INCUMPLIDO',
        effectiveStatus: 'INCUMPLIDO',
        reason: `Acuerdo incumplido (fecha compromiso: ${dueIso || '—'}).`,
      });
      continue;
    }

    // Active/Proposed/Approved agreements evaluated against asOfDateIso
    if (dueIso && dueIso === asOfDateIso) {
      acuerdosDelDia.push({
        agreement: agr,
        account,
        fulfilledAmount,
        requiredInitialAmount,
        category: 'ACUERDO_DEL_DIA',
        effectiveStatus: agr.status,
        reason: `Vence hoy (${dueIso}). Requiere gestión y confirmación de pago.`,
      });
    } else if (dueIso && dueIso < asOfDateIso) {
      if (toCents(fulfilledAmount) >= toCents(requiredInitialAmount) && toCents(requiredInitialAmount) > 0) {
        acuerdosDelDia.push({
          agreement: agr,
          account,
          fulfilledAmount,
          requiredInitialAmount,
          category: 'ACUERDO_DEL_DIA',
          effectiveStatus: agr.status,
          reason: `Pago recibido (${fulfilledAmount}) pendiente de cierre como CUMPLIDO.`,
        });
      } else {
        acuerdosIncumplidos.push({
          agreement: agr,
          account,
          fulfilledAmount,
          requiredInitialAmount,
          category: 'ACUERDO_INCUMPLIDO',
          effectiveStatus: 'INCUMPLIDO',
          reason: `Fecha de acuerdo vencida (${dueIso}) sin pago aplicado suficiente.`,
        });
      }
    } else {
      vigentesFuturos.push({
        agreement: agr,
        account,
        fulfilledAmount,
        requiredInitialAmount,
        category: 'VIGENTE_FUTURO',
        effectiveStatus: agr.status,
        reason: `Programado para ${dueIso || 'fecha pendiente'}.`,
      });
    }
  }

  acuerdosDelDia.sort((a, b) => (b.account?.dpd ?? 0) - (a.account?.dpd ?? 0));
  acuerdosIncumplidos.sort((a, b) => (a.agreement.firstDueDate || '').localeCompare(b.agreement.firstDueDate || ''));

  return {
    acuerdosDelDia,
    acuerdosIncumplidos,
    vigentesFuturos,
    historicos,
  };
}
