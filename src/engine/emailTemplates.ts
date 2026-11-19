import type { ApplicationRecord, CustomerEmailEventCode } from '../types/axycore';
import { formatMoney, formatRatePct, PRODUCT_LABELS } from '../utils/formatters';

export interface EmailTemplateContext {
  application: Pick<
    ApplicationRecord,
    | 'id'
    | 'applicationNumber'
    | 'fileNumber'
    | 'applicantDisplayName'
    | 'productCode'
    | 'currency'
    | 'requestedAmount'
    | 'requestedTermMonths'
    | 'recommendedAmount'
    | 'recommendedRateMonthly'
    | 'recommendedTermMonths'
  >;
  eventCode: CustomerEmailEventCode;
  recipientName: string;
  organizationName?: string;
  approvedAmount?: number | null;
  approvedRateMonthly?: number | null;
  approvedTermMonths?: number | null;
  conditions?: string[];
  rejectionReason?: string | null;
  observations?: string | null;
  amortizationSchedule?: Array<{
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    remainingPrincipalBalance: number;
  }>;
  paymentFrequency?: string;
  firstPaymentDate?: string;
  disbursementBank?: string;
  disbursementAccountMasked?: string;
  disbursementRef?: string;
}

export interface RenderedCustomerEmail {
  eventCode: CustomerEmailEventCode;
  eventLabel: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

export const EMAIL_EVENT_LABELS: Record<CustomerEmailEventCode, string> = {
  RECIBIDA: 'Solicitud Recibida',
  EN_EVALUACION: 'En Evaluación Técnica',
  DEVUELTA: 'Devuelta para Subsanación',
  EN_COMITE: 'En Comité de Crédito',
  APROBADA: 'Solicitud Aprobada',
  APROBADA_CONDICIONADA: 'Aprobación Condicionada',
  RECHAZADA: 'Solicitud Rechazada',
  PENDIENTE_FIRMA: 'Pendiente de Firma Contractual',
  FORMALIZADA: 'Contrato Formalizado',
  DESEMBOLSADA: 'Préstamo Desembolsado',
};

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCustomerStatusEmailPayload(ctx: EmailTemplateContext): RenderedCustomerEmail {
  const {
    application,
    eventCode,
    recipientName,
    organizationName = 'AxyCore Servicios Financieros',
    approvedAmount,
    approvedRateMonthly,
    approvedTermMonths,
    conditions = [],
    rejectionReason,
    observations,
    amortizationSchedule = [],
    paymentFrequency,
    firstPaymentDate,
    disbursementBank,
    disbursementAccountMasked,
    disbursementRef,
  } = ctx;

  const productLabel = PRODUCT_LABELS[application.productCode] ?? application.productCode;
  const effectiveAmount = approvedAmount ?? application.recommendedAmount ?? application.requestedAmount;
  const effectiveRate = approvedRateMonthly ?? application.recommendedRateMonthly;
  const effectiveTerm = approvedTermMonths ?? application.recommendedTermMonths ?? application.requestedTermMonths;
  const formattedAmount = formatMoney(effectiveAmount, application.currency);
  const formattedRate = formatRatePct(effectiveRate);
  const eventLabel = EMAIL_EVENT_LABELS[eventCode];

  let subject = '';
  let headline = '';
  let accentHex = '#0f3d91';
  let summaryParagraph = '';
  let nextStepsParagraph = '';
  const bulletItems: string[] = [];

  switch (eventCode) {
    case 'RECIBIDA':
      subject = `[AxyCore] Confirmación de recepción · Solicitud ${application.applicationNumber}`;
      headline = 'Hemos recibido su solicitud de crédito';
      accentHex = '#0369a1';
      summaryParagraph = `Estimado(a) ${recipientName}, confirmamos la recepción de su solicitud ${application.applicationNumber} (${productLabel}) por ${formatMoney(application.requestedAmount, application.currency)} a ${application.requestedTermMonths} meses.`;
      nextStepsParagraph =
        'Nuestro equipo de análisis crediticio iniciará la verificación documental y evaluación financiera correspondiente.';
      break;

    case 'EN_EVALUACION':
      subject = `[AxyCore] Expediente en evaluación · ${application.applicationNumber}`;
      headline = 'Su solicitud está siendo evaluada';
      accentHex = '#0369a1';
      summaryParagraph = `Estimado(a) ${recipientName}, su expediente ${application.fileNumber} (solicitud ${application.applicationNumber}) se encuentra actualmente en análisis técnico y revisión de riesgos.`;
      nextStepsParagraph =
        'Le notificaremos por esta misma vía en cuanto el expediente avance a Comité de Crédito o requiera alguna aclaración.';
      break;

    case 'DEVUELTA':
      subject = `[AxyCore] Acción requerida en su solicitud ${application.applicationNumber}`;
      headline = 'Su solicitud requiere información adicional';
      accentHex = '#b45309';
      summaryParagraph = `Estimado(a) ${recipientName}, su solicitud ${application.applicationNumber} fue devuelta temporalmente para completar o aclarar antecedentes antes de continuar su evaluación.`;
      if (observations?.trim()) {
        bulletItems.push(`Detalle de observación: ${observations.trim()}`);
      }
      nextStepsParagraph =
        'Por favor, ingrese al portal o contacte a su oficial de negocios para adjuntar los soportes pendientes.';
      break;

    case 'EN_COMITE':
      subject = `[AxyCore] Solicitud elevada a Comité de Crédito · ${application.applicationNumber}`;
      headline = 'Expediente sometido a Comité de Crédito';
      accentHex = '#0f3d91';
      summaryParagraph = `Estimado(a) ${recipientName}, concluida la evaluación técnica de su solicitud ${application.applicationNumber}, el expediente ha sido elevado al Comité de Crédito para resolución definitiva.`;
      nextStepsParagraph =
        'En breve recibirá el dictamen oficial del Comité con los pasos siguientes.';
      break;

    case 'APROBADA':
      subject = `[AxyCore] ¡Solicitud Aprobada! · ${application.applicationNumber}`;
      headline = 'Su solicitud de crédito ha sido aprobada';
      accentHex = '#047857';
      summaryParagraph = `Nos complace informarle, ${recipientName}, que el Comité de Crédito ha aprobado su solicitud ${application.applicationNumber} (${productLabel}). Sus documentos de Formalización (Contrato y Pagaré) han sido generados automáticamente.`;
      bulletItems.push(`Monto aprobado: ${formattedAmount}`);
      bulletItems.push(`Plazo aprobado: ${effectiveTerm} meses${paymentFrequency ? ` (${paymentFrequency})` : ''}`);
      if (effectiveRate !== null && effectiveRate !== undefined) {
        bulletItems.push(`Tasa mensual contractual: ${formattedRate}`);
      }
      if (firstPaymentDate) {
        bulletItems.push(`Fecha estimada primera cuota: ${firstPaymentDate}`);
      }
      nextStepsParagraph =
        'Adjuntamos sus condiciones aprobadas y tabla de amortización. Nuestro equipo de Formalización completará la verificación final del Contrato y Pagaré para proceder al desembolso.';
      break;

    case 'APROBADA_CONDICIONADA':
      subject = `[AxyCore] Aprobación Condicionada · ${application.applicationNumber}`;
      headline = 'Su solicitud fue aprobada sujeta a condiciones previas';
      accentHex = '#047857';
      summaryParagraph = `Estimado(a) ${recipientName}, el Comité de Crédito aprobó su solicitud ${application.applicationNumber} por ${formattedAmount} (${effectiveTerm} meses${paymentFrequency ? `, ${paymentFrequency}` : ''}), pasando a Formalización con Contrato y Pagaré generados, sujeta al cumplimiento de los siguientes requisitos:`;
      if (conditions.length > 0) {
        conditions.forEach((c) => bulletItems.push(c));
      } else {
        bulletItems.push('Completar documentación contractual y de respaldo indicada por Formalización.');
      }
      if (effectiveRate !== null && effectiveRate !== undefined) {
        bulletItems.push(`Tasa mensual contractual: ${formattedRate}`);
      }
      nextStepsParagraph =
        'Una vez validados estos requisitos y confirmados Contrato y Pagaré, procederemos con el desembolso.';
      break;

    case 'RECHAZADA':
      subject = `[AxyCore] Resolución sobre su solicitud ${application.applicationNumber}`;
      headline = 'Resolución no aprobada para su solicitud';
      accentHex = '#be123c';
      summaryParagraph = `Estimado(a) ${recipientName}, tras completar la revisión de políticas crediticias y capacidad de pago, le informamos que su solicitud ${application.applicationNumber} no ha sido aprobada en esta ocasión.`;
      if (rejectionReason?.trim()) {
        bulletItems.push(`Motivo documentado: ${rejectionReason.trim()}`);
      }
      nextStepsParagraph =
        'Si sus condiciones financieras cambian o desea recibir orientación sobre nuestras políticas vigentes, puede comunicarse con nuestro equipo.';
      break;

    case 'PENDIENTE_FIRMA':
      subject = `[AxyCore] Pendiente de Firma Contractual · ${application.applicationNumber}`;
      headline = 'Sus documentos contractuales están listos para firma';
      accentHex = '#0369a1';
      summaryParagraph = `Estimado(a) ${recipientName}, su contrato de préstamo y pagaré correspondientes a la solicitud ${application.applicationNumber} han sido emitidos y se encuentran Pendientes de Firma.`;
      bulletItems.push(`Capital aprobado: ${formattedAmount}`);
      bulletItems.push(`Plazo: ${effectiveTerm} meses`);
      if (effectiveRate !== null && effectiveRate !== undefined) {
        bulletItems.push(`Tasa mensual: ${formattedRate}`);
      }
      nextStepsParagraph =
        'Por favor, acuda al punto de formalización o complete el proceso de firma indicado por su oficial para habilitar el desembolso inmediato.';
      break;

    case 'FORMALIZADA':
      subject = `[AxyCore] Contrato Formalizado · Listo para Desembolso (${application.applicationNumber})`;
      headline = 'Formalización completada exitosamente';
      accentHex = '#047857';
      summaryParagraph = `Estimado(a) ${recipientName}, confirmamos que toda la documentación y firmas de su solicitud ${application.applicationNumber} han sido validadas y su operación pasó a etapa de Desembolso.`;
      nextStepsParagraph =
        'Tesorería y Operaciones procesarán la entrega de fondos según la cuenta o medio acordado.';
      break;

    case 'DESEMBOLSADA':
      subject = `[AxyCore] ¡Desembolso Confirmado en tu Cuenta! · ${application.applicationNumber}`;
      headline = 'Su préstamo ya se encuentra en su cuenta de banco';
      accentHex = '#047857';
      summaryParagraph = `Estimado(a) ${recipientName}, le informamos que su préstamo ${application.applicationNumber} (${productLabel}) por ${formattedAmount} ha sido desembolsado exitosamente y ya se encuentra en su cuenta de banco.`;
      bulletItems.push(`Plazo contractual: ${effectiveTerm} meses`);
      if (disbursementBank) {
        bulletItems.push(`Entidad bancaria: ${disbursementBank}`);
      }
      if (disbursementAccountMasked) {
        bulletItems.push(`Cuenta acreditada: ${disbursementAccountMasked}`);
      }
      if (disbursementRef) {
        bulletItems.push(`Referencia de comprobante: ${disbursementRef}`);
      }
      if (firstPaymentDate) {
        bulletItems.push(`Primer vencimiento: ${firstPaymentDate}`);
      }
      bulletItems.push(`Estado del préstamo: ACTIVO`);
      nextStepsParagraph =
        'Ya puede consultar su préstamo activo, tabla de amortización y fechas de pago desde el Portal de Clientes de AxyCore.';
      break;
  }

  const schedulePreviewRows =
    (eventCode === 'APROBADA' || eventCode === 'APROBADA_CONDICIONADA') && amortizationSchedule.length > 0
      ? amortizationSchedule.slice(0, 60)
      : [];

  const scheduleText =
    schedulePreviewRows.length > 0
      ? `\n\nTabla de Amortización (${amortizationSchedule.length} cuotas):\n` +
        schedulePreviewRows
          .map(
            (r) =>
              `Cuota #${r.installmentNumber} | ${r.dueDate} | Cap: ${formatMoney(r.principalAmount, application.currency)} | Int: ${formatMoney(r.interestAmount, application.currency)} | Total: ${formatMoney(r.totalAmount, application.currency)} | Saldo: ${formatMoney(r.remainingPrincipalBalance, application.currency)}`
          )
          .join('\n')
      : '';

  const bulletText = bulletItems.length > 0 ? `\n\nDetalles:\n${bulletItems.map((b) => `- ${b}`).join('\n')}` : '';
  const bodyText =
    `${headline}\n` +
    `--------------------------------------------------\n` +
    `${summaryParagraph}${bulletText}${scheduleText}\n\n` +
    `${nextStepsParagraph}\n\n` +
    `Expediente: ${application.fileNumber} | Solicitud: ${application.applicationNumber}\n` +
    `${organizationName}`;

  const bulletsHtml =
    bulletItems.length > 0
      ? `<ul style="margin:14px 0;padding-left:20px;color:#334155;font-size:14px;line-height:1.6;">${bulletItems
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '';

  const scheduleHtml =
    schedulePreviewRows.length > 0
      ? `<div style="margin-top:16px;">
          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Tabla de Amortización Contractual (${amortizationSchedule.length} cuotas)</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:12px;border:1px solid #cbd5e1;">
            <thead>
              <tr style="background:#f1f5f9;color:#334155;text-align:left;">
                <th style="border-bottom:1px solid #cbd5e1;">#</th>
                <th style="border-bottom:1px solid #cbd5e1;">Fecha</th>
                <th style="border-bottom:1px solid #cbd5e1;text-align:right;">Capital</th>
                <th style="border-bottom:1px solid #cbd5e1;text-align:right;">Interés</th>
                <th style="border-bottom:1px solid #cbd5e1;text-align:right;">Cuota</th>
                <th style="border-bottom:1px solid #cbd5e1;text-align:right;">Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${schedulePreviewRows
                .map(
                  (r) => `<tr>
                    <td style="border-bottom:1px solid #e2e8f0;">${r.installmentNumber}</td>
                    <td style="border-bottom:1px solid #e2e8f0;">${escapeHtml(r.dueDate)}</td>
                    <td style="border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(formatMoney(r.principalAmount, application.currency))}</td>
                    <td style="border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(formatMoney(r.interestAmount, application.currency))}</td>
                    <td style="border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;">${escapeHtml(formatMoney(r.totalAmount, application.currency))}</td>
                    <td style="border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(formatMoney(r.remainingPrincipalBalance, application.currency))}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>`
      : '';

  const bodyHtml = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;background-color:${accentHex};color:#ffffff;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">${escapeHtml(organizationName)} · ${escapeHtml(eventLabel)}</div>
          <h1 style="margin:6px 0 0;font-size:18px;font-weight:700;line-height:1.3;">${escapeHtml(headline)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;font-size:14px;line-height:1.6;color:#1e293b;">
          <p style="margin:0 0 12px;">${escapeHtml(summaryParagraph)}</p>
          ${bulletsHtml}
          ${scheduleHtml}
          <p style="margin:14px 0 0;color:#475569;">${escapeHtml(nextStepsParagraph)}</p>
          <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
            <strong>Solicitud:</strong> ${escapeHtml(application.applicationNumber)} &nbsp;·&nbsp;
            <strong>Expediente:</strong> ${escapeHtml(application.fileNumber)} &nbsp;·&nbsp;
            <strong>Producto:</strong> ${escapeHtml(productLabel)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    eventCode,
    eventLabel,
    subject,
    bodyText,
    bodyHtml,
  };
}
