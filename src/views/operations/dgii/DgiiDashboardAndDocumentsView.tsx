import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Code2,
  DollarSign,
  Download,
  FileCheck2,
  FileMinus2,
  FilePlus2,
  FileText,
  Hash,
  Mail,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAxyCore } from '../../../context/AxyCoreContext';
import { formatEncf, round2 } from '../../../engine/dgii/dgiiCatalogAndValidation';
import { buildDgiiQrValidationUrl, generateEcfPrintedRepresentationPdf, generateQrCodeDataUrl } from '../../../engine/dgii/dgiiQrAndPdfEngine';
import { computeEcfDashboardMetrics } from '../../../engine/dgii/dgiiReportsEngine';
import { buildDgiiAnecfXml } from '../../../engine/dgii/dgiiXmlEngine';
import {
  logDgiiCustomAuditEvent,
  pollDgiiDocumentStatus,
  settleEcfPaymentAndPostAccounting,
  updateDgiiSequenceStatus,
  voidIssuedEcfDocument,
} from '../../../services/dgiiEcfStore';
import {
  ALL_ECF_TYPES,
  ECF_STATUS_LABELS,
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type DgiiEncfSequenceRecord,
  type EcfLifecycleStatus,
  type EcfTypeCode,
} from '../../../types/dgiiEcf';
import { formatMoney } from '../../../utils/formatters';

export type DgiiDocumentsViewMode =
  | 'dashboard'
  | 'issued'
  | 'credit_notes'
  | 'debit_notes'
  | 'dgii_status'
  | 'void';

const STATUS_BADGE_MAP: Record<EcfLifecycleStatus, string> = {
  BORRADOR: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  PENDIENTE_FIRMA: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  FIRMADA: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  PENDIENTE_ENVIO: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  ENVIADA_DGII: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
  PENDIENTE_RESPUESTA: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  ACEPTADA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  ACEPTADA_CONDICIONAL: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
  RECHAZADA: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  ANULADA: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-300',
  ERROR_COMUNICACION: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
};

const CHART_PALETTE = ['#0066FF', '#00B8FF', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#6366F1'];

function downloadTextFile(filename: string, content: string, mime = 'application/xml;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DgiiDashboardAndDocumentsView({
  mode,
  onSelectReferenceForAdjustment,
}: {
  mode: DgiiDocumentsViewMode;
  onSelectReferenceForAdjustment?: (ecf: DgiiEcfDocumentRecord, targetType: '33' | '34') => void;
}) {
  const {
    organization,
    userProfile,
    rbac,
    dgiiEcfDocuments,
    dgiiSequences,
    dgiiCertificates,
    accountingAccounts,
    journalEntries,
    activeDgiiConfig,
    setActiveSection,
  } = useAxyCore();

  const canEmit = rbac.hasPermission('EMIT_ECF');
  const canVoid = rbac.hasPermission('VOID_ECF');
  const canManageSeq = rbac.hasPermission('MANAGE_ECF_SEQUENCES');

  const activeCert = useMemo(
    () => dgiiCertificates.find((c) => c.status === 'ACTIVO' || c.status === 'POR_VENCER') ?? null,
    [dgiiCertificates]
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EcfLifecycleStatus | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<EcfTypeCode | 'ALL'>('ALL');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // XML / Detail inspector modal
  const [inspectDoc, setInspectDoc] = useState<DgiiEcfDocumentRecord | null>(null);
  const [inspectQrDataUrl, setInspectQrDataUrl] = useState<string>('');
  const [inspectTab, setInspectTab] = useState<'summary' | 'xml_signed' | 'xml_orig' | 'responses'>('summary');

  // Void issued doc modal
  const [voidTarget, setVoidTarget] = useState<DgiiEcfDocumentRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Email dispatch modal
  const [emailTarget, setEmailTarget] = useState<DgiiEcfDocumentRecord | null>(null);
  const [emailTo, setEmailTo] = useState('');

  // Service status result (for dgii_status)
  const [serviceStatusResult, setServiceStatusResult] = useState<{
    checkedAt: string;
    httpStatus: number;
    reachable: boolean;
    message: string;
    rawSnippet?: string;
  } | null>(null);

  // ANECF sequence range voiding
  const [anecfSeqId, setAnecfSeqId] = useState('');
  const [anecfFromSeq, setAnecfFromSeq] = useState('');
  const [anecfToSeq, setAnecfToSeq] = useState('');
  const [anecfResultXml, setAnecfResultXml] = useState('');

  const metrics = useMemo(
    () =>
      computeEcfDashboardMetrics({
        documents: dgiiEcfDocuments,
        sequences: dgiiSequences,
      }),
    [dgiiEcfDocuments, dgiiSequences]
  );

  const issuedDocuments = useMemo(
    () =>
      dgiiEcfDocuments
        .filter((d) => d.direction === 'EMITIDO')
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.eNCF.localeCompare(a.eNCF)),
    [dgiiEcfDocuments]
  );

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issuedDocuments.filter((d) => {
      if (mode === 'credit_notes' && d.ecfType !== '34') return false;
      if (mode === 'debit_notes' && d.ecfType !== '33') return false;
      if (mode === 'dgii_status' && d.status === 'BORRADOR') return false;
      if (mode === 'void' && d.status === 'BORRADOR') return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && d.ecfType !== typeFilter) return false;
      if (q) {
        const hay = `${d.eNCF} ${d.receiverName} ${d.receiverTaxId} ${d.trackId || ''} ${d.referenceEcf || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [issuedDocuments, mode, search, statusFilter, typeFilter]);

  const openInspector = async (docRec: DgiiEcfDocumentRecord) => {
    setInspectDoc(docRec);
    setInspectTab('summary');
    setInspectQrDataUrl('');
    try {
      const url = docRec.qrUrl || buildDgiiQrValidationUrl(docRec);
      const dataUrl = await generateQrCodeDataUrl(url);
      setInspectQrDataUrl(dataUrl);
    } catch {
      setInspectQrDataUrl('');
    }
  };

  const handleDownloadPdf = async (docRec: DgiiEcfDocumentRecord) => {
    setBusyId(`pdf_${docRec.id}`);
    try {
      const pdf = await generateEcfPrintedRepresentationPdf({
        document: docRec,
        config: activeDgiiConfig,
      });
      pdf.save(`${docRec.issuerRnc || 'ECF'}_${docRec.eNCF || docRec.id}.pdf`);
      setFeedback({ kind: 'ok', text: `Representación impresa PDF generada para ${docRec.eNCF || docRec.id}.` });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error generando representación impresa PDF.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handlePollStatus = async (docRec: DgiiEcfDocumentRecord) => {
    if (!userProfile) return;
    setBusyId(`poll_${docRec.id}`);
    setFeedback(null);
    try {
      const updated = await pollDgiiDocumentStatus({
        document: docRec,
        config: activeDgiiConfig,
        activeCertificate: activeCert,
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `${updated.eNCF} consultado (TrackId ${updated.trackId}): estado actual ${ECF_STATUS_LABELS[updated.status]} · ${
          updated.isOfficialDgiiResponse ? 'Respuesta Oficial DGII' : 'Ambiente Desarrollo/Local'
        }.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error consultando TrackId ante DGII.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSettlePayment = async (docRec: DgiiEcfDocumentRecord) => {
    if (!userProfile) return;
    setBusyId(`settle_${docRec.id}`);
    setFeedback(null);
    try {
      const je = await settleEcfPaymentAndPostAccounting({
        document: docRec,
        config: activeDgiiConfig,
        accounts: accountingAccounts,
        settlementDate: new Date().toISOString().slice(0, 10),
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `Liquidación registrada para ${docRec.eNCF}. Asiento contable ${je.entryNumber} generado automáticamente.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error contabilizando cobro/pago del e-CF.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCheckDgiiServices = async () => {
    setBusyId('dgii_service_status');
    setFeedback(null);
    try {
      const url = activeDgiiConfig.endpointsByEnv[activeDgiiConfig.environment].serviceStatusUrl;
      const res = await fetch('/api/dgii/service-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceStatusUrl: url }),
      });
      const json = await res.json();
      setServiceStatusResult({
        checkedAt: new Date().toISOString(),
        httpStatus: json.httpStatus || res.status,
        reachable: Boolean(json.reachable ?? res.ok),
        message: json.message || json.error || 'Consulta completada.',
        rawSnippet: typeof json.raw === 'string' ? json.raw : JSON.stringify(json.raw || json, null, 2),
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error consultando estatus de servicios DGII.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmVoidDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget || !userProfile) return;
    setBusyId(`void_${voidTarget.id}`);
    setFeedback(null);
    try {
      await voidIssuedEcfDocument({
        document: voidTarget,
        reason: voidReason,
        journalEntries,
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `Comprobante ${voidTarget.eNCF} marcado como ANULADA y su asiento contable fue revertido automáticamente si aplicaba.`,
      });
      setVoidTarget(null);
      setVoidReason('');
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'No se pudo anular el comprobante.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleVoidSequenceRangeAnecf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const seqRec = dgiiSequences.find((s) => s.id === anecfSeqId);
    if (!seqRec) {
      setFeedback({ kind: 'err', text: 'Seleccione un rango e-NCF válido para generar el ANECF.' });
      return;
    }
    const fromNum = Number(anecfFromSeq);
    const toNum = Number(anecfToSeq);
    if (
      !Number.isInteger(fromNum) ||
      !Number.isInteger(toNum) ||
      fromNum <= seqRec.lastUsedSequence ||
      toNum > seqRec.endSequence ||
      toNum < fromNum
    ) {
      setFeedback({
        kind: 'err',
        text: `Solo puede anular secuencias NO utilizadas del rango (${seqRec.lastUsedSequence + 1} a ${seqRec.endSequence}).`,
      });
      return;
    }

    setBusyId('anecf_submit');
    setFeedback(null);
    try {
      const fromEncf = formatEncf(seqRec.ecfType, fromNum);
      const toEncf = formatEncf(seqRec.ecfType, toNum);
      const quantity = toNum - fromNum + 1;
      const xml = buildDgiiAnecfXml({
        issuerRnc: activeDgiiConfig.rnc,
        ranges: [{ ecfType: seqRec.ecfType, fromEncf, toEncf, quantity }],
      });

      const endpoints = activeDgiiConfig.endpointsByEnv[activeDgiiConfig.environment];
      const res = await fetch('/api/dgii/sequences/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          environment: activeDgiiConfig.environment,
          endpoints,
          vaultKeyId: activeCert?.vaultKeyId || '',
          xml,
          fileName: `${activeDgiiConfig.rnc}ANECF.xml`,
          timeoutMs: activeDgiiConfig.timeoutMs,
          maxRetries: activeDgiiConfig.maxRetries,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error enviando ANECF a DGII.');
      }

      setAnecfResultXml(json.signedXml || xml);
      if (fromNum === seqRec.lastUsedSequence + 1 && toNum === seqRec.endSequence) {
        await updateDgiiSequenceStatus({ sequence: seqRec, status: 'SUSPENDIDA' });
      }
      await logDgiiCustomAuditEvent({
        organizationId: organization.id,
        eventType: 'SEQUENCE_VOIDED',
        environment: activeDgiiConfig.environment,
        summary: `ANECF generado/enviado para rango no utilizado ${fromEncf} - ${toEncf} (${quantity} folios).`,
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `XML ANECF procesado (${fromEncf} - ${toEncf}). ${
          json.dgiiResult?.isOfficialDgiiResponse ? 'Transmitido al endpoint DGII.' : 'Validado localmente en ambiente DESARROLLO.'
        }`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error ejecutando anulación de secuencias ANECF.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSendEmailToReceiver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailTarget || !userProfile) return;
    if (!emailTo.trim() || !emailTo.includes('@')) {
      setFeedback({ kind: 'err', text: 'Ingrese un correo electrónico válido del receptor.' });
      return;
    }
    setBusyId(`email_${emailTarget.id}`);
    setFeedback(null);
    try {
      const qrUrl = emailTarget.qrUrl || buildDgiiQrValidationUrl(emailTarget);
      const res = await fetch('/api/notifications/dispatch-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo.trim(),
          subject: `Comprobante Fiscal Electrónico ${emailTarget.eNCF} · ${emailTarget.issuerName}`,
          text: [
            `Estimado(a) ${emailTarget.receiverName},`,
            '',
            `Adjuntamos los datos fiscales de su comprobante electrónico (${ECF_TYPE_META[emailTarget.ecfType].name}):`,
            `e-NCF: ${emailTarget.eNCF}`,
            `RNC Emisor: ${emailTarget.issuerRnc}`,
            `Fecha de Emisión: ${emailTarget.issueDate}`,
            `Monto Total: ${formatMoney(emailTarget.totalAmount, emailTarget.currency)}`,
            `Código de Seguridad: ${emailTarget.securityCode || 'N/A'}`,
            `Validación QR DGII: ${qrUrl}`,
          ].join('\n'),
        }),
      });
      const json = await res.json();
      await logDgiiCustomAuditEvent({
        organizationId: organization.id,
        eventType: 'EMAIL_SENT',
        ecfDocumentId: emailTarget.id,
        eNCF: emailTarget.eNCF,
        environment: emailTarget.environment,
        summary: json.delivered
          ? `Comprobante ${emailTarget.eNCF} enviado por correo SMTP a ${emailTo.trim()}.`
          : `Intento de envío por correo a ${emailTo.trim()} (${json.reason || 'SMTP no configurado'}).`,
        user: userProfile,
      });

      setFeedback({
        kind: json.delivered ? 'ok' : 'err',
        text: json.delivered
          ? `Correo enviado exitosamente a ${emailTo.trim()} (${json.deliveryChannel}).`
          : `SMTP no configurado en servidor: descargue el PDF/XML para envío manual (${json.reason || ''}).`,
      });
      setEmailTarget(null);
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error enviando correo al receptor.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderHeaderInfo = () => {
    const map: Record<DgiiDocumentsViewMode, { title: string; subtitle: string }> = {
      dashboard: {
        title: 'Dashboard de Facturación Electrónica DGII (e-CF)',
        subtitle: `Indicadores fiscales Ley 32-23, estado de secuencias e-NCF y actividad reciente en ${activeDgiiConfig.environment}.`,
      },
      issued: {
        title: 'Facturas y Comprobantes Electrónicos Emitidos',
        subtitle: 'Historial completo de comprobantes emitidos, borradores, XML firmado, QR DGII y PDF.',
      },
      credit_notes: {
        title: 'Notas de Crédito Electrónicas (e-CF 34)',
        subtitle: 'Ajustes de reducción o anulación parcial/total referenciados a comprobantes emitidos.',
      },
      debit_notes: {
        title: 'Notas de Débito Electrónicas (e-CF 33)',
        subtitle: 'Cargos adicionales e incrementos referenciados a comprobantes fiscales emitidos.',
      },
      dgii_status: {
        title: 'Consulta de Estado DGII y TrackId',
        subtitle: 'Seguimiento en línea de comprobantes enviados mediante TrackId y estatus oficial de servicios DGII.',
      },
      void: {
        title: 'Anulaciones de Comprobantes y Secuencias (ANECF)',
        subtitle: 'Anulación fiscal de e-CF emitidos (con reverso contable) y de rangos de secuencias e-NCF no utilizados.',
      },
    };
    return map[mode];
  };

  const headerInfo = renderHeaderInfo();
  const baseCurrency = activeDgiiConfig.defaultCurrency || organization.currency || 'DOP';

  return (
    <div className="space-y-6 text-xs">
      {/* Environment Banner */}
      <div
        className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
          activeDgiiConfig.environment === 'PRODUCCION' && activeDgiiConfig.isCertifiedByDgii
            ? 'bg-emerald-50/80 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
            : activeDgiiConfig.environment === 'DESARROLLO'
            ? 'bg-amber-50/90 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200'
            : 'bg-sky-50/90 dark:bg-[#00B8FF]/10 border-sky-200 dark:border-[#00B8FF]/30 text-sky-900 dark:text-sky-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <div>
            <span className="font-bold">Ambiente DGII activo: {activeDgiiConfig.environment}</span>
            <span className="mx-1.5">·</span>
            <span>
              RNC Emisor: <strong className="font-mono">{activeDgiiConfig.rnc || 'No configurado'}</strong>
            </span>
            <span className="mx-1.5">·</span>
            <span>
              {activeDgiiConfig.environment === 'DESARROLLO'
                ? 'Las respuestas en DESARROLLO son validaciones estructurales locales, NO respuestas oficiales de la DGII.'
                : activeDgiiConfig.isCertifiedByDgii
                ? 'Entidad marcada como Certificada ante la DGII.'
                : 'En proceso de pruebas/certificación DGII.'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEmit && (
            <button
              type="button"
              onClick={() => setActiveSection('ecf_emit')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Emitir e-CF</span>
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>{headerInfo.title}</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">{headerInfo.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'credit_notes' && canEmit && (
            <button
              type="button"
              onClick={() => {
                if (onSelectReferenceForAdjustment && issuedDocuments[0]) {
                  onSelectReferenceForAdjustment(issuedDocuments[0], '34');
                } else {
                  setActiveSection('ecf_emit');
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              <FileMinus2 className="w-3.5 h-3.5" />
              <span>Nueva Nota de Crédito (34)</span>
            </button>
          )}
          {mode === 'debit_notes' && canEmit && (
            <button
              type="button"
              onClick={() => {
                if (onSelectReferenceForAdjustment && issuedDocuments[0]) {
                  onSelectReferenceForAdjustment(issuedDocuments[0], '33');
                } else {
                  setActiveSection('ecf_emit');
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Nueva Nota de Débito (33)</span>
            </button>
          )}
          {mode === 'dgii_status' && (
            <button
              type="button"
              onClick={handleCheckDgiiServices}
              disabled={busyId === 'dgii_service_status'}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0B1F3A] text-white border border-[#00B8FF]/30 font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyId === 'dgii_service_status' ? 'animate-spin' : ''}`} />
              <span>Verificar Disponibilidad Servicios DGII</span>
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-bold cursor-pointer">
            ×
          </button>
        </div>
      )}

      {/* DASHBOARD KPI CARDS + RECHARTS */}
      {mode === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'Total Facturas Emitidas', value: String(metrics.totalIssuedCount), tone: 'text-slate-950 dark:text-white', icon: FileText },
              { label: 'Facturado en el Mes', value: formatMoney(metrics.currentMonthInvoicedAmount, baseCurrency), tone: 'text-[#0052CC] dark:text-[#00D1FF]', icon: DollarSign },
              { label: 'Total ITBIS Facturado', value: formatMoney(metrics.totalItbisBilled, baseCurrency), tone: 'text-indigo-600 dark:text-indigo-400', icon: Hash },
              { label: 'Aceptadas por DGII', value: String(metrics.acceptedCount + metrics.conditionalAcceptedCount), tone: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
              { label: 'Rechazadas por DGII', value: String(metrics.rejectedCount), tone: 'text-rose-600 dark:text-rose-400', icon: XCircle },
              { label: 'Pendientes de Respuesta', value: String(metrics.pendingResponseCount), tone: 'text-amber-600 dark:text-amber-400', icon: Clock },
              { label: 'Notas de Crédito (34)', value: String(metrics.creditNotesCount), tone: 'text-cyan-600 dark:text-cyan-400', icon: FileMinus2 },
              { label: 'Notas de Débito (33)', value: String(metrics.debitNotesCount), tone: 'text-blue-600 dark:text-blue-400', icon: FilePlus2 },
              { label: 'Facturas Anuladas', value: String(metrics.voidedCount), tone: 'text-zinc-600 dark:text-zinc-300', icon: Ban },
              { label: 'Secuencias e-NCF Disponibles', value: metrics.availableSequencesCount.toLocaleString('es-DO'), tone: 'text-emerald-600 dark:text-emerald-400', icon: ShieldCheck },
            ].map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div
                  key={kpi.label}
                  className="p-3.5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-col justify-between gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{kpi.label}</span>
                    <Icon className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF] shrink-0" />
                  </div>
                  <p className={`font-mono tabular-nums text-lg font-bold ${kpi.tone}`}>{kpi.value}</p>
                </div>
              );
            })}
          </div>

          {/* Interactive Recharts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-950 dark:text-white">
                  Volumen de Facturación e ITBIS por Período
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{baseCurrency}</span>
              </div>
              <div className="h-64 w-full">
                {metrics.byPeriodSeries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400">
                    Emita su primer comprobante e-CF para visualizar series por período.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metrics.byPeriodSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="period" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#040C1E',
                          border: '1px solid rgba(0,184,255,0.3)',
                          borderRadius: '10px',
                          color: '#fff',
                          fontSize: '11px',
                        }}
                      />
                      <Bar dataKey="facturado" name="Total Facturado" fill="#0066FF" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="itbis" name="ITBIS" fill="#00B8FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
              <h3 className="font-semibold text-slate-950 dark:text-white">Distribución por Tipo y Estado DGII</h3>
              <div className="h-44 w-full">
                {metrics.byStatusSeries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400">Sin comprobantes registrados.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={metrics.byStatusSeries}
                        dataKey="cantidad"
                        nameKey="estado"
                        innerRadius={38}
                        outerRadius={66}
                        paddingAngle={2}
                      >
                        {metrics.byStatusSeries.map((_, idx) => (
                          <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#040C1E',
                          border: '1px solid rgba(0,184,255,0.3)',
                          borderRadius: '10px',
                          color: '#fff',
                          fontSize: '11px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {metrics.byTypeSeries.map((t) => (
                  <div key={t.codigo} className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="truncate">{t.tipo}</span>
                    <span className="font-mono font-semibold">
                      {t.cantidad} · {formatMoney(t.monto, baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Service Status Result Box (for dgii_status) */}
      {mode === 'dgii_status' && serviceStatusResult && (
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-950 dark:text-white">
              Estatus Servicios DGII ({serviceStatusResult.reachable ? 'Accesible' : 'No Accesible'} · HTTP {serviceStatusResult.httpStatus})
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {serviceStatusResult.checkedAt.slice(0, 19).replace('T', ' ')}
            </span>
          </div>
          <p className="text-slate-600 dark:text-slate-300">{serviceStatusResult.message}</p>
          {serviceStatusResult.rawSnippet && (
            <pre className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] text-[10px] font-mono overflow-x-auto max-h-32">
              {serviceStatusResult.rawSnippet}
            </pre>
          )}
        </div>
      )}

      {/* ANECF Void Sequence Range Section (for mode === 'void') */}
      {mode === 'void' && canManageSeq && (
        <form
          onSubmit={handleVoidSequenceRangeAnecf}
          className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-950 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
              <span>Anulación de Secuencias e-NCF No Utilizadas (ANECF XML)</span>
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Solo folios posteriores a la última secuencia utilizada
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
                Rango e-NCF Autorizado
              </label>
              <select
                value={anecfSeqId}
                onChange={(e) => {
                  const id = e.target.value;
                  setAnecfSeqId(id);
                  const found = dgiiSequences.find((s) => s.id === id);
                  if (found) {
                    setAnecfFromSeq(String(found.lastUsedSequence + 1));
                    setAnecfToSeq(String(found.endSequence));
                  }
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              >
                <option value="">Seleccionar rango...</option>
                {dgiiSequences
                  .filter((s) => s.lastUsedSequence < s.endSequence)
                  .map((s: DgiiEncfSequenceRecord) => (
                    <option key={s.id} value={s.id}>
                      {s.prefix} · Disp: {s.lastUsedSequence + 1}..{s.endSequence} ({s.status})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
                Secuencia Desde
              </label>
              <input
                type="number"
                value={anecfFromSeq}
                onChange={(e) => setAnecfFromSeq(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
                Secuencia Hasta
              </label>
              <input
                type="number"
                value={anecfToSeq}
                onChange={(e) => setAnecfToSeq(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="submit"
              disabled={busyId === 'anecf_submit' || !anecfSeqId}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Generar y Enviar ANECF</span>
            </button>
            {anecfResultXml && (
              <button
                type="button"
                onClick={() => downloadTextFile(`ANECF_${activeDgiiConfig.rnc}.xml`, anecfResultXml)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar ANECF XML</span>
              </button>
            )}
          </div>
        </form>
      )}

      {/* Search & Filters */}
      <div className="p-3.5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por e-NCF, cliente, RNC/Cédula o TrackId..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-slate-900 dark:text-white"
          />
        </div>
        {mode !== 'credit_notes' && mode !== 'debit_notes' && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as EcfTypeCode | 'ALL')}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
          >
            <option value="ALL">Todos los tipos e-CF</option>
            {ALL_ECF_TYPES.map((code) => (
              <option key={code} value={code}>
                {ECF_TYPE_META[code].shortName}
              </option>
            ))}
          </select>
        )}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EcfLifecycleStatus | 'ALL')}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
        >
          <option value="ALL">Todos los estados DGII</option>
          {(Object.keys(ECF_STATUS_LABELS) as EcfLifecycleStatus[]).map((st) => (
            <option key={st} value={st}>
              {ECF_STATUS_LABELS[st]}
            </option>
          ))}
        </select>
      </div>

      {/* Main Documents Table (Dashboard Actividad Reciente uses exact requested columns) */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <span className="font-semibold text-slate-950 dark:text-white">
            {mode === 'dashboard' ? 'Actividad Reciente de Facturación Electrónica' : 'Registro de Comprobantes e-CF'}
          </span>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {filteredDocuments.length} registros
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-300">
                <th className="py-2.5 px-3">Fecha</th>
                <th className="py-2.5 px-3">Cliente</th>
                <th className="py-2.5 px-3">RNC/Cédula</th>
                <th className="py-2.5 px-3">Tipo e-CF</th>
                <th className="py-2.5 px-3">e-NCF</th>
                <th className="py-2.5 px-3 text-right">Monto</th>
                <th className="py-2.5 px-3">Estado DGII</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    No hay comprobantes electrónicos que coincidan con los filtros actuales.
                  </td>
                </tr>
              ) : (
                (mode === 'dashboard' ? filteredDocuments.slice(0, 15) : filteredDocuments).map((docRec) => {
                  const meta = ECF_TYPE_META[docRec.ecfType];
                  const canSettle =
                    docRec.status !== 'BORRADOR' &&
                    docRec.status !== 'ANULADA' &&
                    docRec.paymentCollectionStatus === 'PENDIENTE' &&
                    canEmit;
                  return (
                    <tr
                      key={docRec.id}
                      className="border-b border-slate-100 dark:border-white/5 hover:bg-slate-50/60 dark:hover:bg-white/[0.02]"
                    >
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{docRec.issueDate}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{docRec.receiverName}</div>
                        {docRec.referenceEcf && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            Ref: {docRec.referenceEcf}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                        {docRec.receiverTaxId || 'Sin ID'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{meta.shortName}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF] whitespace-nowrap">
                        {docRec.eNCF || 'BORRADOR'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        {formatMoney(round2(docRec.totalAmount), docRec.currency)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${
                            STATUS_BADGE_MAP[docRec.status]
                          }`}
                        >
                          {ECF_STATUS_LABELS[docRec.status]}
                        </span>
                        {docRec.trackId && (
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            TrackId: {docRec.trackId}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openInspector(docRec)}
                            title="Ver XML / QR / Detalle"
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-[#0066FF] cursor-pointer"
                          >
                            <Code2 className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                          </button>

                          {docRec.status !== 'BORRADOR' && (
                            <button
                              type="button"
                              onClick={() => handleDownloadPdf(docRec)}
                              disabled={busyId === `pdf_${docRec.id}`}
                              title="Descargar Representación Impresa PDF + QR"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-[#0066FF] cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            </button>
                          )}

                          {docRec.trackId && (
                            <button
                              type="button"
                              onClick={() => handlePollStatus(docRec)}
                              disabled={busyId === `poll_${docRec.id}`}
                              title="Consultar TrackId ante DGII"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-[#0066FF] cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 text-sky-600 dark:text-sky-400 ${
                                  busyId === `poll_${docRec.id}` ? 'animate-spin' : ''
                                }`}
                              />
                            </button>
                          )}

                          {canEmit && docRec.status !== 'BORRADOR' && docRec.status !== 'ANULADA' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (onSelectReferenceForAdjustment) {
                                  onSelectReferenceForAdjustment(docRec, '34');
                                } else {
                                  setActiveSection('ecf_emit');
                                }
                              }}
                              title="Emitir Nota de Crédito (34) referenciada"
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:border-cyan-500 text-[10px] font-semibold cursor-pointer"
                            >
                              NC 34
                            </button>
                          )}

                          {canEmit && docRec.status !== 'BORRADOR' && docRec.status !== 'ANULADA' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (onSelectReferenceForAdjustment) {
                                  onSelectReferenceForAdjustment(docRec, '33');
                                } else {
                                  setActiveSection('ecf_emit');
                                }
                              }}
                              title="Emitir Nota de Débito (33) referenciada"
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:border-indigo-500 text-[10px] font-semibold cursor-pointer"
                            >
                              ND 33
                            </button>
                          )}

                          {canSettle && (
                            <button
                              type="button"
                              onClick={() => handleSettlePayment(docRec)}
                              disabled={busyId === `settle_${docRec.id}`}
                              title="Registrar Cobro / Liquidación Contable"
                              className="p-1.5 rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 cursor-pointer"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {docRec.status !== 'BORRADOR' && (
                            <button
                              type="button"
                              onClick={() => {
                                setEmailTarget(docRec);
                                setEmailTo(docRec.receiverEmail || '');
                              }}
                              title="Enviar al receptor por correo"
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-[#0066FF] cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                            </button>
                          )}

                          {canVoid && docRec.status !== 'BORRADOR' && docRec.status !== 'ANULADA' && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTarget(docRec);
                                setVoidReason('');
                              }}
                              title="Anular Comprobante"
                              className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* XML / QR / Lifecycle Modal */}
      {inspectDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/30 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                  {inspectDoc.eNCF || 'BORRADOR'} · {ECF_TYPE_META[inspectDoc.ecfType].name}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Estado: {ECF_STATUS_LABELS[inspectDoc.status]} · Ambiente: {inspectDoc.environment} · Respuesta Oficial DGII:{' '}
                  {inspectDoc.isOfficialDgiiResponse ? 'Sí' : 'No (Local/Pendiente)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectDoc(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pt-3 flex flex-wrap gap-2 border-b border-slate-200 dark:border-white/10">
              {(
                [
                  { id: 'summary', label: 'Resumen Fiscal & QR' },
                  { id: 'xml_signed', label: 'XML Firmado (XMLDSig)' },
                  { id: 'xml_orig', label: 'XML Original' },
                  { id: 'responses', label: `Bitácora DGII (${inspectDoc.dgiiResponses?.length || 0})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInspectTab(tab.id)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer ${
                    inspectTab === tab.id
                      ? 'border-[#0066FF] text-[#0066FF] dark:text-[#00D1FF]'
                      : 'border-transparent text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {inspectTab === 'summary' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Receptor:</span>{' '}
                        <strong className="text-slate-900 dark:text-white">{inspectDoc.receiverName}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">RNC/Cédula:</span>{' '}
                        <strong className="font-mono">{inspectDoc.receiverTaxId || 'N/A'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Subtotal Neto:</span>{' '}
                        <strong className="font-mono">
                          {formatMoney(inspectDoc.subtotal - inspectDoc.totalDiscount, inspectDoc.currency)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">ITBIS:</span>{' '}
                        <strong className="font-mono">{formatMoney(inspectDoc.totalItbis, inspectDoc.currency)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Total General:</span>{' '}
                        <strong className="font-mono text-[#0052CC] dark:text-[#00D1FF]">
                          {formatMoney(inspectDoc.totalAmount, inspectDoc.currency)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Código Seguridad:</span>{' '}
                        <strong className="font-mono">{inspectDoc.securityCode || 'Pendiente'}</strong>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="py-2 px-3">Descripción</th>
                            <th className="py-2 px-3 text-right">Cant.</th>
                            <th className="py-2 px-3 text-right">Precio</th>
                            <th className="py-2 px-3 text-right">ITBIS</th>
                            <th className="py-2 px-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectDoc.items.map((it) => (
                            <tr key={it.lineNumber} className="border-t border-slate-100 dark:border-white/5">
                              <td className="py-2 px-3">{it.description}</td>
                              <td className="py-2 px-3 text-right font-mono">{it.quantity}</td>
                              <td className="py-2 px-3 text-right font-mono">
                                {formatMoney(it.unitPrice, inspectDoc.currency)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono">
                                {formatMoney(it.itbisAmount, inspectDoc.currency)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-semibold">
                                {formatMoney(it.lineTotal, inspectDoc.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 flex flex-col items-center text-center gap-2">
                    <QrCode className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                    <span className="font-semibold">Código QR DGII</span>
                    {inspectQrDataUrl ? (
                      <img src={inspectQrDataUrl} alt="QR DGII" className="w-40 h-40 rounded-lg bg-white p-1.5" />
                    ) : (
                      <div className="w-40 h-40 rounded-lg bg-white/10 flex items-center justify-center text-slate-400">
                        Sin QR
                      </div>
                    )}
                    <p className="text-[10px] font-mono break-all text-slate-500 dark:text-slate-400">
                      {inspectDoc.qrUrl || buildDgiiQrValidationUrl(inspectDoc)}
                    </p>
                  </div>
                </div>
              )}

              {(inspectTab === 'xml_signed' || inspectTab === 'xml_orig') && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        downloadTextFile(
                          `${inspectDoc.issuerRnc}${inspectDoc.eNCF || inspectDoc.id}.xml`,
                          (inspectTab === 'xml_signed' ? inspectDoc.signedXml : inspectDoc.originalXml) || ''
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar XML</span>
                    </button>
                  </div>
                  <pre className="p-3.5 rounded-xl bg-slate-950 text-cyan-300 font-mono text-[11px] overflow-x-auto max-h-96">
                    {(inspectTab === 'xml_signed' ? inspectDoc.signedXml : inspectDoc.originalXml) ||
                      'XML aún no generado para este estado.'}
                  </pre>
                </div>
              )}

              {inspectTab === 'responses' && (
                <div className="space-y-2">
                  {(inspectDoc.dgiiResponses || []).length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400">No hay respuestas registradas aún.</p>
                  ) : (
                    inspectDoc.dgiiResponses.map((r, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-bold">
                            {r.operation} · {r.environment} · HTTP {r.httpStatus}
                          </span>
                          <span>{r.timestamp.slice(0, 19).replace('T', ' ')}</span>
                        </div>
                        <p>{r.message}</p>
                        {r.rawPayloadSnippet && (
                          <pre className="text-[10px] font-mono text-slate-500 overflow-x-auto">{r.rawPayloadSnippet}</pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Void Confirmation Modal */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmVoidDoc}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#08132B] border border-rose-300 dark:border-rose-500/30 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>Anular Comprobante {voidTarget.eNCF}</span>
            </div>
            <p className="text-slate-600 dark:text-slate-300">
              Esta acción marcará el comprobante como ANULADA y generará automáticamente el asiento contable de reverso
              si existe póliza contabilizada. El número e-NCF nunca podrá reutilizarse.
            </p>
            <div>
              <label className="block text-[11px] font-semibold mb-1">Motivo Fiscal de Anulación</label>
              <textarea
                required
                minLength={5}
                rows={3}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Ej. Error en RNC o monto facturado..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busyId === `void_${voidTarget.id}`}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                Confirmar Anulación
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Email Dispatch Modal */}
      {emailTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSendEmailToReceiver}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/30 p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm flex items-center gap-2">
                <Send className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Enviar Comprobante {emailTarget.eNCF}</span>
              </span>
              <button type="button" onClick={() => setEmailTarget(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">Correo Electrónico del Receptor</label>
              <input
                type="email"
                required
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="facturacion@cliente.com.do"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmailTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busyId === `email_${emailTarget.id}`}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                Enviar Notificación
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
