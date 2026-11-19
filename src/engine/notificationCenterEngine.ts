import type {
  ApplicationRecord,
  AuditLogRecord,
  CollectionActionRecord,
  CommitteeDecisionRecord,
  CreditPermission,
  LoanInstallmentRecord,
  LoanRecord,
  NavSectionId,
  PaymentPromiseRecord,
  PaymentRecord,
  ReconciliationExceptionRecord,
  RiskAlertRecord,
  UserNotificationRecord,
} from '../types/axycore';
import { classifyCriticalAuditEvent } from './criticalAudit';
import {
  APPLICATION_STATUS_LABELS,
  formatMoney,
  formatTimestamp,
  PRODUCT_LABELS,
} from '../utils/formatters';

export type NotificationCategory = 'ALL' | 'CREDITO' | 'COBRANZA' | 'RIESGO' | 'BITACORA';

export type NotificationAlertTypeCode =
  | 'COMITE_PENDIENTE'
  | 'SOLICITUD_RECIBIDA'
  | 'EVALUACION_PENDIENTE'
  | 'EXPEDIENTE_DEVUELTO'
  | 'DESEMBOLSO_PENDIENTE'
  | 'PROMESA_INCUMPLIDA'
  | 'VENCIMIENTO_HOY'
  | 'PAGO_POR_VERIFICAR'
  | 'EXCEPCION_CONCILIACION'
  | 'ALERTA_CENTINELA'
  | 'EVENTO_CRITICO_BITACORA';

export const NOTIFICATION_ALERT_TYPE_LABELS: Record<NotificationAlertTypeCode, string> = {
  COMITE_PENDIENTE: 'Comité pendiente',
  SOLICITUD_RECIBIDA: 'Solicitud recibida',
  EVALUACION_PENDIENTE: 'Evaluación pendiente',
  EXPEDIENTE_DEVUELTO: 'Expediente devuelto',
  DESEMBOLSO_PENDIENTE: 'Desembolso pendiente',
  PROMESA_INCUMPLIDA: 'Promesa incumplida',
  VENCIMIENTO_HOY: 'Vencimiento del día',
  PAGO_POR_VERIFICAR: 'Pago por verificar',
  EXCEPCION_CONCILIACION: 'Excepción bancaria',
  ALERTA_CENTINELA: 'Alerta Centinela',
  EVENTO_CRITICO_BITACORA: 'Evento crítico en bitácora',
};

export interface NotificationLinkedEvent {
  id: string;
  source: 'AUDIT_LOG' | 'MOVEMENT_HISTORY' | 'COLLECTION_ACTION' | 'COMMITTEE_DECISION';
  sourceLabel: string;
  eventCode: string;
  description: string;
  actor: string;
  timestampIso: string;
  timestampDisplay: string;
  stateTransition?: string;
  note?: string;
}

export interface UnifiedNotificationItem {
  ackKey: string;
  alertType: NotificationAlertTypeCode;
  alertTypeLabel: string;
  category: Exclude<NotificationCategory, 'ALL'>;
  priority: 'INMEDIATA' | 'ALTA' | 'MEDIA';
  title: string;
  subtitle: string;
  amountLabel?: string;
  detail: string;
  timestampIso: string;
  timestampDisplay: string;
  actorName: string;
  eventHistory: NotificationLinkedEvent[];
  isUnread: boolean;
  primaryLabel: string;
  primarySection: NavSectionId;
  secondaryLabel?: string;
  secondarySection?: NavSectionId;
  applicationId?: string;
  loanId?: string;
  auditLogId?: string;
  firestoreNotificationId?: string;
}

function toSortableIso(raw: unknown, fallbackIso = ''): string {
  if (!raw) return fallbackIso;
  try {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed}T12:00:00.000Z`;
      }
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
    }
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'toDate' in raw &&
      typeof (raw as { toDate: () => Date }).toDate === 'function'
    ) {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    }
    if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
      return new Date((raw as { seconds: number }).seconds * 1000).toISOString();
    }
  } catch {
    return fallbackIso;
  }
  return fallbackIso;
}

function buildApplicationEventHistory(params: {
  app: ApplicationRecord;
  auditLogs: AuditLogRecord[];
  committeeDecisions: CommitteeDecisionRecord[];
}): NotificationLinkedEvent[] {
  const { app, auditLogs, committeeDecisions } = params;
  const events: NotificationLinkedEvent[] = [];

  // 1. Movement history stored on the application record
  const historyList = app.movementHistory ?? [];
  for (let idx = 0; idx < historyList.length; idx++) {
    const mov = historyList[idx];
    const iso = toSortableIso(mov.timestamp);
    const transition =
      mov.fromStatus && mov.toStatus && mov.fromStatus !== mov.toStatus
        ? `${mov.fromStatus} → ${mov.toStatus}`
        : mov.toStatus || undefined;
    events.push({
      id: `mov_${app.id}_${idx}_${mov.timestamp}`,
      source: 'MOVEMENT_HISTORY',
      sourceLabel: 'Flujo Solicitud',
      eventCode: mov.toStatus || 'MOVIMIENTO',
      description: mov.action,
      actor: mov.userName || mov.userId || 'Sistema',
      timestampIso: iso,
      timestampDisplay: formatTimestamp(mov.timestamp),
      stateTransition: transition,
      note: mov.note,
    });
  }

  // 2. Committee decisions linked to this application
  const decisions = committeeDecisions.filter((d) => d.applicationId === app.id);
  for (const dec of decisions) {
    const iso = toSortableIso(dec.decidedAt);
    events.push({
      id: `comm_${dec.id}`,
      source: 'COMMITTEE_DECISION',
      sourceLabel: 'Comité de Crédito',
      eventCode: dec.decision,
      description: `Dictamen colegiado: ${dec.decision}`,
      actor: dec.decidedByName || dec.decidedBy || 'Comité',
      timestampIso: iso,
      timestampDisplay: formatTimestamp(dec.decidedAt),
      note: dec.observations || dec.rejectionReason || undefined,
    });
  }

  // 3. Audit logs linked to this application
  const appLogs = auditLogs.filter(
    (log) =>
      log.entityId === app.id ||
      log.entityId === app.applicationNumber ||
      (log.action && log.action.includes(app.applicationNumber))
  );
  for (const log of appLogs) {
    const iso = toSortableIso(log.timestamp);
    const transition =
      log.previousState && log.newState && log.previousState !== log.newState
        ? `${log.previousState} → ${log.newState}`
        : log.newState || undefined;
    events.push({
      id: `audit_${log.id}`,
      source: 'AUDIT_LOG',
      sourceLabel: 'Bitácora Auditoría',
      eventCode: log.eventType,
      description: log.action,
      actor: log.userEmail || log.userId || 'Sistema',
      timestampIso: iso,
      timestampDisplay: formatTimestamp(log.timestamp),
      stateTransition: transition,
      note: log.justification || undefined,
    });
  }

  // Deduplicate by description+timestampIso prefix and sort newest first
  const seen = new Set<string>();
  return events
    .sort((a, b) => (b.timestampIso || '').localeCompare(a.timestampIso || ''))
    .filter((ev) => {
      const sig = `${ev.eventCode}:${ev.description.slice(0, 48)}:${ev.timestampIso.slice(0, 16)}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    })
    .slice(0, 8);
}

function buildLoanAndCollectionEventHistory(params: {
  loanId?: string;
  loanNumber?: string;
  entityIds?: string[];
  collectionActions: CollectionActionRecord[];
  auditLogs: AuditLogRecord[];
}): NotificationLinkedEvent[] {
  const { loanId, loanNumber, entityIds = [], collectionActions, auditLogs } = params;
  const events: NotificationLinkedEvent[] = [];
  const entitySet = new Set(
    [loanId, loanNumber, ...entityIds].filter((v): v is string => Boolean(v))
  );

  if (loanId) {
    const actions = collectionActions.filter((a) => a.loanId === loanId);
    for (const act of actions) {
      const iso = toSortableIso(act.actionTimeIso || act.createdAt);
      events.push({
        id: `col_act_${act.id}`,
        source: 'COLLECTION_ACTION',
        sourceLabel: `Gestión (${act.channel})`,
        eventCode: act.contactResult,
        description: `${act.channel} · ${act.contactResult.replace(/_/g, ' ')}`,
        actor: act.collectorName || act.collectorId || 'Gestor',
        timestampIso: iso,
        timestampDisplay: formatTimestamp(act.actionTimeIso || act.createdAt),
        stateTransition: `DPD ${act.dpdAtAction}d`,
        note: act.notes,
      });
    }
  }

  const matchedLogs = auditLogs.filter((log) => {
    if (entitySet.has(log.entityId)) return true;
    if (loanNumber && log.action && log.action.includes(loanNumber)) return true;
    return false;
  });

  for (const log of matchedLogs) {
    const iso = toSortableIso(log.timestamp);
    const transition =
      log.previousState && log.newState && log.previousState !== log.newState
        ? `${log.previousState} → ${log.newState}`
        : log.newState || undefined;
    events.push({
      id: `audit_${log.id}`,
      source: 'AUDIT_LOG',
      sourceLabel: 'Bitácora Auditoría',
      eventCode: log.eventType,
      description: log.action,
      actor: log.userEmail || log.userId || 'Sistema',
      timestampIso: iso,
      timestampDisplay: formatTimestamp(log.timestamp),
      stateTransition: transition,
      note: log.justification || undefined,
    });
  }

  return events
    .sort((a, b) => (b.timestampIso || '').localeCompare(a.timestampIso || ''))
    .slice(0, 8);
}

export function buildUnifiedNotificationCenterItems(params: {
  todayIso: string;
  applications: ApplicationRecord[];
  loans: LoanRecord[];
  loanInstallments: LoanInstallmentRecord[];
  paymentPromises: PaymentPromiseRecord[];
  payments: PaymentRecord[];
  reconciliationExceptions: ReconciliationExceptionRecord[];
  riskAlerts: RiskAlertRecord[];
  collectionActions: CollectionActionRecord[];
  committeeDecisions: CommitteeDecisionRecord[];
  auditLogs: AuditLogRecord[];
  acknowledgedKeys: Set<string>;
  canAccessSection: (section: NavSectionId) => boolean;
  hasPermission: (permission: CreditPermission) => boolean;
}): UnifiedNotificationItem[] {
  const {
    todayIso,
    applications,
    loans,
    loanInstallments,
    paymentPromises,
    payments,
    reconciliationExceptions,
    riskAlerts,
    collectionActions,
    committeeDecisions,
    auditLogs,
    acknowledgedKeys,
    canAccessSection,
    hasPermission,
  } = params;

  const list: UnifiedNotificationItem[] = [];
  const loansById = new Map(loans.map((l) => [l.id, l]));

  // ---------------------------------------------------------------------------
  // 1. CRÉDITO ALERTS (Comité pendiente, Solicitud recibida, Evaluación pendiente,
  //    Expediente devuelto, Desembolso pendiente)
  // ---------------------------------------------------------------------------
  const canViewCreditAlerts =
    canAccessSection('applications') ||
    canAccessSection('evaluation') ||
    canAccessSection('committee') ||
    canAccessSection('disbursements') ||
    hasPermission('VIEW_INTERNAL_INBOX') ||
    hasPermission('VIEW_COMMITTEE_QUEUE');

  if (canViewCreditAlerts) {
    const actionableApps = applications.filter((a) =>
      ['EN_COMITE', 'RECIBIDA', 'EN_EVALUACION', 'DEVUELTA', 'FORMALIZADA'].includes(a.status)
    );

    for (const app of actionableApps) {
      const eventHistory = buildApplicationEventHistory({
        app,
        auditLogs,
        committeeDecisions,
      });
      const latestEvent = eventHistory[0];
      const timestampIso =
        latestEvent?.timestampIso ||
        toSortableIso(app.updatedAt || app.createdAt, `${todayIso}T08:00:00.000Z`);
      const timestampDisplay =
        latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
          ? latestEvent.timestampDisplay
          : formatTimestamp(app.updatedAt || app.createdAt);
      const actorName =
        latestEvent?.actor ||
        (app.channel === 'EXTERNAL' ? 'Portal Externo' : 'Mesa de Originación');

      let alertType: NotificationAlertTypeCode = 'SOLICITUD_RECIBIDA';
      let priority: 'INMEDIATA' | 'ALTA' | 'MEDIA' = 'ALTA';
      let primarySection: NavSectionId = 'evaluation';
      let primaryLabel = 'Evaluar Expediente';
      let reason = '';

      if (app.status === 'EN_COMITE') {
        alertType = 'COMITE_PENDIENTE';
        priority = 'INMEDIATA';
        primarySection = 'committee';
        primaryLabel = 'Resolver en Comité';
        reason = latestEvent
          ? `Comité pendiente · Último evento: ${latestEvent.description}`
          : 'Expediente en cola de Comité esperando decisión colegiada.';
      } else if (app.status === 'DEVUELTA') {
        alertType = 'EXPEDIENTE_DEVUELTO';
        priority = 'INMEDIATA';
        primarySection = 'evaluation';
        primaryLabel = 'Subsanar Expediente';
        reason = latestEvent?.note
          ? `Expediente devuelto: ${latestEvent.note}`
          : latestEvent
          ? `Expediente devuelto · ${latestEvent.description}`
          : 'Expediente devuelto con observaciones pendientes de subsanar.';
      } else if (app.status === 'RECIBIDA') {
        alertType = 'SOLICITUD_RECIBIDA';
        priority = app.channel === 'EXTERNAL' ? 'INMEDIATA' : 'ALTA';
        primarySection = 'evaluation';
        primaryLabel = 'Iniciar Evaluación';
        reason =
          app.channel === 'EXTERNAL'
            ? 'Solicitud recibida desde Portal Externo pendiente de depuración.'
            : 'Nueva solicitud recibida en bandeja operativa.';
      } else if (app.status === 'EN_EVALUACION') {
        alertType = 'EVALUACION_PENDIENTE';
        priority = 'ALTA';
        primarySection = 'evaluation';
        primaryLabel = 'Continuar Evaluación';
        reason = latestEvent
          ? `En evaluación técnica · ${latestEvent.description}`
          : 'Evaluación técnica y verificación documental en curso.';
      } else if (app.status === 'FORMALIZADA') {
        alertType = 'DESEMBOLSO_PENDIENTE';
        priority = 'ALTA';
        primarySection = 'disbursements';
        primaryLabel = 'Ejecutar Desembolso';
        reason = 'Contrato formalizado y firmas verificadas; pendiente orden de desembolso.';
      }

      const ackKey = `${app.id}:${app.status}`;
      list.push({
        ackKey,
        alertType,
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS[alertType],
        category: 'CREDITO',
        priority,
        title: `${app.applicantDisplayName} (${app.applicationNumber})`,
        subtitle: `${APPLICATION_STATUS_LABELS[app.status]} · ${PRODUCT_LABELS[app.productCode]}`,
        amountLabel: formatMoney(app.recommendedAmount ?? app.requestedAmount, app.currency),
        detail: `${reason}${
          app.latestScore !== null && app.latestScore !== undefined
            ? ` · Score V2: ${app.latestScore}/100`
            : ''
        }`,
        timestampIso,
        timestampDisplay,
        actorName,
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel,
        primarySection,
        secondaryLabel: 'Abrir Solicitud',
        secondarySection: 'applications',
        applicationId: app.id,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. COBRANZA ALERTS: Promesa incumplida, Vencimiento hoy, Pago por verificar,
  //    Excepción bancaria
  // ---------------------------------------------------------------------------
  const canViewPromisesAndDaily =
    canAccessSection('cobranza_promises') ||
    canAccessSection('cobranza_urgent') ||
    canAccessSection('cobranza_daily') ||
    hasPermission('VIEW_COLLECTIONS_PORTFOLIO') ||
    hasPermission('MANAGE_PROMISES');

  if (canViewPromisesAndDaily) {
    // 2a. Promesas incumplidas o vencidas
    const brokenPromises = paymentPromises
      .filter(
        (p) =>
          p.status === 'INCUMPLIDA' ||
          (p.status === 'VIGENTE' && p.promisedDate < todayIso)
      )
      .slice(0, 10);

    for (const pr of brokenPromises) {
      const ackKey = `promise_broken_${pr.id}_${pr.status}_${pr.promisedDate}`;
      const eventHistory = buildLoanAndCollectionEventHistory({
        loanId: pr.loanId,
        loanNumber: pr.loanNumber,
        entityIds: [pr.id],
        collectionActions,
        auditLogs,
      });
      const latestEvent = eventHistory[0];
      const pendingAmt = Math.max(0, Number(pr.promisedAmount || 0) - Number(pr.fulfilledAmount || 0));
      const timestampIso =
        latestEvent?.timestampIso ||
        toSortableIso(pr.updatedAt || pr.createdAt, `${pr.promisedDate}T12:00:00.000Z`);
      const timestampDisplay =
        latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
          ? latestEvent.timestampDisplay
          : pr.promisedDate;

      list.push({
        ackKey,
        alertType: 'PROMESA_INCUMPLIDA',
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS.PROMESA_INCUMPLIDA,
        category: 'COBRANZA',
        priority: 'INMEDIATA',
        title: `${pr.customerName} (${pr.loanNumber})`,
        subtitle: `Fecha prometida: ${pr.promisedDate} · Canal: ${pr.channel}`,
        amountLabel: formatMoney(pendingAmt, pr.currency),
        detail: latestEvent
          ? `Promesa incumplida sin pago confirmado. Última gestión: ${latestEvent.description} (${latestEvent.actor}).`
          : `Compromiso de pago por ${formatMoney(pr.promisedAmount, pr.currency)} vencido sin abono verificado.`,
        timestampIso,
        timestampDisplay,
        actorName: latestEvent?.actor || pr.createdByUserName || 'Gestor de Cobranza',
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: 'Gestionar Promesa',
        primarySection: 'cobranza_promises',
        secondaryLabel: 'Ficha 360°',
        secondarySection: 'cobranza_portfolio',
        loanId: pr.loanId,
      });
    }

    // 2b. Cuotas con vencimiento hoy
    const dueTodayInstallments = loanInstallments
      .filter((inst) => inst.dueDate === todayIso && inst.status !== 'PAGADA')
      .slice(0, 6);

    for (const inst of dueTodayInstallments) {
      const loan = loansById.get(inst.loanId);
      const loanNumber = loan?.loanNumber || inst.loanId;
      const customerName = loan?.applicantDisplayName || 'Cliente';
      const currency = loan?.currency || 'DOP';
      const ackKey = `due_today_${inst.id}_${inst.dueDate}`;
      const eventHistory = buildLoanAndCollectionEventHistory({
        loanId: inst.loanId,
        loanNumber,
        entityIds: [inst.id],
        collectionActions,
        auditLogs,
      });
      const latestEvent = eventHistory[0];

      list.push({
        ackKey,
        alertType: 'VENCIMIENTO_HOY',
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS.VENCIMIENTO_HOY,
        category: 'COBRANZA',
        priority: 'ALTA',
        title: `${customerName} (${loanNumber})`,
        subtitle: `Cuota #${inst.installmentNumber} vence hoy (${inst.dueDate})`,
        amountLabel: formatMoney(inst.totalAmount, currency),
        detail: latestEvent
          ? `Exigible en la jornada · Último evento: ${latestEvent.description}`
          : `Cuota #${inst.installmentNumber} programada para cobro en la jornada de hoy.`,
        timestampIso: latestEvent?.timestampIso || `${todayIso}T09:00:00.000Z`,
        timestampDisplay:
          latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
            ? latestEvent.timestampDisplay
            : inst.dueDate,
        actorName: latestEvent?.actor || 'Motor de Vencimientos',
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: 'Atender Cobro del Día',
        primarySection: 'cobranza_daily',
        secondaryLabel: 'Ficha 360°',
        secondarySection: 'cobranza_portfolio',
        loanId: inst.loanId,
      });
    }
  }

  // 2c. Pagos por verificar y excepciones de conciliación
  if (
    canAccessSection('cobranza_payments') ||
    canAccessSection('cobranza_reconciliation') ||
    hasPermission('VERIFY_AND_APPLY_PAYMENTS') ||
    hasPermission('RECONCILE_BANK_TRANSACTIONS')
  ) {
    const pendingPayments = payments
      .filter(
        (p) =>
          p.status === 'RECIBIDO_PENDIENTE_VERIFICACION' || p.status === 'REPORTADO'
      )
      .slice(0, 6);

    for (const pay of pendingPayments) {
      const ackKey = `pay_pending_${pay.id}_${pay.status}`;
      const eventHistory = buildLoanAndCollectionEventHistory({
        loanId: pay.loanId,
        loanNumber: pay.loanNumber,
        entityIds: [pay.id],
        collectionActions,
        auditLogs,
      });
      const latestEvent = eventHistory[0];

      list.push({
        ackKey,
        alertType: 'PAGO_POR_VERIFICAR',
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS.PAGO_POR_VERIFICAR,
        category: 'COBRANZA',
        priority: 'ALTA',
        title: `${pay.customerName} (${pay.loanNumber})`,
        subtitle: `Ref. ${pay.referenceNumber || 'S/R'} · ${pay.method} · ${pay.paymentDate}`,
        amountLabel: formatMoney(pay.amount, pay.currency),
        detail: `Pago reportado por ${pay.reportedByName || 'operador'} pendiente de verificación financiera antes de imputar saldo.`,
        timestampIso:
          latestEvent?.timestampIso ||
          toSortableIso(pay.createdAt, `${pay.paymentDate}T12:00:00.000Z`),
        timestampDisplay:
          latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
            ? latestEvent.timestampDisplay
            : pay.paymentDate,
        actorName: pay.reportedByName || latestEvent?.actor || 'Caja / Cobranza',
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: 'Verificar Pago',
        primarySection: 'cobranza_payments',
        secondaryLabel: 'Ficha 360°',
        secondarySection: 'cobranza_portfolio',
        loanId: pay.loanId,
      });
    }

    const openReconciliations = reconciliationExceptions
      .filter((r) => r.status === 'ABIERTA')
      .slice(0, 5);

    for (const exc of openReconciliations) {
      const ackKey = `reconcil_exc_${exc.id}_${exc.status}`;
      const eventHistory = buildLoanAndCollectionEventHistory({
        loanId: exc.loanId || undefined,
        entityIds: [exc.id, exc.bankTransactionId],
        collectionActions,
        auditLogs,
      });
      const latestEvent = eventHistory[0];

      list.push({
        ackKey,
        alertType: 'EXCEPCION_CONCILIACION',
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS.EXCEPCION_CONCILIACION,
        category: 'COBRANZA',
        priority: 'ALTA',
        title: `Excepción bancaria · ${exc.exceptionType.replace(/_/g, ' ')}`,
        subtitle: `Movimiento ${exc.bankTransactionId}`,
        detail: exc.detail || 'Partida bancaria pendiente de identificación o cruce en Finanzas.',
        timestampIso:
          latestEvent?.timestampIso ||
          toSortableIso(exc.createdAt, `${todayIso}T10:00:00.000Z`),
        timestampDisplay:
          latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
            ? latestEvent.timestampDisplay
            : formatTimestamp(exc.createdAt),
        actorName: latestEvent?.actor || 'Motor Conciliación',
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: 'Conciliar Partida',
        primarySection: 'cobranza_reconciliation',
        loanId: exc.loanId || undefined,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. RIESGO & CENTINELA ALERTS
  // ---------------------------------------------------------------------------
  if (canAccessSection('cobranza_sentinel') || hasPermission('VIEW_COLLECTIONS_PORTFOLIO')) {
    const openRisks = riskAlerts.filter((a) => a.status === 'ACTIVA').slice(0, 8);
    for (const alert of openRisks) {
      const ackKey = `sentinel_${alert.id}_${alert.status}`;
      const eventHistory = buildLoanAndCollectionEventHistory({
        loanId: alert.loanId,
        loanNumber: alert.loanNumber,
        entityIds: [alert.id],
        collectionActions,
        auditLogs,
      });
      const latestEvent = eventHistory[0];

      list.push({
        ackKey,
        alertType: 'ALERTA_CENTINELA',
        alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS.ALERTA_CENTINELA,
        category: 'RIESGO',
        priority:
          alert.severity === 'CRITICA' || alert.severity === 'ALTA' ? 'INMEDIATA' : 'ALTA',
        title: `${alert.title} (${alert.loanNumber})`,
        subtitle: `${alert.customerName} · Regla ${alert.ruleCode} · Severidad ${alert.severity}`,
        amountLabel: alert.metricValue,
        detail: alert.description,
        timestampIso:
          latestEvent?.timestampIso ||
          toSortableIso(alert.createdAt, `${todayIso}T11:00:00.000Z`),
        timestampDisplay:
          latestEvent?.timestampDisplay && latestEvent.timestampDisplay !== '—'
            ? latestEvent.timestampDisplay
            : formatTimestamp(alert.createdAt),
        actorName: latestEvent?.actor || 'Centinela Riesgo',
        eventHistory,
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: 'Abrir Centinela',
        primarySection: 'cobranza_sentinel',
        secondaryLabel: 'Ficha 360°',
        secondarySection: 'cobranza_portfolio',
        loanId: alert.loanId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. BITÁCORA DE EVENTOS CRÍTICOS (Real Historical Critical Events from auditLogs)
  // ---------------------------------------------------------------------------
  const canViewAuditEvents =
    canAccessSection('audit') ||
    canAccessSection('cobranza_audit') ||
    hasPermission('VIEW_AUDIT_LOGS') ||
    hasPermission('VIEW_INTERNAL_INBOX') ||
    hasPermission('VIEW_COLLECTIONS_PORTFOLIO');

  if (canViewAuditEvents) {
    const existingEntityIds = new Set<string>();
    list.forEach((item) => {
      if (item.applicationId) existingEntityIds.add(item.applicationId);
      if (item.loanId) existingEntityIds.add(item.loanId);
    });

    const criticalLogs = auditLogs
      .map((log) => ({ log, cls: classifyCriticalAuditEvent(log) }))
      .filter(({ log, cls }) => {
        if (!cls.isCritical) return false;
        // Include high/critical events or standalone governance/document/committee events
        if (
          cls.category === 'COMMITTEE_APPROVAL' ||
          cls.category === 'CONFIDENTIAL_DOC_ACCESS' ||
          cls.category === 'GOVERNANCE_AND_FINANCE'
        ) {
          return true;
        }
        return !existingEntityIds.has(log.entityId);
      })
      .slice(0, 8);

    for (const { log, cls } of criticalLogs) {
      const ackKey = `audit_crit_${log.id}`;
      const iso = toSortableIso(log.timestamp, `${todayIso}T07:00:00.000Z`);
      const transition =
        log.previousState && log.newState && log.previousState !== log.newState
          ? `${log.previousState} → ${log.newState}`
          : log.newState || undefined;

      const linkedEvent: NotificationLinkedEvent = {
        id: `audit_${log.id}`,
        source: 'AUDIT_LOG',
        sourceLabel: cls.categoryLabel,
        eventCode: log.eventType,
        description: log.action,
        actor: log.userEmail || log.userId || 'Sistema',
        timestampIso: iso,
        timestampDisplay: formatTimestamp(log.timestamp),
        stateTransition: transition,
        note: log.justification || cls.complianceControl,
      };

      const targetSection: NavSectionId =
        log.entityType === 'applications' && canAccessSection('applications')
          ? 'applications'
          : log.entityType === 'committee_decisions' && canAccessSection('committee')
          ? 'committee'
          : log.entityType === 'loans' && canAccessSection('loans')
          ? 'loans'
          : canAccessSection('audit')
          ? 'audit'
          : 'dashboard';

      list.push({
        ackKey,
        alertType: 'EVENTO_CRITICO_BITACORA',
        alertTypeLabel: cls.categoryLabel,
        category: 'BITACORA',
        priority: cls.severity === 'CRITICO' ? 'INMEDIATA' : 'ALTA',
        title: log.action,
        subtitle: `${log.eventType} · Entidad: ${log.entityType} (${log.entityId})`,
        amountLabel: transition,
        detail: `${cls.complianceControl}${
          log.justification ? ` · Justificación: ${log.justification}` : ''
        }`,
        timestampIso: iso,
        timestampDisplay: formatTimestamp(log.timestamp),
        actorName: log.userEmail || log.userId || 'Sistema',
        eventHistory: [linkedEvent],
        isUnread: !acknowledgedKeys.has(ackKey),
        primaryLabel: canAccessSection('audit') ? 'Ver en Bitácora' : 'Abrir Módulo',
        primarySection: canAccessSection('audit') ? 'audit' : targetSection,
        secondaryLabel: targetSection !== 'audit' ? 'Ir a Registro' : undefined,
        secondarySection: targetSection !== 'audit' ? targetSection : undefined,
        applicationId: log.entityType === 'applications' ? log.entityId : undefined,
        loanId: log.entityType === 'loans' ? log.entityId : undefined,
        auditLogId: log.id,
      });
    }
  }

  // Sort by priority weight first, then newest timestamp
  const priorityOrder: Record<UnifiedNotificationItem['priority'], number> = {
    INMEDIATA: 3,
    ALTA: 2,
    MEDIA: 1,
  };

  return list.sort((a, b) => {
    if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return (b.timestampIso || '').localeCompare(a.timestampIso || '');
  });
}

export function summarizeNotificationsByAlertType(
  items: UnifiedNotificationItem[]
): Array<{
  alertType: NotificationAlertTypeCode;
  label: string;
  totalCount: number;
  unreadCount: number;
  category: Exclude<NotificationCategory, 'ALL'>;
}> {
  const map = new Map<
    NotificationAlertTypeCode,
    {
      alertType: NotificationAlertTypeCode;
      label: string;
      totalCount: number;
      unreadCount: number;
      category: Exclude<NotificationCategory, 'ALL'>;
    }
  >();

  for (const item of items) {
    const prev = map.get(item.alertType);
    if (!prev) {
      map.set(item.alertType, {
        alertType: item.alertType,
        label: NOTIFICATION_ALERT_TYPE_LABELS[item.alertType],
        totalCount: 1,
        unreadCount: item.isUnread ? 1 : 0,
        category: item.category,
      });
    } else {
      prev.totalCount += 1;
      if (item.isUnread) prev.unreadCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalCount - a.totalCount);
}

export function buildUserNotificationDocId(userId: string, sourceKey: string): string {
  const cleanUser = String(userId || 'user')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 36);
  const cleanKey = String(sourceKey || 'evt')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return `ntf_${cleanUser}_${cleanKey || 'item'}`.slice(0, 128);
}

export function buildUserNotificationPayload(params: {
  userId: string;
  organizationId: string;
  createdBy: string;
  item: UnifiedNotificationItem;
  read?: boolean;
  readAt?: string | null;
}): Omit<UserNotificationRecord, 'createdAt' | 'updatedAt'> {
  const { userId, organizationId, createdBy, item, read = !item.isUnread, readAt = null } = params;
  const docId =
    item.firestoreNotificationId || buildUserNotificationDocId(userId, item.ackKey);
  const safeStr = (val: string | null | undefined, max: number, fallback = '') =>
    String(val ?? fallback).trim().slice(0, max);

  const entityType = item.applicationId
    ? 'applications'
    : item.loanId
    ? 'loans'
    : item.auditLogId
    ? 'audit_logs'
    : 'system';
  const entityId = item.applicationId || item.loanId || item.auditLogId || item.ackKey;

  const payload: Omit<UserNotificationRecord, 'createdAt' | 'updatedAt'> = {
    id: safeStr(docId, 128),
    organizationId: safeStr(organizationId, 128),
    userId: safeStr(userId, 128),
    type: safeStr(item.alertType, 64, 'EVENTO_CRITICO_BITACORA'),
    category: item.category,
    priority: item.priority,
    title: safeStr(item.title, 200, 'Notificación AxyCore'),
    message: safeStr(`${item.subtitle} · ${item.detail}`, 600, 'Alerta operativa registrada.'),
    targetSection: item.primarySection,
    entityType: safeStr(entityType, 64),
    entityId: safeStr(entityId, 128),
    sourceEventKey: safeStr(item.ackKey, 160),
    actorName: safeStr(item.actorName, 160, 'Sistema'),
    eventTimestampIso: safeStr(item.timestampIso, 40, new Date().toISOString()),
    read: Boolean(read),
    createdBy: safeStr(createdBy, 128),
  };

  if (item.amountLabel) {
    payload.amountLabel = safeStr(item.amountLabel, 80);
  }
  if (readAt) {
    payload.readAt = safeStr(readAt, 40);
  }

  return payload;
}

export function mergeFirestoreAndDerivedNotifications(params: {
  currentUserId: string;
  firestoreNotifications: UserNotificationRecord[];
  derivedItems: UnifiedNotificationItem[];
  localReadKeys?: Set<string>;
}): UnifiedNotificationItem[] {
  const { currentUserId, firestoreNotifications, derivedItems, localReadKeys } = params;

  // Strictly filter Firestore notifications by the current user's ID
  const userDocs = firestoreNotifications.filter((doc) => doc.userId === currentUserId);
  const bySourceKey = new Map<string, UserNotificationRecord>();
  const byDocId = new Map<string, UserNotificationRecord>();

  for (const doc of userDocs) {
    byDocId.set(doc.id, doc);
    if (doc.sourceEventKey) {
      bySourceKey.set(doc.sourceEventKey, doc);
    }
  }

  const matchedDocIds = new Set<string>();
  const merged: UnifiedNotificationItem[] = derivedItems.map((item) => {
    const expectedDocId = buildUserNotificationDocId(currentUserId, item.ackKey);
    const fsDoc = bySourceKey.get(item.ackKey) || byDocId.get(expectedDocId);
    if (fsDoc) {
      matchedDocIds.add(fsDoc.id);
    }
    const isReadInFirestore = fsDoc ? Boolean(fsDoc.read) : false;
    const isReadLocally = Boolean(
      localReadKeys?.has(item.ackKey) || localReadKeys?.has(expectedDocId)
    );
    return {
      ...item,
      firestoreNotificationId: fsDoc?.id || expectedDocId,
      isUnread: isReadInFirestore || isReadLocally ? false : item.isUnread,
    };
  });

  // Also include any standalone notifications in Firestore for this user that were created directly
  for (const doc of userDocs) {
    if (matchedDocIds.has(doc.id)) continue;
    const rawType = doc.type as NotificationAlertTypeCode;
    const validType: NotificationAlertTypeCode =
      rawType in NOTIFICATION_ALERT_TYPE_LABELS ? rawType : 'EVENTO_CRITICO_BITACORA';
    const cat: Exclude<NotificationCategory, 'ALL'> =
      doc.category === 'CREDITO' ||
      doc.category === 'COBRANZA' ||
      doc.category === 'RIESGO' ||
      doc.category === 'BITACORA'
        ? doc.category
        : 'BITACORA';
    const iso = toSortableIso(doc.eventTimestampIso || doc.createdAt);
    const isReadLocally = Boolean(
      localReadKeys?.has(doc.id) ||
        (doc.sourceEventKey && localReadKeys?.has(doc.sourceEventKey))
    );

    merged.push({
      ackKey: doc.sourceEventKey || doc.id,
      firestoreNotificationId: doc.id,
      alertType: validType,
      alertTypeLabel: NOTIFICATION_ALERT_TYPE_LABELS[validType] || doc.type,
      category: cat,
      priority: doc.priority || 'ALTA',
      title: doc.title,
      subtitle: `${doc.type} · ${doc.actorName || 'Sistema'}`,
      amountLabel: doc.amountLabel || undefined,
      detail: doc.message,
      timestampIso: iso,
      timestampDisplay: formatTimestamp(doc.eventTimestampIso || doc.createdAt),
      actorName: doc.actorName || 'Sistema',
      eventHistory: [
        {
          id: `fs_notif_${doc.id}`,
          source: 'AUDIT_LOG',
          sourceLabel: 'Notificación Firestore',
          eventCode: doc.type,
          description: doc.message,
          actor: doc.actorName || 'Sistema',
          timestampIso: iso,
          timestampDisplay: formatTimestamp(doc.eventTimestampIso || doc.createdAt),
        },
      ],
      isUnread: !doc.read && !isReadLocally,
      primaryLabel: 'Abrir Módulo',
      primarySection: (doc.targetSection as NavSectionId) || 'dashboard',
      applicationId: doc.entityType === 'applications' && doc.entityId ? doc.entityId : undefined,
      loanId: doc.entityType === 'loans' && doc.entityId ? doc.entityId : undefined,
    });
  }

  const priorityOrder: Record<UnifiedNotificationItem['priority'], number> = {
    INMEDIATA: 3,
    ALTA: 2,
    MEDIA: 1,
  };

  return merged.sort((a, b) => {
    if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
    const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (pDiff !== 0) return pDiff;
    return (b.timestampIso || '').localeCompare(a.timestampIso || '');
  });
}

export function computePendingNotificationsCount(
  items: Pick<UnifiedNotificationItem, 'isUnread'>[]
): number {
  return items.reduce((acc, item) => (item.isUnread ? acc + 1 : acc), 0);
}

export function applyMarkAsReadTransition(params: {
  firestoreNotifications: UserNotificationRecord[];
  currentUserId: string;
  organizationId: string;
  targetItem: UnifiedNotificationItem;
  readAtIso?: string;
}): {
  updatedFirestoreNotifications: UserNotificationRecord[];
  updatedDoc: UserNotificationRecord;
  existedInFirestore: boolean;
} {
  const {
    firestoreNotifications,
    currentUserId,
    organizationId,
    targetItem,
    readAtIso = new Date().toISOString(),
  } = params;

  const docId =
    targetItem.firestoreNotificationId ||
    buildUserNotificationDocId(currentUserId, targetItem.ackKey);

  const existingIndex = firestoreNotifications.findIndex(
    (d) =>
      d.userId === currentUserId &&
      (d.id === docId || (d.sourceEventKey && d.sourceEventKey === targetItem.ackKey))
  );

  if (existingIndex >= 0) {
    const existingDoc = firestoreNotifications[existingIndex];
    const updatedDoc: UserNotificationRecord = {
      ...existingDoc,
      read: true,
      readAt: readAtIso,
      updatedAt: readAtIso,
    };
    const updatedFirestoreNotifications = firestoreNotifications.map((d, idx) =>
      idx === existingIndex ? updatedDoc : d
    );
    return {
      updatedFirestoreNotifications,
      updatedDoc,
      existedInFirestore: true,
    };
  }

  const payload = buildUserNotificationPayload({
    userId: currentUserId,
    organizationId,
    createdBy: currentUserId,
    item: { ...targetItem, firestoreNotificationId: docId },
    read: true,
    readAt: readAtIso,
  });
  const createdDoc: UserNotificationRecord = {
    ...payload,
    createdAt: readAtIso,
    updatedAt: readAtIso,
  };

  return {
    updatedFirestoreNotifications: [...firestoreNotifications, createdDoc],
    updatedDoc: createdDoc,
    existedInFirestore: false,
  };
}

export type NotificationAlertIconKey =
  | 'gavel'
  | 'inbox'
  | 'clipboard-check'
  | 'rotate-ccw'
  | 'send'
  | 'handshake'
  | 'calendar-clock'
  | 'credit-card'
  | 'git-compare'
  | 'radar'
  | 'shield-alert';

export interface NotificationAlertVisualMeta {
  alertType: NotificationAlertTypeCode;
  label: string;
  shortTag: string;
  iconKey: NotificationAlertIconKey;
  surfaceHex: '#0B1220';
  accentHex: string;
  iconTextClass: string;
  iconContainerClass: string;
  badgeClass: string;
  unreadBorderClass: string;
  actionButtonClass: string;
}

export const NOTIFICATION_ALERT_VISUAL_META: Record<
  NotificationAlertTypeCode,
  NotificationAlertVisualMeta
> = {
  COMITE_PENDIENTE: {
    alertType: 'COMITE_PENDIENTE',
    label: NOTIFICATION_ALERT_TYPE_LABELS.COMITE_PENDIENTE,
    shortTag: 'COMITÉ',
    iconKey: 'gavel',
    surfaceHex: '#0B1220',
    accentHex: '#3B82F6',
    iconTextClass: 'text-[#60A5FA]',
    iconContainerClass:
      'bg-[#2563EB]/20 text-[#60A5FA] border border-[#3B82F6]/35 shadow-[0_0_16px_-4px_rgba(37,99,235,0.55)]',
    badgeClass: 'bg-[#2563EB]/20 text-[#93C5FD] border border-[#3B82F6]/35',
    unreadBorderClass: 'border-l-2 border-l-[#3B82F6]',
    actionButtonClass:
      'bg-[#2563EB] hover:bg-[#1D4ED8] text-white border border-[#3B82F6]/40 shadow-[0_4px_14px_-4px_rgba(37,99,235,0.65)]',
  },
  SOLICITUD_RECIBIDA: {
    alertType: 'SOLICITUD_RECIBIDA',
    label: NOTIFICATION_ALERT_TYPE_LABELS.SOLICITUD_RECIBIDA,
    shortTag: 'BANDEJA',
    iconKey: 'inbox',
    surfaceHex: '#0B1220',
    accentHex: '#0EA5E9',
    iconTextClass: 'text-sky-400',
    iconContainerClass:
      'bg-sky-500/20 text-sky-300 border border-sky-400/35 shadow-[0_0_16px_-4px_rgba(14,165,233,0.45)]',
    badgeClass: 'bg-sky-500/15 text-sky-300 border border-sky-400/30',
    unreadBorderClass: 'border-l-2 border-l-sky-400',
    actionButtonClass:
      'bg-sky-600 hover:bg-sky-500 text-white border border-sky-400/30',
  },
  EVALUACION_PENDIENTE: {
    alertType: 'EVALUACION_PENDIENTE',
    label: NOTIFICATION_ALERT_TYPE_LABELS.EVALUACION_PENDIENTE,
    shortTag: 'ANÁLISIS',
    iconKey: 'clipboard-check',
    surfaceHex: '#0B1220',
    accentHex: '#14B8A6',
    iconTextClass: 'text-[#14B8A6]',
    iconContainerClass:
      'bg-[#14B8A6]/20 text-[#2DD4BF] border border-[#14B8A6]/35 shadow-[0_0_16px_-4px_rgba(20,184,166,0.45)]',
    badgeClass: 'bg-[#14B8A6]/15 text-[#5EEAD4] border border-[#14B8A6]/35',
    unreadBorderClass: 'border-l-2 border-l-[#14B8A6]',
    actionButtonClass:
      'bg-[#0D9488] hover:bg-[#0F766E] text-white border border-[#14B8A6]/40',
  },
  EXPEDIENTE_DEVUELTO: {
    alertType: 'EXPEDIENTE_DEVUELTO',
    label: NOTIFICATION_ALERT_TYPE_LABELS.EXPEDIENTE_DEVUELTO,
    shortTag: 'DEVUELTO',
    iconKey: 'rotate-ccw',
    surfaceHex: '#0B1220',
    accentHex: '#F59E0B',
    iconTextClass: 'text-amber-400',
    iconContainerClass:
      'bg-amber-500/20 text-amber-300 border border-amber-400/35 shadow-[0_0_16px_-4px_rgba(245,158,11,0.45)]',
    badgeClass: 'bg-amber-500/15 text-amber-300 border border-amber-400/30',
    unreadBorderClass: 'border-l-2 border-l-amber-400',
    actionButtonClass:
      'bg-amber-600 hover:bg-amber-500 text-white border border-amber-400/30',
  },
  DESEMBOLSO_PENDIENTE: {
    alertType: 'DESEMBOLSO_PENDIENTE',
    label: NOTIFICATION_ALERT_TYPE_LABELS.DESEMBOLSO_PENDIENTE,
    shortTag: 'TESORERÍA',
    iconKey: 'send',
    surfaceHex: '#0B1220',
    accentHex: '#10B981',
    iconTextClass: 'text-emerald-400',
    iconContainerClass:
      'bg-emerald-500/20 text-emerald-300 border border-emerald-400/35 shadow-[0_0_16px_-4px_rgba(16,185,129,0.45)]',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30',
    unreadBorderClass: 'border-l-2 border-l-emerald-400',
    actionButtonClass:
      'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/30',
  },
  PROMESA_INCUMPLIDA: {
    alertType: 'PROMESA_INCUMPLIDA',
    label: NOTIFICATION_ALERT_TYPE_LABELS.PROMESA_INCUMPLIDA,
    shortTag: 'PROMESA ROTA',
    iconKey: 'handshake',
    surfaceHex: '#0B1220',
    accentHex: '#F43F5E',
    iconTextClass: 'text-rose-400',
    iconContainerClass:
      'bg-rose-500/20 text-rose-300 border border-rose-400/35 shadow-[0_0_16px_-4px_rgba(244,63,94,0.55)]',
    badgeClass: 'bg-rose-500/20 text-rose-300 border border-rose-400/35',
    unreadBorderClass: 'border-l-2 border-l-rose-500',
    actionButtonClass:
      'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400/35 shadow-[0_4px_14px_-4px_rgba(225,29,72,0.55)]',
  },
  VENCIMIENTO_HOY: {
    alertType: 'VENCIMIENTO_HOY',
    label: NOTIFICATION_ALERT_TYPE_LABELS.VENCIMIENTO_HOY,
    shortTag: 'VENCE HOY',
    iconKey: 'calendar-clock',
    surfaceHex: '#0B1220',
    accentHex: '#F97316',
    iconTextClass: 'text-orange-400',
    iconContainerClass:
      'bg-orange-500/20 text-orange-300 border border-orange-400/35 shadow-[0_0_16px_-4px_rgba(249,115,22,0.45)]',
    badgeClass: 'bg-orange-500/15 text-orange-300 border border-orange-400/30',
    unreadBorderClass: 'border-l-2 border-l-orange-400',
    actionButtonClass:
      'bg-orange-600 hover:bg-orange-500 text-white border border-orange-400/30',
  },
  PAGO_POR_VERIFICAR: {
    alertType: 'PAGO_POR_VERIFICAR',
    label: NOTIFICATION_ALERT_TYPE_LABELS.PAGO_POR_VERIFICAR,
    shortTag: 'RECAUDO',
    iconKey: 'credit-card',
    surfaceHex: '#0B1220',
    accentHex: '#14B8A6',
    iconTextClass: 'text-[#2DD4BF]',
    iconContainerClass:
      'bg-[#14B8A6]/20 text-[#2DD4BF] border border-[#14B8A6]/35 shadow-[0_0_16px_-4px_rgba(20,184,166,0.5)]',
    badgeClass: 'bg-[#14B8A6]/20 text-[#5EEAD4] border border-[#14B8A6]/35',
    unreadBorderClass: 'border-l-2 border-l-[#14B8A6]',
    actionButtonClass:
      'bg-[#0D9488] hover:bg-[#0F766E] text-white border border-[#14B8A6]/40',
  },
  EXCEPCION_CONCILIACION: {
    alertType: 'EXCEPCION_CONCILIACION',
    label: NOTIFICATION_ALERT_TYPE_LABELS.EXCEPCION_CONCILIACION,
    shortTag: 'CONCILIACIÓN',
    iconKey: 'git-compare',
    surfaceHex: '#0B1220',
    accentHex: '#38BDF8',
    iconTextClass: 'text-cyan-400',
    iconContainerClass:
      'bg-cyan-500/20 text-cyan-300 border border-cyan-400/35 shadow-[0_0_16px_-4px_rgba(56,189,248,0.45)]',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/30',
    unreadBorderClass: 'border-l-2 border-l-cyan-400',
    actionButtonClass:
      'bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400/30',
  },
  ALERTA_CENTINELA: {
    alertType: 'ALERTA_CENTINELA',
    label: NOTIFICATION_ALERT_TYPE_LABELS.ALERTA_CENTINELA,
    shortTag: 'CENTINELA IA',
    iconKey: 'radar',
    surfaceHex: '#0B1220',
    accentHex: '#6366F1',
    iconTextClass: 'text-indigo-400',
    iconContainerClass:
      'bg-indigo-500/20 text-indigo-300 border border-indigo-400/35 shadow-[0_0_16px_-4px_rgba(99,102,241,0.55)]',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/35',
    unreadBorderClass: 'border-l-2 border-l-indigo-400',
    actionButtonClass:
      'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/35',
  },
  EVENTO_CRITICO_BITACORA: {
    alertType: 'EVENTO_CRITICO_BITACORA',
    label: NOTIFICATION_ALERT_TYPE_LABELS.EVENTO_CRITICO_BITACORA,
    shortTag: 'BITÁCORA',
    iconKey: 'shield-alert',
    surfaceHex: '#0B1220',
    accentHex: '#2563EB',
    iconTextClass: 'text-[#60A5FA]',
    iconContainerClass:
      'bg-[#2563EB]/25 text-[#93C5FD] border border-[#3B82F6]/45 shadow-[0_0_16px_-4px_rgba(37,99,235,0.65)]',
    badgeClass: 'bg-[#2563EB]/20 text-[#93C5FD] border border-[#3B82F6]/40',
    unreadBorderClass: 'border-l-2 border-l-[#2563EB]',
    actionButtonClass:
      'bg-[#2563EB] hover:bg-[#1D4ED8] text-white border border-[#3B82F6]/40',
  },
};

export function getNotificationAlertVisualMeta(
  alertType: NotificationAlertTypeCode
): NotificationAlertVisualMeta {
  return (
    NOTIFICATION_ALERT_VISUAL_META[alertType] ??
    NOTIFICATION_ALERT_VISUAL_META.EVENTO_CRITICO_BITACORA
  );
}


