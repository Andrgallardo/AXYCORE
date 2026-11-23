import type {
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionDailySnapshotRecord,
  CollectionPolicyVersionRecord,
  CollectorTargetRecord,
  CurrencyCode,
  CustomerDisputeRecord,
  LoanInstallmentRecord,
  LoanRecord,
  MessageEventRecord,
  MessageTemplateRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  ReconciliationExceptionRecord,
  RiskAlertRecord,
  UserProfile,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  addCalendarDays,
  diffCalendarDays,
  evaluateLoanDelinquency,
  fromCents,
  getSantoDomingoHour,
  getSantoDomingoTodayIso,
  getSantoDomingoWeekday,
  toCents,
} from './delinquencyEngine';

// --- 1. AxyRecovery Bot Guardrails & Identity-Verified Simulator ---

export function evaluateBotDispatchEligibility(params: {
  account: CollectionAccountRecord;
  template: MessageTemplateRecord;
  messageEvents: MessageEventRecord[];
  disputes: CustomerDisputeRecord[];
  policy?: CollectionPolicyVersionRecord;
  referenceDate?: Date;
}): {
  eligible: boolean;
  deliveryStatusOnBlocked?: MessageEventRecord['deliveryStatus'];
  reason?: string;
} {
  const {
    account,
    template,
    messageEvents,
    disputes,
    policy = DEFAULT_COLLECTION_POLICY_V1,
    referenceDate = new Date(),
  } = params;

  if (!account.consentWhatsAppOptIn) {
    return {
      eligible: false,
      deliveryStatusOnBlocked: 'BLOQUEADO_OPT_OUT',
      reason: 'Cliente en opt-out / sin consentimiento activo para mensajería automatizada.',
    };
  }

  const openPause = disputes.find(
    (d) =>
      d.loanId === account.loanId &&
      ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status) &&
      d.pauseAutomatedMessages
  );
  if (openPause) {
    return {
      eligible: false,
      deliveryStatusOnBlocked: 'BLOQUEADO_RECLAMACION',
      reason: `Envío bloqueado por reclamación abierta (${openPause.disputeType}).`,
    };
  }

  if (template.approvalStatus !== 'APROBADA') {
    return {
      eligible: false,
      deliveryStatusOnBlocked: 'BLOQUEADO_FRECUENCIA',
      reason: 'Solo se pueden enviar plantillas con estado APROBADA.',
    };
  }

  const hour = getSantoDomingoHour(referenceDate);
  const weekday = getSantoDomingoWeekday(referenceDate);
  if (
    (!policy.allowedContactHours.allowSundays && weekday === 0) ||
    hour < policy.allowedContactHours.startHour ||
    hour >= policy.allowedContactHours.endHour
  ) {
    return {
      eligible: false,
      deliveryStatusOnBlocked: 'BLOQUEADO_HORARIO',
      reason: `Horario no permitido para bot (${policy.allowedContactHours.startHour}:00–${policy.allowedContactHours.endHour}:00).`,
    };
  }

  const todayIso = getSantoDomingoTodayIso(referenceDate);
  const weekStartIso = addCalendarDays(todayIso, -7);
  const weeklyCount = messageEvents.filter(
    (m) =>
      m.loanId === account.loanId &&
      m.direction === 'OUTBOUND' &&
      ['ENVIADO', 'SIMULADO_LOCAL', 'INTEGRACION_PENDIENTE'].includes(m.deliveryStatus) &&
      String(m.createdAt || todayIso).slice(0, 10) >= weekStartIso
  ).length;

  if (weeklyCount >= policy.maxWeeklyBotMessagesPerLoan) {
    return {
      eligible: false,
      deliveryStatusOnBlocked: 'BLOQUEADO_FRECUENCIA',
      reason: `Límite semanal de mensajes del bot alcanzado (${weeklyCount}/${policy.maxWeeklyBotMessagesPerLoan}).`,
    };
  }

  return { eligible: true };
}

export function renderBotTemplate(
  templateBody: string,
  account: CollectionAccountRecord
): string {
  return templateBody
    .replace(/\{\{cliente\}\}/g, account.applicantDisplayName)
    .replace(/\{\{prestamo\}\}/g, account.loanNumber)
    .replace(/\{\{moneda\}\}/g, account.currency)
    .replace(/\{\{cuota\}\}/g, (account.nextDueAmount || account.overdueTotalAmount).toFixed(2))
    .replace(/\{\{fecha_vencimiento\}\}/g, account.nextDueDate || 'inmediato')
    .replace(/\{\{dpd\}\}/g, String(account.dpd));
}

export interface BotInboundTurnResult {
  replyText: string;
  verifiedIdentity: boolean;
  detectedIntent:
    | 'SALDO'
    | 'PROMESA'
    | 'REPORTE_PAGO'
    | 'RECLAMO'
    | 'ESCALAR_ASESOR'
    | 'OPT_OUT'
    | 'VERIFICACION_PENDIENTE';
  shouldCreatePaymentIntent: boolean;
  shouldEscalateHuman: boolean;
  shouldOptOut: boolean;
}

export function processSafeBotConversationTurn(params: {
  inboundText: string;
  account: CollectionAccountRecord;
  customerDocumentLast4: string;
  identityAlreadyVerified: boolean;
}): BotInboundTurnResult {
  const { inboundText, account, customerDocumentLast4, identityAlreadyVerified } = params;
  const text = inboundText.trim();
  const lower = text.toLowerCase();

  if (lower.includes('stop') || lower.includes('no contactar') || lower.includes('baja')) {
    return {
      replyText:
        'Hemos registrado su solicitud de baja de mensajes automáticos (OPT-OUT). No recibirá más envíos automatizados por WhatsApp.',
      verifiedIdentity: identityAlreadyVerified,
      detectedIntent: 'OPT_OUT',
      shouldCreatePaymentIntent: false,
      shouldEscalateHuman: false,
      shouldOptOut: true,
    };
  }

  if (lower.includes('asesor') || lower.includes('humano') || lower.includes('reclamo') || lower.includes('error')) {
    return {
      replyText:
        'Su consulta ha sido escalada a un Gestor / Supervisor humano para atención personalizada sin compromiso de aplicación automática.',
      verifiedIdentity: identityAlreadyVerified,
      detectedIntent: lower.includes('reclamo') ? 'RECLAMO' : 'ESCALAR_ASESOR',
      shouldCreatePaymentIntent: false,
      shouldEscalateHuman: true,
      shouldOptOut: false,
    };
  }

  const providedDigits = text.replace(/\D/g, '');
  const matchedIdentity =
    identityAlreadyVerified ||
    (customerDocumentLast4.length >= 4 && providedDigits.endsWith(customerDocumentLast4));

  if (!matchedIdentity) {
    return {
      replyText:
        'Por seguridad (Ley 172-13), antes de mostrar saldos o detalles de su préstamo, por favor confirme los últimos 4 dígitos de su cédula o documento.',
      verifiedIdentity: false,
      detectedIntent: 'VERIFICACION_PENDIENTE',
      shouldCreatePaymentIntent: false,
      shouldEscalateHuman: false,
      shouldOptOut: false,
    };
  }

  if (
    lower.includes('comprobante') ||
    lower.includes('transferi') ||
    lower.includes('ya pague') ||
    lower.includes('pagué') ||
    lower.includes('ref')
  ) {
    return {
      replyText:
        `Gracias. Registramos su reporte de pago como PENDIENTE DE VERIFICACIÓN para el préstamo ${account.loanNumber}. Su saldo no se actualizará hasta que Finanzas/Conciliación Bancaria confirme el ingreso real.`,
      verifiedIdentity: true,
      detectedIntent: 'REPORTE_PAGO',
      shouldCreatePaymentIntent: true,
      shouldEscalateHuman: false,
      shouldOptOut: false,
    };
  }

  if (lower.includes('promesa') || lower.includes('pagar el') || lower.includes('acuerdo')) {
    return {
      replyText:
        `Recibimos su intención de compromiso de pago para ${account.loanNumber}. Un gestor validará la fecha y monto propuesto (tenga en cuenta que la promesa solo se cumple con pago confirmado y aplicado).`,
      verifiedIdentity: true,
      detectedIntent: 'PROMESA',
      shouldCreatePaymentIntent: false,
      shouldEscalateHuman: true,
      shouldOptOut: false,
    };
  }

  return {
    replyText: `Identidad verificada. Préstamo ${account.loanNumber} (${account.currency}): Saldo capital ${account.totalOutstandingPrincipal.toFixed(2)}, monto vencido ${account.overdueTotalAmount.toFixed(2)}, días de atraso ${account.dpd} DPD.`,
    verifiedIdentity: true,
    detectedIntent: 'SALDO',
    shouldCreatePaymentIntent: false,
    shouldEscalateHuman: false,
    shouldOptOut: false,
  };
}

// --- 2. Centinela: 13 Alert Rules ---

export function runSentinelAlertScan(params: {
  organizationId: string;
  accounts: CollectionAccountRecord[];
  installments: LoanInstallmentRecord[];
  promises: PaymentPromiseRecord[];
  payments: PaymentRecord[];
  disputes: CustomerDisputeRecord[];
  exceptions: ReconciliationExceptionRecord[];
  existingAlerts: RiskAlertRecord[];
  asOfDateIso?: string;
}): RiskAlertRecord[] {
  const {
    organizationId,
    accounts,
    installments,
    promises,
    payments,
    disputes,
    exceptions,
    existingAlerts,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const activeAlertKeys = new Set(
    existingAlerts
      .filter((a) => a.status === 'ACTIVA' || a.status === 'EN_REVISION')
      .map((a) => `${a.loanId}_${a.ruleCode}`)
  );

  const monthYm = asOfDateIso.slice(0, 7);
  const generated: RiskAlertRecord[] = [];

  const emit = (alert: Omit<RiskAlertRecord, 'id' | 'organizationId' | 'status'>) => {
    const dedupeKey = `${alert.loanId}_${alert.ruleCode}`;
    if (activeAlertKeys.has(dedupeKey)) return;
    activeAlertKeys.add(dedupeKey);
    const id = `alert_${alert.loanId}_${alert.ruleCode}_${monthYm}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    generated.push({
      id,
      organizationId,
      status: 'ACTIVA',
      ...alert,
    });
  };

  // Collector load map for rule 6
  const collectorOverdueCount = new Map<string, number>();
  let totalOverdueCount = 0;
  for (const acc of accounts) {
    if (acc.stage !== 'CANCELADO' && acc.dpd > 0) {
      totalOverdueCount += 1;
      if (acc.assignedCollectorId) {
        collectorOverdueCount.set(
          acc.assignedCollectorId,
          (collectorOverdueCount.get(acc.assignedCollectorId) ?? 0) + 1
        );
      }
    }
  }

  for (const acc of accounts) {
    if (acc.stage === 'CANCELADO') {
      continue;
    }

    const loanPromises = promises.filter((p) => p.loanId === acc.loanId);
    const broken = loanPromises.filter((p) => p.status === 'INCUMPLIDA').length;

    // 1. Promesas incumplidas reiteradas
    if (broken >= 2) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'PROMESAS_INCUMPLIDAS_REITERADAS',
        severity: 'CRITICA',
        title: `Promesas incumplidas reiteradas (${broken})`,
        description: 'Cliente acumula 2 o más promesas incumplidas. Requiere escalamiento a Supervisor o reestructuración.',
        metricValue: `${broken} incumplidas`,
      });
    }

    // 2. Mora temprana sin primer contacto
    if (acc.dpd >= 1 && acc.dpd <= 5 && !acc.lastActionAt) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'MORA_TEMPRANA_SIN_PRIMER_CONTACTO',
        severity: 'ALTA',
        title: 'Mora temprana sin primer contacto',
        description: `Préstamo con ${acc.dpd} DPD sin gestión de contacto registrada.`,
        metricValue: `${acc.dpd} DPD`,
      });
    }

    // 3. Desplazamiento de tramo de mora (Intermedia/Avanzada/Crítica)
    if (acc.dpd >= 16) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'DESPLAZAMIENTO_TRAMO_MORA',
        severity: acc.dpd >= 61 ? 'CRITICA' : 'ALTA',
        title: `Desplazamiento a etapa ${acc.stage}`,
        description: `Cuenta avanzó al tramo ${acc.bucket} con ${acc.dpd} días de atraso.`,
        metricValue: `${acc.dpd} DPD (${acc.stage})`,
      });
    }

    // 4. Cuenta crítica sin seguimiento reciente
    if (acc.dpd >= 31) {
      const daysSinceAction = acc.lastActionAt
        ? diffCalendarDays(acc.lastActionAt.slice(0, 10), asOfDateIso)
        : 99;
      if (daysSinceAction >= 3) {
        emit({
          loanId: acc.loanId,
          loanNumber: acc.loanNumber,
          customerId: acc.customerId,
          customerName: acc.applicantDisplayName,
          ruleCode: 'CUENTA_CRITICA_SIN_SEGUIMIENTO',
          severity: 'CRITICA',
          title: 'Cuenta avanzada/crítica sin seguimiento reciente',
          description: `Más de ${daysSinceAction} días sin gestión registrada en mora severa.`,
          metricValue: `${daysSinceAction}d sin gestión`,
        });
      }
    }

    // 5. Pagos reportados no confirmados
    const pendingPayments = payments.filter(
      (p) =>
        p.loanId === acc.loanId &&
        ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION'].includes(p.status)
    );
    const stalePending = pendingPayments.find(
      (p) => diffCalendarDays(p.paymentDate, asOfDateIso) >= 2
    );
    if (stalePending) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'PAGOS_REPORTADOS_NO_CONFIRMADOS',
        severity: 'ALTA',
        title: 'Pago reportado pendiente de verificación prolongada',
        description: `Pago ${stalePending.referenceNumber} (${stalePending.currency} ${stalePending.amount.toFixed(2)}) sin conciliar desde ${stalePending.paymentDate}.`,
        metricValue: `${stalePending.currency} ${stalePending.amount.toFixed(2)}`,
      });
    }

    // 6. Concentración de carga en gestor
    if (
      acc.assignedCollectorId &&
      totalOverdueCount >= 4 &&
      (collectorOverdueCount.get(acc.assignedCollectorId) ?? 0) / totalOverdueCount > 0.5
    ) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'CONCENTRACION_GESTOR_CARGA',
        severity: 'MEDIA',
        title: 'Sobrecarga de cartera vencida en gestor asignado',
        description: `El gestor ${acc.assignedCollectorName || acc.assignedCollectorId} concentra >50% de las cuentas vencidas.`,
        metricValue: `${collectorOverdueCount.get(acc.assignedCollectorId)} cuentas`,
      });
    }

    // 7. Reincidencia histórica
    if (acc.maxHistoricalDpd >= 15 && acc.dpd >= 1 && acc.dpd < acc.maxHistoricalDpd) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'REINCIDENCIA_HISTORICA',
        severity: 'MEDIA',
        title: 'Cliente reincidente en atraso',
        description: `Histórico previo de hasta ${acc.maxHistoricalDpd} DPD y presenta nuevo atraso (${acc.dpd} DPD).`,
        metricValue: `Máx ${acc.maxHistoricalDpd} DPD`,
      });
    }

    // 8. Acumulación de pagos parciales
    const partialCount = installments.filter(
      (i) => i.loanId === acc.loanId && i.status === 'PARCIAL'
    ).length;
    if (partialCount >= 2) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'ACUMULACION_PAGOS_PARCIALES',
        severity: 'MEDIA',
        title: 'Acumulación de cuotas con pagos parciales',
        description: `Registra ${partialCount} cuotas en estado PARCIAL sin completar saldo de cuota.`,
        metricValue: `${partialCount} parciales`,
      });
    }

    // 9. Concentración de vencimientos próximos (7 días con mora previa)
    if (
      acc.nextDueDate &&
      diffCalendarDays(asOfDateIso, acc.nextDueDate) >= 0 &&
      diffCalendarDays(asOfDateIso, acc.nextDueDate) <= 7 &&
      acc.maxHistoricalDpd >= 5
    ) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'CONCENTRACION_VENCIMIENTOS_PROXIMOS',
        severity: 'BAJA',
        title: 'Vencimiento próximo en cliente sensible',
        description: `Cuota próxima vence el ${acc.nextDueDate} con antecedente de atraso.`,
        metricValue: acc.nextDueDate,
      });
    }

    // 10. Reclamación abierta urgente
    const openDispute = disputes.find(
      (d) =>
        d.loanId === acc.loanId &&
        ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status)
    );
    if (openDispute) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'RECLAMACION_ABIERTA_URGENTE',
        severity: 'ALTA',
        title: `Reclamación abierta (${openDispute.disputeType})`,
        description: openDispute.description,
        metricValue: openDispute.status,
      });
    }

    // 11. Saldo cero sin cierre formal
    if (toCents(acc.totalOutstandingPrincipal) === 0) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'SALDO_CERO_SIN_CIERRE',
        severity: 'BAJA',
        title: 'Saldo en cero pendiente de cierre/cancelación formal',
        description: 'Préstamo con capital pendiente RD$/US$ 0.00 listo para revisión y emisión de certificado de cierre.',
        metricValue: 'Saldo 0.00',
      });
    }

    // 12. Posible pago duplicado
    const loanPays = payments.filter((p) => p.loanId === acc.loanId && p.status !== 'REVERTIDO' && p.status !== 'RECHAZADO');
    const paySigSet = new Set<string>();
    let duplicateSig: string | null = null;
    for (const p of loanPays) {
      const sig = `${p.paymentDate}_${toCents(p.amount)}_${p.currency}`;
      if (paySigSet.has(sig)) {
        duplicateSig = `${p.currency} ${p.amount.toFixed(2)} (${p.paymentDate})`;
        break;
      }
      paySigSet.add(sig);
    }
    if (duplicateSig) {
      emit({
        loanId: acc.loanId,
        loanNumber: acc.loanNumber,
        customerId: acc.customerId,
        customerName: acc.applicantDisplayName,
        ruleCode: 'POSIBLE_PAGO_DUPLICADO',
        severity: 'ALTA',
        title: 'Posible pago duplicado detectado',
        description: `Existen dos registros con mismo monto y fecha: ${duplicateSig}.`,
        metricValue: duplicateSig,
      });
    }
  }

  // 13. Excepciones de conciliación abiertas
  for (const exc of exceptions) {
    if (exc.status !== 'ABIERTA') continue;
    const acc = exc.loanId ? accounts.find((a) => a.loanId === exc.loanId) : undefined;
    const loanId = acc?.loanId || 'unassigned_bank_exc';
    emit({
      loanId,
      loanNumber: acc?.loanNumber || 'BANCOS',
      customerId: acc?.customerId || 'sin_cliente',
      customerName: acc?.applicantDisplayName || 'Conciliación Bancaria',
      ruleCode: 'EXCEPCION_CONCILIACION_ANTIGUA',
      severity: 'ALTA',
      title: `Excepción de conciliación abierta (${exc.exceptionType})`,
      description: exc.detail,
      metricValue: exc.exceptionType,
    });
  }

  return generated;
}

// --- 3. Portfolio Auto-Assignment Engine ---

export interface AutoAssignmentSuggestion {
  loanId: string;
  loanNumber: string;
  previousCollectorId?: string | null;
  previousCollectorName?: string | null;
  newCollectorId: string;
  newCollectorName: string;
  reason: string;
}

export function buildAutoAssignmentPlan(params: {
  accounts: CollectionAccountRecord[];
  collectors: UserProfile[];
  targets?: CollectorTargetRecord[];
  onlyUnassigned?: boolean;
}): AutoAssignmentSuggestion[] {
  const { accounts, collectors, targets = [], onlyUnassigned = true } = params;

  const eligibleCollectors = collectors.filter(
    (u) => u.status === 'ACTIVE' && ['COLLECTION_AGENT', 'SUPERVISOR'].includes(u.role)
  );
  if (eligibleCollectors.length === 0) return [];

  const loadByCollector = new Map<string, number>();
  eligibleCollectors.forEach((c) => loadByCollector.set(c.uid, 0));

  for (const acc of accounts) {
    if (acc.stage !== 'CANCELADO' && acc.assignedCollectorId && loadByCollector.has(acc.assignedCollectorId)) {
      loadByCollector.set(
        acc.assignedCollectorId,
        (loadByCollector.get(acc.assignedCollectorId) ?? 0) + 1
      );
    }
  }

  const maxCapByCollector = new Map<string, number>();
  eligibleCollectors.forEach((c) => {
    const target = targets.find((t) => t.userId === c.uid && t.active);
    maxCapByCollector.set(c.uid, target?.maxCasesLimit ?? 9999);
  });

  const candidates = accounts
    .filter((a) => a.stage !== 'CANCELADO' && (!onlyUnassigned || !a.assignedCollectorId))
    .sort((a, b) => b.dpd - a.dpd || b.overdueTotalAmount - a.overdueTotalAmount);

  const plan: AutoAssignmentSuggestion[] = [];
  for (const acc of candidates) {
    const sortedCollectors = [...eligibleCollectors]
      .filter((c) => (loadByCollector.get(c.uid) ?? 0) < (maxCapByCollector.get(c.uid) ?? 9999))
      .sort((a, b) => (loadByCollector.get(a.uid) ?? 0) - (loadByCollector.get(b.uid) ?? 0));

    const chosen = sortedCollectors[0] ?? eligibleCollectors[0];
    if (chosen.uid === acc.assignedCollectorId) continue;

    loadByCollector.set(chosen.uid, (loadByCollector.get(chosen.uid) ?? 0) + 1);
    plan.push({
      loanId: acc.loanId,
      loanNumber: acc.loanNumber,
      previousCollectorId: acc.assignedCollectorId ?? null,
      previousCollectorName: acc.assignedCollectorName ?? null,
      newCollectorId: chosen.uid,
      newCollectorName: chosen.displayName,
      reason: `Balanceo equitativo automático (tramo ${acc.stage} · ${acc.currency})`,
    });
  }

  return plan;
}

// --- 4. Contact Center KPIs ---

export interface ContactCenterKpis {
  totalActions: number;
  effectiveContacts: number;
  contactabilityPct: number;
  promisesEvaluatedCount: number;
  promisesFulfilledCount: number;
  promiseFulfillmentPct: number;
  recoveredAppliedDop: number;
  recoveredAppliedUsd: number;
  pendingVerificationDop: number;
  pendingVerificationUsd: number;
  overdueAccountsWithoutAction: number;
  collectorBreakdown: Array<{
    collectorId: string;
    collectorName: string;
    assignedAccounts: number;
    actionsCount: number;
    effectiveContactsCount: number;
    promisesCount: number;
    promisesFulfilledCount: number;
    recoveredAppliedDop: number;
    recoveredAppliedUsd: number;
  }>;
}

const EFFECTIVE_CONTACT_RESULTS = new Set([
  'CONTACTO_EFECTIVO_PROMESA',
  'CONTACTO_SIN_ACUERDO',
  'SOLICITA_REESTRUCTURACION',
  'RECLAMACION_CLIENTE',
  'COMPROMISO_PAGO_VERIFICADO',
]);

export function computeContactCenterKpis(params: {
  accounts: CollectionAccountRecord[];
  actions: CollectionActionRecord[];
  promises: PaymentPromiseRecord[];
  payments: PaymentRecord[];
}): ContactCenterKpis {
  const { accounts, actions, promises, payments } = params;

  const totalActions = actions.length;
  const effectiveContacts = actions.filter((a) =>
    EFFECTIVE_CONTACT_RESULTS.has(a.contactResult)
  ).length;
  const contactabilityPct =
    totalActions > 0 ? Math.round((effectiveContacts / totalActions) * 1000) / 10 : 0;

  const evaluatedPromises = promises.filter((p) =>
    ['CUMPLIDA', 'CUMPLIDA_PARCIAL', 'INCUMPLIDA'].includes(p.status)
  );
  const fulfilledPromises = evaluatedPromises.filter((p) => p.status === 'CUMPLIDA');
  const promiseFulfillmentPct =
    evaluatedPromises.length > 0
      ? Math.round((fulfilledPromises.length / evaluatedPromises.length) * 1000) / 10
      : 0;

  // Strictly only APLICADO payments count as recovered money!
  const recoveredAppliedDop = fromCents(
    payments
      .filter((p) => p.status === 'APLICADO' && p.currency === 'DOP')
      .reduce((s, p) => s + toCents(p.amount), 0)
  );
  const recoveredAppliedUsd = fromCents(
    payments
      .filter((p) => p.status === 'APLICADO' && p.currency === 'USD')
      .reduce((s, p) => s + toCents(p.amount), 0)
  );

  const pendingVerificationDop = fromCents(
    payments
      .filter(
        (p) =>
          ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status) &&
          p.currency === 'DOP'
      )
      .reduce((s, p) => s + toCents(p.amount), 0)
  );
  const pendingVerificationUsd = fromCents(
    payments
      .filter(
        (p) =>
          ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status) &&
          p.currency === 'USD'
      )
      .reduce((s, p) => s + toCents(p.amount), 0)
  );

  const overdueAccountsWithoutAction = accounts.filter(
    (a) => a.stage !== 'CANCELADO' && a.dpd > 0 && !a.lastActionAt
  ).length;

  const byCollector = new Map<
    string,
    {
      collectorId: string;
      collectorName: string;
      assignedAccounts: number;
      actionsCount: number;
      effectiveContactsCount: number;
      promisesCount: number;
      promisesFulfilledCount: number;
      recoveredDopCents: number;
      recoveredUsdCents: number;
    }
  >();

  const touch = (id: string, name: string) => {
    let row = byCollector.get(id);
    if (!row) {
      row = {
        collectorId: id,
        collectorName: name || id,
        assignedAccounts: 0,
        actionsCount: 0,
        effectiveContactsCount: 0,
        promisesCount: 0,
        promisesFulfilledCount: 0,
        recoveredDopCents: 0,
        recoveredUsdCents: 0,
      };
      byCollector.set(id, row);
    }
    return row;
  };

  const collectorByLoan = new Map<string, { id: string; name: string }>();
  for (const acc of accounts) {
    if (acc.assignedCollectorId) {
      collectorByLoan.set(acc.loanId, {
        id: acc.assignedCollectorId,
        name: acc.assignedCollectorName || acc.assignedCollectorId,
      });
      if (acc.stage !== 'CANCELADO') {
        touch(acc.assignedCollectorId, acc.assignedCollectorName || acc.assignedCollectorId).assignedAccounts += 1;
      }
    }
  }

  for (const act of actions) {
    const row = touch(act.collectorId, act.collectorName);
    row.actionsCount += 1;
    if (EFFECTIVE_CONTACT_RESULTS.has(act.contactResult)) {
      row.effectiveContactsCount += 1;
    }
  }

  for (const prom of promises) {
    const row = touch(prom.createdByUserId, prom.createdByUserName);
    row.promisesCount += 1;
    if (prom.status === 'CUMPLIDA') {
      row.promisesFulfilledCount += 1;
    }
  }

  for (const pay of payments) {
    if (pay.status !== 'APLICADO') continue;
    const owner = collectorByLoan.get(pay.loanId);
    if (!owner) continue;
    const row = touch(owner.id, owner.name);
    if (pay.currency === 'DOP') row.recoveredDopCents += toCents(pay.amount);
    else row.recoveredUsdCents += toCents(pay.amount);
  }

  return {
    totalActions,
    effectiveContacts,
    contactabilityPct,
    promisesEvaluatedCount: evaluatedPromises.length,
    promisesFulfilledCount: fulfilledPromises.length,
    promiseFulfillmentPct,
    recoveredAppliedDop,
    recoveredAppliedUsd,
    pendingVerificationDop,
    pendingVerificationUsd,
    overdueAccountsWithoutAction,
    collectorBreakdown: Array.from(byCollector.values()).map((r) => ({
      collectorId: r.collectorId,
      collectorName: r.collectorName,
      assignedAccounts: r.assignedAccounts,
      actionsCount: r.actionsCount,
      effectiveContactsCount: r.effectiveContactsCount,
      promisesCount: r.promisesCount,
      promisesFulfilledCount: r.promisesFulfilledCount,
      recoveredAppliedDop: fromCents(r.recoveredDopCents),
      recoveredAppliedUsd: fromCents(r.recoveredUsdCents),
    })),
  };
}

// --- 5. PAR 1 / 30 / 60 / 90 & Reproducible Historical Cutoff ---

export interface CurrencyPortfolioParMetrics {
  currency: CurrencyCode;
  activeLoansCount: number;
  overdueLoansCount: number;
  totalOutstandingPrincipal: number;
  overdueInstallmentsAmount: number;
  exposurePar1: number;
  exposurePar30: number;
  exposurePar60: number;
  exposurePar90: number;
  par1Pct: number;
  par30Pct: number;
  par60Pct: number;
  par90Pct: number;
  buckets: Record<string, { count: number; principalBalance: number; overdueAmount: number }>;
}

export function computeParAndPortfolioMetrics(
  accounts: CollectionAccountRecord[]
): { DOP: CurrencyPortfolioParMetrics; USD: CurrencyPortfolioParMetrics } {
  const computeForCurrency = (currency: CurrencyCode): CurrencyPortfolioParMetrics => {
    const items = accounts.filter(
      (a) => a.currency === currency && a.stage !== 'CANCELADO'
    );
    let totalPrincipalCents = 0;
    let overdueAmountCents = 0;
    let par1Cents = 0;
    let par30Cents = 0;
    let par60Cents = 0;
    let par90Cents = 0;
    let overdueCount = 0;

    const buckets: Record<string, { count: number; principalCents: number; overdueCents: number }> = {
      AL_DIA: { count: 0, principalCents: 0, overdueCents: 0 },
      '1_5': { count: 0, principalCents: 0, overdueCents: 0 },
      '6_15': { count: 0, principalCents: 0, overdueCents: 0 },
      '16_30': { count: 0, principalCents: 0, overdueCents: 0 },
      '31_60': { count: 0, principalCents: 0, overdueCents: 0 },
      '61_90': { count: 0, principalCents: 0, overdueCents: 0 },
      '90_MAS': { count: 0, principalCents: 0, overdueCents: 0 },
    };

    for (const acc of items) {
      const pCents = toCents(acc.totalOutstandingPrincipal);
      const oCents = toCents(acc.overdueTotalAmount);
      totalPrincipalCents += pCents;
      overdueAmountCents += oCents;

      if (acc.dpd >= 1) {
        overdueCount += 1;
        par1Cents += pCents;
      }
      if (acc.dpd >= 30) par30Cents += pCents;
      if (acc.dpd >= 60) par60Cents += pCents;
      if (acc.dpd >= 90) par90Cents += pCents;

      const b = buckets[acc.bucket] ?? buckets.AL_DIA;
      b.count += 1;
      b.principalCents += pCents;
      b.overdueCents += oCents;
    }

    const pct = (num: number, den: number) =>
      den > 0 ? Math.round((num / den) * 10000) / 100 : 0;

    return {
      currency,
      activeLoansCount: items.length,
      overdueLoansCount: overdueCount,
      totalOutstandingPrincipal: fromCents(totalPrincipalCents),
      overdueInstallmentsAmount: fromCents(overdueAmountCents),
      exposurePar1: fromCents(par1Cents),
      exposurePar30: fromCents(par30Cents),
      exposurePar60: fromCents(par60Cents),
      exposurePar90: fromCents(par90Cents),
      par1Pct: pct(par1Cents, totalPrincipalCents),
      par30Pct: pct(par30Cents, totalPrincipalCents),
      par60Pct: pct(par60Cents, totalPrincipalCents),
      par90Pct: pct(par90Cents, totalPrincipalCents),
      buckets: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [
          k,
          {
            count: v.count,
            principalBalance: fromCents(v.principalCents),
            overdueAmount: fromCents(v.overdueCents),
          },
        ])
      ),
    };
  };

  return {
    DOP: computeForCurrency('DOP'),
    USD: computeForCurrency('USD'),
  };
}

export function reconstructAccountsAtCutoffDate(params: {
  loans: LoanRecord[];
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  cutoffDateIso: string;
  policy?: CollectionPolicyVersionRecord;
}): CollectionAccountRecord[] {
  const {
    loans,
    installments,
    payments,
    cutoffDateIso,
    policy = DEFAULT_COLLECTION_POLICY_V1,
  } = params;

  const eligibleLoans = loans.filter((l) => l.disbursementDate <= cutoffDateIso);
  return eligibleLoans.map((loan) => {
    const loanInsts = installments.filter((i) => i.loanId === loan.id);
    const paymentsUntilCutoff = payments.filter(
      (p) => p.loanId === loan.id && p.status === 'APLICADO' && p.paymentDate <= cutoffDateIso
    );
    // Approximate principal paid up to cutoff from current or applied payments if reconstructing
    const evaluated = evaluateLoanDelinquency({
      loan,
      installments: loanInsts,
      policy,
      asOfDateIso: cutoffDateIso,
      payments: paymentsUntilCutoff,
    });
    return evaluated.account;
  });
}

export function buildReproducibleDailySnapshot(params: {
  organizationId: string;
  accounts: CollectionAccountRecord[];
  cutoffDateIso: string;
  policyVersion: string;
  createdBy: string;
}): CollectionDailySnapshotRecord {
  const par = computeParAndPortfolioMetrics(params.accounts);
  return {
    id: `snap_${params.organizationId}_${params.cutoffDateIso}`,
    organizationId: params.organizationId,
    cutoffDate: params.cutoffDateIso,
    policyVersion: params.policyVersion,
    totalActiveLoans: par.DOP.activeLoansCount + par.USD.activeLoansCount,
    overdueLoansCount: par.DOP.overdueLoansCount + par.USD.overdueLoansCount,
    principalBalanceDop: par.DOP.totalOutstandingPrincipal,
    principalBalanceUsd: par.USD.totalOutstandingPrincipal,
    par1Dop: par.DOP.par1Pct,
    par30Dop: par.DOP.par30Pct,
    par60Dop: par.DOP.par60Pct,
    par90Dop: par.DOP.par90Pct,
    par1Usd: par.USD.par1Pct,
    par30Usd: par.USD.par30Pct,
    par60Usd: par.USD.par60Pct,
    par90Usd: par.USD.par90Pct,
    overdueAmountDop: par.DOP.overdueInstallmentsAmount,
    overdueAmountUsd: par.USD.overdueInstallmentsAmount,
    createdBy: params.createdBy,
  };
}

// --- 6. Anticípate 30 / 60 / 90 Projections ---

export interface HorizonProjection {
  horizonDays: 30 | 60 | 90;
  scheduledDueDop: number;
  scheduledDueUsd: number;
  expectedBaseDop: number;
  expectedBaseUsd: number;
  expectedStressDop: number;
  expectedStressUsd: number;
  installmentsCount: number;
}

export function buildAnticipateProjections(params: {
  loans: LoanRecord[];
  installments: LoanInstallmentRecord[];
  accounts: CollectionAccountRecord[];
  asOfDateIso?: string;
}): HorizonProjection[] {
  const { loans, installments, accounts, asOfDateIso = getSantoDomingoTodayIso() } = params;
  const loanMap = new Map(loans.map((l) => [l.id, l]));
  const par = computeParAndPortfolioMetrics(accounts);

  // Base collection factor reflects current portfolio health; stress adds +12% haircut
  const baseFactorDop = Math.max(0.55, 1 - par.DOP.par30Pct / 100);
  const baseFactorUsd = Math.max(0.55, 1 - par.USD.par30Pct / 100);

  return ([30, 60, 90] as const).map((horizonDays) => {
    const endIso = addCalendarDays(asOfDateIso, horizonDays);
    let dopCents = 0;
    let usdCents = 0;
    let count = 0;

    for (const inst of installments) {
      if (inst.status === 'PAGADA') continue;
      if (inst.dueDate < asOfDateIso || inst.dueDate > endIso) continue;
      const loan = loanMap.get(inst.loanId);
      if (!loan || loan.status === 'CANCELADO' || loan.status === 'CANCELADO_POR_RENOVACION') continue;

      const remCents = Math.max(
        0,
        toCents(inst.principalAmount) -
          toCents(inst.paidPrincipal ?? 0) +
          (toCents(inst.interestAmount) - toCents(inst.paidInterest ?? 0)) +
          (toCents(inst.otherCharges) - toCents(inst.paidOtherCharges ?? 0))
      );
      if (remCents <= 0) continue;
      count += 1;
      if (loan.currency === 'DOP') dopCents += remCents;
      else usdCents += remCents;
    }

    const scheduledDueDop = fromCents(dopCents);
    const scheduledDueUsd = fromCents(usdCents);

    return {
      horizonDays,
      scheduledDueDop,
      scheduledDueUsd,
      expectedBaseDop: fromCents(Math.round(dopCents * baseFactorDop)),
      expectedBaseUsd: fromCents(Math.round(usdCents * baseFactorUsd)),
      expectedStressDop: fromCents(Math.round(dopCents * Math.max(0.4, baseFactorDop - 0.15))),
      expectedStressUsd: fromCents(Math.round(usdCents * Math.max(0.4, baseFactorUsd - 0.15))),
      installmentsCount: count,
    };
  });
}

// --- 7. Formal Loan Closure / Cancellation Validation ---

export function validateLoanCancellationEligibility(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  disputes: CustomerDisputeRecord[];
  exceptions: ReconciliationExceptionRecord[];
}): { allowed: boolean; reasons: string[]; certificateNumber: string } {
  const { loan, installments, payments, disputes, exceptions } = params;
  const reasons: string[] = [];

  if (loan.status === 'CANCELADO' || loan.status === 'CANCELADO_POR_RENOVACION') {
    reasons.push('El préstamo ya fue cancelado formalmente.');
  }
  if (toCents(loan.currentPrincipalBalance) > 0) {
    reasons.push(
      `Mantiene saldo de capital pendiente (${loan.currency} ${loan.currentPrincipalBalance.toFixed(2)}).`
    );
  }
  const openInsts = installments.filter((i) => i.loanId === loan.id && i.status !== 'PAGADA');
  if (openInsts.length > 0) {
    reasons.push(`Tiene ${openInsts.length} cuota(s) no pagada(s) o parciales.`);
  }
  const pendingPays = payments.filter(
    (p) =>
      p.loanId === loan.id &&
      ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
  );
  if (pendingPays.length > 0) {
    reasons.push(`Existen ${pendingPays.length} pago(s) pendientes de verificación/aplicación.`);
  }
  const openDisputes = disputes.filter(
    (d) => d.loanId === loan.id && ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status)
  );
  if (openDisputes.length > 0) {
    reasons.push(`Existen ${openDisputes.length} reclamación(es) abierta(s).`);
  }
  const openExceptions = exceptions.filter(
    (e) => e.loanId === loan.id && e.status === 'ABIERTA'
  );
  if (openExceptions.length > 0) {
    reasons.push(`Existen ${openExceptions.length} excepción(es) de conciliación abierta(s).`);
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    certificateNumber: `CERT-CIERRE-${loan.loanNumber.replace(/^PRE-/, '')}`,
  };
}
