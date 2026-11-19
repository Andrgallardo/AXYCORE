import {
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type DgiiEncfSequenceRecord,
  type EcfLifecycleStatus,
  type EcfTypeCode,
} from '../../types/dgiiEcf';
import { cleanDigits, round2 } from './dgiiCatalogAndValidation';

export interface EcfDashboardMetrics {
  totalIssuedCount: number;
  currentMonthInvoicedAmount: number;
  totalItbisBilled: number;
  acceptedCount: number;
  conditionalAcceptedCount: number;
  rejectedCount: number;
  pendingResponseCount: number;
  creditNotesCount: number;
  debitNotesCount: number;
  voidedCount: number;
  availableSequencesCount: number;
  byPeriodSeries: Array<{ period: string; facturado: number; itbis: number; documentos: number }>;
  byTypeSeries: Array<{ tipo: string; codigo: EcfTypeCode; cantidad: number; monto: number }>;
  byStatusSeries: Array<{ estado: string; status: EcfLifecycleStatus; cantidad: number }>;
}

export function computeEcfDashboardMetrics(params: {
  documents: DgiiEcfDocumentRecord[];
  sequences: DgiiEncfSequenceRecord[];
  referenceMonthYm?: string;
}): EcfDashboardMetrics {
  const {
    documents,
    sequences,
    referenceMonthYm = new Date().toISOString().slice(0, 7),
  } = params;

  const issued = documents.filter((d) => d.direction === 'EMITIDO');
  const nonDraftIssued = issued.filter((d) => d.status !== 'BORRADOR');

  const currentMonthInvoicedAmount = round2(
    nonDraftIssued
      .filter(
        (d) =>
          d.issueDate.startsWith(referenceMonthYm) &&
          d.ecfType !== '34' &&
          d.status !== 'ANULADA' &&
          d.status !== 'RECHAZADA'
      )
      .reduce((s, d) => s + d.totalAmount, 0)
  );

  const totalItbisBilled = round2(
    nonDraftIssued
      .filter((d) => d.status !== 'ANULADA' && d.status !== 'RECHAZADA')
      .reduce((s, d) => s + (d.ecfType === '34' ? -d.totalItbis : d.totalItbis), 0)
  );

  const acceptedCount = issued.filter((d) => d.status === 'ACEPTADA').length;
  const conditionalAcceptedCount = issued.filter((d) => d.status === 'ACEPTADA_CONDICIONAL').length;
  const rejectedCount = issued.filter((d) => d.status === 'RECHAZADA').length;
  const pendingResponseCount = issued.filter((d) =>
    ['PENDIENTE_FIRMA', 'FIRMADA', 'PENDIENTE_ENVIO', 'ENVIADA_DGII', 'PENDIENTE_RESPUESTA', 'ERROR_COMUNICACION'].includes(
      d.status
    )
  ).length;
  const creditNotesCount = nonDraftIssued.filter((d) => d.ecfType === '34').length;
  const debitNotesCount = nonDraftIssued.filter((d) => d.ecfType === '33').length;
  const voidedCount = issued.filter((d) => d.status === 'ANULADA').length;

  const todayIso = new Date().toISOString().slice(0, 10);
  const availableSequencesCount = sequences
    .filter((s) => s.status === 'ACTIVA' && s.expiryDate >= todayIso)
    .reduce((sum, s) => sum + Math.max(0, s.endSequence - s.lastUsedSequence), 0);

  // Period Series (last 6 months found or current)
  const periodMap = new Map<string, { facturado: number; itbis: number; documentos: number }>();
  for (const d of nonDraftIssued) {
    const ym = d.issueDate.slice(0, 7);
    const cur = periodMap.get(ym) || { facturado: 0, itbis: 0, documentos: 0 };
    if (d.status !== 'ANULADA' && d.status !== 'RECHAZADA') {
      cur.facturado = round2(cur.facturado + (d.ecfType === '34' ? -d.totalAmount : d.totalAmount));
      cur.itbis = round2(cur.itbis + (d.ecfType === '34' ? -d.totalItbis : d.totalItbis));
    }
    cur.documentos += 1;
    periodMap.set(ym, cur);
  }
  const byPeriodSeries = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([period, v]) => ({ period, ...v }));

  // Type Series
  const typeMap = new Map<EcfTypeCode, { cantidad: number; monto: number }>();
  for (const d of nonDraftIssued) {
    const cur = typeMap.get(d.ecfType) || { cantidad: 0, monto: 0 };
    cur.cantidad += 1;
    cur.monto = round2(cur.monto + d.totalAmount);
    typeMap.set(d.ecfType, cur);
  }
  const byTypeSeries = Array.from(typeMap.entries()).map(([codigo, v]) => ({
    codigo,
    tipo: `E${codigo} · ${ECF_TYPE_META[codigo].shortName}`,
    ...v,
  }));

  // Status Series
  const statusMap = new Map<EcfLifecycleStatus, number>();
  for (const d of issued) {
    statusMap.set(d.status, (statusMap.get(d.status) || 0) + 1);
  }
  const byStatusSeries = Array.from(statusMap.entries()).map(([status, cantidad]) => ({
    status,
    estado: status.replace(/_/g, ' '),
    cantidad,
  }));

  return {
    totalIssuedCount: nonDraftIssued.length,
    currentMonthInvoicedAmount,
    totalItbisBilled,
    acceptedCount,
    conditionalAcceptedCount,
    rejectedCount,
    pendingResponseCount,
    creditNotesCount,
    debitNotesCount,
    voidedCount,
    availableSequencesCount,
    byPeriodSeries,
    byTypeSeries,
    byStatusSeries,
  };
}

export interface DgiiFormato607Row {
  rncCedulaComprador: string;
  tipoIdentificacion: '1' | '2' | '3';
  eNCF: string;
  ncfModificado: string;
  tipoIngreso: '01';
  fechaComprobante: string;
  montoFacturado: number;
  itbisFacturado: number;
  montoExento: number;
  otrosImpuestos: number;
  estadoDgii: EcfLifecycleStatus;
}

export interface DgiiFormato606Row {
  rncCedulaSuplidor: string;
  tipoIdentificacion: '1' | '2';
  tipoBienesServicios: '02';
  eNCF: string;
  fechaComprobante: string;
  montoFacturadoServicios: number;
  montoFacturadoBienes: number;
  totalMontoFacturado: number;
  itbisFacturado: number;
  estadoDgii: EcfLifecycleStatus;
}

export function buildFormato607Rows(
  documents: DgiiEcfDocumentRecord[],
  periodYm?: string
): DgiiFormato607Row[] {
  return documents
    .filter(
      (d) =>
        d.direction === 'EMITIDO' &&
        d.status !== 'BORRADOR' &&
        ['31', '32', '33', '34', '44', '45', '46'].includes(d.ecfType) &&
        (!periodYm || d.issueDate.startsWith(periodYm))
    )
    .map((d) => ({
      rncCedulaComprador: cleanDigits(d.receiverTaxId),
      tipoIdentificacion:
        d.receiverIdType === 'RNC' ? '1' : d.receiverIdType === 'CEDULA' ? '2' : '3',
      eNCF: d.eNCF,
      ncfModificado: d.referenceEcf || '',
      tipoIngreso: '01',
      fechaComprobante: d.issueDate.replace(/-/g, ''),
      montoFacturado: round2(d.subtotal - d.totalDiscount),
      itbisFacturado: d.totalItbis,
      montoExento: d.exemptAmount,
      otrosImpuestos: d.otherTaxesTotal,
      estadoDgii: d.status,
    }));
}

export function buildFormato606Rows(
  documents: DgiiEcfDocumentRecord[],
  periodYm?: string
): DgiiFormato606Row[] {
  return documents
    .filter(
      (d) =>
        (d.direction === 'RECIBIDO' || ['41', '43', '47'].includes(d.ecfType)) &&
        d.status !== 'BORRADOR' &&
        (!periodYm || d.issueDate.startsWith(periodYm))
    )
    .map((d) => {
      const partyId = d.direction === 'RECIBIDO' ? d.issuerRnc : d.receiverTaxId;
      const servicesTotal = round2(
        d.items.filter((i) => i.itemType === 'SERVICIO').reduce((s, i) => s + i.lineSubtotal, 0)
      );
      const goodsTotal = round2(
        d.items.filter((i) => i.itemType === 'BIEN').reduce((s, i) => s + i.lineSubtotal, 0)
      );
      return {
        rncCedulaSuplidor: cleanDigits(partyId),
        tipoIdentificacion: cleanDigits(partyId).length === 11 ? '2' : '1',
        tipoBienesServicios: '02',
        eNCF: d.eNCF,
        fechaComprobante: d.issueDate.replace(/-/g, ''),
        montoFacturadoServicios: servicesTotal,
        montoFacturadoBienes: goodsTotal,
        totalMontoFacturado: round2(d.subtotal - d.totalDiscount),
        itbisFacturado: d.totalItbis,
        estadoDgii: d.status,
      };
    });
}
