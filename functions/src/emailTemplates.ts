export type CustomerEmailEventCode =
  | 'RECIBIDA'
  | 'EN_EVALUACION'
  | 'DEVUELTA'
  | 'EN_COMITE'
  | 'APROBADA'
  | 'APROBADA_CONDICIONADA'
  | 'RECHAZADA'
  | 'PENDIENTE_FIRMA'
  | 'FORMALIZADA'
  | 'DESEMBOLSADA';

const PRODUCT_NAMES: Record<string, string> = {
  PERSONAL_DOP: 'Préstamo Personal DOP',
  EMPRESARIAL_DOP: 'Préstamo Empresarial DOP',
  PERSONAL_USD: 'Préstamo Personal USD',
  EMPRESARIAL_USD: 'Préstamo Empresarial USD',
};

const EVENT_LABELS: Record<CustomerEmailEventCode, string> = {
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

function formatCurrency(amount: number, currency: string): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix} ${Number(amount || 0).toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderStatusEmail(params: {
  eventCode: CustomerEmailEventCode;
  recipientName: string;
  organizationName: string;
  applicationNumber: string;
  fileNumber: string;
  productCode: string;
  currency: string;
  amount: number;
  termMonths: number;
  rateMonthly?: number | null;
  conditions?: string[];
  rejectionReason?: string | null;
  observations?: string | null;
}): { subject: string; bodyText: string; bodyHtml: string } {
  const {
    eventCode,
    recipientName,
    organizationName,
    applicationNumber,
    fileNumber,
    productCode,
    currency,
    amount,
    termMonths,
    rateMonthly,
    conditions = [],
    rejectionReason,
    observations,
  } = params;

  const productLabel = PRODUCT_NAMES[productCode] ?? productCode;
  const formattedAmount = formatCurrency(amount, currency);
  const formattedRate =
    rateMonthly !== null && rateMonthly !== undefined ? `${(rateMonthly * 100).toFixed(2)}% mensual` : null;
  const eventLabel = EVENT_LABELS[eventCode];

  let subject = '';
  let headline = '';
  let accentHex = '#0f3d91';
  let summary = '';
  let nextSteps = '';
  const bullets: string[] = [];

  switch (eventCode) {
    case 'RECIBIDA':
      subject = `[AxyCore] Confirmación de recepción · Solicitud ${applicationNumber}`;
      headline = 'Hemos recibido su solicitud de crédito';
      accentHex = '#0369a1';
      summary = `Estimado(a) ${recipientName}, confirmamos la recepción de su solicitud ${applicationNumber} (${productLabel}) por ${formattedAmount} a ${termMonths} meses.`;
      nextSteps = 'Nuestro equipo iniciará la verificación documental y evaluación crediticia correspondiente.';
      break;
    case 'EN_EVALUACION':
      subject = `[AxyCore] Expediente en evaluación · ${applicationNumber}`;
      headline = 'Su solicitud está siendo evaluada';
      accentHex = '#0369a1';
      summary = `Estimado(a) ${recipientName}, su expediente ${fileNumber} se encuentra actualmente en evaluación técnica y revisión de riesgos.`;
      nextSteps = 'Le notificaremos en cuanto su solicitud pase a Comité de Crédito o requiera información adicional.';
      break;
    case 'DEVUELTA':
      subject = `[AxyCore] Acción requerida en su solicitud ${applicationNumber}`;
      headline = 'Su solicitud requiere información adicional';
      accentHex = '#b45309';
      summary = `Estimado(a) ${recipientName}, su solicitud ${applicationNumber} fue devuelta temporalmente para completar información o documentación.`;
      if (observations) bullets.push(`Detalle de observación: ${observations}`);
      nextSteps = 'Por favor, ingrese al portal o contacte a su oficial de negocios para subsanar los requerimientos.';
      break;
    case 'EN_COMITE':
      subject = `[AxyCore] Solicitud elevada a Comité de Crédito · ${applicationNumber}`;
      headline = 'Expediente sometido a Comité de Crédito';
      summary = `Estimado(a) ${recipientName}, concluida la evaluación técnica de su solicitud ${applicationNumber}, su expediente pasó a resolución del Comité de Crédito.`;
      nextSteps = 'En breve recibirá la notificación oficial del dictamen del Comité.';
      break;
    case 'APROBADA':
      subject = `[AxyCore] ¡Solicitud Aprobada! · ${applicationNumber}`;
      headline = 'Su solicitud de crédito ha sido aprobada';
      accentHex = '#047857';
      summary = `Nos complace informarle, ${recipientName}, que su solicitud ${applicationNumber} (${productLabel}) ha sido aprobada por el Comité de Crédito.`;
      bullets.push(`Monto aprobado: ${formattedAmount}`);
      bullets.push(`Plazo aprobado: ${termMonths} meses`);
      if (formattedRate) bullets.push(`Tasa contractual: ${formattedRate}`);
      nextSteps = 'Nuestro equipo de Formalización preparará su contrato y pagaré para firma.';
      break;
    case 'APROBADA_CONDICIONADA':
      subject = `[AxyCore] Aprobación Condicionada · ${applicationNumber}`;
      headline = 'Su solicitud fue aprobada sujeta a condiciones previas';
      accentHex = '#047857';
      summary = `Estimado(a) ${recipientName}, su solicitud ${applicationNumber} fue aprobada por ${formattedAmount} (${termMonths} meses), sujeta a las siguientes condiciones previas:`;
      if (conditions.length > 0) {
        conditions.forEach((c) => bullets.push(c));
      } else {
        bullets.push('Completar documentación contractual requerida por Formalización.');
      }
      nextSteps = 'Al completar estas condiciones procederemos con la firma contractual y desembolso.';
      break;
    case 'RECHAZADA':
      subject = `[AxyCore] Resolución sobre su solicitud ${applicationNumber}`;
      headline = 'Resolución no aprobada para su solicitud';
      accentHex = '#be123c';
      summary = `Estimado(a) ${recipientName}, le informamos que su solicitud ${applicationNumber} no ha sido aprobada en esta evaluación.`;
      if (rejectionReason) bullets.push(`Motivo documentado: ${rejectionReason}`);
      nextSteps = 'Si desea orientación sobre nuestras políticas vigentes, puede contactar a su oficial de negocios.';
      break;
    case 'PENDIENTE_FIRMA':
      subject = `[AxyCore] Pendiente de Firma Contractual · ${applicationNumber}`;
      headline = 'Sus documentos contractuales están listos para firma';
      accentHex = '#0369a1';
      summary = `Estimado(a) ${recipientName}, el contrato y pagaré de su solicitud ${applicationNumber} están emitidos y Pendientes de Firma.`;
      bullets.push(`Capital aprobado: ${formattedAmount}`);
      bullets.push(`Plazo: ${termMonths} meses`);
      if (formattedRate) bullets.push(`Tasa contractual: ${formattedRate}`);
      nextSteps = 'Complete la firma con Formalización para habilitar inmediatamente su desembolso.';
      break;
    case 'FORMALIZADA':
      subject = `[AxyCore] Contrato Formalizado · Listo para Desembolso (${applicationNumber})`;
      headline = 'Formalización completada exitosamente';
      accentHex = '#047857';
      summary = `Estimado(a) ${recipientName}, confirmamos que su contrato fue formalizado exitosamente y la operación ${applicationNumber} quedó habilitada para desembolso.`;
      nextSteps = 'Tesorería y Operaciones procesarán el desembolso de acuerdo con las instrucciones registradas.';
      break;
    case 'DESEMBOLSADA':
      subject = `[AxyCore] ¡Desembolso Confirmado! · ${applicationNumber}`;
      headline = 'Su préstamo ha sido desembolsado';
      accentHex = '#047857';
      summary = `Estimado(a) ${recipientName}, confirmamos el desembolso de su préstamo (${applicationNumber}) por ${formattedAmount}.`;
      bullets.push(`Plazo contractual: ${termMonths} meses`);
      bullets.push('Estado del préstamo: ACTIVO');
      nextSteps = 'Puede consultar su tabla de amortización y fechas de pago en el portal de clientes AxyCore.';
      break;
  }

  const bulletText = bullets.length > 0 ? `\n\nDetalles:\n${bullets.map((b) => `- ${b}`).join('\n')}` : '';
  const bodyText =
    `${headline}\n--------------------------------------------------\n${summary}${bulletText}\n\n${nextSteps}\n\n` +
    `Expediente: ${fileNumber} | Solicitud: ${applicationNumber}\n${organizationName}`;

  const bulletsHtml =
    bullets.length > 0
      ? `<ul style="margin:14px 0;padding-left:20px;color:#334155;font-size:14px;line-height:1.6;">${bullets
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '';

  const bodyHtml = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;background-color:${accentHex};color:#ffffff;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">${escapeHtml(organizationName)} · ${escapeHtml(eventLabel)}</div>
          <h1 style="margin:6px 0 0;font-size:18px;font-weight:700;line-height:1.3;">${escapeHtml(headline)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;font-size:14px;line-height:1.6;color:#1e293b;">
          <p style="margin:0 0 12px;">${escapeHtml(summary)}</p>
          ${bulletsHtml}
          <p style="margin:14px 0 0;color:#475569;">${escapeHtml(nextSteps)}</p>
          <div style="margin-top:20px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
            <strong>Solicitud:</strong> ${escapeHtml(applicationNumber)} &nbsp;·&nbsp;
            <strong>Expediente:</strong> ${escapeHtml(fileNumber)} &nbsp;·&nbsp;
            <strong>Producto:</strong> ${escapeHtml(productLabel)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, bodyText, bodyHtml };
}
