import { jsPDF } from 'jspdf';
import type {
  CollectionReceiptRecord,
  CustomerRecord,
  LoanRecord,
  OrganizationRecord,
  PaymentChannelMethod,
  PaymentRecord,
  ProductCode,
} from '../types/axycore';
import { isValidInstitutionalLogoUrl } from './institutionalLogo';

export interface PaymentReceiptPalette {
  primary: string;
  primaryDark: string;
  accent: string;
  ribbonHighlight: string;
  softSurface: string;
  softBorder: string;
  totalBand: string;
}

export interface PaymentReceiptLineItem {
  label: string;
  amountFormatted: string;
  amount: number;
}

export interface PaymentReceiptViewData {
  receiptNumber: string;
  displayReceiptNumber: string;
  status: CollectionReceiptRecord['status'];
  institutionName: string;
  institutionNameTop: string;
  institutionNameBottom: string;
  institutionSubtitle: string;
  institutionPhone: string;
  institutionInitials: string;
  logoUrl: string | null;
  customerName: string;
  customerDocumentLabel: string;
  customerDocumentValue: string;
  loanNumber: string;
  productLabel: string;
  currency: 'DOP' | 'USD';
  lineItems: PaymentReceiptLineItem[];
  totalPaidFormatted: string;
  previousBalanceFormatted: string;
  newBalanceFormatted: string;
  paymentDateFormatted: string;
  paymentTimeFormatted: string;
  paymentMethodLabel: string;
  referenceNumber: string;
  issuedByName: string;
  thankYouMessage: string;
  palette: PaymentReceiptPalette;
}

export interface PaymentReceiptInput {
  receipt: CollectionReceiptRecord;
  organization: OrganizationRecord;
  payment?: PaymentRecord | null;
  loan?: LoanRecord | null;
  customer?: CustomerRecord | null;
}

const PRODUCT_DISPLAY_LABELS: Record<ProductCode, string> = {
  PERSONAL_DOP: 'Personal (DOP)',
  EMPRESARIAL_DOP: 'MiPYMES / Empresarial (DOP)',
  PERSONAL_USD: 'Personal (USD)',
  EMPRESARIAL_USD: 'MiPYMES / Empresarial (USD)',
};

const METHOD_DISPLAY_LABELS: Record<PaymentChannelMethod, string> = {
  CAJA_EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  DEPOSITO: 'Depósito',
  TARJETA: 'Tarjeta',
  CHEQUE: 'Cheque',
  LINK_PAGO: 'Link de Pago',
  OTRO: 'Otro',
};

function parseHexRgb(hex?: string | null): [number, number, number] | null {
  if (!hex || typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return [
      parseInt(cleaned[0] + cleaned[0], 16),
      parseInt(cleaned[1] + cleaned[1], 16),
      parseInt(cleaned[2] + cleaned[2], 16),
    ];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  ratioB: number
): [number, number, number] {
  const t = Math.max(0, Math.min(1, ratioB));
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function deriveReceiptPalette(org: OrganizationRecord): PaymentReceiptPalette {
  const rawPrimary = parseHexRgb(org.primaryColor);
  const rawAccent = parseHexRgb(org.accentColor);

  // Ensure corporate header navy/primary is always crisp and high-contrast for white text
  let primaryRgb: [number, number, number] = rawPrimary ?? [9, 44, 102];
  // If org uses near-black default (#0B1220) with vibrant blue accent (#2563EB), blend into rich corporate navy
  if (
    rawPrimary &&
    rawAccent &&
    relativeLuminance(rawPrimary) < 0.11 &&
    rawAccent[2] > rawAccent[0] + 40
  ) {
    primaryRgb = mixRgb(rawPrimary, rawAccent, 0.32);
  }
  if (relativeLuminance(primaryRgb) > 0.45) {
    primaryRgb = mixRgb(primaryRgb, [8, 25, 58], 0.55);
  }

  let accentRgb: [number, number, number] = rawAccent ?? [24, 90, 196];
  if (relativeLuminance(accentRgb) > 0.65) {
    accentRgb = mixRgb(accentRgb, primaryRgb, 0.45);
  }

  const primaryDarkRgb = mixRgb(primaryRgb, [4, 15, 38], 0.3);
  const softSurfaceRgb = mixRgb([255, 255, 255], accentRgb, 0.06);
  const softBorderRgb = mixRgb([255, 255, 255], accentRgb, 0.28);
  const totalBandRgb = mixRgb([255, 255, 255], accentRgb, 0.16);

  return {
    primary: rgbToHex(...primaryRgb),
    primaryDark: rgbToHex(...primaryDarkRgb),
    accent: rgbToHex(...accentRgb),
    ribbonHighlight: '#C81E1E',
    softSurface: rgbToHex(...softSurfaceRgb),
    softBorder: rgbToHex(...softBorderRgb),
    totalBand: rgbToHex(...totalBandRgb),
  };
}

export function formatReceiptMoney(amount: number, currency: 'DOP' | 'USD'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return currency === 'USD' ? `US$ ${formatted}` : `RD$ ${formatted}`;
}

function formatDocumentNumber(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
  }
  return raw.trim();
}

function formatReceiptDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const trimmed = dateStr.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return trimmed;
}

function extractTimestampDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'object') {
    const obj = raw as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') {
      const d = obj.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof obj.seconds === 'number') {
      return new Date(obj.seconds * 1000);
    }
  }
  return null;
}

function formatReceiptTime(
  issuedAt?: string | null,
  payment?: PaymentRecord | null,
  createdAt?: unknown
): string {
  const candidates = [
    issuedAt,
    payment?.appliedAt,
    payment?.createdAt,
    createdAt,
  ];
  for (const c of candidates) {
    const d = extractTimestampDate(c);
    if (d) {
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    }
  }
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function splitInstitutionName(fullName: string): { top: string; bottom: string } {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  if (words.length <= 2) {
    return { top: clean, bottom: '' };
  }
  const midpoint = Math.ceil(words.length / 2);
  return {
    top: words.slice(0, midpoint).join(' '),
    bottom: words.slice(midpoint).join(' '),
  };
}

function getInstitutionInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 'IN';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function buildPaymentReceiptViewData(
  input: PaymentReceiptInput
): PaymentReceiptViewData {
  const { receipt, organization, payment, loan, customer } = input;
  const currency: 'DOP' | 'USD' = receipt.currency === 'USD' ? 'USD' : 'DOP';
  const institutionName = (
    organization.tradeName ||
    organization.name ||
    'Institución Financiera'
  ).trim();
  const { top, bottom } = splitInstitutionName(institutionName);

  const taxId = (organization.taxId || organization.rnc || '').trim();
  const institutionPhone = (organization.phone || '').trim();
  const subtitleParts: string[] = [];
  if (taxId) subtitleParts.push(`RNC: ${taxId}`);
  if (institutionPhone) subtitleParts.push(`Tel.: ${institutionPhone}`);
  const institutionSubtitle =
    subtitleParts.length > 0
      ? subtitleParts.join(' · ')
      : 'Comprobante Oficial de Pago';

  const logoUrl = isValidInstitutionalLogoUrl(organization.logoUrl)
    ? organization.logoUrl!.trim()
    : null;

  const docTypeLabel =
    customer?.documentType === 'PASAPORTE' ? 'Pasaporte' : 'Cédula';
  const docValue = customer?.documentNumber
    ? formatDocumentNumber(customer.documentNumber)
    : receipt.referenceNumber || '—';

  const productLabel = loan?.productCode
    ? PRODUCT_DISPLAY_LABELS[loan.productCode] || loan.productCode
    : currency === 'USD'
    ? 'Crédito en Dólares (USD)'
    : 'Crédito en Pesos (DOP)';

  const appliedPrincipal = Number(receipt.appliedToPrincipal || 0);
  const appliedInterest = Number(receipt.appliedToInterest || 0);
  const appliedLateFee = Number(receipt.appliedToLateFee || 0);
  const appliedCharges = Number(receipt.appliedToCharges || 0);
  const remainingAfter = Math.max(0, Number(receipt.remainingPrincipalAfter || 0));
  const previousBalance = Math.max(0, remainingAfter + appliedPrincipal);

  const lineItems: PaymentReceiptLineItem[] = [
    {
      label: 'Capital:',
      amount: appliedPrincipal,
      amountFormatted: formatReceiptMoney(appliedPrincipal, currency),
    },
    {
      label: 'Intereses:',
      amount: appliedInterest,
      amountFormatted: formatReceiptMoney(appliedInterest, currency),
    },
  ];

  if (appliedLateFee > 0) {
    lineItems.push({
      label: 'Mora:',
      amount: appliedLateFee,
      amountFormatted: formatReceiptMoney(appliedLateFee, currency),
    });
  }

  lineItems.push({
    label: 'Otros Cargos:',
    amount: appliedCharges,
    amountFormatted: formatReceiptMoney(appliedCharges, currency),
  });

  const paymentMethodLabel = payment?.method
    ? METHOD_DISPLAY_LABELS[payment.method] || payment.method
    : 'Pago Aplicado';

  const displayReceiptNumber = receipt.receiptNumber
    .replace(/^REC[-_]?/i, '')
    .trim() || receipt.receiptNumber;

  return {
    receiptNumber: receipt.receiptNumber,
    displayReceiptNumber,
    status: receipt.status,
    institutionName,
    institutionNameTop: top,
    institutionNameBottom: bottom,
    institutionSubtitle,
    institutionPhone,
    institutionInitials: getInstitutionInitials(institutionName),
    logoUrl,
    customerName: (receipt.customerName || 'CLIENTE').trim().toUpperCase(),
    customerDocumentLabel: customer?.documentNumber ? `${docTypeLabel}:` : 'Ref.:',
    customerDocumentValue: docValue,
    loanNumber: receipt.loanNumber || loan?.loanNumber || '—',
    productLabel,
    currency,
    lineItems,
    totalPaidFormatted: formatReceiptMoney(receipt.amount, currency),
    previousBalanceFormatted: formatReceiptMoney(previousBalance, currency),
    newBalanceFormatted: formatReceiptMoney(remainingAfter, currency),
    paymentDateFormatted: formatReceiptDate(receipt.paymentDate),
    paymentTimeFormatted: formatReceiptTime(receipt.issuedAt, payment, receipt.createdAt),
    paymentMethodLabel,
    referenceNumber: receipt.referenceNumber || '',
    issuedByName: receipt.issuedByName || 'Administración',
    thankYouMessage: '¡Gracias por ser parte de nuestra familia!',
    palette: deriveReceiptPalette(organization),
  };
}

function loadCanvasImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: number | [number, number, number, number]
): void {
  const [tl, tr, br, bl] = Array.isArray(radii)
    ? radii
    : [radii, radii, radii, radii];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(result + '…').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

function drawUserIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 28, y + 18, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 58);
  ctx.quadraticCurveTo(x + 4, y + 36, x + 28, y + 36);
  ctx.quadraticCurveTo(x + 52, y + 36, x + 52, y + 58);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCreditDocIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  drawRoundedRectPath(ctx, x + 2, y + 2, 42, 54, 7);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < 3; i++) {
    drawRoundedRectPath(ctx, x + 10, y + 14 + i * 11, i === 2 ? 16 : 24, 4, 2);
    ctx.fill();
  }

  // Dollar badge in bottom-right
  ctx.fillStyle = '#F1F6FE';
  ctx.beginPath();
  ctx.arc(x + 46, y + 48, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = '800 22px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', x + 46, y + 49);
  ctx.restore();
}

function drawCoinsIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = 2.4;

  // Back stack
  ctx.beginPath();
  ctx.ellipse(x + 27, y + 10, 12, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x + 27, y + 10 + i * 7, 12, 4.5, 0, 0, Math.PI);
    ctx.stroke();
  }

  // Front shorter stack
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(x + 13, y + 22, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 13, y + 29, 11, 4, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawBarChartIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  drawRoundedRectPath(ctx, x + 4, y + 22, 8, 14, 2);
  ctx.fill();
  drawRoundedRectPath(ctx, x + 16, y + 14, 8, 22, 2);
  ctx.fill();
  drawRoundedRectPath(ctx, x + 28, y + 6, 8, 30, 2);
  ctx.fill();
  ctx.restore();
}

function drawCalendarIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.2;
  drawRoundedRectPath(ctx, x + 4, y + 10, 44, 40, 7);
  ctx.stroke();
  ctx.fillRect(x + 4, y + 18, 44, 6);
  ctx.fillRect(x + 14, y + 4, 5, 11);
  ctx.fillRect(x + 33, y + 4, 5, 11);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      ctx.fillRect(x + 12 + c * 11, y + 30 + r * 9, 6, 5);
    }
  }
  ctx.restore();
}

function drawClockIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.8;
  ctx.beginPath();
  ctx.arc(x + 26, y + 29, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 26, y + 17);
  ctx.lineTo(x + 26, y + 29);
  ctx.lineTo(x + 35, y + 34);
  ctx.stroke();
  ctx.restore();
}

function drawCardIcon(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3.4;
  drawRoundedRectPath(ctx, x + 2, y + 11, 50, 36, 7);
  ctx.stroke();
  ctx.fillRect(x + 2, y + 20, 50, 7);
  ctx.fillRect(x + 10, y + 34, 12, 5);
  ctx.restore();
}

/**
 * Renders the institutional payment receipt onto a crisp high-resolution canvas
 * matching the corporate visual standard (institution logo, dynamic brand palette,
 * curved header/footer ribbons, structured breakdown & account summary).
 */
export async function renderPaymentReceiptCanvas(
  data: PaymentReceiptViewData
): Promise<HTMLCanvasElement> {
  const width = 1200;
  const extraRowsHeight = Math.max(0, data.lineItems.length - 3) * 56;
  const voidBannerHeight = data.status === 'ANULADO_POR_REVERSO' ? 56 : 0;
  const height = 1280 + extraRowsHeight + voidBannerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No se pudo inicializar el generador visual del recibo.');
  }

  const { palette } = data;
  const outerPad = 14;
  const cardX = outerPad;
  const cardY = outerPad;
  const cardW = width - outerPad * 2;
  const cardH = height - outerPad * 2;

  // Clip to rounded corporate outer card
  ctx.save();
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();

  // Subtle top-right soft wave backdrop
  ctx.fillStyle = palette.softSurface;
  ctx.beginPath();
  ctx.moveTo(cardX + cardW * 0.42, cardY + 240);
  ctx.bezierCurveTo(
    cardX + cardW * 0.65,
    cardY + 195,
    cardX + cardW * 0.85,
    cardY + 215,
    cardX + cardW,
    cardY + 175
  );
  ctx.lineTo(cardX + cardW, cardY + 250);
  ctx.lineTo(cardX + cardW * 0.42, cardY + 250);
  ctx.closePath();
  ctx.fill();

  // Top-right corporate "Recibo de Pago" rounded header pill docked to top-right
  const badgeW = 472;
  const badgeH = 152;
  const badgeX = cardX + cardW - badgeW;
  const badgeY = cardY;
  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
  badgeGrad.addColorStop(0, palette.primaryDark);
  badgeGrad.addColorStop(1, palette.primary);
  drawRoundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, [0, 30, 0, 74]);
  ctx.fillStyle = badgeGrad;
  ctx.fill();

  // Flowing dual-tone ribbon swoosh below top-right badge
  ctx.beginPath();
  ctx.moveTo(cardX + 540, cardY + 236);
  ctx.bezierCurveTo(
    cardX + 730,
    cardY + 175,
    cardX + 940,
    cardY + 195,
    cardX + cardW,
    cardY + 148
  );
  ctx.lineTo(cardX + cardW, cardY + 186);
  ctx.bezierCurveTo(
    cardX + 950,
    cardY + 218,
    cardX + 735,
    cardY + 192,
    cardX + 540,
    cardY + 236
  );
  ctx.closePath();
  ctx.fillStyle = palette.ribbonHighlight;
  ctx.fill();

  // Secondary navy accent tail beneath crimson swoosh
  ctx.beginPath();
  ctx.moveTo(cardX + 890, cardY + 204);
  ctx.bezierCurveTo(
    cardX + 1010,
    cardY + 206,
    cardX + 1110,
    cardY + 198,
    cardX + cardW,
    cardY + 178
  );
  ctx.lineTo(cardX + cardW, cardY + 202);
  ctx.bezierCurveTo(
    cardX + 1105,
    cardY + 214,
    cardX + 1005,
    cardY + 214,
    cardX + 890,
    cardY + 204
  );
  ctx.closePath();
  ctx.fillStyle = palette.primary;
  ctx.fill();

  // Badge text ("Recibo de Pago" & "N° ...")
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 54px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText('Recibo de Pago', badgeX + badgeW * 0.52, badgeY + 62);
  ctx.font = '600 34px "JetBrains Mono", "DM Sans", monospace';
  const receiptNumLabel = truncateTextToWidth(
    ctx,
    `N° ${data.displayReceiptNumber}`,
    badgeW - 56
  );
  ctx.fillText(receiptNumLabel, badgeX + badgeW * 0.52, badgeY + 116);

  // Top-left Institution Logo + Vertical Divider + Institution Name
  const logoBoxX = cardX + 36;
  const logoBoxY = cardY + 32;
  const logoBoxW = 166;
  const logoBoxH = 158;

  let drawnLogo = false;
  if (data.logoUrl) {
    const img = await loadCanvasImage(data.logoUrl);
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const scale = Math.min(
        logoBoxW / img.naturalWidth,
        logoBoxH / img.naturalHeight
      );
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = logoBoxX + (logoBoxW - dw) / 2;
      const dy = logoBoxY + (logoBoxH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      drawnLogo = true;
    }
  }

  if (!drawnLogo) {
    const emblemGrad = ctx.createLinearGradient(
      logoBoxX,
      logoBoxY,
      logoBoxX + logoBoxW,
      logoBoxY + logoBoxH
    );
    emblemGrad.addColorStop(0, palette.primaryDark);
    emblemGrad.addColorStop(1, palette.accent);
    drawRoundedRectPath(ctx, logoBoxX + 12, logoBoxY + 10, 142, 138, 28);
    ctx.fillStyle = emblemGrad;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 60px "Plus Jakarta Sans", "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.institutionInitials, logoBoxX + 83, logoBoxY + 82);
  }

  // Vertical brand divider
  const dividerX = logoBoxX + logoBoxW + 22;
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(dividerX, cardY + 42);
  ctx.lineTo(dividerX, cardY + 190);
  ctx.stroke();

  // Institution Brand Text
  const brandTextX = dividerX + 24;
  const brandMaxW = badgeX - brandTextX - 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (data.institutionNameBottom) {
    ctx.fillStyle = palette.primaryDark;
    ctx.font = '800 50px "Plus Jakarta Sans", "DM Sans", sans-serif';
    ctx.fillText(
      truncateTextToWidth(ctx, data.institutionNameTop, brandMaxW),
      brandTextX,
      cardY + 94
    );
    ctx.fillStyle = palette.accent;
    ctx.font = '800 44px "Plus Jakarta Sans", "DM Sans", sans-serif';
    ctx.fillText(
      truncateTextToWidth(ctx, data.institutionNameBottom, brandMaxW),
      brandTextX,
      cardY + 144
    );
  } else {
    ctx.fillStyle = palette.primaryDark;
    ctx.font = '800 48px "Plus Jakarta Sans", "DM Sans", sans-serif';
    ctx.fillText(
      truncateTextToWidth(ctx, data.institutionNameTop, brandMaxW),
      brandTextX,
      cardY + 118
    );
  }

  ctx.fillStyle = palette.primary;
  let subtitleFontSize = 21;
  ctx.font = `italic 600 ${subtitleFontSize}px "DM Sans", sans-serif`;
  if (ctx.measureText(data.institutionSubtitle).width > brandMaxW) {
    subtitleFontSize = 17.5;
    ctx.font = `italic 600 ${subtitleFontSize}px "DM Sans", sans-serif`;
  }
  ctx.fillText(
    truncateTextToWidth(ctx, data.institutionSubtitle, brandMaxW),
    brandTextX,
    cardY + 182
  );

  // Content horizontal margins
  const contentX = cardX + 36;
  const contentW = cardW - 72;
  let curY = cardY + 244;

  // Optional Voided Receipt Warning Banner
  if (data.status === 'ANULADO_POR_REVERSO') {
    drawRoundedRectPath(ctx, contentX, curY, contentW, 44, 12);
    ctx.fillStyle = '#FEF2F2';
    ctx.fill();
    ctx.strokeStyle = '#DC2626';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#B91C1C';
    ctx.font = '800 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      'RECIBO ANULADO POR REVERSO AUTORIZADO — SIN VALIDEZ DE COBRO',
      contentX + contentW / 2,
      curY + 22
    );
    curY += 58;
  }

  // CLIENTE & CRÉDITO Dual-Column Box
  const infoH = 152;
  drawRoundedRectPath(ctx, contentX, curY, contentW, infoH, 24);
  ctx.fillStyle = palette.softSurface;
  ctx.fill();
  ctx.strokeStyle = palette.softBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  const midX = contentX + contentW * 0.49;
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(midX, curY + 22);
  ctx.lineTo(midX, curY + infoH - 22);
  ctx.stroke();

  // Left: Cliente
  drawUserIcon(ctx, contentX + 24, curY + 34, palette.primary);
  const leftTextX = contentX + 98;
  const leftMaxW = midX - leftTextX - 20;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.primary;
  ctx.font = '700 28px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText('Cliente:', leftTextX, curY + 48);

  ctx.fillStyle = '#0B162C';
  ctx.font = '800 29px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText(
    truncateTextToWidth(ctx, data.customerName, leftMaxW),
    leftTextX,
    curY + 90
  );

  ctx.fillStyle = '#1E293B';
  ctx.font = '600 24px "DM Sans", sans-serif';
  ctx.fillText(
    truncateTextToWidth(
      ctx,
      `${data.customerDocumentLabel} ${data.customerDocumentValue}`,
      leftMaxW
    ),
    leftTextX,
    curY + 128
  );

  // Right: Crédito
  drawCreditDocIcon(ctx, midX + 34, curY + 34, palette.primary);
  const rightTextX = midX + 114;
  const rightMaxW = contentX + contentW - rightTextX - 22;
  ctx.fillStyle = palette.primary;
  ctx.font = '700 28px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText('Crédito:', rightTextX, curY + 48);

  ctx.fillStyle = '#0B162C';
  ctx.font = '600 25px "DM Sans", sans-serif';
  ctx.fillText(
    truncateTextToWidth(ctx, `Préstamo N°: ${data.loanNumber}`, rightMaxW),
    rightTextX,
    curY + 90
  );
  ctx.fillText(
    truncateTextToWidth(ctx, `Producto: ${data.productLabel}`, rightMaxW),
    rightTextX,
    curY + 128
  );

  curY += infoH + 28;

  // SECTION 1: DETALLE DEL PAGO
  const detailHeaderH = 66;
  const detailRowH = 56;
  const detailTotalH = 68;
  const detailBoxH = detailHeaderH + data.lineItems.length * detailRowH + detailTotalH + 14;

  ctx.save();
  drawRoundedRectPath(ctx, contentX, curY, contentW, detailBoxH, 24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();

  // Header bar
  const headerGrad = ctx.createLinearGradient(contentX, curY, contentX + contentW, curY);
  headerGrad.addColorStop(0, palette.primaryDark);
  headerGrad.addColorStop(1, palette.primary);
  ctx.fillStyle = headerGrad;
  ctx.fillRect(contentX, curY, contentW, detailHeaderH);

  drawCoinsIcon(ctx, contentX + 26, curY + 15);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Detalle del Pago', contentX + 86, curY + detailHeaderH / 2 + 1);

  // Breakdown rows
  let rowY = curY + detailHeaderH + 12;
  for (const item of data.lineItems) {
    ctx.fillStyle = '#0F172A';
    ctx.font = '500 31px "DM Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, contentX + 46, rowY + detailRowH / 2);

    ctx.font = '600 31px "JetBrains Mono", "DM Sans", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(item.amountFormatted, contentX + contentW - 42, rowY + detailRowH / 2);
    rowY += detailRowH;
  }

  // Highlighted Total Pagado strip
  const totalY = curY + detailBoxH - detailTotalH;
  ctx.fillStyle = palette.totalBand;
  ctx.fillRect(contentX, totalY, contentW, detailTotalH);

  ctx.fillStyle = palette.primaryDark;
  ctx.font = '800 36px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Total Pagado:', contentX + 46, totalY + detailTotalH / 2);

  ctx.font = '800 38px "JetBrains Mono", "Plus Jakarta Sans", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(data.totalPaidFormatted, contentX + contentW - 42, totalY + detailTotalH / 2);
  ctx.restore();

  // Outer border for Detalle del Pago
  drawRoundedRectPath(ctx, contentX, curY, contentW, detailBoxH, 24);
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  curY += detailBoxH + 26;

  // SECTION 2: RESUMEN DE CUENTA
  const summaryHeaderH = 62;
  const summaryRowH = 56;
  const summaryBoxH = summaryHeaderH + summaryRowH * 2 + 16;

  ctx.save();
  drawRoundedRectPath(ctx, contentX, curY, contentW, summaryBoxH, 24);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();

  const summaryGrad = ctx.createLinearGradient(contentX, curY, contentX + contentW, curY);
  summaryGrad.addColorStop(0, palette.primaryDark);
  summaryGrad.addColorStop(1, palette.primary);
  ctx.fillStyle = summaryGrad;
  ctx.fillRect(contentX, curY, contentW, summaryHeaderH);

  drawBarChartIcon(ctx, contentX + 28, curY + 12);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 34px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Resumen de Cuenta', contentX + 86, curY + summaryHeaderH / 2 + 1);

  const summaryRows = [
    { label: 'Saldo Anterior:', value: data.previousBalanceFormatted, bold: false },
    { label: 'Nuevo Saldo:', value: data.newBalanceFormatted, bold: true },
  ];
  let sumRowY = curY + summaryHeaderH + 10;
  for (const sRow of summaryRows) {
    ctx.fillStyle = '#0F172A';
    ctx.font = sRow.bold
      ? '700 31px "Plus Jakarta Sans", "DM Sans", sans-serif'
      : '500 31px "DM Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(sRow.label, contentX + 46, sumRowY + summaryRowH / 2);

    ctx.fillStyle = sRow.bold ? palette.primaryDark : '#0F172A';
    ctx.font = sRow.bold
      ? '700 31px "JetBrains Mono", "DM Sans", monospace'
      : '600 31px "JetBrains Mono", "DM Sans", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(sRow.value, contentX + contentW - 42, sumRowY + summaryRowH / 2);
    sumRowY += summaryRowH;
  }
  ctx.restore();

  drawRoundedRectPath(ctx, contentX, curY, contentW, summaryBoxH, 24);
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  curY += summaryBoxH + 34;

  // METADATA ROW: Fecha de Pago | Hora | Método
  const col1X = contentX + 12;
  const col2X = contentX + contentW * 0.36;
  const col3X = contentX + contentW * 0.69;

  // Column 1: Fecha
  drawCalendarIcon(ctx, col1X, curY, palette.primary);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1E293B';
  ctx.font = '600 24px "DM Sans", sans-serif';
  ctx.fillText('Fecha de Pago:', col1X + 68, curY + 23);
  ctx.fillStyle = '#0B162C';
  ctx.font = '700 29px "JetBrains Mono", "DM Sans", monospace';
  ctx.fillText(data.paymentDateFormatted, col1X + 68, curY + 56);

  // Divider 1
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(col2X - 28, curY + 4);
  ctx.lineTo(col2X - 28, curY + 62);
  ctx.stroke();

  // Column 2: Hora
  drawClockIcon(ctx, col2X, curY, palette.primary);
  ctx.fillStyle = '#1E293B';
  ctx.font = '600 24px "DM Sans", sans-serif';
  ctx.fillText('Hora:', col2X + 66, curY + 23);
  ctx.fillStyle = '#0B162C';
  ctx.font = '700 29px "JetBrains Mono", "DM Sans", monospace';
  ctx.fillText(data.paymentTimeFormatted, col2X + 66, curY + 56);

  // Divider 2
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(col3X - 28, curY + 4);
  ctx.lineTo(col3X - 28, curY + 62);
  ctx.stroke();

  // Column 3: Método
  drawCardIcon(ctx, col3X, curY, palette.primary);
  ctx.fillStyle = '#1E293B';
  ctx.font = '600 24px "DM Sans", sans-serif';
  ctx.fillText('Método:', col3X + 68, curY + 23);
  ctx.fillStyle = '#0B162C';
  ctx.font = '700 28px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText(
    truncateTextToWidth(ctx, data.paymentMethodLabel, contentX + contentW - (col3X + 68)),
    col3X + 68,
    curY + 56
  );

  curY += 108;

  // THANK YOU SCRIPT + SIGNATURE BLOCK
  ctx.fillStyle = palette.primaryDark;
  ctx.font = 'italic 700 44px "Brush Script MT", "Segoe Script", Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(
    truncateTextToWidth(ctx, data.thankYouMessage, contentW * 0.65),
    contentX + 8,
    curY + 24
  );

  // Delicate curved crimson accent underline beneath thank-you message
  ctx.beginPath();
  ctx.moveTo(contentX + 260, curY + 48);
  ctx.quadraticCurveTo(contentX + 455, curY + 28, contentX + 635, curY + 52);
  ctx.quadraticCurveTo(contentX + 455, curY + 38, contentX + 260, curY + 48);
  ctx.closePath();
  ctx.fillStyle = palette.ribbonHighlight;
  ctx.fill();

  // Quiet audit reference line below thank you
  if (data.referenceNumber || data.issuedByName) {
    ctx.fillStyle = '#64748B';
    ctx.font = '500 18px "DM Sans", sans-serif';
    const refParts: string[] = [];
    if (data.referenceNumber) refParts.push(`Ref.: ${data.referenceNumber}`);
    if (data.issuedByName) refParts.push(`Validado por: ${data.issuedByName}`);
    ctx.fillText(
      truncateTextToWidth(ctx, refParts.join('  ·  '), contentW * 0.62),
      contentX + 8,
      curY + 76
    );
  }

  // Right Signature Block ("Autorizado por ...")
  const sigX1 = contentX + contentW - 320;
  const sigX2 = contentX + contentW - 4;
  const sigMidX = (sigX1 + sigX2) / 2;

  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sigX1, curY + 12);
  ctx.lineTo(sigX2, curY + 12);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#334155';
  ctx.font = '600 22px "DM Sans", sans-serif';
  ctx.fillText('Autorizado por', sigMidX, curY + 42);

  ctx.fillStyle = palette.primaryDark;
  ctx.font = 'italic 800 25px "Plus Jakarta Sans", "DM Sans", sans-serif';
  ctx.fillText(
    truncateTextToWidth(ctx, data.institutionName, 316),
    sigMidX,
    curY + 72
  );

  // Bottom sweeping corporate wave
  const waveTopY = cardY + cardH - 76;
  ctx.beginPath();
  ctx.moveTo(cardX, waveTopY + 34);
  ctx.bezierCurveTo(
    cardX + cardW * 0.25,
    waveTopY - 12,
    cardX + cardW * 0.68,
    waveTopY + 74,
    cardX + cardW,
    waveTopY + 18
  );
  ctx.lineTo(cardX + cardW, cardY + cardH);
  ctx.lineTo(cardX, cardY + cardH);
  ctx.closePath();
  ctx.fillStyle = palette.primary;
  ctx.fill();

  // Subtle crisp white pinstripe inside bottom wave
  ctx.beginPath();
  ctx.moveTo(cardX, waveTopY + 42);
  ctx.bezierCurveTo(
    cardX + cardW * 0.24,
    waveTopY - 2,
    cardX + cardW * 0.68,
    waveTopY + 82,
    cardX + cardW,
    waveTopY + 26
  );
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.restore();

  // Outer crisp corporate card border
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 5;
  ctx.stroke();

  return canvas;
}

export async function downloadPaymentReceiptPdf(
  input: PaymentReceiptInput
): Promise<void> {
  const data = buildPaymentReceiptViewData(input);
  const canvas = await renderPaymentReceiptCanvas(data);
  const imgData = canvas.toDataURL('image/png', 1.0);

  const docPdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = docPdf.internal.pageSize.getWidth();
  const pageH = docPdf.internal.pageSize.getHeight();
  const margin = 32;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
  const drawW = canvas.width * ratio;
  const drawH = canvas.height * ratio;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  docPdf.addImage(imgData, 'PNG', x, y, drawW, drawH, undefined, 'FAST');
  docPdf.save(`${data.receiptNumber}.pdf`);
}

export async function downloadPaymentReceiptPng(
  input: PaymentReceiptInput
): Promise<void> {
  const data = buildPaymentReceiptViewData(input);
  const canvas = await renderPaymentReceiptCanvas(data);
  const dataUrl = canvas.toDataURL('image/png', 1.0);

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${data.receiptNumber}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function printPaymentReceipt(
  input: PaymentReceiptInput
): Promise<void> {
  const data = buildPaymentReceiptViewData(input);
  const canvas = await renderPaymentReceiptCanvas(data);
  const dataUrl = canvas.toDataURL('image/png', 1.0);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Recibo de Pago ${data.receiptNumber}</title>
    <style>
      @page { margin: 12mm; }
      html, body { margin: 0; padding: 0; background: #fff; display: flex; justify-content: center; align-items: flex-start; }
      img { max-width: 100%; max-height: 265mm; width: auto; height: auto; display: block; }
    </style>
  </head>
  <body>
    <img id="receipt-img" src="${dataUrl}" alt="Recibo de Pago ${data.receiptNumber}" />
  </body>
</html>`);
  doc.close();

  const imgEl = doc.getElementById('receipt-img') as HTMLImageElement | null;
  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1500);
    }
  };

  if (imgEl && !imgEl.complete) {
    imgEl.onload = triggerPrint;
    imgEl.onerror = triggerPrint;
  } else {
    window.setTimeout(triggerPrint, 120);
  }
}
