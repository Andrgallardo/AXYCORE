import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface FinancialPerformanceSummary {
  totalSubmitted: number;
  approvedCount: number;
  rejectedCount: number;
  approvalRatePct: number;
  averageScore: number | null;
  requestedDop: number;
  requestedUsd: number;
  approvedDop: number;
  approvedUsd: number;
  disbursedDop: number;
  disbursedUsd: number;
  activePrincipalDop: number;
  activePrincipalUsd: number;
}

export interface ExportReportPayload {
  reportId: string;
  reportTitle: string;
  reportSubtitle: string;
  organizationName: string;
  organizationTaxId?: string;
  primaryColor?: string;
  policyVersion: string;
  filtersSummary: string;
  generatedBy: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  financialSummary: FinancialPerformanceSummary;
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function hexToRgb(hex: string | undefined): [number, number, number] {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return [15, 61, 145];
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function formatNumberOrText(cell: string | number): string {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    return cell.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(cell) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  return String(cell ?? '—');
}

function formatMoneyPlain(amount: number, currency: 'DOP' | 'USD'): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function buildCsvContent(payload: ExportReportPayload, includeMetadataHeader = true): string {
  const lines: string[] = [];

  if (includeMetadataHeader) {
    lines.push([escapeCsvCell('Entidad'), escapeCsvCell(payload.organizationName)].join(','));
    lines.push([escapeCsvCell('Reporte'), escapeCsvCell(payload.reportTitle)].join(','));
    lines.push([escapeCsvCell('Filtros'), escapeCsvCell(payload.filtersSummary)].join(','));
    lines.push([escapeCsvCell('Política'), escapeCsvCell(payload.policyVersion)].join(','));
    lines.push([escapeCsvCell('Generado por'), escapeCsvCell(payload.generatedBy)].join(','));
    lines.push([
      escapeCsvCell('Resumen Desempeño'),
      escapeCsvCell(
        `Solicitudes: ${payload.financialSummary.totalSubmitted} | Tasa Aprobación: ${payload.financialSummary.approvalRatePct.toFixed(1)}% | Desembolsado DOP: ${formatMoneyPlain(payload.financialSummary.disbursedDop, 'DOP')} | Desembolsado USD: ${formatMoneyPlain(payload.financialSummary.disbursedUsd, 'USD')}`
      ),
    ].join(','));
    lines.push('');
  }

  lines.push(payload.columns.map(escapeCsvCell).join(','));
  for (const row of payload.rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}

export function exportReportToCsv(payload: ExportReportPayload): string {
  const csvContent = buildCsvContent(payload, true);
  const dateTag = new Date().toISOString().slice(0, 10);
  const fileName = `AxyCore_${payload.reportId}_${dateTag}.csv`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return fileName;
}

export function exportReportToPdf(payload: ExportReportPayload): string {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const brandRgb = hexToRgb(payload.primaryColor);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const generatedAt = new Date().toLocaleString('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Top Institutional Banner
  doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
  doc.rect(0, 0, pageWidth, 64, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(payload.organizationName, 36, 26);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `${payload.organizationTaxId ? `RNC: ${payload.organizationTaxId} · ` : ''}Módulo Integral de Préstamos · Política ${payload.policyVersion}`,
    36,
    43
  );

  doc.setFontSize(8.5);
  doc.text(`Generado: ${generatedAt}`, pageWidth - 36, 26, { align: 'right' });
  doc.text(`Usuario: ${payload.generatedBy}`, pageWidth - 36, 43, { align: 'right' });

  // Report Title & Active Filters
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(payload.reportTitle, 36, 88);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`${payload.reportSubtitle} · ${payload.filtersSummary}`, 36, 104);

  // Executive Financial & Credit Performance Summary Table
  const fs = payload.financialSummary;
  autoTable(doc, {
    startY: 116,
    margin: { left: 36, right: 36 },
    theme: 'grid',
    head: [[
      'Solicitudes',
      'Tasa Aprobación',
      'Score Prom. V2',
      'Solicitado DOP / USD',
      'Aprobado DOP / USD',
      'Desembolsado DOP / USD',
      'Saldo Activo DOP / USD',
    ]],
    body: [[
      `${fs.totalSubmitted} (${fs.approvedCount} apr. / ${fs.rejectedCount} rech.)`,
      `${fs.approvalRatePct.toFixed(1)}%`,
      fs.averageScore !== null ? `${fs.averageScore.toFixed(1)}/100` : '—',
      `${formatMoneyPlain(fs.requestedDop, 'DOP')}\n${formatMoneyPlain(fs.requestedUsd, 'USD')}`,
      `${formatMoneyPlain(fs.approvedDop, 'DOP')}\n${formatMoneyPlain(fs.approvedUsd, 'USD')}`,
      `${formatMoneyPlain(fs.disbursedDop, 'DOP')}\n${formatMoneyPlain(fs.disbursedUsd, 'USD')}`,
      `${formatMoneyPlain(fs.activePrincipalDop, 'DOP')}\n${formatMoneyPlain(fs.activePrincipalUsd, 'USD')}`,
    ]],
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [51, 65, 85],
      fontStyle: 'bold',
    },
  });

  const summaryEndY =
    (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 170;

  // Main Report Data Table
  const formattedRows =
    payload.rows.length > 0
      ? payload.rows.map((r) => r.map((cell) => formatNumberOrText(cell)))
      : [payload.columns.map((_, idx) => (idx === 0 ? 'Sin registros para los filtros seleccionados' : ''))];

  autoTable(doc, {
    startY: summaryEndY + 14,
    margin: { left: 36, right: 36, bottom: 42 },
    head: [payload.columns],
    body: formattedRows,
    theme: 'striped',
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 4.5,
      overflow: 'linebreak',
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: brandRgb,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didDrawPage: (data) => {
      const totalPages = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `${payload.organizationName} · Documento de gestión documental generado por AxyCore`,
        36,
        pageHeight - 18
      );
      doc.text(
        `Página ${data.pageNumber} de ${totalPages}`,
        pageWidth - 36,
        pageHeight - 18,
        { align: 'right' }
      );
    },
  });

  const dateTag = new Date().toISOString().slice(0, 10);
  const fileName = `AxyCore_${payload.reportId}_${dateTag}.pdf`;
  doc.save(fileName);
  return fileName;
}
