import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret } from 'firebase-functions/params';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import nodemailer from 'nodemailer';
import { renderStatusEmail, type CustomerEmailEventCode } from './emailTemplates';
import { buildInboxPushPayload, shouldTriggerInboxPush } from './pushTemplates';

const DATABASE_ID = 'ai-studio-9b309ae7-68ea-4ea1-9929-9d3c75b385ee';

const smtpHostSecret = defineSecret('SMTP_HOST');
const smtpPortSecret = defineSecret('SMTP_PORT');
const smtpUserSecret = defineSecret('SMTP_USER');
const smtpPassSecret = defineSecret('SMTP_PASS');
const smtpFromSecret = defineSecret('SMTP_FROM');

const adminApp = initializeApp();
const db = getFirestore(adminApp, DATABASE_ID);

const STATUS_TO_EVENT_CODE: Record<string, CustomerEmailEventCode | undefined> = {
  RECIBIDA: 'RECIBIDA',
  EN_EVALUACION: 'EN_EVALUACION',
  DEVUELTA: 'DEVUELTA',
  EN_COMITE: 'EN_COMITE',
  APROBADA: 'APROBADA',
  APROBADA_CONDICIONADA: 'APROBADA_CONDICIONADA',
  RECHAZADA: 'RECHAZADA',
  FORMALIZADA: 'FORMALIZADA',
  DESEMBOLSADA: 'DESEMBOLSADA',
};

function getSmtpConfig() {
  const host = smtpHostSecret.value()?.trim();
  const user = smtpUserSecret.value()?.trim();
  const pass = smtpPassSecret.value()?.trim();
  const port = Number(smtpPortSecret.value() || 587);
  const from = smtpFromSecret.value()?.trim() || user || 'notificaciones@axycore.local';
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from };
}

async function dispatchViaSmtp(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ sent: boolean; messageId?: string; reason?: string }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    return {
      sent: false,
      reason: 'Secretos SMTP_HOST / SMTP_USER / SMTP_PASS no configurados en Cloud Functions.',
    };
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  const info = await transporter.sendMail({
    from: cfg.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
  return { sent: true, messageId: info.messageId };
}

/**
 * Trigger 1: Se dispara automáticamente cuando cambia el estado de una solicitud en `applications/{applicationId}`.
 * Detecta transiciones como RECIBIDA, EN_EVALUACION, DEVUELTA, EN_COMITE, APROBADA, APROBADA_CONDICIONADA,
 * RECHAZADA, FORMALIZADA y DESEMBOLSADA.
 */
export const onApplicationStatusChanged = onDocumentUpdated(
  {
    document: 'applications/{applicationId}',
    database: DATABASE_ID,
    region: 'us-east1',
    secrets: [smtpHostSecret, smtpPortSecret, smtpUserSecret, smtpPassSecret, smtpFromSecret],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    if (before.status === after.status) return;
    const eventCode = STATUS_TO_EVENT_CODE[String(after.status)];
    if (!eventCode) return;

    const applicationId = event.params.applicationId;
    const historyLen = Array.isArray(after.movementHistory) ? after.movementHistory.length : 0;
    const idempotencyKey = `${applicationId}_${eventCode}_h${historyLen}`;

    // Evitar duplicados si el outbox ya fue creado en la transacción o procesado previamente
    const existingSnap = await db
      .collection('email_notifications')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      logger.info('Notificación ya registrada en outbox para transición', { applicationId, eventCode });
      return;
    }

    const customerSnap = await db.collection('customers').doc(String(after.customerId)).get();
    const customer = customerSnap.data();
    const orgSnap = await db.collection('organizations').doc(String(after.organizationId)).get();
    const orgName = String(orgSnap.data()?.name || 'AxyCore Servicios Financieros');

    const recipientEmail = String(customer?.email || '').trim();
    const recipientName = customer
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || String(after.applicantDisplayName)
      : String(after.applicantDisplayName || 'Cliente');

    // Buscar decisión de comité más reciente si aplica (aprobado / condicionado / rechazado)
    let approvedAmount = after.recommendedAmount ?? after.requestedAmount;
    let approvedRateMonthly = after.recommendedRateMonthly ?? null;
    let approvedTermMonths = after.recommendedTermMonths ?? after.requestedTermMonths;
    let conditions: string[] = [];
    let rejectionReason: string | null = null;

    if (['APROBADA', 'APROBADA_CONDICIONADA', 'RECHAZADA'].includes(eventCode)) {
      const decSnap = await db
        .collection('committee_decisions')
        .where('applicationId', '==', applicationId)
        .limit(1)
        .get();
      if (!decSnap.empty) {
        const dec = decSnap.docs[0].data();
        if (dec.approvedAmount != null) approvedAmount = dec.approvedAmount;
        if (dec.approvedRateMonthly != null) approvedRateMonthly = dec.approvedRateMonthly;
        if (dec.approvedTermMonths != null) approvedTermMonths = dec.approvedTermMonths;
        if (Array.isArray(dec.conditions)) {
          conditions = dec.conditions.map((c: { text?: string }) => String(c.text || '')).filter(Boolean);
        }
        if (dec.rejectionReason) rejectionReason = String(dec.rejectionReason);
      }
    }

    const rendered = renderStatusEmail({
      eventCode,
      recipientName,
      organizationName: orgName,
      applicationNumber: String(after.applicationNumber),
      fileNumber: String(after.fileNumber),
      productCode: String(after.productCode),
      currency: String(after.currency),
      amount: Number(approvedAmount || 0),
      termMonths: Number(approvedTermMonths || 0),
      rateMonthly: approvedRateMonthly,
      conditions,
      rejectionReason,
    });

    const notifId = `notif_cf_${applicationId}_${eventCode}_${Date.now()}`;
    let status: 'SENT' | 'SKIPPED_NO_EMAIL' | 'PENDING_CLOUD_FUNCTION' | 'FAILED' = 'PENDING_CLOUD_FUNCTION';
    let providerMessageId: string | null = null;
    let errorMessage: string | null = null;
    let sentAt: string | null = null;

    if (!recipientEmail) {
      status = 'SKIPPED_NO_EMAIL';
      errorMessage = 'El cliente no tiene correo electrónico registrado en su perfil.';
    } else {
      try {
        const res = await dispatchViaSmtp({
          to: recipientEmail,
          subject: rendered.subject,
          text: rendered.bodyText,
          html: rendered.bodyHtml,
        });
        if (res.sent) {
          status = 'SENT';
          providerMessageId = res.messageId ?? null;
          sentAt = new Date().toISOString();
        } else {
          status = 'PENDING_CLOUD_FUNCTION';
          errorMessage = res.reason ?? null;
        }
      } catch (err) {
        status = 'FAILED';
        errorMessage = err instanceof Error ? err.message : 'Error SMTP en Cloud Function';
        logger.error('Error enviando email de cambio de estado', err);
      }
    }

    await db.collection('email_notifications').doc(notifId).set({
      id: notifId,
      organizationId: String(after.organizationId),
      applicationId,
      applicationNumber: String(after.applicationNumber),
      customerId: String(after.customerId),
      applicantUid: String(after.createdBy),
      recipientEmail,
      recipientName,
      eventCode,
      fromStatus: String(before.status),
      toStatus: String(after.status),
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      deliveryChannel: 'CLOUD_FUNCTION_TRIGGER',
      status,
      providerMessageId,
      errorMessage,
      idempotencyKey,
      triggeredBy: String(after.assignedTo || after.createdBy),
      triggeredByName: 'Firebase Cloud Function (onApplicationStatusChanged)',
      sentAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);

/**
 * Trigger 2: Detecta cuando una formalización queda en etapa "Pendiente de Firma"
 * (status === 'PENDIENTE' y sin firmas registradas aún).
 */
export const onFormalizationPendingSignature = onDocumentWritten(
  {
    document: 'formalizations/{formalizationId}',
    database: DATABASE_ID,
    region: 'us-east1',
    secrets: [smtpHostSecret, smtpPortSecret, smtpUserSecret, smtpPassSecret, smtpFromSecret],
  },
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;

    const signatures = Array.isArray(after.signatures) ? after.signatures : [];
    if (after.status !== 'PENDIENTE' || signatures.length > 0) return;

    const applicationId = String(after.applicationId);
    const idempotencyKey = `${applicationId}_PENDIENTE_FIRMA`;

    const existingSnap = await db
      .collection('email_notifications')
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    if (!existingSnap.empty) return;

    const appSnap = await db.collection('applications').doc(applicationId).get();
    const appData = appSnap.data();
    if (!appData) return;

    const customerSnap = await db.collection('customers').doc(String(appData.customerId)).get();
    const customer = customerSnap.data();
    const orgSnap = await db.collection('organizations').doc(String(appData.organizationId)).get();
    const orgName = String(orgSnap.data()?.name || 'AxyCore Servicios Financieros');

    const recipientEmail = String(customer?.email || '').trim();
    const recipientName = customer
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || String(appData.applicantDisplayName)
      : String(appData.applicantDisplayName || 'Cliente');

    const rendered = renderStatusEmail({
      eventCode: 'PENDIENTE_FIRMA',
      recipientName,
      organizationName: orgName,
      applicationNumber: String(appData.applicationNumber),
      fileNumber: String(appData.fileNumber),
      productCode: String(appData.productCode),
      currency: String(appData.currency),
      amount: Number(after.approvedCapital || appData.recommendedAmount || appData.requestedAmount || 0),
      termMonths: Number(after.termMonths || appData.recommendedTermMonths || appData.requestedTermMonths || 0),
      rateMonthly: after.contractualRateMonthly ?? appData.recommendedRateMonthly ?? null,
    });

    const notifId = `notif_cf_${applicationId}_PENDIENTE_FIRMA_${Date.now()}`;
    let status: 'SENT' | 'SKIPPED_NO_EMAIL' | 'PENDING_CLOUD_FUNCTION' | 'FAILED' = 'PENDING_CLOUD_FUNCTION';
    let providerMessageId: string | null = null;
    let errorMessage: string | null = null;
    let sentAt: string | null = null;

    if (!recipientEmail) {
      status = 'SKIPPED_NO_EMAIL';
      errorMessage = 'El cliente no tiene correo electrónico registrado en su perfil.';
    } else {
      try {
        const res = await dispatchViaSmtp({
          to: recipientEmail,
          subject: rendered.subject,
          text: rendered.bodyText,
          html: rendered.bodyHtml,
        });
        if (res.sent) {
          status = 'SENT';
          providerMessageId = res.messageId ?? null;
          sentAt = new Date().toISOString();
        } else {
          errorMessage = res.reason ?? null;
        }
      } catch (err) {
        status = 'FAILED';
        errorMessage = err instanceof Error ? err.message : 'Error SMTP en Cloud Function';
      }
    }

    await db.collection('email_notifications').doc(notifId).set({
      id: notifId,
      organizationId: String(appData.organizationId),
      applicationId,
      applicationNumber: String(appData.applicationNumber),
      customerId: String(appData.customerId),
      applicantUid: String(appData.createdBy),
      recipientEmail,
      recipientName,
      eventCode: 'PENDIENTE_FIRMA',
      fromStatus: String(appData.status),
      toStatus: 'PENDIENTE_FIRMA',
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      bodyHtml: rendered.bodyHtml,
      deliveryChannel: 'CLOUD_FUNCTION_TRIGGER',
      status,
      providerMessageId,
      errorMessage,
      idempotencyKey,
      triggeredBy: String(after.formalizedBy || appData.createdBy),
      triggeredByName: 'Firebase Cloud Function (onFormalizationPendingSignature)',
      sentAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);

/**
 * Trigger 3: Procesa documentos encolados en `email_notifications/{notificationId}` con status === 'QUEUED'.
 */
export const processEmailNotificationQueue = onDocumentCreated(
  {
    document: 'email_notifications/{notificationId}',
    database: DATABASE_ID,
    region: 'us-east1',
    secrets: [smtpHostSecret, smtpPortSecret, smtpUserSecret, smtpPassSecret, smtpFromSecret],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data || !['QUEUED', 'PENDING_CLOUD_FUNCTION'].includes(String(data.status))) return;

    const to = String(data.recipientEmail || '').trim();
    if (!to) {
      await snap.ref.update({
        status: 'SKIPPED_NO_EMAIL',
        errorMessage: 'Sin correo electrónico registrado para el cliente.',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    try {
      const res = await dispatchViaSmtp({
        to,
        subject: String(data.subject),
        text: String(data.bodyText),
        html: String(data.bodyHtml),
      });
      if (res.sent) {
        await snap.ref.update({
          status: 'SENT',
          deliveryChannel: 'CLOUD_FUNCTION_TRIGGER',
          providerMessageId: res.messageId ?? null,
          errorMessage: null,
          sentAt: new Date().toISOString(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await snap.ref.update({
          status: 'PENDING_CLOUD_FUNCTION',
          deliveryChannel: 'CLOUD_FUNCTION_PENDING_SMTP',
          errorMessage: res.reason ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      await snap.ref.update({
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : 'Error procesando cola de email.',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Trigger 4: Envía notificaciones Push Web vía Firebase Cloud Messaging (FCM) al equipo de crédito
 * cuando ingresa una nueva solicitud al Inbox (`RECIBIDA`), se devuelve (`DEVUELTA`) o pasa a `EN_COMITE`.
 */
export const onInboxApplicationPushAlert = onDocumentWritten(
  {
    document: 'applications/{applicationId}',
    database: DATABASE_ID,
    region: 'us-east1',
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;

    const prevStatus = before ? String(before.status || '') : null;
    const nextStatus = String(after.status || '');
    if (!shouldTriggerInboxPush(prevStatus, nextStatus)) {
      return;
    }

    const orgId = String(after.organizationId || '');
    const applicationId = event.params.applicationId;
    if (!orgId) return;

    const tokensSnap = await db
      .collection('fcm_tokens')
      .where('organizationId', '==', orgId)
      .where('status', '==', 'ACTIVE')
      .get();

    if (tokensSnap.empty) {
      logger.info('Sin dispositivos FCM activos registrados para alertar sobre Inbox.', {
        applicationId,
        orgId,
      });
      return;
    }

    const uniqueTokenEntries: Array<{ docId: string; token: string }> = [];
    const seenTokens = new Set<string>();
    tokensSnap.docs.forEach((d) => {
      const data = d.data();
      const tok = String(data.token || '').trim();
      const role = String(data.userRole || '');
      if (tok && role !== 'EXTERNAL_CLIENT' && !seenTokens.has(tok)) {
        seenTokens.add(tok);
        uniqueTokenEntries.push({ docId: d.id, token: tok });
      }
    });

    if (uniqueTokenEntries.length === 0) return;

    const payload = buildInboxPushPayload({
      id: applicationId,
      applicationNumber: String(after.applicationNumber || applicationId),
      applicantDisplayName: String(after.applicantDisplayName || 'Solicitante'),
      channel: String(after.channel || 'INTERNAL'),
      productCode: String(after.productCode || 'PERSONAL_DOP'),
      currency: String(after.currency || 'DOP'),
      requestedAmount: Number(after.requestedAmount || 0),
      status: nextStatus,
    });

    const messaging = getMessaging(adminApp);
    const multicastRes = await messaging.sendEachForMulticast({
      tokens: uniqueTokenEntries.map((t) => t.token),
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: '/assets/aistudio/image_aea21874.png',
          badge: '/assets/aistudio/image_aea21874.png',
          tag: payload.ackKey,
          requireInteraction: true,
        },
        fcmOptions: {
          link: payload.clickAction,
        },
      },
    });

    const staleTokenDocIds: string[] = [];
    multicastRes.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const code = resp.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          staleTokenDocIds.push(uniqueTokenEntries[idx].docId);
        }
      }
    });

    if (staleTokenDocIds.length > 0) {
      const cleanupBatch = db.batch();
      staleTokenDocIds.forEach((docId) => {
        cleanupBatch.update(db.collection('fcm_tokens').doc(docId), {
          status: 'REVOKED',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await cleanupBatch.commit();
    }

    const auditId = `audit_fcm_${applicationId}_${Date.now()}`;
    await db.collection('audit_logs').doc(auditId).set({
      id: auditId,
      organizationId: orgId,
      eventType: 'FCM_INBOX_PUSH_DISPATCHED',
      entityType: 'applications',
      entityId: applicationId,
      action: `Push Web FCM (${payload.eventType}): ${multicastRes.successCount}/${uniqueTokenEntries.length} entregados`,
      previousState: prevStatus,
      newState: nextStatus,
      justification: payload.body,
      transactionId: `fcm_${applicationId}_${Date.now()}`,
      userId: String(after.assignedTo || after.createdBy || 'system_fcm'),
      userEmail: 'fcm-push@axycore.local',
      userRole: 'SYSTEM',
      timestamp: FieldValue.serverTimestamp(),
    });
  }
);

