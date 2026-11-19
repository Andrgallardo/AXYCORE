export type InboxPushEventType = 'NEW_INBOX_APPLICATION' | 'RETURNED_APPLICATION' | 'COMMITTEE_ESCALATION';

const PRODUCT_LABELS_ES: Record<string, string> = {
  PERSONAL_DOP: 'Préstamo Personal DOP',
  EMPRESARIAL_DOP: 'Préstamo Empresarial DOP',
  PERSONAL_USD: 'Préstamo Personal USD',
  EMPRESARIAL_USD: 'Préstamo Empresarial USD',
};

function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === 'USD' ? 'US$' : 'RD$';
  const val = Number.isFinite(amount) ? amount : 0;
  return `${symbol} ${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function shouldTriggerInboxPush(
  prevStatus: string | undefined | null,
  nextStatus: string | undefined | null
): boolean {
  if (!nextStatus) return false;
  if (nextStatus === 'RECIBIDA' && prevStatus !== 'RECIBIDA') return true;
  if (nextStatus === 'DEVUELTA' && prevStatus !== 'DEVUELTA') return true;
  if (nextStatus === 'EN_COMITE' && prevStatus !== 'EN_COMITE') return true;
  return false;
}

export function buildInboxPushPayload(app: {
  id: string;
  applicationNumber: string;
  applicantDisplayName: string;
  channel: string;
  productCode: string;
  currency: string;
  requestedAmount: number;
  status: string;
}) {
  const isNew = app.status === 'RECIBIDA';
  const isReturned = app.status === 'DEVUELTA';

  const eventType: InboxPushEventType = isNew
    ? 'NEW_INBOX_APPLICATION'
    : isReturned
    ? 'RETURNED_APPLICATION'
    : 'COMMITTEE_ESCALATION';

  const priority = isNew || isReturned ? 'INMEDIATA' : 'ALTA';
  const targetSection = app.status === 'EN_COMITE' ? 'committee' : 'applications';

  const channelLabel = app.channel === 'EXTERNAL' ? 'Canal Externo' : 'Canal Interno';
  const title = isNew
    ? `Nueva solicitud en Inbox (${channelLabel})`
    : isReturned
    ? 'Solicitud devuelta requiere atención'
    : 'Expediente enviado a Comité de Crédito';

  const productLabel = PRODUCT_LABELS_ES[app.productCode] || app.productCode;
  const amountText = formatCurrency(Number(app.requestedAmount || 0), app.currency || 'DOP');
  const body = `${app.applicationNumber} · ${app.applicantDisplayName} · ${amountText} (${productLabel})`;
  const ackKey = `${app.id}:${app.status}`;
  const clickAction = `/?applicationId=${encodeURIComponent(app.id)}&section=${encodeURIComponent(targetSection)}`;

  return {
    eventType,
    ackKey,
    priority,
    targetSection,
    title,
    body,
    clickAction,
    data: {
      applicationId: app.id,
      applicationNumber: app.applicationNumber,
      applicantDisplayName: app.applicantDisplayName,
      channel: app.channel,
      status: app.status,
      eventType,
      priority,
      targetSection,
      ackKey,
      title,
      body,
      clickAction,
    },
  };
}
