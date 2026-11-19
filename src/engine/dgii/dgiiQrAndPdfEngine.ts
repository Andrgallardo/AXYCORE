import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ECF_STATUS_LABELS,
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type DgiiEnvironment,
  type DgiiFiscalConfigRecord,
} from '../../types/dgiiEcf';
import { cleanDigits } from './dgiiCatalogAndValidation';
import { isoToDgiiDate } from './dgiiXmlEngine';
import { formatMoney } from '../../utils/formatters';

function resolveDgiiEnvSegment(env: DgiiEnvironment): string {
  switch (env) {
    case 'PRODUCCION':
      return 'eCF';
    case 'CERTIFICACION':
      return 'CerteCF';
    case 'PRECERTIFICACION':
    case 'DESARROLLO':
    default:
      return 'TesteCF';
  }
}

/**
 * Builds official DGII QR validation URL (ConsultaTimbre / ConsultaTimbreFC).
 * Uses exact DGII query parameter contract: RncEmisor, RncComprador (if present), ENCF,
 * FechaEmision (DD-MM-YYYY), MontoTotal, FechaFirma (DD-MM-YYYY HH:mm:ss), CodigoSeguridad (6 chars).
 */
export function buildDgiiQrValidationUrl(doc: DgiiEcfDocumentRecord): string {
  const envSegment = resolveDgiiEnvSegment(doc.environment);
  const isConsumoResumen = doc.ecfType === '32' && doc.totalAmount < 250000;
  const base = isConsumoResumen
    ? `https://fc.dgii.gov.do/${envSegment}/ConsultaTimbreFC`
    : `https://ecf.dgii.gov.do/${envSegment}/ConsultaTimbre`;

  const params = new URLSearchParams();
  params.set('RncEmisor', cleanDigits(doc.issuerRnc));
  if (!isConsumoResumen && doc.receiverTaxId && doc.receiverIdType !== 'SIN_ID') {
    params.set('RncComprador', cleanDigits(doc.receiverTaxId) || doc.receiverTaxId);
  }
  params.set('ENCF', doc.eNCF || '');
  if (!isConsumoResumen) {
    params.set('FechaEmision', isoToDgiiDate(doc.issueDate));
  }
  params.set('MontoTotal', doc.totalAmount.toFixed(2));
  if (!isConsumoResumen && doc.signedAt) {
    const dt = doc.signedAt.slice(0, 19);
    const dgiiTime = `${isoToDgiiDate(dt.slice(0, 10))} ${dt.slice(11, 19) || '00:00:00'}`;
    params.set('FechaFirma', dgiiTime);
  }
  params.set('CodigoSeguridad', doc.securityCode || '000000');
  return `${base}?${params.toString()}`;
}

export async function generateQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 240,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#040C1E',
      light: '#FFFFFF',
    },
  });
}

/**
 * Generates the official PDF printed representation (Representación Impresa) of an e-CF
 * including emisor, receptor, e-NCF, itemized taxes/ITBIS, 6-char security code, and QR code.
 */
export async function generateEcfPrintedRepresentationPdf(params: {
  document: DgiiEcfDocumentRecord;
  config?: DgiiFiscalConfigRecord | null;
  logoUrl?: string;
}): Promise<jsPDF> {
  const { document: doc, config } = params;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const meta = ECF_TYPE_META[doc.ecfType];
  const qrUrl = doc.qrUrl || buildDgiiQrValidationUrl(doc);
  const qrDataUrl = await generateQrCodeDataUrl(qrUrl);

  // Header Accent Bar
  pdf.setFillColor(4, 12, 30);
  pdf.rect(0, 0, 215.9, 28, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(doc.issuerName || config?.legalName || 'EMISOR ELECTRÓNICO', 14, 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`RNC: ${doc.issuerRnc || config?.rnc || '—'} · ${doc.issuerAddress || config?.fiscalAddress || ''}`, 14, 18);
  pdf.text(
    `Tel: ${config?.phone || '—'} · Email: ${config?.email || '—'}`,
    14,
    23
  );

  // Right Fiscal Box
  pdf.setFillColor(11, 31, 58);
  pdf.roundedRect(132, 4, 72, 20, 2, 2, 'F');
  pdf.setTextColor(0, 209, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(meta.name.toUpperCase(), 135, 10, { maxWidth: 66 });
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(11);
  pdf.text(`e-NCF: ${doc.eNCF || 'BORRADOR'}`, 135, 19);

  // Environment / Simulation Watermark banner when not certified production
  let yCursor = 34;
  if (doc.environment !== 'PRODUCCION' || !doc.isOfficialDgiiResponse) {
    pdf.setFillColor(254, 243, 199);
    pdf.roundedRect(14, yCursor, 188, 9, 1.5, 1.5, 'F');
    pdf.setTextColor(146, 64, 14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text(
      `AMBIENTE: ${doc.environment} · ${
        doc.isTestSimulation
          ? 'DOCUMENTO DE PRUEBA INTERNA (NO VÁLIDO FISCALMENTE ANTE DGII)'
          : `ESTADO: ${ECF_STATUS_LABELS[doc.status]}`
      }`,
      18,
      yCursor + 5.8
    );
    yCursor += 13;
  }

  // Buyer & Document Metadata Boxes
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(14, yCursor, 114, 30, 2, 2, 'FD');
  pdf.roundedRect(132, yCursor, 70, 30, 2, 2, 'FD');

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('DATOS DEL COMPRADOR / RECEPTOR', 18, yCursor + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Razón Social: ${doc.receiverName || 'Consumidor Final'}`, 18, yCursor + 12, { maxWidth: 106 });
  pdf.text(
    `${doc.receiverIdType === 'SIN_ID' ? 'Identificación' : doc.receiverIdType}: ${doc.receiverTaxId || 'No requerida'}`,
    18,
    yCursor + 18
  );
  pdf.text(`Dirección: ${doc.receiverAddress || 'República Dominicana'}`, 18, yCursor + 24, { maxWidth: 106 });

  pdf.setFont('helvetica', 'bold');
  pdf.text('DETALLES FISCALES', 136, yCursor + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Fecha Emisión: ${isoToDgiiDate(doc.issueDate)}`, 136, yCursor + 12);
  pdf.text(`Condición: ${doc.paymentCondition} · ${doc.currency}`, 136, yCursor + 17.5);
  pdf.text(`Estado DGII: ${ECF_STATUS_LABELS[doc.status]}`, 136, yCursor + 23);
  if (doc.referenceEcf) {
    pdf.text(`Ref. NCF: ${doc.referenceEcf}`, 136, yCursor + 28);
  }

  yCursor += 36;

  // Items Table
  autoTable(pdf, {
    startY: yCursor,
    margin: { left: 14, right: 14 },
    headStyles: {
      fillColor: [4, 12, 30],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
    },
    head: [['#', 'Descripción', 'Cant.', 'Precio Unit.', 'Desc.', 'ITBIS', 'Total Línea']],
    body: doc.items.map((item) => [
      String(item.lineNumber),
      item.description,
      `${item.quantity.toFixed(2)} ${item.unitOfMeasure}`,
      formatMoney(item.unitPrice, doc.currency),
      formatMoney(item.discountAmount, doc.currency),
      item.isExempt ? 'Exento' : `${item.itbisRate}% (${formatMoney(item.itbisAmount, doc.currency)})`,
      formatMoney(item.lineTotal, doc.currency),
    ]),
  });

  const finalY = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? yCursor + 40) + 6;

  // Bottom Left: QR + Security Code + TrackId
  pdf.addImage(qrDataUrl, 'PNG', 14, finalY, 34, 34);
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(`Código de Seguridad: ${doc.securityCode || 'PENDIENTE'}`, 52, finalY + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(`Fecha Firma Digital: ${doc.signedAt ? doc.signedAt.slice(0, 19).replace('T', ' ') : 'No firmado'}`, 52, finalY + 13);
  pdf.text(`TrackId DGII: ${doc.trackId || 'N/A'}`, 52, finalY + 18.5);
  pdf.text(`Validación QR DGII:`, 52, finalY + 24);
  pdf.setFontSize(6.5);
  pdf.setTextColor(0, 82, 204);
  pdf.text(qrUrl, 52, finalY + 28.5, { maxWidth: 78 });

  // Bottom Right: Totals Box
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(134, finalY, 68, 36, 2, 2, 'FD');
  pdf.setTextColor(30, 41, 59);
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Subtotal Bruto:', 138, finalY + 7);
  pdf.text(formatMoney(doc.subtotal, doc.currency), 198, finalY + 7, { align: 'right' });
  pdf.text('Descuentos:', 138, finalY + 13);
  pdf.text(formatMoney(doc.totalDiscount, doc.currency), 198, finalY + 13, { align: 'right' });
  pdf.text('ITBIS Facturado:', 138, finalY + 19);
  pdf.text(formatMoney(doc.totalItbis, doc.currency), 198, finalY + 19, { align: 'right' });
  pdf.text('Otros Impuestos:', 138, finalY + 25);
  pdf.text(formatMoney(doc.otherTaxesTotal, doc.currency), 198, finalY + 25, { align: 'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(4, 12, 30);
  pdf.text('TOTAL GENERAL:', 138, finalY + 32.5);
  pdf.text(formatMoney(doc.totalAmount, doc.currency), 198, finalY + 32.5, { align: 'right' });

  if (doc.notes) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Observaciones: ${doc.notes}`, 14, finalY + 42, { maxWidth: 188 });
  }

  return pdf;
}
